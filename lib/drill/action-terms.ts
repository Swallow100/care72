// 時間と状況で変わる手（docs/tasks/T110.md の 2）。手の可否と所要の決まりの表は、このファイルの TERM_RULES の 1 か所。
// 夜（暗い・電話に出にくい）・停電（携帯の電池）・浸水や通行止め・電話の混み具合・職員の数・訪問看護・施設の休止・
// 訓練する人の被災（T104 の自分の出来事: 出勤遅れ・携帯電池・自宅停電）で、手が押せない・所要が伸びる。
//
// 線:
// - 元にする事実は、ケアマネに分かっている事実だけ（T105 の lib/drill/timeline.ts の公表の線、T94 の lib/drill/score.ts の knownOf とそろえる）。
//   本人に起きたこと（栄養剤の持ち出し忘れ・介護事業所の休止など、非公表）では押せなくしない（知り得ない事で手が消えるため）
// - 押せなくするのは、世界の返事（lib/drill/world-reply.ts）が確率の前に事実で外れと決める道と同じ物だけ（通話不可・通行止・職員なし・
//   看護不在・施設の休止）。押せたら外れると決まっている手を、画面で先に止める。所要の足し分は返事を変えない
// - 色と連絡順（lib/triage）には触れない。ここは手の可否と所要だけ
// - 当てるのは開始で決まりを選んだ訓練（DrillOptions.terms、連続の時計の大雨・地震・仮想）だけ。10 分版と前からある訓練は表の分のまま
//
// D1・Claude を読まない純な計算（画面に出す物はサーバーが作って渡す）。scenarios.ts は型だけ読む。

import type { ContactKind, DependsOn, DrillAction } from "../db/types.ts";
import { actionRow, ACTION_CATALOG } from "./action-catalog.ts";
import type { PersonMarks, PhoneState, WorldState } from "./scenarios.ts";

// ---------- 手のやり方 ----------

/**
 * 手のやり方（決まりの当たり先）。
 * phone 電話で済む・visit ケアマネが家へ出向く・home 電話で頼み、誰かが家へ向かう（家の前の道で外れが決まる手）・desk 机の上・move 自分の避難
 */
export const ACTION_WAYS_LIST = ["phone", "visit", "home", "desk", "move"] as const;
export type ActionWay = (typeof ACTION_WAYS_LIST)[number];

/** 自由対応のそのままの手で AI が選べるやり方（home・move は表の手の物） */
export const FREE_WAYS = ["phone", "visit", "desk"] as const;
export type FreeWay = (typeof FREE_WAYS)[number];

export const isFreeWay = (v: unknown): v is FreeWay => typeof v === "string" && (FREE_WAYS as readonly string[]).includes(v);

/** そのままの手のやり方の言葉（2 字。画面・紙・講評） */
export const FREE_WAY_LABELS: Readonly<Record<FreeWay, string>> = { phone: "電話", visit: "訪問", desk: "机上" };

/**
 * 手ごとのやり方。home は世界の返事が家の前の道の通行止で外れと決める手（訪問依頼・薬手配・移送手配・電源手配・業者連絡）。
 * 見守依頼（家族・支援者が歩いて行ける）と病院受入（受入型）は今の返事で道を見ないので phone
 */
export const ACTION_WAYS: Readonly<Record<DrillAction, ActionWay>> = {
  call_person: "phone",
  call_contact: "phone",
  advise_119: "phone",
  ask_check: "phone",
  visit: "visit",
  dispatch: "home",
  request_backup: "phone",
  arrange_medicine: "home",
  arrange_dialysis: "phone",
  request_welfare_shelter: "phone",
  request_hospital: "phone",
  arrange_transport: "home",
  arrange_power: "home",
  call_vendor: "home",
  report_city: "phone",
  note: "desk",
  evacuate_self: "move",
  // 自由対応は AI が読み替えたやり方（FREE_WAYS）で引き直す
  free: "desk",
};

// ---------- 言葉 ----------

