// デモ事業所の決まった ID。審査員・動画はデモ事業所だけを開く。
// 種（seed/people.ts）の ID と同じにする。合っているかは lib/auth/auth.test.ts が確かめる。
// 審査員のパスワードはここに無い（env の JUDGE_PASSWORD_HASH だけ）。
//
// 確認用の事業所（T144）: 見本のケアマネ（山本）のログインが入る、デモ事業所と同じ種の事業所。作者が本番で山本として確かめた物が、
// 審査員の見るデモ事業所に効かないように分けた。中の id はデモ事業所の種の id の頭に CHECK_ID_PREFIX を付けた物（lib/seed/check.ts が写す）。

/** 審査員 1 の ID。アカウントの表の login_id には使わない（審査員の入口が先に取る） */
export const JUDGE_LOGIN_ID = "judge";

export const DEMO_OFFICE_ID = "office-demo";
/** 所属なしの事業所の行（seed/people.ts の SEED_OFFICES と同じ id）。lib/custody/actor.ts からも同じ名前で読める */
export const UNAFFILIATED_OFFICE_ID = "office-unaffiliated";
/** 審査員（ケアマネの役）が開く担当一覧の持ち主。ログインの ID は持たない（T144。ログインの山本は確認用の事業所の CHECK_CARE_MANAGER_ID） */
export const DEMO_CARE_MANAGER_ID = "acct-yamamoto";
/**
 * デモ事業所の 2 人目のケアマネ（西村、架空。ログインの ID なし）。審査員が担当の一括変更の行き先とケアマネの管理を試せるように（T79）。
 * 種では担当 0 人（種の 10 人は山本のまま。審査員の担当一覧と訓練は山本の 10 人）
 */
export const DEMO_SECOND_CARE_MANAGER_ID = "acct-nishimura";
/** 審査員 1 が書いた物の書き手（経過の author_id など） */
export const DEMO_JUDGE_ACCOUNT_ID = "acct-judge";
/** 審査員の「本人のスマホ」（山田 ハナ） */
export const DEMO_SELF_PERSON_ID = "p-01";
/** 審査員の「家族のスマホ」（山田 ハナの娘の連絡先の行） */
export const DEMO_FAMILY_CONTACT_ID = "c-01-1";

/**
 * 審査員のアカウント（T144）。ログインの ID ごとに書き手のアカウントが別で、パスワードは 3 つとも env の審査員のパスワード。
 * 3 つとも同じデモ事業所に入り、ケアマネの役の担当一覧は山本の 10 人。ID は提出書類にだけ書く（README・docs に書かない）
 */
export const JUDGE_ACCOUNTS: ReadonlyArray<{ loginId: string; accountId: string }> = [
  { loginId: JUDGE_LOGIN_ID, accountId: DEMO_JUDGE_ACCOUNT_ID },
  { loginId: "judge2", accountId: "acct-judge-2" },
  { loginId: "judge3", accountId: "acct-judge-3" },
];

export const JUDGE_ACCOUNT_IDS: readonly string[] = JUDGE_ACCOUNTS.map((j) => j.accountId);

/** 審査員のログインの ID なら、その書き手のアカウント。違えば null（大文字・小文字はアカウントの ID と同じく区別する） */
export function judgeAccountOfLogin(loginId: string): string | null {
  return JUDGE_ACCOUNTS.find((j) => j.loginId === loginId)?.accountId ?? null;
}

export function isJudgeAccount(id: string | null | undefined): boolean {
  return typeof id === "string" && JUDGE_ACCOUNT_IDS.includes(id);
}

// ---------- 確認用の事業所（T144） ----------

/** 確認用の事業所の中の id の頭（デモ事業所の種の id に付ける） */
export const CHECK_ID_PREFIX = "chk-";

/** デモ事業所の種の id の、確認用の事業所での id */
export function checkSeedId(id: string): string {
  return `${CHECK_ID_PREFIX}${id}`;
}

export const CHECK_OFFICE_ID = "office-demo-check";
/** ログインの山本（確認用の事業所の管理者）。env の CAREMANAGER_DEMO_PASSWORD_HASH・CAREMANAGER_DEMO_PASSWORD を読むのはこのアカウント */
export const CHECK_CARE_MANAGER_ID = checkSeedId(DEMO_CARE_MANAGER_ID);
/** 確認用の事業所の 2 人目のケアマネ（西村の写し。ログインの ID なし） */
export const CHECK_SECOND_CARE_MANAGER_ID = checkSeedId(DEMO_SECOND_CARE_MANAGER_ID);
/** 山本のログイン（パスワードを env から読むアカウント） */
export const LOGIN_CARE_MANAGER_ID = CHECK_CARE_MANAGER_ID;

