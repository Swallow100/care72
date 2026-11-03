// 仮想モード（docs/tasks/T50.md）のテスト。本物の API は呼ばない（偽の部屋・偽の Claude）。
// world_step の形と捨て方、町の停電、出来事を人に当てる、結末の判定が採点と一致、部屋が落ちたときの 1 回呼びへの戻り、
// ai_calls が 1 刻み 1 行、仮想の筋で 10 人が 12 刻み動く。

import Anthropic from "@anthropic-ai/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EndedNote } from "../../components/drill/Ended.tsx";
import { Situation } from "../../components/drill/Situation.tsx";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU, OPUS } from "../claude/models.ts";
import { inOutageArea as inTowns } from "../disaster/state.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { AREA_TOWNS, geographyText, restoreTowns, townOfAlias } from "./area.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { outageTownsOf } from "./engine.ts";
import { drillHooks, drillStepHooks } from "./hooks.ts";
import { inOutageArea } from "./persona.ts";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { DrillRowDetail } from "../../components/drill/DrillRowDetail.tsx";
import type { Situation as TriageSituation, TriageEntry } from "../triage/index.ts";
import { endMinuteOf, loadDrillRecord, reviewContextOf } from "./record.ts";
import { reviewText } from "./review.ts";
import { scoreView } from "./score-view.ts";
import { applyEvent, EMPTY_WORLD, SCENARIOS, type WorldState } from "./scenarios.ts";
import { clockRuns } from "./score.ts";
import { loadDrillScreen } from "./view.ts";
import {
  cleanReason,
  FAREWELL_PER_TICK_MAX,
  FORBIDDEN_WORDS,
  WorldStepSchema,
  worldIncidents,
  type ApplyContext,
  type PersonFacts,
  type WorldStep,
} from "./world-apply.ts";
import { WORLD_SYSTEM } from "./world-oneshot.ts";
import { agentParams, WORLD_BUDGET_CENTS, WORLD_TOOL, type RoomClient, type RoomEvent } from "./world-room.ts";

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

const aiRows = () => sqlite.prepare("SELECT purpose, model, status FROM ai_calls ORDER BY started_at, id").all() as Array<Record<string, string>>;

// ---------- 偽の Claude ----------

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

/** 偽の Claude: 本人役（Haiku）は連絡なし、1 回呼び（Opus）は world() の返事 */
function fakeClaude(world: (p: Params) => WorldStep = () => STEP) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return params.model === HAIKU ? reply(QUIET) : reply(world(params), OPUS);
        },
      },
    },
  };
  return { client, calls };
}

const STEP: WorldStep = {
  narration: "甲地区で白波川が増水している",
  events: [{ kind: "outage", town: "甲地区", target: "", name: "", value: "start" }],
  farewells: [],
};

// ---------- 偽の部屋 ----------

