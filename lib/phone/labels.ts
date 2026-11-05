// 本人・家族のスマホの準備（ID・ホーム画面・通知）の言葉（T149）。本人・家族の画面はやさしい日本語（{漢字|よみ}。lib/forms/easy-words.ts の easy）。
// ケアマネの画面（本人のページのスマホの面）は 2〜4 字の漢語（PHONE_SECTION_LABELS）。

import { PASSWORD_RULE_MIN, type PasswordRuleProblem } from "../auth/password-rule.ts";
import type { PhoneAccountError } from "./account.ts";

/** 本人・家族の頁の上の準備の欄 */
export const SETUP_EASY = {
  /** 欄の題 */
  title: "{準備|じゅんび}",
  done: "{済|す}み",
  todo: "まだ",
  /** 3 つの段の名前（済み・まだ の印の横） */
  stepAccount: "ID",
  stepInstall: "ホーム{画面|がめん}",
  stepNotify: "{通知|つうち}",
  close: "{閉|と}じる",
  // ID の段
  accountLead: "ID と パスワードを {作|つく}ると {別|べつ}の スマホからも {入|はい}れます",
  loginId: "ID（{英字|えいじ}・{数字|すうじ}）",
  password: `パスワード（${PASSWORD_RULE_MIN}{字|じ} {以上|いじょう}・{大文字|おおもじ}・{小文字|こもじ}・{記号|きごう}）`,
  password2: "もう {一度|いちど}",
  create: "{作|つく}る",
  /** ID の段を後に回す（この表示の間だけ） */
  later: "{後|あと}で",
  sending: "{送|おく}っています",
  /** 作ったあと（ID を見せる） */
  made: "ID",
  // 通知の段
  notifyLead: "{災害|さいがい}の とき「{大丈夫|だいじょうぶ}ですか」と {知|し}らせます",
  allow: "{通知|つうち}を {許可|きょか}",
  /** iPhone はホーム画面から開いた時だけ通知を許可できる */
  notifyFromHome: "ホーム{画面|がめん}から {開|ひら}いて ください",
  /** 端末の設定で断ってある */
  denied: "{設定|せってい}で {通知|つうち}を {許可|きょか}して ください",
  /** このブラウザに通知が無い */
  unsupported: "この ブラウザでは {通知|つうち}できません",
  /** 鍵（VAPID）が無い配信 */
  notConfigured: "{通知|つうち} {未設定|みせってい}",
  failed: "{失敗|しっぱい}しました もう {一度|いちど}",
} as const;

/** ID 作りの断りの言葉（やさしい日本語） */
const ACCOUNT_ERROR_EASY: Record<PhoneAccountError, string> = {
  login_required: "もう {一度|いちど} リンクを {開|ひら}いて ください",
  forbidden: "ここでは {作|つく}れません",
  consent: "{同意|どうい}が ありません ケアマネに {連絡|れんらく}",
  not_found: "もう {一度|いちど} リンクを {開|ひら}いて ください",
  login_id: "ID は {英字|えいじ}・{数字|すうじ}で 3{字|じ}から",
  login_taken: "その ID は {使|つか}えません",
  password: "パスワードが {足|た}りません",
  mismatch: "2つの パスワードが {違|ちが}います",
};

const RULE_EASY: Record<PasswordRuleProblem, string> = {
  length: `${PASSWORD_RULE_MIN}{字|じ} {以上|いじょう}`,
  upper: "{大文字|おおもじ}",
  lower: "{小文字|こもじ}",
  symbol: "{記号|きごう}",
};

/** 断りの理由の言葉（パスワードの足りない物は並べて足す） */
export function phoneAccountErrorWords(error: PhoneAccountError, problems?: readonly PasswordRuleProblem[]): string {
  const base = ACCOUNT_ERROR_EASY[error];
  if (error !== "password" || !problems || problems.length === 0) return base;
  return `${base}（${problems.map((p) => RULE_EASY[p]).join("・")}）`;
}

/** 本人のページのスマホの面（ケアマネの画面） */
export const PHONE_SECTION_LABELS = {
  title: "スマホ",
  entry: "入口",
  self: "本人用",
  family: "家族用",
  account: "ID",
  notify: "通知",
  has: "有",
  none: "無",
  /** 同意の決まり（lib/phone/consent.ts）に合わない */
  noConsent: "同意なし",
  /** 詳しい画面（/people/[id]/phone）へ */
  open: "表示",
  expires: "期限",
} as const;
