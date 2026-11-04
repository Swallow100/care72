// 本人のページ（docs/tasks/T02.md）。台帳（本人の行・連絡先・同意・時計・経過）を区分ごとの行にする。
// 読むのは personInScope を通した人だけ（事業所の壁、lib/auth/scope.ts）。入れる欄（T03）はここに無い。表示だけ。
//
// 空欄の出し方:
// - 台帳の pending（分からない・まだ聞いていない・答えない）は、その欄に「未確認」と理由を出し、区分の見出しに数える。
//   数は ledger.pending の数と同じ（担当一覧の「未確認 N」と合わせる）。T03 は unconfirmed（場所つきの一覧）から次の問いを選ぶ。
// - pending に無い空の欄は「未入力」と出し、数えない（まだ入れていない欄。T79 で「未確認」から分けた。数える物と言葉をそろえる）。
//   状態としての未確認（同意の未確認・値の無い時計）は「未確認」のまま。
// - 配列で持つ欄（機器・薬・ハザード）が空なら「なし」。連絡先は表に全部あるので、無い間柄は「なし」。
//
// 区分の順は sectionOrder（発災時は経過が一番上）。発災時の色と理由は priorityOf に TriageResult を渡す（T09・T13）。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "./age.ts";
import type { Principal } from "./auth/principal.ts";
import { JUDGE_LABEL } from "./auth/roles.ts";
import { personInScope } from "./auth/scope.ts";
import { hazardsOf } from "./caseload.ts";
import { parseLedger, sameMedication } from "./db/ledger.ts";
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
  type PersonReportedAge,
  type SignalColor,
  type ThirdPartyProvisionRow,
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
  CLOCK_UNIT_SHORT,
  CONSENT_KIND_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_FLAG_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  CONTACT_ROLE_LABELS,
  DEPENDENCE_MARKS,
  DEPENDS_ON_LABELS,
  DERIVED_TIMELINE_LABELS,
  DEVICE_LABELS,
  deviceText,
  DOCUMENT_LABELS,
  DOCUMENT_STATUS_LABELS,
  HEAD_LABELS,
  HOUSEHOLD_LABELS,
  householdText,
  MEDICATION_CATEGORY_LABELS,
  MED_PARTS,
  MEDICATION_FLAG_LABELS,
  MY_TIMELINE_LABELS,
  PLAN_STATUS_LABELS,
  SECTION_LABELS,
  SEX_LABELS,
  SMARTPHONE_LABELS,
  stateLabel,
  STRUCTURE_LABELS,
  SUPPORT_KIND_LABELS,
  TIER_LABELS,
  TIMELINE_KIND_LABELS,
} from "./labels.ts";
import { toTriagePerson } from "./triage/from-ledger.ts";
import { clockRemaining, formatHours, tierOf, type Color, type Situation, type Tier, type TriageClock, type TriageResult } from "./triage/index.ts";
import { personSituation, type DisasterSituation } from "./disaster/state.ts";
import type { PersonBrief } from "./auth/scope.ts";
import { withQrView } from "./qr/timeline.ts";
import { officeEntryOf, withOfficeEntry } from "./office/timeline.ts";
import { withCustodyEntry } from "./custody/timeline.ts";
import { shortJst } from "./disaster/state.ts";
import { RETRACT_LABELS } from "./timeline/labels.ts";
import { canRetract, type Retracter } from "./timeline/retract.ts";
import { PROVISION_BASIS_LABELS, PROVISION_SECTION_LABELS, PROVISION_TIMELINE_LABEL } from "./consent/labels.ts";
import { aboutLine, DOCUMENT_CATALOG } from "./forms/catalog.ts";
import { wareki } from "./forms/wareki.ts";
import {
  PROVISION_SECTIONS,
  peopleMode,
  scopeHas,
  viewScope,
  type ProvisionSection,
  type ScopeDocument,
  type ViewScope,
  type WritableKind,
} from "./consent/scope.ts";

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
  { key: "evacuation.stayHome", section: "evacuation", label: "在宅避難" },
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

/** pending の field の画面の名前（いちばん長く一致する欄。無ければ「その他」）。担当一覧の右の面の見直しでも使う */
export function fieldLabelOf(field: string): string {
  return matchField(field)?.label ?? "その他";
}

// ---------- 画面の形 ----------

/**
 * 状態の意味の色（app/globals.css の --state-*）。同じ意味は同じ色:
 * ok 緑（無事・同意・確認済・受入）、urgent 赤（至急・赤の信号・残りの短い時計）、
 * check 黄（要確認・未確認・同意なし・支援者なし・中断注意）、unknown 灰（未知）
 */
export type StateTone = "ok" | "urgent" | "check" | "unknown";

/**
 * 1 つの言葉。tel は電話のリンク（tel: の後ろ、ハイフンなし）。tag は色の付いた印（色だけにせず文字を必ず持つ）。
 * mark は色の無い地の印（関係者の役割「家族」「緊急 1」など。状態の 4 色を使わない。T113）、small は小さな字（心身の未入力の行）
 */
export type Seg = { text: string; tel?: string; tone?: "muted" | StateTone; tag?: true; mark?: true; small?: true };
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
  /** 1 行が 1 人（関係者の連絡先の一覧。T113）。狭い幅で 1 人の行が折り返しても人の境目が分かるよう、行の間を空ける */
  apart?: true;
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

/** 書類の入口。href があれば開ける（紙面ができた書類）。about は何の書類かの 1 行（lib/forms/catalog.ts） */
export type DocumentView = { key: keyof typeof DOCUMENT_LABELS; label: string; status: string; href?: string; about?: string };

