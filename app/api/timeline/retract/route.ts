import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { retractFail, retractTimelineRequest } from "@/lib/timeline/retract";
import { jsonResponse } from "@/lib/timeline/write";

// 経過の撤回（docs/tasks/T63.md）。行は消さず、誰が・いつ・理由を行に持つ（本人のページに取り消し線で残る）。
// 撤回できるのは人が書いた行（書き足しの 6 種類と電話の記録）だけで、書いた本人と、事業所のケアマネ（ケアマネの書いた行）。
// 同じ所からの POST だけ。理由は Claude にも声にも渡さない（D1 に入れるだけ）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(retractFail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await retractTimelineRequest(env.DB, principal, raw, new Date().toISOString()));
}
