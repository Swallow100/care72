// 訓練の状態と 1 刻みの進め方（docs/tasks/T17.md）。D1 を使わない所。保存は lib/drill/db.ts。
//
// 状態: 今の刻み・世界の状態（被害状況）・本人ごとの様子と安否・ケアマネの手の履歴。
// step() は 1 刻みだけ進める（1 要求で全刻みを回さない。ブラウザから 1 刻みずつ呼ぶ）。
// 1 刻みの順: 想定の表の出来事を世界に当てる → 監督（T19）の差し込み → 本人ごとの 1 刻み（ペルソナ T18。無ければ表の固定の安否）。
//
// 時刻: 発災（想定の 0 時間）は訓練を始めた時刻（drills.started_at）。想定の h 時間は started_at + h 時間（simAt）。
// 安否の時刻もこの時計で持ち、ルールの表（lib/triage）には drillSituation の状況で当てる。事業所の災害モード（disaster_state）は
// 読まない・変えない（本番の大雨の最中でも、訓練は訓練の状況で動く）。
// 色と順位はここで決めない（lib/triage だけ）。

import type { DrillAction, DrillScenario, DrillStatus, Ledger, SignalColor, WhereNow } from "../db/types.ts";
import type { DisasterSituation } from "../disaster/state.ts";
import {
  applyEvent,
  EMPTY_WORLD,
  eventHour,
  scenarioOf,
  type FixedTurn,
  type OutageArea,
  type Scenario,
  type WorldEvent,
  type WorldState,
} from "./scenarios.ts";

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
};

/** 状況（世界の出来事）1 つ。表の固定の物は world、監督（T19）の差し込みは director */
export type DrillIncident = WorldEvent & {
  actor: "world" | "director";
  at: number;
  /** Claude（監督）が作った物。画面で AI の印 */
  ai: boolean;
  /** 監督の判断の理由（T19。採点 T22 が読む）。表の物は無し */
  reason?: string;
};

/** 本人ごとの今の様子（いちばん新しい 1 刻みの安否） */
export type PersonState = {
  color: SignalColor;
  source: FixedTurn["source"];
  whereNow: WhereNow | null;
  at: number;
  saying: string | null;
  doing: string | null;
};

/** ケアマネの手 1 つ（T20 が足す。この作業では空） */
export type ActionRecord = {
  kind: DrillAction;
  /** 相手の本人（台帳の id） */
  person: string | null;
  /** 電話の相手（連絡先の id）など */
  target: string | null;
  /** 打った時刻（発災からの時間） */
  at: number;
  step: number;
};

export type DrillState = {
  scenario: DrillScenario;
  /** 発災（想定の 0 時間）。訓練を始めた時刻 */
  startedAt: string;
  /** 今の刻み（想定の hours の添字）。始める前は -1 */
  step: number;
  /** 今の時刻（発災からの時間） */
  hour: number;
  status: DrillStatus;
  /** 訓練に出る本人（始めたときの担当一覧。台帳の id） */
  participants: string[];
  world: WorldState;
  people: Record<string, PersonState>;
  actions: ActionRecord[];
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
};

/** 本人 1 人の 1 刻み。空の配列は「連絡なし」。投げたら連絡なしとして進む */
export type PersonaHook = (input: PersonaInput) => Promise<DrillTurn[]>;

/** 監督（T19）に渡す物。表の状況を当てたあとの世界 */
export type DirectorInput = {
  step: number;
  hour: number;
  world: WorldState;
  /** この刻みの表の状況 */
  incidents: ReadonlyArray<DrillIncident>;
  participants: ReadonlyArray<string>;
  people: Readonly<Record<string, PersonState>>;
  actions: ReadonlyArray<ActionRecord>;
};

/** 差し込む状況（0〜2 個）。投げたら差し込みなしで進む */
export type DirectorHook = (input: DirectorInput) => Promise<DrillIncident[]>;

export type StepHooks = { persona?: PersonaHook; director?: DirectorHook };

// ---------- 時刻と状況 ----------

/** 想定の h 時間の時刻（ISO 8601） */
export function simAt(startedAt: string, hour: number): string {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) throw new Error(`時刻の形が違う: ${startedAt}`);
  return new Date(t + hour * HOUR_MS).toISOString();
}

