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
  CLOCK_CATEGORIES,
  CLOCK_SOURCES,
  CLOCK_UNITS,
  CONSENT_KINDS,
  CONTACT_REACHES,
  CONSENT_STATUSES,
  DEVICE_KINDS,
  HAZARD_KINDS,
  INTAKE_SOURCE,
  MEDICATION_CATEGORIES,
  PENDING_STATUSES,
  type CheckStatus,
  type ClockCategory,
  type ClockRow,
  type ConsentKind,
  type ConsentStatus,
  type IntakePayload,
  type Ledger,
  type PlanStatus,
} from "../db/types.ts";
import { PENDING_STATUS_LABELS } from "../labels.ts";
import { clockCheckEntry, type MarkAuthor, type NewTimelineEntry } from "../ledger-marks.ts";
import { applyEvacMap, EVAC_MAP_FIELDS, EvacMapSchema } from "../map/route-edit.ts";
import { loadPersonPage, pendingClockId, type PersonPageRows } from "../person.ts";
import type { IntakeChange } from "./changes.ts";
import { labelOfKey } from "./diff.ts";
import { ADDRESS_MAX } from "./edit.ts";
import { INTAKE_KEYS } from "./fields.ts";
import { DEVICE_CLOCKS, MEDICATION_CLOCKS, markClockIds, planMarkClocks, type MarkClock } from "./marks.ts";
import { CONTACT_KINDS_FOR_EDIT } from "./schema.ts";
import { PDF_PAGES_MAX, READ_SOURCES, REDACTED_MAX, readTimelineHead, type ReadMeta } from "./read-form.ts";

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
    value: z.object({ kind: z.enum(HAZARD_KINDS), depthM: z.number().min(0).max(100).optional(), note: text(60).optional() }),
    overwrite: z.boolean().optional(),
  }),
  z.object({ t: z.literal("note"), value: text(1000).min(1) }),
  z.object({ t: z.literal("pending"), field: z.string().regex(/^[^\s]{1,120}$/), status: z.enum(PENDING_STATUSES) }),
  z.object({
    t: z.literal("contact"),
    id: z.string().regex(ID).nullable(),
    value: z.object({
      kind: z.enum(CONTACT_KINDS_FOR_EDIT),
      relation: text(40).optional(),
      name: text(60).optional(),
      phone: z.string().trim().regex(/^[0-9+\-() ]{0,20}$/).optional(),
      nightOk: z.boolean().nullable().optional(),
      note: text(200).optional(),
      emergencyOrder: z.number().int().min(1).max(9).nullable().optional(),
      supporterOrder: z.number().int().min(1).max(9).nullable().optional(),
      reach: z.enum(CONTACT_REACHES).nullable().optional(),
      // スマホ・車の有無（T68）。手で直すときだけ
      hasSmartphone: z.boolean().nullable().optional(),
      hasCar: z.boolean().nullable().optional(),
    }),
    overwrite: z.boolean().optional(),
  }),
  // 本人の住所（市・町名）と地図の位置（T68）。手で直すときだけ。null は外す。
  // 緯度はウェブメルカトルの描ける範囲（±85。lib/map/geo.ts の isGeoPoint と同じ）
  z.object({ t: z.literal("address"), value: z.object({ city: text(ADDRESS_MAX.city).min(1), town: text(ADDRESS_MAX.town).min(1) }).nullable() }),
  z.object({
    t: z.literal("location"),
    value: z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }).nullable(),
  }),
  // 避難先 1・2 の位置と避難経路の地図（T102）。手で直すときだけ（経路地図の画面の保存）
  z.object({ t: z.literal("evacMap"), value: EvacMapSchema }),
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
  // 時計を手で足す・起点を変える（T57）。状態（condition）と認知症は足せない（台帳の印から作る）
  z.object({
    t: z.literal("clockAdd"),
    value: z
      .object({
        label: text(100).min(1),
        kind: z.enum(["device", "supply", "medication"]),
        category: z.enum(CLOCK_CATEGORIES.filter((c) => c !== "dementia") as [Exclude<ClockCategory, "dementia">, ...Array<Exclude<ClockCategory, "dementia">>]),
        value: z.number().min(0).max(10000).nullable(),
        unit: z.enum(CLOCK_UNITS).nullable(),
        startsOn: z.enum(["outage", "disaster"]),
        source: z.enum(CLOCK_SOURCES).nullable(),
        sourceNote: text(100).optional(),
      })
      // 値があれば単位も（clocks の CHECK と同じ）
      .refine((v) => v.value === null || v.unit !== null, { message: "unit" }),
  }),
  z.object({ t: z.literal("clockStart"), clockId: z.string().regex(ID), to: z.enum(["outage", "disaster"]) }),
  z.object({
    t: z.literal("remove"),
    target: z.discriminatedUnion("what", [
      z.object({ what: z.literal("field"), key: z.enum(INTAKE_KEYS) }),
      z.object({ what: z.literal("medication"), index: z.number().int().min(0).max(200), name: text(100).min(1) }),
      z.object({ what: z.literal("device"), kind: z.enum(DEVICE_KINDS) }),
      z.object({ what: z.literal("hazard"), kind: z.enum(HAZARD_KINDS) }),
      z.object({ what: z.literal("note"), value: text(1000).min(1) }),
      z.object({ what: z.literal("contact"), id: z.string().regex(ID) }),
      z.object({ what: z.literal("clock"), id: z.string().regex(ID) }),
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
    /** 写真・PDF を黒塗りして読んだ（T52）。経過の頭に「写真を読んだ（隠した所 N か所）」。AI の分け方の保存だけ */
    read: z
      .object({ source: z.enum(READ_SOURCES), page: z.number().int().min(1).max(PDF_PAGES_MAX), redacted: z.number().int().min(0).max(REDACTED_MAX) })
      .optional(),
    changes: z.array(ChangeSchema).min(1).max(200),
  })
  // 上書き・同意・頼り先の確認は人が手で直すときだけ（AI の分け方の保存に混ぜない）
  .refine((r) => !(r.edit && r.ai !== null), { message: "edit_with_ai" })
  .refine((r) => r.read === undefined || r.ai !== null, { message: "read_without_ai" })
  .refine((r) => r.edit === true || !r.changes.some((c) => editOnly(c as IntakeChange)), {
    message: "edit_only",
  });

export type SaveRequest = z.output<typeof SaveRequestSchema>;

export type SaveResult =
  | { ok: true; changed: number; version: number; plan: PlanStatus; fields: string[] }
  /** order_clash: 同じ緊急・支援の順を 2 人に付けた（T57。画面も保存の前に止める） */
  | { ok: false; error: "not_found" | "forbidden" | "conflict" | "order_clash" | "self_twice" };

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
  extra: { removed?: ReadonlyArray<string>; seen?: ReadonlyArray<string>; read?: ReadMeta } = {},
): string {
  const removed = extra.removed ?? [];
  const seen = extra.seen ?? [];
  const parts: string[] = [];
  if (fields.length > 0 || pending.length > 0 || (removed.length === 0 && seen.length === 0)) {
    parts.push(`${TIMELINE_SOURCES[ai ? "ai" : edit ? "edit" : "manual"]}: ${namesOf(fields, pending)}`);
  }
  if (removed.length > 0) parts.push(`${TIMELINE_SOURCES.removed}: ${namesOf(removed)}`);
  if (seen.length > 0) parts.push(`${TIMELINE_SOURCES.seen}: ${namesOf(seen)}`);
  // 写真・PDF を黒塗りして読んだときは頭に（「写真を読んだ（隠した所 3 か所）。AI の分け方、人が確認: 〜」）
  if (extra.read) parts.unshift(readTimelineHead(extra.read));
  return parts.join("。");
}

/** 手で直すときだけの変更（上書き・同意・頼り先の確認・外す・値の確認）。AI の分け方・問いの答えの保存には混ぜない */
function editOnly(c: IntakeChange): boolean {
  if (c.t === "consent" || c.t === "clockCheck" || c.t === "remove" || c.t === "clockSeen" || c.t === "clockAdd" || c.t === "clockStart") return true;
  // 住所・位置は手入力だけ（T68。AI の分け方に足さない。町名が仮名化の門の前に Claude へ届かないように）
  if (c.t === "address" || c.t === "location") return true;
  // 避難先の位置と経路地図も手入力だけ（T102。経路地図の画面の保存）
  if (c.t === "evacMap") return true;
  // 緊急・支援の順は人が決める（AI の分け方・問いの答えからは付けない。docs/PROGRESS.md の T03 の決め、T57）。
  // スマホ・車の有無と本人の電話（self）も手で直すときだけ（T68）
  if (
    c.t === "contact" &&
    (c.value.emergencyOrder !== undefined ||
      c.value.supporterOrder !== undefined ||
      c.value.reach !== undefined ||
      c.value.hasSmartphone !== undefined ||
      c.value.hasCar !== undefined ||
      c.value.kind === "self")
  ) {
    return true;
  }
  return c.t !== "field" && "overwrite" in c && c.overwrite === true;
}

function fieldName(field: string): string {
  if (field === "basic.address") return "住所";
  if (field === "basic.location") return "位置";
  if (field in EVAC_MAP_FIELDS) return EVAC_MAP_FIELDS[field as keyof typeof EVAC_MAP_FIELDS];
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

  // ---- 住所・位置（T68。手で直すときだけ。台帳の basic に書き、版を 1 つ上げる今の形） ----
  const place = applyPlace(ledger, changes);
  ledger = place.ledger;
  fields.push(...place.fields);
  // ---- 避難先の位置と経路地図（T102。手で直すときだけ。台帳の evacuation に） ----
  const evac = applyEvacMap(ledger, changes);
  ledger = evac.ledger;
  fields.push(...evac.fields);

  // ---- 連絡先 ----
  // 同じ緊急・支援の順を 2 人に付ける保存は断る（ルールの表の「支援者」と様式の ①② が崩れる）。今ある重なりに触れない保存は通す
  if (contactOrderClash(rows, changes)) return { ok: false, error: "order_clash" };
  // 本人の電話（self）は 1 人 1 つ（T68。画面も selfTwice で保存の前に止める）
  if (selfContactTwice(rows, changes)) return { ok: false, error: "self_twice" };
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
  const removeOps = planRemovals(rows, before, changes, ledger);
  const removedFields = [...applied.removed, ...removeOps.removed];
  const seenOps = planClockSeen(rows, changes);
  // ---- 時計を手で足す・起点（T57。手で直すときだけ） ----
  const manualOps = planManualClocks(rows, changes, personId);
  fields.push(...manualOps.fields);

  const ledgerChanged = JSON.stringify(ledger) !== JSON.stringify(before);
  const changed =
    (ledgerChanged ? 1 : 0) +
    contactOps.count +
    clockOps.count +
    checkOps.count +
    consentOps.count +
    removeOps.count +
    seenOps.count +
    manualOps.count;
  const plan: PlanStatus = rows.person.plan_status === "none" ? "draft" : rows.person.plan_status;
  if (changed === 0) return { ok: true, changed: 0, version: req.version, plan: rows.person.plan_status, fields: [] };

  const next = req.version + 1;
  const payload: IntakePayload = {
    source: INTAKE_SOURCE,
    ai: req.ai !== null,
    model: req.ai?.model ?? null,
    ...(edit ? { edit: true as const } : {}),
    ...(req.read && req.ai !== null ? { read: req.read } : {}),
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
        timelineBody(req.ai !== null, fields, applied.pending, edit, {
          removed: removedFields,
          seen: seenOps.fields,
          read: req.ai !== null ? req.read : undefined,
        }),
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
    ...manualOps.build(db, GUARD, guardArgs),
  ];

  const results = await db.batch(stmts);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) return { ok: false, error: "conflict" };
  return { ok: true, changed, version: next, plan, fields: payload.fields };
}

