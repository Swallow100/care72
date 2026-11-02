import { principalFromRequest } from "@/lib/auth/server";
import { recordingScopeRefusal } from "@/lib/consent/recording";
import { recordingGet, type RecordingReader } from "@/lib/list/recording";

type Ctx = { params: Promise<{ signal: string }> };

// 録音の再生（担当一覧の行の詳細の音声）。信号の録音を R2 から読んで返す。壁は本人のページと同じ（範囲の外は 404）。
// 同意の範囲（T24、lib/consent/scope.ts）に録音の無い役（医療班・行政・家族）は、受け持ち・自分の本人でも 404
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { signal } = await params;
  const refused = await recordingScopeRefusal(env.DB, principal, signal);
  if (refused) return refused;
  const bucket: RecordingReader = {
    get: (key, options) => env.RECORDINGS.get(key, options),
    head: (key) => env.RECORDINGS.head(key),
  };
  return recordingGet(env.DB, bucket, principal, signal, request.headers.get("range"));
}
