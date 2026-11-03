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
  /** 連絡先のスマホの有無（contacts.has_smartphone が 1） */
  smartphone: "スマホ有",
  /** 台帳の本人のスマホ（basic.contactMeans.smartphone）の欄の名前 */
  ownPhone: "スマホ",
  /** QR の画像の読み上げ（「本人用 QR」） */
  qr: "QR",
  none: "なし",
} as const;

export const PHONE_LINK_STATUS_LABELS: Record<PhoneLinkStatus, string> = { none: "未発行", active: "有効", expired: "期限切れ" };

/** 再発行の確認の窓（lib/ui/dialog.ts の appConfirm。components/ui/SubmitButton の confirm） */
export const PHONE_LINK_CONFIRM = {
  title: "再発行",
  message: "前のリンクは全部無効",
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
} as const;
