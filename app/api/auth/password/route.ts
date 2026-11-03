import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin, readCookie, SESSION_COOKIE, sessionCookie } from "@/lib/auth/cookie";
import { passwordChangeRequest } from "@/lib/auth/password-change";
import { resolvePrincipal } from "@/lib/auth/principal";
import { nowSec, sessionSecret } from "@/lib/auth/session";

// 自分のパスワードの変更（docs/tasks/T61.md）。JSON { current, next }。アカウントのセッションだけ（審査員・山本は 403 固定）。
// 変えるとパスワードの指紋が変わり、ほかの端末のセッションは切れる。この端末は新しい cookie を付け直してログインしたまま。
// パスワードはログに出さない（応答は no-store、本文に token を入れない）
export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!isSameOrigin(request)) return Response.json({ ok: false, error: "forbidden", label: "権限なし" }, { status: 403, headers });
  const { env } = await getCloudflareContext({ async: true });
  const secret = sessionSecret(env);
  const now = nowSec();
  const principal = await resolvePrincipal(env.DB, env, secret, readCookie(request.headers.get("cookie"), SESSION_COOKIE), now);
  const raw = await request.json().catch(() => null);
  const r = await passwordChangeRequest(env.DB, env, secret, principal, raw, now);
  if (r.token) headers.append("Set-Cookie", sessionCookie(r.token, request.url));
  return Response.json(r.body, { status: r.status, headers });
}
