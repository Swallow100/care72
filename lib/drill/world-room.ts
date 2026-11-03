// 仮想モード（docs/tasks/T50.md）の世界の部屋。Managed Agents（beta）の 1 つの session が 72 時間の街の流れを持ち続ける。
//
// - Agent と Environment は 1 回だけ作り、ID を D1 の ai_agents に持つ（無ければ作る。毎回 create しない）。
//   指示（WORLD_SYSTEM）や道具を変えたら WORLD_AGENT_VERSION を上げる → 次の訓練で agents.update し、新しい訓練から新しい版
// - 訓練ごとに session を 1 つ（最初の仮想の刻みで作る。drills.world の session と drills.world_session_id に持つ）。
//   予算は max_list_cost $3。訓練が終わっても archive・delete しない
// - 道具は custom tool の world_step だけ（砂場の道具 agent_toolset は付けない）。返事の形は world_step の schema で縛り、
//   受け取った input をまた zod（WorldStepSchema）で確かめる
// - 刻みごと: events.send で user.message を 1 つ（仮名化した文だけ。最初の刻みに地理と本人たち、以後は刻みの文だけ）→
//   events.list を 1.5 秒ごとに読み、world_step の呼び出しに user.custom_tool_result を返し、idle になるまで待つ。60 秒で時間切れ。
//   Workers の 1 要求の中で済ませる（SSE の stream は使わない。長い接続を持てない）
// - 1 刻み 1 回を ai_calls に残す（用途 director。上限に達したら呼ばない）
// - 落ちたら（鍵なし・作れない・時間切れ・形の違い・上限・送れない）投げる。呼ぶ側（createWorldHook）が 1 回呼びに落とす

import type { D1Database } from "@cloudflare/workers-types";
import Anthropic from "@anthropic-ai/sdk";
import { COMMON_SYSTEM, type AskJsonContext } from "../claude/call.ts";
import { keyOf, type AiEnv } from "../claude/client.ts";
import { AiBadOutput, AiCallFailed, AiNotConfigured } from "../claude/errors.ts";
import { OPUS } from "../claude/models.ts";
import { beginCall } from "../claude/usage.ts";
import { pseudonymizeText, type PseudonymInput } from "../pseudonym/index.ts";
import type { DrillIncident, WorldHook, WorldInput, WorldResult } from "./engine.ts";
import type { OutcomeSource } from "./outcome.ts";
import { isPersonaFailure } from "./persona.ts";
import { lastHour, scenarioOf } from "./scenarios.ts";
import { fallbackIncidents, WorldStepSchema, worldIncidents, type WorldStep } from "./world-apply.ts";
import { applyContext, buildCast, openingText, tickText, WORLD_STEP_JSON_SCHEMA, WORLD_SYSTEM, worldOneshot, type WorldCast } from "./world-oneshot.ts";

/** 指示・道具の版。WORLD_SYSTEM か world_step の形を変えたら 1 つ上げる */
export const WORLD_AGENT_VERSION = 1;
export const WORLD_TOOL = "world_step";
/** session の予算（セント。$3） */
export const WORLD_BUDGET_CENTS = "300";
export const POLL_MS = 1500;
export const ROOM_TIMEOUT_MS = 60_000;

// ---------- client（偽物を差し替えられる形） ----------

/** 部屋の出来事のうち読む物 */
export type RoomEvent = {
  id: string;
  type: string;
  name?: string;
  input?: unknown;
  stop_reason?: { type: string } | null;
};

/** world-room が使う所だけの形。テストは偽物を渡す（本物の API を呼ばない） */
export interface RoomClient {
  agents: {
    create(params: Record<string, unknown>): Promise<{ id: string; version: number }>;
    update(id: string, params: Record<string, unknown>): Promise<{ id: string; version: number }>;
  };
  environments: { create(params: Record<string, unknown>): Promise<{ id: string }> };
  sessions: {
    create(params: Record<string, unknown>): Promise<{ id: string }>;
    send(sessionId: string, events: ReadonlyArray<Record<string, unknown>>): Promise<{ ids: string[] }>;
    /** 出来事を古い順に（after より後に処理された物） */
    list(sessionId: string, after: string): Promise<RoomEvent[]>;
  };
}