/** 計画書に使う様式（事業所の選択。lib/forms/plan-form.ts の loadPlanForm）。無ければ松山市の様式 */
export type PlanFormView = { label: string; about: string; href: (personId: string) => string };

/** できた書類の紙面の場所（T05 計画書・T07 医療要約・T06 本人の 1 枚・T16 QR） */
const DOCUMENT_PATHS: Partial<Record<keyof typeof DOCUMENT_LABELS, (personId: string) => string>> = {
  matsuyama: (id) => `/people/${encodeURIComponent(id)}/forms/matsuyama`,
  medical: (id) => `/people/${encodeURIComponent(id)}/forms/medical`,
  own: (id) => `/people/${encodeURIComponent(id)}/forms/own`,
  qr: (id) => `/people/${encodeURIComponent(id)}/forms/qr`,
  // 本人・家族のスマホ入口（T69a）。ケアマネだけ（医療班・行政の範囲に無い）
  phone: (id) => `/people/${encodeURIComponent(id)}/phone`,
};

export type TimelineItem = {
  id: string;
  /** ISO 8601 */
  at: string;
  /** 日本の時刻 YYYY-MM-DD HH:MM */
  when: string;
  kind: string;
  /** 種類の印の色。赤の信号は赤、受入は緑など */
  tone: StateTone | null;
  body: string | null;
  /** 誰が（役と名前） */
  who: string;
  /** 経過の表の行でなく、種の表（本人の行・同意）から作った物 */
  derived: boolean;
  /** Claude の出力を人が確かめて入れた行（入れる欄の保存）。画面に「AI」の印 */
  ai?: true;
  /**
   * 医療班・行政の書いた行（書き足し・受入・搬送・退所・その場の登録）と提供の行。
   * 医療班への提供に同意の無い人の経過を医療班・行政が開くと、この行だけ出す（lib/consent/scope.ts の timeline "staff"）
   */
  staff?: true;
  /** 同意を記録・変えた行。同意の区分が範囲の外の人（医療班・行政）には出さない */
  consent?: true;
  /**
   * 撤回した行（T63）。行は消さず、画面は種類と本文に取り消し線、2 行目に「撤回 山本 11/3 22:10 理由」。
   * who は撤回した人の名前、when は日本の短い時刻
   */
  retracted?: { who: string; when: string; note: string | null };
  /** 見ている人が撤回できる行（lib/timeline/retract.ts の canRetract。押せるかはサーバーがもう一度決める） */
  retractable?: true;
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
  /** 医療の印と、その時計の色・いちばん短い残り */
  marks: MarkItem[];
  priority: Priority;
  plan: string;
  /** 台帳の pending の数（担当一覧の「未確認 N」と同じ） */
  unconfirmed: number;
  /** 走る時計の残り（平時は全部の長さ、災害モードは今の残り）。短い順、値の無い物は後ろ。上に大きく出す。note は「停電で開始」 */
  clocks: Array<{ id: string; label: string; value: string | null; tone: StateTone | null; note: string | null }>;
  /** 緊急連絡先（順番つき、電話のリンク）。上に大きく出す */
  emergency: Line[];
  /**
   * 範囲（lib/consent/scope.ts）で出す物。false の物は値を空にしてあり、画面は欄ごと出さない（「非表示」とも書かない）。
   * medical: 介護度・医療の印・時計・優先の理由と骨格の段、people: 緊急連絡先、plan: 避難計画と未確認の数
   */
  show: { medical: boolean; people: boolean; plan: boolean };
};

export type UnconfirmedItem = { section: SectionId; field: string; status: PendingStatus; label: string };

export type PersonView = {
  head: PersonHead;
  mode: PageMode;
  /** sectionOrder の順 */
  sections: Section[];
  /** 台帳の pending と、画面のどの区分・欄に出たか（T03 の問いの元）。範囲の外の区分の物は入れない */
  unconfirmed: UnconfirmedItem[];
  /** 経過に書き足せる種類（lib/consent/scope.ts）。空なら書き足しの欄を出さない。範囲を渡さないとき（担当一覧の右の面）は空 */
  writes: WritableKind[];
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
  > &
    /** 台帳の版（入れる欄の保存で、ほかの人の保存と重ならないように確かめる）。D1 から読んだときだけ */
    Partial<Pick<PersonRow, "version">> &
    /** 申告の年齢（医療班・行政がその場で登録した人で、生年月日が無いとき。T23）。D1 から読んだときだけ */
    Partial<PersonReportedAge>;
  /** 担当のケアマネの名前 */
  careManagerName: string | null;
  contacts: ReadonlyArray<Omit<ContactRow, "created_at">>;
  consents: ReadonlyArray<ConsentRow & { recorded_by_name: string | null; recorded_by_role: AccountRole | null }>;
  clocks: ReadonlyArray<ClockRow>;
  /** 経過の行。signal_color は信号の行の色（信号の表から）。retracted_by_name は撤回した人の名前（D1 から読んだときだけ） */
  timeline: ReadonlyArray<
    TimelineEntryRow & { author_name: string | null; signal_color: SignalColor | null; retracted_by_name?: string | null }
  >;
  /** 第三者提供の記録（T23）。経過に「提供 医療班 医療・避難・人の一部」の 1 行で出す。D1 から読んだときだけ */
  provisions?: ReadonlyArray<ProvisionForTimeline>;
};

