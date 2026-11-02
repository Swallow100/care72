// デモ事業所の決まった ID。ゲスト・審査員・動画はデモ事業所だけを開く。
// 種（seed/people.ts）の ID と同じにする。合っているかは lib/auth/auth.test.ts が確かめる。
// 審査員のパスワードはここに無い（env の JUDGE_PASSWORD_HASH だけ）。

/** 審査員の ID。アカウントの表の login_id には使わない（審査員の入口が先に取る） */
export const JUDGE_LOGIN_ID = "judge";

export const DEMO_OFFICE_ID = "office-demo";
/** ゲストと審査員（ケアマネの役）が開く担当一覧の持ち主 */
export const DEMO_CARE_MANAGER_ID = "acct-yamamoto";
/** 審査員が書いた物の書き手（経過の author_id など） */
export const DEMO_JUDGE_ACCOUNT_ID = "acct-judge";
/** 審査員の「本人のスマホ」と、ゲストが見る本人のスマホの平時の画面 */
export const DEMO_SELF_PERSON_ID = "p-01";
/** 審査員の「家族のスマホ」（山田 ハナの娘の連絡先の行） */
export const DEMO_FAMILY_CONTACT_ID = "c-01-1";

export function isReservedLoginId(loginId: string): boolean {
  return loginId.trim().toLowerCase() === JUDGE_LOGIN_ID;
}
