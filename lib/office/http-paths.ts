// 利用者追加・ケアマネ追加・担当の割当の URL（docs/tasks/T30.md）。画面（client の部品）からも読むので、ここは D1 に触らない。

export const NEW_PERSON_PATH = "/people/new";
export const PEOPLE_API_PATH = "/api/people";
export const CARE_MANAGERS_API_PATH = "/api/office/care-managers";
export const OFFICE_PEOPLE_PATH = "/office/people";
/** 事業所の画面の担当の表の場所 */
export const ASSIGN_ANCHOR = "assign";
/** 事業所の画面のケアマネの区分の場所（準備の欄の「ケアマネ追加」の送り先。T98） */
export const CARE_MANAGERS_ANCHOR = "care-managers";
/** 自分のパスワードの変更（T61。事業所のケアマネの行から開く） */
export const OWN_PASSWORD_API_PATH = "/api/auth/password";

/** ケアマネの変更（改名・管理者・停止・再発行、T61）の URL */
export function careManagerApiPath(accountId: string): string {
  return `${CARE_MANAGERS_API_PATH}/${encodeURIComponent(accountId)}`;
}

/** 事業所の画面の「地域」の保存の行き先と、区分の id（保存のあとに戻る所。T68。T154 で lib/office/place.ts から移した: place.ts は表を読む） */
export const OFFICE_PLACE_PATH = "/office/place";
export const OFFICE_PLACE_ANCHOR = "office-place";
/** 保存を断ったときに戻す印（/office?form_error=place。様式の選択の form_error=bad と分ける） */
export const PLACE_FORM_ERROR = "place";
