import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { outcomeResponse } from "@/lib/disaster/http";
import { placePost } from "@/lib/office/place";

// 事業所の地域（市と地図の中心、T68）の保存（フォームの POST）。同じ所からの要求か・ログイン・管理者・形の順に断る。
// 管理者だけ（審査員のケアマネの役は管理者でないので 403）。ログインしていなければ 401
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(request, await placePost(env.DB, principal, form));
}
