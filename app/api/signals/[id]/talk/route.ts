import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { signalError } from "@/lib/signals/http";
import { TALK_BODY_MAX, talkPost } from "@/lib/signals/talk-http";
import { talkLineVoice } from "@/lib/signals/voice";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Ctx = { params: Promise<{ id: string }> };

// 声の聞き取りの会話（docs/tasks/T137.md）。本人のスマホが 1 往復を聞くたびに、会話の記録の全部を送る（後勝ち）。
// 記録を赤の信号に書き、次の手（決まった問い・AI の 1 文・締め）を返す。Claude（Haiku）は次の 1 文を聞くときだけ 1 回で、
// 本人の台帳から作った鍵で名前・住所・電話を伏せてから。書けるのは自分が送った赤の信号だけ。災害モードの間だけ（平時は 409）
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const text = await request.text().catch(() => "");
  if (text.length > TALK_BODY_MAX) return signalError("too_large");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const { ctx } = await getCloudflareContext({ async: true });
  const officeId = principal?.office?.id ?? null;
  return talkPost(env.DB, principal, id, json, {
    ai: (o) => aiContextFor(o),
    now: () => Date.now(),
    // AI の 1 文の声: 3 秒で間に合わなければ端末の読み上げ。作るのは応答のあとも続けて R2 に置く
    voice: officeId
      ? async (text, key) => talkLineVoice(env.RECORDINGS, text, await aiContextFor(officeId), key, { keep: (p) => ctx.waitUntil(p) })
      : undefined,
  });
}
