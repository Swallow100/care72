// 様式 9 を D1 から読む・手直しを書く。範囲は事業所（事業所の壁）。管理者とケアマネ（審査員のケアマネの役も）が開く。
// 発災時（災害の状態があるとき）は信号の表と経過の表を読み、ルールの表（lib/triage）で色と順位を出して並べ、結果の列を埋める。
// 信号は訓練の物（drill_id がある物）を入れず、発災から今までの物だけ。災害の状態は災害モード（lib/disaster、T09）から読む。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { canViewPage } from "../auth/roles.ts";
import { parseLedger } from "../db/ledger.ts";
import type {
  AuthorRole,
  ClockRow,
  ContactRow,
  Form9Mode,
  PersonRow,
  SignalRow,
  TimelineEntryRow,
} from "../db/types.ts";
import { loadSituation as loadDisasterSituation } from "../disaster/db.ts";
import { loadOfficeOverrides } from "../disaster/override.ts";
import type { DisasterSituation } from "../disaster/state.ts";
import { rankInDisaster, toTriageSignal } from "../disaster/triage.ts";
import { loadOfficeArrivals } from "../custody/arrivals.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import type { Situation } from "../triage/index.ts";
import {
  buildForm9,
  FORM9_ENTRY_KINDS,
  type Form9Entry,
  type Form9EntryKind,
  type Form9PersonInput,
  type Form9RankEdit,
  type Form9Reports,
  type Form9Sheet,
  type Form9Signal,
} from "./form9.ts";

export type Form9Scope = { officeId: string };

/** 様式 9 を開ける人と範囲。ケアマネの役（管理者・審査員を含む）で、事業所があること。範囲は事業所の全員 */
export function form9Scope(p: Principal | null): Form9Scope | null {
  if (!p || !canViewPage(p.role, "caseload") || !p.office) return null;
  return { officeId: p.office.id };
}

/**
 * 事業所の災害の状態（災害モード、lib/disaster）。平時は null。
 * 今・発災・停電の始まりと停電の地区。now は要求の時刻（1 分ごとの読み直しで進む）
 */
export async function loadSituation(
  db: D1Database,
  officeId: string,
  now: string = new Date().toISOString(),
): Promise<DisasterSituation | null> {
  return loadDisasterSituation(db, officeId, now);
}

export type Form9Data = {
  office: { id: string; name: string };
  situation: Situation | null;
  sheet: Form9Sheet;
};

type PersonForForm = Pick<
  PersonRow,
  "id" | "name" | "kana" | "birth_date" | "self_report_unreliable" | "ledger" | "care_manager_id"
>;
type ContactForForm = Form9PersonInput["contacts"][number] & Pick<ContactRow, "person_id">;
type ClockForForm = Form9PersonInput["clocks"][number] & Pick<ClockRow, "person_id">;
type SignalForForm = Pick<
  SignalRow,
  "person_id" | "color" | "source" | "where_now" | "injured" | "can_move" | "classes" | "classified_by" | "occurred_at"
>;
type EntryForForm = Pick<TimelineEntryRow, "person_id" | "kind" | "author_role" | "body" | "payload" | "occurred_at">;

function ms(iso: string): number {
  return Date.parse(iso);
}

/** 発災から今までか（時刻の書き方の違いで文字の比べ方がずれないように、数にして比べる） */
function within(iso: string, s: Situation): boolean {
  const t = ms(iso);
  return !Number.isNaN(t) && t >= ms(s.disasterAt) && t <= ms(s.now);
}

const bool = (v: 0 | 1 | null): boolean | null => (v === null ? null : v === 1);

/** 経過の行から避難所の名前: payload の shelter（文字）があればそれ、無ければ本文（到着・受入のときだけ） */
export function entryPlace(e: Pick<TimelineEntryRow, "kind" | "body" | "payload">): string | null {
  if (e.payload) {
    try {
      const v = JSON.parse(e.payload) as { shelter?: unknown };
      if (typeof v.shelter === "string" && v.shelter.trim()) return v.shelter.trim();
    } catch {
      // 読めない payload は使わない
    }
  }
  if ((e.kind === "arrived_shelter" || e.kind === "received") && e.body?.trim()) return e.body.trim();
  return null;
}

function toSignal(s: SignalForForm): Form9Signal {
  return {
    color: s.color,
    source: s.source,
    whereNow: s.where_now,
    injured: bool(s.injured),
    canMove: bool(s.can_move),
    at: s.occurred_at,
  };
}

const ENTRY_KINDS_SQL = FORM9_ENTRY_KINDS.map((k) => `'${k}'`).join(", ");

/**
 * 事業所の様式 9 を読む。事業所が無ければ null。
 * situation を渡すと発災時（信号と経過を読み、色と順位で並べ、結果の列を埋める）。null なら平時（優先の骨格）
 */
