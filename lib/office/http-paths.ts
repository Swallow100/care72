// 利用者追加・ケアマネ追加・担当の割当の URL（docs/tasks/T30.md）。画面（client の部品）からも読むので、ここは D1 に触らない。

export const NEW_PERSON_PATH = "/people/new";
export const PEOPLE_API_PATH = "/api/people";
export const CARE_MANAGERS_API_PATH = "/api/office/care-managers";
export const OFFICE_PEOPLE_PATH = "/office/people";
/** 事業所の画面の担当の表の場所 */
export const ASSIGN_ANCHOR = "assign";
/** 自分のパスワードの変更（T61。事業所のケアマネの行から開く） */
export const OWN_PASSWORD_API_PATH = "/api/auth/password";

/** ケアマネの変更（改名・管理者・停止・再発行、T61）の URL */
export function careManagerApiPath(accountId: string): string {
  return `${CARE_MANAGERS_API_PATH}/${encodeURIComponent(accountId)}`;
}
