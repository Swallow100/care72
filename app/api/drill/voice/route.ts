import { principalFromRequest } from "@/lib/auth/server";
import { voiceGet, type VoiceBucket } from "@/lib/drill/voice";

// 訓練の声（docs/tasks/T21.md）。GET /api/drill/voice?drill=<訓練>&signal=<安否の id> か &act=<手の番号>。
// 本人役の言う事（着信・本人の赤の録音・電話に出た人の言葉）を Gemini TTS で声にし、R2 に訓練ごとに置いて返す（2 度目は R2 から）。
// 文は D1 から読み、画面から送られた文は読まない。TTS には仮名化を通した文だけ（氏名・住所・電話を渡さない）。
// ケアマネの役だけ。ログインなし 401・ほかの役 403・形が違う 400・対象なし 404・Gemini の鍵が無い 503（画面は文字だけ）・上限 429・失敗 502
export async function GET(request: Request) {
  const { principal, env } = await principalFromRequest(request);
  const bucket: VoiceBucket = {
    get: (key) => env.RECORDINGS.get(key),
    put: (key, value, options) => env.RECORDINGS.put(key, value, options),
  };
  return voiceGet({ db: env.DB, bucket, env }, principal, new URL(request.url).searchParams);
}
