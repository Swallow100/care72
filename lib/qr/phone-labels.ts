// スマホ入口（T69a）の言葉。ケアマネの画面は 2〜4 字の漢語、本人・家族の画面はやさしい日本語（{漢字|よみ}。lib/forms/easy-words.ts の easy）。

import type { PhoneLinkStatus } from "./phone-link-store.ts";

/** ケアマネの画面（本人のページの書類の「スマホ入口」） */
export const PHONE_LINK_LABELS = {
  title: "スマホ入口",
  issue: "発行",
  reissue: "再発行",
  self: "本人用",
  family: "家族用",
  expires: "期限",
  generation: "版",
  invalid: "無効",
  /** 本人の行が一覧から外れている（リンクは通らない。発行もしない） */
  unlisted: "一覧外",
  /**
   * スマホの印の頭。本人は台帳の値（basic.contactMeans.smartphone）、家族は contacts.has_smartphone の 1・0 を
   * 「スマホ 使用可」「スマホ なし」の同じ形で（T77。前は家族だけ「スマホ有」で混ざっていた）
   */
  ownPhone: "スマホ",
  /** QR の画像の読み上げ（「本人用 QR」） */
  qr: "QR",
  none: "なし",
  /** ケアマネ・行政・医療班・審査員のログイン中の端末でリンクを開いたときの 1 枚（設計の答え 11/4） */
  loggedIn: "ログイン中",
  switch: "切替",
  back: "戻る",
} as const;

export const PHONE_LINK_STATUS_LABELS: Record<PhoneLinkStatus, string> = { none: "未発行", active: "有効", expired: "期限切れ" };

/** 再発行の確認の窓（lib/ui/dialog.ts の appConfirm。components/ui/SubmitButton の confirm） */
export const PHONE_LINK_CONFIRM = {
  title: "再発行",
  /** 本人・家族が作った ID（T149）も作った時の版に結び付くので、一緒に通らなくなる */
  message: "前のリンクと ID は全部無効",
  ok: "再発行",
} as const;

/** 発行の API の断りの言葉 */
export const PHONE_LINK_API_LABELS = { forbidden: "権限なし", notFound: "対象なし", unlisted: "一覧外" } as const;

/** 本人・家族の画面の言葉（やさしい日本語の書き方） */
export const PHONE_EASY = {
  /** 平時の印（事業所名の横。「いまは ふだん です」の文にしない） */
  normal: "{普段|ふだん}",
  /** 無効の頁 */
  invalid: "{無効|むこう}",
  callCareManager: "ケアマネに {連絡|れんらく}",
  /** ID とパスワードを作った人（T149）はログインの画面から入れる */
  loginWithId: "ID で ログイン",
} as const;
