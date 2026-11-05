// 気象庁の情報（T72）の外の URL・電文の種類・画面の言葉を 1 か所に置く。利用条件は docs/progress/jma-terms-20261104.md。
// URL はどれも、この作業の中では本物に繋いで確かめていない（作者が tools/jma/fetch-fixtures.mjs で確かめる。docs/progress/t72.md の未確認）。
// ブラウザはこれらを直接読まない: フィードと電文は cron（lib/jma/cron.ts）、雨雲は Workers の route（app/api/jma/nowc）が取る。
// 例外は雨雲の凡例の画像 1 枚（旗が on のときだけ。lib/jma/nowcast.ts の NOWC_LEGEND_URL）。

import type { JmaFeed } from "../db/types.ts";

/** 防災情報 XML の PULL 型のフィード（高頻度。登録不要） */
export const JMA_FEED_URLS: Readonly<Record<JmaFeed, string>> = {
  extra: "https://www.data.jma.go.jp/developer/xml/feed/extra.xml",
  eqvol: "https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml",
};

/** 気象警報・注意報。VPWW53・54 は経過措置（令和10年度に廃止予定）、VPWW55〜61 は 2026-05-29 からの体系 */
export const WARNING_CODES_NEW: readonly string[] = ["VPWW55", "VPWW56", "VPWW57", "VPWW58", "VPWW59", "VPWW60", "VPWW61"];
export const WARNING_CODES_OLD: readonly string[] = ["VPWW54", "VPWW53"];
/** 地震の情報。VXSE51 震度速報・VXSE52 震源に関する情報・VXSE53 震源・震度に関する情報 */
export const QUAKE_CODES: readonly string[] = ["VXSE53", "VXSE52", "VXSE51"];

/**
 * 取る順（小さいほど先）。1 回の取得の上限（lib/jma/feed.ts の MAX_ENTRIES_PER_RUN）を超えたら後の物は次の回に。
 * 警報は新しい体系 → VPWW54 → VPWW53、地震は震源・震度 → 震源 → 震度速報。どれでもなければ null（取らない）
 */
export function priorityOf(code: string | null): number | null {
  if (!code) return null;
  if (WARNING_CODES_NEW.includes(code)) return 0;
  const old = WARNING_CODES_OLD.indexOf(code);
  if (old >= 0) return 1 + old;
  const quake = QUAKE_CODES.indexOf(code);
  if (quake >= 0) return quake;
  return null;
}

export function isWarningCode(code: string): boolean {
  return WARNING_CODES_NEW.includes(code) || WARNING_CODES_OLD.includes(code);
}

export function isQuakeCode(code: string): boolean {
  return QUAKE_CODES.includes(code);
}

/** 警報の一覧の下の出典（jma-terms の「出典の書き方の例」のまま） */
export const WARNING_SOURCE = {
  text: "出典：気象庁ホームページ（https://www.jma.go.jp/bosai/warning/）、気象庁防災情報XML",
  href: "https://www.jma.go.jp/bosai/warning/",
} as const;

/** 震度の文字（電文の 5- など）を気象庁の呼び方に（5弱・5強…）。読み替えでなく、気象庁の表記の対応 */
export const INTENSITY_LABELS: Readonly<Record<string, string>> = {
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5-": "5弱",
  "5+": "5強",
  "6-": "6弱",
  "6+": "6強",
  "7": "7",
};

export function intensityLabel(v: string): string {
  return `震度${INTENSITY_LABELS[v] ?? v}`;
}

/** 規模（電文の Magnitude の文字）。数でなければ「M不明」 */
export function magnitudeLabel(v: string | null): string {
  if (v && /^\d+(\.\d+)?$/.test(v)) return `M${v}`;
  return "M不明";
}

/** 画面の言葉（2〜4 字の漢語。警報の名前は気象庁の正式な名前のまま出すので、ここには持たない） */
export const JMA_LABELS = {
  title: "気象庁",
  warning: "警報",
  advisory: "注意報",
  matched: "該当",
  switch: "切替",
  unfetched: "未取得",
  fetched: "取得",
  none: "発表なし",
  noCity: "市未入力",
  quake: "地震",
  source: "出典",
  rain: "雨雲",
  legend: "凡例",
} as const;

/** 事業所の画面の気象庁の欄の場所（上の帯の「警報 2」の送り先。T148） */
export const JMA_ANCHOR = "jma";

/** 警報（注意報でない物）か。名前に「警報」があり「注意報」が無い物（特別警報・危険警報も警報に数える） */
export function isWarningKind(kind: string): boolean {
  return kind.includes("警報") && !kind.includes("注意報");
}
