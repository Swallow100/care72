// 通知（T149）の画面の言葉。ケアマネの画面は 2〜4 字の漢語。本人・家族の画面の言葉は lib/phone/labels.ts（やさしい日本語）。

export const PUSH_LABELS = {
  /** 担当一覧の行の詳細のボタン（本人・家族のスマホへ「大丈夫ですか」を送る） */
  safety: "安否確認",
  notify: "通知",
  /** 送った数（「送信 2」） */
  sent: "送信",
  /** 通知を許可した端末が無い */
  none: "通知先なし",
  /** 鍵（VAPID）が env に無い */
  notConfigured: "未設定",
  /** 1 分の間に 2 度目 */
  wait: "送信済 待機",
  /** 災害モードでない（平時は本人・家族の頁にボタンが無い） */
  normal: "平時 不可",
  /** 全部の送り先が断った・届かなかった */
  failed: "送信失敗",
  forbidden: "権限なし",
  notFound: "対象なし",
  loginRequired: "ログイン要",
  invalid: "入力不正",
} as const;

/** 経過の本文（本人の経過の 1 行。kind は note、payload の source は push） */
export const PUSH_LOG = { safety: "安否確認 通知" } as const;
