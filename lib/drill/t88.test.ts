// T88: 訓練のどの入口（本人役・通話・監督・講評・世界の 1 回呼びと部屋）にも町名を Claude に渡さない。町名は地区の別名（甲地区）だけで、
// 本人自身の町名も別名。本物の API は呼ばない（偽の Claude・偽の部屋）。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU, OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { DEMO_AREA, officePlaces } from "./area.ts";
import { advanceDrill, drillScope, startDrill } from "./db.ts";
import { createDirectorHook } from "./director.ts";
import type { DirectorInput, DrillIncident } from "./engine.ts";
import { drillHooks } from "./hooks.ts";
import { buildPersona, cleanWords, createPersonaHook } from "./persona.ts";
import { loadDrillRecord, reviewContextOf } from "./record.ts";
import { createReview } from "./review.ts";
import { EMPTY_WORLD, SCENARIOS, type WorldState } from "./scenarios.ts";
import type { WorldStep } from "./world-apply.ts";
import type { RoomClient, RoomEvent } from "./world-room.ts";
import { WORLD_TOOL } from "./world-room.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

const START = "2026-11-05T01:00:00.000Z";
const ON = "2026-11-05";
const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const careManager = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});

const SOURCES = new Map<string, PseudonymInput>(
  SEED_PEOPLE.map((p) => [p.person.id, { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks, consents: seedConsents(p) }]),
);
const ALL = SEED_PEOPLE.map((p) => p.person.id);

/** 町名と町名の頭（「かわなぎ町」と「かわなぎ」）。種の台帳の町名と、デモの区画の実の言葉（T170） */
const TOWN_WORDS = [...new Set(DEMO_AREA.towns.flatMap((t) => [t.town, ...(t.homes ?? [])]).flatMap((t) => [t, t.replace(/(町|台|村)$/u, "")]))];
const townsIn = (text: string) => TOWN_WORDS.filter((w) => text.includes(w));
const sent = (p: Params) => JSON.stringify({ system: p.system, messages: p.messages });

function reply(value: unknown, model: string = HAIKU): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

const QUIET = {
  condition: "家にいる",
  location: "home",
  action: "様子を見ている",
  contactsCaremanager: false,
  from: "",
  pressesRed: false,
  redAnswers: null,
  speech: "",
};

/** 世界: 毎刻み、甲地区（かわなぎ町）の停電と増水の 1 文 */
const STEP: WorldStep = {
  narration: "甲地区で重信川が増水している",
  events: [
    { kind: "outage", town: "甲地区", target: "", name: "", value: "start" },
    { kind: "flood", town: "乙地区", target: "", name: "", value: "0.5" },
  ],
  farewells: [],
};

function fakeClaude(answer: (p: Params) => unknown = (p) => (p.model === HAIKU ? QUIET : STEP)) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(answer(params), params.model === HAIKU ? HAIKU : OPUS);
        },
      },
    },
  };
  return { client, calls };
}

function fakeRoom() {
  const events: RoomEvent[] = [];
  const texts: string[] = [];
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
          events.push({ id, type: String(e.type), ...(typeof e.custom_tool_use_id === "string" ? { custom_tool_use_id: e.custom_tool_use_id } : {}) });
          if (e.type === "user.message") {
            texts.push(((e.content as Array<{ text: string }>)[0]).text);
            events.push({ id: `ev_${++n}`, type: "agent.custom_tool_use", name: WORLD_TOOL, input: STEP });
          } else if (e.type === "user.custom_tool_result") {
            events.push({ id: `ev_${++n}`, type: "session.status_idle", stop_reason: { type: "end_turn" } });
          }
        }
        return { ids };
      },
      list: async () => [...events],
    },
  };
  return { client, texts };
}

function fastClock() {
  let t = 0;
  return { sleep: async (ms: number) => void (t += ms), clock: () => t };
}

function aiCtx(claude: ClaudeClient): AskJsonContext {
  return { env: { ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "5000" }, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind }, now: () => new Date(START), claude };
}

async function runVirtual(hooks: NonNullable<ReturnType<typeof drillHooks>>, id: string) {
  const scope = drillScope(careManager())!;
  expect(await startDrill(db, scope, "virtual", START, hooks, () => id)).toEqual({ ok: true, id });
  for (let s = 0; s < SCENARIOS.virtual.hours.length - 1; s++) expect((await advanceDrill(db, scope, id, s, START, hooks)).ok).toBe(true);
  return scope;
}

/** 町名の入った出来事（画面の文。世界の別名を町名に戻した物） */
const TOWN_INCIDENTS: DrillIncident[] = [
  { change: { kind: "narration", room: "甲地区で重信川が増水している" }, text: "かわなぎ町で重信川が増水している", actor: "world", at: 6, ai: true },
  { change: { kind: "outage", area: { scope: "towns", towns: ["みずほし町"], since: { みずほし町: 6 } } }, text: "みずほし町 停電", actor: "world", at: 6, ai: true },
] as DrillIncident[];

