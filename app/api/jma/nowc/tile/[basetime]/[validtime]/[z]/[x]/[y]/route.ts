import { getCloudflareContext } from "@opennextjs/cloudflare";
import { principalFromRequest } from "@/lib/auth/server";
import { defaultCache, nowcastOn, tileResponse } from "@/lib/jma/nowcast";

type Params = { basetime: string; validtime: string; z: string; x: string; y: string };

// 雨雲（降水ナウキャスト）のタイルの PNG（T72 の 4）。旗 JMA_NOWCAST が "on" のときだけ（off ならログインも見ずに 404）。中身は lib/jma/nowcast.ts。
// Workers が気象庁のタイルを取り、Cache API で 5 分写す。ズームは 5〜10、時刻は一覧にある物だけ（それ以外は 404）。画像は加工しない
export async function GET(request: Request, { params }: { params: Promise<Params> }) {
  const { env } = await getCloudflareContext({ async: true });
  if (!nowcastOn(env)) return new Response("", { status: 404 });
  const { principal } = await principalFromRequest(request);
  return tileResponse(await params, { on: true, authed: principal !== null, fetcher: (u, i) => fetch(u, i), cache: defaultCache() });
}
