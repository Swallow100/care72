// 役と、役ごとに開ける画面・できること。画面と API の両方がここを見る。
//
// 役: ゲスト（ログインなし、見るだけ）・ケアマネ（管理者はケアマネの印）・行政・医療班・本人・家族。
// 審査員はログイン後に役を選ぶ（選ぶ前は unselected）。選んだ役で同じ画面を開く。
// 行政と医療班は同じ扱い（docs/SPEC.md「画面 6」）。受け持ちの範囲は T23 で広げる。

export const ROLES = ["guest", "care_manager", "government", "medical", "self", "family", "unselected"] as const;
export type Role = (typeof ROLES)[number];

/** 審査員が選べる役（ケアマネ 山本・医療班・本人のスマホ 山田 ハナ・家族のスマホ 山田の娘） */
export const JUDGE_ROLES = ["care_manager", "medical", "self", "family"] as const;
export type JudgeRole = (typeof JUDGE_ROLES)[number];

export function isJudgeRole(v: unknown): v is JudgeRole {
  return typeof v === "string" && (JUDGE_ROLES as readonly string[]).includes(v);
}

export const ROLE_LABELS: Record<Role, string> = {
  guest: "閲覧",
  care_manager: "ケアマネ",
  government: "行政",
  medical: "医療班",
  self: "本人",
  family: "家族",
  unselected: "役未選択",
};

export const ADMIN_LABEL = "管理者";
export const JUDGE_LABEL = "審査員";

/** 審査員の役を選ぶ画面の見出し */
export const JUDGE_ROLE_LABELS: Record<JudgeRole, string> = {
  care_manager: "ケアマネ",
  medical: "医療班",
  self: "本人スマホ",
  family: "家族スマホ",
};

/**
 * できること。read 読む・save 保存・ai Claude と声を呼ぶ・recording 録音の送信。
 * ゲストは読むだけ（保存・Claude・録音は API が断る）。審査員のログインが Claude を呼ぶ所を開ける鍵。
 * 本人・家族は自分の信号と録音を送る（録音の分類はサーバーが送ったあとに付けるので ai は持たない）。
 */
export const NEEDS = ["read", "save", "ai", "recording"] as const;
export type Need = (typeof NEEDS)[number];

export const PERMISSIONS: Record<Role, readonly Need[]> = {
  guest: ["read"],
  care_manager: ["read", "save", "ai"],
  government: ["read", "save", "ai"],
  medical: ["read", "save", "ai"],
  self: ["read", "save", "recording"],
  family: ["read", "save", "recording"],
  unselected: [],
};

export function roleAllows(role: Role, need: Need): boolean {
  return PERMISSIONS[role].includes(need);
}

/** 画面（役ごとの入口）。caseload 担当一覧・person 本人のページ・drill 訓練記録・staff 受け持ち・me 本人のスマホ・family 家族のスマホ */
export const PAGES = ["caseload", "person", "drill", "staff", "me", "family"] as const;
export type Page = (typeof PAGES)[number];

export const PAGE_ROLES: Record<Page, readonly Role[]> = {
  caseload: ["guest", "care_manager"],
  person: ["guest", "care_manager", "government", "medical"],
  drill: ["guest", "care_manager"],
  staff: ["government", "medical"],
  // ゲストは本人のスマホの平時の画面を見られる（docs/DECISIONS.md「審査員がアプリを触る」）
  me: ["guest", "self"],
  family: ["family"],
};

export const PAGE_PATHS: Record<Exclude<Page, "person">, string> = {
  caseload: "/",
  drill: "/drill",
  staff: "/staff",
  me: "/me",
  family: "/family",
};

export const ROLE_SELECT_PATH = "/login/role";

export function canViewPage(role: Role, page: Page): boolean {
  return PAGE_ROLES[page].includes(role);
}

/** 役の入口。ログインのあと・開けない画面を開いたときにここへ送る */
export function homePath(role: Role): string {
  switch (role) {
    case "guest":
    case "care_manager":
      return PAGE_PATHS.caseload;
    case "government":
    case "medical":
      return PAGE_PATHS.staff;
    case "self":
      return PAGE_PATHS.me;
    case "family":
      return PAGE_PATHS.family;
    case "unselected":
      return ROLE_SELECT_PATH;
  }
}