describe("訓練の入力に町名を渡さない（T88）", () => {
  it("仮想の筋（部屋）: 本人役 10 人の入力にも部屋の文にも町名は無く、本人自身の町も地区の別名で届く", async () => {
    const room = fakeRoom();
    const { client, calls } = fakeClaude();
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "5000" }, careManager(), {
      claude: client,
      now: () => new Date(START),
      room: room.client,
      roomTime: fastClock(),
    })!;
    const scope = await runVirtual(hooks, "drill-t88");
    const persona = calls.filter((c) => c.model === HAIKU);
    expect(persona.length).toBeGreaterThan(10 * 6);
    for (const c of persona) expect(townsIn(sent(c))).toEqual([]);
    for (const text of room.texts) expect(townsIn(text)).toEqual([]);
    // 世界の出来事（画面では「市坪・井門付近 停電」）は、本人役には別名で届く。かわなぎ町の本人（p-01）にも別名で
    const p01 = persona.filter((c) => sent(c).includes("A さん") && sent(c).includes("在宅酸素"));
    expect(persona.some((c) => sent(c).includes("甲地区"))).toBe(true);
    expect(persona.some((c) => sent(c).includes("（町名）"))).toBe(false);
    expect(p01.length).toBeGreaterThan(0);

    // 講評（仮想）: 記録の文には町名の出来事があるが、Claude には別名で
    const rec = await loadDrillRecord(db, scope, "drill-t88", "2026-11-08T00:00:00.000Z");
    if (!rec || rec === "running") throw new Error("記録が無い");
    const ctx = reviewContextOf(rec);
    expect(JSON.stringify(ctx.incidents)).toContain("市坪・井門付近");
    const review = fakeClaude(() => ({ summary: "甲地区の停電への手が早かった", findings: [] }));
    const out = await createReview({ sources: SOURCES, ai: aiCtx(review.client), on: ON }, ctx);
    expect(review.calls).toHaveLength(1);
    expect(townsIn(sent(review.calls[0]))).toEqual([]);
    expect(sent(review.calls[0])).toContain("甲地区");
    // 講評の別名は画面で区画の実の言葉に戻る（T170）
    expect(out.ok && out.body.summary).toBe("市坪・井門付近の停電への手が早かった");
  });

  it("仮想の筋（1 回呼び）: 世界の入力に町名は無い", async () => {
    const { client, calls } = fakeClaude();
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "5000", DRILL_WORLD: "messages" }, careManager(), {
      claude: client,
      now: () => new Date(START),
    })!;
    await runVirtual(hooks, "drill-t88o");
    const world = calls.filter((c) => c.model === OPUS);
    expect(world.length).toBeGreaterThan(0);
    for (const c of [...world, ...calls.filter((c) => c.model === HAIKU)]) expect(townsIn(sent(c))).toEqual([]);
  });

  it("本人役の 1 刻みと通話: 出来事・道の名前の町名は別名に、本人の言葉の別名は町名に戻す", async () => {
    const { client, calls } = fakeClaude((p) =>
      p.model === HAIKU && sent(p).includes("speech") && !sent(p).includes("pressesRed") ? { speech: "甲地区は水が来てる" } : { ...QUIET, speech: "甲地区は停電してる" },
    );
    const world: WorldState = { ...EMPTY_WORLD, roads: [{ id: "town-乙地区", label: "みずほし町の道", open: false, person: null }] } as WorldState;
    const hook = createPersonaHook({ load: async () => SOURCES, ai: aiCtx(client), on: ON });
    await hook({ step: 1, hour: 6, person: "p-01", world, incidents: TOWN_INCIDENTS, state: null, lastAction: null, fixed: [], virtual: true });
    expect(calls).toHaveLength(1);
    expect(townsIn(sent(calls[0]))).toEqual([]);
    for (const w of ["甲地区で重信川が増水している", "乙地区 停電", "乙地区の道 通行止"]) expect(sent(calls[0])).toContain(w);

    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "5000" }, careManager(), { claude: client, now: () => new Date(START) })!;
    const r = await hooks.call!({
      person: "p-01",
      target: { id: "c-01-1", kind: "family", label: "家族 娘", hasPhone: true },
      pickup: "answers",
      hour: 6,
      world,
      incidents: TOWN_INCIDENTS,
      state: null,
    });
    const call = calls.at(-1)!;
    expect(townsIn(sent(call))).toEqual([]);
    expect(sent(call)).toContain("乙地区 停電");
    expect(r.speech).toBe("市坪・井門付近は水が来てる");

    // 本人役の説明（台帳の特記・避難先）に本人の町名があっても別名で渡る
    const p01 = SOURCES.get("p-01")!;
    const persona = buildPersona(
      { ...p01, ledger: { ...p01.ledger, notes: ["かわなぎ町の川沿いに住む"] } },
      { on: ON, places: officePlaces(DEMO.id, [...SOURCES.values()].map((s) => s.ledger)) },
    );
    expect(persona.profile.text).toContain("甲地区の川沿いに住む");
    expect(townsIn(persona.profile.text)).toEqual([]);
    expect(cleanWords("甲地区の水が引いた", persona.key, 40)).toBe("市坪・井門付近の水が引いた");
  });

  it("監督: 世界の出来事・返事の言い換えの町名は別名に", async () => {
    const { client, calls } = fakeClaude(() => ({ events: [], replies: [] }));
    const hook = createDirectorHook({ load: async () => SOURCES, ai: aiCtx(client), on: ON });
    const input: DirectorInput = {
      scenario: "heavy_rain",
      step: 2,
      hour: 6,
      world: EMPTY_WORLD,
      incidents: TOWN_INCIDENTS,
      participants: ALL,
      people: {},
      actions: [],
      replies: [{ id: "a1", action: "visit", person: "p-01", callee: null, status: "blocked", because: "road", text: "かわなぎ町の道としおかぜ町の橋が通れず着けなかった" }],
    } as DirectorInput;
    await hook(input);
    expect(calls).toHaveLength(1);
    expect(townsIn(sent(calls[0]))).toEqual([]);
    // 参加者の町（かわなぎ町）も（町名）でなく別名、種の表の町（しおかぜ町）も別名
    expect(sent(calls[0])).toContain("甲地区の道と戊地区の橋");
  });
});
