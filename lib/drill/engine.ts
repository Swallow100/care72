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

import type { DrillScenario, DrillStatus, HazardKind, Ledger } from "../db/types.ts";
import type { Homes } from "./comms.ts";
import type { DisasterSituation } from "../disaster/state.ts";
import {
  applyEvent,
  EMPTY_WORLD,
  eventHour,
  isVirtual,
  scenarioOf,
  settleWorld,
  AI_STOPS,
  type AiStop,
  type FixedTurn,
  type OutageArea,
  type Scenario,
  type WorldState,
} from "./scenarios.ts";
import { castEvent, castTurn, eventKey, turnKey, type Cast } from "./cast.ts";
import { NO_HINTS, type OutcomeHints, type OutcomeHook } from "./outcome.ts";
import { isStaffCount } from "./options.ts";
import type { ActionRecord, FreeDraft } from "./action-types.ts";
import {
  DIRECTOR_MAX,
  directorIncidents,
  stopIncidents,
  type DirectorEvent,
  type DirectorHook,
  type DirectorInput,
  type DirectorResult,
  type DrillIncident,
  type ReplyAsk,
  type ReplyWords,
} from "./incident-types.ts";
import type { DrillTurn, PersonaBatchHook, PersonaHook, PersonaInput, PersonaReason, PersonState } from "./persona-types.ts";
import {
  budgetOf,
  actionReaches,
  CAP_REASON,
  changedSince,
  GATHER_MINUTES,
  QUIET_REASONS,
  ROUND_QUIET_MINUTES,
  capReached,
  CLOCK_LABELS,
  crossedClocks,
  DIRECTOR_DRILL_MAX,
  DIRECTOR_GAP_MINUTES,
  DRILL_CALL_CAP,
  DRILL_END_MINUTE,
  chunks,
  PERSONA_BATCH_MAX,
  PERSONA_PER_CUT,
  REASON_ORDER,
  ROUND_MINUTES,
  ROUND_PER_CUT,
  softReached,
  totalCalls,
  ZERO_COUNTS,
  type ClockMark,
} from "./clock.ts";
import { fireScheduled } from "./schedule.ts";
import { screenIncidents, tableAheadOf } from "./state-rules.ts";
import { fitKindOf, profileOf, type FitProfile } from "./fit.ts";
import { gateTurns, tallyGate } from "./gate.ts";
import { routeTurns } from "./comms.ts";
import { drillSeed } from "./time-odds.ts";
import { cleanScale, fitToScale, scaleIncidents, type DrillScale } from "./scale.ts";
import { HOME_TOWN_MAX } from "./self.ts";

export { isStaffCount, STAFF_MAX } from "./options.ts";
import { fallbackIncidents } from "./world-apply.ts";

const HOUR_MS = 3_600_000;

// 型は 3 つのファイルに分けた（T90 の準備）。前からの import（"./engine.ts"）を壊さないよう、同じ名前をここからも出す:
// 手（T91）は action-types.ts、状況と監督（T92）は incident-types.ts、本人役（T93）は persona-types.ts
export type { ActionBefore, ActionRecord, ActionResult, ActionStatus, FreeDraft, FreeJudge, FreePlan, HeardSignal } from "./action-types.ts";
export type {
  DirectorEvent,
  DirectorHook,
  DirectorInput,
  DirectorResult,
  DrillIncident,
  ReplyAsk,
  ReplyWords,
} from "./incident-types.ts";
export { aiStoppedOf, DIRECTOR_MAX, directorIncidents, stopIncidents } from "./incident-types.ts";
export type { DrillTurn, PersonaBatchHook, PersonaHook, PersonaInput, PersonaReason, PersonState } from "./persona-types.ts";

/**
 * 開始の前に選んだ物（T59）。選ばなかった物は持たない（何も選ばなければ options ごと無い＝今までと同じ）。
 * 参加者は DrillState.participants に入る（ここには持たない）
 */
