// 受け持ちの URL（docs/tasks/T23.md）。画面（client の部品）からも読むので、ここは D1 に触らない。

export const STAFF_PATH = "/staff";
/** QR の頁の「受入」（フォームの POST。トークンと避難所） */
export const QR_RECEIVE_PATH = "/staff/receive";
export const CUSTODY_SEARCH_API = "/api/custody/search";
export const CUSTODY_SHELTER_API = "/api/custody/shelter";
export const CUSTODY_RECEIVE_API = "/api/custody/receive";
export const CUSTODY_REGISTER_API = "/api/custody/register";
export const CUSTODY_RELEASE_API = "/api/custody/release";
/** 事業所の画面の「所属なし」の「引受」（フォームの POST） */
export const OFFICE_TAKE_PATH = "/office/take";
/** 事業所の画面の所属なしの区分の場所 */
export const UNAFFILIATED_ANCHOR = "unaffiliated";

/** /staff に戻すときの誤りの印（言葉の種類だけ。名前は載せない） */
export function staffHref(error: string | null = null): string {
  return error ? `${STAFF_PATH}?error=${encodeURIComponent(error)}` : STAFF_PATH;
}

/**
 * 受け入れたあとの行き先（T152）。3 つの入り方（QR 読取・氏名検索・新規登録）とも受入一覧へ戻し、受け入れた人を表の上に出す。
 * 載せるのは受け持ちの行の id だけ（名前・カナは載せない）。表の並びの番号は変えない（lib/custody/entry.ts の pinReceived）
 */
export const RECEIVED_PARAM = "received";

export function receivedHref(custodyId: string): string {
  return `${STAFF_PATH}?${RECEIVED_PARAM}=${encodeURIComponent(custodyId)}`;
}

/** QR の頁（/q/<token>）。受入一覧の避難所の欄の値を受入の既定に渡す（避難所の名前だけ。人の物は載せない） */
export function qrPagePath(token: string, shelter: string | null = null): string {
  const s = shelter?.trim();
  return `/q/${encodeURIComponent(token)}${s ? `?shelter=${encodeURIComponent(s)}` : ""}`;
}

/** 医療班への受入依頼（T163）: 送る・下げる（ケアマネ）と返事（医療班） */
export const CUSTODY_REQUEST_API = "/api/custody/request";
export const CUSTODY_REQUEST_WITHDRAW_API = "/api/custody/request/withdraw";
export const CUSTODY_REQUEST_REPLY_API = "/api/custody/request/reply";
