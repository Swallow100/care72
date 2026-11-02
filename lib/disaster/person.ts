// 本人のページの災害モード。本人の事業所が災害モードなら、経過を一番上にし（mode: disaster）、
// ルールの表の色と理由の 1 行を上に出す（triage）。担当一覧・様式 9 と同じ入力（lib/disaster/triage.ts）。
// ケアマネの上書き（lib/disaster/override.ts、T13）も担当一覧と同じに当てる。

import type { D1Database } from "@cloudflare/workers-types";
import { parseLedger } from "../db/ledger.ts";
import type { PageMode, PersonPageRows } from "../person.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import type { TriageResult } from "../triage/index.ts";
import { loadSituation } from "./db.ts";
import { loadPersonOverride } from "./override.ts";
import type { DisasterSituation } from "./state.ts";
import { loadPersonSignals, triageInDisaster } from "./triage.ts";
import { loadPersonArrivals } from "../custody/arrivals.ts";

export type PersonDisaster = { mode: PageMode; triage: TriageResult | null; situation: DisasterSituation | null };

const NORMAL: PersonDisaster = { mode: "normal", triage: null, situation: null };

/** 本人のページを読んだ行（personInScope を通した物）から。平時は mode normal・triage null */
export async function personDisaster(
  db: D1Database,
  rows: PersonPageRows,
  now: string = new Date().toISOString(),
): Promise<PersonDisaster> {
  const situation = await loadSituation(db, rows.person.office_id, now);
  if (!situation) return NORMAL;
  const ledger = parseLedger(rows.person.ledger);
  const [signals, override, arrivals] = await Promise.all([
    loadPersonSignals(db, rows.person.id, situation),
    loadPersonOverride(db, rows.person.id, situation),
    // 医療班・行政の受け入れ（T23）。状態は「到着 避難所」
    loadPersonArrivals(db, rows.person.id, situation),
  ]);
  const triage = triageInDisaster(
    {
      person: toTriagePerson({ person: rows.person, ledger, contacts: rows.contacts, clocks: rows.clocks }),
      signals,
      arrivals,
      ...(override ? { override } : {}),
      town: ledger.basic.address?.town ?? null,
    },
    situation,
  );
  return { mode: "disaster", triage, situation };
}