function fakeRoom(answer: (text: string, n: number) => WorldStep | "fail" | "silent" | "late" = () => STEP) {
  const events: RoomEvent[] = [];
  const texts: string[] = [];
  const made = { agents: 0, environments: 0, sessions: 0, updates: 0 };
  const sessionParams: Array<Record<string, unknown>> = [];
  let n = 0;
  /** 時間切れのあとに届く呼び出し（次の刻みで出る） */
  const late: RoomEvent[] = [];
  const client: RoomClient = {
    agents: {
      create: async () => {
        made.agents += 1;
        return { id: "agent_1", version: 1 };
      },
      update: async () => {
        made.updates += 1;
        return { id: "agent_1", version: 2 };
      },
    },
    environments: {
      create: async () => {
        made.environments += 1;
        return { id: "env_1" };
      },
    },
    sessions: {
      create: async (p) => {
        made.sessions += 1;
        sessionParams.push(p);
        return { id: `sesn_${made.sessions}` };
      },
      send: async (_id, evs) => {
        const ids: string[] = [];
        // 時間切れのあとに届いた呼び出し（次の刻みの送る前に出る）
        if (late.length > 0) events.push(...late.splice(0));
        // 答えていない呼び出しがある間は user.message を断る（requires_action）
        const answered = new Set(events.flatMap((x) => (x.custom_tool_use_id ? [x.custom_tool_use_id] : [])));
        const waiting = events.some((x) => x.type === "agent.custom_tool_use" && !answered.has(x.id));
        if (waiting && evs.some((e) => e.type === "user.message")) throw new Error("400 requires_action");
        for (const e of evs) {
          n += 1;
          const id = `ev_${n}`;
          ids.push(id);
          events.push({ id, type: String(e.type), ...(typeof e.custom_tool_use_id === "string" ? { custom_tool_use_id: e.custom_tool_use_id } : {}) });
          if (e.type === "user.message") {
            const text = ((e.content as Array<{ text: string }>)[0]).text;
            texts.push(text);
            const a = answer(text, texts.length);
            if (a === "fail") events.push({ id: `ev_${++n}`, type: "session.error" });
            else if (a === "late") late.push({ id: `ev_late_${texts.length}`, type: "agent.custom_tool_use", name: WORLD_TOOL, input: STEP });
            else if (a !== "silent") events.push({ id: `ev_${++n}`, type: "agent.custom_tool_use", name: WORLD_TOOL, input: a });
          } else if (e.type === "user.custom_tool_result") {
            events.push({ id: `ev_${++n}`, type: "session.status_idle", stop_reason: { type: "end_turn" } });
          }
        }
        return { ids };
      },
      list: async () => [...events],
    },
  };
  return { client, texts, made, sessionParams };
}

/**
 * 結末を決める偽の世界: 刻みの文の「時計の目安」で、届いた手なしの最初の人を 1 人選ぶ（選んだ仮名を chosen に）。
 * 毎刻み、甲地区の停電を続ける
 */
function decide(text: string, chosen: string[]): WorldStep {
  const hit = [...text.matchAll(/- ([A-Z]+ さん): [^\n]*届いた手なし/gu)].map((m) => m[1]).find((a) => !chosen.includes(a));
  const farewells = hit ? [{ target: hit, text: "停電の夜、助けを待ち続けた", reason: "停電が続き、誰も着かなかった" }] : [];
  for (const f of farewells) chosen.push(f.target);
  return { ...STEP, farewells };
}

/** 待たない時計（1 回の待ちで 1.5 秒進む） */
function fastClock() {
  let t = 0;
  return { sleep: async (ms: number) => void (t += ms), clock: () => t };
}

// ---------- 当て方 ----------

function input(id: string): PseudonymInput {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
}

function ctxOf(ids: string[], over: Partial<ApplyContext> = {}): ApplyContext {
  const { key } = pseudonymize(ids.map(input), { on: ON });
  const facts = new Map<string, PersonFacts>(
    ids.map((id) => {
      const p = input(id);
      return [
        id,
        {
          town: p.ledger.basic.address?.town ?? null,
          depends: SEED_PEOPLE.find((x) => x.person.id === id)!.clocks.flatMap((k) => (k.depends_on ? [k.depends_on] : [])),
          categories: p.clocks.map((k) => k.category),
          nurse: p.contacts.some((c) => c.kind === "visiting_nurse"),
        },
      ];
    }),
  );
  return { key, facts, ended: new Set(), hour: 6, via: "room", ...over };
}

const ALL = SEED_PEOPLE.map((p) => p.person.id);
const cleanReasonOf = (t: string, ctx: ApplyContext) => cleanReason(t, ctx.key);
const townOf = (id: string) => input(id).ledger.basic.address!.town!;