// ---------- 住所・位置（T68） ----------

/**
 * 住所（市・町名）と位置を台帳の basic に当てる。null は外す。同じ値なら変えない。
 * 新しい町名は保存のあと台帳から読まれるので、次の Claude の呼び出しから仮名化の門（lib/pseudonym の buildKey）が伏せる
 */
export function applyPlace(ledger: Ledger, changes: ReadonlyArray<IntakeChange>): { ledger: Ledger; fields: string[] } {
  let out = ledger;
  const fields = new Set<string>();
  for (const c of changes) {
    if (c.t === "address") {
      const cur = out.basic.address;
      const next = c.value ? { city: c.value.city.trim(), town: c.value.town.trim() } : null;
      if (next && (!next.city || !next.town)) continue;
      if (next === null ? cur === undefined : cur?.city === next.city && cur?.town === next.town) continue;
      const basic = { ...out.basic };
      if (next) basic.address = next;
      else delete basic.address;
      out = { ...out, basic };
      fields.add("basic.address");
    }
    if (c.t === "location") {
      const cur = out.basic.location;
      const next = c.value ? { lat: c.value.lat, lng: c.value.lng } : null;
      if (next === null ? cur === undefined : cur?.lat === next.lat && cur?.lng === next.lng) continue;
      const basic = { ...out.basic };
      if (next) basic.location = next;
      else delete basic.location;
      out = { ...out, basic };
      fields.add("basic.location");
    }
  }
  return { ledger: out, fields: [...fields] };
}

