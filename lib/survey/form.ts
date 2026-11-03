// アンケートの送信の形の決まり（答えの頁の部品とサーバーの両方が読む。サーバーの物を import しない）。

/** 見えない欄（honeypot）の名前。ボットが埋めたくなる名前にする */
export const HONEYPOT_FIELD = "website";

/** 自由記述 1 つの上限（字）。紙の記入欄は 2 行 */
export const FREE_MAX = 400;

/** 宛先の控え（事業所の画面でリンクに付ける呼び名）の上限（字）。migrations/0004_survey.sql の CHECK と同じ */
export const MEMO_MAX = 40;

/** 送る本文の上限（バイト）。7 問と自由記述 2 つ（400 字 × 3 バイト × 2）に余裕を足した大きさ */
export const BODY_MAX_BYTES = 8 * 1024;
