import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { classifySignal } from "@/lib/classify/store";
import { recordingPost, signalError } from "@/lib/signals/http";

// 本人のスマホの録音と文字起こし（20 秒操作が無いときに録った物）。先に送った自分の信号に 1 回だけ添える。
// 音声は R2（recordings/<事業所>/<本人>/<時刻>.webm）、鍵と文字起こしは信号の行に。
// 初めて添えたときだけ、分類（T12、Haiku 1 回）を応答のあとに走らせる（waitUntil。本人のスマホを待たせない）。
// 分類は投げない（失敗・未設定・上限は信号の ai_error に残り、色は答えだけで決まる）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  const { ctx } = await getCloudflareContext({ async: true });
  return recordingPost(env.DB, env.RECORDINGS, principal, form, new Date().toISOString(), {
    afterAttach: (a) => {
      ctx.waitUntil(
        classifySignal(
          env.DB,
          { officeId: a.officeId, personId: a.personId, signalId: a.signalId, audio: { durationSec: a.durationSec, silenceRatio: null } },
          { ai: () => aiContextFor(a.officeId), now: () => new Date().toISOString() },
        ).catch((e) => console.error("分類を書けない", e instanceof Error ? e.name : typeof e)),
      );
    },
  });
}