// ---------- 連絡先 ----------

type ContactChange = Extract<IntakeChange, { t: "contact" }>;

/** 保存のあとに本人の電話（self）が 2 つになるか（T68）。外さない今の行と、足す self の行を数える（外して足し直すのは通る） */
export function selfContactTwice(rows: Pick<PersonPageRows, "contacts">, changes: ReadonlyArray<IntakeChange>): boolean {
  const removed = new Set(changes.flatMap((c) => (c.t === "remove" && c.target.what === "contact" ? [c.target.id] : [])));
  const now = rows.contacts.filter((c) => c.kind === "self" && !removed.has(c.id)).length;
  const added = changes.filter((c) => c.t === "contact" && c.id === null && c.value.kind === "self").length;
  return added > 0 && now + added > 1;
}

function planContacts(rows: PersonPageRows, changes: ReadonlyArray<IntakeChange>, personId: string) {
  const updates: Array<{ id: string; set: Array<[string, string | number | null]>; overwrite: boolean }> = [];
  const inserts: Array<{ id: string; c: ContactChange["value"]; sort: number }> = [];
  const fields: string[] = [];
  let sort = rows.contacts.reduce((m, c) => Math.max(m, c.sort), -1);
  for (const ch of changes) {
    if (ch.t !== "contact") continue;
    const v = ch.value;
    if (ch.id && ch.overwrite) {
      // 手で直す（編集）。渡した所を渡したとおりに（空の文字は消す）。
      // 本人の行（self）は電話と備考だけ（T68）。ほかの行を self に変えない・self をほかに変えない
      const cur = rows.contacts.find((c) => c.id === ch.id);
      if (!cur || (cur.kind === "self") !== (v.kind === "self")) continue;
      const set: Array<[string, string | number | null]> = [];
      for (const col of cur.kind === "self" ? (["phone", "note"] as const) : (["relation", "name", "phone", "note"] as const)) {
        if (!(col in v)) continue;
        const next = v[col]?.trim() || null;
        if (next !== (cur[col] ?? null)) set.push([col, next]);
      }
      if (cur.kind === "self") {
        if (set.length === 0) continue;
        updates.push({ id: cur.id, set, overwrite: true });
        fields.push(`contacts.${cur.id}`);
        continue;
      }
      if (v.nightOk !== undefined) {
        const next = v.nightOk === null ? null : v.nightOk ? 1 : 0;
        if (next !== (cur.night_ok ?? null)) set.push(["night_ok", next]);
      }
      if (v.emergencyOrder !== undefined && v.emergencyOrder !== (cur.emergency_order ?? null)) set.push(["emergency_order", v.emergencyOrder]);
      if (v.supporterOrder !== undefined && v.supporterOrder !== (cur.supporter_order ?? null)) set.push(["supporter_order", v.supporterOrder]);
      if (v.reach !== undefined && v.reach !== (cur.reach ?? null)) set.push(["reach", v.reach]);
      // スマホ・車の有無（T68。null は未確認に戻す）
      for (const [key, col] of [
        ["hasSmartphone", "has_smartphone"],
        ["hasCar", "has_car"],
      ] as const) {
        if (v[key] === undefined) continue;
        const next = v[key] === null ? null : v[key] ? 1 : 0;
        if (next !== (cur[col] ?? null)) set.push([col, next]);
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
      // 本人の電話（self、T68）は電話と備考だけを持つ（順・距離・夜間・スマホ・車は付けない）
      const c: ContactChange["value"] = v.kind === "self" ? { kind: "self", phone: v.phone, note: v.note } : v;
      inserts.push({ id, c, sort: ++sort });
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
              `INSERT INTO contacts (id, person_id, kind, relation, name, phone, night_ok, note, sort, emergency_order, supporter_order, reach,
                                     has_smartphone, has_car, created_at)
               SELECT ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?3 WHERE ${guard}`,
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
              n.c.emergencyOrder ?? null,
              n.c.supporterOrder ?? null,
              n.c.reach ?? null,
              n.c.hasSmartphone == null ? null : n.c.hasSmartphone ? 1 : 0,
              n.c.hasCar == null ? null : n.c.hasCar ? 1 : 0,
            ),
        ),
      ];
    },
  };
}

