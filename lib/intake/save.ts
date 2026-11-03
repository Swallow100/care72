// 入れる欄の保存（T03）。画面で人が確かめた変更（Claude の分け方・問いの答え・手入力）を、今の台帳に当て直して書く。
//
// - 書けるのはケアマネの役だけ（審査員のケアマネの役を含む）。本人は personInScope を通した事業所の中の人だけ
// - 版（people.version）が画面で読んだときと違えば書かない（競合）。ほかの人の保存を上書きしない
// - 埋まっている欄は変えない（人が既入力を選んだときだけ上書き。lib/db/ledger.ts の applyLedgerChanges）
// - 連絡先は空いた所だけを埋める（夜間・続柄・名前・電話・備考）。足す人の名前と電話は人が画面で入れた物
// - 時計: 機器・薬を入れたら値の空いた時計を機械的に作る（医療依存の印。lib/intake/marks.ts）。値は人が問いに答えた物だけ
// - 計画の状態が未作成なら下書きにする。経過に「入力」を 1 行（kind note、payload の source が intake。値は残さず場所だけ）
// - 本人のページの面の「編集」（T45、edit）は手の入力: 埋まった欄・薬・機器・連絡先・時計も上書きでき（overwrite）、
//   同意と時計の頼り先の確認（経過に clock_check の行）も変えられる。経過の本文は「ケアマネが直した」。AI の分け方とは混ぜない
// - 全部を 1 つの batch（取引）で。台帳の版が上がったときだけ、ほかの文が効く（guard）

import type { D1Database } from "@cloudflare/workers-types";
import * as z from "zod";
import type { Principal } from "../auth/principal.ts";
import { applyLedgerChanges, parseLedger, sameMedication } from "../db/ledger.ts";
import {
  CHECK_STATUSES,
  CLOCK_UNITS,
  CONSENT_KINDS,
  CONSENT_STATUSES,
  DEVICE_KINDS,
  HAZARD_KINDS,
  INTAKE_SOURCE,
  MEDICATION_CATEGORIES,
  PENDING_STATUSES,
  type CheckStatus,
  type ClockRow,
  type ConsentKind,
  type ConsentStatus,
  type IntakePayload,
  type Ledger,
  type PlanStatus,
} from "../db/types.ts";
import { PENDING_STATUS_LABELS } from "../labels.ts";
import { clockCheckEntry, type MarkAuthor, type NewTimelineEntry } from "../ledger-marks.ts";
import { loadPersonPage, pendingClockId, type PersonPageRows } from "../person.ts";
import type { IntakeChange } from "./changes.ts";
import { labelOfKey } from "./diff.ts";
import { INTAKE_KEYS } from "./fields.ts";
import { DEVICE_CLOCKS, MEDICATION_CLOCKS, planMarkClocks, type MarkClock } from "./marks.ts";
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
    overwrite: z.boolean().optional(),
  }),
  z.object({
    t: z.literal("device"),
    value: z.object({ kind: z.enum(DEVICE_KINDS), detail: text(200).optional(), schedule: text(200).optional() }),
    overwrite: z.boolean().optional(),
  }),
  z.object({
    t: z.literal("hazard"),
    value: z.object({ kind: z.enum(HAZARD_KINDS), depthM: z.number().min(0).max(100).optional() }),
    overwrite: z.boolean().optional(),
  }),
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
      nightOk: z.boolean().nullable().optional(),
      note: text(200).optional(),
    }),
    overwrite: z.boolean().optional(),
  }),
  z.object({
    t: z.literal("clock"),
    clockId: z.string().regex(ID).nullable(),
    medIndex: z.number().int().min(0).max(200).nullable(),
    label: text(100).min(1),
    value: z.number().min(0).max(10000),
    unit: z.enum(CLOCK_UNITS),
    overwrite: z.boolean().optional(),
  }),
  z.object({ t: z.literal("clockCheck"), clockId: z.string().regex(ID), to: z.enum(CHECK_STATUSES) }),
  z.object({ t: z.literal("clockSeen"), clockId: z.string().regex(ID) }),
  z.object({
    t: z.literal("remove"),
    target: z.discriminatedUnion("what", [
      z.object({ what: z.literal("field"), key: z.enum(INTAKE_KEYS) }),
      z.object({ what: z.literal("medication"), index: z.number().int().min(0).max(200), name: text(100).min(1) }),
      z.object({ what: z.literal("device"), kind: z.enum(DEVICE_KINDS) }),
      z.object({ what: z.literal("hazard"), kind: z.enum(HAZARD_KINDS) }),
      z.object({ what: z.literal("note"), value: text(1000).min(1) }),
      z.object({ what: z.literal("contact"), id: z.string().regex(ID) }),
    ]),
  }),
  z.object({ t: z.literal("consent"), kind: z.enum(CONSENT_KINDS), status: z.enum(CONSENT_STATUSES) }),
]);

