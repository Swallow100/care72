// 訓練記録の画面（app/drill/page.tsx）の開始の欄を、事業所の AI の 1 日の上限（lib/claude/usage.ts）で切り替える（docs/tasks/T26.md）。
// 上限に達したら「開始」でなく、終わった訓練の「再生」（Claude を呼ばない。0 時間から刻みごとに見る）と「本日の上限」。
// 残りの回数はいつも出す。使った回数が読めない（読込失敗）ときは開始のまま（止めない）。画面に触らない（テストで呼ぶ）。

import type { DrillStatus } from "../db/types.ts";
import type { AiStatus } from "./status.ts";

export type DailyUsage = { used: number; limit: number };

export type DrillGate =
  | { kind: "start"; remaining: number | null; limit: number | null }
  /** 上限に達した。replay は再生する終わった訓練（無ければ null） */
  | { kind: "limit"; remaining: 0; limit: number; replay: string | null };

/** 一覧の新しい順の訓練から、上限のときに再生する物（いちばん新しい終わった訓練） */
export function drillGate(
  usage: DailyUsage | null,
  items: ReadonlyArray<{ id: string; status: DrillStatus }>,
): DrillGate {
  if (!usage) return { kind: "start", remaining: null, limit: null };
  const remaining = Math.max(usage.limit - usage.used, 0);
  if (remaining > 0) return { kind: "start", remaining, limit: usage.limit };
  const finished = items.find((d) => d.status === "finished") ?? null;
  return { kind: "limit", remaining: 0, limit: usage.limit, replay: finished?.id ?? null };
}

/**
 * AI の今の状態（lib/claude/status.ts）から、drillGate に渡す今日の回数。未設定・読めないは null（開始のまま。鍵が無くても
 * 固定の筋は想定の表で進むので止めない。T76）。上限到達は使い切った形にする
 */
export function gateUsage(s: AiStatus | null): DailyUsage | null {
  if (!s) return null;
  if (s.kind === "limit") return { used: s.limit, limit: s.limit };
  if (s.kind === "ready" && s.remaining !== null && s.limit !== null) return { used: s.limit - s.remaining, limit: s.limit };
  return null;
}
