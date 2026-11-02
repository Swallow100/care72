// 本人のページ（docs/tasks/T02.md）。台帳（本人の行・連絡先・同意・時計・経過）を区分ごとの行にする。
// 読むのは personInScope を通した人だけ（事業所の壁、lib/auth/scope.ts）。入れる欄（T03）はここに無い。表示だけ。
//
// 空欄の出し方:
// - 台帳の pending（分からない・まだ聞いていない・答えない）は、その欄に「未確認」と理由を出し、区分の見出しに数える。
//   数は ledger.pending の数と同じ（担当一覧の「未確認 N」と合わせる）。T03 は unconfirmed（場所つきの一覧）から次の問いを選ぶ。
// - pending に無い空の欄も「未確認」と出すが、数えない（まだ入れていない欄）。
// - 配列で持つ欄（機器・薬・ハザード）が空なら「なし」。連絡先は表に全部あるので、無い間柄は「なし」。
//
// 区分の順は sectionOrder（発災時は経過が一番上）。発災時の色と理由は priorityOf に TriageResult を渡す（T09・T13）。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "./age.ts";
import type { Principal } from "./auth/principal.ts";
import { JUDGE_LABEL } from "./auth/roles.ts";
import { personInScope } from "./auth/scope.ts";
import { hazardsOf } from "./caseload.ts";
import { parseLedger } from "./db/ledger.ts";
import {
  CONSENT_KINDS,
  INTAKE_SOURCE,
  type IntakePayload,
  type AccountRole,
  type ClockRow,
  type ConsentRow,
  type ContactRow,
  type DeviceKind,
  type Ledger,
  type PendingStatus,
  type PersonRow,
  type SignalColor,
  type TimelineEntryRow,
  type TimelineKind,
} from "./db/types.ts";
import {
  ABILITY_ITEM_LABELS,
  ABILITY_LABELS,
  AUTHOR_ROLE_LABELS,
  BLANK_LABELS,
  CARE_FLAG_LABELS,
  CARE_LEVEL_LABELS,
  CHECK_STATUS_LABELS,
  CLOCK_KIND_LABELS,
  CLOCK_SOURCE_LABELS,
  CLOCK_START_LABELS,
  CLOCK_UNIT_LABELS,
  COLOR_LABELS,
  CONSENT_KIND_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_FLAG_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  DEPENDENCE_MARKS,
  DEPENDS_ON_LABELS,
  DERIVED_TIMELINE_LABELS,
  DEVICE_LABELS,
  DOCUMENT_LABELS,
  DOCUMENT_STATUS_LABELS,
  HOUSEHOLD_LABELS,
  MEDICATION_CATEGORY_LABELS,
  MED_PARTS,
  MEDICATION_FLAG_LABELS,
  MY_TIMELINE_LABELS,
  PLAN_STATUS_LABELS,
  SECTION_LABELS,
  SEX_LABELS,
  SMARTPHONE_LABELS,
  STRUCTURE_LABELS,
  SUPPORT_KIND_LABELS,
  TIER_LABELS,
  TIMELINE_KIND_LABELS,
} from "./labels.ts";
import { toTriagePerson } from "./triage/from-ledger.ts";
import { tierOf, type Color, type Tier, type TriageResult } from "./triage/index.ts";

// ---------- 区分と並び ----------

export type SectionId = keyof typeof SECTION_LABELS;

/** 平時・発災時（事業所の災害モード。切替は T09） */
export type PageMode = "normal" | "disaster";

const NORMAL_ORDER: readonly SectionId[] = [
  "medical",
  "evacuation",
  "people",
  "basic",
  "consent",
  "documents",
  "timeline",
];

/** 区分の順。発災時は経過が一番上に来て、ほかは平時の順のまま */
export function sectionOrder(mode: PageMode): SectionId[] {
  if (mode === "disaster") return ["timeline", ...NORMAL_ORDER.filter((s) => s !== "timeline")];
  return [...NORMAL_ORDER];
}

// ---------- 欄の場所 ----------

type FieldDef = { key: string; section: SectionId; label: string };

/**
 * 画面の欄と、台帳の中の場所（pending の field と同じ書き方）。pending はいちばん長く一致する欄に付く。
 * 住居は台帳では basic.housing だが、画面では避難の区分に出す（docs/SPEC.md「画面 2」）
 */
export const FIELDS: readonly FieldDef[] = [
  { key: "medical.medications", section: "medical", label: "薬" },
  { key: "medical.devices", section: "medical", label: "機器" },
  { key: "clocks", section: "medical", label: "時計" },
  { key: "medical.doctor", section: "medical", label: "かかりつけ" },
  { key: "medical.dialysis_center", section: "medical", label: "透析先" },
  { key: "medical.allergies", section: "medical", label: "アレルギー" },
  { key: "medical.history", section: "medical", label: "既往" },
  { key: "medical.vaccinations", section: "medical", label: "予防接種" },
  { key: "evacuation.hazards", section: "evacuation", label: "ハザード" },
  { key: "evacuation.destination1", section: "evacuation", label: "避難先1" },
  { key: "evacuation.destination2", section: "evacuation", label: "避難先2" },
  { key: "evacuation.transport", section: "evacuation", label: "手段" },
  { key: "evacuation.support", section: "evacuation", label: "支援内容" },
  { key: "evacuation.route", section: "evacuation", label: "経路" },
  { key: "evacuation.barriers", section: "evacuation", label: "段差" },
  { key: "basic.housing", section: "evacuation", label: "住居" },
  { key: "basic.housing.bedroom", section: "evacuation", label: "寝室" },
  { key: "evacuation.carryItems", section: "evacuation", label: "持出品" },
  { key: "evacuation.pets", section: "evacuation", label: "ペット" },
  { key: "evacuation.myTimeline", section: "evacuation", label: "タイムライン" },
  { key: "people.family", section: "people", label: "家族" },
  { key: "people.emergency", section: "people", label: "緊急連絡先" },
  { key: "people.supporter1", section: "people", label: "支援者1" },
  { key: "people.supporter2", section: "people", label: "支援者2" },
  { key: "people.welfare_commissioner", section: "people", label: "民生委員" },
  { key: "local.watcher", section: "people", label: "みまもり員" },
  { key: "people.night_supporter", section: "people", label: "夜間支援" },
  { key: "people.others", section: "people", label: "関係先" },
  { key: "basic.address", section: "basic", label: "住所" },
  { key: "basic.birth", section: "basic", label: "生年月日" },
  { key: "basic.sex", section: "basic", label: "性別" },
  { key: "basic.contactMeans", section: "basic", label: "連絡手段" },
  { key: "basic.contactMeans.smartphone", section: "basic", label: "スマホ" },
  { key: "basic.household", section: "basic", label: "世帯" },
  { key: "basic.selfReport", section: "basic", label: "本人報告" },
  { key: "care", section: "basic", label: "心身" },
  { key: "care.handbook", section: "basic", label: "手帳" },
  { key: "care.intractableDisease", section: "basic", label: "難病" },
  { key: "notes", section: "basic", label: "特記" },
  ...CONSENT_KINDS.map((k) => ({ key: `consent.${k}`, section: "consent" as const, label: CONSENT_KIND_LABELS[k] })),
];

