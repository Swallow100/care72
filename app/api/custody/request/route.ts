import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse } from "@/lib/custody/http";
import { sendRequestPost } from "@/lib/custody/request-http";

// 医療班への受入依頼を送る（docs/tasks/T163.md）。ケアマネの役だけ。医療班への提供に同意のある人だけ（ほかは 403 consent）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await sendRequestPost(env.DB, principal, raw, new Date().toISOString()));
}
