// 入れる欄の保存（T03）。画面で人が確かめた変更（Claude の分け方・問いの答え・手入力）を、今の台帳に当て直して書く。
//
// - 書けるのはケアマネの役だけ（審査員のケアマネの役を含む）。本人は personInScope を通した事業所の中の人だけ
// - 版（people.version）が画面で読んだときと違えば書かない（競合）。ほかの人の保存を上書きしない
// - 埋まっている欄は変えない（人が既入力を選んだときだけ上書き。lib/db/ledger.ts の applyLedgerChanges）
// - 連絡先は空いた所だけを埋める（夜間・続柄・名前・電話・備考）。足す人の名前と電話は人が画面で入れた物
// - 時計: 機器・薬を入れたら値の空いた時計を機械的に作る（医療依存の印。lib/intake/marks.ts）。値は人が問いに答えた物だけ
// - 計画の状態が未作成なら下書きにする。経過に「入力」を 1 行（kind note、payload の source が intake。値は残さず場所だけ）
// - 全部を 1 つの batch（取引）で。台帳の版が上がったときだけ、ほかの文が効く（guard）

import type { D1Database } from "@cloudflare/workers-types";
import * as z from "zod";
import type { Principal } from "../auth/principal.ts";
import { applyLedgerChanges, parseLedger, sameMedication } from "../db/ledger.ts";
import {
  CLOCK_UNITS,
  DEVICE_KINDS,
  HAZARD_KINDS,
  INTAKE_SOURCE,
  MEDICATION_CATEGORIES,
  PENDING_STATUSES,
  type ClockRow,
  type IntakePayload,
  type Ledger,
  type PlanStatus,
} from "../db/types.ts";
import { loadPersonPage, pendingClockId, type PersonPageRows } from "../person.ts";
import type { IntakeChange } from "./changes.ts";
import { labelOfKey } from "./diff.ts";
import { INTAKE_KEYS } from "./fields.ts";
import { MEDICATION_CLOCKS, planMarkClocks, type MarkClock } from "./marks.ts";
import { CONTACT_KINDS_FOR_INTAKE } from "./schema.ts";

const text = (max: number) => z.string().trim().max(max);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const ChangeSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("field"), key: z.enum(INTAKE_KEYS), value: z.unknown(), overwrite: z.boolean().optional() }),
  z.object({
    t: z.literal("medication"),
    index: z.number().int().min(0).max(200).optional(),
    value: z.object({
      name: text(100).min(1),
      category: z.enum(MEDICATION_CATEGORIES),
      schedule: text(200).optional(),
      amount: text(200).optional(),
      storage: text(200).optional(),
    }),
  }),
  z.object({
    t: z.literal("device"),
    value: z.object({ kind: z.enum(DEVICE_KINDS), detail: text(200).optional(), schedule: text(200).optional() }),
  }),
  z.object({ t: z.literal("hazard"), value: z.object({ kind: z.enum(HAZARD_KINDS), depthM: z.number().min(0).max(100).optional() }) }),
  z.object({ t: z.literal("note"), value: text(1000).min(1) }),
  z.object({ t: z.literal("pending"), field: z.string().regex(/^[^\s]{1,120}$/), status: z.enum(PENDING_STATUSES) }),
  z.object({
    t: z.literal("contact"),
    id: z.string().regex(ID).nullable(),
    value: z.object({
      kind: z.enum(CONTACT_KINDS_FOR_INTAKE),
      relation: text(40).optional(),
      name: text(60).optional(),
      phone: z.string().trim().regex(/^[0-9+\-() ]{0,20}$/).optional(),
      nightOk: z.boolean().optional(),
      note: text(200).optional(),
    }),
  }),
  z.object({
    t: z.literal("clock"),
    clockId: z.string().regex(ID).nullable(),
    medIndex: z.number().int().min(0).max(200).nullable(),
    label: text(100).min(1),
    value: z.number().min(0).max(10000),
    unit: z.enum(CLOCK_UNITS),
  }),
]);

