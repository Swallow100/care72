import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillError } from "@/lib/drill/http";
import { reviewPost } from "@/lib/drill/record-http";

type Ctx = { params: Promise<{ id: string }> };

// 訓練の講評（docs/tasks/T22.md）。{} で作る（Opus 1 回。できていればそれを返す。鍵が無ければ 503 で画面は数字だけ）、
// { edit: { summary, findings: [{ text }] } } でケアマネが直した物を残す（AI の元は残す）
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return reviewPost(env, principal, id, json);
}
