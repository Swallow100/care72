import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillError } from "@/lib/drill/http";
import { callPost } from "@/lib/drill/record-http";

type Ctx = { params: Promise<{ id: string }> };

// 着信の応答・拒否を訓練の記録に残す（{ signal: 着信の安否の id, response: answer・decline }、docs/tasks/T22.md）。
// 着信はこの訓練の物だけ。1 つの着信に 1 回（2 回目は残さない）。採点が読み、赤の着信の拒否は順番の誤りに数える
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return callPost(env.DB, principal, id, json);
}
