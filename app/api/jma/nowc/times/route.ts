import { getCloudflareContext } from "@opennextjs/cloudflare";
import { principalFromRequest } from "@/lib/auth/server";
import { defaultCache, nowcastOn, timesResponse } from "@/lib/jma/nowcast";

// 雨雲（降水ナウキャスト）の一番新しい実況の時刻（T72 の 4）。旗 JMA_NOWCAST が "on" のときだけ。中身は lib/jma/nowcast.ts。
// Workers がここで気象庁の時刻の一覧を取り、Cache API で 2 分写す（各ブラウザから気象庁を読まない）。旗が off ならログインも見ずに 404
export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  if (!nowcastOn(env)) return new Response("", { status: 404 });
  const { principal } = await principalFromRequest(request);
  return timesResponse({ on: true, authed: principal !== null, fetcher: (u, i) => fetch(u, i), cache: defaultCache() });
}
