// 最小のオフライン（T71）の画面の言葉と、Service Worker（lib/offline/sw-core.js）と合わせる名前。
// 画面（client）から sw-core.js を読まないよう、要る名前だけここに写す（lib/offline/sw.test.ts が同じ値かを見る）。

/** 写しの HTML の </head> の前に SW が入れる meta の名前（sw-core.js の CACHED_AT_META） */
export const CACHED_AT_META = "care72-cached-at";
/** 画面から SW へ「今の頁を写して」の知らせ（sw-core.js の KEEP_MESSAGE） */
export const KEEP_MESSAGE = "care72:keep";
/** 写しの鍵の頭（sw-core.js の CACHE_PREFIX）。SW を外すときに消す */
export const CACHE_PREFIX = "care72-";

export const OFFLINE_LABELS = {
  copy: "写し",
  offline: "通信なし",
  reload: "読み直す",
  pending: "保留",
  failed: "記録失敗",
  /** ログアウトの前に保留があるとき（components/LogoutButton.tsx） */
  wait: "送信待ち",
  discard: "破棄",
} as const;

const TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 写した時刻「11/4 09:12」（日本の時刻）。読めなければ空 */
export function copyTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(TIME.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** 本人・家族のスマホの頁（帯を大きな字で） */
export const isPhonePath = (pathname: string) => pathname === "/me" || pathname === "/family";