const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

function fieldDef(key: string): FieldDef {
  const f = FIELD_BY_KEY.get(key);
  if (!f) throw new Error(`欄が無い: ${key}`);
  return f;
}

/** 台帳の中の場所に、いちばん長く一致する欄 */
function matchField(field: string): FieldDef | null {
  let best: FieldDef | null = null;
  for (const f of FIELDS) {
    if ((field === f.key || field.startsWith(`${f.key}.`)) && (!best || f.key.length > best.key.length)) best = f;
  }
  return best;
}

const PREFIX_SECTIONS: Record<string, SectionId> = {
  medical: "medical",
  clocks: "medical",
  evacuation: "evacuation",
  people: "people",
  local: "people",
  basic: "basic",
  care: "basic",
  notes: "basic",
  consent: "consent",
};

/** pending の field がどの区分に出るか（T03 が問いを区分ごとに並べるときにも使う） */
export function sectionOfField(field: string): SectionId {
  return matchField(field)?.section ?? PREFIX_SECTIONS[field.split(".")[0]] ?? "basic";
}

// ---------- 画面の形 ----------

/**
 * 状態の意味の色（app/globals.css の --state-*）。同じ意味は同じ色:
 * ok 緑（無事・同意・確認済・受領）、urgent 赤（至急・赤の信号・残りの短い時計）、
 * check 黄（要確認・未確認・同意なし・支援者なし・中断注意）、unknown 灰（未知）
 */
export type StateTone = "ok" | "urgent" | "check" | "unknown";

/** 1 つの言葉。tel は電話のリンク（tel: の後ろ、ハイフンなし）。tag は色の付いた印（色だけにせず文字を必ず持つ） */
export type Seg = { text: string; tel?: string; tone?: "muted" | StateTone; tag?: true };
export type Line = Seg[];
export type Pending = Ledger["pending"][number];

/** 欄の値。lines は値あり、none は「なし」、unconfirmed は「未確認」 */
export type Field =
  | { kind: "lines"; lines: Line[] }
  | { kind: "none"; tone?: StateTone }
  | { kind: "unconfirmed" };

export type Row = {
  key: string;
  label: string;
  field: Field;
  /** この欄に付いた台帳の pending。あれば「未確認」と理由を出して数える */
  pending: Pending[];
  /** 細かい物（既往・予防接種・手帳など）。小さな字で出す */
  small?: true;
};

export type ClockView = {
  id: string;
  label: string;
  /** 機器・物・薬・状態 */
  kind: string;
  /** 「2 時間」。null は未確認。走らない時計（本人の状態）は runs が false */
  value: string | null;
  runs: boolean;
  /** 長さの色（clockTone）。短いほど黄 → 赤 */
  tone: StateTone | null;
  /** 停電・発災・なし */
  start: string;
  /** 主治医・説明書など。null は未確認 */
  source: string | null;
  sourceNote: string | null;
  /** 値を確かめた日（JST の YYYY-MM-DD）。null は未確認 */
  confirmed: string | null;
  /** 外の物に頼る時計の頼り先と確認（人が付ける） */
  depends: { on: string; check: string; unchecked: boolean } | null;
  note: string | null;
  pending: Pending[];
};

/** 書類の入口。href があれば開ける（紙面ができた書類） */
export type DocumentView = { key: keyof typeof DOCUMENT_LABELS; label: string; status: string; href?: string };

/** できた書類の紙面の場所（T05 計画書。T06・T07 はここに足す） */
const DOCUMENT_PATHS: Partial<Record<keyof typeof DOCUMENT_LABELS, (personId: string) => string>> = {
  matsuyama: (id) => `/people/${encodeURIComponent(id)}/forms/matsuyama`,
};

export type TimelineItem = {
  id: string;
  /** ISO 8601 */
  at: string;
  /** 日本の時刻 YYYY-MM-DD HH:MM */
  when: string;
  kind: string;
  /** 種類の印の色。赤の信号は赤、受領は緑など */
  tone: StateTone | null;
  body: string | null;
  /** 誰が（役と名前） */
  who: string;
  /** 経過の表の行でなく、種の表（本人の行・同意）から作った物 */
  derived: boolean;
  /** Claude の出力を人が確かめて入れた行（入れる欄の保存）。画面に「AI」の印 */
  ai?: true;
};

export type Block =
  | { type: "row"; row: Row }
  | { type: "clocks"; key: "clocks"; label: string; clocks: ClockView[] }
  | { type: "documents"; documents: DocumentView[] }
  | { type: "timeline"; items: TimelineItem[] };

export type Section = {
  id: SectionId;
  label: string;
  blocks: Block[];
  /** 区分の中の未確認（台帳の pending）の数 */
  unconfirmed: number;
};

/** 優先。平時は骨格の段、発災時はルールの表の色と理由の 1 行 */
export type Priority =
  | { kind: "tier"; tier: Tier; label: string; tone: StateTone | null }
  | { kind: "triage"; color: Color; tone: StateTone; label: string; reason: string };

/** ルールの表の 4 色と意味の色 */
export const COLOR_TONES: Record<Color, StateTone> = { red: "urgent", yellow: "check", gray: "unknown", green: "ok" };

