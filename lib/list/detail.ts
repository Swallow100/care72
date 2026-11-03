// 担当一覧の発災時の行の詳細（docs/tasks/T13.md）。行を押すと行の下に開く中身を、D1 の行から作る（D1 を使わない所）。
// 色・理由・並びはルールの表の結果（TriageResult）をそのまま出し、ここで計算し直さない。ここで作るのは事実の並べ方だけ:
// 連絡先（電話のボタン）、時計の残り（lib/triage の clockRemaining）、避難先、支援者、最後の連絡、信号の答え、
// 録音と文字起こしと分類、電話の記録、ケアマネの上書き。

import type {
  Classifier,
  ClockRow,
  ContactKind,
  ContactRow,
  Ledger,
  RecordingClass,
  SignalColor,
  SignalRow,
  SignalSource,
} from "../db/types.ts";
import { elapsedText, shortJst } from "../disaster/state.ts";
import {
  CHECK_STATUS_LABELS,
  CLOCK_KIND_LABELS,
  CLOCK_SOURCE_LABELS,
  CLOCK_START_LABELS,
  CLOCK_UNIT_LABELS,
  COLOR_LABELS,
  CONTACT_FLAG_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  DEPENDS_ON_LABELS,
} from "../labels.ts";
import { clockTone, COLOR_TONES, formatJst, telHref, type StateTone } from "../person.ts";
import { signalLogBody } from "../signals/labels.ts";
import { clockRemaining, formatHours, type Color, type Override, type Situation, type TriageResult } from "../triage/index.ts";
import { callLogsOf, type CallEntryRow, type CallLog } from "./calls.ts";
import { DETAIL_LABELS } from "./labels.ts";
import { recordingHref } from "./recording.ts";

export type ContactForDetail = Omit<ContactRow, "created_at">;
export type ClockForDetail = Omit<ClockRow, "sort"> & { sort?: number };
export type SignalForDetail = Pick<
  SignalRow,
  | "id"
  | "person_id"
  | "color"
  | "source"
  | "where_now"
  | "injured"
  | "at_home"
  | "can_move"
  | "has_medicine"
  | "recording_key"
  | "transcript"
  | "classes"
  | "classified_by"
  | "ai_classes"
  | "ai_confidence"
  | "ai_quote"
  | "ai_model"
  | "ai_error"
  | "ai_at"
  | "answers"
  | "ai_memo"
  | "memo"
  | "occurred_at"
>;

/** 信号の出どころの言い方。訓練の本人役（agent）は本人（ルールの表と同じ） */
export const SOURCE_LABELS: Record<SignalSource, string> = {
  self: "本人",
  agent: "本人",
  family: "家族",
  supporter: "支援者",
  care_manager: "ケアマネ",
};

const SIGNAL_TONES: Record<SignalColor, StateTone> = { red: "urgent", green: "ok", unknown: "unknown" };

/** 電話のボタンの並び（本人 → 家族 → 支援者 → 民生委員 → 訪問看護 → 機関） */
const CONTACT_ORDER: ReadonlyArray<ContactKind> = [
  "self",
  "family",
  "supporter",
  "welfare_commissioner",
  "visiting_nurse",
  "care_service",
  "dialysis_center",
  "home_doctor",
  "pharmacy",
  "city_office",
];

export type DetailContact = {
  id: string;
  kind: ContactKind;
  kindLabel: string;
  /** 名前（無ければ間柄か種類） */
  name: string;
  relation: string | null;
  phone: string;
  tel: string;
  emergencyOrder: number | null;
  supporterOrder: number | null;
  /** 距離（同居・近所・市内…。contacts.reach）。無ければ null */
  reach: string | null;
  /** この相手への最後の電話の記録（発信・不通・通話と時刻、通話で聞いた安否） */
  lastCall: { when: string; result: CallLog["result"]; heard: CallLog["heard"] } | null;
};