/** SDK の client を部屋の形に包む（beta header managed-agents-2026-04-01 は SDK が付ける） */
export function roomClientOf(env: AiEnv): RoomClient {
  const apiKey = keyOf(env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new AiNotConfigured("anthropic");
  const c = new Anthropic({ apiKey, maxRetries: 1 });
  type P<T extends (...a: never[]) => unknown> = Parameters<T>[0];
  return {
    agents: {
      create: async (p) => {
        const a = await c.beta.agents.create(p as unknown as P<typeof c.beta.agents.create>);
        return { id: a.id, version: a.version };
      },
      update: async (id, p) => {
        const a = await c.beta.agents.update(id, p as unknown as Parameters<typeof c.beta.agents.update>[1]);
        return { id: a.id, version: a.version };
      },
    },
    environments: {
      create: async (p) => ({ id: (await c.beta.environments.create(p as unknown as P<typeof c.beta.environments.create>)).id }),
    },
    sessions: {
      create: async (p) => ({ id: (await c.beta.sessions.create(p as unknown as P<typeof c.beta.sessions.create>)).id }),
      send: async (id, events) => {
        const r = (await c.beta.sessions.events.send(id, {
          events: events as unknown as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
        })) as unknown as { data?: Array<{ id: string }> };
        return { ids: (r.data ?? []).map((e) => e.id) };
      },
      list: async (id, after) => {
        const out: RoomEvent[] = [];
        for await (const e of c.beta.sessions.events.list(id, { "created_at[gte]": after, order: "asc" })) out.push(e as unknown as RoomEvent);
        return out;
      },
    },
  };
}

// ---------- Agent と Environment（1 回だけ） ----------

export type WorldAgent = { agentId: string; agentVersion: number; environmentId: string };

/** 部屋の Agent の設定（作る・版を上げる、で同じ物） */
export function agentParams(): Record<string, unknown> {
  return {
    name: "care72-drill-world",
    description: "ケア72 の仮想モードの訓練の世界（架空の街の 72 時間）",
    model: { id: OPUS, effort: "medium" },
    system: [COMMON_SYSTEM, WORLD_SYSTEM, `毎刻み、${WORLD_TOOL} の道具を 1 回だけ呼んで返す。道具の結果を受け取ったら短く終える。`].join("\n\n"),
    tools: [
      {
        type: "custom",
        name: WORLD_TOOL,
        description: "この刻みの世界（街の様子の 1 文・出来事・結末の 1 文）を返す。毎刻み 1 回だけ呼ぶ",
        input_schema: WORLD_STEP_JSON_SCHEMA,
      },
    ],
  };
}

type AgentRow = { version: number; agent_id: string; agent_version: number; environment_id: string };

/**
 * ai_agents の行を読み、無ければ Environment と Agent を作って残す。コードの版が新しければ agents.update で版を上げる。
 * 同時に 2 つの要求が作ったときは先に書いた方を使う（後の Agent は使わずに残る。消さない）
 */
export async function ensureWorldAgent(db: D1Database, client: RoomClient, now: string): Promise<WorldAgent> {
  const read = () =>
    db
      .prepare("SELECT version, agent_id, agent_version, environment_id FROM ai_agents WHERE purpose = 'drill_world'")
      .first<AgentRow>();
  const row = await read();
  if (row && row.version >= WORLD_AGENT_VERSION) {
    return { agentId: row.agent_id, agentVersion: row.agent_version, environmentId: row.environment_id };
  }
  if (row) {
    const a = await client.agents.update(row.agent_id, agentParams());
    await db
      .prepare("UPDATE ai_agents SET version = ?1, agent_version = ?2, updated_at = ?3 WHERE purpose = 'drill_world' AND version = ?4")
      .bind(WORLD_AGENT_VERSION, a.version, now, row.version)
      .run();
    const again = await read();
    return { agentId: again!.agent_id, agentVersion: again!.agent_version, environmentId: again!.environment_id };
  }
  const env = await client.environments.create({ name: "care72-drill-world", config: { type: "cloud", networking: { type: "limited" } } });
  const a = await client.agents.create(agentParams());
  await db
    .prepare(
      `INSERT INTO ai_agents (purpose, version, agent_id, agent_version, environment_id, updated_at)
       VALUES ('drill_world', ?1, ?2, ?3, ?4, ?5) ON CONFLICT (purpose) DO NOTHING`,
    )
    .bind(WORLD_AGENT_VERSION, a.id, a.version, env.id, now)
    .run();
  const saved = await read();
  return { agentId: saved!.agent_id, agentVersion: saved!.agent_version, environmentId: saved!.environment_id };
}

/** 訓練の session を作る（予算 $3） */
export async function createWorldSession(client: RoomClient, agent: WorldAgent): Promise<string> {
  const s = await client.sessions.create({
    agent: { type: "agent", id: agent.agentId, version: agent.agentVersion },
    environment_id: agent.environmentId,
    title: "ケア72 仮想訓練",
    budget: { type: "limit", max_list_cost: { amount: WORLD_BUDGET_CENTS, currency: "USD" } },
  });
  return s.id;
}

// ---------- 1 刻み ----------

export class RoomFailed extends Error {
  readonly code: "timeout" | "bad_output" | "api_error";
  /** 作ったあとに落ちた session（次の刻みも使う） */
  readonly session: string | null;
  constructor(code: RoomFailed["code"], why: string, session: string | null) {
    super(`世界の部屋: ${why}`);
    this.name = "RoomFailed";
    this.code = code;
    this.session = session;
  }
}

export type RoomDeps = {
  db: D1Database;
  client: RoomClient;
  ai: AskJsonContext;
  /** 待ち（テストで差し替え） */
  sleep?: (ms: number) => Promise<void>;
  /** 時計（ミリ秒。テストで差し替え） */
  clock?: () => number;
  timeoutMs?: number;
};

const sleeping = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const TERMINAL_IDLE = new Set(["end_turn", "retries_exhausted", "budget_reached"]);

/**
 * 部屋で世界の 1 刻み。送る文は仮名化した物だけ（pseudonymizeText）。session が無ければ作り、最初の文に地理と本人たちを入れる。
 * world_step の呼び出しに結果を返し、idle（end_turn）まで待つ。形の違う呼び出しにも結果は返す（session を待たせたままにしない）
 */
export async function roomStep(
  input: WorldInput,
  cast: WorldCast,
  deps: RoomDeps,
  opts: { prevHour: number; last: number },
): Promise<{ session: string; step: WorldStep; incidents: DrillIncident[] }> {
  const sleep = deps.sleep ?? sleeping;
  const clock = deps.clock ?? Date.now;
  const timeout = deps.timeoutMs ?? ROOM_TIMEOUT_MS;
  let session = input.session;
  const fresh = !session;
  const startedAt = new Date((deps.ai.now?.() ?? new Date()).getTime()).toISOString();
  // 上限を先に確かめる（上限なら部屋を作らない）。1 刻み 1 行
  const ticket = await beginCall(deps.ai, "director", OPUS);
  const fail = async (code: RoomFailed["code"], why: string): Promise<never> => {
    await ticket.fail(code);
    throw new RoomFailed(code, why, session);
  };
  if (!session) {
    try {
      const agent = await ensureWorldAgent(deps.db, deps.client, startedAt);
      session = await createWorldSession(deps.client, agent);
    } catch {
      return fail("api_error", "部屋を作れない");
    }
  }
  const room: string = session;
  // 最初の刻み（または部屋をこの刻みで作り直した）は地理・本人たち・これまでの世界、以後は刻みの文だけ
  const story = input.world.story ?? [];
  const body = fresh
    ? [openingText(input, cast, opts.last), ...(story.length > 0 ? [["これまでの世界:", ...story].join("\n")] : [])].join("\n\n")
    : tickText(input, cast, opts.prevHour, opts.last);
  let text: string;
  try {
    text = pseudonymizeText(body, cast.key).text;
  } catch {
    return fail("bad_output", "伏せきれない");
  }
  const since = new Date(clock() - 5_000).toISOString();
  let sent: string[];
  try {
    sent = (await deps.client.sessions.send(room, [{ type: "user.message", content: [{ type: "text", text }] }])).ids;
  } catch {
    return fail("api_error", "送れない");
  }
  const deadline = clock() + timeout;
  const handled = new Set<string>();
  let answer: WorldStep | null = null;
  let mine = sent.length === 0;
  while (clock() < deadline) {
    await sleep(POLL_MS);
    let events: RoomEvent[];
    try {
      events = await deps.client.sessions.list(room, since);
    } catch {
      continue; // 読みの一時の失敗は次の読みで取り直す（id で揃える）
    }
    for (const e of events) {
      if (!mine) {
        if (sent.includes(e.id)) mine = true;
        continue;
      }
      if (handled.has(e.id)) continue;
      handled.add(e.id);
      if (e.type === "agent.custom_tool_use") {
        const ok: ReturnType<typeof WorldStepSchema.safeParse> | null = e.name === WORLD_TOOL && answer === null ? WorldStepSchema.safeParse(e.input) : null;
        if (ok?.success) answer = ok.data;
        const reply = ok?.success ? "受け取った" : answer ? "この刻みは受け取り済み" : "形が違うので使わない";
        try {
          await deps.client.sessions.send(room, [{ type: "user.custom_tool_result", custom_tool_use_id: e.id, content: [{ type: "text", text: reply }] }]);
        } catch {
          return fail("api_error", "結果を返せない");
        }
      } else if (e.type === "session.error" || e.type === "session.status_terminated") {
        return fail("api_error", e.type);
      } else if (e.type === "session.status_idle" && e.stop_reason && TERMINAL_IDLE.has(e.stop_reason.type)) {
        if (answer) {
          await ticket.ok({ model: OPUS, inputTokens: null, outputTokens: null });
          return { session: room, step: answer, incidents: worldIncidents(answer, applyContext(input, cast, "room"), input.outcomes) };
        }
        return fail("bad_output", `world_step なしで止まった（${e.stop_reason.type}）`);
      }
    }
  }
  return fail("timeout", "60 秒で返らない");
}

// ---------- 呼び口（部屋 → 1 回呼び → 差し込みなし） ----------

export type WorldMode = "session" | "messages" | "off";

/** env の DRILL_WORLD（session 既定・messages・off） */
export function worldModeOf(raw: string | undefined): WorldMode {
  const v = raw?.trim().toLowerCase();
  return v === "messages" || v === "off" ? v : "session";
}

export type WorldDeps = {
  mode: WorldMode;
  load: () => Promise<ReadonlyMap<string, PseudonymInput>>;
  loadOutcome: () => Promise<ReadonlyMap<string, OutcomeSource>>;
  ai: AskJsonContext;
  /** 部屋（mode が session のとき）。無ければ 1 回呼び */
  room?: () => RoomDeps;
  on?: string;
};

/**
 * engine の WorldHook を作る（1 要求ごと）。部屋が使えなければ、その刻みは 1 回呼びに落ち（「世界 代替」の印）、
 * それも失敗なら世界は動かさず結末だけ固定の文で進む
 */
export function createWorldHook(deps: WorldDeps): WorldHook {
  return async (input): Promise<WorldResult> => {
    const hours = scenarioOf(input.scenario).hours;
    const opts = { prevHour: input.step > 0 ? hours[input.step - 1] : 0, last: lastHour(scenarioOf(input.scenario)) };
    if (deps.mode === "off") return { incidents: fallbackIncidents(input.hour, input.outcomes, "off") };
    let cast: WorldCast;
    try {
      cast = buildCast(input.participants, await deps.load(), await deps.loadOutcome(), deps.on);
    } catch (e) {
      if (!isPersonaFailure(e)) console.error("世界の台帳を読めない", e instanceof Error ? e.name : typeof e);
      return { incidents: fallbackIncidents(input.hour, input.outcomes, "down") };
    }
    let session = input.session;
    let fellBack = false;
    if (deps.mode === "session" && deps.room) {
      try {
        const r = await roomStep(input, cast, deps.room(), opts);
        return { incidents: r.incidents, session: r.session };
      } catch (e) {
        if (e instanceof RoomFailed) session = e.session;
        else if (!isPersonaFailure(e)) console.error("世界の部屋に失敗", e instanceof Error ? e.name : typeof e);
        fellBack = true;
      }
    }
    try {
      const r = await worldOneshot(input, cast, deps.ai, opts);
      const note: DrillIncident[] = fellBack ? [{ actor: "director", at: input.hour, change: { kind: "world_note", state: "down" }, text: "世界 代替", ai: false }] : [];
      return { incidents: [...note, ...r.incidents], ...(session !== input.session ? { session } : {}) };
    } catch (e) {
      if (!isPersonaFailure(e) && !(e instanceof AiBadOutput) && !(e instanceof AiCallFailed)) {
        console.error("世界の 1 回呼びに失敗", e instanceof Error ? e.name : typeof e);
      }
      return { incidents: fallbackIncidents(input.hour, input.outcomes, "down"), ...(session !== input.session ? { session } : {}) };
    }
  };
}