export const SaveRequestSchema = z.object({
  personId: z.string().regex(ID),
  /** 画面で読んだときの台帳の版 */
  version: z.number().int().min(1),
  /** Claude の分け方を使ったとき、答えたモデル（経過の AI の印） */
  ai: z.object({ model: z.string().regex(/^claude-[a-z0-9-]{1,48}$/) }).nullable(),
  changes: z.array(ChangeSchema).min(1).max(200),
});

export type SaveRequest = z.output<typeof SaveRequestSchema>;

export type SaveResult =
  | { ok: true; changed: number; version: number; plan: PlanStatus; fields: string[] }
  | { ok: false; error: "not_found" | "forbidden" | "conflict" };

type Statement = ReturnType<D1Database["prepare"]>;

/** 経過の本文: 「AI の分け方、人が確認」か「手入力」と、変えた欄の名前（10 まで） */
export function timelineBody(ai: boolean, fields: ReadonlyArray<string>): string {
  const names = [...new Set(fields.map(fieldName))];
  const shown = names.slice(0, 10).join("・");
  const more = names.length > 10 ? ` ほか ${names.length - 10}` : "";
  return `${ai ? "AI の分け方、人が確認" : "手入力"}: ${shown}${more}`;
}

function fieldName(field: string): string {
  if (field.startsWith("contacts.")) return "連絡先";
  if (field.startsWith("clocks.")) return "時計";
  if (field === "notes") return "特記";
  if (field.startsWith("medical.medications")) return "薬";
  if (field.startsWith("medical.devices")) return "機器";
  if (field.startsWith("evacuation.hazards")) return "ハザード";
  return labelOfKey(field);
}

/** 薬の時計の形（骨格に入る区分はその時計、ほかは薬の時計 その他） */
function medicationClockSpec(category: Ledger["medical"]["medications"][number]["category"], label: string): MarkClock {
  const spec = MEDICATION_CLOCKS[category];
  return spec ? { ...spec, label } : { kind: "medication", category: "other", label, starts_on: "disaster" };
}

type NewClock = MarkClock & { id: string; value: number | null; unit: ClockRow["unit"]; confirmed: boolean };

/** 守りの文に渡す物: ?1 この保存の経過の行の id・?2 本人の id・?3 時刻 */
type GuardArgs = readonly [string, string, string];

const shortId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

/**
 * 保存する。personInScope を通らない本人は not_found、ケアマネの役でなければ forbidden、版が違えば conflict。
 * 何も変わらなければ書かずに changed 0
 */
