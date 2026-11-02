import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { outcomeResponse } from "@/lib/disaster/http";
import { resetPost } from "@/lib/seed/http";

// デモ事業所の「最初に戻す」（フォームの POST、確認の欄から）。デモ事業所の審査員（ケアマネの役）と管理者だけ。
// 協力事業所など別の事業所には効かない。経過には残さない（docs/tasks/T26.md）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(request, await resetPost(env.DB, env.RECORDINGS, principal, form, new Date().toISOString()));
}
