// 手元の npm run db:reset が入れる種の全部（node で使う。Worker からは使わない）。
// 全部の表を空にして事業所・アカウント・10 人（seed/sql.ts）→ デモ事業所の災害モードと山田の赤（lib/seed/demo.ts）
// → 終わった訓練（lib/seed/drill.ts）。訓練は node:sqlite に本物の startDrill・advanceDrill を回し、できた行を INSERT の文に起こす。
// Worker の「最初に戻す」（lib/seed/reset.ts）と同じ所から作るので、同じ now なら同じ中身になる。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { d1FromSqlite, migratedSqlite } from "../lib/db/test-d1.ts";
import {
  SEED_RECORDING_KEYS,
  SEED_RECORDING_TYPES,
  demoExtraStatements,
  type SeedRecording,
  type SeedRecordingExt,
} from "../lib/seed/demo.ts";
import { dumpDrillStatements, SEED_DRILL_ID, seedDrill } from "../lib/seed/drill.ts";
import { DEMO_SELF_PERSON_ID } from "../lib/auth/demo.ts";
import { seedStatements, type SeedOptions } from "./sql.ts";

/** 作者が置く種の録音のファイル（seed/recordings/p-01.webm か p-01.m4a）。無ければ null。中は読まない */
export function seedRecordingFile(seedDir: string): { path: string; ext: SeedRecordingExt; key: string; contentType: string } | null {
  for (const ext of Object.keys(SEED_RECORDING_KEYS) as SeedRecordingExt[]) {
    const path = join(seedDir, "recordings", `${DEMO_SELF_PERSON_ID}.${ext}`);
    if (existsSync(path)) return { path, ext, key: SEED_RECORDING_KEYS[ext], contentType: SEED_RECORDING_TYPES[ext] };
  }
  return null;
}

export type FullSeedOptions = SeedOptions & {
  /** 種の時刻の元（発災・停電・山田の赤・訓練の日はここから数える） */
  now: string;
  recording?: SeedRecording;
};

/** 種の全部の文（wrangler d1 execute --file で流す順） */
export async function fullSeedStatements(opts: FullSeedOptions): Promise<string[]> {
  const base = [...seedStatements(opts), ...demoExtraStatements(opts.now, opts.recording ?? null)];
  const sqlite = migratedSqlite();
  try {
    for (const s of base) sqlite.exec(s);
    const db = d1FromSqlite(sqlite);
    await seedDrill(db, opts.now);
    return [...base, ...(await dumpDrillStatements(db, SEED_DRILL_ID))];
  } finally {
    sqlite.close();
  }
}