export type DrillOptions = {
  /** 職員の空き（0〜9）。想定の表の値の上書き */
  staff?: number;
  /** 夜間発災（発災は深夜 2 時ごろ。lib/drill/night.ts） */
  night?: boolean;
  /**
   * 連続の時計（T90）。30 分・1 時間・3 時間・次の出来事まで、から進める（advance）。大雨・地震・仮想の新しい訓練だけ
   * （開始の画面が付ける。10 分版には付けない）。無ければ刻みの道（step）で今までと同じ
   */
  clock?: true;
  /**
   * 仮想の規模（T104、lib/drill/scale.ts）。仮想だけ（ほかの想定に来たら startDrill が捨てる）。おまかせは開始の時に幅の中から引いた値。
   * 最初の区切りに規模の出来事を当て、世界の余震を規模の震度までにする
   */
  scale?: DrillScale;
  /** 規模をおまかせで引いたか（T104。残すだけで、画面の言葉にはまだ使っていない） */
  scaleAuto?: true;
  /**
   * 訓練する人（自分）の住む所の町名（T104、lib/drill/self.ts）。無ければ事業所の近く。
   * サーバーの中だけ。監督には地区の別名と地形の一言だけを渡す
   */
  home?: string;
  /**
   * 時間と状況で変わる手（T110、lib/drill/action-terms.ts）。夜・停電・浸水や通行止め・職員の数・自分の被災で手の可否と所要が変わる。
   * 開始の画面が連続の時計の訓練に付ける（10 分版には付けない）。無ければ表の分のまま（前からある訓練と同じ）
   */
  terms?: true;
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
  /**
   * 連続の時計の訓練（T90）の区切りの時刻（発災からの分）。i 番目は step i の終わり。保存した刻みの時刻はここから作る
   * （clock の無い訓練は想定の表の hours。鍵ごと無い）
   */
  cuts?: number[];
  /** 連続の時計の訓練で、監督（仮想は世界）を最後に呼んだ区切りの時刻（発災からの分）。まだなら無い */
  directorAt?: number;
  /**
   * 連続の時計の訓練で、AI も動かして進めた区切り（30 分・1 時間・3 時間・次まで・手の分）の最後の時刻（発災からの分、T110）。
   * 手の途中の区切り（silent）では変わらない。ここからケアマネの時計までが「手の分」で閉じる時間。無ければ最後の区切り
   */
  aiAt?: number;
  /** 自由対応の確かめ（T110、lib/drill/free-action.ts）。読み替えたあと打つ前だけ。サーバーの中だけで Claude の入力に渡さない */
  draft?: FreeDraft;
  /**
   * 参加者の家の区域と通信（T125、lib/drill/comms.ts の Home）。開始の時に台帳から写す。手の可否・世界の返事・連絡の経路が読む。
   * Claude に渡さない（町名を含む）。前からの訓練には無い（区域なし・固定電話あり・携帯なしと読む）
   */
  homes?: Homes;
  /** 事業所の区域（T125。offices.hazards の写し）。区域の出来事の間の職員の退避に使う。無ければ区域なし */
  officeZones?: HazardKind[];
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
// 本人役の型は persona-types.ts、監督の型は incident-types.ts（上で再び出している）

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
export type StepHooks = {
  persona?: PersonaHook;
  /**
   * 本人役をまとめて呼ぶ口（T121、lib/drill/persona.ts の createPersonaBatchHook）。連続の時計の区切りで、呼ぶ人を
   * PERSONA_BATCH_MAX 人ずつ 1 回の呼び出しにする。無ければ 1 人 1 回（persona）。10 分版（刻みの道）は使わない
   */
  personas?: PersonaBatchHook;
  director?: DirectorHook;
  world?: WorldHook;
  outcome?: OutcomeHook;
  stops?: StopLog;
  /** 連続の時計（T90）だけが使う。時計の半分・切れの時刻と、押せる人（lib/drill/hooks.ts） */
  clock?: ClockHooks;
};

/**
 * 連続の時計（T90）の口。marks は走っている時計の半分・切れの時刻（本人役を呼ぶ理由 clock と「次まで」）。
 * pressable はスマホで押せる人のいる本人（本人役の巡回と、行の無い人を呼ぶか）。読めなければ null（全員を押せる人と見る）
 */
export type ClockHooks = {
  marks?: (state: DrillState) => Promise<ClockMark[]>;
  pressable?: () => Promise<ReadonlySet<string> | null>;
};

/**
 * 上限で止まった AI の役を書き留める所（T70）。本人役・監督・世界の呼び口は、AI の 1 日の上限（AiLimitReached）で落ちたときに hit を呼ぶ
 * （返す物は今までと同じ: 本人役は表の固定の安否か連絡なし、監督は差し込みなし、世界は動かさない）。engine は刻みの始めに take で空にし、
 * 刻みの終わりに take で読んで、その刻みに「停止」の印（状況 ai_stop）を足す。1 要求ごとに作る（lib/drill/hooks.ts）
 */
export type StopLog = { hit(who: AiStop): void; take(): AiStop[] };

export function stopLog(): StopLog {
  const seen = new Set<AiStop>();
  return {
    hit: (who) => void seen.add(who),
    take: () => {
      const out = AI_STOPS.filter((x) => seen.has(x));
      seen.clear();
      return out;
    },
  };
}

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

/**
 * 状況を世界に当て、本人の様子を安否で進める（保存した刻みから状態を作り直すときも同じ所を通す）。
 * 連続の時計の訓練（T90）は、終わりを刻みの添字でなく tick.finished（72 時間に着いた）で見て、区切りの時刻を cuts に足す
 */
export function foldTick(
  state: DrillState,
  tick: Pick<Tick, "step" | "hour" | "incidents" | "turns"> & { finished?: boolean },
  last: number,
): DrillState {
  // 刻みの時刻まで世界を進め（出向いてもらった人が着く・職員が戻る）、状況を当てる
  const world = tick.incidents.reduce((w, e) => applyEvent(w, e, e.at), settleWorld(state.world, tick.hour * 60));
  const people = { ...state.people };
  for (const t of [...tick.turns].sort((a, b) => a.at - b.at)) people[t.person] = personStateOf(t);
  const clock = isClock(state);
  const finished = clock ? tick.finished === true : tick.step >= last;
  return {
    ...state,
    step: tick.step,
    hour: tick.hour,
    minute: Math.max(state.minute, tick.hour * 60),
    world,
    people,
    status: finished ? "finished" : state.status,
    ...(clock ? { cuts: [...(state.cuts ?? []), Math.round(tick.hour * 60)] } : {}),
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
  place: Pick<DrillState, "homes" | "officeZones"> = {},
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
    ...(place.homes && Object.keys(place.homes).length > 0 ? { homes: place.homes } : {}),
    ...(place.officeZones && place.officeZones.length > 0 ? { officeZones: [...place.officeZones] } : {}),
  };
}


/** 選んだ物だけ残す（職員は 0〜9 の整数、夜間発災・連続の時計は true のときだけ、規模は形の合う物、住む所は短い文字） */
export function cleanOptions(o: DrillOptions | null | undefined): DrillOptions {
  const scale = cleanScale(o?.scale);
  const home = typeof o?.home === "string" ? o.home.trim() : "";
  return {
    ...(isStaffCount(o?.staff) ? { staff: o!.staff } : {}),
    ...(o?.night === true ? { night: true } : {}),
    ...(o?.clock === true ? { clock: true as const } : {}),
    ...(scale ? { scale } : {}),
    ...(scale && o?.scaleAuto === true ? { scaleAuto: true as const } : {}),
    ...(home && Array.from(home).length <= HOME_TOWN_MAX ? { home } : {}),
    ...(o?.terms === true ? { terms: true as const } : {}),
  };
}

/**
 * 監督・世界に渡す T104 の欄。仮想は規模（scale）、連続の時計の大雨想定・地震想定は訓練する人の住む所（self。選ばなければ事業所の近く）。
 * 10 分版・刻みの道の訓練には付けない（前と同じ入力）
 */
export function worldExtras(state: Pick<DrillState, "scenario" | "options">): Pick<DirectorInput, "scale" | "self"> {
  if (isVirtual(state.scenario)) return state.options?.scale ? { scale: state.options.scale } : {};
  if (state.scenario === "short" || state.options?.clock !== true) return {};
  return { self: { home: state.options.home ?? null } };
}

/** 仮想の最初の区切りに当てる規模の出来事（T104）。規模の無い訓練・2 つ目からの区切りは空 */
export function openingIncidents(state: Pick<DrillState, "scenario" | "options">, first: boolean): DrillIncident[] {
  const scale = state.options?.scale;
  return first && isVirtual(state.scenario) && scale ? scaleIncidents(scale, 0) : [];
}

/** 連続の時計の訓練か（T90） */
export const isClock = (s: Pick<DrillState, "options">): boolean => s.options?.clock === true;

/**
 * AI も動かして進めた最後の区切りの時刻（発災からの分、T110）。無ければ最後の区切り。
 * ケアマネの時計がこれより先なら、その間は手に使った時間で、AI はまだ動いていない（「手の分」で閉じる）
 */
export function aiAtOf(s: Pick<DrillState, "step" | "hour" | "cuts" | "aiAt">): number {
  return s.aiAt ?? lastCutOf(s);
}

/** 最後の区切りの時刻（発災からの分）。始める前は -1。clock の無い訓練は今の刻みの時刻 */
export function lastCutOf(s: Pick<DrillState, "step" | "hour" | "cuts">): number {
  if (s.step < 0) return -1;
  return s.cuts?.at(-1) ?? Math.round(s.hour * 60);
}

/**
 * 訓練がもう進められないか。進行中でない、刻みの道は最後の刻みに着いた、連続の時計は 72 時間に着いた
 */
export function drillEnded(s: Pick<DrillState, "scenario" | "status" | "step" | "hour" | "cuts" | "options">): boolean {
  if (s.status !== "running") return true;
  return isClock(s) ? lastCutOf(s) >= DRILL_END_MINUTE : s.step >= lastStep(s.scenario);
}

/**
 * 手の記録からケアマネの書いた文を落とす（T59 のメモ、T90 の準備で自由に書く手〔T91〕の文 text と読み替えの理由 reason、T110 の AI の判断の記録 judge）。
 * 講評・監督・世界・本人役（Claude）の入力に渡す前に必ず通す。どれも無い手は同じ物を返す。
 * これらを Claude に渡したくなったら、仮名化の門（lib/pseudonym → askJson）を通す別の作業にする
 */
export function withoutMemo<T extends ActionRecord>(actions: ReadonlyArray<T>): T[] {
  return actions.map((a) => {
    if (a.memo === undefined && a.text === undefined && a.reason === undefined && a.judge === undefined) return a;
    const { memo: _memo, text: _text, reason: _reason, judge: _judge, ...rest } = a;
    return rest as T;
  });
}

/** 1 つの手のメモ（と自由に書く手の文）を落とす（本人役の「ケアマネがした事」） */
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
  // 前の刻み・通話の分の停止の印を捨てる（この刻みの分だけ数える）
  hooks.stops?.take();
  const hour = def.hour;
  const members = new Set(state.participants);
  // 想定の表の配役（T70）。事業所にいない人の行は、開始のときに決めた代わりの人に当てる（無ければ表の person のまま）
  const cast = state.cast ?? {};

  // 表の状況（出ない本人の物は外す）。監督の固定の差し込み（by: director）は actor が director で、AI の印なし。
  // 代わりの人の選び方（who）は表の物で、状況に残さない
  // 仮想の規模（T104）の出来事は最初の刻みの先頭に（規模の無い訓練は空）
  const fixed: DrillIncident[] = [
    ...openingIncidents(state, index === 0),
    ...def.events
      .map((e, i) => castEvent(e, cast[eventKey(hour, i)]))
      .filter((e) => !e.person || members.has(e.person))
      .map(({ by, who: _who, ...e }): DrillIncident => ({ ...e, actor: by ?? "world", at: eventHour(e, hour), ai: false })),
  ];
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
    ...worldExtras(state),
  };
  if (isVirtual(state.scenario)) return virtualStep(state, hooks, { index, hour, last, world, fixed, members, directorInput });

  // 監督（Opus、T19）の差し込み。1 刻みに 1 回。無ければ・失敗したら差し込みなし（表の固定の状況だけで進む）。
  // 最後の刻み（72 時間）は、手の返事の言い換えを頼むときだけ呼ぶ（T123。72 時間の新しい出来事には誰も応えられず、評価の 2 回目の審査役も
  // 「遅すぎる」と挙げた。10 分版の最後の進めの待ちも監督の分だけ縮む）
  const wantDirector = !!hooks.director && (index < last || replies.length > 0);
  // 10 分版は監督 → 本人役の順のまま（T89。0・3・12・72 時間の 4 刻みなので、並べると 12 時間の差し込みに 72 時間で初めて応えることになる）
  const out: DirectorEvent[] | DirectorResult = wantDirector
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
  // 監督の差し込みも変わり方の決まり（T121、lib/drill/state-rules.ts）で見る（T123。10 分版と前からある訓練の道は決まりの外だった）
  const raw = directorIncidents(Array.isArray(out) ? out : (out?.events ?? []), members, hour);
  const table = tableOf(state);
  // 刻みの道は予定の出来事を時刻で起こさない（fireScheduled は連続の時計だけ）ので、早すぎる再開は後ろに回さず捨てる
  // 想定の表（T125）も同じ門で見る（想定に合わない差し込みを捨てる）
  const screened = screenIncidents(world, raw, {
    origin: "ai",
    minute: Math.round(hour * 60),
    ahead: tableAheadOf(table.events, Math.round(hour * 60), table.rows),
    noDefer: true,
    fit: fitOf(state, world),
  });
  const inserted = screened.kept;
  world = screened.world;
  let gatedWorld = tallyGate(state.world, "director", screened.ruled.map((r) => r.rule));
  const asked = new Set(replies.map((r) => r.id));
  const words = (Array.isArray(out) ? [] : (out?.words ?? [])).filter(
    (w): w is ReplyWords => typeof w?.id === "string" && asked.has(w.id) && typeof w.text === "string" && w.text.trim() !== "",
  );
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
              actions: withoutMemo(state.actions.filter((a) => a.person === person)), // T93: 前の呼びからの手を全部
              fixed: own,
              fit: fitKindOf(state, world),
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
  // 本人役の言葉も想定の門に（T125。言う事・する事の合わない文を落とす）
  const gt = gateTurns(turns, fitOf(state, world), world);
  // 連絡の経路（T125、lib/drill/comms.ts）。届かない AI の安否は外す
  const rt = routeTurns(gt.turns, world, fitOf(state, world), state.homes);
  gatedWorld = tallyGate(tallyGate(gatedWorld, "persona", gt.dropped), "persona", rt.dropped);

  const tick: Tick = { step: index, hour, incidents: [...incidents, ...stopIncidents(hooks.stops?.take() ?? [], hour)], turns: rt.turns, world, finished: index >= last };
  return { state: foldTick({ ...state, world: gatedWorld }, tick, last), tick, words };
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
  // 結末の人がまた結末になる・参加者でない人の状況は当てない（世界の口でも捨てるが、ここでも守る）。余震は規模まで（T104）
  const inserted = r
    ? fitToScale(
        r.incidents.filter((e) => !e.person || (members.has(e.person) && !(e.change.kind === "outcome" && world.ended?.[e.person]))),
        state.options?.scale,
      )
    : fallbackIncidents(hour, hooks.world ? "down" : "off");
  if (r && r.session !== undefined) world = { ...world, session: r.session };
  // 世界の出来事も想定の表と変わり方の決まりの門に（T125。前は刻みの道の仮想は門の外だった）。刻みの道なので後ろに回さない
  const fit = fitOf(state, world);
  const kept = r ? screenIncidents(world, inserted, { origin: "ai", minute: Math.round(hour * 60), noDefer: true, fit }) : null;
  const passed = kept ? kept.kept : inserted;
  world = kept ? kept.world : inserted.reduce((w, e) => applyEvent(w, e, e.at), world);
  const incidents = [...t.fixed, ...passed];
  let gatedWorld = tallyGate(state.world, "world", kept ? kept.ruled.map((x) => x.rule) : []);

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
              actions: withoutMemo(state.actions.filter((a) => a.person === person)), // T93: 前の呼びからの手を全部
              fixed: [],
              virtual: true,
              fit: fitKindOf(state, world),
              ...(isNight(state) ? { night: true } : {}),
            }),
          [] as DrillTurn[],
        ),
      ),
    );
    results.forEach((x, i) => turns.push(...x.filter((u) => u.person === live[i])));
  }
  const gt = gateTurns(turns, fitOf(state, world), world);
  const rt = routeTurns(gt.turns, world, fitOf(state, world), state.homes);
  gatedWorld = tallyGate(tallyGate(gatedWorld, "persona", gt.dropped), "persona", rt.dropped);

  const tick: Tick = { step: index, hour, incidents: [...incidents, ...stopIncidents(hooks.stops?.take() ?? [], hour)], turns: rt.turns, world, finished: index >= last };
  // foldTick は前の世界に状況を当て直すので、部屋の ID は前の世界に先に写す
  const base = { ...state, world: r && r.session !== undefined ? { ...gatedWorld, session: r.session } : gatedWorld };
  return { state: foldTick(base, tick, last), tick, words: [] };
}

