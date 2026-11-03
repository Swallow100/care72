import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillError, undoPost } from "@/lib/drill/http";

type Ctx = { params: Promise<{ id: string }> };

// 最後の手を 1 つ取り消す（{ step: 読んだ今の刻み, actions: 読んだ手の数 }、docs/tasks/T59.md）。
// 刻みを越えなかった手だけ（越えた手は本人役・監督の呼びが済んでいて戻せない → 409 取消不可）。Claude を呼ばない
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return undoPost(env.DB, principal, id, json);
}
