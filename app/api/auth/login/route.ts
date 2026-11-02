import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin, seeOther, sessionCookie } from "@/lib/auth/cookie";
import { login } from "@/lib/auth/principal";
import { nowSec, sessionSecret } from "@/lib/auth/session";

// ログインのフォームの POST。合えば cookie を付けて役の入口へ、違えば /login?e=1 に戻す（どこが違うかは言わない）。
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
  const r = await login(env.DB, env, secret, { loginId: field("id"), password: field("password") }, nowSec());
  if (!r.ok) return seeOther(request, "/login?e=1");
  return seeOther(request, r.path, sessionCookie(r.token, request.url));
}
