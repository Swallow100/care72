// T89: 手元の試験の所見の直し（訓練の側）。本物の API は呼ばない（偽の部屋・偽の呼び口）。
// - 世界の部屋: 1 刻みに道具を 1 回だけ・結果のあとは文字を返さない指示と、部屋の Agent の版。2 回呼ばれたら 1 回目だけ使う守り
// - 本人役の effort は medium（ほかは high、分類は low）
// - 固定の筋の 1 刻みは 監督 → 本人役 の順（本人役は同じ刻みの監督の差し込みを読む。並べない理由）

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { HAIKU, OPUS, PURPOSES, SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { initialState, step, type DrillTurn, type PersonaInput, type WorldInput } from "./engine.ts";
import { loadOutcomeSources } from "./outcome.ts";
import { loadPersonaSources } from "./persona.ts";
import { EMPTY_WORLD } from "./scenarios.ts";
import type { WorldStep } from "./world-apply.ts";
import { buildCast } from "./world-oneshot.ts";
import { agentParams, ROOM_TURN_RULE, roomStep, TOOL_REPLIES, WORLD_AGENT_VERSION, WORLD_TOOL, type RoomClient, type RoomEvent } from "./world-room.ts";

const START = "2026-11-05T01:00:00.000Z";
const ON = "2026-11-05";
const DEMO = { id: "office-demo", kind: "demo" as const };
const IDS = SEED_PEOPLE.map((p) => p.person.id);

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const aiCtx = (): AskJsonContext => ({ env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(db), office: DEMO, now: () => new Date(START) });
const aiRows = () => sqlite.prepare("SELECT purpose, model, status FROM ai_calls ORDER BY started_at, id").all() as Array<Record<string, string>>;

/** 待たない時計（1 回の待ちで 1.5 秒進む） */
function fastClock() {
  let t = 0;
  return { sleep: async (ms: number) => void (t += ms), clock: () => t };
}

const FIRST: WorldStep = {
  narration: "甲地区で白波川が増水している",
  events: [{ kind: "outage", town: "甲地区", target: "", name: "", value: "start" }],
  farewells: [],
};
const SECOND: WorldStep = { narration: "乙地区で雨が強まっている", events: [], farewells: [] };

/**
 * 偽の部屋: user.message 1 つに world_step の呼び出しを 2 つ出す（手元の試験で見た形）。
 * 返した結果の文を replies に残し、2 つとも答えたら止まる（end_turn）
 */
function twiceRoom(first: unknown, second: unknown) {
  const events: RoomEvent[] = [];
  const replies: Array<{ use: string; text: string }> = [];
  let n = 0;
  const client: RoomClient = {
    agents: { create: async () => ({ id: "agent_1", version: 1 }), update: async () => ({ id: "agent_1", version: 2 }) },
    environments: { create: async () => ({ id: "env_1" }) },
    sessions: {
      create: async () => ({ id: "sesn_1" }),
      send: async (_id, evs) => {
        const ids: string[] = [];
        for (const e of evs) {
          const id = `ev_${++n}`;
          ids.push(id);
          if (e.type === "user.message") {
            events.push({ id, type: "user.message" });
            events.push({ id: `ev_${++n}`, type: "agent.custom_tool_use", name: WORLD_TOOL, input: first });
            events.push({ id: `ev_${++n}`, type: "agent.custom_tool_use", name: WORLD_TOOL, input: second });
          } else if (e.type === "user.custom_tool_result") {
            const use = String(e.custom_tool_use_id);
            replies.push({ use, text: (e.content as Array<{ text: string }>)[0].text });
            events.push({ id, type: "user.custom_tool_result", custom_tool_use_id: use });
            if (replies.length === 2) events.push({ id: `ev_${++n}`, type: "session.status_idle", stop_reason: { type: "end_turn" } });
          }
        }
        return { ids };
      },
      list: async () => [...events],
    },
  };
  return { client, replies };
}

async function firstTick(client: RoomClient) {
  const cast = buildCast(IDS, await loadPersonaSources(db, DEMO.id), await loadOutcomeSources(db, DEMO.id), ON, DEMO.id);
  const input = {
    scenario: "virtual",
    step: 0,
    hour: 0,
    world: EMPTY_WORLD,
    incidents: [],
    participants: IDS,
    people: {},
    actions: [],
    hints: { reached: [], clocks: [] },
    session: null,
    minute: 0,
  } as unknown as WorldInput;
  return roomStep(input, cast, { db, client, ai: aiCtx(), ...fastClock() }, { prevHour: 0, last: 72 });
}

describe("世界の部屋（T89）", () => {
  it("部屋の Agent の指示: 1 刻みに道具を 1 回だけ・道具の結果を受けたら文字を返さずに終える。道具の説明にも同じ。版は 5", () => {
    expect(WORLD_AGENT_VERSION).toBe(5);
    expect(ROOM_TURN_RULE).toContain(`1 刻みに ${WORLD_TOOL} の道具を 1 回だけ呼ぶ`);
    expect(ROOM_TURN_RULE).toContain("道具の結果を受けたら、文字を返さずに終える");
    expect(ROOM_TURN_RULE).toContain("Markdown を書かない");
    const p = agentParams() as { system: string; tools: Array<{ name: string; description: string }> };
    expect(p.system.endsWith(ROOM_TURN_RULE)).toBe(true);
    // 前の「短く終える」（文を返してよいと読める）は残さない
    expect(p.system).not.toContain("短く終える");
    expect(p.tools).toHaveLength(1);
    expect(p.tools[0].description).toContain("1 刻みに 1 回だけ呼ぶ");
    expect(p.tools[0].description).toContain("文字を返さずに終える");
    // 道具の結果の文も、文字を返さずに終える方へ
    expect(TOOL_REPLIES.taken).toContain("文字を返さずに終える");
    expect(TOOL_REPLIES.again).toContain("使わない");
  });

  it("1 刻みに world_step が 2 回呼ばれたら 1 回目だけ使い、2 回目には「受け取り済み」と返す（どちらにも結果を返して部屋を待たせない）。ai_calls は 1 行", async () => {
    const room = twiceRoom(FIRST, SECOND);
    const r = await firstTick(room.client);
    expect(r.step).toEqual(FIRST);
    expect(r.session).toBe("sesn_1");
    expect(room.replies.map((x) => x.text)).toEqual([TOOL_REPLIES.taken, TOOL_REPLIES.again]);
    expect(JSON.stringify(r.incidents)).not.toContain("雨が強まっている");
    expect(aiRows()).toEqual([{ purpose: "director", model: OPUS, status: "ok" }]);
  });

  it("1 回目の形が違えば使わず、形の合う次の呼び出しをその刻みの 1 回目として使う", async () => {
    const room = twiceRoom({ narration: 1 }, SECOND);
    const r = await firstTick(room.client);
    expect(r.step).toEqual(SECOND);
    expect(room.replies.map((x) => x.text)).toEqual([TOOL_REPLIES.bad, TOOL_REPLIES.taken]);
  });
});

describe("本人役の effort（T89）", () => {
  it("本人役は Haiku・medium（待ちと上限は high のときのまま）。分類は low、ほかは high", () => {
    expect(PURPOSES.persona).toEqual({ model: HAIKU, effort: "medium", maxTokens: 8000, timeoutMs: 90_000 });
    expect(PURPOSES.classify.effort).toBe("low");
    for (const k of ["form_read", "director", "scoring", "ledger_input", "summary"] as const) expect(PURPOSES[k].effort).toBe("high");
    expect(PURPOSES.director.model).toBe(OPUS);
    expect(PURPOSES.ledger_input.model).toBe(SONNET);
  });

  it("10 分版の 1 刻みは 監督 → 本人役 の順で、本人役は同じ刻みの監督の差し込みを読む（同じ刻みで並べられない理由）", async () => {
    const order: string[] = [];
    const seen = new Map<string, PersonaInput>();
    const target = IDS[0];
    const director = async () => {
      order.push("director");
      return [{ inject: "road_blocked" as const, person: target, text: "家の前の道が冠水して通れない", ai: true }];
    };
    const persona = async (input: PersonaInput): Promise<DrillTurn[]> => {
      order.push("persona");
      seen.set(input.person, input);
      return [];
    };
    const s = initialState("short", IDS, START);
    await step(s, { director, persona });
    expect(order[0]).toBe("director");
    expect(order.filter((x) => x === "persona")).toHaveLength(IDS.length);
    const own = seen.get(target)!;
    expect(own.incidents.some((e) => e.actor === "director" && e.text === "家の前の道が冠水して通れない")).toBe(true);
  });
});
