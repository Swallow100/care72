// ケア72 の Service Worker（docs/tasks/T71.md）。素の JS（束ねない・import しない）。public/ から /sw.js として出る
// （配信は OpenNext が .open-next/assets に写し、Workers の assets が出す。手元の next dev も public/ から出す）。
//
// 写す物: 一度開いた担当一覧（/ と /?open=<id>）・本人のページ・本人の 1 枚・本人と家族のスマホの頁（/me・/family）の HTML の
// 最後の 1 つと、その頁の部品（/_next/static/）。写しは端末の Cache API の中だけで、どこにも送らない。
// - 頁は network-first: ネットから 200 の HTML が返ればそれを返して写す。通信なし・5xx のときだけ写しを返す。
//   3xx（ログインへ）・401・403・404 はネットの応答のまま返し、写さない（写しも返さない）。
// - ログインの終わり（T83）: 頁の応答が 401・403、または /login・/s/invalid への移りなら、頁の写しを全部消す。画面の移りの 3xx は
//   opaqueredirect で移り先が読めないので、裏で同じ URL を redirect: "follow" で取り直して移り先を見る。画面からの頼み（keep）も同じ
// - 写しの期限は写してから 72 時間（COPY_TTL_MS）。過ぎた写しは出さずに消す（写すたびと activate でも消す）
//   NETWORK_WAIT_MS（4 秒）待っても応答が無ければ写しを返し、ネットの応答は裏で待って写す（写しが無ければ待ち続ける）
// - 写しを返すときは </head> の前に <meta name="care72-cached-at"> を入れる（components/OfflineBand.tsx が「写し HH:MM」）
// - 部品は cache-first（名前に中身の hash が入る）。手元の next dev（/sw.js?dev=1）だけ network-first
// - /api/・/q/（QR の頁）・POST・別の origin・?_rsc=（Next の部分の読み込み）には respondWith を呼ばない（ブラウザのまま）
// - ログイン・ログアウト・役の切替・スマホ入口の切替の POST を見たら頁の写しを全部消す（要求には触らない）。スマホ入口のリンクを
//   開く GET /s/<token> はネットが応えたときに消す（T69a）。cookie は読まない・写さない
// - 画面の中の移り（Next の Link）は ?_rsc= の読み込みで HTML が SW を通らないので、画面が「今の頁を写して」と知らせる
//   （components/SwRegister.tsx）。同じ頁は KEEP_MIN_MS の間 2 回取りに行かない
//
// 決める関数は lib/offline/sw-core.js が正本で、下の <core> の間は `node tools/offline/build-sw.ts` が写す（手で直さない）。
// 外すとき: components/SwRegister.tsx の SW_ENABLED を false にして配信すると、入っている SW を外し写しを消す。
// 通知（T149）: push で届いた「大丈夫ですか」を出し（中身は lib/push/message.ts の固定の文と押した先だけ。読めなければ固定の文と /me）、
// 押したら本人・家族の頁（/me・/family）を前に出す。押した先は決まった道だけ（NOTIFY_PATHS）。購読は画面が入れる（components/phone/PhoneSetup.tsx）。

// <core>
/** 写しの鍵の頭。版を上げると、activate で前の版の写しと部品を消す */
const CACHE_PREFIX = "care72-";
/**
 * 版。2（T83）: ログインの終わり（/login・/s/invalid への移り、401・403）で写しを消し、写しに 72 時間の期限を付けた。
 * 前の版の SW が残した写し（期限の切れたログインの物も）を activate で全部消すために上げた。
 * 3（T149）: 「大丈夫ですか」の通知（push・notificationclick）を足した。SW の中身を変えたら上げる決まり（components/SwRegister.tsx）に従った
 * 4（T184）: 事業所の状態の切替（発災・平時復帰・見本の発災開始・最初に戻す）の POST でも写しを全部消す
 */
const CACHE_VERSION = "4";
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
/**
 * 頁のネットを待つ長さ（ミリ秒）。過ぎても応答が無ければ写しを返し、ネットの応答は裏で待って写す（写しが無ければ待ち続ける）。
 * 発災の詰まった通信でブラウザの時間切れまで待たせない
 */
