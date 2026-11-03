// 訓練の状態と 1 刻みの進め方（docs/tasks/T17.md）。D1 を使わない所。保存は lib/drill/db.ts。
//
// 状態: 今の刻み・世界の状態（被害状況）・本人ごとの様子と安否・ケアマネの手の履歴。
// step() は 1 刻みだけ進める（1 要求で全刻みを回さない。ブラウザから 1 刻みずつ呼ぶ）。
// 1 刻みの順: 想定の表の出来事（監督の固定の差し込みも）を世界に当てる → 監督（Opus、T19）の差し込み 0〜2 個 →
// 本人ごとの 1 刻み（ペルソナ T18。無ければ表の固定の安否）。本人役は監督の差し込みを「この刻みの状況」として読む。
//
// 時刻: 発災（想定の 0 時間）は訓練を始めた時刻（drills.started_at）。想定の h 時間は started_at + h 時間（simAt）。
// 安否の時刻もこの時計で持ち、ルールの表（lib/triage）には drillSituation の状況で当てる。事業所の災害モード（disaster_state）は
// 読まない・変えない（本番の大雨の最中でも、訓練は訓練の状況で動く）。
// 色と順位はここで決めない（lib/triage だけ）。

import type { ContactKind, DrillAction, DrillScenario, DrillStatus, Ledger, SignalColor, WhereNow } from "../db/types.ts";
import type { DisasterSituation } from "../disaster/state.ts";
import { isSourceId, type SourceId } from "../sources/index.ts";
import {
  applyEvent,
  EMPTY_WORLD,
  eventHour,
  injectChange,
  isInjectKind,
  isVirtual,
  scenarioOf,
  settleWorld,
  type FixedTurn,
  type InjectKind,
  type OutageArea,
  type PersonMarks,
  type PhoneState,
  type Scenario,
  type WorldEvent,
  type WorldState,
} from "./scenarios.ts";
import { castEvent, castTurn, eventKey, turnKey, type Cast } from "./cast.ts";
import { NO_HINTS, type OutcomeHints, type OutcomeHook } from "./outcome.ts";
import { isStaffCount } from "./options.ts";

export { isStaffCount, STAFF_MAX } from "./options.ts";
import { fallbackIncidents } from "./world-apply.ts";

const HOUR_MS = 3_600_000;

/** 本人ごとの 1 刻みの結果（安否 1 つ）。表の固定の物も、ペルソナ（T18）の物も同じ形 */
export type DrillTurn = {
  person: string;
  color: SignalColor;
  source: FixedTurn["source"];
  whereNow: WhereNow | null;
  injured: boolean | null;
  atHome: boolean | null;
  canMove: boolean | null;
  hasMedicine: boolean | null;
  /** 言う事（安否の文字起こしの欄に入る） */
  saying: string | null;
  /** する事 */
  doing: string | null;
  /** Claude（ペルソナ）が作った物。表の固定の物は false。画面で AI の印を付ける */
  ai: boolean;
  /** 起きた時刻（発災からの時間） */
  at: number;
  /** 保存した安否の signals の id（保存した刻みから読み直したときだけ。着信の声と録音の再生に使う、T21） */
  signal?: string;
};

/**
 * 状況（世界の出来事）1 つ。表の世界の出来事は world、監督（T19）の差し込みは director（想定の表の固定の物と Opus の物）。
 * 監督の物は inject（種類）・reason（判断の理由。採点 T22 が読む）・basis（根拠の出典）を持てる
 */
export type DrillIncident = Omit<WorldEvent, "by"> & {
  actor: "world" | "director";
  at: number;
  /** Claude（監督）が作った物。画面で AI の印。想定の表の固定の差し込みは false */
  ai: boolean;
};

/** 本人ごとの今の様子（いちばん新しい 1 刻みの安否） */
export type PersonState = {
  color: SignalColor;
  source: FixedTurn["source"];
  whereNow: WhereNow | null;
  at: number;
  saying: string | null;
  doing: string | null;
  /**
   * 赤の 4 問の答え（T21。通話・訪問で聞いた安否に写す）。T20 までに保存した状態には無い（無ければ答えていない）
   */
  injured?: boolean | null;
  atHome?: boolean | null;
  canMove?: boolean | null;
  hasMedicine?: boolean | null;
};

