// AI（Claude）の今の状態: 未設定（鍵なし）・上限到達（事業所の 1 日の上限）・使える（今日の残り）。
// どの画面も同じ言葉で出すために、状態の形と言葉はここ 1 か所に置く（T76。docs/progress/qa-20261104.md の高 2・中 13）。
// 読むのは lib/claude/status-read.ts（鍵と ai_calls）と lib/claude/cloudflare.ts の aiStatusFor（配信先）。描くのは components/ui/AiStatus.tsx。
// ここは client の部品も読むので、SDK（lib/claude/client.ts）を import しない。
// 印は状態の 4 色（無事・至急・要確認・不明）を使わない中立の印（CLAUDE.md の意味色。AI の状態は人の安否ではない）。

/** AI の今の状態。ready の残りと上限は、使った回数を読めなければ null */
export type AiStatus =
  | { kind: "unset" }
  | { kind: "limit"; limit: number }
  | { kind: "ready"; remaining: number | null; limit: number | null };

/** AI の状態と、止まった理由の言葉（2〜4 字）。講評・入れる欄・分類・訓練の帯で同じ */
export const AI_STATUS_LABELS = {
  ai: "AI",
  unset: "未設定",
  limit: "上限到達",
  /** 「AI 本日残り 37 / 200 回」 */
  remaining: "本日残り",
  unit: "回",
  stop: "停止",
  /** 呼び出しの失敗（時間切れ・API の失敗） */
  failed: "接続失敗",
  /** 返った物が使えない（形の違い・断られた・伏せきれない） */
  badOutput: "出力不良",
} as const;

/** 鍵の有無と今日の回数から。上限に達していれば（0 の上限も）limit */
export function aiStatusOf(hasKey: boolean, usage: { used: number; limit: number } | null): AiStatus {
  if (!hasKey) return { kind: "unset" };
  if (!usage) return { kind: "ready", remaining: null, limit: null };
  const remaining = Math.max(usage.limit - usage.used, 0);
  return remaining > 0 ? { kind: "ready", remaining, limit: usage.limit } : { kind: "limit", limit: usage.limit };
}

/** 呼べるか（未設定・上限到達でない） */
export function aiUsable(s: AiStatus): boolean {
  return s.kind === "ready";
}

/** 今日の残り（未設定・上限到達は 0、読めなければ null）。見込みと比べる所（lib/drill/estimate.ts の overLimit）に */
export function aiRemaining(s: AiStatus): number | null {
  return s.kind === "ready" ? s.remaining : 0;
}

/** 使えないときの理由の言葉（「未設定」「上限到達」）。使えるなら null */
export function aiBlockReason(s: AiStatus): string | null {
  if (s.kind === "unset") return AI_STATUS_LABELS.unset;
  if (s.kind === "limit") return AI_STATUS_LABELS.limit;
  return null;
}

/** 1 行の言い方: 「AI 未設定」「AI 上限到達」「AI 本日残り 37 / 200 回」（残りが読めなければ「AI」だけ） */
export function aiStatusText(s: AiStatus): string {
  const L = AI_STATUS_LABELS;
  const reason = aiBlockReason(s);
  if (reason) return `${L.ai} ${reason}`;
  if (s.kind === "ready" && s.remaining !== null && s.limit !== null) return `${L.ai} ${L.remaining} ${s.remaining} / ${s.limit} ${L.unit}`;
  return L.ai;
}

/** 止まった理由（講評・入れる欄の API の誤りの種類から）。lib/drill/review.ts の ReviewError と同じ並び */
export type AiFailure = "not_configured" | "limit" | "refused" | "bad_output" | "failed" | "leak";

/** 止まった理由の言葉。未設定・上限到達・接続失敗・出力不良の 4 つにまとめる */
export const AI_FAILURE_LABELS: Record<AiFailure, string> = {
  not_configured: AI_STATUS_LABELS.unset,
  limit: AI_STATUS_LABELS.limit,
  refused: AI_STATUS_LABELS.badOutput,
  bad_output: AI_STATUS_LABELS.badOutput,
  failed: AI_STATUS_LABELS.failed,
  leak: AI_STATUS_LABELS.badOutput,
};
