// デモ事業所の「最初に戻す」と、AI の 1 日の上限の画面の言葉（docs/tasks/T26.md）。校正に通す一覧は docs/progress/t26.md。

export const RESET_LABELS = {
  /** 事業所の画面の区分の見出し */
  title: "初期化",
  /** ボタン（確認の欄を開く・確認の欄で戻す） */
  reset: "最初に戻す",
  /** 確認の欄の 1 行（戻すと消える物） */
  confirm: "消す項目: 訓練記録・信号・経過・追加の利用者・録音",
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

/** 種の事業所の「発災開始」（T153、lib/seed/start.ts）の言葉 */
export const START_LABELS = {
  /** ボタンと確認の窓の題 */
  start: "発災開始",
  /** 確認の窓の決める方 */
  ok: "開始",
  /** ボタンの横の小さな 1 行と、確認の窓の本文 */
  scene: "想定 大雨",
} as const;

/** 確認の窓の箇条（入る物）。停電の町と本人の名前は種から（lib/seed/demo.ts） */
export function startDetails(towns: readonly string[], redName: string): string[] {
  return [
    "警戒レベル 4",
    `停電 地区（${towns.join("・")}）`,
    `安否 ${redName} 赤・録音`,
    "発災 4 時間前から",
  ];
}
