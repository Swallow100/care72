// デモ事業所の決まった ID。審査員・動画はデモ事業所だけを開く。
// 種（seed/people.ts）の ID と同じにする。合っているかは lib/auth/auth.test.ts が確かめる。
// 審査員のパスワードはここに無い（env の JUDGE_PASSWORD_HASH だけ）。

/** 審査員の ID。アカウントの表の login_id には使わない（審査員の入口が先に取る） */
export const JUDGE_LOGIN_ID = "judge";

export const DEMO_OFFICE_ID = "office-demo";
/** 審査員（ケアマネの役）が開く担当一覧の持ち主 */
export const DEMO_CARE_MANAGER_ID = "acct-yamamoto";
/**
 * デモ事業所の 2 人目のケアマネ（西村、架空。ログインの ID なし）。審査員が担当の一括変更の行き先とケアマネの管理を試せるように（T79）。
 * 種では担当 0 人（種の 10 人は山本のまま。審査員の担当一覧と訓練は山本の 10 人）
 */
export const DEMO_SECOND_CARE_MANAGER_ID = "acct-nishimura";
/** 審査員が書いた物の書き手（経過の author_id など） */
export const DEMO_JUDGE_ACCOUNT_ID = "acct-judge";
/** 審査員の「本人のスマホ」（山田 ハナ） */
export const DEMO_SELF_PERSON_ID = "p-01";
/** 審査員の「家族のスマホ」（山田 ハナの娘の連絡先の行） */
export const DEMO_FAMILY_CONTACT_ID = "c-01-1";

/**
 * 変えられないアカウント（T61）。種のデモ事業所のアカウント（seed/people.ts の SEED_ACCOUNTS のうちデモ事業所の物。山本・西村〔T79〕・審査員）。
 * 審査員は皆で 1 つを共有し、ケアマネの役では山本の担当一覧を開く。1 人が名前・管理者・停止・パスワードを変えると次の審査員が詰むので、
 * どの操作もサーバーが断る（lib/office/staff.ts・lib/auth/password-change.ts）。種の戻し（lib/seed/reset.ts）が残すアカウントもこの集合。
 * 種と同じかは lib/office/t61.test.ts が確かめる
 */
export const FIXED_ACCOUNT_IDS: readonly string[] = [DEMO_CARE_MANAGER_ID, DEMO_SECOND_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID];

export function isFixedAccount(id: string | null | undefined): boolean {
  return typeof id === "string" && FIXED_ACCOUNT_IDS.includes(id);
}

export function isReservedLoginId(loginId: string): boolean {
  return loginId.trim().toLowerCase() === JUDGE_LOGIN_ID;
}
