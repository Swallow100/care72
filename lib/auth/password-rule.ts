// 新しいパスワードの決まり（docs/tasks/T148.md の 3）。決まりはここ 1 か所に置き、パスワードを新しく決める所はみなここを通す:
// - ケアマネ追加で管理者が決めるパスワード（lib/office/forms.ts の parseStaffInput）
// - 管理者の再設定で決めるパスワード（lib/office/http.ts の careManagerActionRequest の reset_password）
// - 自分のパスワードの変更（lib/auth/password-change.ts の parseNewPassword。前は 8〜64 字だけだった）
// - サーバーが作る初期パスワード（lib/office/staff.ts の generateInitialPassword。作った物が決まりを通ることをテストで見る）
// 決まり: NFC にそろえて 10〜64 字、英大文字・英小文字・記号をそれぞれ 1 字以上。数字は求めない（記号で足りる）。
// 英字と記号は半角だけを数える（全角の英字・記号は数えない。ログインの欄で打ち分けが見えにくいため）。
// 前からあるパスワード（審査員・種のアカウント・前に作った初期パスワード）は確かめない。ログインはこの決まりを見ない。
// 平文はこの関数の中と返り値にだけあり、ログ・URL・表に出さない。

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 64;

/** 足りない物の種類（長さ・大文字・小文字・記号） */
export const PASSWORD_PARTS = ["length", "upper", "lower", "symbol"] as const;
export type PasswordPart = (typeof PASSWORD_PARTS)[number];

const UPPER = /[A-Z]/;
const LOWER = /[a-z]/;
/** 記号: 半角の英数字と空白のほかの、印字できる半角の文字（!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~） */
const SYMBOL = /[!-/:-@[-`{-~]/;

/** 画面の言葉（2〜4 字の漢語）。欄の横の決まりと、断ったときの言葉 */
export const PASSWORD_RULE_LABELS = {
  /** 欄の横に置く決まりの 1 行 */
  rule: `${PASSWORD_MIN}字以上 大文字 小文字 記号`,
  /** 決まりに合わないときの断り */
  short: "条件不足",
  length: `${PASSWORD_MIN}〜${PASSWORD_MAX}字`,
  upper: "大文字",
  lower: "小文字",
  symbol: "記号",
} as const;

/** 足りない物（空なら決まりに合う）。NFC にそろえてから数える */
export function passwordProblems(raw: string): PasswordPart[] {
  const v = raw.normalize("NFC");
  const n = [...v].length;
  const out: PasswordPart[] = [];
  if (n < PASSWORD_MIN || n > PASSWORD_MAX) out.push("length");
  if (!UPPER.test(v)) out.push("upper");
  if (!LOWER.test(v)) out.push("lower");
  if (!SYMBOL.test(v)) out.push("symbol");
  return out;
}

export type PasswordCheck = { ok: true; value: string } | { ok: false; missing: PasswordPart[] };

/** 新しいパスワードを確かめる。合えば NFC にそろえた値、違えば足りない物。文字列でなければ全部足りない */
export function checkPassword(raw: unknown): PasswordCheck {
  if (typeof raw !== "string") return { ok: false, missing: [...PASSWORD_PARTS] };
  const missing = passwordProblems(raw);
  return missing.length === 0 ? { ok: true, value: raw.normalize("NFC") } : { ok: false, missing };
}

/** 断りの言葉（「条件不足 大文字 記号」）。足りない物を決まりの順に */
export function passwordProblemLabel(missing: readonly PasswordPart[]): string {
  const parts = PASSWORD_PARTS.filter((p) => missing.includes(p)).map((p) => PASSWORD_RULE_LABELS[p]);
  return [PASSWORD_RULE_LABELS.short, ...parts].join(" ");
}