describe("world_step の形と捨て方", () => {
  it("形は WorldStepSchema。知らない種類・地区・道・施設・値は捨て、出来事は 4 つまで", () => {
    const ctx = ctxOf(ALL);
    const answer: WorldStep = {
      narration: "白波川が増水",
      events: [
        { kind: "meteor", town: "甲地区", target: "", name: "", value: "" },
        { kind: "flood", town: "実在町", target: "", name: "", value: "2" },
        { kind: "road", town: "", target: "", name: "知らない道", value: "closed" },
        { kind: "facility", town: "", target: "", name: "知らない病院", value: "closed" },
        { kind: "aftershock", town: "", target: "", name: "", value: "9" },
        { kind: "flood", town: "甲地区", target: "", name: "", value: "1.5" },
        { kind: "浸水", town: "丙地区", target: "", name: "", value: "" },
        { kind: "road", town: "", target: "", name: "川沿いの市道", value: "closed" },
        { kind: "weather", town: "", target: "", name: "", value: "rain" },
        { kind: "aftershock", town: "", target: "", name: "", value: "5弱" },
      ],
      farewells: [],
    };
    expect(WorldStepSchema.safeParse(answer).success).toBe(true);
    const out = worldIncidents(answer, ctx);
    const kinds = out.map((e) => e.change.kind);
    expect(kinds).toEqual(["narration", "town_flood", "town_flood", "town_road", "weather"]);
    expect(out.every((e) => e.ai)).toBe(true);
    const flood = out[1].change;
    expect(flood).toMatchObject({ kind: "town_flood", town: "かわなぎ町", depthM: 1.5 });
    // 日本語の種類も受ける。深さが無ければ地理の想定の深さ
    expect(out[2].change).toMatchObject({ kind: "town_flood", town: "あしなみ町", depthM: 1 });
  });

  it("世界の 1 文に禁じる語があれば捨てる。地区の別名は画面で町名に戻す", () => {
    const ctx = ctxOf(ALL);
    const bad = worldIncidents({ ...STEP, narration: "避難所で亡くなった人がいる" }, ctx);
    expect(bad.some((e) => e.change.kind === "narration")).toBe(false);
    const good = worldIncidents(STEP, ctx);
    expect(good[0]).toMatchObject({ change: { kind: "narration", room: "甲地区で白波川が増水している" }, text: "かわなぎ町で白波川が増水している" });
    expect(restoreTowns("乙地区と己地区")).toBe("みずほし町とそらみ台");
    for (const w of ["死亡", "亡くなった", "死んだ", "関連死", "遺体", "息を引き取った"]) expect(FORBIDDEN_WORDS.test(w)).toBe(true);
  });

  it("結末は世界が決めた人（T53）。時計の目安に無い人も当たる。禁じる語は固定の文（決めたのは AI なので AI の印のまま）", () => {
    const ctx = ctxOf(ALL);
    const [a, b, c] = ctx.key.people;
    // 目安（時計の計算）は a だけ。世界は b・c を選んだ（a は持ちこたえた）
    const hints = [{ person: a.personId, label: "酸素 2時間を超過" }];
    const out = worldIncidents(
      {
        ...STEP,
        events: [],
        farewells: [
          { target: b.alias, text: "透析に行けないまま亡くなった", reason: "道が通れず、透析の送迎が着かなかった" },
          { target: c.alias, text: "水の引かない家で、助けを待ち続けた", reason: "甲地区の浸水が続き、誰も着かなかった" },
        ],
      },
      ctx,
      hints,
    );
    const ends = out.filter((e) => e.change.kind === "outcome");
    expect(ends.map((e) => e.person)).toEqual([b.personId, c.personId]);
    expect(ends[0]).toMatchObject({ text: `${b.name}さんには、この時間までに助けが届きませんでした`, ai: true });
    expect(ends[0].change).toEqual({ kind: "outcome", label: "", reason: "道が通れず、透析の送迎が着かなかった" });
    // 理由の地区の別名は画面で町名に戻す
    expect(ends[1]).toMatchObject({ text: "水の引かない家で、助けを待ち続けた", ai: true });
    expect(ends[1].change).toMatchObject({ reason: "かわなぎ町の浸水が続き、誰も着かなかった" });
    // 目安にいる人を世界が選べば、label に切れた時計
    const withA = worldIncidents({ ...STEP, events: [], farewells: [{ target: a.alias, text: "電池の明かりが消えた", reason: "停電が 6 時間続いた" }] }, ctx, hints);
    expect(withA.find((e) => e.change.kind === "outcome")!.change).toMatchObject({ label: "酸素 2時間を超過" });
  });

  it("結末の守り: 知らない仮名・参加者でない人・もう結末の人・同じ人の 2 回目は捨て、1 刻み 2 人まで。理由の禁じる語・医療の語は理由なし", () => {
    const some = ALL.slice(0, 5);
    const full = ctxOf(ALL);
    const ctx = { ...ctxOf(some), ended: new Set([some[0]]) };
    const alias = (id: string) => full.key.people.find((p) => p.personId === id)!.alias;
    const aliasIn = (id: string) => ctx.key.people.find((p) => p.personId === id)!.alias;
    const outsider = ALL.find((id) => !some.includes(id))!;
    const out = worldIncidents(
      {
        ...STEP,
        events: [],
        farewells: [
          { target: "Z さん", text: "知らない人", reason: "" },
          { target: aliasIn(some[0]), text: "もう結末", reason: "" },
          { target: alias(outsider), text: "参加者でない（別の鍵の仮名）", reason: "" },
          { target: aliasIn(some[1]), text: "1 人目", reason: "低血糖のまま薬が切れた" },
          { target: aliasIn(some[1]), text: "同じ人の 2 回目", reason: "" },
          { target: aliasIn(some[2]), text: "2 人目", reason: "停電で亡くなった" },
          { target: aliasIn(some[3]), text: "3 人目（上限の外）", reason: "道が通れない" },
        ],
      },
      ctx,
    );
    const ends = out.filter((e) => e.change.kind === "outcome");
    expect(ends.map((e) => e.person)).toEqual([some[1], some[2]]);
    expect(ends.map((e) => e.change)).toEqual([
      { kind: "outcome", label: "", reason: null },
      { kind: "outcome", label: "", reason: null },
    ]);
    for (const w of ["低血糖", "インスリン 4 単位を投与", "受診する", "５ｍｇ"]) expect(cleanReasonOf(w, ctx)).toBeNull();
    expect(cleanReasonOf("停電が 6 時間続き、電池が切れた", ctx)).toBe("停電が 6 時間続き、電池が切れた");
    expect(FAREWELL_PER_TICK_MAX).toBe(2);
  });
});

