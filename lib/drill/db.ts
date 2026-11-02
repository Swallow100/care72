// 訓練の保存（docs/tasks/T17.md）。表は drills・drill_events・signals（drill_id 付き）。D1 と範囲を引数で受け取る（テストで node:sqlite）。
//
// - 1 刻みごとに 1 つの batch（取引）で保存する: drills の刻みを進め（読んだ刻みのときだけ）、状況と本人の 1 刻みを drill_events に、
//   安否を signals に drill_id 付きで足す。途中から再開できる（drills.world に今の状態、drill_events から刻みごとに作り直せる）
// - 重なった「進める」（早送りと二度押し）は片方だけ通る。読んだ刻みと違えば競合。同じ刻みを 2 回書こうとしても id が重なり取引ごと戻る
// - 本人の経過（timeline_entries）には何も書かない。本番の読み方（drill_id IS NULL）に混ざらない
// - 事業所ごとに進行中は 1 つ（審査員は同じデモ事業所を使う。進行中があれば開始を断り、再開か中断へ）
// - 範囲はケアマネの役（審査員のケアマネの役を含む）と事業所。参加する本人は始めたときの担当一覧の人

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import {
  DRILL_SCENARIOS,
  DRILL_STATUSES,
  SIGNAL_COLORS,
  WHERE_NOW,
  type DrillEventRow,
  type DrillRow,
  type DrillScenario,
} from "../db/types.ts";
import {
  foldTick,
  initialState,
  lastStep,
  simAt,
  step,
  type ActionRecord,
  type DrillIncident,
  type DrillState,
  type DrillTurn,
  type PersonState,
  type StepHooks,
  type Tick,
} from "./engine.ts";
import { isSourceId } from "../sources/index.ts";
import { EMPTY_WORLD, isInjectKind, type WorldState } from "./scenarios.ts";

/** 訓練を開ける範囲。ケアマネの役だけ（審査員のケアマネの役も）。事業所と担当一覧の持ち主 */
export type DrillScope = { officeId: string; careManagerId: string; accountId: string | null };

export function drillScope(p: Principal | null): DrillScope | null {
  if (!p || p.role !== "care_manager" || !p.office || !p.caseloadOf) return null;
  return { officeId: p.office.id, careManagerId: p.caseloadOf, accountId: p.accountId };
}

export function isDrillScenario(v: unknown): v is DrillScenario {
  return typeof v === "string" && (DRILL_SCENARIOS as readonly string[]).includes(v);
}

// ---------- drills.world の JSON ----------

/** drills.world に置く今の状態（世界・参加者・本人の様子・手の履歴）。刻みと状態は表の列 */
type StoredWorld = {
  v: 1;
  participants: string[];
  world: WorldState;
  people: Record<string, PersonState>;
  actions: ActionRecord[];
};

function storeWorld(s: DrillState): string {
  const body: StoredWorld = { v: 1, participants: s.participants, world: s.world, people: s.people, actions: s.actions };
  return JSON.stringify(body);
}

function parseStoredWorld(text: string): StoredWorld {
  const raw = JSON.parse(text) as Partial<StoredWorld>;
  return {
    v: 1,
    participants: Array.isArray(raw.participants) ? raw.participants.filter((x): x is string => typeof x === "string") : [],
    world: { ...EMPTY_WORLD, ...(raw.world ?? {}) },
    people: raw.people ?? {},
    actions: Array.isArray(raw.actions) ? raw.actions : [],
  };
}

/** 表の行から今の状態（drills.world の写しから。再開に使う） */
export function stateOfRow(row: DrillRow): DrillState {
  const w = parseStoredWorld(row.world);
  return {
    scenario: row.scenario,
    startedAt: row.started_at,
    step: row.step,
    hour: row.sim_hour,
    status: row.status,
    participants: w.participants,
    world: w.world,
    people: w.people,
    actions: w.actions,
  };
}

// ---------- drill_events の形 ----------

type IncidentPayload = Omit<DrillIncident, "actor" | "person">;
type TurnPayload = Omit<DrillTurn, "person"> & { signal: string };

const eventId = (drillId: string, stepIndex: number, i: number) => `${drillId}-${stepIndex}-e${i}`;
const signalId = (drillId: string, stepIndex: number, i: number) => `${drillId}-${stepIndex}-s${i}`;

const bit = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

