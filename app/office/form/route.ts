import { isSameOrigin, seeOther } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { planFormPost } from "@/lib/forms/plan-form";

// 事業所の「使用様式」（T47）の保存（フォームの POST）。ケアマネの役だけ（管理者でなくても）。
// 行政・医療班・本人・家族は 403、ログインしていなければ 401。候補に無い値（下書き・ほかの事業所の対応表）は画面へ戻して「保存不可」
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  const r = await planFormPost(env.DB, principal, form);
  if (r.status === 303) return seeOther(request, r.location);
  if (r.status === 401) return Response.json({ error: "login_required", label: "ログイン要" }, { status: 401 });
  return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
}