describe("町の停電と、出来事を人に当てる", () => {
  it("town の OutageArea: 町名で見る（本人役・ルールの表・採点）。広がると町を足し、始まりは町ごと", () => {
    const area = { scope: "towns" as const, towns: ["かわなぎ町"] };
    expect(inOutageArea(area, [], "かわなぎ町")).toBe(true);
    expect(inOutageArea(area, [], "そらみ台")).toBe(false);
    expect(inTowns(outageTownsOf(area, []), "そらみ台")).toBe(false);
    let w: WorldState = EMPTY_WORLD;
    w = applyEvent(w, { change: { kind: "outage", area: { ...area, since: { かわなぎ町: 1 } } }, text: "" }, 1);
    w = applyEvent(w, { change: { kind: "outage", area: { scope: "towns", towns: ["そらみ台"], since: { そらみ台: 24 } } }, text: "" }, 24);
    expect(w.outage).toMatchObject({ since: 1, area: { towns: ["かわなぎ町", "そらみ台"], since: { かわなぎ町: 1, そらみ台: 24 } } });
    // 停電の時計は町ごとの始まりから
    const k = { kind: "device", category: "oxygen", label: "電池", value: 2, unit: "hour", starts_on: "outage", depends_on: null, depends_check: null } as const;
    const runs = clockRuns(
      [{ ...k, person_id: "x" }, { ...k, person_id: "y" }],
      new Map([["x", "かわなぎ町"], ["y", "そらみ台"]]),
      { since: 1, towns: ["かわなぎ町", "そらみ台"], townSince: { かわなぎ町: 1, そらみ台: 24 } },
    );
    expect(runs.map((r) => [r.person, r.startMinute])).toEqual([["x", 60], ["y", 1440]]);
  });

  it("地区 → 住む人、仮名 → その人の町（部屋は町を知らない）。施設は頼る人に", () => {
    const ctx = ctxOf(ALL);
    const out = worldIncidents(
      {
        narration: "",
        events: [
          { kind: "landslide", town: "丁地区", target: "", name: "", value: "" },
          { kind: "flood", town: "", target: ctx.key.people.find((p) => townOf(p.personId) === "うみなり町")!.alias, name: "", value: "0.5" },
          { kind: "facility", town: "", target: "", name: "河口の透析クリニック", value: "closed" },
        ],
        farewells: [],
      },
      ctx,
    );
    const slide = out.find((e) => e.change.kind === "landslide")!.change as { persons: string[] };
    expect(slide.persons.sort()).toEqual(ALL.filter((id) => townOf(id) === "くぬぎ谷町").sort());
    const flood = out.find((e) => e.change.kind === "town_flood")!.change as { town: string; persons: string[] };
    expect(flood.town).toBe("うみなり町");
    expect(flood.persons).toEqual(ALL.filter((id) => townOf(id) === "うみなり町"));
    const fac = out.find((e) => e.change.kind === "town_facility")!.change as { persons: string[] };
    expect(fac.persons).toEqual(SEED_PEOPLE.filter((p) => p.clocks.some((k) => k.category === "dialysis")).map((p) => p.person.id));
    // 当てると、住む人に印・道・施設
    const w = out.reduce((x, e) => applyEvent(x, e, 6), EMPTY_WORLD);
    for (const p of slide.persons) expect(w.roads.some((r) => r.person === p && !r.open)).toBe(true);
    for (const p of flood.persons) expect(w.marks[p]?.flooded).toBe(6);
  });

  it("地理の文と指示に町名を書かない（別名だけ）", () => {
    for (const t of AREA_TOWNS) {
      expect(geographyText()).not.toContain(t.town);
      expect(WORLD_SYSTEM).not.toContain(t.town);
      expect(townOfAlias(t.alias)).toBe(t.town);
    }
  });
});