const NETWORK_WAIT_MS = 4000;
/** 画面からの頼みで写し直すのは、前の写しからこの間（ミリ秒）が過ぎてから（同じ頁を 2 回取りに行かない） */
const KEEP_MIN_MS = 60000;
/**
 * 写しを全部消す POST（ログイン・ログアウト・審査員の役の切替。lib/auth の route は触らない）。
 * 事業所の状態の切替（/office/mode・見本の発災開始 /office/start・最初に戻す /office/reset。T184）も。写しは切り替える前の状態
 * （平時復帰のあとに発災中の色と「大雨 レベル 4」）なので、dev や詰まった通信で読み込みが遅れたときに前の状態を出さない
 */
const CLEAR_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/role", "/office/mode", "/office/start", "/office/reset"];
/**
 * ログインが終わったことを示す頁（lib/auth の LOGIN_PATH と、スマホ入口の無効の頁 PHONE_LINK_INVALID_PATH）。頁の読み込みが
 * ここへ移されたら（期限切れ・停止・パスワードの変更・リンクの再発行や一覧から外した）写しを全部消す（見直しの安全 中 4）
 */
const SESSION_END_PATHS = ["/login", "/s/invalid"];
/**
 * 写しの期限（ミリ秒）。写してから 72 時間を過ぎた写しは出さずに消す（通信が無いままの端末に、古い人の連絡先・状態を残し続けない。
 * 発災からの 72 時間の間は、最後に開いた物が残る）
 */
const COPY_TTL_MS = 72 * 60 * 60 * 1000;
/** 端末の時計のずれの許し（写した時刻が今より先に見えても、この間までは期限の中。それより先は読めない時刻と同じに消す） */
const COPY_SKEW_MS = 5 * 60 * 1000;

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

/** 写しの期限が切れたか: 写してから COPY_TTL_MS が過ぎた・時刻が読めない・COPY_SKEW_MS より先の時刻 */
function copyExpired(at, nowMs) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return true;
  return t > nowMs + COPY_SKEW_MS || nowMs - t >= COPY_TTL_MS;
}

/**
 * ログインが終わったと分かる応答: 401・403 か、同じ origin の /login・/s/invalid へ移った応答（redirect: "follow" で取った物。
 * 画面の移り〔navigate〕の応答は opaqueredirect で移り先が読めないので、SW がもう一度 follow で確かめる）
 */
function endsSession(res, origin) {
  if (!res) return false;
  if (res.status === 401 || res.status === 403) return true;
  if (!res.redirected || !res.url) return false;
  let u;
  try {
    u = new URL(res.url);
  } catch {
    return false;
  }
  return u.origin === origin && SESSION_END_PATHS.includes(u.pathname);
}

/** 通知（T149）を押した先にしてよい道（本人・家族の頁。災害モードなら安否のボタン）。lib/push/message.ts の PUSH_URL と同じ */
const NOTIFY_PATHS = ["/me", "/family"];
/** 届いた中身が読めない・決まりの外のときの通知（文は lib/push/message.ts と同じ固定の文） */
const NOTIFY_DEFAULT = { title: "ケア72", body: "大丈夫ですか", url: "/me", tag: "care72-safety" };
const NOTIFY_TITLE_MAX = 40;
const NOTIFY_BODY_MAX = 80;

/**
 * 届いた通知の中身（暗号化を解いた JSON の文字。t 題・b 本文・u 押した先・g 印）から、出す通知の形。
 * 読めない・長すぎる・決まりの外の道は固定の文と /me にする（どの中身でも通知は出す。iPhone は通知を出さない push を続けると止める）
 */
function notificationOf(text) {
  let o = null;
  try {
    o = typeof text === "string" ? JSON.parse(text) : null;
  } catch {
    o = null;
  }
  if (!o || typeof o !== "object") return { ...NOTIFY_DEFAULT };
  const str = (v, max) => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null);
  return {
    title: str(o.t, NOTIFY_TITLE_MAX) || NOTIFY_DEFAULT.title,
    body: str(o.b, NOTIFY_BODY_MAX) || NOTIFY_DEFAULT.body,
    url: NOTIFY_PATHS.includes(o.u) ? o.u : NOTIFY_DEFAULT.url,
    tag: NOTIFY_DEFAULT.tag,
  };
}