/** 種の事業所（デモ事業所と確認用の事業所）。毎朝 4 時に種へ戻し、作り直しの守りで本物のデータに数えない */
export const SEED_OFFICE_IDS: readonly string[] = [DEMO_OFFICE_ID, CHECK_OFFICE_ID];

export function isSeedOfficeId(id: string | null | undefined): boolean {
  return typeof id === "string" && SEED_OFFICE_IDS.includes(id);
}

/** 種の事業所ごとの決まった相手（担当一覧の持ち主・役変更の本人と家族） */
export type SeedOfficeTargets = {
  officeId: string;
  /** ケアマネの役の担当一覧の持ち主と、種の訓練の開始者 */
  careManagerId: string;
  secondCareManagerId: string;
  /** 本人スマホの役の本人（山田 ハナ） */
  selfPersonId: string;
  /** 家族スマホの役の連絡先の行（山田の娘） */
  familyContactId: string;
};

export const DEMO_TARGETS: SeedOfficeTargets = {
  officeId: DEMO_OFFICE_ID,
  careManagerId: DEMO_CARE_MANAGER_ID,
  secondCareManagerId: DEMO_SECOND_CARE_MANAGER_ID,
  selfPersonId: DEMO_SELF_PERSON_ID,
  familyContactId: DEMO_FAMILY_CONTACT_ID,
};

export const CHECK_TARGETS: SeedOfficeTargets = {
  officeId: CHECK_OFFICE_ID,
  careManagerId: CHECK_CARE_MANAGER_ID,
  secondCareManagerId: CHECK_SECOND_CARE_MANAGER_ID,
  selfPersonId: checkSeedId(DEMO_SELF_PERSON_ID),
  familyContactId: checkSeedId(DEMO_FAMILY_CONTACT_ID),
};

/** 種の事業所の決まった相手。種の事業所でなければ null */
export function seedTargets(officeId: string | null | undefined): SeedOfficeTargets | null {
  if (officeId === DEMO_OFFICE_ID) return DEMO_TARGETS;
  if (officeId === CHECK_OFFICE_ID) return CHECK_TARGETS;
  return null;
}

/**
 * 変えられないアカウント（T61）。種の事業所のアカウント（seed/people.ts の SEED_ACCOUNTS のうちデモ事業所と確認用の事業所の物。
 * 山本・西村〔T79〕・審査員 3 つ〔T144〕と、確認用の山本・西村〔T144〕）。
 * 審査員は皆で同じパスワードを共有し、ケアマネの役では山本の担当一覧を開く。1 人が名前・管理者・停止・パスワードを変えると次の審査員が詰むので、
 * どの操作もサーバーが断る（lib/office/staff.ts・lib/auth/password-change.ts）。種の戻し（lib/seed/reset.ts）が残すアカウントもこの集合。
 * 種と同じかは lib/office/t61.test.ts が確かめる
 */
export const FIXED_ACCOUNT_IDS: readonly string[] = [
  DEMO_CARE_MANAGER_ID,
  DEMO_SECOND_CARE_MANAGER_ID,
  ...JUDGE_ACCOUNT_IDS,
  CHECK_CARE_MANAGER_ID,
  CHECK_SECOND_CARE_MANAGER_ID,
];

export function isFixedAccount(id: string | null | undefined): boolean {
  return typeof id === "string" && FIXED_ACCOUNT_IDS.includes(id);
}

/**
 * ログインもセッションも通さない固定のアカウント（T144）。固定のアカウントのうち、ログインの山本（LOGIN_CARE_MANAGER_ID）のほか全部。
 * 前は審査員の担当一覧の持ち主（acct-yamamoto）でログインしていたので、その頃のセッションがデモ事業所に入り続けないように
 */
export function isNoLoginAccount(id: string | null | undefined): boolean {
  return isFixedAccount(id) && id !== LOGIN_CARE_MANAGER_ID;
}

/**
 * 審査員と同じ役変更（ケアマネ・医療班・本人スマホ・家族スマホ）を出すアカウント（T95）。ログインの ID がある見本のケアマネ（山本）だけ。
 * T144 から確認用の事業所の山本。ケアマネ以外の役のときは審査員と同じ壁（lib/auth/wall.ts。壁の中身は確認用の事業所の人）。
 * ほかのケアマネは役を替えられない
 */
export const ROLE_SWITCH_ACCOUNT_IDS: readonly string[] = [CHECK_CARE_MANAGER_ID];

export function isRoleSwitchAccount(id: string | null | undefined): boolean {
  return typeof id === "string" && ROLE_SWITCH_ACCOUNT_IDS.includes(id);
}

/** アカウントの表の login_id に使えない ID（審査員の入口が先に取る物） */
export function isReservedLoginId(loginId: string): boolean {
  const v = loginId.trim().toLowerCase();
  return JUDGE_ACCOUNTS.some((j) => j.loginId === v);
}