/** 訓練の想定の表（T125、lib/drill/fit.ts）。仮想は規模の災害、無ければ世界の出来事から。未決は null */
export function fitOf(state: Pick<DrillState, "scenario" | "options">, world: WorldState): FitProfile | null {
  return profileOf(fitKindOf(state, world));
}

/** 想定の最後の刻みの添字 */
export function lastStep(scenario: DrillScenario): number {
  return scenarioOf(scenario).hours.length - 1;
}

// ---------- 連続の時計（T90）の区切り ----------

/**
 * 進め方。clock は「30 分」「1 時間」「3 時間」「次まで」の進め（監督と本人役を下の決めで呼ぶ。next は「次まで」で進めた）。
 * silent は手の途中（lib/drill/actions.ts）の進め: 表の出来事と予定の出来事だけ当て、AI を呼ばない（理由のできた人は touched に積む）。
 * acts は「手の分」（T110）: 時計を進めず、手に使った時間（AI を動かした最後の区切り aiAt から今のケアマネの時計まで）を AI も動かして閉じる
 */
export type AdvanceOptions = { policy: "clock" | "silent"; next?: boolean; acts?: boolean };

/** 想定の表の行（配役を当てた物）と、その時刻（発災からの分） */
type TableEvent = { event: DrillIncident; minute: number };
type TableRow = { row: FixedTurn; tickHour: number; minute: number };

