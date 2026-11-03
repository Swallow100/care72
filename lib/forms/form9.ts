// 様式 9「災害時利用者一覧表（安否確認優先順位）」。厚労省の介護施設・事業所の自然災害 BCP ひな形（様式集の Excel）の様式 9 を既定にする。
// 列の名前と順はひな形の様式 9 のシート（2026-11-02 に読んだ。docs/progress/t15.md）。ひな形の列のあとに、ケア72 が足した列を置く。
//
// 優先順位は lib/triage の並び。平時は優先の骨格の段（tierOf）、発災時は TriageResult の並び（色と順位、compareResults）。
// 手直しは自動の並びに手で決めた順位を差し込むだけで、色と理由は変えない。直した理由は form9_rank_edits に残る（足すだけ）。
// 発災時の結果の列は信号と経過から入る（form9-db.ts が読む）。
// D1 から読む所は form9-db.ts、CSV は form9-csv.ts、市町村への報告の下書きは form9-report.ts。ここは D1 に触らない。

import { ageOn } from "../age.ts";
import { hazardsOf, marksOf } from "../caseload.ts";
import { parseLedger } from "../db/ledger.ts";
import type {
  AuthorRole,
  ClockRow,
  ContactRow,
  Form9Mode,
  Form9RankEditRow,
  Ledger,
  PersonRow,
  SignalColor,
  SignalSource,
  TimelineKind,
  WhereNow,
} from "../db/types.ts";
import {
  ABILITY_LABELS,
  AUTHOR_ROLE_LABELS,
  CARE_LEVEL_LABELS,
  COLOR_LABELS,
  CONTACT_KIND_LABELS,
  DEPENDS_ON_LABELS,
  householdText,
  TIER_LABELS,
  TIMELINE_KIND_LABELS,
} from "../labels.ts";
import { formatJst } from "../person.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import {
  clockHours,
  compareResults,
  formatHours,
  TABLE_DEPENDS,
  tierOf,
  type Color,
  type Tier,
  type TriageResult,
} from "../triage/index.ts";

// ---------- 列 ----------

/** ひな形の題名（シートの B2 のまま） */
export const FORM9_TITLE = "様式9：災害時利用者一覧表 (安否確認優先順位)";

export type Form9ColumnId =
  | "no"
  | "medicalCare"
  | "environment"
  | "evacuation"
  | "area"
  | "nameAge"
  | "address"
  | "shelter"
  | "facility"
  | "notes"
  | "careManager"
  | "checkedAt"
  | "color"
  | "reason"
  | "emergency1"
  | "emergency2"
  | "means"
  | "result"
  | "manual";

export type Form9Column = {
  id: Form9ColumnId;
  /** CSV の見出し。ひな形の列はひな形の言葉（2 段の見出しは上の段を括弧の外に） */
  csv: string;
  /** 画面の見出し（2〜4 字） */
  label: string;
  /** 2 段の見出しの上の段（ひな形の「優先順位※」「想定される避難場所」） */
  group?: string;
  /** mhlw はひな形の列、care72 はケア72 が足した列 */
  origin: "mhlw" | "care72";
};

/**
 * 列。ひな形の様式 9 の順（No・優先順位※〔医療・介護／環境／避難〕・地域／区分・氏名（年齢）・住所(自治会)・
 * 想定される避難場所〔避難所／介護・医療機関〕・特記・担当ケアマネ・安否確認できた日）のあとに、ケア72 の列。
 * 「安否確認できた日」には時刻まで入れる（仕事の頼みの「時刻」の列を兼ねる）。
 */