/** 押せない理由・所要が伸びた理由の言葉（2〜4 字）。通話不可は lib/drill/event-catalog.ts の NO_CALL と同じ字 */
export const TERM_LABELS = {
  noCall: "通話不可",
  road: "通行止",
  noStaff: "職員なし",
  nurse: "看護不在",
  closed: "休止",
  dark: "夜間",
  flood: "浸水",
  busy: "混雑",
  battery: "電池",
  late: "出勤遅",
} as const;
export type TermLabel = (typeof TERM_LABELS)[keyof typeof TERM_LABELS];

// ---------- 事実 ----------

/** 夜（暗い）とする訓練の中の時刻（時）。19 時から翌 5 時台まで */
export const DARK_FROM = 19;
export const DARK_UNTIL = 6;
/** 夜の本人・家族・支援者への電話の出る割合（昼の割合に掛ける。出にくい分は「応答なし」） */
export const DARK_PICKUP = 0.6;
/** 携帯の電池が少ないとする、事業所を含む停電の長さ（時間。T104 の自分の出来事「携帯電池」と同じ） */
export const BATTERY_HOURS = 6;
/** 出勤遅れが効く間（発災からの分。T104 の自分の出来事「出勤遅れ」は夜の発災の 6 時間まで） */
export const LATE_UNTIL_MINUTE = 6 * 60;
/** 夜の発災の時刻（時。lib/drill/night.ts の NIGHT_START_HOUR と同じ） */
const NIGHT_START = 2;
/** 日本の時刻（UTC + 9 時間） */
const JST_OFFSET_HOURS = 9;

/** 手の可否と所要の元の事実（ケアマネに分かっている事実だけ。上の線） */
export type TermFacts = {
  /** 訓練の中の時刻が夜（19〜5 時台） */
  dark: boolean;
  /** 世界の電話 */
  phone: PhoneState;
  /** 本人の家の電話 通話不可（家の電話の印） */
  lineDown: boolean;
  /** 本人の家の前の道 通行止 */
  roadClosed: boolean;
  /** 浸水・警戒レベル 4 以上・津波の避難・本人の家の辺りの浸水 */
  flood: boolean;
  /** 職員の空き */
  staff: number;
  /** 訪問看護が来られない（本人の印） */
  nurseAway: boolean;
  /** 本人の頼り先で休止している施設の区分 */
  closed: ReadonlyArray<DependsOn>;
  /** 携帯の電池が少ない（事業所を含む停電が 6 時間以上か、自分の出来事の携帯電池か、出勤前の自宅停電） */
  battery: boolean;
  /** 自分の出勤遅れ（夜の発災の 6 時間まで） */
  late: boolean;
};

/** 訓練の中の時刻（時、0〜23）。夜間発災（T59）は深夜 2 時の発災、ほかは開始の時刻（drills.started_at）から日本の時刻で */
export function dayHourOf(startedAt: string, minute: number, night: boolean): number {
  const m = Math.max(0, Math.floor(minute));
  if (night) return (NIGHT_START + Math.floor(m / 60)) % 24;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return 12;
  const d = new Date(t + m * 60_000);
  return (d.getUTCHours() + JST_OFFSET_HOURS) % 24;
}

export const isDark = (hour: number): boolean => hour >= DARK_FROM || hour < DARK_UNTIL;

/** 手の可否と所要を読む元（訓練の状態の要る所だけ） */
export type TermSource = {
  startedAt: string;
  minute: number;
  world: Pick<
    WorldState,
    "phone" | "marks" | "roads" | "flood" | "alertLevel" | "tsunami" | "staff" | "facilities" | "outage" | "notes"
  >;
  options?: { night?: boolean; terms?: boolean } | undefined;
};

