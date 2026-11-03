// 書き出しの道と言葉（T62）。担当一覧・受け持ちの画面（入口のボタン）と route・頁が読む。D1 を使わない（ブラウザも読める）。

/** 担当一覧の CSV（今の並びと絞込の query を付けて開く） */
export const CASELOAD_CSV_PATH = "/caseload/csv";
/** 本人の 1 枚の一括印刷（今の並びと絞込の query、すぐ印刷なら print=1） */
export const OWN_SHEETS_PATH = "/caseload/own-sheets";
/** 受け持ちの CSV（全員、表の順） */
export const STAFF_CSV_PATH = "/staff/csv";

/** 画面の言葉（CSV は様式 9 と同じ字） */
export const EXPORT_LABELS = {
  csv: "CSV出力",
  batchPrint: "一括印刷",
  /** 一括印刷で範囲の外・同意で開けず飛ばした人 */
  skipped: "飛ばし",
} as const;
