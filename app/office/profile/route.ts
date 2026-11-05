import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { outcomeResponse } from "@/lib/disaster/http";
import { profilePost } from "@/lib/office/profile";

// 事業所の情報（名称・所在地・電話・FAX・事業所番号、T148）の保存（フォームの POST）。同じ所からの要求か・ログイン・権限・形の順に断る。
// 書けるのは地域と同じ人（事業所の管理者と試用事業所の審査員。デモ事業所の審査員は 403）。ログインしていなければ 401
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(request, await profilePost(env.DB, principal, form));
}
