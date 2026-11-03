// AI の今の状態を読む所（サーバー）。鍵の有無（lib/claude/client.ts）と今日の回数（ai_calls、lib/claude/usage.ts）を合わせる。
// 鍵が無ければ回数は読まない（「AI 残り 200 / 200」と出さない。T76）。回数が読めなければ使えるとし、残りは出さない（開始を止めない）。
// 配信先は lib/claude/cloudflare.ts の aiStatusFor がこれを呼ぶ。テストは node:sqlite の ai_calls で呼ぶ。

import { hasAnthropicKey } from "./client.ts";
import { aiStatusOf, type AiStatus } from "./status.ts";
import { usageToday, type AiContext } from "./usage.ts";

export async function readAiStatus(ctx: AiContext): Promise<AiStatus> {
  if (!hasAnthropicKey(ctx.env)) return aiStatusOf(false, null);
  const usage = await usageToday(ctx).catch((e: unknown) => {
    console.error("AI の回数を読めない", e instanceof Error ? e.name : typeof e);
    return null;
  });
  return aiStatusOf(true, usage);
}