export const FORM9_COLUMNS: ReadonlyArray<Form9Column> = [
  { id: "no", csv: "No", label: "順位", origin: "mhlw" },
  { id: "medicalCare", csv: "優先順位（医療・介護）", label: "医療・介護", group: "優先順位", origin: "mhlw" },
  { id: "environment", csv: "優先順位（環境）", label: "環境", group: "優先順位", origin: "mhlw" },
  { id: "evacuation", csv: "優先順位（避難）", label: "避難", group: "優先順位", origin: "mhlw" },
  { id: "area", csv: "地域／区分", label: "地域・区分", origin: "mhlw" },
  { id: "nameAge", csv: "氏名（年齢）", label: "氏名", origin: "mhlw" },
  { id: "address", csv: "住所（自治会）", label: "住所", origin: "mhlw" },
  { id: "shelter", csv: "想定される避難場所（避難所）", label: "避難所", group: "避難場所", origin: "mhlw" },
  { id: "facility", csv: "想定される避難場所（介護・医療機関）", label: "医療機関", group: "避難場所", origin: "mhlw" },
  { id: "notes", csv: "特記", label: "特記", origin: "mhlw" },
  { id: "careManager", csv: "担当ケアマネ", label: "担当", origin: "mhlw" },
  { id: "checkedAt", csv: "安否確認できた日", label: "確認日時", origin: "mhlw" },
  { id: "color", csv: "連絡順（色）", label: "連絡順", origin: "care72" },
  { id: "reason", csv: "連絡順の理由", label: "理由", origin: "care72" },
  { id: "emergency1", csv: "緊急連絡先1", label: "連絡先1", origin: "care72" },
  { id: "emergency2", csv: "緊急連絡先2", label: "連絡先2", origin: "care72" },
  { id: "means", csv: "安否確認の方法", label: "確認方法", origin: "care72" },
  { id: "result", csv: "安否確認の結果", label: "結果", origin: "care72" },
  { id: "manual", csv: "備考（順位の手直し）", label: "手直し", origin: "care72" },
];

// ---------- 入力 ----------

export type Form9PersonInput = {
  person: Pick<PersonRow, "id" | "name" | "kana" | "birth_date" | "self_report_unreliable" | "ledger">;
  /** 担当ケアマネの名前 */
  careManager: string | null;
  contacts: ReadonlyArray<
    Pick<ContactRow, "kind" | "relation" | "name" | "phone" | "emergency_order" | "supporter_order" | "has_smartphone">
  >;
  clocks: ReadonlyArray<
    Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check">
  >;
};

/** 信号 1 つ（本人・家族・支援者・ケアマネの赤緑）。訓練の信号は入れない */
export type Form9Signal = {
  color: SignalColor;
  source: SignalSource;
  whereNow: WhereNow | null;
  injured: boolean | null;
  canMove: boolean | null;
  at: string;
};

/** 経過のうち安否に関わる物（安否確認・避難所に着いた・受入・搬送・受持解除） */
export const FORM9_ENTRY_KINDS = ["safety_check", "arrived_shelter", "received", "transported", "released"] as const;
export type Form9EntryKind = (typeof FORM9_ENTRY_KINDS)[number] & TimelineKind;

export type Form9Entry = {
  kind: Form9EntryKind;
  authorRole: AuthorRole;
  /** 避難所の名前（経過の payload の shelter か本文）。無ければ null */
  place: string | null;
  at: string;
};

/** 1 人の発災のあとの知らせ */
export type Form9Reports = { signals: ReadonlyArray<Form9Signal>; entries: ReadonlyArray<Form9Entry> };

/** 手直し 1 回（form9_rank_edits の行と、直した人の名前） */
export type Form9RankEdit = Pick<Form9RankEditRow, "id" | "person_id" | "mode" | "rank" | "auto_rank" | "reason" | "set_at"> & {
  set_by_name: string | null;
};

// ---------- 出力 ----------

export type Form9Manual = { rank: number; autoRank: number; reason: string; by: string | null; at: string };

/** 所在: 自宅・避難所・その他・搬送・不明 */
export type Form9Location = "home" | "shelter" | "other" | "transported" | "unknown";

export const LOCATION_LABELS: Record<Form9Location, string> = {
  home: "自宅",
  shelter: "避難所",
  other: "その他",
  transported: "搬送",
  unknown: "不明",
};

const WHERE_LOCATION: Record<WhereNow, Form9Location> = { home: "home", shelter: "shelter", other: "other" };

