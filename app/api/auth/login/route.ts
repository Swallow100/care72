import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin, seeOther, sessionCookie } from "@/lib/auth/cookie";
import { guardedLogin, requestIp, wantsPage } from "@/lib/auth/lockout";
import { nowSec, sessionSecret } from "@/lib/auth/session";

// ログインのフォームの POST。合えば cookie を付けて役の入口へ、違えば /login?e=1 に戻す（どこが違うかは言わない）。
// 同じ ID か同じ送信元で 15 分に 10 回失敗したら 15 分止める（lib/auth/lockout.ts）。止めている間はパスワードを確かめず、
// フォームからは /login?e=locked&m=<残りの分> へ 303、ほか（fetch・curl）は 429 と Retry-After。
// ID・パスワードはログに出さない。
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { env } = await getCloudflareContext({ async: true });
  const secret = sessionSecret(env);
  const form = await request.formData().catch(() => null);
  const field = (name: string) => {
    const v = form?.get(name);
    return typeof v === "string" ? v : "";
  };
  const r = await guardedLogin(
    env.DB,
    env,
    secret,
    { loginId: field("id"), password: field("password"), ip: requestIp(request.headers) },
    nowSec(),
  );
  if (r.kind === "ok") return seeOther(request, r.path, sessionCookie(r.token, request.url));
  if (r.kind === "failed") return seeOther(request, "/login?e=1");
  if (wantsPage(request.headers)) return seeOther(request, `/login?e=locked&m=${r.minutes}`);
  return Response.json(
    { error: "too_many_attempts" },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec), "Cache-Control": "no-store" } },
  );
}
