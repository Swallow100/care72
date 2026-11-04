// 訓練の保存（docs/tasks/T17.md）。表は drills・drill_events・signals（drill_id 付き）。D1 と範囲を引数で受け取る（テストで node:sqlite）。
//
// - 1 刻みごとに 1 つの batch（取引）で保存する: drills の刻みを進め（読んだ刻みのときだけ）、状況と本人の 1 刻みを drill_events に、
//   安否を signals に drill_id 付きで足す。途中から再開できる（drills.world に今の状態、drill_events から刻みごとに作り直せる）
// - 重なった「進める」（早送りと二度押し）は片方だけ通る。読んだ刻みと違えば競合。同じ刻みを 2 回書こうとしても id が重なり取引ごと戻る
// - 本人の経過（timeline_entries）には何も書かない。本番の読み方（drill_id IS NULL）に混ざらない
// - 進行中はケアマネごとに 1 つ（T70。開始者か担当一覧の人で見る。同じ事業所の 2 人が別々に訓練できる。審査員は山本の担当一覧なので 1 つを共有）。
//   進行中があれば開始を断り、再開か中断へ。進行中のまま 24 時間たった訓練は、開始・一覧を読むときに中断にする（expireStaleDrills）
// - 範囲はケアマネの役（審査員のケアマネの役を含む）と事業所。参加する本人は始めたときの担当一覧の人

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import {
  CONTACT_KINDS,
  DRILL_ACTIONS,
  DRILL_SCENARIOS,
  DRILL_STATUSES,
  SIGNAL_COLORS,
  WHERE_NOW,
  type ContactRow,
  type DrillAction,
  type DrillEventRow,
  type DrillRow,
  type DrillScenario,
  type DrillStatus,
} from "../db/types.ts";
import { callTargetText } from "../list/calls.ts";
import { isSourceId } from "../sources/index.ts";
import {
  act,
  applyResult,
  needsPerson,
  needsTarget,
  pushAction,
  targetKinds,
  type ActionHooks,
  type ActTarget,
} from "./actions.ts";
import {
  advance,
  cleanOptions,
  drillEnded,
  foldTick,
  initialState,
  isClock,
  isStaffCount,
  lastStep,
  simAt,
  step,
  type ActionRecord,
  type ActionResult,
  type DrillIncident,
  type DrillOptions,
  type DrillState,
  type DrillTurn,
  type HeardSignal,
  type PersonState,
  type StepHooks,
  type Tick,
} from "./engine.ts";
import { callIndexes } from "./calls.ts";
import { T70_LABELS } from "./labels.ts";
import { EMPTY_WORLD, isInjectKind, isVirtual, SCENARIO_ORDER, scenarioOf, type WorldState } from "./scenarios.ts";
import { isDrillScale, pickScale, seededRand } from "./scale.ts";
import { homeTowns } from "./self.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { castScenario, mayBeCalled, needsCast, type Cast } from "./cast.ts";
import { castFactsMap } from "./cast-facts.ts";
import { loadPersonaSources } from "./persona.ts";
import { FREE_TEXT_MAX, isCatalogAction } from "./action-catalog.ts";
import { dialogueFields } from "./dialogue.ts";
import { DRILL_END_MINUTE, nextEventMinute, type ClockMark, type ClockTo } from "./clock.ts";

/** 訓練を開ける範囲。ケアマネの役だけ（審査員のケアマネの役も）。事業所と担当一覧の持ち主 */
export type DrillScope = { officeId: string; careManagerId: string; accountId: string | null };

export function drillScope(p: Principal | null): DrillScope | null {
  if (!p || p.role !== "care_manager" || !p.office || !p.caseloadOf) return null;
  return { officeId: p.office.id, careManagerId: p.caseloadOf, accountId: p.accountId };
}

export function isDrillScenario(v: unknown): v is DrillScenario {
  return typeof v === "string" && (DRILL_SCENARIOS as readonly string[]).includes(v);
}

/**
 * D1 の行の想定。仮想（T50）は scenario の CHECK を建て直さず mode に持つ（migrations/0006）。
 * 書くときの scenario の列は種の heavy_rain（dbScenario）、読むときは mode から virtual に戻す
 */
export function rowScenario<T extends { scenario: string; mode?: string | null }>(row: T): T & { scenario: DrillScenario } {
  return { ...row, scenario: (row.mode === "virtual" ? "virtual" : row.scenario) as DrillScenario };
}

/** drills.scenario の列に書く値と mode（仮想は heavy_rain と virtual） */
export function dbScenario(s: DrillScenario): { scenario: Exclude<DrillScenario, "virtual">; mode: "virtual" | null } {
  return s === "virtual" ? { scenario: "heavy_rain", mode: "virtual" } : { scenario: s, mode: null };
}

// ---------- drills.world の JSON ----------

/** drills.world に置く今の状態（世界・参加者・本人の様子・手の履歴・ケアマネの時計）。刻みと状態は表の列 */
type StoredWorld = {
  v: 1;
  participants: string[];
  world: WorldState;
  people: Record<string, PersonState>;
  actions: ActionRecord[];
  /** ケアマネの時計（発災からの分、T20）。無ければ刻みの時刻 */
  minute?: number;
  /** 開始の前に選んだ物（T59。職員・夜間発災）。選ばなかった訓練には無い */
  options?: DrillOptions;
  /** 取り消した手の数（T59）。無ければ 0 */
  undone?: number;
  /**
   * 最後の手の前の状態の写し（T59 の取消）。刻みを越えなかった手を打ったときだけ置き、次の手で上書き、進める・刻みを越える手で消える。
   * act は取り消せる手の番号
   */
  undo?: UndoSnapshot;
  /** 想定の表の配役（T70、lib/drill/cast.ts）。代わりの人に当てた行だけ。無ければ鍵ごと無い（デモ事業所は前と同じ JSON） */
  cast?: Cast;
  /** 連続の時計の訓練（T90）の区切りの時刻（発災からの分。i 番目は step i の終わり）。clock の無い訓練は鍵ごと無い */
  cuts?: number[];
  /** 連続の時計の訓練で監督（仮想は世界）を最後に呼んだ区切りの時刻（発災からの分） */
  directorAt?: number;
};

/** 手の前の状態の写し（取消で戻す物） */
export type UndoSnapshot = Pick<DrillState, "minute" | "hour" | "step" | "world" | "people" | "actions"> & { act: string };

function storeWorld(s: DrillState, undo?: UndoSnapshot): string {
  // 選ばなかった物は書かない（何も選ばなければ前と同じ JSON。world = ?9 の門の文字も同じ）
  const body: StoredWorld = {
    v: 1,
    participants: s.participants,
    world: s.world,
    people: s.people,
    actions: s.actions,
    minute: s.minute,
    ...(s.options && Object.keys(s.options).length > 0 ? { options: s.options } : {}),
    ...(s.undone ? { undone: s.undone } : {}),
    ...(undo ? { undo } : {}),
    ...(s.cast && Object.keys(s.cast).length > 0 ? { cast: s.cast } : {}),
    ...(s.cuts ? { cuts: s.cuts } : {}),
    ...(s.directorAt !== undefined ? { directorAt: s.directorAt } : {}),
  };
  return JSON.stringify(body);
}

