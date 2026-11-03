// 受け入れ（custody の行）をルールの表の入力（TriageArrival）にする（docs/tasks/T23.md）。
// 医療班・行政が避難所で受け入れると、ケアマネの一覧・本人のページ・様式 9 の状態が「到着 避難所の名前」になる（緑）。
// 受け持ちを閉じた行（搬送・退所）も、受け入れた事実なので入れる。搬送で閉じた行は搬送の時刻と行き先も入れ、
// 表の中で「搬送 行き先」になる（T24。退所は「到着」のまま）。発災から今までの物だけ（信号と同じ。lib/disaster/triage.ts の withinDisaster）。
// ただし受入中（解除していない）の行は、今の災害の始まりより前に受け入れた物も渡す（arrivalInScope。T80）。
// 誰が受け入れても同じ（アカウントをまたいで読む）。担当一覧・本人のページ・様式 9・受け持ちの一覧はみなここを通る。

import type { D1Database } from "@cloudflare/workers-types";
import type { ReleaseKind } from "../db/types.ts";
import { withinDisaster } from "../disaster/triage.ts";
import type { Situation, TriageArrival } from "../triage/index.ts";

/** 受け入れの行（読む列は ARRIVAL_COLUMNS） */
export type ArrivalRow = {
  person_id: string;
  shelter: string;
  received_at: string;
  release_kind: ReleaseKind | null;
  released_at: string | null;
  release_note: string | null;
};

/** custody から読む列 */
export const ARRIVAL_COLUMNS = "person_id, shelter, received_at, release_kind, released_at, release_note";

/** 1 行を表の入力に。搬送で閉じていれば搬送の時刻と行き先（空なら null） */
export function toTriageArrival(r: ArrivalRow): TriageArrival {
  const a: TriageArrival = { at: r.received_at, shelter: r.shelter };
  if (r.release_kind === "transported" && r.released_at) {
    a.transported = { at: r.released_at, to: r.release_note?.trim() || null };
  }
  return a;
}

/**
 * 表に渡す受け入れか（T80）。受入中（解除していない）の行は、いつ受け入れたかに関わらず渡す（今より後は渡さない）。
 * 平時や前の災害で受け入れたまま 平時 → 大雨 と切り替えても、今の災害の始まりより前の受け入れを落として「不明」にしないため。
 * 閉じた行（搬送・退所）は前のまま、受け入れが発災から今までの物だけ。表の決め方は変えない（入力の取りこぼしだけ）
 */
export function arrivalInScope(r: Pick<ArrivalRow, "received_at" | "released_at">, s: Pick<Situation, "disasterAt" | "now">): boolean {
  if (r.released_at === null) {
    const t = Date.parse(r.received_at);
    return !Number.isNaN(t) && t <= Date.parse(s.now);
  }
  return withinDisaster(r.received_at, s);
}

function group(rows: ReadonlyArray<ArrivalRow>, s: Situation | null): Map<string, TriageArrival[]> {
  const out = new Map<string, TriageArrival[]>();
  for (const r of rows) {
    if (s && !arrivalInScope(r, s)) continue;
    out.set(r.person_id, [...(out.get(r.person_id) ?? []), toTriageArrival(r)]);
  }
  return out;
}

/** 事業所の本人の受け入れ（発災から今まで）を本人ごとに */
export async function loadOfficeArrivals(db: D1Database, officeId: string, s: Situation): Promise<Map<string, TriageArrival[]>> {
  const res = await db
    .prepare(
      `SELECT ${ARRIVAL_COLUMNS} FROM custody c
        WHERE c.person_id IN (SELECT id FROM people WHERE office_id = ?1)
        ORDER BY c.received_at, c.id`,
    )
    .bind(officeId)
    .all<ArrivalRow>();
  return group(res.results, s);
}

/** 1 人の受け入れ（発災から今まで） */
export async function loadPersonArrivals(db: D1Database, personId: string, s: Situation): Promise<TriageArrival[]> {
  const res = await db
    .prepare(`SELECT ${ARRIVAL_COLUMNS} FROM custody WHERE person_id = ?1 ORDER BY received_at, id`)
    .bind(personId)
    .all<ArrivalRow>();
  return group(res.results, s).get(personId) ?? [];
}

/** 本人の id の一覧の受け入れ（受け持ちの一覧）。s が null なら時刻で絞らない */
export async function loadArrivalsOf(
  db: D1Database,
  personIds: ReadonlyArray<string>,
): Promise<Map<string, ArrivalRow[]>> {
  const out = new Map<string, ArrivalRow[]>();
  if (personIds.length === 0) return out;
  const res = await db
    .prepare(
      `SELECT ${ARRIVAL_COLUMNS} FROM custody
        WHERE person_id IN (SELECT value FROM json_each(?1)) ORDER BY received_at, id`,
    )
    .bind(JSON.stringify(personIds))
    .all<ArrivalRow>();
  for (const r of res.results) out.set(r.person_id, [...(out.get(r.person_id) ?? []), r]);
  return out;
}

/** 受け入れの行から、状況の発災から今までの物だけを表の入力に */
export function arrivalsWithin(rows: ReadonlyArray<ArrivalRow> | undefined, s: Situation): TriageArrival[] {
  return group(rows ?? [], s).get(rows?.[0]?.person_id ?? "") ?? [];
}
