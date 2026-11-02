import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { modePost, outcomeResponse } from "@/lib/disaster/http";

// 災害モードの切替（フォームの POST）。大雨・地震・平時に戻す（確認の欄から）。切り替えた人と時刻が事業所の経過に残る。
// ケアマネの役だけ（管理者でなくても押せる）。行政・医療班・本人・家族は 403、ログインしていなければ 401
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(request, await modePost(env.DB, principal, form, new Date().toISOString()));
}
