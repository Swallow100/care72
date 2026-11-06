import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse } from "@/lib/custody/http";
import { withdrawRequestPost } from "@/lib/custody/request-http";

// 受入依頼を下げる（docs/tasks/T163.md）。ケアマネの役だけ。依頼中だけ
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await withdrawRequestPost(env.DB, principal, raw, new Date().toISOString()));
}
