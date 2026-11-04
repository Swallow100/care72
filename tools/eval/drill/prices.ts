// 評価の台（docs/tasks/T108.md）の費用の見積もり。100 万 token あたりのドル（Anthropic の API の表、2026-10 時点の skill claude-api の表）。
// 入力は cache の書き込み・読み込みも入力の単価で数える（lib/claude/call.ts の usedTokens が足し合わせて ai_calls に残すため。
// cache の読み込みが多いと高めに出る）。Haiku 5.5 は入力 10 万 token までの単価。世界の部屋（Managed Agents）は ai_calls に token が
// 残らない（lib/drill/world-room.ts）ので見積もりの外（session の上限は 1 訓練 $3）。

export const PRICES_USD_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

/** 世界の部屋の 1 session の予算の上限（ドル。lib/drill/world-room.ts の WORLD_BUDGET_CENTS） */
export const ROOM_BUDGET_USD = 3;

/** 1 回の呼び出しの費用（ドル）。知らないモデル・token の無い物は null */
export function costUsd(model: string | null | undefined, inputTokens: number | null | undefined, outputTokens: number | null | undefined): number | null {
  if (!model || inputTokens == null || outputTokens == null) return null;
  const p = PRICES_USD_PER_MTOK[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
