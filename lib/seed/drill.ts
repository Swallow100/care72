// デモ事業所の種の「終わった訓練 1 回」（docs/tasks/T26.md、docs/progress/t17.md の「T26 種」）。
// 大雨の想定を、本物の startDrill と advanceDrill（lib/drill/db.ts）で hooks なし（想定の表の固定の安否）に最後まで回して作る。
// 訓練の保存の形（drills・drill_events・signals）を写さないので、訓練の作り（T18〜T22）が変わってもそのまま追いつく。
//
// - Worker の「最初に戻す」（lib/seed/reset.ts）は D1 に直接回す
// - 手元の npm run db:seed（seed/build-sql.ts）は node:sqlite に回してから、行を INSERT の文に起こして seed.sql に足す（dumpDrillStatements）
//
// 時刻: 始めたのは種を入れた日の前の日の 14:00（日本の時刻）。刻みは 30 秒ずつ押した形で、6 分足らずで終わる。
// 開始者は山本。手の履歴（T20）と採点（T22）はまだ無いので空のまま。足すときはここで最後の刻みのあとに書く。

import type { D1Database } from "@cloudflare/workers-types";
import { CHECK_OFFICE_ID, checkSeedId, DEMO_TARGETS, type SeedOfficeTargets } from "../auth/demo.ts";
import type { DrillScenario } from "../db/types.ts";
import { advanceDrill, startDrill, type DrillScope } from "../drill/db.ts";
import { lastStep } from "../drill/engine.ts";
import { insert, type SqlValue } from "../../seed/sql.ts";

export const SEED_DRILL_ID = "drill-seed-heavy-rain";
/** 確認用の事業所（T144）の種の訓練の id */
export const CHECK_SEED_DRILL_ID = checkSeedId(SEED_DRILL_ID);

/** 種の事業所ごとの種の訓練の id */
export function seedDrillId(officeId: string): string {
  return officeId === CHECK_OFFICE_ID ? CHECK_SEED_DRILL_ID : SEED_DRILL_ID;
}
export const SEED_DRILL_SCENARIO: DrillScenario = "heavy_rain";

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
/** 押した間（ミリ秒） */
const STEP_MS = 30_000;

/** 種の訓練を始めた時刻: now の日本の日付の前の日の 14:00 JST（いつでも 10 時間以上前で、終わっている） */
export function seedDrillStartedAt(now: string): string {
  const t = Date.parse(now);
  if (Number.isNaN(t)) throw new Error(`時刻でない: ${now}`);
  const jstMidnight = Math.floor((t + JST_MS) / DAY_MS) * DAY_MS - JST_MS;
  return new Date(jstMidnight - DAY_MS + 14 * 3_600_000).toISOString();
}

/** 刻み i を押した時刻 */
export function seedDrillStepAt(now: string, i: number): string {
  return new Date(Date.parse(seedDrillStartedAt(now)) + i * STEP_MS).toISOString();
}

/**
 * 種の訓練を D1 に作る。その種の事業所に同じ id の訓練・進行中の訓練が無いこと（呼ぶ前に消してある）。
 * 開始で 0 時間、advanceDrill で 1 刻みずつ最後まで（大雨は 12 刻み）。途中で断られたら投げる。
 * targets は種の事業所（既定はデモ事業所。確認用の事業所 T144 は開始者がその山本で、想定の表の人はその写しに当たる）
 */
export async function seedDrill(db: D1Database, now: string, targets: SeedOfficeTargets = DEMO_TARGETS): Promise<void> {
  const scope: DrillScope = { officeId: targets.officeId, careManagerId: targets.careManagerId, accountId: targets.careManagerId };
  const id = seedDrillId(targets.officeId);
  const started = await startDrill(db, scope, SEED_DRILL_SCENARIO, seedDrillStepAt(now, 0), {}, () => id);
  if (!started.ok) throw new Error(`種の訓練を始められない: ${started.error}`);
  const last = lastStep(SEED_DRILL_SCENARIO);
  for (let i = 0; i < last; i++) {
    const r = await advanceDrill(db, scope, id, i, seedDrillStepAt(now, i + 1));
    if (!r.ok) throw new Error(`種の訓練を進められない: ${r.error}（刻み ${i}）`);
  }
}

/** 種の訓練の表（入れる順）と、行を読む文 */
const DRILL_TABLES = [
  { table: "drills", sql: "SELECT * FROM drills WHERE id = ?1" },
  { table: "drill_events", sql: "SELECT * FROM drill_events WHERE drill_id = ?1 ORDER BY seq" },
  { table: "signals", sql: "SELECT * FROM signals WHERE drill_id = ?1 ORDER BY id" },
] as const;

/** D1 に作った種の訓練の行を、INSERT の文に起こす（手元の seed.sql に足す） */
export async function dumpDrillStatements(db: D1Database, drillId: string = SEED_DRILL_ID): Promise<string[]> {
  const out: string[] = [];
  for (const { table, sql } of DRILL_TABLES) {
    const res = await db.prepare(sql).bind(drillId).all<Record<string, SqlValue>>();
    for (const row of res.results) out.push(insert(table, row));
  }
  return out;
}