/** 停電の地区の町名。ハザードの地区なら、そのハザード（浸水の深さ）を持つ本人の町名。全域なら null */
export function outageTownsOf(area: OutageArea, ledgers: ReadonlyArray<Pick<Ledger, "basic" | "evacuation">>): string[] | null {
  if (area.scope === "office") return null;
  const towns = new Set<string>();
  for (const l of ledgers) {
    const hit = l.evacuation.hazards.some((h) => h.kind === area.hazard && (h.depthM ?? 0) >= area.minDepthM);
    const town = l.basic.address?.town?.trim();
    if (hit && town) towns.add(town);
  }
  return [...towns];
}

/**
 * ルールの表（lib/triage）に渡す訓練の状況。今は想定の今の時刻、発災は訓練を始めた時刻、停電は世界の停電の始まり。
 * 停電の復旧はルールの表の入力に持たない（Situation に終わりが無い。止まった機器の時計を戻さない）。被害状況と棒には出す
 */
export function drillSituation(
  state: Pick<DrillState, "startedAt" | "hour" | "world">,
  ledgers: ReadonlyArray<Pick<Ledger, "basic" | "evacuation">>,
): DisasterSituation {
  const o = state.world.outage;
  return {
    now: simAt(state.startedAt, state.hour),
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
  return { color: t.color, source: t.source, whereNow: t.whereNow, at: t.at, saying: t.saying, doing: t.doing };
}

/** 状況を世界に当て、本人の様子を安否で進める（保存した刻みから状態を作り直すときも同じ所を通す） */
export function foldTick(
  state: DrillState,
  tick: Pick<Tick, "step" | "hour" | "incidents" | "turns">,
  last: number,
): DrillState {
  const world = tick.incidents.reduce((w, e) => applyEvent(w, e, e.at), state.world);
  const people = { ...state.people };
  for (const t of [...tick.turns].sort((a, b) => a.at - b.at)) people[t.person] = personStateOf(t);
  return {
    ...state,
    step: tick.step,
    hour: tick.hour,
    world,
    people,
    status: tick.step >= last ? "finished" : state.status,
  };
}

/** 始める前の状態（まだどの刻みも当てていない） */
export function initialState(scenario: DrillScenario, participants: ReadonlyArray<string>, startedAt: string): DrillState {
  return {
    scenario,
    startedAt,
    step: -1,
    hour: 0,
    status: "running",
    participants: [...participants],
    world: EMPTY_WORLD,
    people: {},
    actions: [],
  };
}

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
 * 返す state は刻みのあと。tick は保存する物
 */
export async function step(state: DrillState, hooks: StepHooks = {}): Promise<{ state: DrillState; tick: Tick }> {
  const scenario: Scenario = scenarioOf(state.scenario);
  const last = scenario.hours.length - 1;
  if (state.status !== "running" || state.step >= last) throw new DrillEnded();
  const index = state.step + 1;
  const def = scenario.ticks[index];
  const hour = def.hour;
  const members = new Set(state.participants);

  // 表の状況（出ない本人の物は外す）
  const fixed: DrillIncident[] = def.events
    .filter((e) => !e.person || members.has(e.person))
    .map((e) => ({ ...e, actor: "world", at: eventHour(e, hour), ai: false }));
  let world = fixed.reduce((w, e) => applyEvent(w, e, e.at), state.world);

  // 監督の差し込み（T19）。無ければ・失敗したら差し込みなし
  const inserted = hooks.director
    ? (
        await safely(
          () =>
            hooks.director!({
              step: index,
              hour,
              world,
              incidents: fixed,
              participants: state.participants,
              people: state.people,
              actions: state.actions,
            }),
          [] as DrillIncident[],
        )
      )
        .slice(0, 2)
        .filter((e) => !e.person || members.has(e.person))
        .map((e) => ({ ...e, actor: "director" as const }))
    : [];
  world = inserted.reduce((w, e) => applyEvent(w, e, e.at), world);
  const incidents = [...fixed, ...inserted];

  // 本人ごとの 1 刻み。ペルソナ（T18）が無ければ表の固定の安否。ペルソナが投げたら連絡なし
  const turns: DrillTurn[] = [];
  const rows = state.participants.map((person) => ({ person, rows: def.turns.filter((t) => t.person === person) }));
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
              lastAction: [...state.actions].reverse().find((a) => a.person === person) ?? null,
              fixed: own,
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
  return { state: foldTick(state, tick, last), tick };
}

/** 想定の最後の刻みの添字 */
export function lastStep(scenario: DrillScenario): number {
  return scenarioOf(scenario).hours.length - 1;
}