export const SaveRequestSchema = z
  .object({
    personId: z.string().regex(ID),
    /** 画面で読んだときの台帳の版 */
    version: z.number().int().min(1),
    /** Claude の分け方を使ったとき、答えたモデル（経過の AI の印） */
    ai: z.object({ model: z.string().regex(/^claude-[a-z0-9-]{1,48}$/) }).nullable(),
    /** 本人のページの面の「編集」で手で直した（経過に「ケアマネが直した」）。AI の分け方とは一緒に送らない */
    edit: z.boolean().optional(),
    changes: z.array(ChangeSchema).min(1).max(200),
  })
  // 上書き・同意・頼り先の確認は人が手で直すときだけ（AI の分け方の保存に混ぜない）
  .refine((r) => !(r.edit && r.ai !== null), { message: "edit_with_ai" })
  .refine((r) => r.edit === true || !r.changes.some((c) => editOnly(c as IntakeChange)), {
    message: "edit_only",
  });

export type SaveRequest = z.output<typeof SaveRequestSchema>;

export type SaveResult =
  | { ok: true; changed: number; version: number; plan: PlanStatus; fields: string[] }
  | { ok: false; error: "not_found" | "forbidden" | "conflict" };

type Statement = ReturnType<D1Database["prepare"]>;

/**
 * 経過の本文の頭: AI の分け方を人が確かめた・問いへの答え（手入力）・本人のページの面で手で直した・外した・値を確かめた。
 * 手で直したときは 1 つの保存で「ケアマネが直した: 〜。ケアマネが外した: 〜」と並べる
 */
export const TIMELINE_SOURCES = {
  ai: "AI の分け方、人が確認",
  manual: "手入力",
  edit: "ケアマネが直した",
  removed: "ケアマネが外した",
  seen: "ケアマネが確認した",
} as const;

function namesOf(fields: ReadonlyArray<string>, pending: Ledger["pending"] = []): string {
  const names = [
    ...new Set([...fields.map(fieldName), ...pending.map((p) => `${fieldName(p.field)}（${PENDING_STATUS_LABELS[p.status]}）`)]),
  ];
  const shown = names.slice(0, 10).join("・");
  const more = names.length > 10 ? ` ほか ${names.length - 10}` : "";
  return `${shown}${more}`;
}

/** 経過の本文: 「AI の分け方、人が確認」「手入力」「ケアマネが直した」と、変えた欄の名前（10 まで）。空欄の理由は「名前（不明）」 */
export function timelineBody(
  ai: boolean,
  fields: ReadonlyArray<string>,
  pending: Ledger["pending"] = [],
  edit = false,
  extra: { removed?: ReadonlyArray<string>; seen?: ReadonlyArray<string> } = {},
): string {
  const removed = extra.removed ?? [];
  const seen = extra.seen ?? [];
  const parts: string[] = [];
  if (fields.length > 0 || pending.length > 0 || (removed.length === 0 && seen.length === 0)) {
    parts.push(`${TIMELINE_SOURCES[ai ? "ai" : edit ? "edit" : "manual"]}: ${namesOf(fields, pending)}`);
  }
  if (removed.length > 0) parts.push(`${TIMELINE_SOURCES.removed}: ${namesOf(removed)}`);
  if (seen.length > 0) parts.push(`${TIMELINE_SOURCES.seen}: ${namesOf(seen)}`);
  return parts.join("。");
}

/** 手で直すときだけの変更（上書き・同意・頼り先の確認・外す・値の確認）。AI の分け方・問いの答えの保存には混ぜない */
function editOnly(c: IntakeChange): boolean {
  if (c.t === "consent" || c.t === "clockCheck" || c.t === "remove" || c.t === "clockSeen") return true;
  return c.t !== "field" && "overwrite" in c && c.overwrite === true;
}

