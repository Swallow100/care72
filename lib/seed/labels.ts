// デモ事業所の「最初に戻す」と、AI の 1 日の上限の画面の言葉（docs/tasks/T26.md）。校正に通す一覧は docs/progress/t26.md。

export const RESET_LABELS = {
  /** 事業所の画面の区分の見出し */
  title: "初期化",
  /** ボタン（確認の欄を開く・確認の欄で戻す） */
  reset: "最初に戻す",
  /** 確認の欄の 1 文 */
  confirm: "訓練記録・信号・経過・追加の利用者と録音は消去",
  cancel: "取消",
  /** 自動で戻す時刻 */
  daily: "毎日 4:00 自動",
  done: "初期化済",
  failed: "初期化失敗",
} as const;

export const LIMIT_LABELS = {
  /** 1 日の上限に達した */
  reached: "本日の上限",
  /** 「AI 残り 37 / 200 回」 */
  ai: "AI",
  remaining: "残り",
  unit: "回",
} as const;
