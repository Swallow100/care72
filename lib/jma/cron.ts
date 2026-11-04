// 5 分ごとに気象庁の防災情報 XML を取って D1 に写す（T72）。Workers の cron（wrangler.jsonc の triggers）から worker.ts の scheduled が呼ぶ。
// 毎日 4 時のデモの戻し（lib/seed/cron.ts の scheduledReset）と並べて呼び、cron の文字が違えばどちらも何もしない（null）。
// 手元の next dev では cron は動かない（画面は npm run jma:fetch-local で fixtures を写して見る）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Fetcher } from "./feed.ts";
import { fetchJma, type FeedRun } from "./run.ts";

/** 5 分ごと。wrangler.jsonc の triggers.crons と同じ文字にする（テストが見る） */
export const JMA_FETCH_CRON = "*/5 * * * *";

export type JmaEnv = { DB: D1Database };

/** cron の 1 回。5 分ごとの物でなければ何もしない（null）。scheduledTime は予定の時刻 */
export async function scheduledJmaFetch(
  env: JmaEnv,
  cron: string,
  scheduledTime: number,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<FeedRun[] | null> {
  if (cron !== JMA_FETCH_CRON) return null;
  const now = new Date(scheduledTime).toISOString();
  const runs = await fetchJma(env.DB, fetcher, now);
  console.log(
    "気象庁",
    now,
    runs.map((r) => `${r.feed} ${r.status} 写 ${r.stored} 読めない ${r.unreadable} 失敗 ${r.failed} 残 ${r.deferred}${r.note ? ` ${r.note}` : ""}`).join(" / "),
  );
  return runs;
}
