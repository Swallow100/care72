// T71 の Service Worker（public/sw.js と、決める関数の正本 lib/offline/sw-core.js）。
// 1. 決める関数の中身 2. sw.js の <core> が sw-core.js の写しのままか 3. sw.js そのものを node の vm で動かし、
// 偽の fetch と偽の Cache API で、network-first・写しに落ちる時・触らない要求・消す時を見る。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { embedCore } from "./sw-build.ts";
import {
  assetUrls,
  ASSET_CACHE,
  AT_HEADER,
  CACHE_PREFIX,
  CACHED_AT_META,
  CACHE_VERSION,
  clearsCopies,
  COPY_SKEW_MS,
  COPY_TTL_MS,
  copyCandidates,
  copyExpired,
  copyKey,
  cssAssetUrls,
  endsSession,
  fellThrough,
  freshCopy,
  isAssetRequest,
  isPageRequest,
  isPhoneLinkOpen,
  KEEP_MESSAGE,
  KEEP_MIN_MS,
  NETWORK_WAIT_MS,
  markCopy,
  PAGE_CACHE,
  pickCopy,
  SESSION_END_PATHS,
  storable,
  URL_HEADER,
} from "./sw-core.js";

const ROOT = join(__dirname, "..", "..");
const ORIGIN = "https://care72.app";
const u = (path: string) => new URL(path, ORIGIN);
const SW_SRC = readFileSync(join(ROOT, "public", "sw.js"), "utf8");
const CORE_SRC = readFileSync(join(ROOT, "lib", "offline", "sw-core.js"), "utf8");

describe("写しの鍵", () => {
  it("写す頁: 担当一覧・本人のページ・本人の 1 枚・本人と家族のスマホ", () => {
    expect(copyKey(u("/"))).toBe("/");
    expect(copyKey(u("/?sort=color&state=red"))).toBe("/");
    expect(copyKey(u("/?open=p-01&sort=color"))).toBe("/?open=p-01");
    expect(copyKey(u("/people/p-01"))).toBe("/people/p-01");
    expect(copyKey(u("/people/p-01?back=caseload"))).toBe("/people/p-01");
    expect(copyKey(u("/people/p-01/forms/own"))).toBe("/people/p-01/forms/own");
    expect(copyKey(u("/me"))).toBe("/me");
    expect(copyKey(u("/family"))).toBe("/family");
  });

  it("写さない頁: API・QR の頁・ログイン・訓練・ほかの様式・利用者追加・形の違う id", () => {
    for (const p of [
      "/api/caseload/call",
      "/q/abc",
      "/login",
      "/login/role",
      "/drill",
      "/office",
      "/people/new",
      "/people/p-01/forms/matsuyama",
      "/people/p-01/forms/qr",
      "/people/p%2F01",
      "/me/x",
    ]) {
      expect(copyKey(u(p)), p).toBeNull();
    }
    // ?open= の形が違えば一覧の鍵
    expect(copyKey(u("/?open=../x"))).toBe("/");
  });

  it("探す順: 一覧で開いた人 → 本人のページ → 一覧。本人のページ → 一覧で開いた人", () => {
    expect(copyCandidates(u("/?open=p-02"))).toEqual(["/?open=p-02", "/people/p-02", "/"]);
    expect(copyCandidates(u("/"))).toEqual(["/"]);
    expect(copyCandidates(u("/people/p-02"))).toEqual(["/people/p-02", "/?open=p-02"]);
    expect(copyCandidates(u("/people/p-02/forms/own"))).toEqual(["/people/p-02/forms/own"]);
    expect(copyCandidates(u("/login"))).toEqual([]);
  });

  it("受け持つ要求: 同じ origin の GET の移りだけ。?_rsc= と別の origin と POST は触らない", () => {
    expect(isPageRequest("GET", "navigate", u("/"), ORIGIN)).toBe(true);
    expect(isPageRequest("GET", "navigate", u("/people/p-01"), ORIGIN)).toBe(true);
    expect(isPageRequest("GET", "cors", u("/"), ORIGIN)).toBe(false);
    expect(isPageRequest("GET", "navigate", u("/?_rsc=abc"), ORIGIN)).toBe(false);
    expect(isPageRequest("POST", "navigate", u("/"), ORIGIN)).toBe(false);
    expect(isPageRequest("GET", "navigate", new URL("https://example.com/"), ORIGIN)).toBe(false);
    expect(isPageRequest("GET", "navigate", u("/q/abc"), ORIGIN)).toBe(false);
    expect(isAssetRequest("GET", u("/_next/static/chunks/a.js"), ORIGIN)).toBe(true);
    expect(isAssetRequest("GET", u("/_next/image?url=x"), ORIGIN)).toBe(false);
    expect(isAssetRequest("GET", new URL("https://example.com/_next/static/a.js"), ORIGIN)).toBe(false);
  });

  it("消す要求: ログイン・ログアウト・役の切替・スマホ入口の切替の POST", () => {
    expect(clearsCopies("POST", u("/api/auth/login"), ORIGIN)).toBe(true);
    expect(clearsCopies("POST", u("/api/auth/logout"), ORIGIN)).toBe(true);
    expect(clearsCopies("POST", u("/api/auth/role"), ORIGIN)).toBe(true);
    expect(clearsCopies("POST", u("/s/tok_1"), ORIGIN)).toBe(true);
    expect(clearsCopies("GET", u("/api/auth/logout"), ORIGIN)).toBe(false);
    expect(clearsCopies("POST", u("/api/auth/password"), ORIGIN)).toBe(false);
    expect(clearsCopies("POST", u("/s/invalid"), ORIGIN)).toBe(false);
    expect(clearsCopies("POST", new URL("https://example.com/api/auth/logout"), ORIGIN)).toBe(false);
  });

  it("スマホ入口のリンクを開く: GET /s/<token> の移りだけ（無効の頁・切替の 1 枚は違う）", () => {
    expect(isPhoneLinkOpen("GET", "navigate", u("/s/tok_1"), ORIGIN)).toBe(true);
    expect(isPhoneLinkOpen("GET", "navigate", u("/s/invalid"), ORIGIN)).toBe(false);
    expect(isPhoneLinkOpen("GET", "navigate", u("/s/tok_1/switch"), ORIGIN)).toBe(false);
    expect(isPhoneLinkOpen("GET", "cors", u("/s/tok_1"), ORIGIN)).toBe(false);
    expect(isPhoneLinkOpen("POST", "navigate", u("/s/tok_1"), ORIGIN)).toBe(false);
    expect(copyKey(u("/s/tok_1"))).toBeNull();
  });
});