/**
 * ケアマネが通話・訪問で聞いた安否（T21、11/3 07:0x の確定 2）。本人・家族・支援者が電話に出て答えた・訪問で着いたときだけ。
 * 色と 4 問は本人役の今の様子（PersonState）から決める（Claude は決めない）。保存の所が signals に出どころ care_manager で足し、
 * 左の表の色・順位を動かす。AI の分類ではなく人が聞いた結果なので AI の印は付けない（言う事は文字起こしに入れない）
 */
export type HeardSignal = {
  /** 通話（本人電話・連絡先電話）か訪問（着いた。「確認済」） */
  via: "call" | "visit";
  color: SignalColor;
  whereNow: WhereNow | null;
  injured: boolean | null;
  atHome: boolean | null;
  canMove: boolean | null;
  hasMedicine: boolean | null;
  /** 聞いた時刻（発災からの時間。手の終わり） */
  at: number;
};

/**
 * ケアマネの手 1 つ（T20、lib/drill/actions.ts）。誰に・何を・何時と、手の前の状態、世界の返事。
 * drills.world の actions と drill_events（kind action と result）に残し、採点（T22）が読む
 */
export type ActionRecord = {
  /** 訓練の中の番号（a1・a2…。打った順） */
  id: string;
  kind: DrillAction;
  /** 相手の本人（台帳の id）。全体への報告・自分の避難は null */
  person: string | null;
  /** 相手の連絡先の id（電話の相手・出向いてもらう人）。事業所の職員・相手の無い手は null */
  target: string | null;
  /** 相手の区分（本人・家族・訪問看護・透析施設…）。事業所の職員・相手の無い手は null */
  callee: ContactKind | null;
  /** 相手の言い方（「家族 娘」「訪問看護」）。名前と番号は書かない */
  calleeLabel: string | null;
  /** 打った時刻（発災からの時間。小数） */
  at: number;
  /** 打った時刻と終わる時刻（発災からの分） */
  atMinute: number;
  endMinute: number;
  /** 所要時間（分。表で固定） */
  minutes: number;
  /** 打ったときの刻み */
  step: number;
  /** 手の前の状態（採点 T22 が読む） */
  before: ActionBefore;
  /** 世界の返事。手の途中で刻みを越えている間だけ null */
  result: ActionResult | null;
  /**
   * ケアマネのメモ（T59、100 字まで、任意）。なぜその手を打ったか。訓練記録と履歴に出すだけで、
   * 講評・監督・世界・本人役（Claude）の入力には渡さない（withoutMemo で落とす）
   */
  memo?: string;
};

/** 手の前の状態。本人の今の様子・印、職員の空き、電話の線、家の前の道。左の表の色と順位は保存の所が足す */
export type ActionBefore = {
  person: PersonState | null;
  marks: PersonMarks;
  staff: number;
  phone: PhoneState;
  /** 家の前の道が通行止 */
  roadClosed: boolean;
  /** 左の表のこの本人の色・順位・理由（lib/triage。保存の所が画面と同じ道で作って足す） */
  triage?: { color: string; rank: number | null; reason: string } | null;
  /** 左の表の優先の並び（台帳の id、1 番から） */
  ranking?: string[];
};

/** 世界の返事の状態。T19 の WORLD_REPLY_LABELS の 13 と、電話に出ない・声がない・番号が無い */
export type ActionStatus =
  | "ringing"
  | "connected"
  | "noLine"
  | "closed"
  | "arrived"
  | "blocked"
  | "turnedBack"
  | "dispatched"
  | "noDispatch"
  | "accepted"
  | "refused"
  | "reported"
  | "evacuated"
  | "noAnswer"
  | "silent"
  | "noNumber";

