// AI の今の状態の印（T76）。どの画面も同じ言葉（lib/claude/status.ts の aiStatusText）で出す:
// 未設定・上限到達は中立の地の印（Mark。状態の 4 色の塗りを使わない。AI の状態は人の安否ではないので、要確認の黄と並べない）、
// 使えるときは薄い文字の「AI 本日残り 37 / 200 回」（残りが読めなければ出さない）。
// 状態を持たない（Server Component でも client の部品の中でも描ける）。

import { aiStatusText, type AiStatus } from "@/lib/claude/status";
import { Mark } from "./Tag";

export function AiStatusMark({ status, inPanel2 = false, size = "sm" }: { status: AiStatus; inPanel2?: boolean; size?: "sm" | "md" }) {
  if (status.kind === "ready") {
    if (status.remaining === null) return null;
    return (
      <span className={`whitespace-nowrap text-muted tabular-nums ${size === "md" ? "text-sm" : "text-xs"}`} data-ai-status="ready" data-ai-remaining={status.remaining}>
        {aiStatusText(status)}
      </span>
    );
  }
  return (
    <span className="font-bold" data-ai-status={status.kind}>
      <Mark inPanel2={inPanel2} size={size}>
        {aiStatusText(status)}
      </Mark>
    </span>
  );
}