function parseStoredWorld(text: string): StoredWorld {
  const raw = JSON.parse(text) as Partial<StoredWorld>;
  const options = cleanOptions(raw.options);
  const u = raw.undo;
  const cast = castOf(raw.cast);
  return {
    v: 1,
    participants: Array.isArray(raw.participants) ? raw.participants.filter((x): x is string => typeof x === "string") : [],
    world: { ...EMPTY_WORLD, ...(raw.world ?? {}) },
    people: raw.people ?? {},
    actions: Array.isArray(raw.actions) ? raw.actions : [],
    ...(typeof raw.minute === "number" ? { minute: raw.minute } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(isNum(raw.undone) && raw.undone > 0 ? { undone: raw.undone } : {}),
    ...(u && typeof u === "object" && typeof u.act === "string" && Array.isArray(u.actions) && isNum(u.minute) && isNum(u.step) && isNum(u.hour)
      ? { undo: { ...u, world: { ...EMPTY_WORLD, ...(u.world ?? {}) }, people: u.people ?? {} } }
      : {}),
    ...(cast ? { cast } : {}),
    ...(Array.isArray(raw.cuts) ? { cuts: raw.cuts.filter(isNum) } : {}),
    ...(isNum(raw.directorAt) ? { directorAt: raw.directorAt } : {}),
  };
}

/** 配役の JSON（行の鍵 → 人の id の文字）。形が違う・空なら無し */
function castOf(v: unknown): Cast | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Cast = {};
  for (const [k, p] of Object.entries(v)) if (typeof p === "string" && p) out[k] = p;
  return Object.keys(out).length > 0 ? out : null;
}

/** 選んだ物と取消の数と配役（状態に足す。無ければ鍵ごと無い） */
function extrasOf(w: Pick<StoredWorld, "options" | "undone" | "cast">): Pick<DrillState, "options" | "undone" | "cast"> {
  return { ...(w.options ? { options: w.options } : {}), ...(w.undone ? { undone: w.undone } : {}), ...(w.cast ? { cast: w.cast } : {}) };
}

/** 表の行から今の状態（drills.world の写しから。再開に使う） */
export function stateOfRow(row: DrillRow): DrillState {
  const w = parseStoredWorld(row.world);
  return {
    scenario: row.scenario,
    startedAt: row.started_at,
    step: row.step,
    hour: row.sim_hour,
    minute: w.minute ?? row.sim_hour * 60,
    status: row.status,
    participants: w.participants,
    world: w.world,
    people: w.people,
    actions: w.actions,
    ...extrasOf(w),
    ...(w.cuts ? { cuts: w.cuts } : {}),
    ...(w.directorAt !== undefined ? { directorAt: w.directorAt } : {}),
  };
}

/**
 * 連続の時計の訓練（T90）か、と区切りの時刻（時間）・この訓練の AI の呼び出しの数（drills.world の写しから）。
 * clock の無い訓練は clock false・cuts 空
 */
export function clockOfRow(row: Pick<DrillRow, "world">): { clock: boolean; hours: number[]; counts: WorldState["counts"] | null } {
  const w = parseStoredWorld(row.world);
  if (w.options?.clock !== true) return { clock: false, hours: [], counts: null };
  return { clock: true, hours: (w.cuts ?? []).map((m) => m / 60), counts: w.world.counts ?? null };
}

/**
 * 取り消せる手の番号（T59）。進行中で、最後の手が刻みを越えず、その手の前の写しがあるときだけ。無ければ null（取消不可）
 */
export function undoableAct(row: Pick<DrillRow, "world" | "status">): string | null {
  if (row.status !== "running") return null;
  const w = parseStoredWorld(row.world);
  const last = w.actions.at(-1);
  if (!last || !w.undo || w.undo.act !== last.id) return null;
  if (!last.result || last.result.crossed.length > 0) return null;
  return last.id;
}

// ---------- drill_events の形 ----------

type IncidentPayload = Omit<DrillIncident, "actor" | "person">;
type TurnPayload = Omit<DrillTurn, "person"> & { signal: string };

const eventId = (drillId: string, stepIndex: number, i: number) => `${drillId}-${stepIndex}-e${i}`;
const signalId = (drillId: string, stepIndex: number, i: number) => `${drillId}-${stepIndex}-s${i}`;

const bit = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

/**
 * 書いてよいかの門。drills の行が保存のあとの刻み（と手の数）にあるときだけ書く（先に書いた要求があれば書かない）。
 * 手の数は手を打った要求だけ見る（刻みだけの要求は刻みで足りる）
 */
type Gate = { step: number; actions?: number };

function gateSql(g: Gate, stepParam: string, actionsParam: string): string {
  const actions = g.actions === undefined ? "" : ` AND COALESCE(json_array_length(world, '$.actions'), 0) = ${actionsParam}`;
  return `WHERE EXISTS (SELECT 1 FROM drills WHERE id = ?2 AND step = ${stepParam}${actions})`;
}

const SEQ = "(SELECT COALESCE(MAX(seq), 0) + 1 FROM drill_events WHERE drill_id = ?2)";

/**
 * 刻み 1 つの保存の文（drills の行がその刻みにあるときだけ書く）。刻みの安否のうち電話の形の物（2 件まで）は着信（call_in）
 * としても残す（T21）。during は手の途中で進んだ刻みのときの手の番号（割り込み）
 */
function tickStatements(db: D1Database, drillId: string, tick: Tick, startedAt: string, gate: Gate = { step: tick.step }, during?: string) {
  const out = [];
  const calls = callIndexes(tick.turns);
  const where = gateSql(gate, "?8", "?9");
  // 門の値（使う数だけ渡す。使わない番号を渡すと SQLite は断る）
  const bindGate: number[] = gate.actions === undefined ? [gate.step] : [gate.step, gate.actions];
  let n = 0;
  for (const e of tick.incidents) {
    const { actor, person, ...rest } = e;
    const payload: IncidentPayload = rest;
    out.push(
      db
        .prepare(
          `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
           SELECT ?1, ?2, ${SEQ}, ?3, ?4, ?5, ?6, 'incident', ?7 ${where}`,
        )
        .bind(eventId(drillId, tick.step, n++), drillId, tick.step, e.at, person ?? null, actor, JSON.stringify(payload), ...bindGate),
    );
  }
  tick.turns.forEach((t, i) => {
    const sid = signalId(drillId, tick.step, i);
    const { person, ...rest } = t;
    const payload: TurnPayload = { ...rest, signal: sid };
    const actionsGate = gate.actions === undefined ? "" : " AND COALESCE(json_array_length(d.world, '$.actions'), 0) = ?15";
    out.push(
      db
        .prepare(
          `INSERT INTO signals (id, person_id, drill_id, color, source, where_now, injured, at_home, can_move, has_medicine,
                                transcript, occurred_at)
           SELECT ?1, ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
            WHERE EXISTS (SELECT 1 FROM drills d JOIN people p ON p.office_id = d.office_id
                           WHERE d.id = ?2 AND d.step = ?14 AND p.id = ?4${actionsGate})`,
        )
        .bind(
          sid,
          drillId,
          tick.step,
          person,
          t.color,
          t.source,
          t.whereNow,
          bit(t.injured),
          bit(t.atHome),
          bit(t.canMove),
          bit(t.hasMedicine),
          t.saying,
          simAt(startedAt, t.at),
          ...bindGate,
        ),
      db
        .prepare(
          `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
           SELECT ?1, ?2, ${SEQ}, ?3, ?4, ?5, 'persona', 'persona_turn', ?6 ${gateSql(gate, "?7", "?8")}`,
        )
        .bind(eventId(drillId, tick.step, n++), drillId, tick.step, t.at, person, JSON.stringify(payload), ...bindGate),
    );
    const order = calls.indexOf(i);
    if (order >= 0) {
      const call: CallInPayload = {
        signal: sid,
        order,
        ...(during ? { during } : {}),
        source: t.source,
        color: t.color,
        saying: t.saying,
        ai: t.ai,
      };
      out.push(
        db
          .prepare(
            `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
             SELECT ?1, ?2, ${SEQ}, ?3, ?4, ?5, 'persona', 'call_in', ?6 ${gateSql(gate, "?7", "?8")}`,
          )
          .bind(`${drillId}-${tick.step}-c${i}`, drillId, tick.step, t.at, person, JSON.stringify(call), ...bindGate),
      );
    }
  });
  return out;
}

