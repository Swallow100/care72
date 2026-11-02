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