// ---------- 仮想の筋（D1） ----------

async function runVirtual(hooks: ReturnType<typeof drillHooks>, id = "drill-v") {
  const scope = drillScope(careManager())!;
  expect(await startDrill(db, scope, "virtual", START, hooks, () => id)).toEqual({ ok: true, id });
  for (let s = 0; s < SCENARIOS.virtual.hours.length - 1; s++) {
    const r = await advanceDrill(db, scope, id, s, START, hooks);
    expect(r.ok).toBe(true);
  }
  return scope;
}

describe("仮想の筋（偽の部屋・偽の Haiku）", () => {
  it("10 人が 12 刻み動き、部屋は 1 つ（Agent・Environment は 1 回）、ai_calls は世界が 1 刻み 1 行。結末は部屋が決めた人（採点の結末 AI と一致、条件到達は別の数）", async () => {
    const chosen: string[] = [];
    const room = fakeRoom((text) => decide(text, chosen));
    const { client, calls } = fakeClaude();
        const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START), room: room.client, roomTime: fastClock() })!;
    const scope = await runVirtual(hooks);
    expect(room.made).toEqual({ agents: 1, environments: 1, sessions: 1, updates: 0 });
    expect(room.sessionParams[0]).toMatchObject({ budget: { type: "limit", max_list_cost: { amount: WORLD_BUDGET_CENTS, currency: "USD" } } });
    expect(room.texts).toHaveLength(12);
    // 最初の文に地理と本人たち、以後は刻みの文だけ。町名・氏名は送らない
    expect(room.texts[0]).toContain("甲地区");
    expect(room.texts[1]).not.toContain("主な道");
    for (const text of room.texts) {
      for (const p of SEED_PEOPLE) {
        expect(text).not.toContain(p.person.name);
        expect(text).not.toContain(p.ledger.basic.address!.town!);
      }
    }
    // 世界: director 12 行（部屋）。本人役は結末の人を除いて呼ぶ
    const rows = aiRows();
    expect(rows.filter((r) => r.purpose === "director")).toHaveLength(12);
    expect(rows.filter((r) => r.purpose === "director").every((r) => r.model === OPUS && r.status === "ok")).toBe(true);
    expect(calls.filter((c) => c.model === HAIKU).length).toBeGreaterThan(10 * 6);

    const row = (await loadDrillRow(db, "office-demo", "drill-v"))!;
    expect(row.scenario).toBe("virtual");
    expect(row.world_session_id).toBe("sesn_1");
    const state = stateOfRow(row);
    expect(state.status).toBe("finished");
    const ended = Object.keys(state.world.ended ?? {}).sort();
    expect(ended.length).toBeGreaterThan(0);
    // 結末は部屋が返した人だけ（仮名 → 人）。1 刻み 1 人ずつ選んだ
    const key = pseudonymize(state.participants.map(input), { on: ON }).key;
    expect(chosen.map((a) => key.people.find((p) => p.alias === a)!.personId).sort()).toEqual(ended);
    const rec = await loadDrillRecord(db, scope, "drill-v", "2026-11-08T00:00:00.000Z");
    if (!rec || rec === "running") throw new Error("記録が無い");
    // 採点: 結末（AI 筋書）は世界が決めた人、条件到達（時計計算）は別に数える
    expect(rec.score.ended!.map((e) => e.person).sort()).toEqual(ended);
    expect(rec.score.ended!.every((e) => e.reason === "停電が続き、誰も着かなかった")).toBe(true);
    expect(rec.score.reached.length).toBeGreaterThan(0);
    const view = scoreView(rec.score, rec.screen.names, rec.previous);
    expect(view.rows.map((r) => [r.key, r.sub])).toEqual([
      ["order", null],
      ["report", null],
      ["form9", "様式 9"],
      ["reached", "時計計算"],
      ["ended", "AI 筋書"],
    ]);
    // 結末の人の行には結末の 1 文。結末の後は本人役を呼ばない（信号が無い）
    const screen = (await loadDrillScreen(db, scope, "drill-v", null))!;
    for (const id of ended) {
      const at = state.world.ended![id].at;
      const after = screen.ticks.filter((tk) => tk.hour > at).flatMap((tk) => tk.turns).filter((u) => u.person === id);
      expect(after).toEqual([]);
      const end = screen.ticks.flatMap((tk) => tk.incidents).find((e) => e.change.kind === "outcome" && e.person === id)!;
      expect(end).toMatchObject({ text: "停電の夜、助けを待ち続けた", ai: true });
      expect(end.change).toMatchObject({ reason: "停電が続き、誰も着かなかった" });
      expect(state.world.ended![id].reason).toBe("停電が続き、誰も着かなかった");
    }
    // 講評の入力: 結末（AI の筋書き）と条件に達した人（時計の計算）を別の行で
    const aliasOf = new Map(key.people.map((p) => [p.personId, p.alias]));
    const text = reviewText(reviewContextOf(rec), aliasOf);
    expect(text).toContain(`- 条件に達した人（時計の計算。時計が切れるまでに、その人へ届いた手が無い）: ${rec.score.reached.length}`);
    expect(text).toContain(`- 結末（AI の筋書き。世界が流れの中で決めた。上の時計の計算とは別の数）: ${ended.length}`);
    expect(text).toContain("世界の事実: 停電が続き、誰も着かなかった");
    // 訓練記録の紙面: 結末の表（AI の印）と「条件到達 時計計算」の見出し
    const paper = renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: "デモ事業所", today: ON }));
    expect(paper).toContain('data-detail="ended"');
    expect(paper).toContain("条件到達 時計計算");
    expect(paper).toContain("結末 AI 筋書");
    expect(paper).toContain('data-score-key="ended"');
    // 行の詳細: 結末の 1 文と経緯（理由）に AI の印
    const caseRow = screen.rows.find((r) => r.id === ended[0])!;
    const detail = renderToStaticMarkup(
      createElement(DrillRowDetail, {
        detail: caseRow.detail!,
        startedAt: START,
        ended: { text: "停電の夜、助けを待ち続けた", reason: "停電が続き、誰も着かなかった", ai: true },
      }),
    );
    expect(detail).toContain("data-ended-reason");
    expect(detail).toContain("経緯");
    expect(detail.match(/data-ai="item"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("採点の終わりは 72 時間で切る（最後の刻みのあとに 72 時間をまたぐ手を打っても）", () => {
    const screen = (minute: number, hour: number) => ({ state: { minute, hour } }) as unknown as Parameters<typeof endMinuteOf>[0];
    expect(endMinuteOf(screen(80 * 60, 72))).toBe(72 * 60);
    expect(endMinuteOf(screen(13 * 60, 12))).toBe(13 * 60);
  });

  it("発災時のルールの表（lib/triage）の入力に結末は無い（型で）", () => {
    type HasEnded<T> = "ended" extends keyof T ? true : false;
    expectTypeOf<HasEnded<TriageEntry>>().toEqualTypeOf<false>();
    expectTypeOf<HasEnded<TriageSituation>>().toEqualTypeOf<false>();
  });

  it("部屋も 1 回呼びも落ちた刻みは、時計が切れた人がいても結末を出さない（コードで代わりに決めない）", async () => {
    const room = fakeRoom(() => "fail");
    const { client } = fakeClaude(() => {
      throw new Error("1 回呼びも落ちた");
    });
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "2000" }, careManager(), { claude: client, now: () => new Date(START), room: room.client, roomTime: fastClock() })!;
    const scope = await runVirtual(hooks);
    const state = stateOfRow((await loadDrillRow(db, "office-demo", "drill-v"))!);
    expect(state.world.ended ?? {}).toEqual({});
    const screen = (await loadDrillScreen(db, scope, "drill-v", null))!;
    expect(screen.ticks.flatMap((tk) => tk.incidents).filter((e) => e.change.kind === "outcome")).toEqual([]);
    expect(screen.ticks.every((tk) => tk.incidents.some((e) => e.change.kind === "world_note" && e.change.state === "down"))).toBe(true);
  });

  it("部屋が落ちたら（session.error）その刻みは 1 回呼びに落ちる（「世界 代替」）。1 回呼びも落ちたら世界は動かさない", async () => {
    const room = fakeRoom((_text, n) => (n === 2 ? "fail" : STEP));
    let opus = 0;
    const { client } = fakeClaude(() => {
      opus += 1;
      return STEP;
    });
        const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START), room: room.client, roomTime: fastClock() })!;
    await runVirtual(hooks);
    expect(opus).toBe(1);
    const scope = drillScope(careManager())!;
    const screen = (await loadDrillScreen(db, scope, "drill-v", null))!;
    const notes = screen.ticks.flatMap((tk) => tk.incidents.filter((e) => e.change.kind === "world_note").map(() => tk.step));
    expect(notes).toEqual([1]);
    const narration = screen.ticks[1].incidents.find((e) => e.change.kind === "narration")!;
    expect(narration.change).toMatchObject({ via: "oneshot" });
    // 失敗した部屋の 1 行と、1 回呼びの 1 行
    expect(aiRows().filter((r) => r.purpose === "director" && r.status === "failed")).toHaveLength(1);
  });

  it("部屋が返事をしない（時間切れ）も 1 回呼び。DRILL_WORLD=messages は部屋を作らない", async () => {
    const silent = fakeRoom(() => "silent");
    const { client } = fakeClaude();
        const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "2000" }, careManager(), { claude: client, now: () => new Date(START), room: silent.client, roomTime: fastClock() })!;
    await runVirtual(hooks, "drill-a");
    expect(aiRows().filter((r) => r.purpose === "director" && r.status === "failed")).toHaveLength(12);

    sqlite.exec("UPDATE drills SET status = 'finished'");
    const room = fakeRoom();
    const msg = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "2000", DRILL_WORLD: "messages" }, careManager(), {
      claude: client,
      now: () => new Date(START),
      room: room.client,
    })!;
    await runVirtual(msg, "drill-b");
    expect(room.made.sessions).toBe(0);
    const screen = (await loadDrillScreen(db, drillScope(careManager())!, "drill-b", null))!;
    expect(screen.ticks.flatMap((tk) => tk.incidents).some((e) => e.change.kind === "world_note")).toBe(false);
    expect(screen.ticks[0].incidents.find((e) => e.change.kind === "narration")?.change).toMatchObject({ via: "oneshot" });
  });

  it("時間切れのあと部屋が答えを待ったまま（requires_action）でも、次の刻みで後始末して部屋に戻る", async () => {
    const room = fakeRoom((_text, n) => (n === 1 ? "late" : STEP));
    const { client } = fakeClaude();
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START), room: room.client, roomTime: fastClock() })!;
    await runVirtual(hooks);
    const rows = aiRows().filter((r) => r.purpose === "director");
    // 最初の刻みだけ部屋が時間切れ（1 回呼びに落ちる）、以後は部屋
    expect(rows.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(room.texts).toHaveLength(12);
    expect(room.made.sessions).toBe(1);
  });

  it("鍵が無ければ世界は止まり（「世界 停止」）、結末は出ない（T53）。採点の条件到達（時計計算）は数える。固定の筋は鍵なしで今までどおり hooks なし", async () => {
    const hooks = drillStepHooks({ DB: db }, careManager());
    expect(hooks?.outcome).toBeTypeOf("function");
    expect(hooks?.world).toBeUndefined();
    expect(drillHooks({ DB: db }, careManager())).toBeUndefined();
    const scope = await runVirtual(hooks);
    const state = stateOfRow((await loadDrillRow(db, "office-demo", "drill-v"))!);
    expect(state.world.ended ?? {}).toEqual({});
    const rec = await loadDrillRecord(db, scope, "drill-v", "2026-11-08T00:00:00.000Z");
    if (!rec || rec === "running") throw new Error("記録が無い");
    expect(rec.score.ended).toEqual([]);
    const screen = (await loadDrillScreen(db, drillScope(careManager())!, "drill-v", null))!;
    expect(screen.ticks[0].incidents[0]).toMatchObject({ change: { kind: "world_note", state: "off" }, ai: false });
  });

  it("部屋の Agent: 道具は world_step だけ（砂場の道具なし）、モデルは Opus", () => {
    const p = agentParams() as { tools: Array<{ type: string; name: string }>; model: { id: string } };
    expect(p.tools).toEqual([expect.objectContaining({ type: "custom", name: WORLD_TOOL })]);
    expect(p.model.id).toBe(OPUS);
  });
});