/**
 * 着信（刻みの安否のうち電話の形の物。lib/drill/calls.ts の callIndexes、1 刻みに 2 件まで）。order は鳴らす順、
 * during は手の途中に来た着信のときの手の番号（割り込み）。言う事は安否の文字起こしと同じ
 */
type CallInPayload = Pick<DrillTurn, "source" | "color" | "saying" | "ai"> & { signal: string; order: number; during?: string };

// ---------- 開始・進める・中断 ----------

/** invalid は選んだ物が違う（担当一覧の外の人・0 人・職員が 0〜9 でない。T59） */
export type StartResult = { ok: true; id: string } | { ok: false; error: "running" | "empty" | "invalid" };

/**
 * 開始の前に選ぶ物（T59）。どれも任意で、選ばなければ今と同じ（担当一覧の全員・想定の表の職員・昼の発災）。
 * participants は担当一覧の人の id（外の id・0 人は断る）
 */
export type StartOptions = DrillOptions & { participants?: ReadonlyArray<string> };

/** 担当一覧の人（一覧から外した人は出ない。よみの順） */
async function caseloadRows(db: D1Database, scope: DrillScope): Promise<Array<{ id: string; name: string }>> {
  const res = await db
    .prepare("SELECT id, name FROM people WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NULL ORDER BY kana, id")
    .bind(scope.careManagerId, scope.officeId)
    .all<{ id: string; name: string }>();
  return res.results;
}

/** 開始の前の参加者の 1 人（T59・T70） */
export type CaseloadPerson = {
  id: string;
  name: string;
  /** 本人のスマホ「使える」か、家族・支援者にスマホのある人がいる（lib/drill/persona.ts の reportersOf）。無ければ「押せる人なし」 */
  canPress: boolean;
  /** 本人役を呼びうる想定（開始の前の見込み、lib/drill/estimate.ts） */
  callable: DrillScenario[];
};

/**
 * 担当一覧の人を、開始の前の参加者の選択に（名前・押せる人の有無・本人役を呼びうる想定）。台帳は事業所の分を 1 回の batch で読む。
 * 押せる人のいない人は本人役が呼ばれず、表の行が当たれば表の固定の安否になる（lib/drill/persona.ts の createPersonaHook）
 */
export async function caseloadForDrill(db: D1Database, scope: DrillScope): Promise<CaseloadPerson[]> {
  return (await drillStartInfo(db, scope)).people;
}

/**
 * 開始の前の設定に出す物（T59・T70・T104）: 参加者の選択と、訓練する人の住む所に選べる地区（担当一覧の人の台帳の町名。
 * デモ事業所は架空の街の町）。台帳は事業所の分を 1 回の batch で読む
 */
export async function drillStartInfo(db: D1Database, scope: DrillScope): Promise<{ people: CaseloadPerson[]; towns: string[] }> {
  const rows = await caseloadRows(db, scope);
  if (rows.length === 0) return { people: [], towns: [] };
  const sources = await loadPersonaSources(db, scope.officeId);
  const facts = castFactsMap(sources);
  const people = rows.map((r) => ({
    id: r.id,
    name: r.name,
    canPress: facts.get(r.id)?.canPress ?? false,
    callable: SCENARIO_ORDER.filter((s) => mayBeCalled(scenarioOf(s), r.id, facts)),
  }));
  const ledgers = rows.flatMap((r) => {
    const s = sources.get(r.id);
    return s ? [s.ledger] : [];
  });
  return { people, towns: homeTowns(scope.officeId, ledgers) };
}

async function caseloadPeople(db: D1Database, scope: DrillScope): Promise<string[]> {
  return (await caseloadRows(db, scope)).map((r) => r.id);
}

/**
 * 選んだ参加者を担当一覧で確かめる。選ばなければ担当一覧の全員。並びは担当一覧の順（よみ）。
 * 外の id・重なり・0 人は null（断る）
 */
export function pickParticipants(caseload: ReadonlyArray<string>, chosen: ReadonlyArray<string> | undefined): string[] | null {
  if (chosen === undefined) return [...caseload];
  const want = new Set(chosen);
  if (want.size === 0 || want.size !== chosen.length || [...want].some((p) => !caseload.includes(p))) return null;
  return caseload.filter((p) => want.has(p));
}

/**
 * 訓練を始める。0 時間の刻みまで当てて保存する。同じケアマネ（mineRunningSql）に進行中があれば断る（T70。24 時間たった進行中は先に中断）。
 * options は開始の前に選んだ物（T59、任意）
 */
export async function startDrill(
  db: D1Database,
  scope: DrillScope,
  scenario: DrillScenario,
  now: string,
  hooks: StepHooks = {},
  newId: () => string = () => crypto.randomUUID(),
  options: StartOptions = {},
  /** 規模のおまかせを引く乱数（T104）。無ければ訓練の id と開始の時刻から（訓練ごとに違い、同じ訓練なら同じ） */
  rand?: () => number,
): Promise<StartResult> {
  const caseload = await caseloadPeople(db, scope);
  if (caseload.length === 0) return { ok: false, error: "empty" };
  const participants = pickParticipants(caseload, options.participants);
  if (!participants) return { ok: false, error: "invalid" };
  if (options.staff !== undefined && !isStaffCount(options.staff)) return { ok: false, error: "invalid" };
  if (options.scale !== undefined && !isDrillScale(options.scale)) return { ok: false, error: "invalid" };
  // 連続の時計（T90）は大雨・地震・仮想だけ。10 分版に来たら捨てる（刻みの道のまま）
  const clock = options.clock === true && scenario !== "short";
  // 訓練する人の住む所（T104）は連続の時計の大雨想定・地震想定だけが使う（ほかの想定に来たら捨てる）。担当一覧の人の地区の中だけ
  const home = clock && !isVirtual(scenario) && options.home !== undefined ? options.home : undefined;
  let sources: Map<string, PseudonymInput> | null = null;
  const loadSources = async () => (sources ??= await loadPersonaSources(db, scope.officeId));
  if (home !== undefined) {
    const all = await loadSources();
    const towns = homeTowns(
      scope.officeId,
      caseload.flatMap((p) => {
        const s = all.get(p);
        return s ? [s.ledger] : [];
      }),
    );
    if (typeof home !== "string" || !towns.includes(home.trim())) return { ok: false, error: "invalid" };
  }
  await expireStaleDrills(db, scope.officeId, now);
  if (await runningDrillId(db, scope.officeId, { scope })) return { ok: false, error: "running" };

  // 想定の表の配役（T70）。事業所にいない人（デモの 10 人）の行があるときだけ台帳を読み、参加者の中の代わりの人を決める
  const def = scenarioOf(scenario);
  const cast = needsCast(def, participants) ? castScenario(def, participants, castFactsMap(await loadSources())) : {};

  const id = newId();
  // 仮想の規模（T104）。選ばなければおまかせ（幅の中から今 1 回引いて残す）。ほかの想定には付けない
  const scale = isVirtual(scenario)
    ? options.scale
      ? { scale: options.scale }
      : { scale: pickScale(rand ?? seededRand(`${id}|${now}`)), scaleAuto: true as const }
    : {};
  const init = initialState(
    scenario,
    participants,
    now,
    {
      staff: options.staff,
      night: options.night,
      ...(clock ? { clock: true as const } : {}),
      ...scale,
      ...(home !== undefined ? { home: home.trim() } : {}),
    },
    cast,
  );
  const { state, tick } = clock ? (await advance(init, 0, hooks, { policy: "clock" }))! : await step(init, hooks);
  const [inserted] = await db.batch([
    db
      .prepare(
        // world_session_id は世界の部屋の session（仮想、T50。drills.world の world.session の写し）
        `INSERT INTO drills (id, office_id, scenario, status, step, sim_hour, world, started_by, started_at, finished_at, mode, world_session_id)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, json_extract(?7, '$.world.session')
          WHERE NOT EXISTS (${mineRunningSql("?2", "?8", "?12")})`,
      )
      .bind(
        id,
        scope.officeId,
        dbScenario(scenario).scenario,
        state.status,
        state.step,
        state.hour,
        storeWorld(state),
        scope.accountId,
        now,
        state.status === "finished" ? now : null,
        dbScenario(scenario).mode,
        scope.careManagerId,
      ),
    ...tickStatements(db, id, tick, now),
  ]);
  if ((inserted.meta.changes ?? 0) === 0) return { ok: false, error: "running" };
  return { ok: true, id };
}