export type Form9Result = {
  /** 結果の言葉（無事・「無事じゃない」・安否確認・到着・受入・搬送・未確認） */
  label: string;
  /** 結果に添える言葉（自宅・避難所の名前・けが・動けない） */
  detail: string | null;
  /** 誰からの知らせか（本人・家族・ケアマネ・医療班） */
  by: string | null;
  /** 色: 緑の信号は無事、赤の信号は至急。ほかは色なし */
  tone: "ok" | "urgent" | null;
  /** 知らせの時刻（ISO）。無ければ null */
  at: string | null;
  location: Form9Location;
  /** 避難所の名前 */
  place: string | null;
};

export type Form9Contact = { order: number; who: string; name: string | null; phone: string | null };

export type Form9Row = {
  id: string;
  /** 手直しを当てたあとの順位（1 から） */
  rank: number;
  /** 自動の順位 */
  autoRank: number;
  manual: Form9Manual | null;
  name: string;
  kana: string;
  age: number | null;
  town: string | null;
  careLevel: string | null;
  careManager: string | null;
  tier: Tier;
  marks: string[];
  emergency: Form9Contact[];
  /** 発災時の色（平時は null） */
  color: Color | null;
  /** 優先の理由（平時は骨格と時計、発災時はルールの表の理由） */
  reason: string;
  /** 発災時の結果（平時は null） */
  result: Form9Result | null;
  /** 列ごとの文字（CSV と対応表の差し込みに使う） */
  cells: Record<Form9ColumnId, string>;
};

export type Form9Sheet = {
  mode: Form9Mode;
  rows: Form9Row[];
};

// ---------- 平時の並び（優先の骨格） ----------

export type NormalKey = {
  id: string;
  kana: string;
  tier: Tier;
  /** 時計の長さの短い物（時間）。走る時計が無ければ Infinity */
  clockHours: number;
  hasSupporter: boolean;
};

/** 平時の並びの鍵。上から順に比べる（docs/progress/t15.md） */
/**
 * 平時の並びの言葉（画面・紙）。「骨格」は分かりにくいので「組」（人工呼吸器 1 〜 それ以外 8。lib/labels.ts の TIER_LABELS）と呼ぶ（T79）。
 * 担当一覧の平時の列・CSV の「組」（T78、11/4 00:0x の確定）と同じ名前。ルールの表の文書（docs/TRIAGE.md）は「順番の骨格の段」のまま
 */
export const NORMAL_ORDER_LABELS = ["組 1〜8", "時計の短い順", "支援者なしが先", "カナ"] as const;
/** 発災時の並びの言葉（画面・紙） */
export const DISASTER_ORDER_LABELS = ["色", "時計の残り", "支援者なし", "組"] as const;