/** 本人（null は全体の手）について、今の事実を読む */
export function termFactsOf(s: TermSource, person: string | null, minute: number = s.minute): TermFacts {
  const w = s.world;
  const marks: PersonMarks = person ? (w.marks[person] ?? {}) : {};
  const o = w.outage;
  const outageHours = o && o.restoredAt === null && o.area.scope === "office" ? minute / 60 - o.since : -1;
  const late = w.notes?.self_late !== undefined && minute < LATE_UNTIL_MINUTE;
  const powerOut = !!o && o.restoredAt === null;
  return {
    dark: isDark(dayHourOf(s.startedAt, minute, s.options?.night === true)),
    phone: w.phone,
    lineDown: marks.lineDown !== undefined,
    roadClosed: person ? w.roads.some((r) => r.person === person && !r.open) : false,
    flood: w.flood || (w.alertLevel ?? 0) >= 4 || w.tsunami === "evacuate" || marks.flooded !== undefined,
    staff: w.staff,
    nurseAway: marks.nurseAway !== undefined,
    closed: person ? w.facilities.filter((f) => f.person === person && !f.open && f.depends !== null).map((f) => f.depends!) : [],
    battery:
      outageHours >= BATTERY_HOURS ||
      (powerOut && w.notes?.self_battery !== undefined) ||
      (late && w.notes?.self_outage !== undefined),
    late,
  };
}

// ---------- 決まりの表 ----------

/** 相手の区分。fixed は固定の相手（事業所の職員・市役所・福祉避難所・ほかの事業所）を選んだとき */
export type TermCallee = ContactKind | "fixed";

/**
 * 決まり 1 行。when が真なら、ways のやり方の手（actions があればその手だけ、callees があればその相手のときだけ）に当てる。
 * block は押せない、add は所要に足す分（分）、pickup は本人・家族・支援者が電話に出る割合に掛ける数（返事の所 actions.ts が読む）
 */
export type TermRule = {
  id: string;
  label: TermLabel;
  when: (f: TermFacts) => boolean;
  ways: ReadonlyArray<ActionWay>;
  actions?: ReadonlyArray<DrillAction>;
  callees?: ReadonlyArray<TermCallee>;
  block?: true;
  add?: number;
  pickup?: number;
};

/**
 * 手の可否と所要の決まり（1 か所）。押せない物は世界の返事（world-reply.ts）が事実で外れと決める道と同じ順。
 * 所要の足し分は重ねる（夜の浸水の訪問は 40 + 20 + 20 = 80 分）
 */
export const TERM_RULES: ReadonlyArray<TermRule> = [
  // ---- 押せない（返事が事実で外れと決まる手） ----
  { id: "phone_down", label: TERM_LABELS.noCall, when: (f) => f.phone === "down", ways: ["phone", "home"], block: true },
  // 本人の家にかける電話（本人電話・119勧奨の相手が本人）は家の電話の印でも外れ
  { id: "line_down", label: TERM_LABELS.noCall, when: (f) => f.lineDown, ways: ["phone"], actions: ["call_person", "advise_119"], callees: ["self"], block: true },
  { id: "road_closed", label: TERM_LABELS.road, when: (f) => f.roadClosed, ways: ["visit", "home"], block: true },
  // 訪問依頼: 事業所の職員（相手なし）と介護事業所は職員の空きが要る（world-reply.ts の dispatch と同じ）。訪問看護は来られない印
  { id: "no_staff", label: TERM_LABELS.noStaff, when: (f) => f.staff <= 0, ways: ["home"], actions: ["dispatch"], callees: ["fixed", "care_service"], block: true },
  { id: "nurse_away", label: TERM_LABELS.nurse, when: (f) => f.nurseAway, ways: ["home"], actions: ["dispatch"], callees: ["visiting_nurse"], block: true },
  // 休止している透析施設への電話と透析調整
  {
    id: "dialysis_closed",
    label: TERM_LABELS.closed,
    when: (f) => f.closed.includes("dialysis_center"),
    ways: ["phone"],
    actions: ["call_contact", "arrange_dialysis"],
    callees: ["dialysis_center"],
    block: true,
  },
  // ---- 所要が伸びる ----
  { id: "dark_visit", label: TERM_LABELS.dark, when: (f) => f.dark, ways: ["visit"], add: 20 },
  { id: "flood_visit", label: TERM_LABELS.flood, when: (f) => f.flood, ways: ["visit"], add: 20 },
  { id: "late_visit", label: TERM_LABELS.late, when: (f) => f.late, ways: ["visit"], add: 20 },
  { id: "phone_busy", label: TERM_LABELS.busy, when: (f) => f.phone === "busy", ways: ["phone", "home"], add: 5 },
  { id: "battery", label: TERM_LABELS.battery, when: (f) => f.battery, ways: ["phone", "home"], add: 10 },
  // ---- 電話に出にくい（所要は同じ。出る割合だけ） ----
  {
    id: "dark_pickup",
    label: TERM_LABELS.dark,
    when: (f) => f.dark,
    ways: ["phone"],
    actions: ["call_person", "call_contact", "advise_119", "ask_check"],
    pickup: DARK_PICKUP,
  },
];

