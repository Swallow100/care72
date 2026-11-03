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
  clearsCopies,
  copyCandidates,
  copyKey,
  cssAssetUrls,
  fellThrough,
  freshCopy,
  isAssetRequest,
  isPageRequest,
  KEEP_MESSAGE,
  KEEP_MIN_MS,
  markCopy,
  PAGE_CACHE,
  pickCopy,
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

  it("消す要求: ログイン・ログアウト・役の切替の POST", () => {
    expect(clearsCopies("POST", u("/api/auth/login"), ORIGIN)).toBe(true);
    expect(clearsCopies("POST", u("/api/auth/logout"), ORIGIN)).toBe(true);
    expect(clearsCopies("POST", u("/api/auth/role"), ORIGIN)).toBe(true);
    expect(clearsCopies("GET", u("/api/auth/logout"), ORIGIN)).toBe(false);
    expect(clearsCopies("POST", u("/api/auth/password"), ORIGIN)).toBe(false);
    expect(clearsCopies("POST", new URL("https://example.com/api/auth/logout"), ORIGIN)).toBe(false);
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
  vm.runInContext(SW_SRC, vm.createContext({ self, caches, fetch, Response, Request, Headers, URL }));

  async function request(path: string, init: { method?: string; mode?: string } = {}) {
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
    for (let i = 0; i < waits.length; i++) await waits[i];
    return { res, responded: responded !== null };
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

  it("通信なしで写しも無い: ブラウザの失敗のまま（Response.error）", async () => {
    const sw = boot(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { res } = await sw.request("/me");
    expect(res!.type).toBe("error");
  });

  it("ログインへの移り・401・403・404 は写さず、写しがあってもネットの応答のまま", async () => {
    let next: () => unknown = () => basic(PAGE("一覧"));
    const sw = boot(async () => next());
    await sw.request("/");
    next = opaqueRedirect;
    expect((await sw.request("/")).res!.type).toBe("opaqueredirect");
    for (const status of [401, 403, 404]) {
      next = () => basic("x", { status });
      expect((await sw.request("/")).res!.status).toBe(status);
    }
    next = () => basic('{"a":1}', { headers: { "content-type": "application/json" } });
    await sw.request("/me");
    expect(sw.pages()).toEqual([`${ORIGIN}/`]);
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

describe("sw.js: 画面からの頼みと部品", () => {
  it("今の頁を取りに行って写す。同じ URL は間を置くまで 2 回取らない。ログインへ移れば写さない", async () => {
    let next: () => unknown = () => basic(PAGE("一覧"));
    const sw = boot(async () => next());
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/?open=p-03` });
    expect(sw.pages()).toEqual([`${ORIGIN}/?open=p-03`]);
    const [input, init] = sw.fetch.mock.calls[0];
    expect(input).toBe(`${ORIGIN}/?open=p-03`);
    expect(init).toMatchObject({ redirect: "manual", credentials: "same-origin" });
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/?open=p-03` });
    expect(sw.fetch).toHaveBeenCalledTimes(1);

    next = opaqueRedirect;
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/me` });
    await sw.message({ type: KEEP_MESSAGE, url: "https://example.com/" });
    await sw.message({ type: KEEP_MESSAGE, url: `${ORIGIN}/drill` });
    expect(sw.pages()).toEqual([`${ORIGIN}/?open=p-03`]);
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