/** 経過に出す第三者提供の記録の列 */
export type ProvisionForTimeline = Pick<
  ThirdPartyProvisionRow,
  "id" | "recipient_role" | "recipient_name" | "recipient_judge" | "basis" | "scope" | "provided_at"
>;

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

/**
 * 生年月日の言葉（T113）。和暦と西暦の年「昭和16年3月12日（1941）」。1 年目は「元年」。
 * 大正より前は西暦だけ「1911年5月1日」、形が違えばそのまま。年齢の出し方（上の段）は変えない。
 * 計画書の紙（lib/forms/wareki.ts の warekiText）は数の前後を空けるが、本人のページの欄は詰めて 1 つの値として読ませる
 */
export function birthText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const w = wareki(iso);
  if (!w) return `${y}年${mo}月${d}日`;
  return `${w.era}${w.year === 1 ? "元" : w.year}年${mo}月${d}日（${y}）`;
}

const text = (t: string): Seg => ({ text: t });
const muted = (t: string): Seg => ({ text: t, tone: "muted" });
const tag = (t: string, tone: StateTone): Seg => ({ text: t, tone, tag: true });
/** 色の無い地の印（関係者の役割） */
const mark = (t: string): Seg => ({ text: t, mark: true });

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

/** 医療の印 1 つ: 項目名・その区分の時計でいちばん強い色・いちばん短い残り（「4h」「超過」。無ければ null） */
export type MarkItem = { label: string; tone: StateTone | null; remaining: string | null };