export function compareNormal(a: NormalKey, b: NormalKey): number {
  return (
    a.tier - b.tier ||
    (a.clockHours === b.clockHours ? 0 : a.clockHours < b.clockHours ? -1 : 1) ||
    Number(a.hasSupporter) - Number(b.hasSupporter) ||
    a.kana.localeCompare(b.kana, "ja") ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// ---------- 手直し ----------

/** 並びごとに、本人のいちばん新しい手直し。いちばん新しいのが「自動に戻す」なら入れない */
export function currentEdits(edits: ReadonlyArray<Form9RankEdit>, mode: Form9Mode): Map<string, Form9RankEdit> {
  const latest = new Map<string, Form9RankEdit>();
  for (const e of edits) {
    if (e.mode !== mode) continue;
    const prev = latest.get(e.person_id);
    if (!prev || e.set_at > prev.set_at || (e.set_at === prev.set_at && e.id > prev.id)) latest.set(e.person_id, e);
  }
  for (const [id, e] of latest) if (e.rank === null) latest.delete(id);
  return latest;
}

/**
 * 自動の並びに手の順位を差し込む。手で決めた人は決めた順位の位置に入り、ほかの人は自動の順のまま前後に詰める。
 * 同じ順位を 2 人に付けたときは、あとで直した人が先。並びの人数より大きい順位は一番下。
 */
export function applyManualRanks(
  autoIds: ReadonlyArray<string>,
  manual: ReadonlyMap<string, { rank: number; at: string }>,
): string[] {
  const inList = new Set(autoIds);
  const fixed = [...manual.entries()]
    .filter(([id]) => inList.has(id))
    .sort(([ia, a], [ib, b]) => a.rank - b.rank || (a.at === b.at ? (ia < ib ? -1 : 1) : a.at > b.at ? -1 : 1));
  const rest = autoIds.filter((id) => !manual.has(id));
  const out: string[] = [];
  let f = 0;
  let r = 0;
  while (out.length < autoIds.length) {
    const position = out.length + 1;
    if (f < fixed.length && (fixed[f][1].rank <= position || r >= rest.length)) out.push(fixed[f++][0]);
    else out.push(rest[r++]);
  }
  return out;
}

// ---------- 結果（発災時） ----------

const WHO: Record<SignalSource, string> = {
  self: "本人",
  agent: "本人",
  family: "家族",
  supporter: "支援者",
  care_manager: "ケアマネ",
};

export const WHERE_LABELS: Record<WhereNow, string> = { home: "自宅", shelter: "避難所", other: "その他" };

const NO_RESULT: Form9Result = {
  label: "未確認",
  detail: null,
  by: null,
  tone: null,
  at: null,
  location: "unknown",
  place: null,
};

type Report = { at: number; i: number } & ({ signal: Form9Signal } | { entry: Form9Entry });

/** 本人からの信号か（訓練の本人役を含む） */
const fromSelf = (s: Form9Signal) => s.source === "self" || s.source === "agent";

/**
 * 結果: いちばん新しい知らせ（信号か経過）。所在は古い順に追って、分かった所を残す。
 * 緑の信号は「無事」と居場所、赤の信号は「無事じゃない」（けが・動けない）、経過は種類の言葉（安否確認・到着・受入・搬送）。
 * 本人の報告を当てにしない印の人（selfUnreliable）は、本人の緑を「本人・参考」と出し、所在には使わない（ルールの表の案 4 と同じ）。
 */
export function safetyResult(reports: Form9Reports | undefined, opts: { selfUnreliable?: boolean } = {}): Form9Result {
  if (!reports) return NO_RESULT;
  const setAside = (s: Form9Signal) => opts.selfUnreliable === true && s.color === "green" && fromSelf(s);
  const all: Report[] = [
    ...reports.signals.map((signal, i) => ({ signal, at: Date.parse(signal.at), i })),
    ...reports.entries.map((entry, i) => ({ entry, at: Date.parse(entry.at), i: reports.signals.length + i })),
  ]
    .filter((x) => !Number.isNaN(x.at))
    .sort((a, b) => a.at - b.at || a.i - b.i);
  if (all.length === 0) return NO_RESULT;

  let location: Form9Location = "unknown";
  let place: string | null = null;
  for (const x of all) {
    if ("signal" in x) {
      if (x.signal.color === "green" && x.signal.whereNow && !setAside(x.signal)) {
        location = WHERE_LOCATION[x.signal.whereNow];
        if (location !== "shelter") place = null;
      }
    } else if (x.entry.kind === "arrived_shelter" || x.entry.kind === "received") {
      location = "shelter";
      place = x.entry.place ?? place;
    } else if (x.entry.kind === "transported") {
      location = "transported";
      place = null;
    }
  }

  const last = all[all.length - 1];
  if ("signal" in last) {
    const s = last.signal;
    const base = { by: WHO[s.source], at: s.at, location, place };
    if (s.color === "green") {
      const where = s.whereNow ? WHERE_LABELS[s.whereNow] : null;
      if (setAside(s)) return { ...base, by: `${WHO[s.source]}・参考`, label: "無事", detail: where, tone: null };
      return { ...base, label: "無事", detail: place && location === "shelter" ? place : where, tone: "ok" };
    }
    if (s.color === "red") {
      const words = [s.injured === true ? "けが" : null, s.canMove === false ? "動けない" : null].filter((w) => w !== null);
      return { ...base, label: "「無事じゃない」", detail: words.length > 0 ? words.join("・") : null, tone: "urgent" };
    }
    return { ...base, label: "応答不明", detail: null, tone: null };
  }
  const e = last.entry;
  return {
    label: TIMELINE_KIND_LABELS[e.kind],
    detail: e.place,
    by: AUTHOR_ROLE_LABELS[e.authorRole],
    tone: null,
    at: e.at,
    location,
    place,
  };
}

export function resultText(r: Form9Result): string {
  return [r.label, r.detail, r.by ? `（${r.by}）` : null].filter((x) => x).join(" ");
}

// ---------- 1 行の中身 ----------

/** 名前で介護・医療機関と分かる避難先（病院・医院・クリニック・診療所・施設・ホーム・老健・特養） */
const FACILITY_WORDS = /病院|医院|クリニック|診療所|施設|ホーム|老健|特養/;

/** 想定される避難場所を、ひな形の 2 つの小列（避難所・介護・医療機関）に分ける */
export function splitDestinations(ledger: Pick<Ledger, "evacuation">): { shelter: string[]; facility: string[] } {
  const all = [ledger.evacuation.destination1, ledger.evacuation.destination2].filter(
    (d): d is string => typeof d === "string" && d.trim() !== "",
  );
  return { shelter: all.filter((d) => !FACILITY_WORDS.test(d)), facility: all.filter((d) => FACILITY_WORDS.test(d)) };
}

/** 安否確認の方法（平時の計画）: 本人スマホ・本人電話・家族スマホ・支援者スマホ・連絡先電話。どれも無ければ訪問 */
export function meansOf(ledger: Pick<Ledger, "basic">, contacts: Form9PersonInput["contacts"]): string[] {
  const out: string[] = [];
  if (ledger.basic.contactMeans?.smartphone === "uses") out.push("本人スマホ");
  if (contacts.some((c) => c.kind === "self" && c.phone)) out.push("本人電話");
  const emergency = contacts.filter((c) => c.emergency_order != null);
  if (emergency.some((c) => c.kind === "family" && c.has_smartphone === 1)) out.push("家族スマホ");
  if (emergency.some((c) => c.kind !== "family" && c.has_smartphone === 1)) out.push("支援者スマホ");
  if (emergency.some((c) => c.phone)) out.push("連絡先電話");
  if (out.length === 0) out.push("訪問");
  return out;
}

/** 緊急連絡先 ①② */
export function emergencyOf(contacts: Form9PersonInput["contacts"]): Form9Contact[] {
  return contacts
    .filter((c) => c.emergency_order != null)
    .sort((a, b) => (a.emergency_order ?? 0) - (b.emergency_order ?? 0))
    .slice(0, 2)
    .map((c) => ({ order: c.emergency_order!, who: c.relation ?? CONTACT_KIND_LABELS[c.kind], name: c.name, phone: c.phone }));
}

export function contactText(c: Form9Contact | undefined): string {
  return c ? [c.who, c.name, c.phone].filter((x) => x).join(" ") : "";
}

function shortestClock(clocks: Form9PersonInput["clocks"]): { label: string; hours: number } | null {
  let best: { label: string; hours: number } | null = null;
  for (const k of clocks) {
    if (k.starts_on === "none") continue;
    const h = clockHours(k);
    if (h !== null && (!best || h < best.hours)) best = { label: k.label, hours: h };
  }
  return best;
}

/** 平時の優先の理由: いちばん短い時計・骨格の 6 と 7 の言葉・頼り先（表の入力の透析先・配達）の未確認・支援者なし */
function normalReason(
  tier: Tier,
  clock: { label: string; hours: number } | null,
  clocks: Form9PersonInput["clocks"],
  hasSupporter: boolean,
): string {
  const parts: string[] = [];
  if (clock) parts.push(`${clock.label} ${formatHours(clock.hours)}`);
  if (tier === 6 || tier === 7) parts.push(TIER_LABELS[tier]);
  const unchecked = clocks.filter((k) => k.depends_on && TABLE_DEPENDS.has(k.depends_on) && k.depends_check === "unconfirmed");
  for (const d of new Set(unchecked.map((k) => k.depends_on!))) {
    parts.push(`${DEPENDS_ON_LABELS[d]} 未確認`);
  }
  if (!hasSupporter && tier !== 7) parts.push("支援者なし");
  return parts.length > 0 ? parts.join("、") : "医療の時計なし";
}

function floorText(ledger: Ledger): string | null {
  const h = ledger.basic.housing;
  if (!h) return null;
  if (h.floors === 1) return "平屋";
  return h.floor != null ? `${h.floor}階` : null;
}

type Built = Omit<Form9Row, "rank" | "autoRank" | "manual" | "cells"> & {
  key: NormalKey;
  selfUnreliable: boolean;
  base: Omit<Record<Form9ColumnId, string>, "no" | "manual" | "color" | "reason" | "result" | "checkedAt">;
};

function buildOne(p: Form9PersonInput, today: string): Built {
  const ledger = parseLedger(p.person.ledger);
  const tp = toTriagePerson({ person: p.person, ledger, contacts: p.contacts, clocks: p.clocks });
  const tier = tierOf(tp);
  const marks = marksOf(p.clocks);
  const clock = shortestClock(p.clocks);
  const age = p.person.birth_date ? ageOn(p.person.birth_date, today) : null;
  const careLevel = ledger.care.careLevel ? CARE_LEVEL_LABELS[ledger.care.careLevel] : null;
  const town = ledger.basic.address?.town ?? null;
  const supporters = p.contacts.filter((c) => c.supporter_order != null).length;
  const { shelter, facility } = splitDestinations(ledger);
  const emergency = emergencyOf(p.contacts);
  const household = ledger.basic.household ? householdText(ledger.basic.household, ledger.basic.householdNote) : null;
  const walking = ledger.care.walking ? `歩行 ${ABILITY_LABELS[ledger.care.walking]}` : null;
  const join = (xs: ReadonlyArray<string | null | undefined>, sep = "・") => xs.filter((x) => x).join(sep);

  return {
    id: p.person.id,
    name: p.person.name,
    kana: p.person.kana,
    age,
    town,
    careLevel,
    careManager: p.careManager,
    tier,
    marks,
    emergency,
    color: null,
    reason: normalReason(tier, clock, p.clocks, tp.hasSupporter),
    result: null,
    key: { id: p.person.id, kana: p.person.kana, tier, clockHours: clock?.hours ?? Infinity, hasSupporter: tp.hasSupporter },
    selfUnreliable: p.person.self_report_unreliable === 1,
    base: {
      medicalCare: `${tier} ${TIER_LABELS[tier]}${marks.length > 0 ? `（${marks.join("・")}）` : ""}`,
      environment: join([household, floorText(ledger), ...(hazardsOf(ledger).length > 0 ? hazardsOf(ledger) : ["ハザードなし"])]),
      evacuation: join([
        supporters > 0 ? `支援者 ${supporters} 人` : "支援者なし",
        ledger.care.bedridden ? "寝たきり" : walking,
        ledger.evacuation.transport ? `手段 ${ledger.evacuation.transport}` : null,
      ]),
      area: join([town, careLevel], "／"),
      nameAge: age === null ? p.person.name : `${p.person.name}（${age}）`,
      address: join([ledger.basic.address?.city, town], ""),
      shelter: shelter.join("・"),
      facility: facility.join("・"),
      notes: join([...ledger.notes, p.person.self_report_unreliable === 1 ? "本人の申告は参考" : null]),
      careManager: p.careManager ?? "",
      emergency1: contactText(emergency[0]),
      emergency2: contactText(emergency[1]),
      means: meansOf(ledger, p.contacts).join("・"),
    },
  };
}

export function manualText(m: Form9Manual | null): string {
  if (!m) return "";
  const who = [m.by, formatJst(m.at)].filter((x) => x).join(" ");
  return `手直し 自動${m.autoRank}→${m.rank} ${m.reason}（${who}）`;
}

export type Form9Options = {
  /** 年齢を数える日（JST の YYYY-MM-DD） */
  today: string;
  /** 発災時のルールの表の結果。渡すと発災時の並び（色と順位）、渡さなければ平時の並び（優先の骨格） */
  triage?: ReadonlyArray<TriageResult> | null;
  /** 手直し（全部の並びの分。今の並びの物だけ使う） */
  edits?: ReadonlyArray<Form9RankEdit>;
  /** 発災のあとの信号と経過（本人の id ごと）。発災時の結果の列に入る */
  reports?: ReadonlyMap<string, Form9Reports>;
};

/** 様式 9 の表。並びは優先順位（手直しを当てたあと） */
export function buildForm9(people: ReadonlyArray<Form9PersonInput>, opts: Form9Options): Form9Sheet {
  const triage = opts.triage ?? null;
  const mode: Form9Mode = triage ? "disaster" : "normal";
  const built = people.map((p) => buildOne(p, opts.today));
  const byId = new Map(built.map((b) => [b.id, b]));
  const triageById = new Map((triage ?? []).map((t) => [t.personId, t]));

  const normalIds = [...built].sort((a, b) => compareNormal(a.key, b.key)).map((b) => b.id);
  let autoIds = normalIds;
  if (triage) {
    const ranked = [...triage].filter((t) => byId.has(t.personId)).sort(compareResults).map((t) => t.personId);
    // 結果が無い人（無いはず）は平時の順で一番下に
    autoIds = [...ranked, ...normalIds.filter((id) => !triageById.has(id))];
  }

  const edits = currentEdits(opts.edits ?? [], mode);
  const manual = new Map([...edits].map(([id, e]) => [id, { rank: e.rank!, at: e.set_at }]));
  const finalIds = applyManualRanks(autoIds, manual);
  const autoRank = new Map(autoIds.map((id, i) => [id, i + 1]));

  const rows = finalIds.map((id, i): Form9Row => {
    const b = byId.get(id)!;
    const t = triageById.get(id) ?? null;
    const e = edits.get(id);
    const m: Form9Manual | null = e
      ? { rank: e.rank!, autoRank: autoRank.get(id)!, reason: e.reason, by: e.set_by_name, at: e.set_at }
      : null;
    const result = triage ? safetyResult(opts.reports?.get(id), { selfUnreliable: b.selfUnreliable }) : null;
    const color = t ? t.color : null;
    const reason = t ? t.reason : b.reason;
    const { key: _key, selfUnreliable: _self, base, ...rest } = b;
    return {
      ...rest,
      rank: i + 1,
      autoRank: autoRank.get(id)!,
      manual: m,
      color,
      reason,
      result,
      cells: {
        no: String(i + 1),
        ...base,
        checkedAt: result?.at ? formatJst(result.at) : "",
        color: color ? COLOR_LABELS[color] : "",
        reason,
        result: result ? resultText(result) : "",
        manual: manualText(m),
      },
    };
  });
  return { mode, rows };
}

// ---------- 数える ----------

/** 色ごとの人数。平時（色なし）は未知に数える */
export function colorCounts(rows: ReadonlyArray<Pick<Form9Row, "color">>): Record<Color, number> {
  const out: Record<Color, number> = { red: 0, yellow: 0, gray: 0, green: 0 };
  for (const r of rows) out[r.color ?? "gray"] += 1;
  return out;
}

// ---------- 手直しの受け口（画面のフォーム） ----------

export const MAX_REASON_LENGTH = 200;

export type RankFormValue = { personId: string; rank: number | null; reason: string };
export type RankFormError = "person" | "rank" | "reason";

export const RANK_FORM_ERROR_LABELS: Record<RankFormError, string> = {
  person: "該当なし",
  rank: "順位範囲外",
  reason: "理由未入力",
};

const PERSON_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 手直しのフォームを読む。順位は 1〜人数の整数、理由は空でなく 200 字まで。
 * 「自動に戻す」（clear）は順位を読まず、理由は空でもよい。
 */
export function parseRankForm(
  form: { person?: unknown; rank?: unknown; reason?: unknown; clear?: unknown },
  size: number,
): { ok: true; value: RankFormValue } | { ok: false; error: RankFormError; personId: string | null } {
  const personId = typeof form.person === "string" && PERSON_ID.test(form.person) ? form.person : null;
  if (!personId) return { ok: false, error: "person", personId: null };
  const reason = typeof form.reason === "string" ? form.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) return { ok: false, error: "reason", personId };
  if (form.clear != null && form.clear !== "") return { ok: true, value: { personId, rank: null, reason } };
  const raw = typeof form.rank === "string" ? form.rank.trim() : "";
  const rank = /^[0-9]{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(rank) || rank < 1 || rank > size) return { ok: false, error: "rank", personId };
  if (!reason) return { ok: false, error: "reason", personId };
  return { ok: true, value: { personId, rank, reason } };
}