describe("写してよい応答・写しに落ちる応答", () => {
  const res = (status: number, type = "basic", ct = "text/html; charset=utf-8", redirected = false) => ({
    status,
    type,
    redirected,
    headers: new Headers({ "content-type": ct }),
  });
  it("200 の同じ origin の HTML だけ写す", () => {
    expect(storable(res(200))).toBe(true);
    expect(storable(res(200, "basic", "application/json"))).toBe(false);
    expect(storable(res(200, "basic", "text/x-component"))).toBe(false);
    expect(storable(res(200, "opaque"))).toBe(false);
    expect(storable(res(200, "basic", "text/html", true))).toBe(false);
    expect(storable(res(0, "opaqueredirect", ""))).toBe(false);
    for (const s of [303, 307, 401, 403, 404, 500]) expect(storable(res(s))).toBe(false);
  });
  it("写しに落ちるのは通信なしと 5xx だけ", () => {
    expect(fellThrough(null)).toBe(true);
    expect(fellThrough({ status: 500 })).toBe(true);
    expect(fellThrough({ status: 503 })).toBe(true);
    for (const s of [0, 200, 303, 307, 401, 403, 404, 429]) expect(fellThrough({ status: s })).toBe(false);
  });
});

describe("どの写しを返すか", () => {
  it("同じ URL ならそのまま、違えば写しの URL へ移す。移った先はそのまま返る", () => {
    const stored = { "/": "/?sort=color" };
    expect(pickCopy(u("/?sort=color"), stored)).toEqual({ kind: "serve", key: "/" });
    expect(pickCopy(u("/?state=red"), stored)).toEqual({ kind: "redirect", key: "/", to: "/?sort=color" });
    expect(pickCopy(u("/me"), stored)).toBeNull();
  });
  it("一覧で開いた人の写しが無ければ本人のページへ", () => {
    const stored = { "/people/p-02": "/people/p-02", "/": "/" };
    expect(pickCopy(u("/?open=p-02"), stored)).toEqual({ kind: "redirect", key: "/people/p-02", to: "/people/p-02" });
    expect(pickCopy(u("/people/p-02"), stored)).toEqual({ kind: "serve", key: "/people/p-02" });
    expect(pickCopy(u("/?open=p-03"), stored)).toEqual({ kind: "redirect", key: "/", to: "/" });
  });
});

