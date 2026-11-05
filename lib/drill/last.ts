// 人ごとの最後に出た訓練の日（T146）。計画の状態の横の「訓練 11/5」に使う（lib/plan-status.ts）。
// 数えるのは終わった訓練（status = 'finished'）だけ。進行中・中断（24 時間たった物を含む）は「出た」に数えない。
// 参加者は drills.world の participants（lib/drill/db.ts の mineRunningSql と同じ読み方）。日は訓練を始めた時刻の JST の日。
// 色と連絡順（lib/triage）には使わない。

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

const JST_DAY = "date(MAX(d.started_at), '+9 hours')";

/** 事業所の人ごとの最後の訓練の日（JST の YYYY-MM-DD）を読む文 */
export function lastDrillDaysStatement(db: D1Database, officeId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT j.value AS person_id, ${JST_DAY} AS day
         FROM drills d, json_each(d.world, '$.participants') j
        WHERE d.office_id = ?1 AND d.status = 'finished'
        GROUP BY j.value`,
    )
    .bind(officeId);
}

/** 1 人の最後の訓練の日を読む文（本人のページ） */
export function lastDrillDayStatement(db: D1Database, officeId: string, personId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${JST_DAY} AS day
         FROM drills d, json_each(d.world, '$.participants') j
        WHERE d.office_id = ?1 AND d.status = 'finished' AND j.value = ?2`,
    )
    .bind(officeId, personId);
}

/** 読んだ行を人の id → 日 に */
export function lastDrillMap(rows: ReadonlyArray<{ person_id: unknown; day: unknown }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) if (typeof r.person_id === "string" && typeof r.day === "string") out.set(r.person_id, r.day);
  return out;
}

/** 事業所の人ごとの最後の訓練の日 */
export async function lastDrillDays(db: D1Database, officeId: string): Promise<Map<string, string>> {
  const res = await lastDrillDaysStatement(db, officeId).all<{ person_id: string; day: string }>();
  return lastDrillMap(res.results);
}

/** 1 行目の日（無ければ null。MAX の行は人が出ていなくても 1 行で day が null） */
export function lastDrillDayOf(rows: ReadonlyArray<{ day?: unknown }>): string | null {
  const d = rows[0]?.day;
  return typeof d === "string" ? d : null;
}
