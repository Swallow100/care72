import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin } from "@/lib/auth/cookie";
import { sessionSecret } from "@/lib/auth/session";
import { BODY_MAX_BYTES } from "@/lib/survey/form";
import { submitSurvey } from "@/lib/survey/submit";
import { clientIp } from "@/lib/survey/token";
import { turnstileKeys, verifyTurnstile } from "@/lib/survey/turnstile";

type Ctx = { params: Promise<{ token: string }> };

// アンケートの送信（docs/tasks/T42.md）。ログインなしで呼べる API はこれだけ（壁は token。lib/survey/submit.ts の守り）。
// ログインの cookie は読まない。応答はキャッシュさせない。
export async function POST(request: Request, { params }: Ctx) {
  const { token } = await params;
  const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isSameOrigin(request)) return json(403, { ok: false, error: "forbidden" });
  // 本文を読む前に、大きさの申告で断る（読んだあとにも submitSurvey が確かめる）
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > BODY_MAX_BYTES) return json(413, { ok: false, error: "too_large" });

  const { env } = await getCloudflareContext({ async: true });
  const keys = turnstileKeys(env);
  const out = await submitSurvey(env.DB, {
    token,
    contentType: request.headers.get("content-type"),
    body: await request.text(),
    ip: clientIp(request.headers),
    now: new Date(),
    secret: sessionSecret(env),
    turnstile: keys ? { keys, verify: verifyTurnstile } : null,
  });
  return json(out.status, out.body);
}