describe("画面（状況の欄・結末の印）", () => {
  it("部屋が落ちた刻みは世界の 1 文に「世界 代替」の印、結末は印と 1 文（AI の印は部屋の文だけ）", () => {
    const tick = {
      step: 1,
      hour: 1,
      world: EMPTY_WORLD,
      finished: false,
      turns: [],
      incidents: [
        { actor: "director" as const, at: 1, change: { kind: "world_note" as const, state: "down" as const }, text: "代替", ai: false },
        { actor: "director" as const, at: 1, change: { kind: "narration" as const, room: "甲地区で増水", via: "oneshot" as const }, text: "かわなぎ町で増水", ai: true },
      ],
    };
    const html = renderToStaticMarkup(createElement(Situation, { ticks: [tick], names: {}, startedAt: START }));
    expect(html).toContain("data-world-fallback");
    expect(html).toContain("世界 代替");
    expect(html).toContain("かわなぎ町で増水");
    expect(html).not.toContain('data-incident="world_note"');
    const ended = renderToStaticMarkup(createElement(EndedNote, { text: "電池の明かりが消えた", ai: true }));
    expect(ended).toContain("結末");
    expect(ended).toContain('data-ai="item"');
    expect(renderToStaticMarkup(createElement(EndedNote, { text: "固定", ai: false }))).not.toContain("data-ai");
  });
});
