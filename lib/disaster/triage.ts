// 災害モードの色と並び。担当一覧・本人のページ・様式 9 が同じ物を使う（同じ人が画面ごとに違う色にならないように）。
// 色と順位はルールの表（lib/triage）だけで出す。ここは入力を集めるだけ: 台帳 → TriagePerson、信号の表 → TriageSignal、
// 事業所の状態 → 本人ごとの Situation（停電の地区の外の人は停電なし）。
// 信号は訓練の物（drill_id がある物）を入れず、発災から今までの物だけ（様式 9 と同じ）。

import type { D1Database } from "@cloudflare/workers-types";
import type { RecordingClass, SignalRow } from "../db/types.ts";
import { compareResults, triage, type Situation, type TriageEntry, type TriageResult, type TriageSignal } from "../triage/index.ts";
import { foldSignals } from "../triage/from-ledger.ts";
import { personSituation, type DisasterSituation } from "./state.ts";

/** ルールの表の入力 1 人ぶんと、停電の地区を当てる町名 */
export type DisasterEntry = TriageEntry & { town: string | null };

/** 本人ごとの状況で表に当て、表の並び（compareResults）で並べる */
export function rankInDisaster(entries: ReadonlyArray<DisasterEntry>, s: DisasterSituation | Situation): TriageResult[] {
  return entries.map((e) => triageInDisaster(e, s)).sort(compareResults);
}

/**
 * 1 人を表に当てる。信号は同じ出来事の赤を重ねて読んでから渡す（foldSignals。けがの赤のあとの答えなしの赤で「けが」を落とさない）。
 * 担当一覧・本人のページ・様式 9 はみなここを通るので、同じ人が画面ごとに違う理由にならない
 */
export function triageInDisaster(e: DisasterEntry, s: DisasterSituation | Situation): TriageResult {
  const { town, ...entry } = e;
  return triage({ ...entry, signals: foldSignals(entry.person, entry.signals) }, personSituation(s, town));
}

/** 発災から今までか（時刻の書き方の違いで文字の比べ方がずれないように、数にして比べる） */
export function withinDisaster(iso: string, s: Pick<Situation, "disasterAt" | "now">): boolean {
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= Date.parse(s.disasterAt) && t <= Date.parse(s.now);
}

export type SignalForTriage = Pick<SignalRow, "person_id" | "color" | "source" | "injured" | "can_move" | "classes" | "occurred_at">;

const bool = (v: 0 | 1 | null): boolean | null => (v === null ? null : v === 1);

function parseClasses(text: string | null): RecordingClass[] | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as RecordingClass[]) : undefined;
  } catch {
    return undefined;
  }
}

export function toTriageSignal(s: SignalForTriage): TriageSignal {
  return {
    color: s.color,
    source: s.source,
    at: s.occurred_at,
    injured: bool(s.injured),
    canMove: bool(s.can_move),
    classes: parseClasses(s.classes),
  };
}

function group(rows: ReadonlyArray<SignalForTriage>, s: Situation): Map<string, TriageSignal[]> {
  const out = new Map<string, TriageSignal[]>();
  for (const r of rows) {
    if (!withinDisaster(r.occurred_at, s)) continue;
    out.set(r.person_id, [...(out.get(r.person_id) ?? []), toTriageSignal(r)]);
  }
  return out;
}

const SIGNAL_COLUMNS = "person_id, color, source, injured, can_move, classes, occurred_at";

/** 事業所の本人の信号（訓練でない物、発災から今まで）を本人ごとに */
export async function loadOfficeSignals(db: D1Database, officeId: string, s: Situation): Promise<Map<string, TriageSignal[]>> {
  const res = await db
    .prepare(
      `SELECT ${SIGNAL_COLUMNS} FROM signals
        WHERE drill_id IS NULL AND person_id IN (SELECT id FROM people WHERE office_id = ?1)
        ORDER BY occurred_at, created_at, id`,
    )
    .bind(officeId)
    .all<SignalForTriage>();
  return group(res.results, s);
}

/** 1 人の信号（訓練でない物、発災から今まで） */
export async function loadPersonSignals(db: D1Database, personId: string, s: Situation): Promise<TriageSignal[]> {
  const res = await db
    .prepare(`SELECT ${SIGNAL_COLUMNS} FROM signals WHERE drill_id IS NULL AND person_id = ?1 ORDER BY occurred_at, created_at, id`)
    .bind(personId)
    .all<SignalForTriage>();
  return group(res.results, s).get(personId) ?? [];
}
