// 役と、役ごとに開ける画面・できること。画面と API の両方がここを見る。
//
// 役: ケアマネ（管理者はケアマネの印）・行政・医療班・本人・家族。どの画面もログインが要る（ログインなしの役は無い）。
// 審査員はログイン後に役を選ぶ（選ぶ前は unselected）。選んだ役で同じ画面を開く。
// 行政と医療班は同じ扱い（docs/SPEC.md「画面 6」）。受け持ちの範囲は T23 で広げる。

export const ROLES = ["care_manager", "government", "medical", "self", "family", "unselected"] as const;
export type Role = (typeof ROLES)[number];

/** 審査員が選べる役（ケアマネ 山本・医療班・本人のスマホ 山田 ハナ・家族のスマホ 山田の娘）。見本のケアマネの山本も同じ（T95） */
export const JUDGE_ROLES = ["care_manager", "medical", "self", "family"] as const;
export type JudgeRole = (typeof JUDGE_ROLES)[number];

export function isJudgeRole(v: unknown): v is JudgeRole {
  return typeof v === "string" && (JUDGE_ROLES as readonly string[]).includes(v);
}

/**
 * 審査員だけの役の一覧の項目（T115）。押すとその審査員のセッションだけの空の事業所（試用事業所、lib/office/sandbox.ts）を作り、
 * 審査員がその管理者（ケアマネの役）になる。山本（T95）の役変更には出さない（JUDGE_ROLES とは別に持つ）
 */
export const SANDBOX_CHOICE = "sandbox";
/** 審査員のセッションの役の印（lib/auth/session.ts の judge の r）。4 つの役と試用事業所 */
export const JUDGE_SESSION_ROLES = [...JUDGE_ROLES, SANDBOX_CHOICE] as const;
export type JudgeSessionRole = (typeof JUDGE_SESSION_ROLES)[number];

export function isJudgeSessionRole(v: unknown): v is JudgeSessionRole {
  return typeof v === "string" && (JUDGE_SESSION_ROLES as readonly string[]).includes(v);
}

/** 役の一覧の「新規事業所」の言葉と、作った事業所の初めの名前（審査員が /office で直せる） */
export const SANDBOX_LABELS = {
  choice: "新規事業所",
  officeName: "試用事業所",
  /** 作れる数の上限に達したとき（役選択の画面） */
  limit: "上限到達",
} as const;

export const ROLE_LABELS: Record<Role, string> = {
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
 * ログインしていなければ何もできない（API は 401）。審査員は選んだ役で本物の Claude を呼べる。
 * 本人・家族は自分の信号と録音を送る（録音の分類はサーバーが送ったあとに付けるので ai は持たない）。
 */
export const NEEDS = ["read", "save", "ai", "recording"] as const;
export type Need = (typeof NEEDS)[number];

export const PERMISSIONS: Record<Role, readonly Need[]> = {
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
  caseload: ["care_manager"],
  person: ["care_manager", "government", "medical"],
  drill: ["care_manager"],
  staff: ["government", "medical"],
  me: ["self"],
  family: ["family"],
};

export const PAGE_PATHS: Record<Exclude<Page, "person">, string> = {
  caseload: "/",
  drill: "/drill",
  staff: "/staff",
  me: "/me",
  family: "/family",
};

export const LOGIN_PATH = "/login";
export const ROLE_SELECT_PATH = "/login/role";

export function canViewPage(role: Role, page: Page): boolean {
  return PAGE_ROLES[page].includes(role);
}

/**
 * ヘッダーにログアウトを出す役。本人・家族の頁には置かない（押し間違いで出られなくなる。リンクを開き直せば入れる。
 * 設計の答え 11/4、T69a）。審査員の本人・家族の役は役変更から戻ってログアウトする
 */
export function showsLogout(role: Role): boolean {
  return role !== "self" && role !== "family";
}

/**
 * 狭い幅で「PC 推奨」の 1 行（components/PcHint.tsx）を出す役。表の画面を使う役（ケアマネ・事業所の管理者・行政・医療班）だけ。
 * 本人・家族のスマホの頁と、役を選ぶ前には出さない（T124 の追加。審査員には PC で触ってもらう）
 */
export function showsPcHint(role: Role): boolean {
  return role === "care_manager" || role === "government" || role === "medical";
}

/** 役の入口。ログインのあと・開けない画面を開いたときにここへ送る */
export function homePath(role: Role): string {
  switch (role) {
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