export type AdvanceResult =
  | { ok: true; step: number; hour: number; status: DrillRow["status"]; minute?: number }
  | { ok: false; error: "not_found" | "conflict" | "ended" | "invalid" };

/** 事業所の中の訓練を 1 つ。範囲の外は null */
export async function loadDrillRow(
  db: D1Database,
  officeId: string,
  id: string,
): Promise<(DrillRow & { started_by_name: string | null }) | null> {
  const row = await db
    .prepare(
      `SELECT d.*, a.display_name AS started_by_name FROM drills d LEFT JOIN accounts a ON a.id = d.started_by
        WHERE d.id = ?1 AND d.office_id = ?2`,
    )
    .bind(id, officeId)
    .first<DrillRow & { started_by_name: string | null }>();
  return row ? rowScenario(row) : null;
}

/**
 * 1 刻み進める。expected は画面で読んだ今の刻み（違えば競合）。最後の刻みに着いたら終了。
 * 保存は 1 つの取引で、drills の刻みを進められたときだけ状況と安否を足す。
 * 連続の時計の訓練（T90）は to（30・60・180 分か、次の出来事まで）が要り（無ければ invalid）、ケアマネの時計からそこまでを 1 区切りに。
 * clock の無い訓練は to を見ない（今までどおり 1 刻み）
 */
export async function advanceDrill(
  db: D1Database,
  scope: DrillScope,
  id: string,
  expected: number,
  now: string,
  hooks: StepHooks = {},
  to?: ClockTo,
): Promise<AdvanceResult> {
  const row = await loadDrillRow(db, scope.officeId, id);
  if (!row) return { ok: false, error: "not_found" };
  const before = stateOfRow(row);
  if (drillEnded(before)) return { ok: false, error: "ended" };
  if (row.step !== expected) return { ok: false, error: "conflict" };
  if (isClock(before) && !to) return { ok: false, error: "invalid" };

  const { state, tick } = isClock(before) ? (await advance(before, await clockTarget(before, to!, hooks), hooks, { policy: "clock", next: "next" in to! }))! : await step(before, hooks);
  let updated;
  try {
    // 読んだ今の状態（world の写し）のときだけ書く。その間にケアマネの手（T20）が入っていれば競合（手の履歴を消さない）
    [updated] = await db.batch([
      db
        .prepare(
          `UPDATE drills SET step = ?3, sim_hour = ?4, world = ?5, status = ?6, finished_at = ?7,
                  world_session_id = COALESCE(json_extract(?5, '$.world.session'), world_session_id)
            WHERE id = ?1 AND office_id = ?2 AND step = ?8 AND status = 'running' AND world = ?9`,
        )
        .bind(
          id,
          scope.officeId,
          state.step,
          state.hour,
          storeWorld(state),
          state.status,
          state.status === "finished" ? now : null,
          expected,
          row.world,
        ),
      ...tickStatements(db, id, tick, row.started_at),
    ]);
  } catch (e) {
    // 同じ刻みをほかの要求が先に書いた（id が重なった）。取引ごと戻っている
    if (e instanceof Error && /UNIQUE|PRIMARY KEY|constraint/i.test(e.message)) return { ok: false, error: "conflict" };
    throw e;
  }
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  // ケアマネの時計（分）は連続の時計の訓練だけ返す（clock の無い訓練の返事は前と同じ形）
  return { ok: true, step: state.step, hour: state.hour, status: state.status, ...(isClock(state) ? { minute: state.minute } : {}) };
}

/** 連続の時計の行き先（発災からの分）。分の進めはケアマネの時計から、「次まで」は lib/drill/clock.ts の nextEventMinute（72 時間まで） */
async function clockTarget(state: DrillState, to: ClockTo, hooks: StepHooks): Promise<number> {
  if ("minutes" in to) return Math.min(state.minute + to.minutes, DRILL_END_MINUTE);
  const marks = hooks.clock?.marks ? await hooks.clock.marks(state).catch((): ClockMark[] => []) : [];
  return nextEventMinute(state, marks);
}

// ---------- ケアマネの手（T20） ----------

/** memo はケアマネのメモ（T59、100 字まで。空は無し）。text は自由対応の文（T91、120 字まで。自由対応だけ） */
export type ActRequest = { kind: DrillAction; person: string | null; target: string | null; memo?: string; text?: string };

/** 手のメモの長さの上限（字） */
export const MEMO_MAX = 100;

export type ActDrillResult =
  | { ok: true; record: ActionRecord; step: number; hour: number; minute: number; status: DrillStatus }
  | { ok: false; error: "not_found" | "conflict" | "ended" | "invalid" };

/** 手の前の左の表（画面と同じ道で作った色・順位・理由と並び）。採点 T22 のために手の前の状態に残す */
export type TriageSnapshot = {
  rows: ReadonlyMap<string, { color: string; rank: number | null; reason: string }>;
  ranking: string[];
};

type ContactForAct = Pick<ContactRow, "id" | "kind" | "relation"> & { has_phone: number };

/**
 * 手の相手を台帳の連絡先から決める（画面から送られた区分・名前は読まない）。
 * 本人電話は本人の連絡先（無ければ相手なし → 番号なし）、連絡先電話は本人のほかの連絡先（要る）、
 * 訪問依頼は訪問看護・介護事業所（無ければ事業所の職員）、行政報告は市役所の連絡先（無ければ相手なし）。ほかの手は相手を受けない
 */
