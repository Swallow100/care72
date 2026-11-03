// QR の頁と、本人のページの QR の画面の言葉（2〜4 字の漢語。「この QR は医療班が読みます」だけは本人の 1 枚の裏の 1 行）。

import type { QrStatus } from "./store.ts";

export const QR_LABELS = {
  title: "QR",
  /** 経過の種類 */
  view: "QR 閲覧",
  /** 本人の 1 枚の裏の 1 行（docs/tasks/T16.md） */
  blockNote: "この QR は医療班が読みます",
  expires: "期限",
  /** 期限の日数の単位（「90 日」。T64） */
  days: "日",
  generation: "版",
  issue: "作成",
  reissue: "再作成",
  open: "表示",
  invalid: "無効",
  /** ログインせずに開いた人 */
  anonymous: "未ログイン",
  /** 医療班・行政が受け持ちに入れる（T23。受領は物を受け取る言葉なので「受入」） */
  receive: "受入",
  views: "閲覧記録",
  /** 経過の本文: 出した範囲 */
  scopeSummary: "要約（氏名・住所除く）",
  scopeNone: "表示なし",
  scope: "範囲",
  recipient: "相手",
  time: "時刻",
} as const;

export const QR_STATUS_LABELS: Record<QrStatus, string> = { none: "未作成", active: "有効", expired: "期限切れ" };