export type PersonHead = {
  id: string;
  name: string;
  kana: string;
  age: number | null;
  careLevel: string | null;
  /** 医療の印と、その時計の色 */
  marks: Array<{ label: string; tone: StateTone | null }>;
  priority: Priority;
  plan: string;
  /** 台帳の pending の数（担当一覧の「未確認 N」と同じ） */
  unconfirmed: number;
  /** 走る時計の残り（平時は全部の長さ）。短い順、値の無い物は後ろ。上に大きく出す */
  clocks: Array<{ id: string; label: string; value: string | null; tone: StateTone | null }>;
  /** 緊急連絡先（順番つき、電話のリンク）。上に大きく出す */
  emergency: Line[];
};

export type UnconfirmedItem = { section: SectionId; field: string; status: PendingStatus; label: string };

export type PersonView = {
  head: PersonHead;
  mode: PageMode;
  /** sectionOrder の順 */
  sections: Section[];
  /** 台帳の pending と、画面のどの区分・欄に出たか（T03 の問いの元） */
  unconfirmed: UnconfirmedItem[];
};

// ---------- 入力（D1 の行） ----------

export type PersonPageRows = {
  person: Pick<
    PersonRow,
    | "id"
    | "office_id"
    | "care_manager_id"
    | "name"
    | "kana"
    | "birth_date"
    | "plan_status"
    | "origin"
    | "self_report_unreliable"
    | "ledger"
    | "created_at"
    | "updated_at"
  >;
  /** 担当のケアマネの名前 */
  careManagerName: string | null;
  contacts: ReadonlyArray<Omit<ContactRow, "created_at">>;
  consents: ReadonlyArray<ConsentRow & { recorded_by_name: string | null; recorded_by_role: AccountRole | null }>;
  clocks: ReadonlyArray<ClockRow>;
  /** 経過の行。signal_color は信号の行の色（信号の表から） */
  timeline: ReadonlyArray<TimelineEntryRow & { author_name: string | null; signal_color: SignalColor | null }>;
};

// ---------- 小さな道具 ----------

const HOUR_MS = 3_600_000;