export type DetailClock = {
  id: string;
  label: string;
  kindLabel: string;
  /** 「2 時間」。値が無ければ null（未確認） */
  length: string | null;
  start: string;
  running: boolean;
  /** 「残り 30 分」「超過 1 時間」「停電で開始」。走らない時計は null */
  remaining: string | null;
  over: boolean;
  /** 残りの色（走っている時計だけ。lib/person の clockTone の境目） */
  tone: StateTone | null;
  source: string | null;
  sourceNote: string | null;
  confirmed: string | null;
  depends: { on: string; check: string; unchecked: boolean } | null;
};

export type DetailSignal = {
  id: string;
  at: string;
  when: string;
  source: string;
  color: SignalColor;
  tone: StateTone;
  /** 「無事じゃない けが あり・自宅・動けない・未回答 1」「無事 自宅」 */
  body: string;
  /** 録音の再生の行き先。録音が無ければ null */
  recording: string | null;
  transcript: string | null;
  classes: RecordingClass[];
  classifiedBy: Classifier | null;
  /**
   * 信号の行そのもの（サーバーの中だけで使う）。分類の部品（T12 の components/list/Classification.tsx）は
   * lib/classify/view.ts の classViewOf にこの行（ai_* の列を含む）を渡して形を作る
   */
  row: SignalForDetail;
};

export type DetailOverride = {
  to: Color;
  toLabel: string;
  base: Color;
  baseLabel: string;
  reason: string;
  byName: string | null;
  when: string;
  /** 上書きしたあとに表の色が悪くなって切れた */
  expired: boolean;
};

export type RowDetail = {
  personId: string;
  color: Color;
  tone: StateTone;
  /** 理由の 1 行（表の理由のまま。分類から来た言葉には「（AI）」が入っている） */
  reason: string;
  /** 表の色（上書きの前） */
  baseColor: Color;
  contacts: DetailContact[];
  clocks: DetailClock[];
  destinations: { first: string | null; second: string | null; transport: string | null };
  /** 避難支援等実施者（順番つき）の 1 行ずつ */
  supporters: Array<{ order: number; name: string; parts: string[] }>;
  lastContact: LastContact | null;
  /** 発災から今までの信号（新しい順） */
  signals: DetailSignal[];
  /** 電話の記録（新しい順、5 つまで） */
  calls: CallLog[];
  override: DetailOverride | null;
};

/** 最後の連絡（いちばん新しい信号）。一覧の列にも出す */
export type LastContact = { at: string; when: string; ago: string | null; source: string; color: SignalColor; tone: StateTone };

/** 一覧の列「残り」: 走っている時計で残りのいちばん短い物 */
export type Remain = { label: string; text: string; hours: number; over: boolean; tone: StateTone | null };

type ClockLike = Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check">;

function remainingText(r: { remaining: number; over: boolean }): string {
  return r.over ? `${DETAIL_LABELS.over} ${formatHours(-r.remaining)}` : `${DETAIL_LABELS.left} ${formatHours(r.remaining)}`;
}

/** 走っている時計で残りのいちばん短い物。無ければ null */
export function remainOf(clocks: ReadonlyArray<ClockLike>, s: Situation): Remain | null {
  let best: Remain | null = null;
  for (const k of clocks) {
    const r = clockRemaining(k, s);
    if (!r || !r.running) continue;
    if (best && best.hours <= r.remaining) continue;
    best = { label: k.label, text: remainingText(r), hours: r.remaining, over: r.over, tone: clockTone(r.remaining) };
  }
  return best;
}

/** 最後の連絡（時刻のいちばん新しい信号）。now より後の信号は使わない */
export function lastContactOf(
  signals: ReadonlyArray<{ color: SignalColor; source: SignalSource; at: string }>,
  now: string,
): LastContact | null {
  const t = Date.parse(now);
  const latest = signals
    .filter((x) => Date.parse(x.at) <= t)
    .reduce<(typeof signals)[number] | null>((a, b) => (a === null || Date.parse(b.at) >= Date.parse(a.at) ? b : a), null);
  if (!latest) return null;
  return {
    at: latest.at,
    when: shortJst(latest.at),
    ago: elapsedText(latest.at, now),
    source: SOURCE_LABELS[latest.source],
    color: latest.color,
    tone: SIGNAL_TONES[latest.color],
  };
}