async function resolveTarget(
  db: D1Database,
  officeId: string,
  req: ActRequest,
): Promise<{ ok: true; target: ActTarget | null } | { ok: false }> {
  const kinds = targetKinds(req.kind);
  if (kinds.length === 0) return req.target === null ? { ok: true, target: null } : { ok: false };
  if (!req.person) return req.target === null && !needsTarget(req.kind) ? { ok: true, target: null } : { ok: false };
  const rows = await db
    .prepare(
      `SELECT c.id, c.kind, c.relation, CASE WHEN TRIM(COALESCE(c.phone, '')) <> '' THEN 1 ELSE 0 END AS has_phone
         FROM contacts c JOIN people p ON p.id = c.person_id
        WHERE c.person_id = ?1 AND p.office_id = ?2 ORDER BY c.sort, c.id`,
    )
    .bind(req.person, officeId)
    .all<ContactForAct>();
  if (req.kind === "call_person") {
    const self = rows.results.find((c) => c.kind === "self" && c.has_phone === 1) ?? rows.results.find((c) => c.kind === "self");
    return { ok: true, target: self ? asTarget(self) : null };
  }
  if (req.target === null) return needsTarget(req.kind) ? { ok: false } : { ok: true, target: null };
  const hit = rows.results.find((c) => c.id === req.target);
  if (!hit || !kinds.includes(hit.kind)) return { ok: false };
  return { ok: true, target: asTarget(hit) };
}

const asTarget = (c: ContactForAct): ActTarget => ({ id: c.id, kind: c.kind, label: callTargetText(c), hasPhone: c.has_phone === 1 });

/** 自由対応（T91）の相手を選ぶ元: 本人の台帳の連絡先の全部（名前と番号は持たない）。本人なしは空 */
async function freeContacts(db: D1Database, officeId: string, person: string | null): Promise<ActTarget[]> {
  if (!person) return [];
  const rows = await db
    .prepare(
      `SELECT c.id, c.kind, c.relation, CASE WHEN TRIM(COALESCE(c.phone, '')) <> '' THEN 1 ELSE 0 END AS has_phone
         FROM contacts c JOIN people p ON p.id = c.person_id
        WHERE c.person_id = ?1 AND p.office_id = ?2 ORDER BY c.sort, c.id`,
    )
    .bind(person, officeId)
    .all<ContactForAct>();
  return rows.results.map(asTarget);
}

/**
 * ケアマネの手を 1 つ打つ。expected は画面で読んだ今の刻みと手の数（違えば競合）。
 * 手の途中で次の刻みの時刻を越えたら、その刻みも同じ取引で保存する（状況・安否・着信）。
 * 保存は 1 つの batch: drills（刻み・時刻・今の状態）、drill_events の action（誰に・何を・何時・手の前の状態）、
 * 越えた刻み、result（世界の返事）。読んだ状態（world の写し）のときだけ書く
 */
export async function actDrill(
  db: D1Database,
  scope: DrillScope,
  id: string,
  expected: { step: number; actions: number },
  req: ActRequest,
  now: string,
  opts: { hooks?: ActionHooks; roll?: () => number; triage?: TriageSnapshot } = {},
): Promise<ActDrillResult> {
  const row = await loadDrillRow(db, scope.officeId, id);
  if (!row) return { ok: false, error: "not_found" };
  const before = stateOfRow(row);
  if (drillEnded(before)) return { ok: false, error: "ended" };
  if (row.step !== expected.step || before.actions.length !== expected.actions) return { ok: false, error: "conflict" };

  // 相手の本人は参加者だけ。本人が要らない手（行政報告は任意、退避は受けない）
  const person = req.kind === "evacuate_self" ? null : req.person;
  if (person !== null && !before.participants.includes(person)) return { ok: false, error: "invalid" };
  if (person === null && needsPerson(req.kind)) return { ok: false, error: "invalid" };
  const resolved = await resolveTarget(db, scope.officeId, { ...req, person, target: req.kind === "evacuate_self" ? null : req.target });
  if (!resolved.ok) return { ok: false, error: "invalid" };

  const t = opts.triage;
  const extra = t
    ? { triage: person ? (t.rows.get(person) ?? null) : null, ranking: t.ranking }
    : {};
  const memo = req.memo?.trim() ?? "";
  if ([...memo].length > MEMO_MAX) return { ok: false, error: "invalid" };
  // 自由対応（T91）: 文は要る。相手は読み替えた手で本人の台帳の連絡先から選ぶ（伏せきれない文は act が PseudonymLeakError を投げる）
  const text = req.kind === "free" ? (req.text?.trim() ?? "") : "";
  if (req.kind === "free" && (text === "" || [...text].length > FREE_TEXT_MAX)) return { ok: false, error: "invalid" };
  const free = req.kind === "free" ? { text, contacts: await freeContacts(db, scope.officeId, person) } : {};
  const { state, record, ticks } = await act(
    before,
    { kind: req.kind, person, target: resolved.target, ...(memo ? { memo } : {}), ...free },
    opts.hooks ?? {},
    opts.roll ?? Math.random,
    extra,
  );
  const gate: Gate = { step: state.step, actions: state.actions.length };
  const { result: maybe, ...actionPayload } = record;
  // act は返事を当ててから返す（null は刻みを越える途中だけ）
  const result: ActionResult = maybe!;
  // 刻みを越えなかった手だけ、手の前の写しを置く（T59 の取消。越えた手は本人役・監督の呼びが済んでいて戻せない）
  const undo: UndoSnapshot | undefined =
    result.crossed.length === 0
      ? { act: record.id, minute: before.minute, hour: before.hour, step: before.step, world: before.world, people: before.people, actions: before.actions }
      : undefined;
  let updated;
  try {
    [updated] = await db.batch([
      db
        .prepare(
          `UPDATE drills SET step = ?3, sim_hour = ?4, world = ?5, status = ?6, finished_at = ?7,
                  world_session_id = COALESCE(json_extract(?5, '$.world.session'), world_session_id)
            WHERE id = ?1 AND office_id = ?2 AND step = ?8 AND status = 'running' AND world = ?9`,
        )
        .bind(
          id,
          scope.officeId,
          state.step,
          state.hour,
          storeWorld(state, undo),
          state.status,
          state.status === "finished" ? now : null,
          row.step,
          row.world,
        ),
      db
        .prepare(
          `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
           SELECT ?1, ?2, ${SEQ}, ?3, ?4, ?5, 'care_manager', 'action', ?6 ${gateSql(gate, "?7", "?8")}`,
        )
        .bind(`${id}-${record.id}`, id, record.step, record.at, person, JSON.stringify(actionPayload), gate.step, gate.actions!),
      ...ticks.flatMap((tick) => tickStatements(db, id, tick, row.started_at, gate, record.id)),
      db
        .prepare(
          `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
           SELECT ?1, ?2, ${SEQ}, ?3, ?4, ?5, ?6, 'result', ?7 ${gateSql(gate, "?8", "?9")}`,
        )
        .bind(
          `${id}-${record.id}-r`,
          id,
          state.step,
          result.atMinute / 60,
          person,
          result.speech !== null ? "persona" : "world",
          JSON.stringify({ id: record.id, ...result } satisfies ResultPayload),
          gate.step,
          gate.actions!,
        ),
      ...heardStatements(db, id, record.id, person, result.heard ?? null, row.started_at, gate),
    ]);
  } catch (e) {
    // ほかの要求が先に同じ手の番号・同じ刻みを書いた（id が重なった）。取引ごと戻っている
    if (e instanceof Error && /UNIQUE|PRIMARY KEY|constraint/i.test(e.message)) return { ok: false, error: "conflict" };
    throw e;
  }
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  return { ok: true, record, step: state.step, hour: state.hour, minute: state.minute, status: state.status };
}

