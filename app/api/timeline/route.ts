import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse, writeTimelineRequest } from "@/lib/timeline/write";

// 経過の書き足し（docs/tasks/T24.md）。定型（安否確認・診察・配薬・搬送・到着）と自由文を、本人のページの経過に 1 行。
// 誰が・いつ・どの役はサーバーで付ける。ケアマネ・医療班・行政だけ（医療班・行政は受け持ちの間だけ）。
// 書ける種類は同意の範囲（lib/consent/scope.ts）と同じ所で決める。自由文は Claude にも声にも渡さない（D1 に入れるだけ）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await writeTimelineRequest(env.DB, principal, raw, new Date().toISOString()));
}
