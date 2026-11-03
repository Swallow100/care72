// ケア72 の Service Worker（docs/tasks/T71.md）。素の JS（束ねない・import しない）。public/ から /sw.js として出る
// （配信は OpenNext が .open-next/assets に写し、Workers の assets が出す。手元の next dev も public/ から出す）。
//
// 写す物: 一度開いた担当一覧（/ と /?open=<id>）・本人のページ・本人の 1 枚・本人と家族のスマホの頁（/me・/family）の HTML の
// 最後の 1 つと、その頁の部品（/_next/static/）。写しは端末の Cache API の中だけで、どこにも送らない。
// - 頁は network-first: ネットから 200 の HTML が返ればそれを返して写す。通信なし・5xx のときだけ写しを返す。
//   3xx（ログインへ）・401・403・404 はネットの応答のまま返し、写さない（写しも返さない）
// - 写しを返すときは </head> の前に <meta name="care72-cached-at"> を入れる（components/OfflineBand.tsx が「写し HH:MM」）
// - 部品は cache-first（名前に中身の hash が入る）。手元の next dev（/sw.js?dev=1）だけ network-first
// - /api/・/q/（QR の頁）・POST・別の origin・?_rsc=（Next の部分の読み込み）には respondWith を呼ばない（ブラウザのまま）
// - ログイン・ログアウト・役の切替の POST を見たら、頁の写しを全部消す（要求には触らない）。cookie は読まない・写さない
// - 画面の中の移り（Next の Link）は ?_rsc= の読み込みで HTML が SW を通らないので、画面が「今の頁を写して」と知らせる
//   （components/SwRegister.tsx）。同じ頁は KEEP_MIN_MS の間 2 回取りに行かない
//
// 決める関数は lib/offline/sw-core.js が正本で、下の <core> の間は `node tools/offline/build-sw.ts` が写す（手で直さない）。
// 外すとき: components/SwRegister.tsx の SW_ENABLED を false にして配信すると、入っている SW を外し写しを消す。

// <core>
/** 写しの鍵の頭。版を上げると、activate で前の版の写しと部品を消す */
const CACHE_PREFIX = "care72-";
const CACHE_VERSION = "1";
/** 頁（HTML）の写し。人の名前・連絡先が入るので、ログイン・ログアウト・役の切替で全部消す */
const PAGE_CACHE = CACHE_PREFIX + "pages-v" + CACHE_VERSION;
/** 部品（/_next/static/）。中身の hash が名前に入っていて人の情報を持たないので、消すのは版を上げたときだけ */
const ASSET_CACHE = CACHE_PREFIX + "assets-v" + CACHE_VERSION;
/** 写した時刻（ISO）と、写した頁の path と query。写しの応答の見出しに持つ */
const AT_HEADER = "x-care72-cached-at";
const URL_HEADER = "x-care72-url";
/** 写しを返すときに </head> の前に入れる meta の名前（components/OfflineBand.tsx が読む） */
const CACHED_AT_META = "care72-cached-at";
/** 画面から「今の頁を写して」と頼む知らせ（components/SwRegister.tsx。画面の中の移り〔?_rsc=〕は SW を通らないので） */
const KEEP_MESSAGE = "care72:keep";
/** 頁の写しの数の上限（担当一覧は開いた人ごと）。超えたら古く写した物から消す */
const MAX_PAGES = 60;
/** 部品の数の上限。配信のたびに名前が変わるので、超えたら古い物から消す */
const MAX_ASSETS = 400;
/** 1 つの頁を写して取っておく部品の数の上限 */
const MAX_KEEP_ASSETS = 150;
/** 画面からの頼みで写し直すのは、前の写しからこの間（ミリ秒）が過ぎてから（同じ頁を 2 回取りに行かない） */
const KEEP_MIN_MS = 60000;
/** 写しを全部消す POST（ログイン・ログアウト・審査員の役の切替。lib/auth の route は触らない） */
const CLEAR_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/role"];

const COPY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isCopyId = (id) => COPY_ID.test(id) && id !== "new";