type ActionPayload = Omit<ActionRecord, "result">;
type ResultPayload = ActionResult & { id: string };

/** 通話・訪問で聞いた安否の signals の id（手 1 つに 1 つ） */
export const heardSignalId = (drillId: string, actionId: string) => `${drillId}-${actionId}-h`;

/**
 * 通話・訪問で聞いた安否（T21）を signals に足す文。出どころ care_manager、文字起こしなし（言う事は手の返事の吹き出しに AI の印つきで出す。
 * 信号は人が聞いた結果なので AI の印を付けない）。手を打った要求と同じ門（刻みと手の数）
 */
function heardStatements(
  db: D1Database,
  drillId: string,
  actionId: string,
  person: string | null,
  heard: HeardSignal | null,
  startedAt: string,
  gate: Gate,
) {
  if (!heard || !person) return [];
  return [
    db
      .prepare(
        `INSERT INTO signals (id, person_id, drill_id, color, source, where_now, injured, at_home, can_move, has_medicine,
                              transcript, occurred_at)
         SELECT ?1, ?2, ?3, ?4, 'care_manager', ?5, ?6, ?7, ?8, ?9, NULL, ?10
          WHERE EXISTS (SELECT 1 FROM drills d JOIN people p ON p.office_id = d.office_id
                         WHERE d.id = ?3 AND d.step = ?11 AND p.id = ?2
                           AND COALESCE(json_array_length(d.world, '$.actions'), 0) = ?12)`,
      )
      .bind(
        heardSignalId(drillId, actionId),
        person,
        drillId,
        heard.color,
        heard.whereNow,
        bit(heard.injured),
        bit(heard.atHome),
        bit(heard.canMove),
        bit(heard.hasMedicine),
        simAt(startedAt, heard.at),
        gate.step,
        gate.actions!,
      ),
  ];
}

// ---------- 手の取消（T59） ----------

/**
 * locked は取り消せない手（刻みを越えた手・写しの無い手。「取消不可」）、invalid は取り消す手が無い
 */
export type UndoResult =
  | { ok: true; id: string; step: number; hour: number; minute: number }
  | { ok: false; error: "not_found" | "conflict" | "ended" | "locked" | "invalid" };

/**
 * 最後の手を 1 つ取り消す。expected は画面で読んだ今の刻みと手の数（違えば競合。actDrill と同じ門）。
 * 刻みを越えなかった手だけ（越えた手は本人役・監督の呼びが済んでいるので戻せない）。1 つの batch で:
 * その手の drill_events（`<訓練>-<手>` と `-r`）と聞いた安否の signals（heardSignalId）を消し、drills.world を手の前の写しに戻す。
 * 消す文も読んだ状態（world の写し）のときだけ効く（競合なら何も消さない）。ai_calls は消さない（1 日の上限の数）。
 * world_session_id は今のまま（写しの session は手の前の物なので、actDrill の COALESCE と同じく空のときだけ使う）。
 * 取り消した数は state.undone に数える（訓練記録の「取消 N」。採点は変えない）
 */
export async function undoDrill(
  db: D1Database,
  scope: DrillScope,
  id: string,
  expected: { step: number; actions: number },
): Promise<UndoResult> {
  const row = await loadDrillRow(db, scope.officeId, id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "running") return { ok: false, error: "ended" };
  const now = stateOfRow(row);
  if (row.step !== expected.step || now.actions.length !== expected.actions) return { ok: false, error: "conflict" };
  const last = now.actions.at(-1);
  if (!last) return { ok: false, error: "invalid" };
  const snap = parseStoredWorld(row.world).undo;
  if (!snap || undoableAct(row) !== last.id) return { ok: false, error: "locked" };

  const back: DrillState = {
    ...now,
    minute: snap.minute,
    hour: snap.hour,
    step: snap.step,
    world: { ...snap.world, ...(now.world.session !== undefined ? { session: now.world.session } : {}) },
    people: snap.people,
    actions: snap.actions,
    undone: (now.undone ?? 0) + 1,
  };
  const gate = "EXISTS (SELECT 1 FROM drills WHERE id = ?1 AND office_id = ?2 AND step = ?3 AND status = 'running' AND world = ?4)";
  const [, , updated] = await db.batch([
    db
      .prepare(`DELETE FROM drill_events WHERE drill_id = ?1 AND id IN (?5, ?6) AND ${gate}`)
      .bind(id, scope.officeId, row.step, row.world, `${id}-${last.id}`, `${id}-${last.id}-r`),
    db
      .prepare(`DELETE FROM signals WHERE drill_id = ?1 AND id = ?5 AND ${gate}`)
      .bind(id, scope.officeId, row.step, row.world, heardSignalId(id, last.id)),
    db
      .prepare(
        `UPDATE drills SET step = ?5, sim_hour = ?6, world = ?7,
                world_session_id = COALESCE(world_session_id, json_extract(?7, '$.world.session'))
          WHERE id = ?1 AND office_id = ?2 AND step = ?3 AND status = 'running' AND world = ?4`,
      )
      .bind(id, scope.officeId, row.step, row.world, back.step, back.hour, storeWorld(back)),
  ]);
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  return { ok: true, id: last.id, step: back.step, hour: back.hour, minute: back.minute };
}

/** 中断（進行中だけ）。記録は残り、再生できる */
export async function abandonDrill(
  db: D1Database,
  scope: DrillScope,
  id: string,
  now: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "ended" }> {
  const r = await db
    .prepare(
      `UPDATE drills SET status = 'abandoned', finished_at = ?3
        WHERE id = ?1 AND office_id = ?2 AND status = 'running'`,
    )
    .bind(id, scope.officeId, now)
    .run();
  if ((r.meta.changes ?? 0) > 0) return { ok: true };
  return (await loadDrillRow(db, scope.officeId, id)) ? { ok: false, error: "ended" } : { ok: false, error: "not_found" };
}

// ---------- 訓練記録の一覧 ----------

export type DrillListItem = Pick<DrillRow, "id" | "scenario" | "status" | "step" | "sim_hour" | "started_at" | "finished_at" | "started_by"> & {
  started_by_name: string | null;
  /** 自動中断の理由（T70。24 時間で中断した訓練だけ "24h"） */
  abandon_reason: AbandonReason | null;
};

/**
 * 事業所の訓練記録（新しい順）。now を渡すと、先に 24 時間たった進行中を中断にする（T70。画面と API の一覧は渡す。
 * 渡さなければ読むだけ）
 */
export async function listDrills(db: D1Database, officeId: string, limit = 50, now?: string): Promise<DrillListItem[]> {
  if (now) await expireStaleDrills(db, officeId, now);
  const res = await db
    .prepare(
      `SELECT d.id, d.scenario, d.mode, d.status, d.step, d.sim_hour, d.started_at, d.finished_at, d.started_by,
              a.display_name AS started_by_name, json_extract(d.world, '$.abandoned.reason') AS abandon_reason
         FROM drills d LEFT JOIN accounts a ON a.id = d.started_by
        WHERE d.office_id = ?1 ORDER BY d.started_at DESC, d.id LIMIT ?2`,
    )
    .bind(officeId, limit)
    .all<DrillListItem & { mode: string | null }>();
  return res.results
    .map((r) => {
      const { mode: _mode, ...rest } = rowScenario(r);
      // 一覧の経過は時間の整数（連続の時計の訓練〔T90〕の区切りは 6.1666… 時間のような小数。「経過 6 / 72 時間」と出す）
      return { ...rest, sim_hour: Math.floor(rest.sim_hour), abandon_reason: rest.abandon_reason === "24h" ? ("24h" as const) : null };
    })
    .filter((r) => (DRILL_SCENARIOS as readonly string[]).includes(r.scenario) && (DRILL_STATUSES as readonly string[]).includes(r.status));
}