export type ActionResult = {
  ok: boolean;
  status: ActionStatus;
  /** そうなった世界の事実（「家の前の道 通行止」）。確率で外れたときは null */
  because: string | null;
  /** 画面の 1 文（固定の文か、監督の言い換え） */
  text: string;
  /** 文が監督（Opus）の言い換え */
  ai: boolean;
  /** 電話に出た人の言う事（吹き出し）。出ない・声がない・本人でも家族でもない相手は null */
  speech: string | null;
  /** 言う事が本人役（Haiku）の物 */
  speechAi: boolean;
  /** 本人・家族・支援者への電話で、出たか（出る・出ない・背景の音だけ） */
  pickup: "answers" | "no_answer" | "background_only" | null;
  /** この手で消えた本人の印（出向いてもらった人の分は着いた時刻に世界が消す） */
  cleared: Array<keyof PersonMarks>;
  /** 職員の空きの増減（事業所の職員に出向いてもらうと -1） */
  staff: number;
  /** 手の途中で進んだ刻み（その間の安否は着信） */
  crossed: number[];
  /** 返事の時刻（終わる時刻。発災からの分） */
  atMinute: number;
  /** 通話・訪問で聞いた安否（T21）。保存の所が signals に足す（id は `<訓練>-<手の番号>-h`）。無ければ null */
  heard?: HeardSignal | null;
};

/**
 * 開始の前に選んだ物（T59）。選ばなかった物は持たない（何も選ばなければ options ごと無い＝今までと同じ）。
 * 参加者は DrillState.participants に入る（ここには持たない）
 */
export type DrillOptions = {
  /** 職員の空き（0〜9）。想定の表の値の上書き */
  staff?: number;
  /** 夜間発災（発災は深夜 2 時ごろ。lib/drill/night.ts） */
  night?: boolean;
};

export type DrillState = {
  scenario: DrillScenario;
  /** 発災（想定の 0 時間）。訓練を始めた時刻 */
  startedAt: string;
  /** 今の刻み（想定の hours の添字）。始める前は -1 */
  step: number;
  /** 今の刻みの時刻（発災からの時間） */
  hour: number;
  /**
   * ケアマネの時計（発災からの分）。刻みに着くと刻みの時刻、手を打つと所要時間だけ進む（T20）。
   * 左の表のルールの表の「今」はこの時計（手に時間を使うと時計の残りも減る）
   */
  minute: number;
  status: DrillStatus;
  /** 訓練に出る本人（始めたときの担当一覧。台帳の id） */
  participants: string[];
  world: WorldState;
  people: Record<string, PersonState>;
  actions: ActionRecord[];
  /** 開始の前に選んだ物（T59）。選ばなかった訓練には無い */
  options?: DrillOptions;
  /** 取り消した手の数（T59）。無ければ 0。訓練記録に「取消 N」と出す（採点は変えない） */
  undone?: number;
  /**
   * 想定の表の配役（T70、lib/drill/cast.ts）。行の鍵 → 代わりの人。事業所にいない人（デモの 10 人）の行を参加者に当てた物だけで、
   * 全部 person のまま（デモ事業所）なら無い
   */
  cast?: Cast;
};

/** 1 刻みで起きた事。保存（lib/drill/db.ts）はこれを drill_events と signals に書く */
export type Tick = {
  step: number;
  hour: number;
  incidents: DrillIncident[];
  turns: DrillTurn[];
  /** 刻みのあとの世界 */
  world: WorldState;
  /** 最後の刻み（訓練の終わり） */
  finished: boolean;
};

// ---------- T18（ペルソナ）・T19（監督）の呼び口 ----------

/** ペルソナ（T18）に渡す物。本人 1 人の 1 刻み。Claude に渡す前に仮名化する（ここは id だけ） */
export type PersonaInput = {
  step: number;
  hour: number;
  person: string;
  /** 刻みのあとの世界（この刻みの状況を当てたあと） */
  world: WorldState;
  /** この刻みの状況 */
  incidents: ReadonlyArray<DrillIncident>;
  /** 前の刻みまでの様子。まだ安否が無ければ null */
  state: PersonState | null;
  /** 直前のケアマネの手（この本人に向けた物。T20） */
  lastAction: ActionRecord | null;
  /** 想定の表のこの本人の行（起きること）。ペルソナはこれを骨にする */
  fixed: ReadonlyArray<FixedTurn>;
  /** 仮想モード（T50）。本人役は表の行が無く、自分の町の状況から自由に動く */
  virtual?: boolean;
  /** 夜間発災（T59）。本人役に「発災は深夜 2 時ごろ。今は N 時ごろ」の 1 行を足す */
  night?: boolean;
};