/**
 * 保存のあとの連絡先で、同じ緊急・支援の順が 2 人に付くか（T57）。今の行に手の直し（overwrite）と足す行を当て、外す行を除いて数える。
 * 保存の batch は guard で丸ごと通るか落ちるかなので、書く前に断る。同じ保存で 1 と 2 を入れ替えるのは通る
 */
export function contactOrderClash(rows: Pick<PersonPageRows, "contacts">, changes: ReadonlyArray<IntakeChange>): boolean {
  const state = new Map(rows.contacts.map((c) => [c.id, { e: c.emergency_order ?? null, s: c.supporter_order ?? null }]));
  let added = 0;
  for (const ch of changes) {
    if (ch.t === "remove" && ch.target.what === "contact") {
      const id = ch.target.id;
      if (rows.contacts.some((c) => c.id === id)) state.delete(id);
      continue;
    }
    if (ch.t !== "contact") continue;
    const v = ch.value;
    if (ch.id && ch.overwrite) {
      const cur = state.get(ch.id);
      if (!cur || rows.contacts.find((c) => c.id === ch.id)?.kind === "self") continue;
      state.set(ch.id, { e: v.emergencyOrder !== undefined ? v.emergencyOrder : cur.e, s: v.supporterOrder !== undefined ? v.supporterOrder : cur.s });
    } else if (!ch.id) {
      state.set(`new-${added++}`, { e: v.emergencyOrder ?? null, s: v.supporterOrder ?? null });
    }
  }
  const before = orderTwice(new Map(rows.contacts.map((c) => [c.id, { e: c.emergency_order ?? null, s: c.supporter_order ?? null }])));
  const after = orderTwice(state);
  // もともと重なっていた順（種には無い）は、ほかの直しの保存を止めない。この保存で新しく重なる順だけ断る
  return [...after.e].some((n) => !before.e.has(n)) || [...after.s].some((n) => !before.s.has(n));
}