/**
 * 同じケアマネの進行中（T70）を引く文。自分（開始者のアカウント）が始めた物か、自分の担当一覧の人が参加している物。
 * 審査員は同じアカウント（acct-judge）で山本の担当一覧を使うので、審査員どうしも山本とも 1 つを共有する（今までどおり）。
 * 担当一覧の違うケアマネは別々に持てる。引数は SQL の番号（"?2" など）。
 * 開始者は = で比べる（IS だと accountId が null のとき開始者 NULL の訓練を自分の物と見ていた。T82）
 */
function mineRunningSql(office: string, account: string, careManager: string): string {
  return `SELECT d.id FROM drills d WHERE d.office_id = ${office} AND d.status = 'running'
            AND (d.started_by = ${account}
                 OR EXISTS (SELECT 1 FROM json_each(d.world, '$.participants') j JOIN people p ON p.id = j.value
                             WHERE p.care_manager_id = ${careManager} AND p.office_id = d.office_id))`;
}

/**
 * 事業所の進行中の訓練（無ければ null）。scope を渡すとそのケアマネの物だけ（T70。mineRunningSql）、
 * now を渡すと先に 24 時間たった進行中を中断にする
 */
export async function runningDrillId(
  db: D1Database,
  officeId: string,
  opts: { scope?: Pick<DrillScope, "accountId" | "careManagerId">; now?: string } = {},
): Promise<string | null> {
  if (opts.now) await expireStaleDrills(db, officeId, opts.now);
  const r = opts.scope
    ? await db
        .prepare(`${mineRunningSql("?1", "?2", "?3")} ORDER BY d.started_at DESC LIMIT 1`)
        .bind(officeId, opts.scope.accountId, opts.scope.careManagerId)
        .first<{ id: string }>()
    : await db
        .prepare("SELECT id FROM drills WHERE office_id = ?1 AND status = 'running' ORDER BY started_at DESC LIMIT 1")
        .bind(officeId)
        .first<{ id: string }>();
  return r?.id ?? null;
}

// ---------- 24 時間で自動中断（T70） ----------

/** 進行中のまま置いておける時間（時間）。過ぎた訓練は開始・一覧を読むときに中断にする（cron は使わない） */
export const STALE_HOURS = 24;

/** 中断の理由（drills.world の abandoned.reason）。今は 24 時間の自動中断だけ */
export type AbandonReason = "24h";

/** 自動中断の経過（drill_events）の id。訓練に 1 つ */
export const autoAbandonEventId = (drillId: string) => `${drillId}-auto`;

/**
 * 事業所の進行中で、始めてから 24 時間（STALE_HOURS）を過ぎた訓練を中断にする。1 件ごとに 1 つの batch で:
 * drills を abandoned（finished_at = now、world の JSON に abandoned { reason "24h", at }）にし、今の刻みに経過の 1 行（状況 auto_abandon
 * 「自動中断 24 時間」）を足す。ほかの要求が先に変えていれば（進行中でない）何も書かない。中断した数を返す
 */
export async function expireStaleDrills(db: D1Database, officeId: string, now: string): Promise<number> {
  const t = Date.parse(now);
  if (Number.isNaN(t)) return 0;
  const cutoff = new Date(t - STALE_HOURS * 3_600_000).toISOString();
  const stale = await db
    .prepare("SELECT id, step, sim_hour FROM drills WHERE office_id = ?1 AND status = 'running' AND started_at <= ?2")
    .bind(officeId, cutoff)
    .all<{ id: string; step: number; sim_hour: number }>();
  let n = 0;
  for (const d of stale.results) {
    const payload: IncidentPayload = {
      change: { kind: "auto_abandon", hours: STALE_HOURS },
      text: `${T70_LABELS.autoAbandon} ${T70_LABELS.day}`,
      at: d.sim_hour,
      ai: false,
    };
    const [updated] = await db.batch([
      db
        .prepare(
          `UPDATE drills SET status = 'abandoned', finished_at = ?3, world = json_set(world, '$.abandoned', json(?4))
            WHERE id = ?1 AND office_id = ?2 AND status = 'running' AND started_at <= ?5`,
        )
        .bind(d.id, officeId, now, JSON.stringify({ reason: "24h" satisfies AbandonReason, at: now }), cutoff),
      db
        .prepare(
          `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
           SELECT ?1, ?2, (SELECT COALESCE(MAX(seq), 0) + 1 FROM drill_events WHERE drill_id = ?2), ?3, ?4, NULL, 'world', 'incident', ?5
            WHERE EXISTS (SELECT 1 FROM drills WHERE id = ?2 AND status = 'abandoned' AND json_extract(world, '$.abandoned.reason') = '24h')
              AND NOT EXISTS (SELECT 1 FROM drill_events WHERE id = ?1)`,
        )
        .bind(autoAbandonEventId(d.id), d.id, d.step, d.sim_hour, JSON.stringify(payload)),
    ]);
    if ((updated.meta.changes ?? 0) > 0) n += 1;
  }
  return n;
}

// ---------- 再生（保存した刻みから作り直す。Claude を呼ばない） ----------

const SOURCES = ["agent", "family", "supporter"] as const;

function asTurn(person: string | null, p: Partial<TurnPayload>): DrillTurn | null {
  if (!person || !(SIGNAL_COLORS as readonly string[]).includes(p.color ?? "")) return null;
  if (!(SOURCES as readonly string[]).includes(p.source ?? "")) return null;
  const b = (v: unknown) => (typeof v === "boolean" ? v : null);
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    person,
    color: p.color!,
    source: p.source!,
    whereNow: (WHERE_NOW as readonly string[]).includes(p.whereNow ?? "") ? p.whereNow! : null,
    injured: b(p.injured),
    atHome: b(p.atHome),
    canMove: b(p.canMove),
    hasMedicine: b(p.hasMedicine),
    saying: s(p.saying),
    doing: s(p.doing),
    ai: p.ai === true,
    at: typeof p.at === "number" ? p.at : 0,
    ...(typeof p.signal === "string" ? { signal: p.signal } : {}),
  };
}

function asIncident(row: Pick<DrillEventRow, "person_id" | "actor" | "sim_hour">, p: Partial<IncidentPayload>): DrillIncident | null {
  if (!p.change || typeof p.text !== "string") return null;
  if (row.actor !== "world" && row.actor !== "director") return null;
  return {
    change: p.change,
    text: p.text,
    ...(row.person_id ? { person: row.person_id } : {}),
    actor: row.actor,
    at: typeof p.at === "number" ? p.at : row.sim_hour,
    ai: p.ai === true,
    ...(isInjectKind(p.inject) ? { inject: p.inject } : {}),
    ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
    ...(typeof p.basis === "string" && isSourceId(p.basis) ? { basis: p.basis } : {}),
  };
}

/** ケアマネの手と返事（drill_events の action と result）。刻みの状況・安否のあとに、保存した順に当てる */
export type ActEvent = { kind: "action"; record: ActionRecord } | { kind: "result"; id: string; result: ActionResult };