/** 日本の時刻 YYYY-MM-DD HH:MM。読めない値はそのまま */
export function formatJst(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = new Date(t + 9 * HOUR_MS).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

function jstDate(iso: string): string {
  return formatJst(iso).slice(0, 10);
}

/** 電話のリンクの行き先（数字と + だけ） */
export function telHref(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

const text = (t: string): Seg => ({ text: t });
const muted = (t: string): Seg => ({ text: t, tone: "muted" });
const tag = (t: string, tone: StateTone): Seg => ({ text: t, tone, tag: true });

/** 残りが短いほど黄 → 赤にする境目（時間）。1 日以内は赤、7 日より短ければ黄、それ以上は色なし */
export const CLOCK_TONE_HOURS = { urgent: 24, check: 168 } as const;

/** 時計の長さ（残り）の色。値の無い時計は未確認で黄。走らない時計（本人の状態）は色なし */
export function clockTone(hours: number | null, runs = true): StateTone | null {
  if (!runs) return null;
  if (hours === null) return "check";
  if (hours <= CLOCK_TONE_HOURS.urgent) return "urgent";
  if (hours < CLOCK_TONE_HOURS.check) return "check";
  return null;
}

const UNIT_HOURS = { minute: 1 / 60, hour: 1, day: 24, week: 168 } as const;

function hoursOf(k: Pick<ClockRow, "value" | "unit">): number | null {
  return k.value != null && k.unit != null ? k.value * UNIT_HOURS[k.unit] : null;
}

const TONE_RANK: Record<StateTone, number> = { urgent: 3, check: 2, unknown: 1, ok: 0 };

/** 医療の印（担当一覧と同じ並び）と、その区分の時計でいちばん強い色 */
export function markItems(clocks: ReadonlyArray<ClockRow>): Array<{ label: string; tone: StateTone | null }> {
  return DEPENDENCE_MARKS.flatMap(([category, label]) => {
    const mine = clocks.filter((k) => k.category === category);
    if (mine.length === 0) return [];
    const tones = mine.map((k) => clockTone(hoursOf(k), k.starts_on !== "none")).filter((t) => t !== null);
    const tone = tones.sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0] ?? null;
    return [{ label, tone }];
  });
}

function lines(ls: Line[]): Field {
  const kept = ls.map((l) => l.filter((s) => s.text !== "")).filter((l) => l.length > 0);
  return kept.length > 0 ? { kind: "lines", lines: kept } : { kind: "unconfirmed" };
}

/** 文字の値。空なら未確認 */
function textField(v: string | null | undefined): Field {
  return v != null && v.trim() !== "" ? { kind: "lines", lines: [[text(v)]] } : { kind: "unconfirmed" };
}

/** 配列の値。無ければ未確認、空ならなし */
function listField(v: readonly string[] | undefined): Field {
  if (v === undefined) return { kind: "unconfirmed" };
  if (v.length === 0) return { kind: "none" };
  return { kind: "lines", lines: [[text(v.join("・"))]] };
}

type Contact = PersonPageRows["contacts"][number];

/** 来てくれる人の連絡先（夜間に来られるかを出す）。機関（かかりつけ・薬局・透析施設・市役所・介護事業所）は出さない */
const COMES_KINDS = new Set<Contact["kind"]>(["family", "supporter", "welfare_commissioner", "visiting_nurse"]);

/** 連絡先の 1 行: 名前・間柄（役割）・どこに・車・来られる時間（夜間）・スマホ・電話・備考 */
function contactLine(c: Contact, opts: { order?: number; kind?: boolean } = {}): Line {
  const segs: Seg[] = [];
  if (opts.order !== undefined) segs.push(muted(String(opts.order)));
  segs.push(text(c.name ?? (c.relation || CONTACT_KIND_LABELS[c.kind])));
  if (c.name && c.relation) segs.push(muted(c.relation));
  if (opts.kind) segs.push(muted(CONTACT_KIND_LABELS[c.kind]));
  if (c.reach) segs.push(muted(CONTACT_REACH_LABELS[c.reach]));
  if (c.has_car === 1) segs.push(muted(CONTACT_FLAG_LABELS.hasCar));
  if (COMES_KINDS.has(c.kind)) {
    segs.push(
      muted(
        c.night_ok === 1
          ? CONTACT_FLAG_LABELS.nightOk
          : c.night_ok === 0
            ? CONTACT_FLAG_LABELS.nightNo
            : CONTACT_FLAG_LABELS.nightUnknown,
      ),
    );
  }
  if (c.has_smartphone === 1) segs.push(muted(CONTACT_FLAG_LABELS.hasSmartphone));
  if (c.phone) segs.push({ text: c.phone, tel: telHref(c.phone) });
  if (c.note) segs.push(muted(c.note));
  return segs;
}

function contactsField(cs: Contact[], opts: { kind?: boolean } = {}): Field {
  return cs.length > 0 ? { kind: "lines", lines: cs.map((c) => contactLine(c, opts)) } : { kind: "none" };
}

/** 細かい物。小さな字で出す（既往・予防接種・経路・段差・ペット・手帳・難病） */
const SMALL_KEYS = new Set([
  "medical.history",
  "medical.vaccinations",
  "evacuation.route",
  "evacuation.barriers",
  "evacuation.pets",
  "evacuation.myTimeline",
  "care.handbook",
  "care.intractableDisease",
]);

function row(key: string, field: Field): Row {
  return { key, label: fieldDef(key).label, field, pending: [], ...(SMALL_KEYS.has(key) ? { small: true as const } : {}) };
}

/** 時計の値の言葉（色つき）。値が無ければ灰の「未確認」 */
function clockValueSeg(k: ClockRow): Seg {
  const tone = clockTone(hoursOf(k), k.starts_on !== "none");
  if (k.value == null || k.unit == null) return muted(BLANK_LABELS.unconfirmed);
  const v = `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}`;
  return tone ? { text: v, tone } : text(v);
}

// ---------- 区分ごとの行 ----------

/** 薬の時計と薬の名前が同じ物か（時計の名前は薬の名前の一部のことがある: DOAC と 抗凝固薬（DOAC）） */
function sameMedication(clockLabel: string, medicationName: string): boolean {
  return clockLabel.includes(medicationName) || medicationName.includes(clockLabel);
}

/** 電源で動く機器。時計（電池）が無ければ「電池 未確認」と出す */
const POWERED_DEVICES = new Set<DeviceKind>(["oxygen", "ventilator", "suction"]);

function medicalBlocks(ledger: Ledger, contacts: Contact[], clocks: PersonPageRows["clocks"]): Block[] {
  const { medical } = ledger;
  const blank = muted(BLANK_LABELS.unconfirmed);
  // 薬: 名前・区分・回数・用量・残り（その薬の時計）・保管・印
  const meds: Field =
    medical.medications.length === 0
      ? { kind: "none" }
      : lines(
          medical.medications.map((m) => {
            // 薬の残りは同じ名前の時計（薬の時計か、インスリンのような物の時計）
            const clock = clocks.find((k) => k.kind !== "device" && sameMedication(k.label, m.name));
            return [
              text(m.name),
              muted(MEDICATION_CATEGORY_LABELS[m.category]),
              text(m.schedule ?? ""),
              muted(MED_PARTS.amount),
              m.amount ? text(m.amount) : blank,
              muted(MED_PARTS.remaining),
              clock ? clockValueSeg(clock) : blank,
              muted(MED_PARTS.storage),
              m.storage ? text(m.storage) : blank,
              ...(m.needsRefrigeration ? [muted(MEDICATION_FLAG_LABELS.needsRefrigeration)] : []),
              ...(m.interruptionRisk ? [tag(MEDICATION_FLAG_LABELS.interruptionRisk, "check")] : []),
            ];
          }),
        );
  // 機器: 名前・内容・回数と、同じ区分の時計（電池・予備）
  const devices: Field =
    medical.devices.length === 0
      ? { kind: "none" }
      : lines(
          medical.devices.map((d) => {
            const mine = clocks.filter((k) => k.category === d.kind && k.kind !== "medication");
            const clockSegs: Seg[] = mine.flatMap((k) => [muted(k.label), clockValueSeg(k)]);
            if (mine.length === 0 && POWERED_DEVICES.has(d.kind)) clockSegs.push(muted(MED_PARTS.battery), blank);
            return [text(DEVICE_LABELS[d.kind]), text(d.detail ?? ""), muted(d.schedule ?? ""), ...clockSegs];
          }),
        );

  const doctors = contacts.filter((c) => c.kind === "home_doctor" || c.kind === "pharmacy");
  const dialysis = contacts.filter((c) => c.kind === "dialysis_center");
  const needsDialysis = medical.devices.some((d) => d.kind === "dialysis") || clocks.some((k) => k.category === "dialysis");

  const blocks: Block[] = [
    { type: "row", row: row("medical.medications", meds) },
    { type: "row", row: row("medical.devices", devices) },
    { type: "clocks", key: "clocks", label: fieldDef("clocks").label, clocks: clocks.map(clockView) },
    {
      type: "row",
      row: row("medical.doctor", doctors.length > 0 ? contactsField(doctors, { kind: true }) : { kind: "unconfirmed" }),
    },
  ];
  if (dialysis.length > 0 || needsDialysis) {
    blocks.push({
      type: "row",
      row: row("medical.dialysis_center", dialysis.length > 0 ? contactsField(dialysis) : { kind: "unconfirmed" }),
    });
  }
  blocks.push({ type: "row", row: row("medical.allergies", listField(medical.allergies)) });
  blocks.push({ type: "row", row: row("medical.history", listField(medical.history)) });
  blocks.push({ type: "row", row: row("medical.vaccinations", listField(medical.vaccinations)) });
  return blocks;
}

function clockView(k: ClockRow): ClockView {
  const runs = k.starts_on !== "none";
  return {
    id: k.id,
    label: k.label,
    kind: CLOCK_KIND_LABELS[k.kind],
    value: k.value != null && k.unit != null ? `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : null,
    runs,
    tone: clockTone(hoursOf(k), runs),
    start: CLOCK_START_LABELS[k.starts_on],
    source: k.source ? CLOCK_SOURCE_LABELS[k.source] : null,
    sourceNote: k.source_note,
    confirmed: k.confirmed_at ? jstDate(k.confirmed_at) : null,
    depends:
      k.depends_on && k.depends_check
        ? {
            on: DEPENDS_ON_LABELS[k.depends_on],
            check: CHECK_STATUS_LABELS[k.depends_check],
            unchecked: k.depends_check === "unconfirmed",
          }
        : null,
    note: k.note,
    pending: [],
  };
}

function housingField(h: Ledger["basic"]["housing"]): Field {
  if (!h) return { kind: "unconfirmed" };
  const parts: string[] = [];
  if (h.floor != null) parts.push(`${h.floor} 階`);
  if (h.floors != null) parts.push(h.floors === 1 ? "平屋" : `${h.floors} 階建`);
  if (h.structure) parts.push(STRUCTURE_LABELS[h.structure]);
  if (h.builtYear != null) parts.push(`${h.builtYear} 年築`);
  return parts.length > 0 ? { kind: "lines", lines: [[text(parts.join("・"))]] } : { kind: "unconfirmed" };
}

function evacuationBlocks(ledger: Ledger): Block[] {
  const e = ledger.evacuation;
  const hazards = hazardsOf(ledger);
  return [
    row("evacuation.hazards", hazards.length > 0 ? { kind: "lines", lines: [[text(hazards.join("・"))]] } : { kind: "none" }),
    row("evacuation.destination1", textField(e.destination1)),
    row("evacuation.destination2", textField(e.destination2)),
    row("evacuation.transport", textField(e.transport)),
    row("evacuation.support", supportField(e)),
    row("evacuation.route", textField(e.route)),
    row("evacuation.barriers", textField(e.barriers)),
    row("basic.housing", housingField(ledger.basic.housing)),
    row("basic.housing.bedroom", textField(ledger.basic.housing?.bedroom)),
    row("evacuation.carryItems", listField(e.carryItems)),
    row("evacuation.pets", textField(e.pets)),
    row("evacuation.myTimeline", textField(e.myTimeline ? MY_TIMELINE_LABELS[e.myTimeline] : null)),
  ].map((r): Block => ({ type: "row", row: r }));
}

/** 支援の内容: 選んだ物と書き足し。選んだ物が空の配列なら「なし」 */
function supportField(e: Ledger["evacuation"]): Field {
  const kinds = e.support?.map((k) => SUPPORT_KIND_LABELS[k]) ?? [];
  const note = e.supportNote?.trim() ?? "";
  if (kinds.length === 0 && !note) return e.support ? { kind: "none" } : { kind: "unconfirmed" };
  return { kind: "lines", lines: [[...(kinds.length > 0 ? [text(kinds.join("・"))] : []), ...(note ? [muted(note)] : [])]] };
}

/** 人の区分で出す連絡先の種類（ほかの区分に出す物: 本人の電話は基本、かかりつけ・薬局・透析施設は医療） */
const SHOWN_ELSEWHERE = new Set<Contact["kind"]>(["self", "home_doctor", "pharmacy", "dialysis_center"]);

function peopleBlocks(contacts: Contact[], ledger: Ledger): Block[] {
  const byOrder = (key: "emergency_order" | "supporter_order") =>
    contacts.filter((c) => c[key] != null).sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0));
  const family = contacts.filter((c) => c.kind === "family");
  const emergency = byOrder("emergency_order");
  const supporters = byOrder("supporter_order");
  const welfare = contacts.filter((c) => c.kind === "welfare_commissioner");
  const supporter = (n: number): Field => {
    const c = supporters.find((s) => s.supporter_order === n);
    if (c) return { kind: "lines", lines: [contactLine(c, { kind: c.kind !== "family" && c.kind !== "supporter" })] };
    // 支援者が 1 人もいない（優先の並びで「支援者なし」が先になる）
    return n === 1 ? { kind: "none", tone: "check" } : { kind: "none" };
  };
  const nightOk = contacts.filter((c) => c.night_ok === 1);
  const night: Field =
    nightOk.length > 0
      ? {
          kind: "lines",
          lines: nightOk.map((c) => [
            text(c.name ?? c.relation ?? CONTACT_KIND_LABELS[c.kind]),
            ...(c.name && c.relation ? [muted(c.relation)] : []),
          ]),
        }
      : contacts.some((c) => c.night_ok === 0)
        ? { kind: "none" }
        : { kind: "unconfirmed" };
  const shown = new Set([...family, ...emergency, ...supporters, ...welfare].map((c) => c.id));
  const others = contacts.filter((c) => !shown.has(c.id) && !SHOWN_ELSEWHERE.has(c.kind));

  const rows = [
    row("people.family", contactsField(family)),
    row(
      "people.emergency",
      emergency.length > 0
        ? { kind: "lines", lines: emergency.map((c) => contactLine(c, { order: c.emergency_order ?? undefined })) }
        : { kind: "none" },
    ),
    row("people.supporter1", supporter(1)),
    row("people.supporter2", supporter(2)),
    row("people.welfare_commissioner", contactsField(welfare)),
    row("local.watcher", textField(ledger.local?.watcher)),
    row("people.night_supporter", night),
  ];
  if (others.length > 0) rows.push(row("people.others", contactsField(others, { kind: true })));
  return rows.map((r): Block => ({ type: "row", row: r }));
}

const MEANS: ReadonlyArray<["landline" | "mobile" | "email", string]> = [
  ["landline", "固定電話"],
  ["mobile", "携帯"],
  ["email", "メール"],
];

function basicBlocks(rows: PersonPageRows, ledger: Ledger): Block[] {
  const { basic, care } = ledger;
  const selfPhones = rows.contacts.filter((c) => c.kind === "self" && c.phone);
  const notes = selfPhones.map((c) => c.note ?? "").join(" ");
  const means = MEANS.filter(([k, label]) => basic.contactMeans?.[k] === true && !notes.includes(label)).map(
    ([, label]) => label,
  );
  const contactMeans = lines([
    ...selfPhones.map((c): Line => [{ text: c.phone!, tel: telHref(c.phone!) }, muted(c.note ?? "")]),
    ...(means.length > 0 ? [[text(means.join("・"))]] : []),
  ]);

  // 心身: 内閣府様式の裏の 6 項目と、寝たきり・認知症。空の項目も「未確認」で出す
  const abilities: Line = (Object.keys(ABILITY_ITEM_LABELS) as Array<keyof typeof ABILITY_ITEM_LABELS>).map((k) => {
    const v = care[k];
    return v ? text(`${ABILITY_ITEM_LABELS[k]} ${ABILITY_LABELS[v]}`) : muted(`${ABILITY_ITEM_LABELS[k]} ${BLANK_LABELS.unconfirmed}`);
  });
  const flag = (label: string, v: boolean | undefined): Seg =>
    v === true ? text(label) : muted(`${label} ${v === false ? BLANK_LABELS.none : BLANK_LABELS.unconfirmed}`);
  const careLines: Line[] = [abilities, [flag(CARE_FLAG_LABELS.bedridden, care.bedridden), flag(CARE_FLAG_LABELS.dementia, care.dementia)]];

  const out = [
    row("basic.address", basic.address ? textField(`${basic.address.city} ${basic.address.town}`) : { kind: "unconfirmed" }),
    row("basic.birth", textField(rows.person.birth_date)),
    row("basic.sex", textField(basic.sex ? SEX_LABELS[basic.sex] : null)),
    row("basic.contactMeans", contactMeans),
    row(
      "basic.contactMeans.smartphone",
      textField(basic.contactMeans?.smartphone ? SMARTPHONE_LABELS[basic.contactMeans.smartphone] : null),
    ),
    row("basic.household", textField(basic.household ? HOUSEHOLD_LABELS[basic.household] : null)),
    row("basic.selfReport", {
      kind: "lines",
      lines: [[rows.person.self_report_unreliable === 1 ? tag("参考扱い", "check") : text("通常")]],
    }),
    row("care", lines(careLines)),
    row("care.handbook", textField(care.handbook)),
    row("care.intractableDisease", textField(care.intractableDisease)),
    row("notes", ledger.notes.length > 0 ? { kind: "lines", lines: ledger.notes.map((n) => [text(n)]) } : { kind: "none" }),
  ];
  return out.map((r): Block => ({ type: "row", row: r }));
}

function consentBlocks(consents: PersonPageRows["consents"]): Block[] {
  return CONSENT_KINDS.map((kind): Block => {
    const c = consents.find((x) => x.kind === kind);
    const key = `consent.${kind}`;
    if (!c || c.status === "unconfirmed") return { type: "row", row: row(key, { kind: "unconfirmed" }) };
    const segs: Seg[] = [
      // 同意なしは灰でなく注意の色（黄）。同意ありは緑
      c.status === "refused" ? tag(CONSENT_STATUS_LABELS.refused, "check") : tag(CONSENT_STATUS_LABELS.granted, "ok"),
      muted(jstDate(c.recorded_at)),
      muted(c.recorded_by_name ?? ""),
      muted(c.expires_at ? `期限 ${jstDate(c.expires_at)}` : ""),
      muted(c.note ?? ""),
    ];
    return { type: "row", row: row(key, lines([segs])) };
  });
}

function documentBlocks(personId: string): Block[] {
  const keys = Object.keys(DOCUMENT_LABELS) as Array<keyof typeof DOCUMENT_LABELS>;
  return [
    {
      type: "documents",
      documents: keys.map((key) => {
        const path = DOCUMENT_PATHS[key];
        return path
          ? { key, label: DOCUMENT_LABELS[key], status: DOCUMENT_STATUS_LABELS.ready, href: path(personId) }
          : { key, label: DOCUMENT_LABELS[key], status: DOCUMENT_STATUS_LABELS.pending };
      }),
    },
  ];
}

function accountRoleLabel(role: AccountRole | null): string {
  if (role === null) return "";
  return role === "judge" ? JUDGE_LABEL : AUTHOR_ROLE_LABELS[role];
}

const who = (role: string, name: string | null) => [role, name].filter((s) => s).join(" ");

/** 受け持ち・到着・迎えは緑（無事の側の出来事）、上書きは黄 */
const TIMELINE_TONES: Partial<Record<TimelineKind, StateTone>> = {
  received: "ok",
  arrived_shelter: "ok",
  pickup: "ok",
  override: "check",
};

const SIGNAL_TONES: Record<SignalColor, StateTone> = { red: "urgent", green: "ok", unknown: "unknown" };

/** 入れる欄の保存の行の payload（kind は note、payload の source が intake）。違えば null */
export function intakePayloadOf(t: Pick<TimelineEntryRow, "kind" | "payload">): IntakePayload | null {
  if (t.kind !== "note" || !t.payload) return null;
  try {
    const p = JSON.parse(t.payload) as Partial<IntakePayload>;
    return p.source === INTAKE_SOURCE ? (p as IntakePayload) : null;
  } catch {
    return null;
  }
}

export function isIntakeEntry(t: Pick<TimelineEntryRow, "kind" | "payload">): boolean {
  return intakePayloadOf(t) !== null;
}

/** 経過の行の色。信号は信号の色（赤の信号は赤）、時計の確認は付けた側（未確認は黄、確認済は緑） */
function timelineTone(t: PersonPageRows["timeline"][number]): StateTone | null {
  if (t.kind === "signal") return t.signal_color ? SIGNAL_TONES[t.signal_color] : null;
  if (t.kind === "clock_check" && t.payload) {
    try {
      const to = (JSON.parse(t.payload) as { to?: unknown }).to;
      if (to === "unconfirmed") return "check";
      if (to === "confirmed") return "ok";
    } catch {
      return null;
    }
  }
  return TIMELINE_TONES[t.kind] ?? null;
}

/**
 * 経過。経過の表の行に、種の表から作れる物を足す:
 * - 本人の行を作った時刻 →「入力」（書き手は担当のケアマネ。医療班がその場で作った人は医療班）
 * - 同意を記録した時刻 →「同意」（記録した人ごと・時刻ごとに 1 行）。同じ時刻の「同意」の行が経過の表にあれば作らない
 * 並びは時刻の順（同じ時刻なら作った物が先）
 */
export function timelineItems(rows: PersonPageRows): TimelineItem[] {
  const stored: TimelineItem[] = rows.timeline.map((t) => ({
    id: t.id,
    at: t.occurred_at,
    when: formatJst(t.occurred_at),
    // 入れる欄の保存（kind は note、payload の source が intake）は「入力」
    kind: isIntakeEntry(t) ? DERIVED_TIMELINE_LABELS.created : TIMELINE_KIND_LABELS[t.kind],
    tone: timelineTone(t),
    body: t.body,
    who: who(AUTHOR_ROLE_LABELS[t.author_role], t.author_name),
    derived: false,
    ...(intakePayloadOf(t)?.ai ? { ai: true as const } : {}),
  }));

  const derived: TimelineItem[] = [];
  const p = rows.person;
  derived.push({
    id: `derived-created-${p.id}`,
    at: p.created_at,
    when: formatJst(p.created_at),
    kind: DERIVED_TIMELINE_LABELS.created,
    tone: null,
    body: "台帳作成",
    who:
      p.origin === "on_site"
        ? AUTHOR_ROLE_LABELS.medical
        : who(AUTHOR_ROLE_LABELS.care_manager, rows.careManagerName),
    derived: true,
  });

  const storedConsentTimes = new Set(rows.timeline.filter((t) => t.kind === "consent").map((t) => t.occurred_at));
  const groups = new Map<string, Array<PersonPageRows["consents"][number]>>();
  for (const c of rows.consents) {
    if (c.status === "unconfirmed" || storedConsentTimes.has(c.recorded_at)) continue;
    const k = `${c.recorded_at}|${c.recorded_by ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const [k, cs] of groups) {
    const first = cs[0];
    const ordered = CONSENT_KINDS.flatMap((kind) => cs.filter((c) => c.kind === kind));
    derived.push({
      id: `derived-consent-${p.id}-${k}`,
      at: first.recorded_at,
      when: formatJst(first.recorded_at),
      kind: DERIVED_TIMELINE_LABELS.consent,
      // 同意なしが 1 つでもあれば注意の色（黄）、全部同意なら緑
      tone: ordered.some((c) => c.status === "refused") ? "check" : "ok",
      body: ordered.map((c) => `${CONSENT_KIND_LABELS[c.kind]} ${CONSENT_STATUS_LABELS[c.status]}`).join("・"),
      who: who(accountRoleLabel(first.recorded_by_role), first.recorded_by_name),
      derived: true,
    });
  }

  return [...derived, ...stored]
    .map((item, i) => ({ item, i, t: Date.parse(item.at) }))
    .sort((a, b) => a.t - b.t || Number(b.item.derived) - Number(a.item.derived) || a.i - b.i)
    .map((x) => x.item);
}

// ---------- pending を欄に付ける ----------

const MED_REMAINING = /^medical\.medications\.([^.]+)\.remaining$/;

/**
 * 薬の残りの pending は、その薬の時計（残りの日数）の行に付ける。薬は番号か名前で探し、
 * 見つからなければ、値の無い薬の時計が 1 つだけのときにそこへ（種の山田さんの「ワーファリン」はこれ）
 */
function clockForPending(field: string, ledger: Ledger, clocks: ClockView[], rows: PersonPageRows): ClockView | null {
  const direct = /^clocks\.([^.]+)/.exec(field);
  if (direct) return clocks.find((k) => k.id === direct[1]) ?? null;
  const m = MED_REMAINING.exec(field);
  if (!m) return null;
  const empty = rows.clocks.filter((k) => k.kind === "medication" && k.value == null);
  const med = /^\d+$/.test(m[1]) ? ledger.medical.medications[Number(m[1])] : ledger.medical.medications.find((x) => x.name === m[1]);
  const target = med ? empty.find((k) => sameMedication(k.label, med.name)) : empty.length === 1 ? empty[0] : undefined;
  return target ? (clocks.find((k) => k.id === target.id) ?? null) : null;
}

function attachPending(sections: Map<SectionId, Block[]>, ledger: Ledger, rows: PersonPageRows): UnconfirmedItem[] {
  const out: UnconfirmedItem[] = [];
  const clockBlock = sections.get("medical")!.find((b) => b.type === "clocks");
  const clocks = clockBlock?.type === "clocks" ? clockBlock.clocks : [];
  const rowsOf = (s: SectionId) => sections.get(s)!.flatMap((b) => (b.type === "row" ? [b.row] : []));

  for (const p of ledger.pending) {
    const clock = clockForPending(p.field, ledger, clocks, rows);
    if (clock) {
      clock.pending.push(p);
      out.push({ section: "medical", field: p.field, status: p.status, label: clock.label });
      continue;
    }
    const def = matchField(p.field);
    const target = def ? rowsOf(def.section).find((r) => r.key === def.key) : undefined;
    if (def && target) {
      target.pending.push(p);
      out.push({ section: def.section, field: p.field, status: p.status, label: target.label });
      continue;
    }
    // 画面に欄の無い場所。区分の終わりに 1 行足す
    const section = sectionOfField(p.field);
    const extra: Row = { key: p.field, label: "その他", field: { kind: "unconfirmed" }, pending: [p] };
    sections.get(section)!.push({ type: "row", row: extra });
    out.push({ section, field: p.field, status: p.status, label: extra.label });
  }
  return out;
}

// ---------- 全体 ----------

/** 上に大きく出す時計の残り。走る時計を短い順に、値の無い物は後ろ */
function headClocks(clocks: ReadonlyArray<ClockRow>): PersonHead["clocks"] {
  return clocks
    .filter((k) => k.starts_on !== "none")
    .map((k) => ({ k, h: hoursOf(k) }))
    .sort((a, b) => (a.h ?? Infinity) - (b.h ?? Infinity))
    .map(({ k, h }) => ({
      id: k.id,
      label: k.label,
      value: k.value != null && k.unit != null ? `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : null,
      tone: clockTone(h),
    }));
}

/** 上に大きく出す緊急連絡先: 順番・名前・間柄・電話 */
function headEmergency(contacts: ReadonlyArray<Contact>): Line[] {
  return contacts
    .filter((c) => c.emergency_order != null)
    .sort((a, b) => (a.emergency_order ?? 0) - (b.emergency_order ?? 0))
    .map((c) => [
      muted(String(c.emergency_order)),
      text(c.name ?? c.relation ?? CONTACT_KIND_LABELS[c.kind]),
      ...(c.name && c.relation ? [muted(c.relation)] : []),
      ...(c.phone ? [{ text: c.phone, tel: telHref(c.phone) }] : []),
    ]);
}

/**
 * 優先: 平時は骨格の段（色は医療の印と同じ、時計の長さの色）。
 * 発災時（triage を渡したとき）はルールの表の色と、その言葉（至急・要確認・未知・無事）と理由の 1 行
 */
export function priorityOf(tier: Tier, triage?: TriageResult | null, tone: StateTone | null = null): Priority {
  if (triage) {
    return {
      kind: "triage",
      color: triage.color,
      tone: COLOR_TONES[triage.color],
      label: COLOR_LABELS[triage.color],
      reason: triage.reason,
    };
  }
  return { kind: "tier", tier, label: TIER_LABELS[tier], tone };
}

export type ViewOptions = {
  /** 年齢を数える日（JST、YYYY-MM-DD） */
  today: string;
  mode?: PageMode;
  /** 発災時のルールの表の結果（T09・T13 が渡す） */
  triage?: TriageResult | null;
};

export function toPersonView(rows: PersonPageRows, opts: ViewOptions): PersonView {
  const mode = opts.mode ?? "normal";
  const { person } = rows;
  const ledger = parseLedger(person.ledger);
  const contacts = [...rows.contacts].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const clocks = [...rows.clocks].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));

  const sections = new Map<SectionId, Block[]>([
    ["medical", medicalBlocks(ledger, contacts, clocks)],
    ["evacuation", evacuationBlocks(ledger)],
    ["people", peopleBlocks(contacts, ledger)],
    ["basic", basicBlocks({ ...rows, contacts }, ledger)],
    ["consent", consentBlocks(rows.consents)],
    ["documents", documentBlocks(person.id)],
    ["timeline", [{ type: "timeline", items: timelineItems(rows) }]],
  ]);
  const unconfirmed = attachPending(sections, ledger, rows);

  const tier = tierOf(toTriagePerson({ person, ledger, contacts, clocks }));
  const marks = markItems(clocks);
  const strongest = marks.map((m) => m.tone).filter((t) => t !== null).sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0];
  const head: PersonHead = {
    id: person.id,
    name: person.name,
    kana: person.kana,
    age: person.birth_date ? ageOn(person.birth_date, opts.today) : null,
    careLevel: ledger.care.careLevel ? CARE_LEVEL_LABELS[ledger.care.careLevel] : null,
    marks,
    priority: priorityOf(tier, opts.triage, strongest ?? null),
    plan: PLAN_STATUS_LABELS[person.plan_status],
    unconfirmed: ledger.pending.length,
    clocks: headClocks(clocks),
    emergency: headEmergency(contacts),
  };

  return {
    head,
    mode,
    sections: sectionOrder(mode).map((id) => ({
      id,
      label: SECTION_LABELS[id],
      blocks: sections.get(id)!,
      unconfirmed: unconfirmed.filter((u) => u.section === id).length,
    })),
    unconfirmed,
  };
}

// ---------- D1 から読む ----------

/**
 * 本人のページの行を読む。壁は personInScope だけ（範囲の外は在っても無くても null → 404）。
 * 通ったら、その本人の連絡先・同意・時計・経過を本人の id で読む
 */
export async function loadPersonPage(db: D1Database, principal: Principal, personId: string): Promise<PersonPageRows | null> {
  const brief = await personInScope(db, principal, personId);
  if (!brief) return null;
  const [extra, contacts, consents, clocks, timeline] = await db.batch([
    db
      .prepare(
        `SELECT p.origin, p.self_report_unreliable, p.created_at, p.updated_at, a.display_name AS care_manager_name
           FROM people p LEFT JOIN accounts a ON a.id = p.care_manager_id
          WHERE p.id = ?1 AND p.office_id = ?2`,
      )
      .bind(brief.id, brief.office_id),
    db
      .prepare(
        `SELECT id, person_id, kind, relation, name, phone, reach, emergency_order, supporter_order,
                night_ok, has_car, has_smartphone, note, sort
           FROM contacts WHERE person_id = ?1 ORDER BY sort, id`,
      )
      .bind(brief.id),
    db
      .prepare(
        `SELECT c.person_id, c.kind, c.status, c.scope, c.recorded_by, c.recorded_at, c.expires_at, c.note,
                a.display_name AS recorded_by_name, a.role AS recorded_by_role
           FROM consents c LEFT JOIN accounts a ON a.id = c.recorded_by
          WHERE c.person_id = ?1`,
      )
      .bind(brief.id),
    db.prepare("SELECT * FROM clocks WHERE person_id = ?1 ORDER BY sort, id").bind(brief.id),
    db
      .prepare(
        `SELECT t.id, t.person_id, t.author_id, t.author_role, t.kind, t.body, t.payload, t.signal_id,
                t.occurred_at, t.created_at, a.display_name AS author_name, s.color AS signal_color
           FROM timeline_entries t
           LEFT JOIN accounts a ON a.id = t.author_id
           LEFT JOIN signals s ON s.id = t.signal_id
          WHERE t.person_id = ?1 ORDER BY t.occurred_at, t.created_at, t.id`,
      )
      .bind(brief.id),
  ]);
  const e = extra.results[0] as
    | Pick<PersonRow, "origin" | "self_report_unreliable" | "created_at" | "updated_at"> & {
        care_manager_name: string | null;
      }
    | undefined;
  if (!e) return null;
  return {
    person: {
      id: brief.id,
      office_id: brief.office_id,
      care_manager_id: brief.care_manager_id,
      name: brief.name,
      kana: brief.kana,
      birth_date: brief.birth_date,
      plan_status: brief.plan_status,
      ledger: brief.ledger,
      origin: e.origin,
      self_report_unreliable: e.self_report_unreliable,
      created_at: e.created_at,
      updated_at: e.updated_at,
    },
    careManagerName: e.care_manager_name,
    contacts: contacts.results as unknown as PersonPageRows["contacts"],
    consents: consents.results as unknown as PersonPageRows["consents"],
    clocks: clocks.results as unknown as PersonPageRows["clocks"],
    timeline: timeline.results as unknown as PersonPageRows["timeline"],
  };
}