/** 刻み 1 つの保存の文（drills の行がその刻みにあるときだけ書く） */
function tickStatements(db: D1Database, drillId: string, tick: Tick, startedAt: string) {
  const out = [];
  const gate = "WHERE EXISTS (SELECT 1 FROM drills WHERE id = ?2 AND step = ?3)";
  const seq = "(SELECT COALESCE(MAX(seq), 0) + 1 FROM drill_events WHERE drill_id = ?2)";
  let n = 0;
  for (const e of tick.incidents) {
    const { actor, person, ...rest } = e;
    const payload: IncidentPayload = rest;
    out.push(
      db
        .prepare(
          `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
           SELECT ?1, ?2, ${seq}, ?3, ?4, ?5, ?6, 'incident', ?7 ${gate}`,
        )
        .bind(eventId(drillId, tick.step, n++), drillId, tick.step, e.at, person ?? null, actor, JSON.stringify(payload)),
    );
  }
  tick.turns.forEach((t, i) => {
    const sid = signalId(drillId, tick.step, i);
    const { person, ...rest } = t;
    const payload: TurnPayload = { ...rest, signal: sid };
    out.push(
      db
        .prepare(
          `INSERT INTO signals (id, person_id, drill_id, color, source, where_now, injured, at_home, can_move, has_medicine,
                                transcript, occurred_at)
           SELECT ?1, ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
            WHERE EXISTS (SELECT 1 FROM drills d JOIN people p ON p.office_id = d.office_id
                           WHERE d.id = ?2 AND d.step = ?3 AND p.id = ?4)`,
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
        ),
      db
        .prepare(
          `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
           SELECT ?1, ?2, ${seq}, ?3, ?4, ?5, 'persona', 'persona_turn', ?6 ${gate}`,
        )
        .bind(eventId(drillId, tick.step, n++), drillId, tick.step, t.at, person, JSON.stringify(payload)),
    );
  });
  return out;
}

// ---------- 開始・進める・中断 ----------

export type StartResult = { ok: true; id: string } | { ok: false; error: "running" | "empty" };

/** 担当一覧の人（一覧から外した人は出ない） */
async function caseloadPeople(db: D1Database, scope: DrillScope): Promise<string[]> {
  const res = await db
    .prepare("SELECT id FROM people WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NULL ORDER BY kana, id")
    .bind(scope.careManagerId, scope.officeId)
    .all<{ id: string }>();
  return res.results.map((r) => r.id);
}