/** 時計 1 つの今の残り（時間）。災害モード（s あり）は走った分を引く（まだ走っていない時計は長さのまま）。値の無い時計は null */
function hoursLeft(k: TriageClock, s: Situation | null): { hours: number; over: boolean; running: boolean } | null {
  const r = s ? clockRemaining(k, s) : null;
  if (r) return { hours: r.remaining, over: r.over, running: r.running };
  const h = hoursOf(k);
  return h === null ? null : { hours: h, over: false, running: false };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 印に添える短い残り（「30分」「1.5h」「2.8日」）。走っている時計の今の残り */
function shortHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}${CLOCK_UNIT_SHORT.minute}`;
  if (h < 48) return `${round1(h)}${CLOCK_UNIT_SHORT.hour}`;
  return `${round1(h / 24)}${CLOCK_UNIT_SHORT.day}`;
}

/**
 * 医療の印（担当一覧と同じ並び）と、その区分の時計でいちばん強い色、いちばん短い残り。
 * 平時（s なし）の残りは時計の値そのまま（上の「時計」の欄と同じ数）を短い単位で。
 * 災害モード（s あり、本人の地区を当てた Situation）は今の残り（走っている時計は走った分を引き、超えたら「超過」と赤。
 * まだ走っていない時計は長さのまま）。走らない時計（本人の状態）・値の無い時計は数えない。
 * 担当一覧・受け持ちの表の狭い幅（医療の列を省くとき氏名の下に出す。T54）も同じ物
 */
export function markItems(clocks: ReadonlyArray<TriageClock>, s: Situation | null = null): MarkItem[] {
  return DEPENDENCE_MARKS.flatMap(([category, label]) => {
    const mine = clocks.filter((k) => k.category === category);
    if (mine.length === 0) return [];
    const tones = mine
      .map((k) => (k.starts_on === "none" ? null : clockTone(hoursLeft(k, s)?.hours ?? null)))
      .filter((t) => t !== null);
    const tone = tones.sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0] ?? null;
    const shortest = mine
      .filter((k) => k.starts_on !== "none" && k.value != null && k.unit != null)
      .map((k) => ({ k, left: hoursLeft(k, s)! }))
      .sort((a, b) => a.left.hours - b.left.hours)[0];
    const remaining = !shortest
      ? null
      : shortest.left.over
        ? HEAD_LABELS.over
        : shortest.left.running
          ? shortHours(shortest.left.hours)
          : `${shortest.k.value}${CLOCK_UNIT_SHORT[shortest.k.unit!]}`;
    return [{ label, tone, remaining }];
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

/** 電源で動く機器。時計（電池）が無ければ「電池 未確認」と出す */
const POWERED_DEVICES = new Set<DeviceKind>(["oxygen", "ventilator", "suction"]);

function medicalBlocks(ledger: Ledger, contacts: Contact[], clocks: PersonPageRows["clocks"]): Block[] {
  const { medical } = ledger;
  const blank = muted(BLANK_LABELS.blank);
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
            // その他は「その他（電動ベッド）」の 1 語（受け持ちの表・担当一覧と同じ。T64）、ほかの種類は種類と中身を別の欄に
            const name = d.kind === "other" ? [text(deviceText(d))] : [text(DEVICE_LABELS[d.kind]), text(d.detail ?? "")];
            return [...name, muted(d.schedule ?? ""), ...clockSegs];
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
    // 在宅避難の印（T37）。無ければ避難所へ（「なし」）
    row("evacuation.stayHome", e.stayHome === true ? { kind: "lines", lines: [[text("あり")]] } : { kind: "none" }),
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

/** 人の一部（医療班・行政。lib/consent/scope.ts の people_partial）で残す欄: 緊急連絡先と支援者 1・2（役割名だけ） */
const PARTIAL_PEOPLE_KEYS = ["people.emergency", "people.supporter1", "people.supporter2"] as const;

/** 支援者の役割名（間柄か種類）。名前・電話・どこにいるか・備考は出さない */
function supporterRoleLine(c: Contact): Line {
  const relation = c.relation?.trim();
  const segs: Seg[] = [text(relation || CONTACT_KIND_LABELS[c.kind])];
  if (relation && c.kind !== "family" && c.kind !== "supporter") segs.push(muted(CONTACT_KIND_LABELS[c.kind]));
  return segs;
}

/**
 * 人の区分を「人の一部」に: 緊急連絡先（名前・電話つき）と、支援者 1・2 を役割名だけ。ほかの欄（家族・民生委員・みまもり員・
 * 夜間支援・関係先と、欄の無い場所の未確認）は出さない。欄に付いた未確認はそのまま
 */
function partialPeopleBlocks(blocks: Block[], contacts: Contact[]): Block[] {
  const supporters = contacts.filter((c) => c.supporter_order != null);
  return blocks.flatMap((b): Block[] => {
    if (b.type !== "row" || !(PARTIAL_PEOPLE_KEYS as readonly string[]).includes(b.row.key)) return [];
    if (b.row.key === "people.emergency") return [b];
    const n = b.row.key === "people.supporter1" ? 1 : 2;
    const c = supporters.find((s) => s.supporter_order === n);
    if (!c) return [b];
    return [{ type: "row", row: { ...b.row, field: { kind: "lines", lines: [supporterRoleLine(c)] } } }];
  });
}

/**
 * 連絡先の一覧の 1 行（T113）: 名前・間柄・役割の印（種類・緊急 N・支援 N・夜間可）・夜間の不可と未確認・距離・車・スマホ・電話・備考。
 * 1 人を 1 行にまとめ、電話は 1 回だけ出す
 */
function contactListLine(c: Contact): Line {
  const label = c.name ?? (c.relation || CONTACT_KIND_LABELS[c.kind]);
  const segs: Seg[] = [text(label)];
  if (c.name && c.relation) segs.push(muted(c.relation));
  // 種類の印（家族・支援者・民生委員・訪問看護など）。名前の代わりに出した言葉と同じなら重ねない。「その他」は何も言わないので付けない
  const kind = CONTACT_KIND_LABELS[c.kind];
  if (c.kind !== "other" && kind !== label) segs.push(mark(kind));
  if (c.emergency_order != null) segs.push(mark(`${CONTACT_ROLE_LABELS.emergency} ${c.emergency_order}`));
  if (c.supporter_order != null) segs.push(mark(`${CONTACT_ROLE_LABELS.supporter} ${c.supporter_order}`));
  if (c.night_ok === 1) segs.push(mark(CONTACT_FLAG_LABELS.nightOk));
  else if (COMES_KINDS.has(c.kind)) segs.push(muted(c.night_ok === 0 ? CONTACT_FLAG_LABELS.nightNo : CONTACT_FLAG_LABELS.nightUnknown));
  if (c.reach) segs.push(muted(CONTACT_REACH_LABELS[c.reach]));
  if (c.has_car === 1) segs.push(muted(CONTACT_FLAG_LABELS.hasCar));
  if (c.has_smartphone === 1) segs.push(muted(CONTACT_FLAG_LABELS.hasSmartphone));
  if (c.phone) segs.push({ text: c.phone, tel: telHref(c.phone) });
  if (c.note) segs.push(muted(c.note));
  return segs;
}

/** 一覧の並び: 緊急の順 → 支援の順 → ほか（台帳の並び）。順の無い人は後ろ */
function listOrder(a: Contact, b: Contact): number {
  const by = (k: "emergency_order" | "supporter_order") => (a[k] ?? Infinity) - (b[k] ?? Infinity);
  return by("emergency_order") || by("supporter_order") || 0;
}

/**
 * 関係者の区分（読む側。T113）。連絡先は 1 人 1 行の一覧にし、役割（家族・緊急 1・支援 1・夜間可など）を印で並べる
 * （前は家族・緊急連絡先・支援者1・夜間支援の 4 か所に同じ人が並び、電話が 3 回出た）。
 * 役割の欄は、埋まっていないときだけ「なし」「未入力」の行で残す（支援者1 なしは注意の色。みまもり員は連絡先でないのでいつも）。
 * 埋まった役割に付いた未確認は attachPending がその欄の名前の行を足す。
 * 計画書・連絡順・医療要約・上の段の緊急連絡先は contacts を直に読むので変わらない。医療班・行政の「人の一部」は peopleRoleBlocks
 */
function peopleBlocks(contacts: Contact[], ledger: Ledger): Block[] {
  const listed = contacts.filter((c) => !SHOWN_ELSEWHERE.has(c.kind)).sort(listOrder);
  const out: Row[] = [];
  if (listed.length > 0) {
    out.push({
      key: "people.contacts",
      label: CONTACT_ROLE_LABELS.list,
      field: { kind: "lines", lines: listed.map(contactListLine) },
      pending: [],
      apart: true,
    });
  }
  const has = (f: (c: Contact) => boolean) => contacts.some(f);
  if (!has((c) => c.kind === "family")) out.push(row("people.family", { kind: "none" }));
  if (!has((c) => c.emergency_order != null)) out.push(row("people.emergency", { kind: "none" }));
  // 支援者1 が無い（連絡順の並びで「支援者なし」が先になる）は注意の色。前の形（peopleRoleBlocks）と同じ
  if (!has((c) => c.supporter_order === 1)) out.push(row("people.supporter1", { kind: "none", tone: "check" }));
  if (!has((c) => c.supporter_order === 2)) out.push(row("people.supporter2", { kind: "none" }));
  if (!has((c) => c.kind === "welfare_commissioner")) out.push(row("people.welfare_commissioner", { kind: "none" }));
  out.push(row("local.watcher", textField(ledger.local?.watcher)));
  if (!has((c) => c.night_ok === 1)) {
    out.push(row("people.night_supporter", has((c) => c.night_ok === 0) ? { kind: "none" } : { kind: "unconfirmed" }));
  }
  return out.map((r): Block => ({ type: "row", row: r }));
}

/**
 * 役割ごとの欄（前の形）。医療班・行政の「人の一部」（partialPeopleBlocks）だけがこれを絞って使う:
 * 緊急連絡先（名前・電話つき）と支援者 1・2 の役割名。範囲の外の欄に付いた未確認を出さないため、欄の形はそのまま
 */
function peopleRoleBlocks(contacts: Contact[], ledger: Ledger): Block[] {
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

  // 心身: 内閣府様式の裏の 6 項目と、寝たきり・認知症。入った項目だけを並べ、空の項目は下の 1 行に灰の小さな字で
  // 「未入力　聴覚・視覚・…」とまとめる（前は空も 1 つずつ「聴覚 未入力」と出し、入った値が埋もれた。T113、11/5 の決め）。
  // 寝たきり・認知症の「なし」（無いと分かっている）は入った物。全部空なら lines が「未入力」だけにする
  const entered: Seg[] = [];
  const blank: string[] = [];
  for (const k of Object.keys(ABILITY_ITEM_LABELS) as Array<keyof typeof ABILITY_ITEM_LABELS>) {
    const v = care[k];
    if (v) entered.push(text(`${ABILITY_ITEM_LABELS[k]} ${ABILITY_LABELS[v]}`));
    else blank.push(ABILITY_ITEM_LABELS[k]);
  }
  for (const [k, label] of [
    ["bedridden", CARE_FLAG_LABELS.bedridden],
    ["dementia", CARE_FLAG_LABELS.dementia],
  ] as const) {
    const v = care[k];
    if (v === true) entered.push(text(label));
    else if (v === false) entered.push(text(`${label} ${BLANK_LABELS.none}`));
    else blank.push(label);
  }
  const blankLine: Line = [{ ...muted(`${BLANK_LABELS.blank}　${blank.join("・")}`), small: true }];
  const careLines: Line[] = entered.length === 0 ? [] : blank.length > 0 ? [entered, blankLine] : [entered];

  const out = [
    row("basic.address", basic.address ? textField(`${basic.address.city} ${basic.address.town}`) : { kind: "unconfirmed" }),
    row("basic.birth", textField(rows.person.birth_date ? birthText(rows.person.birth_date) : null)),
    row("basic.sex", textField(basic.sex ? SEX_LABELS[basic.sex] : null)),
    row("basic.contactMeans", contactMeans),
    row(
      "basic.contactMeans.smartphone",
      textField(basic.contactMeans?.smartphone ? SMARTPHONE_LABELS[basic.contactMeans.smartphone] : null),
    ),
    row("basic.household", textField(basic.household ? householdText(basic.household, basic.householdNote) : null)),
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

/** 書類の区分。範囲（lib/consent/scope.ts の documents）にある書類だけ */
function documentBlocks(personId: string, allowed: readonly ScopeDocument[], plan: PlanFormView | undefined): Block[] {
  const keys = (Object.keys(DOCUMENT_LABELS) as Array<keyof typeof DOCUMENT_LABELS>).filter((k) => allowed.includes(k));
  return [
    {
      type: "documents",
      documents: keys.map((key): DocumentView => {
        // 計画書は事業所の選んだ様式（T47）。名前と説明もその様式の物
        if (key === "matsuyama" && plan) {
          return { key, label: plan.label, status: DOCUMENT_STATUS_LABELS.ready, href: plan.href(personId), about: plan.about };
        }
        const path = DOCUMENT_PATHS[key];
        const about = aboutLine(DOCUMENT_CATALOG[key]);
        return path
          ? { key, label: DOCUMENT_LABELS[key], status: DOCUMENT_STATUS_LABELS.ready, href: path(personId), about }
          : { key, label: DOCUMENT_LABELS[key], status: DOCUMENT_STATUS_LABELS.pending, about };
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

/** 医療班・行政の書いた行（lib/consent/scope.ts の timeline "staff" で出す行） */
const STAFF_AUTHORS = new Set<TimelineEntryRow["author_role"]>(["medical", "government"]);

/** 記録の区分の JSON を、言葉の順（本人確認・医療・避難・人の一部・住所）に。知らない値は落とす */
function provisionSections(scope: string): ProvisionSection[] {
  try {
    const v = JSON.parse(scope) as unknown;
    if (!Array.isArray(v)) return [];
    return PROVISION_SECTIONS.filter((s) => v.includes(s));
  } catch {
    return [];
  }
}

/** 提供の 1 行: 種類「提供」、本文は渡した区分と根拠（医療・避難・人の一部 同意）、誰がは相手の役と名前 */
function provisionItem(pr: ProvisionForTimeline): TimelineItem {
  // 本人確認はほかの区分があれば言わない（「医療・避難・人の一部」）。本人確認だけなら「本人確認」
  const all = provisionSections(pr.scope);
  const rest = all.filter((s) => s !== "identity");
  const sections = (rest.length > 0 ? rest : all).map((s) => PROVISION_SECTION_LABELS[s]);
  return {
    id: `derived-provision-${pr.id}`,
    at: pr.provided_at,
    when: formatJst(pr.provided_at),
    kind: PROVISION_TIMELINE_LABEL,
    tone: null,
    body: [sections.join("・"), PROVISION_BASIS_LABELS[pr.basis]].filter((s) => s).join(" "),
    who: who(AUTHOR_ROLE_LABELS[pr.recipient_role], pr.recipient_name ?? (pr.recipient_judge === 1 ? JUDGE_LABEL : null)),
    derived: true,
    staff: true,
  };
}

/**
 * 経過。経過の表の行に、種の表から作れる物を足す:
 * - 本人の行を作った時刻 →「入力」（書き手は担当のケアマネ。医療班がその場で作った人は医療班）。
 *   利用者追加（T30）で作った人は、経過の表に「利用者追加」の行（書き手は足した人）があるので作らない
 * - 同意を記録した時刻 →「同意」（記録した人ごと・時刻ごとに 1 行）。同じ時刻の「同意」の行が経過の表にあれば作らない
 * - 第三者提供の記録 →「提供」（相手の役と名前、渡した区分と根拠）
 * 並びは時刻の順（同じ時刻なら作った物が先）。撤回した行（T63）も元の時刻の所に残す（取り消し線）。
 * viewer を渡すと、その人が撤回できる行に retractable を付ける（単独の本人のページだけ）
 */
export function timelineItems(rows: PersonPageRows, viewer: Retracter | null = null): TimelineItem[] {
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
    ...(STAFF_AUTHORS.has(t.author_role) ? { staff: true as const } : {}),
    ...(t.kind === "consent" ? { consent: true as const } : {}),
    ...(t.retracted_at
      ? { retracted: { who: t.retracted_by_name || RETRACT_LABELS.unknown, when: shortJst(t.retracted_at), note: t.retracted_note ?? null } }
      : {}),
    ...(viewer && canRetract(viewer, t) ? { retractable: true as const } : {}),
  }));

  const derived: TimelineItem[] = [];
  const p = rows.person;
  if (!rows.timeline.some((t) => officeEntryOf(t)?.action === "added")) {
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
      // その場で登録した人は医療班・行政が作った（T23）
      ...(p.origin === "on_site" ? { staff: true as const } : {}),
    });
  }

  // 第三者提供の記録（T23）は「提供 医療班 医療・避難・人の一部」の 1 行（書類の面には出さない）。同じ時刻の受入のあと
  const provided = (rows.provisions ?? []).map(provisionItem);

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
      consent: true,
    });
  }

  // QR の頁の閲覧（kind は note、payload の source が qr_view）は「QR 閲覧」と相手（lib/qr/timeline.ts）。
  // 利用者追加・担当変更・一覧除外・一覧復帰・引受（source が office）はその種類（lib/office/timeline.ts）。
  // 医療班・行政の受入・搬送・退所（source が custody）は「受入」「搬送」「退所」（lib/custody/timeline.ts）
  // 同じ時刻の並び: 作った物（入力・同意）→ 経過の表の行 → 提供
  const grouped = [
    ...derived.map((item) => ({ item, g: 0 })),
    ...stored.map((item, i) => ({
      item: withCustodyEntry(withOfficeEntry(withQrView(item, rows.timeline[i]), rows.timeline[i]), rows.timeline[i]),
      g: 1,
    })),
    ...provided.map((item) => ({ item, g: 2 })),
  ];
  return grouped
    .map((x, i) => ({ ...x, i, t: Date.parse(x.item.at) }))
    .sort((a, b) => a.t - b.t || a.g - b.g || a.i - b.i)
    .map((x) => x.item);
}

// ---------- pending を欄に付ける ----------

const MED_REMAINING = /^medical\.medications\.([^.]+)\.remaining$/;

/**
 * 薬の残りの pending は、その薬の時計（残りの日数）の行に付ける。薬は番号か名前で探し、
 * 見つからなければ、値の無い薬の時計が 1 つだけのときにそこへ（種の山田さんの「ワーファリン」はこれ）
 */
function clockForPending(field: string, ledger: Ledger, clocks: ClockView[], rows: PersonPageRows): ClockView | null {
  const id = pendingClockId(field, ledger, rows.clocks);
  return id ? (clocks.find((k) => k.id === id) ?? null) : null;
}

/** pending がどの時計に付くか（clocks.<id> か、薬の残り medical.medications.<番号か名前>.remaining）。入れる欄の問いと保存も使う */
export function pendingClockId(
  field: string,
  ledger: Ledger,
  clocks: ReadonlyArray<Pick<ClockRow, "id" | "kind" | "value" | "label">>,
): string | null {
  const direct = /^clocks\.([^.]+)/.exec(field);
  if (direct) return clocks.some((k) => k.id === direct[1]) ? direct[1] : null;
  const m = MED_REMAINING.exec(field);
  if (!m) return null;
  const empty = clocks.filter((k) => k.kind === "medication" && k.value == null);
  const med = /^\d+$/.test(m[1]) ? ledger.medical.medications[Number(m[1])] : ledger.medical.medications.find((x) => x.name === m[1]);
  const target = med ? empty.find((k) => sameMedication(k.label, med.name)) : empty.length === 1 ? empty[0] : undefined;
  return target?.id ?? null;
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
    // 画面に欄の無い場所。区分の終わりに 1 行足す。欄の決まりはあるのに行を出していない物（関係者の埋まった役割。T113）は、
    // その欄の名前と場所の行にする（同じ欄の 2 つ目からはこの行に付く）。決まりの無い場所は「その他」
    const section = def?.section ?? sectionOfField(p.field);
    const extra: Row = def
      ? { key: def.key, label: def.label, field: { kind: "unconfirmed" }, pending: [p] }
      : { key: p.field, label: "その他", field: { kind: "unconfirmed" }, pending: [p] };
    sections.get(section)!.push({ type: "row", row: extra });
    out.push({ section, field: p.field, status: p.status, label: extra.label });
  }
  return out;
}

// ---------- 全体 ----------

/**
 * 上に大きく出す時計の残り。走る時計を短い順に、値の無い物は後ろ。
 * 平時は時計の長さ（「2 時間」）。災害モード（s あり）は今の残り（「残り 1.5 時間」「超過 30 分」、色は残りの長さ）で、
 * まだ走っていない時計は長さと「停電で開始」（担当一覧の行の詳細と同じ言い方）
 */
function headClocks(clocks: ReadonlyArray<ClockRow>, s: Situation | null = null): PersonHead["clocks"] {
  return clocks
    .filter((k) => k.starts_on !== "none")
    .map((k) => ({ k, left: hoursLeft(k, s) }))
    .sort((a, b) => (a.left?.hours ?? Infinity) - (b.left?.hours ?? Infinity))
    .map(({ k, left }) => {
      const length = k.value != null && k.unit != null ? `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : null;
      if (!s || !left) return { id: k.id, label: k.label, value: length, tone: clockTone(left?.hours ?? null), note: null };
      if (!left.running) {
        const note = `${CLOCK_START_LABELS[k.starts_on]}${HEAD_LABELS.startsOn}`;
        return { id: k.id, label: k.label, value: length, tone: clockTone(left.hours), note };
      }
      return {
        id: k.id,
        label: k.label,
        value: left.over ? `${HEAD_LABELS.over} ${formatHours(-left.hours)}` : `${HEAD_LABELS.left} ${formatHours(left.hours)}`,
        tone: clockTone(left.hours),
        note: null,
      };
    });
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
      // 受入・搬送から来た緑は「受入」「搬送」（T78。色は表のまま）
      label: stateLabel(triage),
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
  /** 発災時の今・発災・停電（lib/disaster/person の situation）。あれば上の医療の印と時計の欄を今の残りにする（地区は台帳の町名で当てる） */
  situation?: DisasterSituation | null;
  /**
   * 見る人の範囲（lib/consent/scope.ts）。無ければケアマネの範囲（全部）。
   * 範囲の外の区分・欄は作らない（「非表示」とも書かない）。医療班・行政は app/people/[id] が scopeOfRows で渡す
   */
  scope?: ViewScope;
  /** 事業所が計画書に使う様式（T47）。無ければ松山市の様式 */
  planForm?: PlanFormView;
  /**
   * 見ている人（T63）。渡すと経過の撤回できる行に撤回のボタン（lib/timeline/retract.ts の canRetract）。
   * 書き足しの欄（writes）と同じく単独の本人のページだけが渡す（担当一覧の右の面は渡さない）
   */
  viewer?: Retracter;
};