/**
 * 頁の写しの鍵。写す頁でなければ null。
 * 担当一覧（/）は開いた人（?open=）ごとに 1 つ、ほかの query（絞込・並び）は同じ鍵で最後の 1 つ。
 * 本人のページ（/people/<id>）・本人の 1 枚（/people/<id>/forms/own）・本人と家族のスマホ（/me・/family）は path ごとに最後の 1 つ
 */
function copyKey(url) {
  const p = url.pathname;
  if (p === "/") {
    const open = url.searchParams.get("open");
    return open && isCopyId(open) ? "/?open=" + open : "/";
  }
  if (p === "/me" || p === "/family") return p;
  const m = /^\/people\/([^/]+)(?:\/forms\/own)?$/.exec(p);
  return m && isCopyId(m[1]) ? p : null;
}

/**
 * 写しを探す順。担当一覧の ?open=<id> の写しが無ければ本人のページ、それも無ければ一覧。本人のページの写しが無ければ
 * 担当一覧で開いた写し（どちらも同じ人の連絡先が載る）
 */
function copyCandidates(url) {
  const key = copyKey(url);
  if (!key) return [];
  if (key.startsWith("/?open=")) {
    const id = key.slice("/?open=".length);
    return [key, "/people/" + id, "/"];
  }
  const m = /^\/people\/([^/]+)$/.exec(key);
  return m ? [key, "/?open=" + m[1]] : [key];
}

/** SW が受け持つ頁の読み込み: 同じ origin の GET の画面の移り（navigate）で、写す頁。?_rsc=（Next の部分の読み込み）は触らない */
function isPageRequest(method, mode, url, origin) {
  return method === "GET" && mode === "navigate" && url.origin === origin && !url.searchParams.has("_rsc") && copyKey(url) !== null;
}

/** 部品（/_next/static/）。同じ origin の GET だけ */
function isAssetRequest(method, url, origin) {
  return method === "GET" && url.origin === origin && url.pathname.startsWith("/_next/static/");
}

/** 本人・家族のスマホ入口のリンク（/s/<token>。T69a）。開くとその人のセッションに替わる。/s/invalid と /s/<token>/switch は違う */
function isPhoneLinkPath(pathname) {
  return /^\/s\/[^/]+$/.test(pathname) && pathname !== "/s/invalid";
}

/** 見た時点で写しを全部消す要求: ログイン・ログアウト・役の切替と、スマホ入口の「切替」（POST /s/<token>） */
function clearsCopies(method, url, origin) {
  return method === "POST" && url.origin === origin && (CLEAR_PATHS.includes(url.pathname) || isPhoneLinkPath(url.pathname));
}

/**
 * スマホ入口のリンクを開く（GET /s/<token>）。ネットが応えたら写しを全部消す（前の人の写しを次の人に出さない）。
 * 通信なしで押したときは何も替わらないので消さない（本人のスマホの写しを残す）
 */
function isPhoneLinkOpen(method, mode, url, origin) {
  return method === "GET" && mode === "navigate" && url.origin === origin && isPhoneLinkPath(url.pathname);
}

/** 写してよい応答: 200 の同じ origin の HTML で、移り（redirect）を経ていない物 */
function storable(res) {
  if (!res || res.status !== 200 || res.type !== "basic" || res.redirected) return false;
  return /^text\/html\b/i.test(res.headers.get("content-type") || "");
}

/** 写しに落ちる応答: 通信なし（null）と 5xx。3xx（ログインへ）・401・403・404 はネットの応答のまま返す */
function fellThrough(res) {
  return !res || res.status >= 500;
}

/**
 * 写しのどれを返すか。stored は鍵 → 写した頁の path と query（写しが有る鍵だけ）。
 * 探す順の最初に有る写しが、頼まれた URL と同じならそのまま（serve）、違えば写した URL へ移す（redirect。
 * 画面の URL と中身を揃える。移った先は必ずその写しの鍵なので、もう一度は移らない）。どれも無ければ null
 */
function pickCopy(url, stored) {
  for (const key of copyCandidates(url)) {
    const at = stored[key];
    if (typeof at !== "string") continue;
    return at === url.pathname + url.search ? { kind: "serve", key } : { kind: "redirect", key, to: at };
  }
  return null;
}

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** 写しの HTML の </head> の前に、写した時刻の meta を入れる（React は head の知らない meta を hydration で飛ばす） */
function markCopy(html, at) {
  const meta = '<meta name="' + CACHED_AT_META + '" content="' + escapeAttr(at) + '">';
  const i = html.indexOf("</head>");
  return i >= 0 ? html.slice(0, i) + meta + html.slice(i) : meta + html;
}