/** 訓練を始める。0 時間の刻みまで当てて保存する。事業所に進行中があれば断る */
export async function startDrill(
  db: D1Database,
  scope: DrillScope,
  scenario: DrillScenario,
  now: string,
  hooks: StepHooks = {},
  newId: () => string = () => crypto.randomUUID(),
): Promise<StartResult> {
  const participants = await caseloadPeople(db, scope);
  if (participants.length === 0) return { ok: false, error: "empty" };
  const running = await db
    .prepare("SELECT 1 AS x FROM drills WHERE office_id = ?1 AND status = 'running'")
    .bind(scope.officeId)
    .first<{ x: number }>();
  if (running) return { ok: false, error: "running" };

  const id = newId();
  const { state, tick } = await step(initialState(scenario, participants, now), hooks);
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO drills (id, office_id, scenario, status, step, sim_hour, world, started_by, started_at, finished_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
          WHERE NOT EXISTS (SELECT 1 FROM drills WHERE office_id = ?2 AND status = 'running')`,
      )
      .bind(
        id,
        scope.officeId,
        scenario,
        state.status,
        state.step,
        state.hour,
        storeWorld(state),
        scope.accountId,
        now,
        state.status === "finished" ? now : null,
      ),
    ...tickStatements(db, id, tick, now),
  ]);
  if ((inserted.meta.changes ?? 0) === 0) return { ok: false, error: "running" };
  return { ok: true, id };
}

export type AdvanceResult =
  | { ok: true; step: number; hour: number; status: DrillRow["status"] }
  | { ok: false; error: "not_found" | "conflict" | "ended" };

/** 事業所の中の訓練を 1 つ。範囲の外は null */
export async function loadDrillRow(
  db: D1Database,
  officeId: string,
  id: string,
): Promise<(DrillRow & { started_by_name: string | null }) | null> {
  return db
    .prepare(
      `SELECT d.*, a.display_name AS started_by_name FROM drills d LEFT JOIN accounts a ON a.id = d.started_by
        WHERE d.id = ?1 AND d.office_id = ?2`,
    )
    .bind(id, officeId)
    .first<DrillRow & { started_by_name: string | null }>();
}

/**
 * 1 刻み進める。expected は画面で読んだ今の刻み（違えば競合）。最後の刻みに着いたら終了。
 * 保存は 1 つの取引で、drills の刻みを進められたときだけ状況と安否を足す
 */
export async function advanceDrill(
  db: D1Database,
  scope: DrillScope,
  id: string,
  expected: number,
  now: string,
  hooks: StepHooks = {},
): Promise<AdvanceResult> {
  const row = await loadDrillRow(db, scope.officeId, id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "running" || row.step >= lastStep(row.scenario)) return { ok: false, error: "ended" };
  if (row.step !== expected) return { ok: false, error: "conflict" };

  const { state, tick } = await step(stateOfRow(row), hooks);
  let updated;
  try {
    [updated] = await db.batch([
      db
        .prepare(
          `UPDATE drills SET step = ?3, sim_hour = ?4, world = ?5, status = ?6, finished_at = ?7
            WHERE id = ?1 AND office_id = ?2 AND step = ?8 AND status = 'running'`,
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
        ),
      ...tickStatements(db, id, tick, row.started_at),
    ]);
  } catch (e) {
    // 同じ刻みをほかの要求が先に書いた（id が重なった）。取引ごと戻っている
    if (e instanceof Error && /UNIQUE|PRIMARY KEY|constraint/i.test(e.message)) return { ok: false, error: "conflict" };
    throw e;
  }
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  return { ok: true, step: state.step, hour: state.hour, status: state.status };
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

export type DrillListItem = Pick<DrillRow, "id" | "scenario" | "status" | "step" | "sim_hour" | "started_at" | "finished_at"> & {
  started_by_name: string | null;
};

/** 事業所の訓練記録（新しい順） */
export async function listDrills(db: D1Database, officeId: string, limit = 50): Promise<DrillListItem[]> {
  const res = await db
    .prepare(
      `SELECT d.id, d.scenario, d.status, d.step, d.sim_hour, d.started_at, d.finished_at, a.display_name AS started_by_name
         FROM drills d LEFT JOIN accounts a ON a.id = d.started_by
        WHERE d.office_id = ?1 ORDER BY d.started_at DESC, d.id LIMIT ?2`,
    )
    .bind(officeId, limit)
    .all<DrillListItem>();
  return res.results.filter(
    (r) => (DRILL_SCENARIOS as readonly string[]).includes(r.scenario) && (DRILL_STATUSES as readonly string[]).includes(r.status),
  );
}

/** 事業所の進行中の訓練（無ければ null） */
export async function runningDrillId(db: D1Database, officeId: string): Promise<string | null> {
  const r = await db
    .prepare("SELECT id FROM drills WHERE office_id = ?1 AND status = 'running' ORDER BY started_at DESC LIMIT 1")
    .bind(officeId)
    .first<{ id: string }>();
  return r?.id ?? null;
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

/** 保存した刻み（0 から upTo まで）。刻みの時刻は想定の表から */
export async function loadTicks(db: D1Database, drillId: string, hours: readonly number[], upTo: number): Promise<Tick[]> {
  const res = await db
    .prepare(
      `SELECT step, sim_hour, person_id, actor, kind, payload FROM drill_events
        WHERE drill_id = ?1 AND step <= ?2 ORDER BY step, seq`,
    )
    .bind(drillId, upTo)
    .all<Pick<DrillEventRow, "step" | "sim_hour" | "person_id" | "actor" | "kind" | "payload">>();
  const ticks: Tick[] = [];
  for (let i = 0; i <= upTo && i < hours.length; i++) {
    ticks.push({ step: i, hour: hours[i], incidents: [], turns: [], world: EMPTY_WORLD, finished: i === hours.length - 1 });
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
    }
  }
  return ticks;
}

/** 保存した刻みから upTo の刻みのあとの状態を作り直す（世界は状況を順に当てた物） */
export function replayState(
  row: Pick<DrillRow, "scenario" | "started_at" | "status">,
  participants: ReadonlyArray<string>,
  ticks: ReadonlyArray<Tick>,
  upTo: number,
): { state: DrillState; ticks: Tick[] } {
  const last = lastStep(row.scenario);
  let state = initialState(row.scenario, participants, row.started_at);
  const out: Tick[] = [];
  for (const t of ticks) {
    if (t.step > upTo) break;
    state = foldTick(state, t, last);
    out.push({ ...t, world: state.world });
  }
  // 中断・終了した訓練の途中を見るときも、状態の言葉は訓練の状態のまま
  return { state: { ...state, status: row.status }, ticks: out };
}

/** 訓練の参加者（drills.world の写しから） */
export function participantsOf(row: Pick<DrillRow, "world">): string[] {
  return parseStoredWorld(row.world).participants;
}