/** 2 人以上に付いた緊急・支援の順 */
function orderTwice(state: ReadonlyMap<string, { e: number | null; s: number | null }>): { e: Set<number>; s: Set<number> } {
  const twice = (pick: (x: { e: number | null; s: number | null }) => number | null) => {
    const seen = new Set<number>();
    const out = new Set<number>();
    for (const x of state.values()) {
      const n = pick(x);
      if (n === null) continue;
      if (seen.has(n)) out.add(n);
      seen.add(n);
    }
    return out;
  };
  return { e: twice((x) => x.e), s: twice((x) => x.s) };
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
 * 連絡先の行を消し、外した薬・機器の時計を消す（印が残らないように）。本人の行（self）もほかの連絡先と同じく消せる（T68 の続き。
 * 消すと訓練の本人電話は番号なしに戻る。contacts を外部キーで指す表は無い）。
 * 台帳の中の物（欄・薬・機器・ハザード・特記）は applyLedgerChanges が外す
 */
function planRemovals(rows: PersonPageRows, before: Ledger, changes: ReadonlyArray<IntakeChange>, after: Ledger) {
  const contactIds = new Set<string>();
  const clockIds = new Set<string>();
  // 印の時計（次の保存で作り直される物）は時計だけでは外さない（T57。lib/intake/marks.ts の markClockIds）
  const marks = markClockIds(after, rows.clocks);
  for (const ch of changes) {
    if (ch.t !== "remove") continue;
    const r = ch.target;
    if (r.what === "contact") {
      const cur = rows.contacts.find((c) => c.id === r.id);
      if (cur) contactIds.add(cur.id);
    } else if (r.what === "medication") {
      const med = before.medical.medications[r.index];
      if (!med || med.name !== r.name) continue;
      for (const k of rows.clocks) if (k.kind !== "device" && k.kind !== "condition" && sameMedication(k.label, med.name)) clockIds.add(k.id);
    } else if (r.what === "clock") {
      const cur = rows.clocks.find((k) => k.id === r.id);
      if (cur && !marks.has(cur.id)) clockIds.add(cur.id);
    } else if (r.what === "device") {
      if (!before.medical.devices.some((d) => d.kind === r.kind)) continue;
      // その他の機器は印の時計を持たない（手で足した時計は時計の「外す」で消す）
      const category = DEVICE_CLOCKS[r.kind]?.category;
      if (!category) continue;
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
          db.prepare(`DELETE FROM contacts WHERE id = ?4 AND person_id = ?2 AND ${guard}`).bind(...guardArgs, id),
        ),
        ...[...clockIds].map((id) => db.prepare(`DELETE FROM clocks WHERE id = ?4 AND person_id = ?2 AND ${guard}`).bind(...guardArgs, id)),
      ];
    },
  };
}

