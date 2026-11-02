// 毎日 4 時（日本の時刻）にデモ事業所を種に戻す（docs/tasks/T26.md）。Workers の cron（wrangler.jsonc の triggers）から
// worker.ts の scheduled が呼ぶ。D1 と R2 は env から引数で受ける（scheduled には Next の文脈が無い。テストは node:sqlite と偽の R2）。
// 戻すのはデモ事業所だけ（lib/seed/reset.ts）。協力事業所など別の事業所の行には触らない。

import type { D1Database } from "@cloudflare/workers-types";
import { resetDemoOffice, type ResetResult, type SeedBucket } from "./reset.ts";

/** 毎日 19:00 UTC（4:00 JST）。wrangler.jsonc の triggers.crons と同じ文字にする（テストが見る） */
export const DAILY_RESET_CRON = "0 19 * * *";

export type ScheduledEnv = { DB: D1Database; RECORDINGS: SeedBucket };

/** cron の 1 回。毎日 4 時の物でなければ何もしない（null）。now は予定の時刻 */
export async function scheduledReset(env: ScheduledEnv, cron: string, scheduledTime: number): Promise<ResetResult | null> {
  if (cron !== DAILY_RESET_CRON) return null;
  const now = new Date(scheduledTime).toISOString();
  const result = await resetDemoOffice(env.DB, env.RECORDINGS, now);
  console.log("デモ事業所を種に戻した", now, result.recording ? "録音あり" : "録音なし", `録音 ${result.removedRecordings} 件消去`);
  return result;
}