/** 本人 1 人の 1 刻み。空の配列は「連絡なし」。投げたら連絡なしとして進む */
export type PersonaHook = (input: PersonaInput) => Promise<DrillTurn[]>;

/** 監督（T19）に渡す物。表の状況（固定の差し込みも）を当てたあとの世界 */
export type DirectorInput = {
  scenario: DrillScenario;
  step: number;
  hour: number;
  world: WorldState;
  /** この刻みの表の状況 */
  incidents: ReadonlyArray<DrillIncident>;
  participants: ReadonlyArray<string>;
  people: Readonly<Record<string, PersonState>>;
  actions: ReadonlyArray<ActionRecord>;
  /**
   * 言い換えてほしい世界の返事（T20）。手の途中でこの刻みに着いたとき、その手の返事（固定の文）をこの 1 回の監督に相乗りさせる。
   * 無ければ差し込みだけ
   */
  replies?: ReadonlyArray<ReplyAsk>;
  /** 夜間発災（T59）。監督・世界に「発災は深夜 2 時ごろ。今は N 時ごろ」の 1 行を足す */
  night?: boolean;
};

/** 監督に言い換えを頼む世界の返事 1 つ。結果（status・because）は決まっていて、監督は文だけ返す */
export type ReplyAsk = {
  /** 手の番号（a1…） */
  id: string;
  action: DrillAction;
  person: string | null;
  callee: ContactKind | null;
  status: ActionStatus;
  because: string | null;
  /** 固定の文 */
  text: string;
};

/** 監督の言い換え 1 つ（手の番号と文） */
export type ReplyWords = { id: string; text: string };

/**
 * 監督の差し込み 1 つ。種類（表の 6 つ）と相手の本人だけを選び、世界の変化は engine が種類から組む（injectChange）。
 * text は画面の 1 行（氏名を書かない。画面が名前を添える）
 */
export type DirectorEvent = {
  inject: InjectKind;
  person: string;
  text: string;
  reason?: string;
  basis?: SourceId;
  /** Claude（Opus）が選んだ物 */
  ai: boolean;
};

/** 監督の返す物。差し込みと、頼まれた世界の返事の言い換え */
export type DirectorResult = { events: DirectorEvent[]; words?: ReadonlyArray<ReplyWords> };

/** 差し込む状況（0〜2 個）と言い換え。差し込みだけの配列も受ける。投げたら差し込みなし・言い換えなしで進む */
export type DirectorHook = (input: DirectorInput) => Promise<DirectorEvent[] | DirectorResult>;

/** 監督の差し込みは 1 刻みに 2 つまで */
export const DIRECTOR_MAX = 2;

/**
 * 監督の返した物を状況にする。表の 6 つの外の種類・参加者でない本人・空の文は捨て、同じ本人に 2 つは当てない。
 * 世界の変化は種類からコードが組むので、監督が表の外の変化（警戒・断水・全域の停電など）を起こす道は無い
 */
export function directorIncidents(
  events: ReadonlyArray<DirectorEvent>,
  members: ReadonlySet<string>,
  hour: number,
): DrillIncident[] {
  const out: DrillIncident[] = [];
  const used = new Set<string>();
  for (const e of events) {
    if (out.length >= DIRECTOR_MAX) break;
    if (!isInjectKind(e.inject) || typeof e.person !== "string" || !members.has(e.person) || used.has(e.person)) continue;
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (!text) continue;
    used.add(e.person);
    out.push({
      change: injectChange(e.inject, e.person),
      text,
      person: e.person,
      inject: e.inject,
      ...(typeof e.reason === "string" && e.reason.trim() ? { reason: e.reason.trim() } : {}),
      ...(e.basis && isSourceId(e.basis) ? { basis: e.basis } : {}),
      actor: "director",
      at: hour,
      ai: e.ai === true,
    });
  }
  return out;
}

/**
 * 仮想モード（T50）の世界の 1 刻みに渡す物。監督の入力に、時計の目安（hints。時計の計算、結末は決めない）と部屋の session を足す。
 * 結末は世界が決める（T53）。
 * 世界の口（lib/drill/world-room.ts・world-oneshot.ts）が仮名化してから Claude に渡す
 */