const ASSET_EXT = /\.(?:js|mjs|css|woff2?|ttf|otf)$/i;

/**
 * HTML が使う部品の path（/_next/static/…）。<script src>・<link href> と、Next の部分の読み込みの文字の中の
 * "static/chunks/…"（頭の /_next/ が無い形）も拾う。重ねず、上限まで
 */
function assetUrls(html) {
  const out = [];
  const seen = new Set();
  const re = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\s\\()<>?#]+/g;
  let m;
  while ((m = re.exec(html)) && out.length < MAX_KEEP_ASSETS) {
    const p = m[0].startsWith("/") ? m[0] : "/_next/" + m[0];
    if (!ASSET_EXT.test(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** CSS の url(…) のうち、同じ origin の /_next/static/ の物（書体）。相対の url は CSS の場所から解く */
function cssAssetUrls(css, cssHref, origin) {
  const out = [];
  const re = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[2].startsWith("data:")) continue;
    let u;
    try {
      u = new URL(m[2], cssHref);
    } catch {
      continue;
    }
    if (u.origin === origin && u.pathname.startsWith("/_next/static/") && !out.includes(u.pathname)) out.push(u.pathname);
  }
  return out;
}

/** 写した時刻から minMs が過ぎていないか（先の時刻・読めない時刻は過ぎた扱い） */
function freshCopy(at, nowMs, minMs) {
  const t = Date.parse(at || "");
  return Number.isFinite(t) && t <= nowMs && nowMs - t < minMs;
}
// </core>

const ORIGIN = self.location.origin;
/** 手元の next dev は部品の中身が同じ名前のまま変わるので、部品も network-first にする */
const DEV = new URL(self.location.href).searchParams.get("dev") === "1";
/** 写しを消した回数。消す前に取りに出た頁は、あとで返ってきても写さない（前の人の頁を残さない） */
let generation = 0;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.all(
          names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== PAGE_CACHE && n !== ASSET_CACHE).map((n) => caches.delete(n)),
        );
      } catch {
        // 写しの場所が使えない端末（プライベートの窓など）。消す物も無い
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (clearsCopies(req.method, url, ORIGIN)) {
    // 要求はブラウザのまま。見た時点で数を上げるので、この前に取りに出た頁は写らない
    event.waitUntil(clearCopies().catch(() => {}));
    return;
  }
  if (isPhoneLinkOpen(req.method, req.mode, url, ORIGIN)) {
    event.respondWith(openPhoneLink(req));
    return;
  }
  if (isAssetRequest(req.method, url, ORIGIN)) {
    event.respondWith(asset(event, req));
    return;
  }
  if (isPageRequest(req.method, req.mode, url, ORIGIN)) event.respondWith(page(event, req, url));
});

self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.type === KEEP_MESSAGE && typeof d.url === "string") event.waitUntil(keep(d.url).catch(() => {}));
});

/** 頁: network-first。写しの所で何かが落ちても、ネットの応答は必ず返す */
async function page(event, req, url) {
  const g = generation;
  let res = null;
  try {
    res = await fetch(req);
  } catch {
    res = null;
  }
  if (!fellThrough(res)) {
    if (storable(res)) event.waitUntil(store(url, res.clone(), g).catch(() => {}));
    return res;
  }
  try {
    const copy = await fromCopy(url);
    if (copy) return copy;
  } catch {
    // 写しが読めない。ネットの応答（5xx）か、通信なしのまま
  }
  return res || Response.error();
}

/** 頁の写しを置く。見出しに写した時刻と URL。cookie などほかの見出しは持たない */
async function store(url, res, g) {
  const key = copyKey(url);
  if (!key) return;
  const html = await res.text();
  if (g !== generation) return;
  const headers = { "content-type": "text/html; charset=utf-8" };
  headers[AT_HEADER] = new Date().toISOString();
  headers[URL_HEADER] = url.pathname + url.search;
  const cache = await caches.open(PAGE_CACHE);
  if (g !== generation) return;
  await cache.put(ORIGIN + key, new Response(html, { status: 200, headers }));
  await trim(cache, MAX_PAGES);
  if (!DEV) await keepAssets(html);
}