/** 区分の中の未確認の数（欄と時計に付いた pending） */
function pendingCount(blocks: readonly Block[]): number {
  return blocks.reduce(
    (n, b) =>
      n + (b.type === "row" ? b.row.pending.length : b.type === "clocks" ? b.clocks.reduce((m, k) => m + k.pending.length, 0) : 0),
    0,
  );
}

/** 範囲で見える区分 */
function sectionVisible(id: SectionId, scope: ViewScope): boolean {
  switch (id) {
    case "medical":
    case "evacuation":
    case "consent":
      return scopeHas(scope, id);
    case "people":
      return peopleMode(scope) !== null;
    case "basic":
      return scopeHas(scope, "basic") || scopeHas(scope, "address");
    case "documents":
      return (Object.keys(DOCUMENT_LABELS) as ScopeDocument[]).some((k) => scope.documents.includes(k));
    case "timeline":
      return scope.timeline !== "none";
  }
}

/** 範囲で区分の中を絞る（人の一部・住所だけの基本・医療班の書いた行だけの経過） */
function scopedBlocks(id: SectionId, blocks: Block[], scope: ViewScope, contacts: Contact[]): Block[] {
  if (id === "people" && peopleMode(scope) === "partial") return partialPeopleBlocks(blocks, contacts);
  if (id === "basic" && !scopeHas(scope, "basic")) {
    return blocks.filter((b) => b.type === "row" && b.row.key === "basic.address");
  }
  if (id === "timeline") {
    // 本人確認だけなら医療班・行政の書いた行と提供の行だけ。同意の区分が範囲の外なら同意の行も出さない
    const keep = (t: TimelineItem) => (scope.timeline !== "staff" || t.staff === true) && (scopeHas(scope, "consent") || !t.consent);
    return blocks.map((b) => (b.type === "timeline" ? { ...b, items: b.items.filter(keep) } : b));
  }
  return blocks;
}

