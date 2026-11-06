import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse } from "@/lib/custody/http";
import { replyRequestPost } from "@/lib/custody/request-http";

// 受入依頼の返事（docs/tasks/T163.md）。医療班の役だけ。受入は今の受け入れ（受け持ち・経過・第三者提供の記録）を通す
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await replyRequestPost(env.DB, principal, raw, new Date().toISOString()));
}