export async function loadForm9(
  db: D1Database,
  scope: Form9Scope,
  opts: { today: string; situation: Situation | null },
): Promise<Form9Data | null> {
  const office = await db
    .prepare("SELECT id, name FROM offices WHERE id = ?1")
    .bind(scope.officeId)
    .first<{ id: string; name: string }>();
  if (!office) return null;

  // 一覧から外した人（people.unlisted_at、T30）は様式 9 にも出さない
  const mine = "SELECT id FROM people WHERE office_id = ?1 AND unlisted_at IS NULL";
  const statements = [
    db
      .prepare(
        `SELECT id, name, kana, birth_date, self_report_unreliable, ledger, care_manager_id FROM people
          WHERE office_id = ?1 AND unlisted_at IS NULL ORDER BY kana, id`,
      )
      .bind(office.id),
    db.prepare("SELECT id, display_name FROM accounts WHERE office_id = ?1").bind(office.id),
    db
      .prepare(
        `SELECT person_id, kind, relation, name, phone, emergency_order, supporter_order, has_smartphone FROM contacts
          WHERE person_id IN (${mine}) ORDER BY person_id, sort`,
      )
      .bind(office.id),
    db
      .prepare(
        `SELECT person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check FROM clocks
          WHERE person_id IN (${mine}) ORDER BY person_id, sort`,
      )
      .bind(office.id),
    db
      .prepare(
        `SELECT e.id, e.person_id, e.mode, e.rank, e.auto_rank, e.reason, e.set_at, a.display_name AS set_by_name
           FROM form9_rank_edits e LEFT JOIN accounts a ON a.id = e.set_by
          WHERE e.office_id = ?1 AND e.person_id IN (${mine}) ORDER BY e.set_at, e.id`,
      )
      .bind(office.id),
  ];
  const s = opts.situation;
  if (s) {
    statements.push(
      db
        .prepare(
          `SELECT person_id, color, source, where_now, injured, can_move, classes, classified_by, occurred_at FROM signals
            WHERE drill_id IS NULL AND retracted_at IS NULL AND person_id IN (${mine}) ORDER BY occurred_at, created_at, id`,
        )
        .bind(office.id),
      db
        .prepare(
          `SELECT person_id, kind, author_role, body, payload, occurred_at FROM timeline_entries
            WHERE kind IN (${ENTRY_KINDS_SQL}) AND retracted_at IS NULL AND person_id IN (${mine}) ORDER BY occurred_at, created_at, id`,
        )
        .bind(office.id),
    );
  }
  const [people, accounts, contacts, clocks, edits, signalsRes, entriesRes] = await db.batch(statements);

  const names = new Map((accounts.results as Array<{ id: string; display_name: string }>).map((a) => [a.id, a.display_name]));
  const byPerson = <T extends { person_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.person_id, [...(m.get(r.person_id) ?? []), r]);
    return m;
  };
  const contactsOf = byPerson(contacts.results as ContactForForm[]);
  const clocksOf = byPerson(clocks.results as ClockForForm[]);
  const inputs: Form9PersonInput[] = (people.results as PersonForForm[]).map((p) => ({
    person: p,
    careManager: p.care_manager_id ? (names.get(p.care_manager_id) || null) : null,
    contacts: contactsOf.get(p.id) ?? [],
    clocks: clocksOf.get(p.id) ?? [],
  }));

  let sheet: Form9Sheet;
  if (s && signalsRes && entriesRes) {
    const signals = byPerson((signalsRes.results as SignalForForm[]).filter((x) => within(x.occurred_at, s)));
    const entries = byPerson((entriesRes.results as EntryForForm[]).filter((x) => within(x.occurred_at, s)));
    // ケアマネの上書き（T13）も担当一覧・本人のページと同じに当てる。医療班・行政の受け入れ（T23）も同じ「到着 避難所」
    const [overrides, arrivals] = await Promise.all([loadOfficeOverrides(db, office.id, s), loadOfficeArrivals(db, office.id, s)]);
    // 停電の範囲が地区なら、本人の町名で停電の時計を走らせるかを決める（担当一覧・本人のページと同じ、lib/disaster）
    const triage = rankInDisaster(
      inputs.map((p) => {
        const ledger = parseLedger(p.person.ledger);
        const override = overrides.get(p.person.id);
        return {
          person: toTriagePerson({ person: p.person, ledger, contacts: p.contacts, clocks: p.clocks }),
          signals: (signals.get(p.person.id) ?? []).map(toTriageSignal),
          arrivals: arrivals.get(p.person.id) ?? [],
          ...(override ? { override } : {}),
          town: ledger.basic.address?.town ?? null,
        };
      }),
      s,
    );
    const reports = new Map<string, Form9Reports>(
      inputs.map((p) => [
        p.person.id,
        {
          signals: (signals.get(p.person.id) ?? []).map(toSignal),
          entries: (entries.get(p.person.id) ?? []).map(
            (e): Form9Entry => ({
              kind: e.kind as Form9EntryKind,
              authorRole: e.author_role as AuthorRole,
              place: entryPlace(e),
              at: e.occurred_at,
            }),
          ),
        },
      ]),
    );
    sheet = buildForm9(inputs, { today: opts.today, triage, edits: edits.results as Form9RankEdit[], reports });
  } else {
    sheet = buildForm9(inputs, { today: opts.today, edits: edits.results as Form9RankEdit[] });
  }
  return { office, situation: s, sheet };
}

export type RankEditInsert = {
  id: string;
  officeId: string;
  personId: string;
  mode: Form9Mode;
  rank: number | null;
  autoRank: number;
  reason: string;
  setBy: string | null;
  setAt: string;
};

/** 手直しを 1 行足す。本人がその事業所にいなければ足さずに false（事業所の壁） */
export async function insertRankEdit(db: D1Database, e: RankEditInsert): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT INTO form9_rank_edits (id, office_id, person_id, mode, rank, auto_rank, reason, set_by, set_at)
       SELECT ?1, ?2, p.id, ?4, ?5, ?6, ?7, ?8, ?9 FROM people p WHERE p.id = ?3 AND p.office_id = ?2`,
    )
    .bind(e.id, e.officeId, e.personId, e.mode, e.rank, e.autoRank, e.reason, e.setBy, e.setAt)
    .run();
  return (r.meta.changes ?? 0) > 0;
}
