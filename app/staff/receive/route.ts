import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { qrReceivePost } from "@/lib/custody/http";
import { outcomeResponse } from "@/lib/disaster/http";

// QR の頁（/q/<token>）の「受入」（フォームの POST: token・shelter。docs/tasks/T23.md）。
// 本人の id はフォームに載せず、トークンを引き直す（署名・期限・今の版）。受け入れたら受け持ちの一覧（/staff）へ。
// 行政・医療班だけ。ログインしていなければ 401、ほかの役は 403
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return outcomeResponse(
    request,
    await qrReceivePost(env.DB, principal, form, { secret: sessionSecret(env), nowSec: nowSec(), at: new Date().toISOString() }),
  );
}