/** 写しを返す。URL が写しと違えば写しの URL へ移す（画面の URL と中身を揃える） */
async function fromCopy(url) {
  const cache = await caches.open(PAGE_CACHE);
  const stored = {};
  let hit = null;
  for (const key of copyCandidates(url)) {
    const r = await cache.match(ORIGIN + key, { ignoreVary: true });
    if (!r) continue;
    stored[key] = r.headers.get(URL_HEADER) || key;
    hit = r;
    break;
  }
  const pick = pickCopy(url, stored);
  if (!pick || !hit) return null;
  if (pick.kind === "redirect") return Response.redirect(ORIGIN + pick.to, 302);
  const html = markCopy(await hit.text(), hit.headers.get(AT_HEADER) || "");
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** 画面からの頼み: 今の頁を取りに行って写す（ログインへ移る・HTML でない物は写さない） */
async function keep(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.origin !== ORIGIN || url.searchParams.has("_rsc")) return;
  const key = copyKey(url);
  if (!key) return;
  const g = generation;
  const cache = await caches.open(PAGE_CACHE);
  const prev = await cache.match(ORIGIN + key, { ignoreVary: true });
  if (prev && prev.headers.get(URL_HEADER) === url.pathname + url.search && freshCopy(prev.headers.get(AT_HEADER), Date.now(), KEEP_MIN_MS)) {
    return;
  }
  let res;
  try {
    res = await fetch(url.href, { credentials: "same-origin", redirect: "manual", headers: { accept: "text/html" } });
  } catch {
    return;
  }
  if (storable(res)) await store(url, res, g);
}

/** スマホ入口のリンク: 応答はそのまま返し（写さない）、ネットが応えたときだけ写しを消す。通信なしなら何も消さない */
async function openPhoneLink(req) {
  let res;
  try {
    res = await fetch(req);
  } catch {
    return Response.error();
  }
  await clearCopies().catch(() => {});
  return res;
}

/** 頁の写しを全部消す（どの版の物も） */
async function clearCopies() {
  generation += 1;
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX + "pages-")).map((n) => caches.delete(n)));
}

/** 部品: cache-first（dev は network-first）。写しの場所が使えなければネットのまま */
async function asset(event, req) {
  let cache = null;
  try {
    cache = await caches.open(ASSET_CACHE);
  } catch {
    cache = null;
  }
  if (!cache) return fetch(req);
  const put = (res) => {
    if (res.ok && res.status === 200 && res.type === "basic") {
      event.waitUntil(
        cache
          .put(req, res.clone())
          .then(() => trim(cache, MAX_ASSETS))
          .catch(() => {}),
      );
    }
    return res;
  };
  if (DEV) {
    try {
      return put(await fetch(req));
    } catch (e) {
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      throw e;
    }
  }
  const hit = await cache.match(req, { ignoreVary: true }).catch(() => null);
  if (hit) return hit;
  return put(await fetch(req));
}

/** 写した頁が使う部品を先に取っておく（取れなければそのまま。次に開いたときに取る） */
async function keepAssets(html) {
  const cache = await caches.open(ASSET_CACHE);
  const list = assetUrls(html);
  const seen = new Set(list);
  for (let i = 0; i < list.length && i < MAX_KEEP_ASSETS; i++) {
    const href = ORIGIN + list[i];
    if (await cache.match(href, { ignoreVary: true })) continue;
    let res;
    try {
      res = await fetch(href, { credentials: "same-origin" });
    } catch {
      continue;
    }
    if (!res.ok || res.status !== 200 || res.type !== "basic") continue;
    if (/\.css$/i.test(list[i])) {
      const css = await res.clone().text();
      for (const p of cssAssetUrls(css, href, ORIGIN)) {
        if (!seen.has(p)) {
          seen.add(p);
          list.push(p);
        }
      }
    }
    await cache.put(href, res);
  }
  await trim(cache, MAX_ASSETS);
}

/** 数が上限を超えたら、古く入れた物から消す（Cache API の keys は入れた順） */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