export async function saveIntake(db: D1Database, principal: Principal, req: SaveRequest, now = new Date()): Promise<SaveResult> {
  if (principal.role !== "care_manager") return { ok: false, error: "forbidden" };
  const rows = await loadPersonPage(db, principal, req.personId);
  if (!rows) return { ok: false, error: "not_found" };
  if (rows.person.version !== req.version) return { ok: false, error: "conflict" };

  const stamp = now.toISOString();
  const personId = rows.person.id;
  const before = parseLedger(rows.person.ledger);
  const changes = req.changes as IntakeChange[];
  const applied = applyLedgerChanges(before, changes);
  let ledger = applied.ledger;
  const fields = [...applied.fields];

  // ---- 連絡先 ----
  const contactOps = planContacts(rows, changes, personId);
  fields.push(...contactOps.fields);

  // ---- 時計（機械的な印と、人が答えた残り） ----
  const clockOps = planClocks(rows, before, ledger, changes, personId);
  fields.push(...clockOps.fields);
  if (clockOps.resolvedPending.size > 0) {
    ledger = { ...ledger, pending: ledger.pending.filter((p) => !clockOps.resolvedPending.has(p.field)) };
  }

  const ledgerChanged = JSON.stringify(ledger) !== JSON.stringify(before);
  const changed = (ledgerChanged ? 1 : 0) + contactOps.count + clockOps.count;
  const plan: PlanStatus = rows.person.plan_status === "none" ? "draft" : rows.person.plan_status;
  if (changed === 0) return { ok: true, changed: 0, version: req.version, plan: rows.person.plan_status, fields: [] };

  const next = req.version + 1;
  const payload: IntakePayload = {
    source: INTAKE_SOURCE,
    ai: req.ai !== null,
    model: req.ai?.model ?? null,
    fields: [...new Set(fields)],
  };
  // この保存の経過の行（id は毎回でたらめ）を最初に、読んだ版のままのときだけ足す。ほかの文はこの行があるときだけ効く。
  // 同じ版から 2 つの保存が重なっても、あとの batch は版が上がっていて経過の行が入らず、台帳・連絡先・時計も書かない
  const tid = `t-${personId}-${shortId()}`;
  const GUARD = "EXISTS (SELECT 1 FROM timeline_entries WHERE id = ?1 AND person_id = ?2)";
  const guardArgs = [tid, personId, stamp] as const;

  const stmts: Statement[] = [
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at, created_at)
         SELECT ?1, ?2, ?4, 'care_manager', 'note', ?5, ?6, ?3, ?3
          WHERE (SELECT version FROM people WHERE id = ?2 AND office_id = ?7) = ?8`,
      )
      .bind(
        ...guardArgs,
        principal.accountId,
        timelineBody(req.ai !== null, payload.fields),
        JSON.stringify(payload),
        rows.person.office_id,
        req.version,
      ),
    db
      .prepare(
        `UPDATE people
            SET ledger = ?4,
                plan_status = CASE WHEN plan_status = 'none' THEN 'draft' ELSE plan_status END,
                version = version + 1,
                updated_at = ?3
          WHERE id = ?2 AND version = ?5 AND ${GUARD}`,
      )
      .bind(...guardArgs, JSON.stringify(ledger), req.version),
    ...contactOps.build(db, GUARD, guardArgs),
    ...clockOps.build(db, GUARD, guardArgs),
  ];

  const results = await db.batch(stmts);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) return { ok: false, error: "conflict" };
  return { ok: true, changed, version: next, plan, fields: payload.fields };
}

// ---------- 連絡先 ----------

type ContactChange = Extract<IntakeChange, { t: "contact" }>;

function planContacts(rows: PersonPageRows, changes: ReadonlyArray<IntakeChange>, personId: string) {
  const updates: Array<{ id: string; set: Array<[string, string | number]> }> = [];
  const inserts: Array<{ id: string; c: ContactChange["value"]; sort: number }> = [];
  const fields: string[] = [];
  let sort = rows.contacts.reduce((m, c) => Math.max(m, c.sort), -1);
  for (const ch of changes) {
    if (ch.t !== "contact") continue;
    const v = ch.value;
    if (ch.id) {
      const cur = rows.contacts.find((c) => c.id === ch.id);
      if (!cur || cur.kind === "self") continue;
      const set: Array<[string, string | number]> = [];
      if (v.nightOk !== undefined && cur.night_ok == null) set.push(["night_ok", v.nightOk ? 1 : 0]);
      if (v.relation && !cur.relation) set.push(["relation", v.relation]);
      if (v.name && !cur.name) set.push(["name", v.name]);
      if (v.phone && !cur.phone) set.push(["phone", v.phone]);
      if (v.note && !cur.note) set.push(["note", v.note]);
      if (set.length === 0) continue;
      updates.push({ id: cur.id, set });
      fields.push(`contacts.${cur.id}`);
    } else {
      const id = `c-${personId}-${shortId()}`;
      inserts.push({ id, c: v, sort: ++sort });
      fields.push(`contacts.${id}`);
    }
  }
  return {
    fields,
    count: updates.length + inserts.length,
    /** guardArgs は ?1 経過の行の id・?2 本人の id・?3 時刻 */
    build(db: D1Database, guard: string, guardArgs: GuardArgs): Statement[] {
      return [
        ...updates.map((u) => {
          // 空いた所だけ（COALESCE で今の値を残す。読んだあとに埋まった所も上書きしない）
          const sets = u.set.map(([col], i) => `${col} = COALESCE(${col}, ?${i + 5})`).join(", ");
          return db
            .prepare(`UPDATE contacts SET ${sets} WHERE id = ?4 AND person_id = ?2 AND ${guard}`)
            .bind(...guardArgs, u.id, ...u.set.map(([, v]) => v));
        }),
        ...inserts.map((n) =>
          db
            .prepare(
              `INSERT INTO contacts (id, person_id, kind, relation, name, phone, night_ok, note, sort, created_at)
               SELECT ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?3 WHERE ${guard}`,
            )
            .bind(
              ...guardArgs,
              n.id,
              n.c.kind,
              n.c.relation || null,
              n.c.name || null,
              n.c.phone || null,
              n.c.nightOk === undefined ? null : n.c.nightOk ? 1 : 0,
              n.c.note || null,
              n.sort,
            ),
        ),
      ];
    },
  };
}

// ---------- 時計 ----------

function planClocks(rows: PersonPageRows, before: Ledger, after: Ledger, changes: ReadonlyArray<IntakeChange>, personId: string) {
  const fields: string[] = [];
  const resolvedPending = new Set<string>();
  const updates: Array<{ id: string; value: number; unit: NonNullable<ClockRow["unit"]> }> = [];
  // 機器・薬・認知症の時計（値は空。医療依存の印）
  const created: NewClock[] = planMarkClocks(after, rows.clocks).map((k) => ({
    ...k,
    id: `k-${personId}-${shortId()}`,
    value: null,
    unit: null,
    confirmed: false,
  }));
  for (const k of created) fields.push(`clocks.${k.id}`);

  for (const ch of changes) {
    if (ch.t !== "clock") continue;
    if (ch.clockId) {
      const cur = rows.clocks.find((k) => k.id === ch.clockId);
      if (!cur || cur.value != null || cur.kind === "condition") continue;
      updates.push({ id: cur.id, value: ch.value, unit: ch.unit });
      fields.push(`clocks.${cur.id}`);
      for (const p of before.pending) if (pendingClockId(p.field, before, rows.clocks) === cur.id) resolvedPending.add(p.field);
      continue;
    }
    if (ch.medIndex == null) continue;
    const med = after.medical.medications[ch.medIndex];
    if (!med) continue;
    resolvedPending.add(`medical.medications.${ch.medIndex}.remaining`);
    resolvedPending.add(`medical.medications.${med.name}.remaining`);
    const planned = created.find((k) => k.kind !== "device" && k.kind !== "condition" && sameMedication(k.label, med.name));
    if (planned) {
      if (planned.value == null) Object.assign(planned, { value: ch.value, unit: ch.unit, confirmed: true });
      continue;
    }
    const existing = rows.clocks.find((k) => k.kind !== "device" && k.kind !== "condition" && sameMedication(k.label, med.name));
    if (existing) {
      if (existing.value == null) {
        updates.push({ id: existing.id, value: ch.value, unit: ch.unit });
        fields.push(`clocks.${existing.id}`);
      }
      continue;
    }
    const k: NewClock = { ...medicationClockSpec(med.category, med.name), id: `k-${personId}-${shortId()}`, value: ch.value, unit: ch.unit, confirmed: true };
    created.push(k);
    fields.push(`clocks.${k.id}`);
  }

  let sort = rows.clocks.reduce((m, k) => Math.max(m, k.sort), -1);
  return {
    fields,
    resolvedPending,
    count: created.length + updates.length,
    /** guardArgs は ?1 経過の行の id・?2 本人の id・?3 時刻 */
    build(db: D1Database, guard: string, guardArgs: GuardArgs): Statement[] {
      const stamp = guardArgs[2];
      return [
        ...updates.map((u) =>
          db
            .prepare(
              `UPDATE clocks SET value = ?5, unit = ?6, source = 'care_manager', confirmed_at = ?3
                WHERE id = ?4 AND person_id = ?2 AND value IS NULL AND ${guard}`,
            )
            .bind(...guardArgs, u.id, u.value, u.unit),
        ),
        ...created.map((k) =>
          db
            .prepare(
              `INSERT INTO clocks (id, person_id, kind, category, label, value, unit, starts_on, source, confirmed_at, sort)
               SELECT ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13 WHERE ${guard}`,
            )
            .bind(
              ...guardArgs,
              k.id,
              k.kind,
              k.category,
              k.label,
              k.value,
              k.unit,
              k.starts_on,
              k.confirmed ? "care_manager" : null,
              k.confirmed ? stamp : null,
              ++sort,
            ),
        ),
      ];
    },
  };
}
