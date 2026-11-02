import { principalFromRequest } from "@/lib/auth/server";
import { recordingGet, type RecordingReader } from "@/lib/list/recording";

type Ctx = { params: Promise<{ signal: string }> };

// 録音の再生（担当一覧の行の詳細の音声）。信号の録音を R2 から読んで返す。壁は本人のページと同じ（範囲の外は 404）
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { signal } = await params;
  const bucket: RecordingReader = {
    get: (key, options) => env.RECORDINGS.get(key, options),
    head: (key) => env.RECORDINGS.head(key),
  };
  return recordingGet(env.DB, bucket, principal, signal, request.headers.get("range"));
}
