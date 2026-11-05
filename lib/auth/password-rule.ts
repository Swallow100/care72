// 人が自分で決めるパスワードの決まり（1 か所。T149）。事業所・ケアマネの ID とパスワードの決まり（T148）と同じ中身:
// 10 字以上（64 字まで）、英字の大文字・小文字・記号をそれぞれ 1 つ以上。NFC にそろえてから数える。
// T148 が同じ決まりを別の名前で作っていたら、取り込みでどちらか 1 つにそろえる（ここを使う所は本人・家族のスマホの ID 作り〔lib/phone/account.ts〕）。
// 平文は表・経過・ログ・URL・応答に出さない。

export const PASSWORD_RULE_MIN = 10;
export const PASSWORD_RULE_MAX = 64;

/** 足りない物: 長さ・大文字・小文字・記号 */
export const PASSWORD_RULE_PROBLEMS = ["length", "upper", "lower", "symbol"] as const;
export type PasswordRuleProblem = (typeof PASSWORD_RULE_PROBLEMS)[number];

/** 画面の言葉（2〜4 字。ケアマネの画面と同じ） */
export const PASSWORD_RULE_LABELS: Record<PasswordRuleProblem, string> = {
  length: `${PASSWORD_RULE_MIN}字以上`,
  upper: "大文字",
  lower: "小文字",
  symbol: "記号",
};

/** 記号: ASCII の英数字と空白でない、見える 1 字（! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~） */
const SYMBOL = /[!-/:-@[-`{-~]/;

/** 決まりに足りない物の一覧（空なら通る）。NFC にそろえてから見る */
export function passwordRuleProblems(raw: string): PasswordRuleProblem[] {
  const v = raw.normalize("NFC");
  const out: PasswordRuleProblem[] = [];
  if (v.length < PASSWORD_RULE_MIN || v.length > PASSWORD_RULE_MAX) out.push("length");
  if (!/[A-Z]/.test(v)) out.push("upper");
  if (!/[a-z]/.test(v)) out.push("lower");
  if (!SYMBOL.test(v)) out.push("symbol");
  return out;
}

export function meetsPasswordRule(raw: string): boolean {
  return passwordRuleProblems(raw).length === 0;
}
