// Service Worker（public/sw.js）のうち、決めるだけの関数（docs/tasks/T71.md）。URL・文字・応答の形だけを受けて返し、
// Cache API・fetch・画面には触らない（それは public/sw.js の残りの所）。
// public/sw.js は束ねない素の JS なので、下の <core> の間を `export ` を外して sw.js の同じ印の間に写す
// （node tools/offline/build-sw.ts）。lib/offline/sw.test.ts が「写した物と public/sw.js が同じ」と中身を見る。
// tsconfig は allowJs: false なので、ここは型の検査の外（型は sw-core.d.ts）。

// <core>
/** 写しの鍵の頭。版を上げると、activate で前の版の写しと部品を消す */
export const CACHE_PREFIX = "care72-";
/**
 * 版。2（T83）: ログインの終わり（/login・/s/invalid への移り、401・403）で写しを消し、写しに 72 時間の期限を付けた。
 * 前の版の SW が残した写し（期限の切れたログインの物も）を activate で全部消すために上げた
 */
export const CACHE_VERSION = "2";
/** 頁（HTML）の写し。人の名前・連絡先が入るので、ログイン・ログアウト・役の切替で全部消す */
export const PAGE_CACHE = CACHE_PREFIX + "pages-v" + CACHE_VERSION;
/** 部品（/_next/static/）。中身の hash が名前に入っていて人の情報を持たないので、消すのは版を上げたときだけ */
export const ASSET_CACHE = CACHE_PREFIX + "assets-v" + CACHE_VERSION;
/** 写した時刻（ISO）と、写した頁の path と query。写しの応答の見出しに持つ */
export const AT_HEADER = "x-care72-cached-at";
export const URL_HEADER = "x-care72-url";
/** 写しを返すときに </head> の前に入れる meta の名前（components/OfflineBand.tsx が読む） */
export const CACHED_AT_META = "care72-cached-at";
/** 画面から「今の頁を写して」と頼む知らせ（components/SwRegister.tsx。画面の中の移り〔?_rsc=〕は SW を通らないので） */
export const KEEP_MESSAGE = "care72:keep";
/** 頁の写しの数の上限（担当一覧は開いた人ごと）。超えたら古く写した物から消す */
export const MAX_PAGES = 60;
/** 部品の数の上限。配信のたびに名前が変わるので、超えたら古い物から消す */
export const MAX_ASSETS = 400;
/** 1 つの頁を写して取っておく部品の数の上限 */
export const MAX_KEEP_ASSETS = 150;
/**
 * 頁のネットを待つ長さ（ミリ秒）。過ぎても応答が無ければ写しを返し、ネットの応答は裏で待って写す（写しが無ければ待ち続ける）。
 * 発災の詰まった通信でブラウザの時間切れまで待たせない
 */
export const NETWORK_WAIT_MS = 4000;
/** 画面からの頼みで写し直すのは、前の写しからこの間（ミリ秒）が過ぎてから（同じ頁を 2 回取りに行かない） */
export const KEEP_MIN_MS = 60000;
/** 写しを全部消す POST（ログイン・ログアウト・審査員の役の切替。lib/auth の route は触らない） */
export const CLEAR_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/role"];
/**
 * ログインが終わったことを示す頁（lib/auth の LOGIN_PATH と、スマホ入口の無効の頁 PHONE_LINK_INVALID_PATH）。頁の読み込みが
 * ここへ移されたら（期限切れ・停止・パスワードの変更・リンクの再発行や一覧から外した）写しを全部消す（見直しの安全 中 4）
 */
export const SESSION_END_PATHS = ["/login", "/s/invalid"];
/**
 * 写しの期限（ミリ秒）。写してから 72 時間を過ぎた写しは出さずに消す（通信が無いままの端末に、古い人の連絡先・状態を残し続けない。
 * 発災からの 72 時間の間は、最後に開いた物が残る）
 */
export const COPY_TTL_MS = 72 * 60 * 60 * 1000;
/** 端末の時計のずれの許し（写した時刻が今より先に見えても、この間までは期限の中。それより先は読めない時刻と同じに消す） */
export const COPY_SKEW_MS = 5 * 60 * 1000;

const COPY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isCopyId = (id) => COPY_ID.test(id) && id !== "new";

/**
 * 頁の写しの鍵。写す頁でなければ null。
 * 担当一覧（/）は開いた人（?open=）ごとに 1 つ、ほかの query（絞込・並び）は同じ鍵で最後の 1 つ。
 * 本人のページ（/people/<id>）・本人の 1 枚（/people/<id>/forms/own）・本人と家族のスマホ（/me・/family）は path ごとに最後の 1 つ
 */
