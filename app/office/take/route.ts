import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { takePost } from "@/lib/custody/http";
import { outcomeResponse } from "@/lib/disaster/http";

// 所属なしの人の「引受」（フォームの POST: person。docs/tasks/T23.md）。自分の事業所・自分の担当に移す。
// 本人の経過「引受 山本」と事業所の経過に 1 行。ケアマネの役だけ（管理者でなくても）。事業所の画面の所属なしの区分へ 303
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(request, await takePost(env.DB, principal, form, new Date().toISOString()));
}