function fieldName(field: string): string {
  if (field.startsWith("contacts.")) return "連絡先";
  if (field.startsWith("clocks.")) return "時計";
  if (field.startsWith("consent.")) return "同意";
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

/** 薬を名前で指す場所（medical.medications.ワーファリン.amount）。経過の payload に残さない */
const MED_NAME_FIELD = /^medical\.medications\.(?!\d+(\.|$))[^.]+\./;

/**
 * 保存する。personInScope を通らない本人は not_found、ケアマネの役でなければ forbidden、版が違えば conflict。
 * 何も変わらなければ書かずに changed 0
 */
export async function saveIntake(db: D1Database, principal: Principal, req: SaveRequest, now = new Date()): Promise<SaveResult> {
  if (principal.role !== "care_manager") return { ok: false, error: "forbidden" };
  const edit = req.edit === true;
  // 上書き・同意・頼り先の確認は手で直すときだけ。AI の分け方と一緒には送らない（SaveRequestSchema と同じ）
  if ((edit && req.ai !== null) || (!edit && (req.changes as IntakeChange[]).some(editOnly))) return { ok: false, error: "forbidden" };
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

  // ---- 頼り先の確認・同意（手で直すときだけ） ----
  const checkOps = planClockChecks(rows, changes, principal.accountId, stamp);
  fields.push(...checkOps.fields);
  const consentOps = planConsents(rows, changes);
  fields.push(...consentOps.fields);

  // ---- 外す・値の確認（手で直すときだけ。経過に「ケアマネが外した」「ケアマネが確認した」） ----
  const removeOps = planRemovals(rows, before, changes);
  const removedFields = [...applied.removed, ...removeOps.removed];
  const seenOps = planClockSeen(rows, changes);

  const ledgerChanged = JSON.stringify(ledger) !== JSON.stringify(before);
  const changed =
    (ledgerChanged ? 1 : 0) + contactOps.count + clockOps.count + checkOps.count + consentOps.count + removeOps.count + seenOps.count;
  const plan: PlanStatus = rows.person.plan_status === "none" ? "draft" : rows.person.plan_status;
  if (changed === 0) return { ok: true, changed: 0, version: req.version, plan: rows.person.plan_status, fields: [] };

  const next = req.version + 1;
  const payload: IntakePayload = {
    source: INTAKE_SOURCE,
    ai: req.ai !== null,
    model: req.ai?.model ?? null,
    ...(edit ? { edit: true as const } : {}),
    // 場所だけ残す。薬の名前の形（medical.medications.<名前>.〜）は名前が値なので、番号の形だけ
    fields: [...new Set([...fields, ...removedFields, ...seenOps.fields, ...applied.pending.map((p) => p.field)])].filter(
      (f) => !MED_NAME_FIELD.test(f),
    ),
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
        timelineBody(req.ai !== null, fields, applied.pending, edit, { removed: removedFields, seen: seenOps.fields }),
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
    ...checkOps.build(db, GUARD, guardArgs),
    ...consentOps.build(db, GUARD, guardArgs, principal.accountId),
    ...removeOps.build(db, GUARD, guardArgs),
    ...seenOps.build(db, GUARD, guardArgs),
  ];

  const results = await db.batch(stmts);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) return { ok: false, error: "conflict" };
  return { ok: true, changed, version: next, plan, fields: payload.fields };
}

// ---------- 連絡先 ----------

type ContactChange = Extract<IntakeChange, { t: "contact" }>;

