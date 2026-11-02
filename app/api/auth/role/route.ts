import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin, readCookie, seeOther, SESSION_COOKIE, sessionCookie } from "@/lib/auth/cookie";
import { chooseJudgeRole } from "@/lib/auth/principal";
import { isJudgeRole, ROLE_SELECT_PATH } from "@/lib/auth/roles";
import { nowSec, sessionSecret } from "@/lib/auth/session";

// 審査員が役を選ぶ・選び直す。審査員のセッションでなければ 403
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const form = await request.formData().catch(() => null);
  const role = form?.get("role");
  if (!isJudgeRole(role)) return seeOther(request, ROLE_SELECT_PATH);
  const { env } = await getCloudflareContext({ async: true });
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const r = await chooseJudgeRole(env.DB, env, sessionSecret(env), token, role, nowSec());
  if (!r) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
  return seeOther(request, r.path, sessionCookie(r.token, request.url));
}