export type WorldInput = DirectorInput & {
  /** 時計の目安（lib/drill/outcome.ts）。条件に達した人と、走っている時計の残り・超過 */
  hints: OutcomeHints;
  /** 世界の部屋の session の ID。まだ無ければ null（最初の刻みで作る） */
  session: string | null;
  /** 今の時刻（発災からの分） */
  minute: number;
};

/** 世界の 1 刻みの返事。incidents は当てる状況（結末も入る）、session は作った・使った部屋の ID（変わらなければ省く） */
export type WorldResult = { incidents: DrillIncident[]; session?: string | null };

/** 仮想モードの世界の口。投げたら世界は動かさず、結末も出さない（fallbackIncidents） */
export type WorldHook = (input: WorldInput) => Promise<WorldResult>;

/**
 * world と outcome は仮想モード（T50）だけが使う。固定の筋（大雨・地震・10 分版）は今までどおり director と persona だけ
 */
export type StepHooks = { persona?: PersonaHook; director?: DirectorHook; world?: WorldHook; outcome?: OutcomeHook };

/** 1 刻みの呼び方の足し物（T20）。replies は表の出来事を当てたあと・監督の前の世界で、監督に言い換えを頼む返事を決める */
export type StepOptions = { replies?: (world: WorldState) => ReadonlyArray<ReplyAsk> };

// ---------- 時刻と状況 ----------

/** 想定の h 時間の時刻（ISO 8601） */
export function simAt(startedAt: string, hour: number): string {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) throw new Error(`時刻の形が違う: ${startedAt}`);
  return new Date(t + hour * HOUR_MS).toISOString();
}

/** 今の時刻（発災からの時間。小数）。ケアマネの時計があればそれ、無ければ刻みの時刻 */
export function nowHour(s: { hour: number; minute?: number }): number {
  return typeof s.minute === "number" ? Math.max(s.hour, s.minute / 60) : s.hour;
}

/** 停電の地区の町名。ハザードの地区なら、そのハザード（浸水の深さ）を持つ本人の町名。町の一覧（仮想、T50）ならその町。全域なら null */
export function outageTownsOf(area: OutageArea, ledgers: ReadonlyArray<Pick<Ledger, "basic" | "evacuation">>): string[] | null {
  if (area.scope === "office") return null;
  if (area.scope === "towns") return [...area.towns];
  const towns = new Set<string>();
  for (const l of ledgers) {
    const hit = l.evacuation.hazards.some((h) => h.kind === area.hazard && (h.depthM ?? 0) >= area.minDepthM);
    const town = l.basic.address?.town?.trim();
    if (hit && town) towns.add(town);
  }
  return [...towns];
}

/**
 * ルールの表（lib/triage）に渡す訓練の状況。今はケアマネの時計（手に使った時間も進む）、発災は訓練を始めた時刻、停電は世界の停電の始まり。
 * 停電の復旧はルールの表の入力に持たない（Situation に終わりが無い。止まった機器の時計を戻さない）。被害状況と棒には出す
 */
export function drillSituation(
  state: Pick<DrillState, "startedAt" | "hour" | "world"> & { minute?: number },
  ledgers: ReadonlyArray<Pick<Ledger, "basic" | "evacuation">>,
): DisasterSituation {
  const o = state.world.outage;
  return {
    now: simAt(state.startedAt, nowHour(state)),
    disasterAt: state.startedAt,
    outageAt: o ? simAt(state.startedAt, o.since) : null,
    outageTowns: o ? outageTownsOf(o.area, ledgers) : null,
  };
}

// ---------- 1 刻み ----------

function fixedToTurn(f: FixedTurn, tickHour: number): DrillTurn {
  return {
    person: f.person,
    color: f.color,
    source: f.source,
    whereNow: f.color === "green" ? (f.whereNow ?? null) : null,
    injured: f.color === "red" ? (f.injured ?? null) : null,
    atHome: f.color === "red" ? (f.atHome ?? null) : null,
    canMove: f.color === "red" ? (f.canMove ?? null) : null,
    hasMedicine: f.color === "red" ? (f.hasMedicine ?? null) : null,
    saying: f.saying ?? null,
    doing: f.doing ?? null,
    ai: false,
    at: eventHour(f, tickHour),
  };
}