const bool = (v: 0 | 1 | null): boolean | null => (v === null ? null : v === 1);

function parseClasses(text: string | null): RecordingClass[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as RecordingClass[]) : [];
  } catch {
    return [];
  }
}

function signalBody(s: SignalForDetail): string {
  if (s.color === "unknown") return COLOR_LABELS.gray;
  return signalLogBody({
    color: s.color,
    whereNow: s.where_now,
    answers: {
      injured: bool(s.injured),
      atHome: bool(s.at_home),
      canMove: bool(s.can_move),
      hasMedicine: bool(s.has_medicine),
    },
  });
}

function detailSignal(s: SignalForDetail): DetailSignal {
  return {
    id: s.id,
    at: s.occurred_at,
    when: shortJst(s.occurred_at),
    source: SOURCE_LABELS[s.source],
    color: s.color,
    tone: SIGNAL_TONES[s.color],
    body: signalBody(s),
    recording: s.recording_key ? recordingHref(s.id) : null,
    transcript: s.transcript?.trim() || null,
    classes: parseClasses(s.classes),
    classifiedBy: s.classified_by,
    row: s,
  };
}

function contactName(c: ContactForDetail): string {
  return c.name?.trim() || c.relation?.trim() || CONTACT_KIND_LABELS[c.kind];
}

function detailContacts(contacts: ReadonlyArray<ContactForDetail>, calls: ReadonlyArray<CallLog>): DetailContact[] {
  const rank = (k: ContactKind) => CONTACT_ORDER.indexOf(k);
  return contacts
    .filter((c) => c.phone?.trim())
    .sort(
      (a, b) =>
        rank(a.kind) - rank(b.kind) ||
        (a.emergency_order ?? 99) - (b.emergency_order ?? 99) ||
        (a.supporter_order ?? 99) - (b.supporter_order ?? 99) ||
        a.sort - b.sort ||
        (a.id < b.id ? -1 : 1),
    )
    .map((c) => {
      const last = calls.find((x) => x.contactId === c.id) ?? null;
      return {
        id: c.id,
        kind: c.kind,
        kindLabel: CONTACT_KIND_LABELS[c.kind],
        // 名前が種類と同じ（本人の行）なら名前は出さない（「本人 本人」にしない）
        name: contactName(c) === CONTACT_KIND_LABELS[c.kind] ? "" : contactName(c),
        relation: c.name && c.relation ? c.relation : null,
        phone: c.phone!,
        tel: telHref(c.phone!),
        emergencyOrder: c.emergency_order,
        supporterOrder: c.supporter_order,
        reach: c.reach ? CONTACT_REACH_LABELS[c.reach] : null,
        lastCall: last ? { when: shortJst(last.at), result: last.result, heard: last.heard } : null,
      };
    });
}

function detailSupporters(contacts: ReadonlyArray<ContactForDetail>): RowDetail["supporters"] {
  return contacts
    .filter((c) => c.supporter_order != null)
    .sort((a, b) => (a.supporter_order ?? 0) - (b.supporter_order ?? 0))
    .map((c) => {
      const parts: string[] = [];
      if (c.name && c.relation) parts.push(c.relation);
      if (c.kind !== "family" && c.kind !== "supporter") parts.push(CONTACT_KIND_LABELS[c.kind]);
      if (c.reach) parts.push(CONTACT_REACH_LABELS[c.reach]);
      if (c.has_car === 1) parts.push(CONTACT_FLAG_LABELS.hasCar);
      parts.push(
        c.night_ok === 1
          ? CONTACT_FLAG_LABELS.nightOk
          : c.night_ok === 0
            ? CONTACT_FLAG_LABELS.nightNo
            : CONTACT_FLAG_LABELS.nightUnknown,
      );
      return { order: c.supporter_order ?? 0, name: contactName(c), parts };
    });
}