describe("写しの印と部品", () => {
  it("</head> の前に写した時刻の meta", () => {
    const html = "<!DOCTYPE html><html lang=\"ja\"><head><title>x</title></head><body>a</body></html>";
    const out = markCopy(html, "2026-11-04T00:12:00.000Z");
    expect(out).toBe(
      `<!DOCTYPE html><html lang="ja"><head><title>x</title><meta name="${CACHED_AT_META}" content="2026-11-04T00:12:00.000Z"></head><body>a</body></html>`,
    );
    expect(markCopy("<p>x</p>", 'a"<b')).toBe(`<meta name="${CACHED_AT_META}" content="a&quot;&lt;b"><p>x</p>`);
  });

  it("HTML の部品: script・link と、部分の読み込みの文字の中の static/chunks", () => {
    const html = [
      '<link rel="stylesheet" href="/_next/static/css/a1.css" data-precedence="next"/>',
      '<link rel="preload" href="/_next/static/media/inter.p.woff2" as="font"/>',
      '<script src="/_next/static/chunks/main-1.js" async=""></script>',
      '<script src="/_next/static/chunks/main-1.js" async=""></script>',
      '<script>self.__next_f.push([1,"1:I[\\"(app)/x\\",[\\"static/chunks/page-2.js\\",\\"static/chunks/b%5B3%5D.js\\"]]"])</script>',
      '<img src="/icon-192.png"><a href="/_next/static/chunks/x.map">',
    ].join("");
    expect(assetUrls(html)).toEqual([
      "/_next/static/css/a1.css",
      "/_next/static/media/inter.p.woff2",
      "/_next/static/chunks/main-1.js",
      "/_next/static/chunks/page-2.js",
      "/_next/static/chunks/b%5B3%5D.js",
    ]);
  });

  it("CSS の書体: 相対の url を CSS の場所から解く。data: と別の origin は取らない", () => {
    const css =
      "@font-face{src:url(../media/inter.woff2) format('woff2')}@font-face{src:url('/_next/static/media/ud.woff2')}" +
      "a{background:url(data:image/png;base64,AAA)}b{background:url(https://example.com/_next/static/media/x.woff2)}";
    expect(cssAssetUrls(css, `${ORIGIN}/_next/static/css/a1.css`, ORIGIN)).toEqual([
      "/_next/static/media/inter.woff2",
      "/_next/static/media/ud.woff2",
    ]);
  });

  it("写し直す間: KEEP_MIN_MS の間は取りに行かない。先の時刻・読めない時刻は過ぎた扱い", () => {
    const now = Date.parse("2026-11-04T01:00:00.000Z");
    expect(freshCopy("2026-11-04T00:59:30.000Z", now, KEEP_MIN_MS)).toBe(true);
    expect(freshCopy("2026-11-04T00:58:59.000Z", now, KEEP_MIN_MS)).toBe(false);
    expect(freshCopy("2026-11-04T01:05:00.000Z", now, KEEP_MIN_MS)).toBe(false);
    expect(freshCopy(null, now, KEEP_MIN_MS)).toBe(false);
  });
});

describe("ログインの終わりと写しの期限（T83、見直しの安全 中 4）", () => {
  it("ログインの終わり: 401・403 か、同じ origin の /login・/s/invalid へ移った応答", () => {
    expect(SESSION_END_PATHS).toEqual(["/login", "/s/invalid"]);
    const moved = (path: string, status = 200) => ({ status, redirected: true, url: `${ORIGIN}${path}` });
    expect(endsSession(moved("/login"), ORIGIN)).toBe(true);
    expect(endsSession(moved("/login?e=1"), ORIGIN)).toBe(true);
    expect(endsSession(moved("/s/invalid"), ORIGIN)).toBe(true);
    expect(endsSession({ status: 401, redirected: false, url: "" }, ORIGIN)).toBe(true);
    expect(endsSession({ status: 403, redirected: false, url: "" }, ORIGIN)).toBe(true);
    // 役の違う頁・役の選び直しへの移り、移っていない /login、別の origin の /login は違う
    for (const r of [
      moved("/me"),
      moved("/"),
      moved("/login/role"),
      { status: 200, redirected: false, url: `${ORIGIN}/login` },
      { status: 200, redirected: true, url: "https://example.com/login" },
      { status: 404, redirected: false, url: "" },
      { status: 0, redirected: false, url: "" },
    ]) {
      expect(endsSession(r, ORIGIN), JSON.stringify(r)).toBe(false);
    }
    expect(endsSession(null, ORIGIN)).toBe(false);
  });

  it("写しの期限は 72 時間。読めない時刻・時計のずれより先の時刻は切れた扱い", () => {
    const now = Date.parse("2026-11-07T00:00:00.000Z");
    expect(COPY_TTL_MS).toBe(72 * 3600 * 1000);
    expect(copyExpired(new Date(now - COPY_TTL_MS + 1).toISOString(), now)).toBe(false);
    expect(copyExpired(new Date(now - COPY_TTL_MS).toISOString(), now)).toBe(true);
    expect(copyExpired(new Date(now + COPY_SKEW_MS).toISOString(), now)).toBe(false);
    expect(copyExpired(new Date(now + COPY_SKEW_MS + 1).toISOString(), now)).toBe(true);
    expect(copyExpired(null, now)).toBe(true);
    expect(copyExpired("x", now)).toBe(true);
  });

  it("写しの決まりを変えたので版を上げた（activate で前の版の写しを消す）", () => {
    expect(CACHE_VERSION).toBe("2");
    expect(PAGE_CACHE).toBe(`${CACHE_PREFIX}pages-v2`);
  });
});

