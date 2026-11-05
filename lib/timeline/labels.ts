// 経過の撤回（docs/tasks/T63.md）の画面の言葉と断り。画面（client の部品）からも読むので、ここは D1 に触らない。
// 書き足しの言葉（lib/consent/labels.ts の COMPOSER_LABELS）と、フォームの「取消」（lib/labels.ts の OFFICE_LABELS.cancel）と分ける。

import { DIALOG_LABELS } from "../ui/labels.ts";

export const RETRACT_LABELS = {
  /** 行の右の小さなボタン（開く）と、開いた欄の確定（赤の文字） */
  open: "撤回",
  confirm: "撤回",
  /** 開いた欄を閉じる。ほかの確認の窓（components/ui の Dialog）と同じ「取消」（T78。前はここだけ「戻る」） */
  cancel: DIALOG_LABELS.cancel,
  /** 理由の欄の名前と placeholder（任意） */
  note: "理由",
  sending: "送信中",
  /** 撤回した行の 2 行目の頭「撤回 山本 11/3 22:10 理由」 */
  done: "撤回",
  /** 撤回した人の名前が無い（アカウントを消した）とき */
  unknown: "不明",
} as const;

/** 撤回の断り（API の error と、画面に出す言葉） */
export const RETRACT_ERRORS = ["login_required", "forbidden", "invalid", "too_long", "not_found", "not_retractable", "already"] as const;
export type RetractError = (typeof RETRACT_ERRORS)[number];

export const RETRACT_ERROR_LABELS: Record<RetractError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  invalid: "入力不正",
  too_long: "理由 超過",
  not_found: "該当なし",
  not_retractable: "撤回不可",
  already: "撤回済",
};

export const RETRACT_ERROR_STATUS: Record<RetractError, number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  too_long: 400,
  not_found: 404,
  not_retractable: 409,
  already: 409,
};

/** 送信の失敗（通信） */
export const RETRACT_FAILED = "送信失敗";

/**
 * 本人のページの経過と変更履歴の畳み（T143）。経過は人が書き足す記録、変更履歴は台帳を直した跡（lib/timeline/history.ts）。
 * 閉じた時は件数と最後の 1 行、押すと全部（畳む）
 */
export const FOLD_LABELS = {
  history: "変更履歴",
  /** 経過の行が無いとき（平時の多くの人） */
  empty: "記録なし",
  /** 閉じた畳みのボタン「3 件」（見出しと並んで「経過 3 件」） */
  count: (n: number) => `${n} 件`,
  close: "畳む",
  /** 前と後の値の無い欄（位置・経路地図は数を見せない）の「避難先1 位置 変更」 */
  changed: "変更",
  /** 前か後が空の欄の言葉（足した物・外した物） */
  none: "なし",
} as const;
