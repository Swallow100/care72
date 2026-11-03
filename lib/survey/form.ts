// アンケートの送信の形の決まり（答えの頁の部品とサーバーの両方が読む。サーバーの物を import しない）。

export { FREE_MAX, OTHER_MAX } from "../../tools/survey/questions.ts";

/** 見えない欄（honeypot）の名前。ボットが埋めたくなる名前にする */
export const HONEYPOT_FIELD = "website";

/** 宛先の控え（事業所の画面でリンクに付ける呼び名）の上限（字）。migrations/0004_survey.sql の CHECK と同じ */
export const MEMO_MAX = 40;

/** 送る本文の上限（バイト）。9 問と記入欄 3 つ（400 字 × 3 バイト × 3）・その他の記入 4 つ・開いた時刻の署名に余裕を足した大きさ */
export const BODY_MAX_BYTES = 12 * 1024;