describe("public/sw.js は sw-core.js の写し", () => {
  it("<core> の間が sw-core.js と同じ（違えば node tools/offline/build-sw.ts）", () => {
    expect(embedCore(CORE_SRC, SW_SRC)).toBe(SW_SRC.replace(/\r\n/g, "\n"));
  });
  it("sw.js は import・importScripts・export を持たない素の JS", () => {
    expect(SW_SRC).not.toMatch(/^\s*(?:import|export)\s/m);
    expect(SW_SRC).not.toMatch(/importScripts\s*\(/);
    expect(() => new vm.Script(SW_SRC)).not.toThrow();
  });
});

// ---------- sw.js を動かす ----------

type Key = string | { url: string };
const keyUrl = (k: Key) => (typeof k === "string" ? k : k.url);

class FakeCache {
  entries: Array<{ url: string; res: Response }> = [];
  async match(k: Key) {
    const e = this.entries.find((x) => x.url === keyUrl(k));
    return e ? e.res.clone() : undefined;
  }
  async put(k: Key, res: Response) {
    const url = keyUrl(k);
    const body = await res.arrayBuffer();
    this.entries = this.entries.filter((x) => x.url !== url);
    this.entries.push({ url, res: new Response(body, { status: res.status, headers: res.headers }) });
  }
  async keys() {
    return this.entries.map((e) => ({ url: e.url }));
  }
  async delete(k: Key) {
    const before = this.entries.length;
    this.entries = this.entries.filter((x) => x.url !== keyUrl(k));
    return this.entries.length !== before;
  }
}

class FakeCaches {
  map = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.map.has(name)) this.map.set(name, new FakeCache());
    return this.map.get(name)!;
  }
  async keys() {
    return [...this.map.keys()];
  }
  async delete(name: string) {
    return this.map.delete(name);
  }
}

/** 同じ origin の fetch の応答（type basic） */
function basic(body: string | null, init: ResponseInit & { type?: string } = {}): Response {
  const res = new Response(body, { status: init.status ?? 200, headers: init.headers ?? { "content-type": "text/html; charset=utf-8" } });
  Object.defineProperty(res, "type", { value: init.type ?? "basic" });
  return res;
}
const opaqueRedirect = () => ({ type: "opaqueredirect", status: 0, ok: false, redirected: false, headers: new Headers() });
/** redirect: "follow" で移った後の応答（res.url は着いた所） */
function followed(path: string, body = "<html><head></head><body>ログイン</body></html>"): Response {
  const res = basic(body);
  Object.defineProperty(res, "redirected", { value: true });
  Object.defineProperty(res, "url", { value: `${ORIGIN}${path}` });
  return res;
}

type FetchFn = (input: Key, init?: RequestInit) => Promise<unknown>;

