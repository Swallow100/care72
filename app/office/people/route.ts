import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { outcomeResponse } from "@/lib/disaster/http";
import { peoplePost } from "@/lib/office/http";

// 担当の割当（担当を変える）・一覧から外す・一覧に戻す（フォームの POST、docs/tasks/T30.md）。
// ケアマネの役だけ（管理者でなくても）。本人と新しい担当は同じ事業所だけ。本人の経過と事業所の経過に 1 行。
// 事業所の画面（担当の表）か担当一覧（外した人の畳み）へ 303 で戻す。行政・医療班・本人・家族は 403、ログインしていなければ 401
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(request, await peoplePost(env.DB, principal, form, new Date().toISOString()));
}