function planContacts(rows: PersonPageRows, changes: ReadonlyArray<IntakeChange>, personId: string) {
  const updates: Array<{ id: string; set: Array<[string, string | number | null]>; overwrite: boolean }> = [];
  const inserts: Array<{ id: string; c: ContactChange["value"]; sort: number }> = [];
  const fields: string[] = [];
  let sort = rows.contacts.reduce((m, c) => Math.max(m, c.sort), -1);
  for (const ch of changes) {
    if (ch.t !== "contact") continue;
    const v = ch.value;
    if (ch.id && ch.overwrite) {
      // 手で直す（編集）。渡した所を渡したとおりに（空の文字は消す）。本人の行（self）は直さない
      const cur = rows.contacts.find((c) => c.id === ch.id);
      if (!cur || cur.kind === "self") continue;
      const set: Array<[string, string | number | null]> = [];
      for (const col of ["relation", "name", "phone", "note"] as const) {
        if (!(col in v)) continue;
        const next = v[col]?.trim() || null;
        if (next !== (cur[col] ?? null)) set.push([col, next]);
      }
      if (v.nightOk !== undefined) {
        const next = v.nightOk === null ? null : v.nightOk ? 1 : 0;
        if (next !== (cur.night_ok ?? null)) set.push(["night_ok", next]);
      }
      if (set.length === 0) continue;
      updates.push({ id: cur.id, set, overwrite: true });
      fields.push(`contacts.${cur.id}`);
      continue;
    }
    if (ch.id) {
      const cur = rows.contacts.find((c) => c.id === ch.id);
      if (!cur || cur.kind === "self") continue;
      const set: Array<[string, string | number | null]> = [];
      if (typeof v.nightOk === "boolean" && cur.night_ok == null) set.push(["night_ok", v.nightOk ? 1 : 0]);
      if (v.relation && !cur.relation) set.push(["relation", v.relation]);
      if (v.name && !cur.name) set.push(["name", v.name]);
      if (v.phone && !cur.phone) set.push(["phone", v.phone]);
      if (v.note && !cur.note) set.push(["note", v.note]);
      if (set.length === 0) continue;
      updates.push({ id: cur.id, set, overwrite: false });
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
          // 空いた所だけ（COALESCE で今の値を残す。読んだあとに埋まった所も上書きしない）。手で直すときは渡した値に
          const sets = u.set.map(([col], i) => (u.overwrite ? `${col} = ?${i + 5}` : `${col} = COALESCE(${col}, ?${i + 5})`)).join(", ");
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
              n.c.nightOk == null ? null : n.c.nightOk ? 1 : 0,
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
  const updates: Array<{ id: string; value: number; unit: NonNullable<ClockRow["unit"]>; overwrite: boolean }> = [];
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
      if (!cur || cur.kind === "condition") continue;
      // 値の入った時計は、手で直すとき（overwrite）だけ変える。同じ値なら変えない
      if (cur.value != null && (!ch.overwrite || (cur.value === ch.value && cur.unit === ch.unit))) continue;
      updates.push({ id: cur.id, value: ch.value, unit: ch.unit, overwrite: ch.overwrite === true });
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
        updates.push({ id: existing.id, value: ch.value, unit: ch.unit, overwrite: false });
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
              // 手で直すとき（overwrite）は値の入った時計も変える。出典はケアマネ、確認はこの時刻
              `UPDATE clocks SET value = ?5, unit = ?6, source = 'care_manager', confirmed_at = ?3
                WHERE id = ?4 AND person_id = ?2 ${u.overwrite ? "" : "AND value IS NULL"} AND ${guard}`,
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

// ---------- 時計の頼り先の確認（手で直すときだけ） ----------

function planClockChecks(rows: PersonPageRows, changes: ReadonlyArray<IntakeChange>, accountId: string | null, stamp: string) {
  // 書き手はケアマネ（人）。lib/ledger-marks.ts が人の役かを確かめる
  const by: MarkAuthor = { id: accountId ?? "", role: "care_manager" };
  const entries: Array<{ clockId: string; to: CheckStatus; entry: NewTimelineEntry }> = [];
  for (const ch of changes) {
    if (ch.t !== "clockCheck") continue;
    const cur = rows.clocks.find((k) => k.id === ch.clockId);
    // 頼り先の無い時計・同じ状態・同じ時計の二度目は付けない
    if (!cur || cur.depends_on == null || cur.depends_check === ch.to || entries.some((e) => e.clockId === cur.id)) continue;
    entries.push({ clockId: cur.id, to: ch.to, entry: clockCheckEntry({ id: `t-${rows.person.id}-${shortId()}`, clock: cur, to: ch.to, by, at: stamp }) });
  }
  return {
    fields: entries.map((e) => `clocks.${e.clockId}`),
    count: entries.length,
    /** guardArgs は ?1 経過の行の id・?2 本人の id・?3 時刻 */
    build(db: D1Database, guard: string, guardArgs: GuardArgs): Statement[] {
      return entries.flatMap(({ clockId, to, entry: t }) => [
        db
          .prepare(`UPDATE clocks SET depends_check = ?5 WHERE id = ?4 AND person_id = ?2 AND depends_on IS NOT NULL AND ${guard}`)
          .bind(...guardArgs, clockId, to),
        // 頼り先の確認の経過の行（lib/ledger-marks.ts。kind clock_check）
        db
          .prepare(
            `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at, created_at)
             SELECT ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?3, ?3 WHERE ${guard}`,
          )
          .bind(...guardArgs, t.id, accountId, t.author_role, t.kind, t.body, t.payload),
      ]);
    },
  };
}

// ---------- 同意（手で直すときだけ） ----------

function planConsents(rows: PersonPageRows, changes: ReadonlyArray<IntakeChange>) {
  const sets = new Map<ConsentKind, ConsentStatus>();
  for (const ch of changes) {
    if (ch.t !== "consent") continue;
    const cur = rows.consents.find((c) => c.kind === ch.kind)?.status ?? "unconfirmed";
    if (cur === ch.status) sets.delete(ch.kind);
    else sets.set(ch.kind, ch.status);
  }
  const list = [...sets];
  return {
    fields: list.map(([kind]) => `consent.${kind}`),
    count: list.length,
    /** 記録した人と時刻を同じ行に残す（経過の「同意」は lib/person.ts が記録の時刻から作る） */
    build(db: D1Database, guard: string, guardArgs: GuardArgs, accountId: string | null): Statement[] {
      return list.map(([kind, status]) =>
        db
          .prepare(
            `INSERT INTO consents (person_id, kind, status, recorded_by, recorded_at)
             SELECT ?2, ?4, ?5, ?6, ?3 WHERE ${guard}
             ON CONFLICT (person_id, kind) DO UPDATE SET status = excluded.status, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`,
          )
          .bind(...guardArgs, kind, status, accountId),
      );
    },
  };
}

// ---------- 外す（手で直すときだけ） ----------

/**
 * 連絡先の行を消し、外した薬・機器の時計を消す（印が残らないように）。本人の行（self）は消さない。
 * 台帳の中の物（欄・薬・機器・ハザード・特記）は applyLedgerChanges が外す
 */
function planRemovals(rows: PersonPageRows, before: Ledger, changes: ReadonlyArray<IntakeChange>) {
  const contactIds = new Set<string>();
  const clockIds = new Set<string>();
  for (const ch of changes) {
    if (ch.t !== "remove") continue;
    const r = ch.target;
    if (r.what === "contact") {
      const cur = rows.contacts.find((c) => c.id === r.id);
      if (cur && cur.kind !== "self") contactIds.add(cur.id);
    } else if (r.what === "medication") {
      const med = before.medical.medications[r.index];
      if (!med || med.name !== r.name) continue;
      for (const k of rows.clocks) if (k.kind !== "device" && k.kind !== "condition" && sameMedication(k.label, med.name)) clockIds.add(k.id);
    } else if (r.what === "device") {
      if (!before.medical.devices.some((d) => d.kind === r.kind)) continue;
      const category = DEVICE_CLOCKS[r.kind].category;
      for (const k of rows.clocks) if ((k.kind === "device" || k.kind === "supply") && k.category === category) clockIds.add(k.id);
    }
  }
  const removed = [...[...contactIds].map((id) => `contacts.${id}`), ...[...clockIds].map((id) => `clocks.${id}`)];
  return {
    removed,
    count: contactIds.size + clockIds.size,
    /** guardArgs は ?1 経過の行の id・?2 本人の id・?3 時刻 */
    build(db: D1Database, guard: string, guardArgs: GuardArgs): Statement[] {
      return [
        ...[...contactIds].map((id) =>
          db.prepare(`DELETE FROM contacts WHERE id = ?4 AND person_id = ?2 AND kind <> 'self' AND ${guard}`).bind(...guardArgs, id),
        ),
        ...[...clockIds].map((id) => db.prepare(`DELETE FROM clocks WHERE id = ?4 AND person_id = ?2 AND ${guard}`).bind(...guardArgs, id)),
      ];
    },
  };
}

// ---------- 時計の値を確かめた（手で直すときだけ） ----------

/** 値の入った時計の確認の日付を今にする（値・単位・出典は変えない） */
function planClockSeen(rows: PersonPageRows, changes: ReadonlyArray<IntakeChange>) {
  const ids = new Set<string>();
  for (const ch of changes) {
    if (ch.t !== "clockSeen") continue;
    const cur = rows.clocks.find((k) => k.id === ch.clockId);
    if (cur && cur.value != null && cur.kind !== "condition") ids.add(cur.id);
  }
  return {
    fields: [...ids].map((id) => `clocks.${id}`),
    count: ids.size,
    build(db: D1Database, guard: string, guardArgs: GuardArgs): Statement[] {
      return [...ids].map((id) =>
        db
          .prepare(`UPDATE clocks SET confirmed_at = ?3 WHERE id = ?4 AND person_id = ?2 AND value IS NOT NULL AND ${guard}`)
          .bind(...guardArgs, id),
      );
    },
  };
}
