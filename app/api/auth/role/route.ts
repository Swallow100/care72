import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin, readCookie, seeOther, SESSION_COOKIE, sessionCookie } from "@/lib/auth/cookie";
import { chooseRole, chooseSandbox, chooseSandboxRole } from "@/lib/auth/principal";
import { isJudgeSessionRole, parseSandboxChoice, ROLE_SELECT_PATH, SANDBOX_CHOICE } from "@/lib/auth/roles";
import { nowSec, sessionSecret } from "@/lib/auth/session";

// 役を選ぶ・選び直す（審査員と、見本のケアマネの山本。T95）。役を選べるセッションでなければ 403。
// 審査員の「新規事業所」（T115）は試用事業所を作るか、このセッションの試用事業所へ戻る。作れる数の上限なら役選択の画面に「上限到達」。
// 新規事業所の中の役（T180、sandbox:self:<id> など）は、相手がこのセッションの試用事業所の中かを確かめてから替える（外なら 403）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const form = await request.formData().catch(() => null);
  const role = form?.get("role");
  const target = parseSandboxChoice(role);
  if (target) {
    const { env } = await getCloudflareContext({ async: true });
    const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
    const r = await chooseSandboxRole(env.DB, env, sessionSecret(env), token, target, nowSec());
    if (!r) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
    return seeOther(request, r.path, sessionCookie(r.token, request.url));
  }
  if (!isJudgeSessionRole(role)) return seeOther(request, ROLE_SELECT_PATH);
  const { env } = await getCloudflareContext({ async: true });
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (role === SANDBOX_CHOICE) {
    const s = await chooseSandbox(env.DB, env, sessionSecret(env), token, nowSec(), new Date().toISOString());
    if (!s.ok && s.error === "limit") return seeOther(request, `${ROLE_SELECT_PATH}?sandbox=limit`);
    if (!s.ok) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
    return seeOther(request, s.path, sessionCookie(s.token, request.url));
  }
  const r = await chooseRole(env.DB, env, sessionSecret(env), token, role, nowSec());
  if (!r) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
  return seeOther(request, r.path, sessionCookie(r.token, request.url));
}
