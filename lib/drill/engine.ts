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

import type { DrillScenario, DrillStatus, Ledger } from "../db/types.ts";
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
import type { ActionRecord } from "./action-types.ts";
import {
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
import type { DrillTurn, PersonaHook, PersonState } from "./persona-types.ts";

export { isStaffCount, STAFF_MAX } from "./options.ts";
import { fallbackIncidents } from "./world-apply.ts";

const HOUR_MS = 3_600_000;

// 型は 3 つのファイルに分けた（T90 の準備）。前からの import（"./engine.ts"）を壊さないよう、同じ名前をここからも出す:
// 手（T91）は action-types.ts、状況と監督（T92）は incident-types.ts、本人役（T93）は persona-types.ts
export type { ActionBefore, ActionRecord, ActionResult, ActionStatus, HeardSignal } from "./action-types.ts";
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
export type { DrillTurn, PersonaHook, PersonaInput, PersonaReason, PersonState } from "./persona-types.ts";

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
export type StepHooks = { persona?: PersonaHook; director?: DirectorHook; world?: WorldHook; outcome?: OutcomeHook; stops?: StopLog };

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
 * 手の記録からケアマネの書いた文を落とす（T59 のメモ、T90 の準備で自由に書く手〔T91〕の文 text と読み替えの理由 reason）。
 * 講評・監督・世界・本人役（Claude）の入力に渡す前に必ず通す。どれも無い手は同じ物を返す。
 * これらを Claude に渡したくなったら、仮名化の門（lib/pseudonym → askJson）を通す別の作業にする
 */
export function withoutMemo<T extends ActionRecord>(actions: ReadonlyArray<T>): T[] {
  return actions.map((a) => {
    if (a.memo === undefined && a.text === undefined && a.reason === undefined) return a;
    const { memo: _memo, text: _text, reason: _reason, ...rest } = a;
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

  const tick: Tick = { step: index, hour, incidents: [...incidents, ...stopIncidents(hooks.stops?.take() ?? [], hour)], turns, world, finished: index >= last };
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

  const tick: Tick = { step: index, hour, incidents: [...incidents, ...stopIncidents(hooks.stops?.take() ?? [], hour)], turns, world, finished: index >= last };
  // foldTick は前の世界に状況を当て直すので、部屋の ID は前の世界に先に写す
  const base = r && r.session !== undefined ? { ...state, world: { ...state.world, session: r.session } } : state;
  return { state: foldTick(base, tick, last), tick, words: [] };
}

/** 想定の最後の刻みの添字 */
export function lastStep(scenario: DrillScenario): number {
  return scenarioOf(scenario).hours.length - 1;
}