export function toPersonView(rows: PersonPageRows, opts: ViewOptions): PersonView {
  const mode = opts.mode ?? "normal";
  const { person } = rows;
  const scope = opts.scope ?? viewScope("care_manager", { consents: rows.consents, origin: person.origin });
  const ledger = parseLedger(person.ledger);
  const contacts = [...rows.contacts].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const clocks = [...rows.clocks].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));

  const sections = new Map<SectionId, Block[]>([
    ["medical", medicalBlocks(ledger, contacts, clocks)],
    ["evacuation", evacuationBlocks(ledger)],
    // 医療班・行政の「人の一部」は役割ごとの欄から絞る（緊急連絡先と支援者 1・2 の役割名）。ほかは 1 人 1 行の一覧（T113）
    ["people", peopleMode(scope) === "partial" ? peopleRoleBlocks(contacts, ledger) : peopleBlocks(contacts, ledger)],
    ["basic", basicBlocks({ ...rows, contacts }, ledger)],
    ["consent", consentBlocks(rows.consents)],
    ["documents", documentBlocks(person.id, scope.documents, opts.planForm)],
    ["timeline", [{ type: "timeline", items: timelineItems(rows, opts.viewer ?? null) }]],
  ]);
  const unconfirmed = attachPending(sections, ledger, rows);

  const show = {
    medical: scopeHas(scope, "medical"),
    people: peopleMode(scope) !== null,
    plan: scopeHas(scope, "plan"),
  };
  const tier = tierOf(toTriagePerson({ person, ledger, contacts, clocks }));
  // 災害モードは今の残り（本人の町名で停電の地区を当てる）。平時は時計の長さ
  const own = mode === "disaster" && opts.situation ? personSituation(opts.situation, ledger.basic.address?.town) : null;
  const marks = markItems(clocks, own);
  const strongest = marks.map((m) => m.tone).filter((t) => t !== null).sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0];
  const priority = priorityOf(tier, opts.triage, strongest ?? null);
  const head: PersonHead = {
    id: person.id,
    name: person.name,
    kana: person.kana,
    // 生年月日が無ければ申告の年齢（その場で登録した人、T23）
    age: person.birth_date ? ageOn(person.birth_date, opts.today) : (person.reported_age ?? null),
    careLevel: show.medical && ledger.care.careLevel ? CARE_LEVEL_LABELS[ledger.care.careLevel] : null,
    marks: show.medical ? marks : [],
    // 医療が範囲の外なら、状態の色と言葉だけ（理由は時計・薬の名前が入るので空にする。骨格の段は画面に出さない）
    priority: show.medical || priority.kind === "tier" ? priority : { ...priority, reason: "" },
    plan: PLAN_STATUS_LABELS[person.plan_status],
    unconfirmed: show.plan ? ledger.pending.length : 0,
    clocks: show.medical ? headClocks(clocks, own) : [],
    emergency: show.people ? headEmergency(contacts) : [],
    show,
  };

  const shown = sectionOrder(mode)
    .filter((id) => sectionVisible(id, scope))
    .map((id): Section => {
      const blocks = scopedBlocks(id, sections.get(id)!, scope, contacts);
      return { id, label: SECTION_LABELS[id], blocks, unconfirmed: pendingCount(blocks) };
    });
  // T03 の問いの元も見える欄の物だけ（医療班・行政に範囲の外の欄の名前を渡さない）
  const kept = new Set(
    shown.flatMap((s) =>
      s.blocks.flatMap((b) =>
        (b.type === "row" ? b.row.pending : b.type === "clocks" ? b.clocks.flatMap((k) => k.pending) : []).map((p) => p.field),
      ),
    ),
  );

  return {
    head,
    mode,
    sections: shown,
    unconfirmed: unconfirmed.filter((u) => kept.has(u.field)),
    // 書き足しの欄は範囲を渡した画面（単独の本人のページ）だけ。担当一覧の右の面は電話・優先変更の欄があるので出さない
    writes: opts.scope ? [...opts.scope.writes] : [],
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
  return loadPersonRows(db, brief);
}

