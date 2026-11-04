// 毎日 4 時（日本の時刻）にデモ事業所を種に戻す（docs/tasks/T26.md）。Workers の cron（wrangler.jsonc の triggers）から
// worker.ts の scheduled が呼ぶ。D1 と R2 は env から引数で受ける（scheduled には Next の文脈が無い。テストは node:sqlite と偽の R2）。
// 戻すのはデモ事業所だけ（lib/seed/reset.ts）。協力事業所など別の事業所の行には触らない。
// 同じ時刻に、審査員の試用事業所（T115）を丸ごと消す（lib/seed/sandbox.ts）。片方が落ちてももう片方は流し、終わってから最初の失敗を投げる。

import type { D1Database } from "@cloudflare/workers-types";
import { resetDemoOffice, type ResetResult, type SeedBucket } from "./reset.ts";
import { clearSandboxes, type SandboxCleanResult } from "./sandbox.ts";

/** 毎日 19:00 UTC（4:00 JST）。wrangler.jsonc の triggers.crons と同じ文字にする（テストが見る） */
export const DAILY_RESET_CRON = "0 19 * * *";

export type ScheduledEnv = { DB: D1Database; RECORDINGS: SeedBucket };

export type ScheduledResult = ResetResult & { sandboxes: SandboxCleanResult };

/** cron の 1 回。毎日 4 時の物でなければ何もしない（null）。now は予定の時刻 */
export async function scheduledReset(env: ScheduledEnv, cron: string, scheduledTime: number): Promise<ScheduledResult | null> {
  if (cron !== DAILY_RESET_CRON) return null;
  const now = new Date(scheduledTime).toISOString();
  let failure: unknown = null;
  let result: ResetResult | null = null;
  try {
    result = await resetDemoOffice(env.DB, env.RECORDINGS, now);
    console.log("デモ事業所を種に戻した", now, result.recording ? "録音あり" : "録音なし", `録音 ${result.removedRecordings} 件消去`);
  } catch (e) {
    failure = e;
    console.error("デモ事業所を戻せない", now, e instanceof Error ? e.name : typeof e);
  }
  let sandboxes: SandboxCleanResult | null = null;
  try {
    sandboxes = await clearSandboxes(env.DB, env.RECORDINGS);
    console.log("試用事業所を消した", now, `事業所 ${sandboxes.offices} 件`, `R2 ${sandboxes.removedObjects} 件消去`);
  } catch (e) {
    failure ??= e;
    console.error("試用事業所を消せない", now, e instanceof Error ? e.name : typeof e);
  }
  if (failure !== null || !result || !sandboxes) throw failure;
  return { ...result, sandboxes };
}