/** 押した先の道（決まった道だけ。ほかは /me） */
function notifyTarget(url) {
  return NOTIFY_PATHS.includes(url) ? url : NOTIFY_DEFAULT.url;
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
        if (names.includes(PAGE_CACHE)) await dropExpired(await caches.open(PAGE_CACHE));
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

// 「大丈夫ですか」の通知（T149）。中身は送る時に暗号化した固定の文と押した先だけ（名前・病名を持たない）。決まりの外は固定の文と /me
self.addEventListener("push", (event) => {
  let text = null;
  try {
    text = event.data ? event.data.text() : null;
  } catch {
    text = null;
  }
  const n = notificationOf(text);
  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      renotify: true,
      requireInteraction: true,
      lang: "ja",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: n.url },
    }),
  );
});

// 通知を押したら本人・家族の頁へ（開いている窓があればそこを移して前へ、無ければ開く）
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = ORIGIN + notifyTarget(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        let same = false;
        try {
          same = new URL(c.url).origin === ORIGIN;
        } catch {
          same = false;
        }
        if (!same) continue;
        try {
          const moved = c.url === target ? c : (await c.navigate(target)) || c;
          return await moved.focus();
        } catch {
          // 移せない窓（SW の外で開いた窓など）は、新しく開く
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.type === KEEP_MESSAGE && typeof d.url === "string") event.waitUntil(keep(d.url).catch(() => {}));
});

/** 頁: network-first。NETWORK_WAIT_MS で応答が無ければ写し。写しの所で何かが落ちても、ネットの応答は必ず返す */
async function page(event, req, url) {
  const g = generation;
  const net = fetch(req).then(
    (r) => r,
    () => null,
  );
  const SLOW = {};
  let timer = 0;
  const first = await Promise.race([net, new Promise((r) => (timer = setTimeout(() => r(SLOW), NETWORK_WAIT_MS)))]);
  clearTimeout(timer);
  if (first === SLOW) {
    let copy = null;
    try {
      copy = await fromCopy(url);
    } catch {
      copy = null;
    }
    if (copy) {
      // 遅れて来たネットの応答は写すだけ（画面は写しのまま。帯の「読み直す」で新しい物）。ログインが終わっていれば写しを消す
      event.waitUntil(
        net
          .then((r) => (!r ? undefined : storable(r) ? store(url, r, g) : afterNotStored(url, r)))
          .catch(() => {}),
      );
      return copy;
    }
  }
  const res = first === SLOW ? await net : first;
  if (!fellThrough(res)) {
    if (storable(res)) event.waitUntil(store(url, res.clone(), g).catch(() => {}));
    else event.waitUntil(afterNotStored(url, res).catch(() => {}));
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

/**
 * 写さない頁の応答のあと: 401・403 なら写しを全部消す。画面の移りの 3xx（opaqueredirect）は移り先が読めないので、同じ URL を
 * redirect: "follow" で取り直し、/login・/s/invalid に着いたら消す（役の違う頁への移りなどは消さない）
 */
async function afterNotStored(url, res) {
  if (endsSession(res, ORIGIN)) return clearCopies();
  if (res.type !== "opaqueredirect") return;
  let followed;
  try {
    followed = await fetch(url.href, { credentials: "same-origin", redirect: "follow", headers: { accept: "text/html" } });
  } catch {
    return;
  }
  if (endsSession(followed, ORIGIN)) await clearCopies();
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
  await dropExpired(cache);
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
    if (copyExpired(r.headers.get(AT_HEADER), Date.now())) {
      // 期限の切れた写しは出さずに消し、探す順の次へ
      await cache.delete(ORIGIN + key);
      continue;
    }
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
    // 移りは follow で受け、移り先（res.url）を見る。移った応答（res.redirected）は storable が写さない
    res = await fetch(url.href, { credentials: "same-origin", redirect: "follow", headers: { accept: "text/html" } });
  } catch {
    return;
  }
  if (endsSession(res, ORIGIN)) await clearCopies();
  else if (storable(res)) await store(url, res, g);
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

/** 期限の切れた頁の写しを消す */
async function dropExpired(cache) {
  const now = Date.now();
  for (const req of await cache.keys()) {
    const r = await cache.match(req, { ignoreVary: true });
    if (r && copyExpired(r.headers.get(AT_HEADER), now)) await cache.delete(req);
  }
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
