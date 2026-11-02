import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { recordingPost, signalError } from "@/lib/signals/http";

// 本人のスマホの録音と文字起こし（20 秒操作が無いときに録った物）。先に送った自分の信号に 1 回だけ添える。
// 音声は R2（recordings/<事業所>/<本人>/<時刻>.webm）、鍵と文字起こしは信号の行に。分類（T12）はここでしない
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  return recordingPost(env.DB, env.RECORDINGS, principal, form, new Date().toISOString());
}