function detailClock(k: ClockForDetail, s: Situation): DetailClock {
  const r = clockRemaining(k, s);
  const runs = k.starts_on !== "none";
  return {
    id: k.id,
    label: k.label,
    kindLabel: CLOCK_KIND_LABELS[k.kind],
    length: k.value != null && k.unit != null ? `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : null,
    start: CLOCK_START_LABELS[k.starts_on],
    running: r?.running ?? false,
    remaining: !runs || !r ? null : r.running ? remainingText(r) : `${CLOCK_START_LABELS[k.starts_on]}${DETAIL_LABELS.startsOn}`,
    over: r?.over ?? false,
    tone: r?.running ? clockTone(r.remaining) : null,
    source: k.source ? CLOCK_SOURCE_LABELS[k.source] : null,
    sourceNote: k.source_note,
    confirmed: k.confirmed_at ? formatJst(k.confirmed_at).slice(0, 10) : null,
    depends:
      k.depends_on && k.depends_check
        ? {
            on: DEPENDS_ON_LABELS[k.depends_on],
            check: CHECK_STATUS_LABELS[k.depends_check],
            unchecked: k.depends_check === "unconfirmed",
          }
        : null,
  };
}

function detailOverride(o: (Override & { expired: boolean; byName?: string | null }) | undefined): DetailOverride | null {
  if (!o) return null;
  return {
    to: o.to,
    toLabel: COLOR_LABELS[o.to],
    base: o.baseAtOverride,
    baseLabel: COLOR_LABELS[o.baseAtOverride],
    reason: o.reason,
    byName: o.byName ?? null,
    when: shortJst(o.at),
    expired: o.expired,
  };
}

export type DetailInput = {
  personId: string;
  ledger: Pick<Ledger, "evacuation">;
  contacts: ReadonlyArray<ContactForDetail>;
  clocks: ReadonlyArray<ClockForDetail>;
  /** 発災から今までの信号（訓練でない物） */
  signals: ReadonlyArray<SignalForDetail>;
  /** 発災から今までの電話の記録（経過の called の行、時刻の順） */
  calls: ReadonlyArray<CallEntryRow>;
  /** ルールの表の結果（上書きを当てたあと）。上書きは書き手の名前（byName、lib/disaster/override.ts）が付いていれば出す */
  triage: TriageResult;
  /** 本人の状況（停電の地区を当てたあと） */
  situation: Situation;
};

/** 行の詳細を作る */
export function buildRowDetail(x: DetailInput): RowDetail {
  const ordered = [...x.signals].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const calls = callLogsOf(x.calls);
  const clocks = [...x.clocks].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.id < b.id ? -1 : 1));
  const e = x.ledger.evacuation;
  return {
    personId: x.personId,
    color: x.triage.color,
    tone: COLOR_TONES[x.triage.color],
    reason: x.triage.reason,
    baseColor: x.triage.baseColor,
    contacts: detailContacts(x.contacts, calls),
    // 本人の状態（D）の時計は走らないので出さない（医療の印に出る）
    clocks: clocks.filter((k) => k.kind !== "condition").map((k) => detailClock(k, x.situation)),
    destinations: {
      first: e.destination1?.trim() || null,
      second: e.destination2?.trim() || null,
      transport: e.transport?.trim() || null,
    },
    supporters: detailSupporters(x.contacts),
    lastContact: lastContactOf(
      ordered.map((s) => ({ color: s.color, source: s.source, at: s.occurred_at })),
      x.situation.now,
    ),
    signals: ordered
      .filter((s) => Date.parse(s.occurred_at) <= Date.parse(x.situation.now))
      .map(detailSignal)
      .reverse(),
    calls: calls.slice(0, 5),
    override: detailOverride(x.triage.override),
  };
}