/** 保存した刻みと、その刻みの間のケアマネの手（acts） */
export type ReplayTick = Tick & { acts: ActEvent[] };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function asAction(person: string | null, p: Partial<ActionPayload>): ActionRecord | null {
  if (typeof p.id !== "string" || !(DRILL_ACTIONS as readonly string[]).includes(p.kind ?? "")) return null;
  if (!isNum(p.atMinute) || !isNum(p.endMinute) || !isNum(p.step)) return null;
  return {
    id: p.id,
    kind: p.kind!,
    person,
    target: strOrNull(p.target),
    callee: (CONTACT_KINDS as readonly string[]).includes(p.callee ?? "") ? p.callee! : null,
    calleeLabel: strOrNull(p.calleeLabel),
    at: isNum(p.at) ? p.at : p.atMinute / 60,
    atMinute: p.atMinute,
    endMinute: p.endMinute,
    minutes: isNum(p.minutes) ? p.minutes : p.endMinute - p.atMinute,
    step: p.step,
    before: p.before ?? { person: null, marks: {}, staff: 0, phone: "ok", roadClosed: false },
    result: null,
    ...(typeof p.memo === "string" && p.memo.trim() ? { memo: p.memo } : {}),
    // 自由対応（T91）: 読み替えた手と文・理由（文と理由はサーバーの中だけ。withoutMemo が落とす）
    ...(isCatalogAction(p.as) ? { as: p.as } : {}),
    ...(typeof p.text === "string" && p.text.trim() ? { text: p.text } : {}),
    ...(typeof p.reason === "string" && p.reason.trim() ? { reason: p.reason } : {}),
  };
}

function asResult(p: Partial<ResultPayload>): { id: string; result: ActionResult } | null {
  if (typeof p.id !== "string" || typeof p.status !== "string" || typeof p.ok !== "boolean" || !isNum(p.atMinute)) return null;
  return {
    id: p.id,
    result: {
      ok: p.ok,
      status: p.status,
      because: strOrNull(p.because),
      text: typeof p.text === "string" ? p.text : "",
      ai: p.ai === true,
      speech: strOrNull(p.speech),
      speechAi: p.speechAi === true,
      pickup: p.pickup ?? null,
      cleared: Array.isArray(p.cleared) ? p.cleared : [],
      staff: isNum(p.staff) ? p.staff : 0,
      crossed: Array.isArray(p.crossed) ? p.crossed.filter(isNum) : [],
      atMinute: p.atMinute,
      heard: asHeard(p.heard),
      // 向かってもらった人の着く時刻（T91）。作り直しでも同じ時刻にする
      ...(isNum(p.arriveAt) ? { arriveAt: p.arriveAt } : {}),
      // 通話の往復・訪問の様子（T93、lib/drill/talk.ts と act が書く）。画面と採点は作り直した状態から読むので写す
      ...dialogueFields(p),
    },
  };
}

/** 通話・訪問で聞いた安否（T21）。形が違えば無し */
function asHeard(v: unknown): HeardSignal | null {
  if (!v || typeof v !== "object") return null;
  const h = v as Partial<HeardSignal>;
  if ((h.via !== "call" && h.via !== "visit") || !(SIGNAL_COLORS as readonly string[]).includes(h.color ?? "") || !isNum(h.at)) return null;
  const b = (x: unknown) => (typeof x === "boolean" ? x : null);
  return {
    via: h.via,
    color: h.color!,
    whereNow: (WHERE_NOW as readonly string[]).includes(h.whereNow ?? "") ? h.whereNow! : null,
    injured: b(h.injured),
    atHome: b(h.atHome),
    canMove: b(h.canMove),
    hasMedicine: b(h.hasMedicine),
    at: h.at,
  };
}

/**
 * 保存した刻み（0 から upTo まで）と、その間のケアマネの手。刻みの時刻は想定の表から（連続の時計の訓練は区切りの時刻。lib/drill/view.ts）。
 * endHour を渡すと、終わりはその時刻に着いた刻み（連続の時計。渡さなければ hours の最後の刻み）
 */
export async function loadTicks(db: D1Database, drillId: string, hours: readonly number[], upTo: number, endHour?: number): Promise<ReplayTick[]> {
  const res = await db
    .prepare(
      `SELECT step, sim_hour, person_id, actor, kind, payload FROM drill_events
        WHERE drill_id = ?1 AND step <= ?2 ORDER BY step, seq`,
    )
    .bind(drillId, upTo)
    .all<Pick<DrillEventRow, "step" | "sim_hour" | "person_id" | "actor" | "kind" | "payload">>();
  const ticks: ReplayTick[] = [];
  for (let i = 0; i <= upTo && i < hours.length; i++) {
    const finished = endHour === undefined ? i === hours.length - 1 : hours[i] >= endHour;
    ticks.push({ step: i, hour: hours[i], incidents: [], turns: [], world: EMPTY_WORLD, finished, acts: [] });
  }
  for (const r of res.results) {
    const t = ticks[r.step];
    if (!t) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (r.kind === "incident") {
      const e = asIncident(r, payload as Partial<IncidentPayload>);
      if (e) t.incidents.push(e);
    } else if (r.kind === "persona_turn") {
      const turn = asTurn(r.person_id, payload as Partial<TurnPayload>);
      if (turn) t.turns.push(turn);
    } else if (r.kind === "action") {
      const record = asAction(r.person_id, payload as Partial<ActionPayload>);
      if (record) t.acts.push({ kind: "action", record });
    } else if (r.kind === "result") {
      const res = asResult(payload as Partial<ResultPayload>);
      if (res) t.acts.push({ kind: "result", ...res });
    }
  }
  return ticks;
}

/**
 * 保存した刻みから upTo の刻みのあとの状態を作り直す（世界は状況を順に当てた物）。
 * 刻みごとに状況・安否を当ててから、その刻みの間のケアマネの手と返事を保存した順に当てる（手を打った要求と同じ所を通る）
 */
export function replayState(
  row: Pick<DrillRow, "scenario" | "started_at" | "status"> & { world?: string },
  participants: ReadonlyArray<string>,
  ticks: ReadonlyArray<Tick & { acts?: ReadonlyArray<ActEvent> }>,
  upTo: number,
): { state: DrillState; ticks: Tick[] } {
  const last = lastStep(row.scenario);
  // 開始の前に選んだ物（職員・夜間発災）と取消の数は drills.world の写しから（T59。無ければ今までと同じ）
  const extras = row.world !== undefined ? extrasOf(parseStoredWorld(row.world)) : {};
  let state = initialState(row.scenario, participants, row.started_at, extras.options, extras.cast);
  const out: Tick[] = [];
  for (const t of ticks) {
    if (t.step > upTo) break;
    state = foldTick(state, t, last);
    out.push({ step: t.step, hour: t.hour, incidents: t.incidents, turns: t.turns, finished: t.finished, world: state.world });
    for (const a of t.acts ?? []) {
      state = a.kind === "action" ? pushAction(state, a.record) : applyResult(state, a.id, a.result);
    }
  }
  // 中断・終了した訓練の途中を見るときも、状態の言葉は訓練の状態のまま
  return { state: { ...state, status: row.status, ...(extras.undone ? { undone: extras.undone } : {}) }, ticks: out };
}

/** 訓練の参加者（drills.world の写しから） */
export function participantsOf(row: Pick<DrillRow, "world">): string[] {
  return parseStoredWorld(row.world).participants;
}