function personStateOf(t: DrillTurn): PersonState {
  return {
    color: t.color,
    source: t.source,
    whereNow: t.whereNow,
    at: t.at,
    saying: t.saying,
    doing: t.doing,
    injured: t.injured,
    atHome: t.atHome,
    canMove: t.canMove,
    hasMedicine: t.hasMedicine,
  };
}

/** 状況を世界に当て、本人の様子を安否で進める（保存した刻みから状態を作り直すときも同じ所を通す） */
export function foldTick(
  state: DrillState,
  tick: Pick<Tick, "step" | "hour" | "incidents" | "turns">,
  last: number,
): DrillState {
  // 刻みの時刻まで世界を進め（出向いてもらった人が着く・職員が戻る）、状況を当てる
  const world = tick.incidents.reduce((w, e) => applyEvent(w, e, e.at), settleWorld(state.world, tick.hour * 60));
  const people = { ...state.people };
  for (const t of [...tick.turns].sort((a, b) => a.at - b.at)) people[t.person] = personStateOf(t);
  return {
    ...state,
    step: tick.step,
    hour: tick.hour,
    minute: Math.max(state.minute, tick.hour * 60),
    world,
    people,
    status: tick.step >= last ? "finished" : state.status,
  };
}

/**
 * 始める前の状態（まだどの刻みも当てていない）。職員の空きは想定の表から（T59: options.staff があれば上書き）。
 * options は選んだ物だけ持つ（何も選ばなければ options の鍵ごと無い＝今までと同じ状態）
 */
export function initialState(
  scenario: DrillScenario,
  participants: ReadonlyArray<string>,
  startedAt: string,
  options: DrillOptions = {},
  cast: Cast = {},
): DrillState {
  const opts = cleanOptions(options);
  return {
    scenario,
    startedAt,
    step: -1,
    hour: 0,
    minute: 0,
    status: "running",
    participants: [...participants],
    world: { ...EMPTY_WORLD, staff: opts.staff ?? scenarioOf(scenario).staff },
    people: {},
    actions: [],
    ...(Object.keys(opts).length > 0 ? { options: opts } : {}),
    ...(Object.keys(cast).length > 0 ? { cast: { ...cast } } : {}),
  };
}


/** 選んだ物だけ残す（職員は 0〜9 の整数、夜間発災は true のときだけ） */
export function cleanOptions(o: DrillOptions | null | undefined): DrillOptions {
  return {
    ...(isStaffCount(o?.staff) ? { staff: o!.staff } : {}),
    ...(o?.night === true ? { night: true } : {}),
  };
}

/**
 * 手の記録からケアマネのメモを落とす（T59）。講評・監督・世界・本人役（Claude）の入力に渡す前に必ず通す。
 * メモを Claude に渡したくなったら、仮名化の門（lib/pseudonym → askJson）を通す別の作業にする
 */
export function withoutMemo<T extends ActionRecord>(actions: ReadonlyArray<T>): T[] {
  return actions.map((a) => {
    if (a.memo === undefined) return a;
    const { memo: _memo, ...rest } = a;
    return rest as T;
  });
}

/** 1 つの手のメモを落とす（本人役の「ケアマネがした事」） */
export function actionWithoutMemo(a: ActionRecord | null): ActionRecord | null {
  return a ? withoutMemo([a])[0] : null;
}

/** 夜間発災の訓練か */
export const isNight = (s: Pick<DrillState, "options">): boolean => s.options?.night === true;

export class DrillEnded extends Error {
  constructor() {
    super("訓練は終わっている");
    this.name = "DrillEnded";
  }
}

async function safely<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch {
    return fallback;
  }
}

/**
 * 1 刻み進める。進行中で、まだ最後の刻みでなければ。始める前の状態（step -1）からは 0 時間の刻みを当てる。
 * 返す state は刻みのあと。tick は保存する物。words は opts.replies で頼んだ返事の監督の言い換え（頼んだ手の番号の物だけ）
 */