// ---------- 時計を手で足す・起点（手で直すときだけ。T57） ----------

/**
 * 時計を足す（名前・区分・何で決まるか・値と単位〔空は未確認〕・起点・出典と書き足し）と、今の時計の起点（停電・発災）を変える。
 * 値を入れて足したときは確認の日付をこの時刻に。起点は走らない状態の時計（none）には当てない
 */
function planManualClocks(rows: PersonPageRows, changes: ReadonlyArray<IntakeChange>, personId: string) {
  const adds: Array<{ id: string; v: Extract<IntakeChange, { t: "clockAdd" }>["value"] }> = [];
  const starts = new Map<string, "outage" | "disaster">();
  for (const ch of changes) {
    if (ch.t === "clockAdd") adds.push({ id: `k-${personId}-${shortId()}`, v: ch.value });
    if (ch.t === "clockStart") {
      const cur = rows.clocks.find((k) => k.id === ch.clockId);
      if (cur && cur.starts_on !== "none" && cur.starts_on !== ch.to) starts.set(cur.id, ch.to);
    }
  }
  let sort = rows.clocks.reduce((m, k) => Math.max(m, k.sort), -1) + 1000;
  return {
    fields: [...adds.map((a) => `clocks.${a.id}`), ...[...starts.keys()].map((id) => `clocks.${id}`)],
    count: adds.length + starts.size,
    build(db: D1Database, guard: string, guardArgs: GuardArgs): Statement[] {
      const stamp = guardArgs[2];
      return [
        ...adds.map(({ id, v }) =>
          db
            .prepare(
              `INSERT INTO clocks (id, person_id, kind, category, label, value, unit, starts_on, source, source_note, confirmed_at, sort)
               SELECT ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14 WHERE ${guard}`,
            )
            .bind(
              ...guardArgs,
              id,
              v.kind,
              v.category,
              v.label,
              v.value,
              v.value === null ? null : v.unit,
              v.startsOn,
              v.source,
              v.sourceNote?.trim() || null,
              v.value === null ? null : stamp,
              ++sort,
            ),
        ),
        ...[...starts].map(([id, to]) =>
          db
            .prepare(`UPDATE clocks SET starts_on = ?5 WHERE id = ?4 AND person_id = ?2 AND starts_on <> 'none' AND ${guard}`)
            .bind(...guardArgs, id, to),
        ),
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