function boot(fetchImpl: FetchFn, href = `${ORIGIN}/sw.js`) {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const caches = new FakeCaches();
  const fetch = vi.fn(fetchImpl);
  const self = {
    location: new URL(href),
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] ??= []).push(f),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  };
  // 時計は外の物を呼ぶ（vi.useFakeTimers が効くように）
  const timers = {
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  };
  vm.runInContext(SW_SRC, vm.createContext({ self, caches, fetch, Response, Request, Headers, URL, ...timers }));

  async function request(path: string, init: { method?: string; mode?: string } = {}, opts: { settle?: boolean } = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<unknown> | null = null;
    const ev = {
      request: { url: `${ORIGIN}${path}`, method: init.method ?? "GET", mode: init.mode ?? "navigate", headers: new Headers() },
      respondWith(p: unknown) {
        responded = Promise.resolve(p);
      },
      waitUntil(p: Promise<unknown>) {
        waits.push(p);
      },
    };
    for (const f of listeners.fetch ?? []) f(ev);
    const res = responded ? ((await responded) as Response) : null;
    // waitUntil は respondWith の約束が済む前にも足される
    const done = async () => {
      for (let i = 0; i < waits.length; i++) await waits[i];
    };
    if (opts.settle !== false) await done();
    return { res, responded: responded !== null, done };
  }

  async function message(data: unknown) {
    const waits: Promise<unknown>[] = [];
    for (const f of listeners.message ?? []) f({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    for (let i = 0; i < waits.length; i++) await waits[i];
  }

  async function activate() {
    const waits: Promise<unknown>[] = [];
    for (const f of listeners.activate ?? []) f({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }

  const pages = () => caches.map.get(PAGE_CACHE)?.entries.map((e) => e.url) ?? [];
  return { request, message, activate, caches, fetch, self, pages };
}

const PAGE = (body: string) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

describe("sw.js: 頁は network-first", () => {
  it("ネットから 200 の HTML: そのまま返し、写す（見出しは時刻と URL だけ）", async () => {
    const sw = boot(async () => basic(PAGE("一覧"), { headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "s=1" } }));
    const { res } = await sw.request("/?sort=color");
    expect(await res!.text()).toBe(PAGE("一覧"));
    expect(sw.pages()).toEqual([`${ORIGIN}/`]);
    const copy = await (await sw.caches.open(PAGE_CACHE)).match(`${ORIGIN}/`);
    expect(copy!.headers.get(URL_HEADER)).toBe("/?sort=color");
    expect(Date.parse(copy!.headers.get(AT_HEADER)!)).not.toBeNaN();
    expect(copy!.headers.get("set-cookie")).toBeNull();
  });

  it("通信なし: 写しに時刻の meta を入れて返す", async () => {
    let online = true;
    const sw = boot(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return basic(PAGE("本人"));
    });
    await sw.request("/people/p-01");
    online = false;
    const { res } = await sw.request("/people/p-01");
    const html = await res!.text();
    expect(html).toContain(`<meta name="${CACHED_AT_META}" content="`);
    expect(html).toContain("本人");
    expect(res!.headers.get("cache-control")).toBe("no-store");
  });

  it("5xx: 写しを返す。写しが無ければ 5xx のまま", async () => {
    let status = 200;
    const sw = boot(async () => basic(PAGE("一覧"), { status }));
    status = 503;
    expect((await sw.request("/")).res!.status).toBe(503);
    status = 200;
    await sw.request("/");
    status = 500;
    const { res } = await sw.request("/");
    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain(CACHED_AT_META);
  });

  it("ネットが 4 秒応えない: 写しを返し、遅れて来た応答は裏で写す（画面は写しのまま）", async () => {
    vi.useFakeTimers();
    try {
      let release: (r: Response) => void = () => {};
      let slow = false;
      const sw = boot((input) =>
        slow && !keyUrl(input).includes("static")
          ? new Promise<Response>((resolve) => (release = resolve))
          : Promise.resolve(basic(PAGE("前の一覧"))),
      );
      await sw.request("/");
      const before = (await (await sw.caches.open(PAGE_CACHE)).match(`${ORIGIN}/`))!.headers.get(AT_HEADER);
      slow = true;
      await vi.advanceTimersByTimeAsync(10_000);
      const pending = sw.request("/", {}, { settle: false });
      await vi.advanceTimersByTimeAsync(NETWORK_WAIT_MS - 1);
      let got: Awaited<typeof pending> | null = null;
      void pending.then((r) => (got = r));
      await vi.advanceTimersByTimeAsync(0);
      expect(got).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      const r = await pending;
      const html = await r.res!.text();
      expect(html).toContain("前の一覧");
      expect(html).toContain(CACHED_AT_META);
      release(basic(PAGE("新しい一覧")));
      await r.done();
      const after = (await (await sw.caches.open(PAGE_CACHE)).match(`${ORIGIN}/`))!;
      expect(await after.text()).toContain("新しい一覧");
      expect(after.headers.get(AT_HEADER)).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ネットが 4 秒応えず写しも無い: ネットを待ち続ける", async () => {
    vi.useFakeTimers();
    try {
      let release: (r: Response) => void = () => {};
      const sw = boot(() => new Promise<Response>((resolve) => (release = resolve)));
      const pending = sw.request("/me", {}, { settle: false });
      let got = false;
      void pending.then(() => (got = true));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(got).toBe(false);
      release(basic(PAGE("本人")));
      const r = await pending;
      expect(await r.res!.text()).toBe(PAGE("本人"));
      await r.done();
      expect(sw.pages()).toEqual([`${ORIGIN}/me`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("通信なしで写しも無い: ブラウザの失敗のまま（Response.error）", async () => {
    const sw = boot(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { res } = await sw.request("/me");
    expect(res!.type).toBe("error");
  });

  it("移り・401・403・404 は写さず、写しがあってもネットの応答のまま（ログインの終わりでなければ写しは残す）", async () => {
    let next: () => unknown = () => basic(PAGE("一覧"));
    const probe: Array<RequestInit | undefined> = [];
    const sw = boot(async (_input, init) => {
      if (init?.redirect === "follow") {
        probe.push(init);
        // 役の違う頁への移り（取り直すと /me に着く）
        return followed("/me", PAGE("本人"));
      }
      return next();
    });
    await sw.request("/");
    next = opaqueRedirect;
    expect((await sw.request("/")).res!.type).toBe("opaqueredirect");
    expect(probe).toHaveLength(1);
    expect(probe[0]).toMatchObject({ credentials: "same-origin", redirect: "follow" });
    expect(sw.pages()).toEqual([`${ORIGIN}/`]);
    next = () => basic("x", { status: 404 });
    expect((await sw.request("/")).res!.status).toBe(404);
    next = () => basic('{"a":1}', { headers: { "content-type": "application/json" } });
    await sw.request("/me");
    expect(sw.pages()).toEqual([`${ORIGIN}/`]);
    // 401・403 はネットの応答のまま返し、写しを全部消す
    for (const status of [401, 403]) {
      next = () => basic(PAGE("一覧"));
      await sw.request("/");
      expect(sw.pages()).toEqual([`${ORIGIN}/`]);
      next = () => basic("x", { status });
      expect((await sw.request("/")).res!.status).toBe(status);
      expect(sw.pages()).toEqual([]);
    }
  });

  it("一覧で開いた人の写しが無いときは本人のページの写しへ移す（302）", async () => {
    let online = true;
    const sw = boot(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return basic(PAGE("x"));
    });
    await sw.request("/people/p-02");
    await sw.request("/?sort=color");
    online = false;
    const a = (await sw.request("/?open=p-02")).res!;
    expect(a.status).toBe(302);
    expect(a.headers.get("location")).toBe(`${ORIGIN}/people/p-02`);
    const b = (await sw.request("/?state=red")).res!;
    expect(b.headers.get("location")).toBe(`${ORIGIN}/?sort=color`);
    expect((await sw.request("/?sort=color")).res!.status).toBe(200);
  });
});

describe("sw.js: 触らない要求", () => {
  it("/api/・/q/・POST・?_rsc=・ログインの頁・別の origin には respondWith を呼ばない", async () => {
    const sw = boot(async () => basic("x"));
    for (const [path, init] of [
      ["/api/caseload/call", { method: "POST", mode: "cors" }],
      ["/api/signals", { method: "GET", mode: "cors" }],
      ["/q/abc", {}],
      ["/login", {}],
      ["/?_rsc=1", { mode: "cors" }],
      ["/people/p-01", { method: "POST" }],
    ] as const) {
      expect((await sw.request(path, init)).responded, path).toBe(false);
    }
    expect(sw.fetch).not.toHaveBeenCalled();
  });
});

describe("sw.js: 消す", () => {
  it("ログアウト・ログイン・役の切替の POST: 要求には触らず、頁の写しを全部消す（部品は残す）", async () => {
    for (const path of ["/api/auth/logout", "/api/auth/login", "/api/auth/role"]) {
      const sw = boot(async (input) => basic(keyUrl(input).includes("static") ? "js" : PAGE("一覧")));
      await sw.request("/");
      await sw.request("/_next/static/chunks/a.js", { mode: "no-cors" });
      expect(sw.pages()).toHaveLength(1);
      const r = await sw.request(path, { method: "POST" });
      expect(r.responded).toBe(false);
      expect(sw.caches.map.has(PAGE_CACHE)).toBe(false);
      expect(sw.caches.map.get(ASSET_CACHE)?.entries).toHaveLength(1);
    }
  });

  it("スマホ入口のリンク: ネットが応えたら写しを消し、応答（ログインへの 303）はそのまま。通信なしなら消さない", async () => {
    let online = true;
    const sw = boot(async (input) => {
      if (!online) throw new TypeError("Failed to fetch");
      return keyUrl(input).includes("/s/") ? opaqueRedirect() : basic(PAGE("本人"));
    });
    await sw.request("/me");
    online = false;
    const off = await sw.request("/s/tok_1");
    expect(off.res!.type).toBe("error");
    expect(sw.pages()).toEqual([`${ORIGIN}/me`]);
    online = true;
    const on = await sw.request("/s/tok_1");
    expect(on.res!.type).toBe("opaqueredirect");
    expect(sw.pages()).toEqual([]);
    expect((await sw.request("/s/tok_1", { method: "POST" })).responded).toBe(false);
    expect((await sw.request("/s/invalid")).responded).toBe(false);
  });

  it("消す前に取りに出た頁は、あとで返ってきても写さない", async () => {
    let release: (r: Response) => void = () => {};
    const sw = boot((input) =>
      keyUrl(input).endsWith("/me") ? new Promise<Response>((resolve) => (release = resolve)) : Promise.resolve(basic(PAGE("x"))),
    );
    const pending = sw.request("/me");
    await Promise.resolve();
    await sw.request("/api/auth/logout", { method: "POST" });
    release(basic(PAGE("前の人")));
    await pending;
    expect(sw.pages()).toEqual([]);
  });

  it("activate: 前の版の写しと部品を消し、今の版は残す", async () => {
    const sw = boot(async () => basic("x"));
    await sw.caches.open(`${CACHE_PREFIX}pages-v0`);
    await sw.caches.open(`${CACHE_PREFIX}assets-v0`);
    await sw.caches.open(PAGE_CACHE);
    await sw.caches.open("other-app");
    await sw.activate();
    expect([...sw.caches.map.keys()].sort()).toEqual([PAGE_CACHE, "other-app"].sort());
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});

describe("sw.js: ログインの終わりで消す（T83）", () => {
  it("頁の移り（opaqueredirect）を follow で取り直し、/login に着いたら写しを全部消す。応答は移りのまま返す", async () => {
    let session = true;
    const sw = boot(async (input, init) => {
      const url = keyUrl(input);
      if (url.includes("/_next/static/")) return basic("js", { headers: { "content-type": "application/javascript" } });
      if (session) return basic(PAGE("一覧"));
      return init?.redirect === "follow" ? followed("/login") : opaqueRedirect();
    });
    await sw.request("/");
    await sw.request("/people/p-01");
    expect(sw.pages()).toHaveLength(2);
    session = false;
    const { res } = await sw.request("/?open=p-01");
    expect(res!.type).toBe("opaqueredirect");
    expect(sw.caches.map.has(PAGE_CACHE)).toBe(false);
  });

  it("本人・家族の頁が /s/invalid（リンクの再発行・一覧から外した）へ移ったら消す", async () => {
    let linked = true;
    const sw = boot(async (_input, init) => {
      if (linked) return basic(PAGE("本人"));
      return init?.redirect === "follow" ? followed("/s/invalid", PAGE("無効")) : opaqueRedirect();
    });
    await sw.request("/me");
    expect(sw.pages()).toEqual([`${ORIGIN}/me`]);
    linked = false;
    await sw.request("/me");
    expect(sw.pages()).toEqual([]);
  });

  it("取り直しで通信が切れたら消さない（分からないので次の時に）", async () => {
    let step = 0;
    const sw = boot(async (_input, init) => {
      if (step === 0) return basic(PAGE("一覧"));
      if (init?.redirect === "follow") throw new TypeError("Failed to fetch");
      return opaqueRedirect();
    });
    await sw.request("/");
    step = 1;
    await sw.request("/");
    expect(sw.pages()).toEqual([`${ORIGIN}/`]);
  });

  it("4 秒待って写しを出したあとに来た応答がログインの終わりなら、写しを消す", async () => {
    vi.useFakeTimers();
    try {
      let release: (r: unknown) => void = () => {};
      let slow = false;
      const sw = boot((input, init) => {
        if (keyUrl(input).includes("static")) return Promise.resolve(basic("js"));
        if (!slow) return Promise.resolve(basic(PAGE("一覧")));
        if (init?.redirect === "follow") return Promise.resolve(followed("/login"));
        return new Promise((resolve) => (release = resolve));
      });
      await sw.request("/");
      slow = true;
      await vi.advanceTimersByTimeAsync(10_000);
      const pending = sw.request("/", {}, { settle: false });
      await vi.advanceTimersByTimeAsync(NETWORK_WAIT_MS);
      const r = await pending;
      expect(await r.res!.text()).toContain(CACHED_AT_META);
      release(opaqueRedirect());
      await r.done();
      expect(sw.pages()).toEqual([]);
      // 401 の遅れた応答も同じ
      slow = false;
      await sw.request("/");
      expect(sw.pages()).toEqual([`${ORIGIN}/`]);
      slow = true;
      await vi.advanceTimersByTimeAsync(10_000);
      const again = sw.request("/", {}, { settle: false });
      await vi.advanceTimersByTimeAsync(NETWORK_WAIT_MS);
      const r2 = await again;
      expect(await r2.res!.text()).toContain(CACHED_AT_META);
      release(basic("x", { status: 401 }));
      await r2.done();
      expect(sw.pages()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sw.js: 写しの期限（72 時間）", () => {
  /** 写しの時刻を書き換える（写してから何時間たったか） */
  async function age(sw: ReturnType<typeof boot>, key: string, hours: number) {
    const cache = await sw.caches.open(PAGE_CACHE);
    const e = cache.entries.find((x) => x.url === `${ORIGIN}${key}`)!;
    const headers = new Headers(e.res.headers);
    headers.set(AT_HEADER, new Date(Date.now() - hours * 3600 * 1000).toISOString());
    e.res = new Response(await e.res.clone().text(), { status: 200, headers });
  }

  it("過ぎた写しは出さずに消す（通信なしならブラウザの失敗）。期限の中の写しは今までどおり", async () => {
    let online = true;
    const sw = boot(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return basic(PAGE("本人"));
    });
    await sw.request("/me");
    await sw.request("/people/p-01");
    await age(sw, "/me", 72);
    await age(sw, "/people/p-01", 71);
    online = false;
    expect((await sw.request("/me")).res!.type).toBe("error");
    expect(sw.pages()).toEqual([`${ORIGIN}/people/p-01`]);
    const ok = (await sw.request("/people/p-01")).res!;
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain(CACHED_AT_META);
  });

  it("探す順の先の写しが切れていれば消して次の写しへ（?open=X → 本人のページ）", async () => {
    let online = true;
    const sw = boot(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return basic(PAGE("x"));
    });
    await sw.request("/?open=p-02");
    await sw.request("/people/p-02");
    await age(sw, "/?open=p-02", 80);
    online = false;
    const r = (await sw.request("/?open=p-02")).res!;
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`${ORIGIN}/people/p-02`);
    expect(sw.pages()).toEqual([`${ORIGIN}/people/p-02`]);
  });

  it("写すたびと activate で、切れた写しを消す", async () => {
    const sw = boot(async () => basic(PAGE("x")));
    await sw.request("/me");
    await sw.request("/family");
    await age(sw, "/me", 100);
    await sw.request("/people/p-01");
    expect(sw.pages()).toEqual([`${ORIGIN}/family`, `${ORIGIN}/people/p-01`]);
    await age(sw, "/family", 73);
    await sw.activate();
    expect(sw.pages()).toEqual([`${ORIGIN}/people/p-01`]);
  });
});

describe("sw.js: 画面からの頼みと部品", () => {
  it("今の頁を取りに行って写す。同じ URL は間を置くまで 2 回取らない。ログインへ移れば写さない", async () => {
    let next: () => unknown = () => basic(PAGE("一覧"));
    const sw = boot(async () => next());
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/?open=p-03` });
    expect(sw.pages()).toEqual([`${ORIGIN}/?open=p-03`]);
    const [input, init] = sw.fetch.mock.calls[0];
    expect(input).toBe(`${ORIGIN}/?open=p-03`);
    expect(init).toMatchObject({ redirect: "follow", credentials: "same-origin" });
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/?open=p-03` });
    expect(sw.fetch).toHaveBeenCalledTimes(1);

    // 役の違う頁へ移った物は写さない（写しも消さない）
    next = () => followed("/login/role", PAGE("役選択"));
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/me` });
    await sw.message({ type: KEEP_MESSAGE, url: "https://example.com/" });
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/drill` });
    expect(sw.pages()).toEqual([`${ORIGIN}/?open=p-03`]);
    // ログインへ移った（期限切れ・停止）: 写しを全部消す
    next = () => followed("/login");
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/people/p-01` });
    expect(sw.pages()).toEqual([]);
  });

  it("写した頁の部品を先に取る（CSS の書体も）。次からはネットに出ずに返す", async () => {
    const html = PAGE('<link rel="stylesheet" href="/_next/static/css/a.css"><script src="/_next/static/chunks/m.js"></script>');
    const sw = boot(async (input) => {
      const url = keyUrl(input);
      if (url.endsWith(".css")) return basic("@font-face{src:url(../media/f.woff2)}", { headers: { "content-type": "text/css" } });
      if (url.includes("/_next/static/")) return basic("x", { headers: { "content-type": "application/javascript" } });
      return basic(html);
    });
    await sw.request("/");
    expect(sw.caches.map.get(ASSET_CACHE)?.entries.map((e) => e.url)).toEqual([
      `${ORIGIN}/_next/static/css/a.css`,
      `${ORIGIN}/_next/static/chunks/m.js`,
      `${ORIGIN}/_next/static/media/f.woff2`,
    ]);
    const calls = sw.fetch.mock.calls.length;
    const { res } = await sw.request("/_next/static/chunks/m.js", { mode: "no-cors" });
    expect(await res!.text()).toBe("x");
    expect(sw.fetch).toHaveBeenCalledTimes(calls);
  });

  it("手元の dev（?dev=1）の部品は network-first。部品は写しても頁の部品の先読みはしない", async () => {
    let online = true;
    const sw = boot(async (input) => {
      if (!online) throw new TypeError("Failed to fetch");
      return basic(keyUrl(input).includes("static") ? "new" : PAGE('<script src="/_next/static/chunks/m.js"></script>'));
    }, `${ORIGIN}/sw.js?dev=1`);
    await sw.request("/");
    expect(sw.caches.map.get(ASSET_CACHE)).toBeUndefined();
    expect(await (await sw.request("/_next/static/chunks/m.js", { mode: "no-cors" })).res!.text()).toBe("new");
    online = false;
    expect(await (await sw.request("/_next/static/chunks/m.js", { mode: "no-cors" })).res!.text()).toBe("new");
  });
});
