// ケアマネの担当一覧（平時）。D1 から読んで、画面の 1 行の形にする。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "./age.ts";
import { parseLedger } from "./db/ledger.ts";
import type { CareLevel, ClockRow, ContactRow, PersonRow, PlanStatus } from "./db/types.ts";
import { DEPENDENCE_MARKS, HAZARD_LABELS } from "./labels.ts";
import { tierOf, type Tier } from "./triage/index.ts";
import { toTriagePerson } from "./triage/from-ledger.ts";

export type CaseloadRow = {
  id: string;
  name: string;
  kana: string;
  age: number | null;
  careLevel: CareLevel | null;
  /** 医療依存の短い印（酸素・透析など） */
  marks: string[];
  /** ハザード（浸水 3 m・土砂・津波） */
  hazards: string[];
  /** 避難支援等実施者の人数 */
  supporters: number;
  plan: PlanStatus;
  /** 未確認の項目の数 */
  pending: number;
  /** 緊急度の骨格 1〜8 */
  tier: Tier;
};

export type Caseload = {
  office: { id: string; name: string };
  careManager: { id: string; name: string };
  rows: CaseloadRow[];
};

type PersonForList = Pick<
  PersonRow,
  "id" | "name" | "kana" | "birth_date" | "plan_status" | "self_report_unreliable" | "ledger"
>;
type ClockForList = Pick<
  ClockRow,
  "person_id" | "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check"
>;
type ContactForList = Pick<ContactRow, "person_id" | "supporter_order">;

/** 行の形にする（D1 を使わない所。テストしやすいように分けた） */
export function toCaseloadRows(
  people: PersonForList[],
  clocks: ClockForList[],
  contacts: ContactForList[],
  today: string,
): CaseloadRow[] {
  return people.map((p) => {
    const ledger = parseLedger(p.ledger);
    const myClocks = clocks.filter((k) => k.person_id === p.id);
    const myContacts = contacts.filter((c) => c.person_id === p.id);
    const categories = new Set(myClocks.map((k) => k.category));
    return {
      id: p.id,
      name: p.name,
      kana: p.kana,
      age: p.birth_date ? ageOn(p.birth_date, today) : null,
      careLevel: ledger.care.careLevel ?? null,
      marks: DEPENDENCE_MARKS.filter(([c]) => categories.has(c)).map(([, label]) => label),
      hazards: ledger.evacuation.hazards.map((h) =>
        h.depthM != null ? `${HAZARD_LABELS[h.kind]} ${h.depthM} m` : HAZARD_LABELS[h.kind],
      ),
      supporters: myContacts.filter((c) => c.supporter_order != null).length,
      plan: p.plan_status,
      pending: ledger.pending.length,
      tier: tierOf(toTriagePerson({ person: p, ledger, contacts: myContacts, clocks: myClocks })),
    };
  });
}

export const SORT_KEYS = ["tier", "kana", "age", "plan"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const PLAN_ORDER: Record<PlanStatus, number> = { none: 0, draft: 1, consented: 2, trained: 3 };

/** 並び替え。どの並びでも、同じならカナの順 */
export function sortCaseload(rows: CaseloadRow[], key: SortKey): CaseloadRow[] {
  const byKana = (a: CaseloadRow, b: CaseloadRow) => a.kana.localeCompare(b.kana, "ja");
  const primary: Record<SortKey, (a: CaseloadRow, b: CaseloadRow) => number> = {
    tier: (a, b) => a.tier - b.tier,
    kana: () => 0,
    age: (a, b) => (b.age ?? -1) - (a.age ?? -1),
    plan: (a, b) => PLAN_ORDER[a.plan] - PLAN_ORDER[b.plan] || b.pending - a.pending,
  };
  return [...rows].sort((a, b) => primary[key](a, b) || byKana(a, b));
}

/** ケアマネ 1 人の担当を読む。ログインを作るまでは、事業所の最初のケアマネ */
export async function loadCaseload(db: D1Database, today: string): Promise<Caseload | null> {
  const cm = await db
    .prepare(
      `SELECT a.id, a.display_name, o.id AS office_id, o.name AS office_name
         FROM accounts a JOIN offices o ON o.id = a.office_id
        WHERE a.role = 'care_manager'
        ORDER BY o.id, a.id
        LIMIT 1`,
    )
    .first<{ id: string; display_name: string; office_id: string; office_name: string }>();
  if (!cm) return null;

  const [people, clocks, contacts] = await db.batch([
    db
      .prepare(
        `SELECT id, name, kana, birth_date, plan_status, self_report_unreliable, ledger FROM people
          WHERE care_manager_id = ?1 ORDER BY kana`,
      )
      .bind(cm.id),
    db
      .prepare(
        `SELECT person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check FROM clocks
          WHERE person_id IN (SELECT id FROM people WHERE care_manager_id = ?1)`,
      )
      .bind(cm.id),
    db
      .prepare(
        `SELECT person_id, supporter_order FROM contacts
          WHERE person_id IN (SELECT id FROM people WHERE care_manager_id = ?1)`,
      )
      .bind(cm.id),
  ]);

  return {
    office: { id: cm.office_id, name: cm.office_name },
    careManager: { id: cm.id, name: cm.display_name },
    rows: toCaseloadRows(
      people.results as PersonForList[],
      clocks.results as ClockForList[],
      contacts.results as ContactForList[],
      today,
    ),
  };
}