// ---------- 手 1 つの可否と所要 ----------

/** 手 1 つの可否と所要。block は手全体が押せない理由、targets は相手ごとの押せない理由（相手で決まる物） */
export type ActionTerm = {
  /** 所要（分）。決まりの足し分を足したあと */
  minutes: number;
  /** 押せない理由（2〜4 字）。押せれば null */
  block: string | null;
  /** 相手ごとの押せない理由 */
  targets: Partial<Record<TermCallee, string>>;
  /** 所要を伸ばした理由（言葉の並び。表の順） */
  adds: string[];
  /** 本人・家族・支援者が電話に出る割合に掛ける数（1 は昼のまま） */
  pickup: number;
};

const applies = (r: TermRule, kind: DrillAction, way: ActionWay) => r.ways.includes(way) && (!r.actions || r.actions.includes(kind));

/**
 * 手 1 つの可否と所要。way は自由対応のそのままの手のやり方（無ければ表のやり方）、minutes は元の所要（無ければ表の分）。
 * on が false（決まりを選ばなかった訓練）なら表の分のまま、押せない物も無し
 */
export function actionTerm(
  kind: DrillAction,
  facts: TermFacts,
  opts: { on: boolean; way?: ActionWay; minutes?: number } = { on: true },
): ActionTerm {
  const base = opts.minutes ?? actionRow(kind).minutes;
  const term: ActionTerm = { minutes: base, block: null, targets: {}, adds: [], pickup: 1 };
  if (!opts.on) return term;
  const way = opts.way ?? ACTION_WAYS[kind];
  for (const r of TERM_RULES) {
    if (!applies(r, kind, way) || !r.when(facts)) continue;
    if (r.block) {
      if (r.callees) {
        for (const c of r.callees) term.targets[c] ??= r.label;
      } else {
        term.block ??= r.label;
      }
    }
    if (r.add) {
      term.minutes += r.add;
      if (!term.adds.includes(r.label)) term.adds.push(r.label);
    }
    if (r.pickup !== undefined) term.pickup *= r.pickup;
  }
  // 本人電話の相手はいつも本人
  if (kind === "call_person" && term.targets.self) term.block ??= term.targets.self;
  return term;
}

/** 選んだ相手で押せないか（相手の区分、固定の相手は fixed）。押せなければ理由 */
export function blockOf(term: ActionTerm, callee: TermCallee | null): string | null {
  if (term.block) return term.block;
  return callee ? (term.targets[callee] ?? null) : null;
}

/** 本人ごとの手の可否と所要（画面の対応の欄に渡す。自由対応は表の 0 分のまま） */
export function termsFor(s: TermSource, person: string | null): Record<DrillAction, ActionTerm> {
  const facts = termFactsOf(s, person);
  const on = s.options?.terms === true;
  return Object.fromEntries(ACTION_CATALOG.map((r) => [r.id, actionTerm(r.id, facts, { on })])) as Record<DrillAction, ActionTerm>;
}