export async function step(
  state: DrillState,
  hooks: StepHooks = {},
  opts: StepOptions = {},
): Promise<{ state: DrillState; tick: Tick; words: ReplyWords[] }> {
  const scenario: Scenario = scenarioOf(state.scenario);
  const last = scenario.hours.length - 1;
  if (state.status !== "running" || state.step >= last) throw new DrillEnded();
  const index = state.step + 1;
  const def = scenario.ticks[index];
  const hour = def.hour;
  const members = new Set(state.participants);
  // 想定の表の配役（T70）。事業所にいない人の行は、開始のときに決めた代わりの人に当てる（無ければ表の person のまま）
  const cast = state.cast ?? {};

  // 表の状況（出ない本人の物は外す）。監督の固定の差し込み（by: director）は actor が director で、AI の印なし。
  // 代わりの人の選び方（who）は表の物で、状況に残さない
  const fixed: DrillIncident[] = def.events
    .map((e, i) => castEvent(e, cast[eventKey(hour, i)]))
    .filter((e) => !e.person || members.has(e.person))
    .map(({ by, who: _who, ...e }) => ({ ...e, actor: by ?? "world", at: eventHour(e, hour), ai: false }));
  let world = fixed.reduce((w, e) => applyEvent(w, e, e.at), settleWorld(state.world, hour * 60));

  // 手の途中でこの刻みに着いたとき、その手の返事をここで決め、監督に言い換えを頼む（T20。監督の呼び出しは増やさない）
  const replies = opts.replies ? [...opts.replies(world)] : [];
  // Claude に渡す手の記録はメモを落とす（T59）。夜間発災は選んだ訓練だけ 1 行を足す
  const actions = withoutMemo(state.actions);
  const night = isNight(state) ? { night: true } : {};

  const directorInput: DirectorInput = {
    scenario: state.scenario,
    step: index,
    hour,
    world,
    incidents: fixed,
    participants: state.participants,
    people: state.people,
    actions,
    ...(replies.length > 0 ? { replies } : {}),
    ...night,
  };
  if (isVirtual(state.scenario)) return virtualStep(state, hooks, { index, hour, last, world, fixed, members, directorInput });

  // 監督（Opus、T19）の差し込み。1 刻みに 1 回。無ければ・失敗したら差し込みなし（表の固定の状況だけで進む）
  const out: DirectorEvent[] | DirectorResult = hooks.director
    ? await safely(
        () =>
          hooks.director!({
            scenario: state.scenario,
            step: index,
            hour,
            world,
            incidents: fixed,
            participants: state.participants,
            people: state.people,
            actions,
            ...(replies.length > 0 ? { replies } : {}),
            ...night,
          }),
        [] as DirectorEvent[],
      )
    : [];
  const inserted = directorIncidents(Array.isArray(out) ? out : (out?.events ?? []), members, hour);
  const asked = new Set(replies.map((r) => r.id));
  const words = (Array.isArray(out) ? [] : (out?.words ?? [])).filter(
    (w): w is ReplyWords => typeof w?.id === "string" && asked.has(w.id) && typeof w.text === "string" && w.text.trim() !== "",
  );
  world = inserted.reduce((w, e) => applyEvent(w, e, e.at), world);
  const incidents = [...fixed, ...inserted];

  // 本人ごとの 1 刻み。ペルソナ（T18）が無ければ表の固定の安否。ペルソナが投げたら連絡なし
  const turns: DrillTurn[] = [];
  const dealt = def.turns.map((t, i) => castTurn(t, cast[turnKey(hour, i)]));
  const rows = state.participants.map((person) => ({ person, rows: dealt.filter((t) => t.person === person) }));
  if (hooks.persona) {
    const results = await Promise.all(
      rows.map(({ person, rows: own }) =>
        safely(
          () =>
            hooks.persona!({
              step: index,
              hour,
              person,
              world,
              incidents,
              state: state.people[person] ?? null,
              lastAction: actionWithoutMemo([...state.actions].reverse().find((a) => a.person === person) ?? null),
              fixed: own,
              ...night,
            }),
          [] as DrillTurn[],
        ),
      ),
    );
    results.forEach((r, i) => turns.push(...r.filter((t) => t.person === rows[i].person)));
  } else {
    for (const { rows: own } of rows) turns.push(...own.map((f) => fixedToTurn(f, hour)));
  }

  const tick: Tick = { step: index, hour, incidents, turns, world, finished: index >= last };
  return { state: foldTick(state, tick, last), tick, words };
}