/** 想定の表を時刻の順に平らにする（配役 T70 を当て、出ない本人の物は外す）。仮想は空 */
function tableOf(state: DrillState): { events: TableEvent[]; rows: TableRow[] } {
  const cast = state.cast ?? {};
  const members = new Set(state.participants);
  const events: TableEvent[] = [];
  const rows: TableRow[] = [];
  for (const t of scenarioOf(state.scenario).ticks) {
    t.events.forEach((raw, i) => {
      const e = castEvent(raw, cast[eventKey(t.hour, i)]);
      if (e.person && !members.has(e.person)) return;
      const { by, who: _who, ...rest } = e;
      const at = eventHour(e, t.hour);
      events.push({ event: { ...rest, actor: by ?? "world", at, ai: false }, minute: Math.round(at * 60) });
    });
    t.turns.forEach((raw, i) => {
      const r = castTurn(raw, cast[turnKey(t.hour, i)]);
      if (!members.has(r.person)) return;
      rows.push({ row: r, tickHour: t.hour, minute: Math.round(eventHour(r, t.hour) * 60) });
    });
  }
  return { events, rows };
}

/** 状況が指す本人（本人の出来事・町の出来事の人） */
function incidentPersons(e: DrillIncident): string[] {
  const c = e.change as { persons?: unknown };
  const persons = Array.isArray(c.persons) ? c.persons.filter((x): x is string => typeof x === "string") : [];
  return [...new Set([...(e.person ? [e.person] : []), ...persons])];
}