export function copyKey(url) {
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
export function copyCandidates(url) {
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
export function isPageRequest(method, mode, url, origin) {
  return method === "GET" && mode === "navigate" && url.origin === origin && !url.searchParams.has("_rsc") && copyKey(url) !== null;
}

/** 部品（/_next/static/）。同じ origin の GET だけ */
export function isAssetRequest(method, url, origin) {
  return method === "GET" && url.origin === origin && url.pathname.startsWith("/_next/static/");
}

/** 本人・家族のスマホ入口のリンク（/s/<token>。T69a）。開くとその人のセッションに替わる。/s/invalid と /s/<token>/switch は違う */
export function isPhoneLinkPath(pathname) {
  return /^\/s\/[^/]+$/.test(pathname) && pathname !== "/s/invalid";
}

/** 見た時点で写しを全部消す要求: ログイン・ログアウト・役の切替と、スマホ入口の「切替」（POST /s/<token>） */
export function clearsCopies(method, url, origin) {
  return method === "POST" && url.origin === origin && (CLEAR_PATHS.includes(url.pathname) || isPhoneLinkPath(url.pathname));
}

/**
 * スマホ入口のリンクを開く（GET /s/<token>）。ネットが応えたら写しを全部消す（前の人の写しを次の人に出さない）。
 * 通信なしで押したときは何も替わらないので消さない（本人のスマホの写しを残す）
 */
export function isPhoneLinkOpen(method, mode, url, origin) {
  return method === "GET" && mode === "navigate" && url.origin === origin && isPhoneLinkPath(url.pathname);
}

/** 写してよい応答: 200 の同じ origin の HTML で、移り（redirect）を経ていない物 */
export function storable(res) {
  if (!res || res.status !== 200 || res.type !== "basic" || res.redirected) return false;
  return /^text\/html\b/i.test(res.headers.get("content-type") || "");
}

/** 写しに落ちる応答: 通信なし（null）と 5xx。3xx（ログインへ）・401・403・404 はネットの応答のまま返す */
export function fellThrough(res) {
  return !res || res.status >= 500;
}

/**
 * 写しのどれを返すか。stored は鍵 → 写した頁の path と query（写しが有る鍵だけ）。
 * 探す順の最初に有る写しが、頼まれた URL と同じならそのまま（serve）、違えば写した URL へ移す（redirect。
 * 画面の URL と中身を揃える。移った先は必ずその写しの鍵なので、もう一度は移らない）。どれも無ければ null
 */
export function pickCopy(url, stored) {
  for (const key of copyCandidates(url)) {
    const at = stored[key];
    if (typeof at !== "string") continue;
    return at === url.pathname + url.search ? { kind: "serve", key } : { kind: "redirect", key, to: at };
  }
  return null;
}

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** 写しの HTML の </head> の前に、写した時刻の meta を入れる（React は head の知らない meta を hydration で飛ばす） */
export function markCopy(html, at) {
  const meta = '<meta name="' + CACHED_AT_META + '" content="' + escapeAttr(at) + '">';
  const i = html.indexOf("</head>");
  return i >= 0 ? html.slice(0, i) + meta + html.slice(i) : meta + html;
}

const ASSET_EXT = /\.(?:js|mjs|css|woff2?|ttf|otf)$/i;

/**
 * HTML が使う部品の path（/_next/static/…）。<script src>・<link href> と、Next の部分の読み込みの文字の中の
 * "static/chunks/…"（頭の /_next/ が無い形）も拾う。重ねず、上限まで
 */
export function assetUrls(html) {
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
export function cssAssetUrls(css, cssHref, origin) {
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
export function freshCopy(at, nowMs, minMs) {
  const t = Date.parse(at || "");
  return Number.isFinite(t) && t <= nowMs && nowMs - t < minMs;
}

/** 写しの期限が切れたか: 写してから COPY_TTL_MS が過ぎた・時刻が読めない・COPY_SKEW_MS より先の時刻 */
export function copyExpired(at, nowMs) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return true;
  return t > nowMs + COPY_SKEW_MS || nowMs - t >= COPY_TTL_MS;
}

/**
 * ログインが終わったと分かる応答: 401・403 か、同じ origin の /login・/s/invalid へ移った応答（redirect: "follow" で取った物。
 * 画面の移り〔navigate〕の応答は opaqueredirect で移り先が読めないので、SW がもう一度 follow で確かめる）
 */
export function endsSession(res, origin) {
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
// </core>