// ---------- 仮想モード（T50）の 1 刻み ----------

/**
 * 仮想の 1 刻み。順: 時計の目安（コードの計算、lib/drill/outcome.ts）→ 世界（部屋か 1 回呼び。出来事と、結末を迎えた人とその 1 文・理由）→
 * 本人役（結末の人は呼ばない）。結末は世界が決める（T53）。コードは代わりに決めない:
 * 世界の口が無い（鍵なし・DRILL_WORLD=off）・投げたら、世界は動かさず結末も出さない（「世界 停止」「世界 代替」の印）。
 * 表の出来事も本人の行も無い（scenarios.ts の VIRTUAL）。言い換え（T20 の replies）は頼まない（返事は固定の文）
 */
async function virtualStep(
  state: DrillState,
  hooks: StepHooks,
  t: {
    index: number;
    hour: number;
    last: number;
    world: WorldState;
    fixed: DrillIncident[];
    members: ReadonlySet<string>;
    directorInput: DirectorInput;
  },
): Promise<{ state: DrillState; tick: Tick; words: ReplyWords[] }> {
  const { index, hour, last, members } = t;
  let world = t.world;
  const minute = Math.max(state.minute, hour * 60);
  const raw = hooks.outcome
    ? await safely(() => hooks.outcome!({ world, actions: state.actions, participants: state.participants, minute }), NO_HINTS)
    : NO_HINTS;
  const keep = (p: string) => members.has(p) && !world.ended?.[p];
  const hints: OutcomeHints = { reached: raw.reached.filter((o) => keep(o.person)), clocks: raw.clocks.filter((c) => keep(c.person)) };
  const r: WorldResult | null = hooks.world
    ? await safely(() => hooks.world!({ ...t.directorInput, world, hints, session: world.session ?? null, minute }), null)
    : null;
  // 結末の人がまた結末になる・参加者でない人の状況は当てない（世界の口でも捨てるが、ここでも守る）
  const inserted = r
    ? r.incidents.filter((e) => !e.person || (members.has(e.person) && !(e.change.kind === "outcome" && world.ended?.[e.person])))
    : fallbackIncidents(hour, hooks.world ? "down" : "off");
  if (r && r.session !== undefined) world = { ...world, session: r.session };
  world = inserted.reduce((w, e) => applyEvent(w, e, e.at), world);
  const incidents = [...t.fixed, ...inserted];

  // 本人役（Haiku）。結末の人は呼ばない（信号を出さない・着信も鳴らない）。本人役が無ければ連絡なし（仮想には表の行が無い）
  const turns: DrillTurn[] = [];
  const live = state.participants.filter((p) => !world.ended?.[p]);
  if (hooks.persona) {
    const results = await Promise.all(
      live.map((person) =>
        safely(
          () =>
            hooks.persona!({
              step: index,
              hour,
              person,
              world,
              incidents,
              state: state.people[person] ?? null,
              lastAction: actionWithoutMemo([...state.actions].reverse().find((a) => a.person === person) ?? null),
              fixed: [],
              virtual: true,
              ...(isNight(state) ? { night: true } : {}),
            }),
          [] as DrillTurn[],
        ),
      ),
    );
    results.forEach((x, i) => turns.push(...x.filter((u) => u.person === live[i])));
  }

  const tick: Tick = { step: index, hour, incidents, turns, world, finished: index >= last };
  // foldTick は前の世界に状況を当て直すので、部屋の ID は前の世界に先に写す
  const base = r && r.session !== undefined ? { ...state, world: { ...state.world, session: r.session } } : state;
  return { state: foldTick(base, tick, last), tick, words: [] };
}

/** 想定の最後の刻みの添字 */
export function lastStep(scenario: DrillScenario): number {
  return scenarioOf(scenario).hours.length - 1;
}