/**
 * 連続の時計の 1 区切り（T90）。今の時刻（ケアマネの時計）から toMinute（72 × 60 まで）へ進める。順:
 * 1. 想定の表の出来事（固定の差し込みも）のうち (前の区切り, toMinute] に入る物と、時刻の来た予定の出来事（lib/drill/schedule.ts）を時刻の順に当てる
 * 2. 監督（仮想は世界）。表か予定の出来事がある・前の監督から 180 分以上・「次まで」のどれかの区切りだけ。1 訓練 20 回まで。差し込みは budget
 * 3. 本人役。この区切りで理由のある人だけ（表の行・その人を指す状況・手の返事・時計の半分と切れ・12 時間の巡回）。1 区切り 6 人まで、
 *    残りは touched に残して次の進めで呼ぶ。表の行は本人役の骨（呼ばない人の行は次に呼ぶまで残る。AI を使わない訓練は固定の安否）
 * 4. 1 訓練の上限（clock.ts の DRILL_CALL_SOFT・DRILL_CALL_CAP）。上限に達した訓練は AI を呼ばず、区切りに「訓練上限」の印
 * silent（手の途中）は 1 だけで、当てる物が無ければ null（区切りを作らない）。終わり（72 時間）に着いた区切りは finished
 */
export async function advance(
  state: DrillState,
  toMinute: number,
  hooks: StepHooks = {},
  opts: AdvanceOptions = { policy: "clock" },
): Promise<{ state: DrillState; tick: Tick; words: ReplyWords[] } | null> {
  if (drillEnded(state)) throw new DrillEnded();
  const first = state.step < 0;
  const to = Math.min(Math.round(toMinute), DRILL_END_MINUTE);
  // 手の分（T110）は今の時計まで（AI を動かした最後の区切りより後のときだけ）。ほかは今の時計より後
  const closing = opts.acts === true && !first && to === Math.round(state.minute) && to > aiAtOf(state);
  // 72 時間の区切り（T123）。手と通話の往復の所要で時計が先に 72 時間に着いても、どの進め方でも 72 時間の区切りを作って終わる
  // （評価の 2 回目で、時計が 72 時間・区切りがその手前のまま、進める・手が全部「進める時刻が違う」で断られ終わらなかった）
  const ending = !first && to === DRILL_END_MINUTE && lastCutOf(state) < DRILL_END_MINUTE;
  if (first ? to !== 0 : to <= state.minute && !closing && !ending) throw new RangeError(`進める時刻が違う: ${toMinute}`);
  const silent = opts.policy === "silent";
  const from = lastCutOf(state);
  const index = state.step + 1;
  const hour = to / 60;
  const virtual = isVirtual(state.scenario);
  const members = new Set(state.participants);
  const night = isNight(state) ? { night: true } : {};
  if (!silent) hooks.stops?.take();

  // 1. 表の出来事と予定の出来事（区切りの中の物を時刻の順に。同じ時刻は表が先）
  const table = tableOf(state);
  // 仮想の規模（T104）の出来事は最初の区切りの先頭に（規模の無い訓練は空）
  const fixed = [...openingIncidents(state, first), ...table.events.filter((x) => x.minute > from && x.minute <= to).map((x) => x.event)];
  const fired = fireScheduled(state.world, to);
  const due = fired.incidents.filter((e) => !e.person || members.has(e.person));
  const sorted = [...fixed, ...due].map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);
  // 世界の帳簿（予定の取り出し・本人役の呼んだ時刻・理由・数）。foldTick はここに状況を当て直す
  let book: WorldState = fired.world;
  // 変わり方の決まり（T121、lib/drill/state-rules.ts）。表の出来事は「もう起きている」の門だけ、予定の出来事は時刻が来たときの門。
  // 外した物は区切りに残さない（保存した区切りから作り直しても同じ世界）
  const dueSet = new Set<DrillIncident>(due);
  // 表の行がこのあといる所を決める人も（T123）
  const ahead = tableAheadOf(table.events, to, table.rows);
  const screened = screenIncidents(settleWorld(book, to), sorted, { origin: "table", originOf: (e) => (dueSet.has(e) ? "scheduled" : "table") });
  const happened = screened.kept;
  let world = screened.world;
  const counts = { ...ZERO_COUNTS, ...(book.counts ?? {}) };
  const lastCalled = { ...(book.lastCalled ?? {}) };
  const touched = { ...(book.touched ?? {}) };
  const capped = capReached(counts);

  // 表の行。本人ごとに、前に呼んだ時刻（無ければ始め）より後の物（呼ばなかった人の行は残る）
  const pending = (p: string) =>
    table.rows.filter((r) => r.row.person === p && r.minute > (lastCalled[p] ?? -1) && r.minute <= to).map((r) => ({ ...r.row, at: eventHour(r.row, r.tickHour) }));
  const turns: DrillTurn[] = [];
  const applyFixed = (p: string) => {
    const own = pending(p);
    if (own.length === 0) return;
    turns.push(...own.map((f) => fixedToTurn(f, hour)));
    lastCalled[p] = to;
  };

  if (silent) {
    // 2・3 をしない。本人役を使う訓練は理由を持ち越し、行は次に呼ぶまで残す。本人役を使わない訓練は表の固定の安否を当てる
    for (const e of happened) for (const p of incidentPersons(e)) if (members.has(p)) touched[p] = Math.min(touched[p] ?? to, to);
    if (!hooks.persona) for (const p of state.participants) applyFixed(p);
    if (happened.length === 0 && turns.length === 0 && to < DRILL_END_MINUTE) return null;
    book = { ...book, touched, lastCalled };
    // 表の固定の安否にも連絡の経路を付ける（T125。固定の行は外さない）
    const tick: Tick = { step: index, hour, incidents: happened, turns: routeTurns(turns, world, fitOf(state, world), state.homes).turns, world, finished: to >= DRILL_END_MINUTE };
    return { state: foldTick({ ...state, world: book }, tick, lastStep(state.scenario)), tick, words: [] };
  }

  // 2. 監督（仮想は世界）
  const soft = softReached(counts);
  const gap = state.directorAt === undefined ? Infinity : to - state.directorAt;
  // 固定の筋の 72 時間の区切りは監督を呼ばない（T123。10 分版の最後の刻みと同じ。仮想の世界は結末を決めるので呼ぶ）
  const finalCut = to >= DRILL_END_MINUTE && !virtual;
  const wantDirector =
    !capped &&
    !finalCut &&
    counts.director < DIRECTOR_DRILL_MAX &&
    (happened.length > 0 || (!soft && (gap >= DIRECTOR_GAP_MINUTES || opts.next === true)));
  const budget = Math.min(budgetOf(from, to), DIRECTOR_MAX);
  const actions = withoutMemo(state.actions);
  const directorInput: DirectorInput = {
    scenario: state.scenario,
    step: index,
    hour,
    world,
    incidents: happened,
    participants: state.participants,
    people: state.people,
    actions,
    ...night,
    since: Math.max(0, from),
    budget,
    ...worldExtras(state),
    // 訓練ごとの起きやすさの種（T121、lib/drill/time-odds.ts）。開始の時刻と想定から（再生で同じ）
    seed: drillSeed(state),
  };
  let inserted: DrillIncident[] = [];
  let directorAt = state.directorAt;
  if (wantDirector && virtual) {
    if (hooks.world) {
      const raw = hooks.outcome
        ? await safely(() => hooks.outcome!({ world, actions: state.actions, participants: state.participants, minute: to }), NO_HINTS)
        : NO_HINTS;
      const keep = (p: string) => members.has(p) && !world.ended?.[p];
      const hints: OutcomeHints = { reached: raw.reached.filter((o) => keep(o.person)), clocks: raw.clocks.filter((c) => keep(c.person)) };
      const r = await safely(() => hooks.world!({ ...directorInput, hints, session: world.session ?? null, minute: to }), null);
      counts.director += 1;
      directorAt = to;
      // 余震は規模まで（T104）
      inserted = r
        ? fitToScale(
            r.incidents.filter((e) => !e.person || (members.has(e.person) && !(e.change.kind === "outcome" && world.ended?.[e.person]))),
            state.options?.scale,
          )
        : fallbackIncidents(hour, "down");
      if (r && r.session !== undefined) {
        world = { ...world, session: r.session };
        book = { ...book, session: r.session };
      }
    } else {
      inserted = fallbackIncidents(hour, "off");
    }
  }
  // 固定の筋（大雨・地震）の監督は本人役と並べて呼ぶ（T121。進める 1 回の待ちが「監督 ＋ 本人役」から長い方だけに）。
  // 本人役はこの区切りの表と予定の出来事を当てた世界で答え、監督の差し込みは区切りの終わりに当てる。差し込みの指す人は
  // touched に積み、次の区切りで呼ぶ（仮想の世界は結末を決めるので、本人役より先のまま）
  let directorP: Promise<DrillIncident[]> | null = null;
  if (!virtual && wantDirector && hooks.director) {
    counts.director += 1;
    directorAt = to;
    // 差し込みの数（種類ごと）を budget で切る。行（部品）で切ると、2 行になる種類（携帯不可と回復見込・土砂警戒と道）の 2 行目が落ちる（T121）
    directorP = safely(() => hooks.director!(directorInput), [] as DirectorEvent[]).then((out) =>
      directorIncidents(Array.isArray(out) ? out : (out?.events ?? []), members, hour, budget),
    );
  }
  // 監督・世界の出来事も変わり方の決まりで見る（T121）。表がこのあと変える状態を先に変えない・一度きり・変わるのに要る時間
  const kept = screenIncidents(world, inserted, { origin: "ai", minute: to, ahead, fit: fitOf(state, world) });
  inserted = kept.kept;
  world = kept.world;
  // 門が捨てた数（T125。想定に合わない物・変わり方の決まり）を帳簿に
  book = tallyGate(book, virtual ? "world" : "director", kept.ruled.map((r) => r.rule));
  let incidents = [...happened, ...inserted];

  // 3. 本人役
  const live = state.participants.filter((p) => !world.ended?.[p]);
  if (!hooks.persona || capped) {
    // AI を使わない（鍵なし・上限）: 表の行は固定の安否
    for (const p of live) applyFixed(p);
  } else {
    const reasons = new Map<string, Set<PersonaReason>>();
    const give = (p: string, r: PersonaReason) => {
      if (!live.includes(p)) return;
      const set = reasons.get(p) ?? new Set<PersonaReason>();
      set.add(r);
      reasons.set(p, set);
    };
    const since = (p: string) => lastCalled[p] ?? -1;
    for (const p of live) if (pending(p).length > 0) give(p, "table");
    // 手の返事は、手の終わりに本人に届いた手で、本人がまだ話していない物だけ（T121、clock.ts の actionReaches。行政報告・記録・
    // 電話で話した・訪問で会った手では呼ばない。着いたら届く手は下の到着で呼ぶ）
    for (const a of state.actions) {
      if (a.person && a.result && a.result.atMinute > since(a.person) && a.result.atMinute <= to && actionReaches(a)) give(a.person, "action");
    }
    for (const a of [...(world.arrivals ?? []), ...(world.dispatched ?? [])]) {
      // 着いた人だけ（T123。家の前の道が通れず待っている人は、着いた区切りで）
      if (a.arrived && a.arrive > since(a.person) && a.arrive <= to) give(a.person, "action");
    }
    for (const e of incidents) for (const p of incidentPersons(e)) give(p, "incident");
    for (const p of Object.keys(touched)) if (!reasons.has(p)) give(p, "incident");
    const marks = hooks.clock?.marks ? await safely(() => hooks.clock!.marks!({ ...state, world }), [] as ClockMark[]) : [];
    for (const p of crossedClocks(marks, Math.max(0, from), to)) give(p, "clock");
    const press = hooks.clock?.pressable ? await safely(() => hooks.clock!.pressable!(), null) : null;
    const canPress = (p: string) => press === null || press.has(p);
    if (!soft) {
      // 巡回は、前に呼んでから身の回りが変わった人だけ（T121。変化の無い人を呼ばない。時計は理由 clock で呼ぶ）。
      // 何も変わらない人も ROUND_QUIET_MINUTES（24 時間）たてば呼ぶ（静かになりすぎないため）
      const due = (p: string) => {
        const gap = to - (lastCalled[p] ?? 0);
        return gap >= ROUND_QUIET_MINUTES || (gap >= ROUND_MINUTES && changedSince(world, p, lastCalled[p] ?? 0));
      };
      live
        .filter((p) => !reasons.has(p) && canPress(p) && due(p))
        .sort((a, b) => (lastCalled[a] ?? 0) - (lastCalled[b] ?? 0))
        .slice(0, ROUND_PER_CUT)
        .forEach((p) => give(p, "round"));
    }
    // 押せる人がいなく表の行も無い人は、本人役が AI を使わずに「連絡なし」を返すので呼ばない（数にも入れない）
    const rank = (p: string) => Math.min(...[...(reasons.get(p) ?? [])].map((r) => REASON_ORDER.indexOf(r)));
    const order = live.filter((p) => reasons.has(p) && (canPress(p) || pending(p).length > 0));
    for (const p of reasons.keys()) if (!order.includes(p)) delete touched[p];
    // 短い区切り（1 時間未満）は、急がない理由（状況・時計・巡回）だけの人を持ち越してまとめる（T121。理由ができてから
    // GATHER_MINUTES たてば呼ぶ）。表の行と手の返事の人はその区切りで呼ぶ
    if (to - Math.max(0, from) < GATHER_MINUTES) {
      for (const p of [...order]) {
        const quiet = [...reasons.get(p)!].every((r) => QUIET_REASONS.includes(r));
        if (quiet && to - (touched[p] ?? to) < GATHER_MINUTES) {
          touched[p] = Math.min(touched[p] ?? to, to);
          order.splice(order.indexOf(p), 1);
        }
      }
    }
    order.sort((a, b) => rank(a) - rank(b) || (touched[a] ?? to) - (touched[b] ?? to) || live.indexOf(a) - live.indexOf(b));
    const room = Math.max(0, Math.min(PERSONA_PER_CUT, DRILL_CALL_CAP - totalCalls(counts)));
    const called = order.slice(0, room);
    for (const p of order.slice(room)) touched[p] = Math.min(touched[p] ?? to, to);
    const inputOf = (person: string): PersonaInput => ({
      step: index,
      hour,
      person,
      world,
      incidents,
      state: state.people[person] ?? null,
      lastAction: actionWithoutMemo([...state.actions].reverse().find((a) => a.person === person) ?? null),
      actions: withoutMemo(state.actions.filter((a) => a.person === person)), // T93: 前の呼びからの手を全部
      fixed: pending(person),
      ...(virtual ? { virtual: true } : {}),
      ...night,
      since: Math.max(0, lastCalled[person] ?? 0),
      reasons: REASON_ORDER.filter((r) => reasons.get(person)!.has(r)),
      toMinute: to,
      fit: fitKindOf(state, world),
    });
    // まとめて呼ぶ口があれば PERSONA_BATCH_MAX 人ずつ 1 回（T121）。数えるのは呼び出しの数
    const groups: string[][] = hooks.personas ? chunks(called, PERSONA_BATCH_MAX) : called.map((p) => [p]);
    const results = await Promise.all(
      groups.map((g) =>
        hooks.personas
          ? safely(() => hooks.personas!(g.map(inputOf)), g.map(() => [] as DrillTurn[]))
          : safely(() => hooks.persona!(inputOf(g[0])), [] as DrillTurn[]).then((r) => [r]),
      ),
    );
    results.forEach((r, i) => groups[i].forEach((person, j) => turns.push(...(r[j] ?? []).filter((t) => t.person === person))));
    for (const p of called) {
      lastCalled[p] = to;
      delete touched[p];
    }
    counts.persona += groups.length;
  }

  // 監督の差し込み（並べて呼んだ物）を区切りの終わりに当てる。指す人は次の区切りで本人役を呼ぶ（T121）
  if (directorP) {
    const late = screenIncidents(world, await directorP, { origin: "ai", minute: to, ahead, fit: fitOf(state, world) });
    world = late.world;
    book = tallyGate(book, "director", late.ruled.map((r) => r.rule));
    incidents = [...incidents, ...late.kept];
    if (hooks.persona && !capped) {
      for (const e of late.kept) for (const p of incidentPersons(e)) if (members.has(p) && !world.ended?.[p]) touched[p] = Math.min(touched[p] ?? to, to);
    }
  }

  // 4. 上限の印（上限に達したあとの区切り。帯の理由「訓練上限」）と、1 日の上限で止まった役の印
  const stop: DrillIncident[] = capped
    ? [{ actor: "world", at: hour, change: { kind: "ai_stop", stopped: virtual ? ["persona", "world"] : ["persona", "director"] }, text: CLOCK_LABELS.cap, reason: CAP_REASON, ai: false }]
    : [];
  // 本人役の言葉も想定の門に（T125）
  const gt = gateTurns(turns, fitOf(state, world), world);
  const rt = routeTurns(gt.turns, world, fitOf(state, world), state.homes);
  book = tallyGate(tallyGate({ ...book, counts, lastCalled, touched }, "persona", gt.dropped), "persona", rt.dropped);
  const tick: Tick = {
    step: index,
    hour,
    incidents: [...incidents, ...stop, ...stopIncidents(hooks.stops?.take() ?? [], hour)],
    turns: rt.turns,
    world,
    finished: to >= DRILL_END_MINUTE,
  };
  const base: DrillState = { ...state, world: book, ...(directorAt !== undefined ? { directorAt } : {}), aiAt: to };
  return { state: foldTick(base, tick, lastStep(state.scenario)), tick, words: [] };
}
