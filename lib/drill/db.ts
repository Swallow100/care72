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
  foldTick,
  initialState,
  lastStep,
  simAt,
  step,
  type ActionRecord,
  type ActionResult,
  type DrillIncident,
  type DrillState,
  type DrillTurn,
  type PersonState,
  type StepHooks,
  type Tick,
} from "./engine.ts";
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

/** drills.world に置く今の状態（世界・参加者・本人の様子・手の履歴・ケアマネの時計）。刻みと状態は表の列 */
type StoredWorld = {
  v: 1;
  participants: string[];
  world: WorldState;
  people: Record<string, PersonState>;
  actions: ActionRecord[];
  /** ケアマネの時計（発災からの分、T20）。無ければ刻みの時刻 */
  minute?: number;
};

function storeWorld(s: DrillState): string {
  const body: StoredWorld = { v: 1, participants: s.participants, world: s.world, people: s.people, actions: s.actions, minute: s.minute };
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
    ...(typeof raw.minute === "number" ? { minute: raw.minute } : {}),
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
    minute: w.minute ?? row.sim_hour * 60,
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
 * 刻み 1 つの保存の文（drills の行がその刻みにあるときだけ書く）。during は手の途中で進んだ刻みのときの手の番号で、
 * その刻みの安否を着信（call_in）としても残す（着信の画面と声は T21 が読む）
 */
function tickStatements(db: D1Database, drillId: string, tick: Tick, startedAt: string, gate: Gate = { step: tick.step }, during?: string) {
  const out = [];
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
    if (during) {
      const call: CallInPayload = { signal: sid, during, source: t.source, color: t.color, saying: t.saying, ai: t.ai };
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

/** 着信（手の途中に来た安否）。T21 が着信の画面と声に使う。言う事は安否の文字起こしと同じ */
type CallInPayload = Pick<DrillTurn, "source" | "color" | "saying" | "ai"> & { signal: string; during: string };

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
    // 読んだ今の状態（world の写し）のときだけ書く。その間にケアマネの手（T20）が入っていれば競合（手の履歴を消さない）
    [updated] = await db.batch([
      db
        .prepare(
          `UPDATE drills SET step = ?3, sim_hour = ?4, world = ?5, status = ?6, finished_at = ?7
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
  return { ok: true, step: state.step, hour: state.hour, status: state.status };
}

// ---------- ケアマネの手（T20） ----------

export type ActRequest = { kind: DrillAction; person: string | null; target: string | null };

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
  const asTarget = (c: ContactForAct): ActTarget => ({ id: c.id, kind: c.kind, label: callTargetText(c), hasPhone: c.has_phone === 1 });
  if (req.kind === "call_person") {
    const self = rows.results.find((c) => c.kind === "self" && c.has_phone === 1) ?? rows.results.find((c) => c.kind === "self");
    return { ok: true, target: self ? asTarget(self) : null };
  }
  if (req.target === null) return needsTarget(req.kind) ? { ok: false } : { ok: true, target: null };
  const hit = rows.results.find((c) => c.id === req.target);
  if (!hit || !kinds.includes(hit.kind)) return { ok: false };
  return { ok: true, target: asTarget(hit) };
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
  if (row.status !== "running" || row.step >= lastStep(row.scenario)) return { ok: false, error: "ended" };
  const before = stateOfRow(row);
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
  const { state, record, ticks } = await act(before, { kind: req.kind, person, target: resolved.target }, opts.hooks ?? {}, opts.roll ?? Math.random, extra);
  const gate: Gate = { step: state.step, actions: state.actions.length };
  const { result: maybe, ...actionPayload } = record;
  // act は返事を当ててから返す（null は刻みを越える途中だけ）
  const result: ActionResult = maybe!;
  let updated;
  try {
    [updated] = await db.batch([
      db
        .prepare(
          `UPDATE drills SET step = ?3, sim_hour = ?4, world = ?5, status = ?6, finished_at = ?7
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
    },
  };
}

/** 保存した刻み（0 から upTo まで）と、その間のケアマネの手。刻みの時刻は想定の表から */
export async function loadTicks(db: D1Database, drillId: string, hours: readonly number[], upTo: number): Promise<ReplayTick[]> {
  const res = await db
    .prepare(
      `SELECT step, sim_hour, person_id, actor, kind, payload FROM drill_events
        WHERE drill_id = ?1 AND step <= ?2 ORDER BY step, seq`,
    )
    .bind(drillId, upTo)
    .all<Pick<DrillEventRow, "step" | "sim_hour" | "person_id" | "actor" | "kind" | "payload">>();
  const ticks: ReplayTick[] = [];
  for (let i = 0; i <= upTo && i < hours.length; i++) {
    ticks.push({ step: i, hour: hours[i], incidents: [], turns: [], world: EMPTY_WORLD, finished: i === hours.length - 1, acts: [] });
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
  row: Pick<DrillRow, "scenario" | "started_at" | "status">,
  participants: ReadonlyArray<string>,
  ticks: ReadonlyArray<Tick & { acts?: ReadonlyArray<ActEvent> }>,
  upTo: number,
): { state: DrillState; ticks: Tick[] } {
  const last = lastStep(row.scenario);
  let state = initialState(row.scenario, participants, row.started_at);
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
  return { state: { ...state, status: row.status }, ticks: out };
}

/** 訓練の参加者（drills.world の写しから） */
export function participantsOf(row: Pick<DrillRow, "world">): string[] {
  return parseStoredWorld(row.world).participants;
}