/**
 * 本人の行（壁を通したあと）から、連絡先・同意・時計・経過を読む。壁を通さずに呼ぶのは QR の頁（lib/qr/view.ts）だけで、
 * そこでは署名と版を確かめたトークンが壁の代わり
 */
export async function loadPersonRows(db: D1Database, brief: PersonBrief): Promise<PersonPageRows | null> {
  const [extra, contacts, consents, clocks, timeline, provisions] = await db.batch([
    db
      .prepare(
        `SELECT p.origin, p.self_report_unreliable, p.created_at, p.updated_at, p.version, p.reported_age,
                a.display_name AS care_manager_name
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
                t.occurred_at, t.created_at, a.display_name AS author_name, s.color AS signal_color,
                t.retracted_at, t.retracted_by, t.retracted_note, r.display_name AS retracted_by_name
           FROM timeline_entries t
           LEFT JOIN accounts a ON a.id = t.author_id
           LEFT JOIN signals s ON s.id = t.signal_id
           LEFT JOIN accounts r ON r.id = t.retracted_by
          WHERE t.person_id = ?1 ORDER BY t.occurred_at, t.created_at, t.id`,
      )
      .bind(brief.id),
    db
      .prepare(
        `SELECT id, recipient_role, recipient_name, recipient_judge, basis, scope, provided_at
           FROM third_party_provisions WHERE person_id = ?1 ORDER BY provided_at, id`,
      )
      .bind(brief.id),
  ]);
  const e = extra.results[0] as
    | Pick<PersonRow, "origin" | "self_report_unreliable" | "created_at" | "updated_at" | "version"> &
        PersonReportedAge & {
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
      version: e.version,
      // 申告の年齢はあるときだけ（T23。台帳から作った人には無い）
      ...(e.reported_age != null ? { reported_age: e.reported_age } : {}),
    },
    careManagerName: e.care_manager_name,
    contacts: contacts.results as unknown as PersonPageRows["contacts"],
    consents: consents.results as unknown as PersonPageRows["consents"],
    clocks: clocks.results as unknown as PersonPageRows["clocks"],
    timeline: timeline.results as unknown as PersonPageRows["timeline"],
    provisions: provisions.results as unknown as ProvisionForTimeline[],
  };
}
