import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { infoPost, outcomeResponse } from "@/lib/disaster/http";

// 災害の情報の保存（フォームの POST）。発災・停電（範囲と開始時刻）・警戒レベル・断水・道路。変わった所が事業所の経過に残る。
// ケアマネの役だけ。行政・医療班・本人・家族は 403、ログインしていなければ 401
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(request, await infoPost(env.DB, principal, form, new Date().toISOString()));
}
