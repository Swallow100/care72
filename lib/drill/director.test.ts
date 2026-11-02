// 訓練の監督（docs/tasks/T19.md）のテスト。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 想定の表の固定の差し込みの順（大雨 6 時間に高橋の栄養剤、12 時間に田中の透析施設）、差し込みの種類の検査（表の外は捨てる）、
// 未設定・上限・失敗で止まらない、監督 → 本人役の順、送った物に個人の情報が無い、世界の状態 → 時計の頼り先、世界の返事（T20 の口）。
// 色は lib/triage の色の名前（red・yellow・gray・green）で比べる。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU, OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { aliasFor, findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { NO_BASIS } from "../sources/prompt.ts";
import { advanceDrill, drillScope, loadTicks, startDrill } from "./db.ts";
import {
  acceptOdds,
  createDirectorHook,
  decideWorldReply,
  DIRECTOR_SOURCES,
  DIRECTOR_SYSTEM,
  directorEvents,
  drillClocks,
  eligibleKinds,
  personOfAlias,
  WORLD_ODDS,
  worldReply,
  type DirectorAnswer,
  type WorldAsk,
} from "./director.ts";
import { initialState, step, type DirectorEvent, type DirectorInput, type DrillState, type PersonaInput } from "./engine.ts";
import { drillHooks } from "./hooks.ts";
import {
  applyEvent,
  EMPTY_WORLD,
  INJECT_KINDS,
  INJECT_TEXTS,
  injectChange,
  phoneOf,
  SCENARIOS,
  type WorldState,
} from "./scenarios.ts";
import { loadDrillScreen } from "./view.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown, model: string = OPUS): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(answer: (p: Params) => Message | Promise<Message>) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return answer(params);
        },
      },
    },
  };
  return { client, calls };
}

/** 送った入力（想定の文・弱点の要約） */
function sent(p: Params): { scene: string; weak: string } {
  const input = JSON.parse(p.messages[0].content as string) as Record<string, { text: string }>;
  return { scene: input["想定"]?.text ?? "", weak: input["弱点"]?.text ?? "" };
}

const NONE: DirectorAnswer = { events: [] };

// ---------- 種の 10 人 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const SEED = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p)]));
const input = (id: string) => SEED.get(id)!;
/** 参加者の並び（担当一覧のカナ順）。監督はこの順に A さん・B さん…と伏せる */
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const aliasOf = (id: string) => aliasFor(PARTICIPANTS.indexOf(id));
/** 10 人全員の鍵（漏れの見張り） */
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const TOWNS = [...new Set(SEED_PEOPLE.map((p) => p.ledger.basic.address!.town))];
const DESTINATIONS = SEED_PEOPLE.flatMap((p) => [p.ledger.evacuation.destination1, p.ledger.evacuation.destination2]).filter(
  (x): x is string => typeof x === "string" && x.length > 0,
);

function expectNoPersonalData(text: string) {
  expect(findLeaks(text, ALL_KEY)).toEqual([]);
  for (const t of TOWNS) expect(text).not.toContain(t.replace(/(町|台)$/, ""));
  for (const d of DESTINATIONS) expect(text).not.toContain(d);
  expect(text).not.toMatch(/090-?0000/);
}

const START = "2026-11-05T01:00:00.000Z";

function directorInput(over: Partial<DirectorInput> = {}): DirectorInput {
  return {
    scenario: "heavy_rain",
    step: 2,
    hour: 3,
    world: { ...EMPTY_WORLD, staff: 3 },
    incidents: [],
    participants: PARTICIPANTS,
    people: {},
    actions: [],
    ...over,
  };
}

/** 想定を hooks で n 刻み進める（始める前から） */
async function run(scenario: DrillState["scenario"], n: number, hooks = {}, people = PARTICIPANTS) {
  let s = initialState(scenario, people, START);
  const ticks = [];
  for (let i = 0; i < n; i++) {
    const r = await step(s, hooks);
    s = r.state;
    ticks.push(r.tick);
  }
  return { state: s, ticks };
}

// ---------- D1（node:sqlite に種の 10 人） ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
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
const SCOPE = drillScope(careManager())!;

function aiCtx(claude?: ClaudeClient, env: AskJsonContext["env"] = { ANTHROPIC_API_KEY: "dummy" }): AskJsonContext {
  return { env, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind }, now: () => new Date(START), claude };
}

const seedLoad = async () => SEED as ReadonlyMap<string, PseudonymInput>;

// ---------- 想定の表の固定の差し込み ----------

describe("想定の表の固定の差し込み（Claude を呼ばない）", () => {
  it("大雨: 6 時間に高橋の家族が栄養剤を持ち出し忘れ、12 時間に田中の透析施設が浸水。監督の物で AI の印なし", async () => {
    const { ticks } = await run("heavy_rain", 6);
    const director = (i: number) => ticks[i].incidents.filter((e) => e.actor === "director");
    expect(ticks[3].hour).toBe(6);
    expect(director(3).map((e) => [e.inject, e.person, e.text, e.ai, e.at])).toEqual([
      ["supply_left", "p-06", "家族が栄養剤を持ち出し忘れた", false, 6],
    ]);
    expect(ticks[5].hour).toBe(12);
    expect(director(5).map((e) => [e.inject, e.person, e.text, e.ai, e.at])).toEqual([
      ["dialysis_flooded", "p-03", "透析施設 浸水で休止", false, 12],
    ]);
    // ほかの刻みに監督の物は無い
    for (const i of [0, 1, 2, 4]) expect(director(i)).toEqual([]);
    // 理由（採点が読む）と根拠の出典を持つ
    expect(director(3)[0].reason).toContain("栄養剤");
    expect(director(3)[0].basis).toBe("nanbyo-shishin-2017");
    expect(director(5)[0].basis).toBe("jadp-dialysis-2023");
    // 世界: 高橋に持ち出し忘れの印、田中の透析施設が休止
    expect(ticks[3].world.marks["p-06"]).toEqual({ supplyLeft: 6 });
    expect(ticks[5].world.facilities).toEqual([
      { id: "fc-p-03", label: "透析施設", open: false, person: "p-03", depends: "dialysis_center" },
    ]);
  });

  it("固定の状況の順（大雨 72 時間）: 表の世界の出来事 → 監督の固定の差し込みの順で、毎回同じ", async () => {
    const order = async () =>
      (await run("heavy_rain", 12)).ticks.flatMap((t) => t.incidents.map((e) => `${t.hour}:${e.actor}:${e.change.kind}`));
    const first = await order();
    expect(first).toEqual([
      "0:world:alert",
      "0:world:shelter",
      "1:world:alert",
      "1:world:outage",
      "3:world:flood",
      "3:world:phone",
      "3:world:road",
      "6:world:shelter",
      "6:director:supply_left",
      "9:world:road",
      "12:director:facility",
      "18:world:water",
      "24:world:alert",
      "24:world:phone",
      "36:world:road",
      "48:world:outage_restored",
      "60:world:water",
      "72:world:alert",
    ]);
    expect(await order()).toEqual(first);
  });

  it("10 分版は 12 時間の刻みに 6 時間と 12 時間の差し込みを元の時刻のまま寄せる", async () => {
    const { ticks } = await run("short", 3);
    expect(ticks[2].hour).toBe(12);
    expect(ticks[2].incidents.filter((e) => e.actor === "director").map((e) => [e.inject, e.person, e.at])).toEqual([
      ["supply_left", "p-06", 6],
      ["dialysis_flooded", "p-03", 12],
    ]);
  });

  it("表の差し込みは 6 つの種類だけ、本人を指し、変化は種類から組んだ物", () => {
    for (const s of Object.values(SCENARIOS)) {
      for (const t of s.ticks) {
        for (const e of t.events.filter((x) => x.by === "director")) {
          expect(INJECT_KINDS).toContain(e.inject);
          expect(e.person).toBeTruthy();
          expect(e.change).toEqual(injectChange(e.inject!, e.person!));
        }
      }
    }
  });

  it("職員の空きは想定の表から（大雨 3 人・地震 2 人）", async () => {
    expect((await run("heavy_rain", 1)).state.world.staff).toBe(3);
    expect((await run("earthquake", 1)).state.world.staff).toBe(2);
    expect((await run("short", 1)).state.world.staff).toBe(3);
  });
});

// ---------- engine の呼び口 ----------

describe("監督の呼び口（engine）", () => {
  it("1 刻みの順は 監督 → 本人役。本人役は差し込みを「この刻みの状況」として読み、差し込みのあとの世界を見る", async () => {
    const order: string[] = [];
    const seen: PersonaInput[] = [];
    const { ticks } = await run(
      "heavy_rain",
      3,
      {
        director: async (x: DirectorInput): Promise<DirectorEvent[]> => {
          order.push(`director:${x.hour}`);
          return x.hour === 3 ? [{ inject: "line_down", person: "p-02", text: "家の電話 不通", ai: true }] : [];
        },
        persona: async (x: PersonaInput) => {
          order.push(`persona:${x.hour}`);
          if (x.hour === 3) seen.push(x);
          return [];
        },
      },
      ["p-01", "p-02"],
    );
    expect(order).toEqual([
      "director:0",
      "persona:0",
      "persona:0",
      "director:1",
      "persona:1",
      "persona:1",
      "director:3",
      "persona:3",
      "persona:3",
    ]);
    const kobayashi = seen.find((x) => x.person === "p-02")!;
    expect(kobayashi.incidents.some((e) => e.actor === "director" && e.inject === "line_down")).toBe(true);
    expect(phoneOf(kobayashi.world, "p-02")).toBe("down");
    expect(phoneOf(kobayashi.world, "p-01")).toBe("busy");
    expect(ticks[2].incidents.at(-1)).toMatchObject({ actor: "director", ai: true, inject: "line_down", person: "p-02", at: 3 });
  });

  it("監督が無い・投げる・空を返すときも 72 時間まで止まらず、表の固定の状況だけ（AI の印なし）", async () => {
    const fixed = (await run("heavy_rain", 12)).ticks;
    for (const hooks of [
      {},
      {
        director: async () => {
          throw new Error("失敗");
        },
      },
      { director: async () => [] as DirectorEvent[] },
    ]) {
      const { state, ticks } = await run("heavy_rain", 12, hooks);
      expect(state.status).toBe("finished");
      expect(ticks.map((t) => t.incidents)).toEqual(fixed.map((t) => t.incidents));
      expect(ticks.flatMap((t) => t.incidents).every((e) => !e.ai)).toBe(true);
    }
  });
});

// ---------- 監督（Opus） ----------

/** 偽の監督: 3 時間に小林へ「訪問看護が来られない」と、捨てられるべき物を混ぜて返す */
function rainDirector(p: Params): Message {
  if (p.model === HAIKU) return reply({ condition: "", location: "home", action: "", contactsCaremanager: false, from: "", pressesRed: false, redAnswers: null, speech: "" }, HAIKU);
  const { scene } = sent(p);
  if (!scene.includes("発災から 3 時間")) return reply(NONE);
  const kobayashi = aliasOf("p-02");
  return reply({
    events: [
      { target: kobayashi, kind: "nurse_away", text: `${kobayashi}の訪問看護が来られない`, reason: `${kobayashi}は人工呼吸器で、支援の欄に空きがある`, basis: "nanbyo-shishin-2017" },
      { target: aliasOf("p-01"), kind: "fire", text: "火が出た", reason: "表の外", basis: NO_BASIS },
    ],
  } satisfies DirectorAnswer);
}

describe("監督（Opus、偽の client）", () => {
  it("送るのは仮名と弱点の要約だけ。Opus・用途 director・出典の一覧つきで 1 刻み 1 回", async () => {
    const { client, calls } = fake(() => reply(NONE));
    const hook = createDirectorHook({ load: seedLoad, ai: aiCtx(client), on: "2026-11-05" });
    const { ticks } = await run("heavy_rain", 4, { director: hook });
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.model).toBe(OPUS);
      const system = (c.system as Array<{ text: string }>).map((b) => b.text).join("\n");
      expect(system).toContain(DIRECTOR_SYSTEM);
      for (const k of INJECT_KINDS) expect(system).toContain(k);
      for (const id of DIRECTOR_SOURCES) expect(system).toContain(id);
      const { scene, weak } = sent(c);
      expectNoPersonalData(scene);
      expectNoPersonalData(weak);
      expect(weak).toContain(`${aliasOf("p-06")}:`);
      // 色・順位は渡さない（ルールの表の言葉が無い）
      for (const w of ["至急", "要確認", "優先"]) expect(`${scene}\n${weak}`).not.toContain(w);
    }
    // 6 時間: 想定の状況に表の差し込み（高橋は仮名）、弱点に台帳の弱点
    const at6 = sent(calls[3]);
    expect(at6.scene).toContain("発災から 6 時間");
    expect(at6.scene).toContain(`家族が栄養剤を持ち出し忘れた（${aliasOf("p-06")}）`);
    expect(at6.weak).toContain("支援者: なし");
    expect(at6.weak).toContain("夜間支援");
    expect(at6.weak).toMatch(/人工呼吸器 内蔵電池 [0-9.]+ 時間を超過/);
    // 監督は何も足していない
    expect(ticks.flatMap((t) => t.incidents).filter((e) => e.ai)).toEqual([]);
    expect(sqlite.prepare("SELECT purpose, model, status FROM ai_calls").all()).toEqual(
      Array.from({ length: 4 }, () => ({ purpose: "director", model: OPUS, status: "ok" })),
    );
  });

  it("表の外の種類・知らない仮名・その人に当てはまらない種類・同じ人の 2 つ目・人の生き死にの文は捨てる。文は掃除、根拠は一覧の物だけ", () => {
    const { key } = pseudonymize(PARTICIPANTS.map(input), { on: "2026-11-05" });
    const eligible = new Map(PARTICIPANTS.map((p) => [p, eligibleKinds(input(p), p, { ...EMPTY_WORLD, staff: 3 }, null)]));
    const a = (id: string) => aliasOf(id);
    const events = directorEvents(
      {
        events: [
          { target: a("p-01"), kind: "earthquake", text: "余震", reason: "表の外", basis: NO_BASIS },
          { target: "Z さん", kind: "road_blocked", text: "家の前の道 冠水", reason: "知らない人", basis: NO_BASIS },
          { target: a("p-01"), kind: "dialysis_flooded", text: "透析施設 浸水", reason: "透析の人でない", basis: NO_BASIS },
          { target: a("p-04"), kind: "road_blocked", text: "家の前の道で心肺停止", reason: "生き死に", basis: NO_BASIS },
          { target: `${a("p-06").replace(" ", "")}`, kind: "supply_left", text: `${a("p-06")}の家族が栄養剤を忘れた`, reason: `${a("p-06")}は経管栄養`, basis: "nanbyo-shishin-2017" },
          { target: a("p-06"), kind: "road_blocked", text: "家の前の道 冠水", reason: "同じ人の 2 つ目", basis: NO_BASIS },
          { target: a("p-03"), kind: "dialysis_flooded", text: "透析施設が浸水。診断が要る", reason: "透析先 未確認", basis: "jcs-disaster-2014" },
          { target: a("p-02"), kind: "nurse_away", text: "訪問看護 来られない", reason: "3 つ目", basis: NO_BASIS },
        ],
      },
      { key, eligible },
    );
    expect(events).toEqual([
      {
        inject: "supply_left",
        person: "p-06",
        text: "本人の家族が栄養剤を忘れた",
        reason: expect.stringContaining("高橋"),
        basis: "nanbyo-shishin-2017",
        ai: true,
      },
      // 使わない言葉の文は種類の固定の文。一覧に無い出典は落とす
      { inject: "dialysis_flooded", person: "p-03", text: INJECT_TEXTS.dialysis_flooded, reason: "透析先 未確認", ai: true },
    ]);
    expect(personOfAlias("A", key)).toBe(PARTICIPANTS[0]);
    expect(personOfAlias("AA さん", key)).toBeNull();
  });

  it("鍵なし・上限・つながらない・形の違い・台帳を読めない は差し込みなし（止まらない）", async () => {
    const cases: Array<() => ReturnType<typeof createDirectorHook>> = [
      () => createDirectorHook({ load: seedLoad, ai: aiCtx(undefined, {}) }),
      () => createDirectorHook({ load: seedLoad, ai: aiCtx(fake(() => reply(NONE)).client, { ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }) }),
      () =>
        createDirectorHook({
          load: seedLoad,
          ai: aiCtx(
            fake(() => {
              throw new Anthropic.APIConnectionError({ message: "つながらない" });
            }).client,
          ),
        }),
      () => createDirectorHook({ load: seedLoad, ai: aiCtx(fake(() => reply("JSON でない")).client) }),
      () => createDirectorHook({ load: seedLoad, ai: aiCtx(fake(() => reply({ events: [{ target: "A さん" }] })).client) }),
      () =>
        createDirectorHook({
          load: async () => {
            throw new Error("D1 が読めない");
          },
          ai: aiCtx(fake(() => reply(NONE)).client),
        }),
    ];
    for (const make of cases) expect(await make()(directorInput())).toEqual([]);
  });

  it("差し込める人がいなければ Opus を呼ばない", async () => {
    const { client, calls } = fake(() => reply(NONE));
    const hook = createDirectorHook({ load: seedLoad, ai: aiCtx(client) });
    // 伊藤（p-05）だけ: 家の前の道はもう通行止、電話は不通、経管栄養・透析・訪問看護なし、家にいる
    let world: WorldState = { ...EMPTY_WORLD, phone: "down" };
    world = applyEvent(world, { change: injectChange("road_blocked", "p-05"), text: "", person: "p-05" }, 1);
    expect(eligibleKinds(input("p-05"), "p-05", world, null)).toEqual([]);
    expect(await hook(directorInput({ participants: ["p-05"], world }))).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------- 差し込める種類・世界 → 時計 ----------

describe("差し込める種類と世界の状態", () => {
  it("その人に当てはまる種類だけ（栄養剤は経管栄養、透析施設は透析、訪問看護は連絡先、帰宅は家の外）、起きた物は外す", () => {
    const w = { ...EMPTY_WORLD, staff: 3 };
    expect(eligibleKinds(input("p-06"), "p-06", w, null)).toEqual(["supply_left", "road_blocked", "line_down"]);
    expect(eligibleKinds(input("p-03"), "p-03", w, null)).toEqual(["dialysis_flooded", "road_blocked", "line_down"]);
    expect(eligibleKinds(input("p-02"), "p-02", w, null)).toEqual(["road_blocked", "line_down", "nurse_away"]);
    const atShelter = { color: "green" as const, source: "family" as const, whereNow: "shelter" as const, at: 3, saying: null, doing: null };
    expect(eligibleKinds(input("p-06"), "p-06", w, atShelter)).toContain("going_home");
    // 起きた物は外す
    let after = applyEvent(w, { change: injectChange("supply_left", "p-06"), text: "", person: "p-06" }, 6);
    after = applyEvent(after, { change: injectChange("line_down", "p-06"), text: "", person: "p-06" }, 6);
    expect(eligibleKinds(input("p-06"), "p-06", after, null)).toEqual(["road_blocked"]);
  });

  it("世界 → 時計の頼り先: 栄養剤の持ち出し忘れは配達 未確認、透析施設の休止は透析先 未確認。ほかの人・ほかの時計は変えない", () => {
    const clocks = [
      { id: "k-06-1", person_id: "p-06", category: "tube_feeding" as const, depends_on: null, depends_check: null },
      { id: "k-03-1", person_id: "p-03", category: "dialysis" as const, depends_on: "dialysis_center" as const, depends_check: "confirmed" as const },
      { id: "k-08-1", person_id: "p-08", category: "insulin" as const, depends_on: "refrigeration" as const, depends_check: "confirmed" as const },
    ];
    expect(drillClocks(clocks, { ...EMPTY_WORLD })).toEqual(clocks);
    let w = applyEvent(EMPTY_WORLD, { change: injectChange("supply_left", "p-06"), text: "", person: "p-06" }, 6);
    w = applyEvent(w, { change: injectChange("dialysis_flooded", "p-03"), text: "", person: "p-03" }, 12);
    expect(drillClocks(clocks, w)).toEqual([
      { ...clocks[0], depends_on: "delivery", depends_check: "unconfirmed" },
      { ...clocks[1], depends_check: "unconfirmed" },
      clocks[2],
    ]);
    // 元の行は変えない
    expect(clocks[0].depends_on).toBeNull();
  });
});

// ---------- D1: 左の表 ----------

async function colors(id: string) {
  const s = (await loadDrillScreen(db, SCOPE, id, null))!;
  return { s, row: (p: string) => s.rows.find((r) => r.id === p)!.triage! };
}

describe("D1: 大雨で監督の差し込みが左の表に出る", () => {
  it("6 時間に高橋が黄（配達 未確認）、12 時間に田中の透析施設が休止（透析先 未確認）。表の固定の物（鍵なし）", async () => {
    const r = await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "drill-t19");
    expect(r).toEqual({ ok: true, id: "drill-t19" });
    for (const n of [0, 1]) await advanceDrill(db, SCOPE, "drill-t19", n, START);
    let c = await colors("drill-t19");
    expect(c.s.state.hour).toBe(3);
    expect(c.row("p-06").color).toBe("green");

    await advanceDrill(db, SCOPE, "drill-t19", 2, START);
    c = await colors("drill-t19");
    expect(c.s.state.hour).toBe(6);
    expect(c.row("p-06")).toMatchObject({ color: "yellow", rule: "green_unchecked" });
    expect(c.row("p-06").reason).toContain("配達 未確認");
    // 状況の欄: 6 時間の刻みに監督の固定の差し込み（AI の印なし）
    const at6 = c.s.ticks.find((t) => t.hour === 6)!;
    expect(at6.incidents.find((e) => e.actor === "director")).toMatchObject({ inject: "supply_left", person: "p-06", ai: false });
    expect(c.s.names["p-06"]).toContain("高橋");
    // 行の詳細の時計にも配達 未確認
    const detail = c.s.rows.find((r) => r.id === "p-06")!.detail!;
    expect(detail.clocks.map((k) => k.depends)).toEqual([{ on: "配達", check: "未確認", unchecked: true }]);

    for (const n of [3, 4]) await advanceDrill(db, SCOPE, "drill-t19", n, START);
    c = await colors("drill-t19");
    expect(c.s.state.hour).toBe(12);
    expect(c.s.state.world.facilities.find((f) => f.person === "p-03")).toMatchObject({ open: false, label: "透析施設" });
    expect(c.row("p-03").color).toBe("yellow");
    expect(c.row("p-03").reason).toContain("透析先 未確認");
    // 再生（6 時間）でも同じ色
    const replay = (await loadDrillScreen(db, SCOPE, "drill-t19", 3))!;
    expect(replay.rows.find((x) => x.id === "p-06")!.triage).toMatchObject({ color: "yellow", rule: "green_unchecked" });
  });

  it("Opus の差し込みは AI の印つきで状況に出て、理由と根拠は訓練記録に残る（表の外の物は捨てる）", async () => {
    const { client, calls } = fake(rainDirector);
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) });
    expect(hooks?.director).toBeTypeOf("function");
    const started = await startDrill(db, SCOPE, "heavy_rain", START, hooks, () => "drill-ai");
    expect(started).toEqual({ ok: true, id: "drill-ai" });
    for (const n of [0, 1]) expect((await advanceDrill(db, SCOPE, "drill-ai", n, START, hooks)).ok).toBe(true);
    // Opus は 1 刻み 1 回（3 刻みで 3 回）
    expect(calls.filter((c) => c.model === OPUS)).toHaveLength(3);
    // 本人役の小林は、監督の差し込みを状況として読んでいる
    const kobayashiTick = calls.find((c) => c.model === HAIKU && JSON.stringify(c.messages).includes("発災から 3 時間") && JSON.stringify(c.messages).includes("訪問看護が来られない"));
    expect(kobayashiTick).toBeDefined();

    const row = sqlite
      .prepare("SELECT actor, person_id, payload FROM drill_events WHERE drill_id = 'drill-ai' AND kind = 'incident' AND actor = 'director'")
      .all() as Array<{ actor: string; person_id: string; payload: string }>;
    expect(row).toHaveLength(1);
    const payload = JSON.parse(row[0].payload) as Record<string, unknown>;
    expect(row[0].person_id).toBe("p-02");
    expect(payload).toMatchObject({ inject: "nurse_away", ai: true, basis: "nanbyo-shishin-2017", text: "本人の訪問看護が来られない" });
    // 理由は仮名を氏名に戻して残す（サーバーの中だけ）
    expect(payload.reason).toContain("小林");
    expect(payload.reason).not.toContain(aliasOf("p-02"));

    // 再生（保存した刻みから）でも同じ物
    const ticks = await loadTicks(db, "drill-ai", SCENARIOS.heavy_rain.hours, 2);
    const inserted = ticks[2].incidents.filter((e) => e.actor === "director");
    expect(inserted).toEqual([
      expect.objectContaining({ inject: "nurse_away", person: "p-02", ai: true, basis: "nanbyo-shishin-2017", at: 3 }),
    ]);
    const screen = (await loadDrillScreen(db, SCOPE, "drill-ai", null))!;
    expect(screen.state.world.marks["p-02"]).toEqual({ nurseAway: 3 });
    expect(screen.state.world.facilities).toEqual([]);
  });
});

// ---------- 世界の返事（T20 の口） ----------

describe("ケアマネの手への世界の返事（確率は表、文は固定）", () => {
  const ask = (over: Partial<WorldAsk>): WorldAsk => ({ action: "visit", person: "p-05", world: { ...EMPTY_WORLD, staff: 3 }, hour: 6, ...over });
  const closed = applyEvent({ ...EMPTY_WORLD, staff: 3 }, { change: injectChange("road_blocked", "p-05"), text: "", person: "p-05" }, 3);

  it("出向く: 家の前の道が通行止なら着けない。警戒の中は確率が下がる", () => {
    expect(decideWorldReply(ask({ world: closed }), 0)).toMatchObject({ ok: false, status: "blocked", because: "家の前の道 通行止", ai: false });
    expect(decideWorldReply(ask({}), WORLD_ODDS.reach.clear - 0.01)).toMatchObject({ ok: true, status: "arrived" });
    const warning = { ...EMPTY_WORLD, alertLevel: 4 as const };
    expect(decideWorldReply(ask({ world: warning }), WORLD_ODDS.reach.warning - 0.01)).toMatchObject({ ok: true });
    expect(decideWorldReply(ask({ world: warning }), WORLD_ODDS.reach.warning)).toMatchObject({ ok: false, status: "turnedBack" });
  });

  it("電話: 家の電話が不通なら本人にはつながらず、家族には呼び出す。透析施設が休止なら受けられない", () => {
    const line = applyEvent(EMPTY_WORLD, { change: injectChange("line_down", "p-02"), text: "", person: "p-02" }, 3);
    expect(decideWorldReply({ action: "call_person", person: "p-02", world: line, hour: 3 }, 0)).toMatchObject({
      ok: false,
      status: "noLine",
      because: "家の電話 不通",
    });
    expect(decideWorldReply({ action: "call_contact", person: "p-02", callee: "family", world: line, hour: 3 }, 0.99)).toMatchObject({
      ok: true,
      status: "ringing",
    });
    const flooded = applyEvent(EMPTY_WORLD, { change: injectChange("dialysis_flooded", "p-03"), text: "", person: "p-03" }, 12);
    expect(decideWorldReply({ action: "call_contact", person: "p-03", callee: "dialysis_center", world: flooded, hour: 12 }, 0)).toMatchObject({
      ok: false,
      status: "closed",
      because: "透析施設 休止",
    });
    const busy = { ...EMPTY_WORLD, phone: "busy" as const };
    expect(decideWorldReply({ action: "call_contact", person: "p-01", callee: "home_doctor", world: busy, hour: 3 }, 0.49).ok).toBe(true);
    expect(decideWorldReply({ action: "call_contact", person: "p-01", callee: "home_doctor", world: busy, hour: 3 }, 0.5).ok).toBe(false);
  });

  it("出向いてもらう: 訪問看護が来られない・職員の空きなし・通行止なら出せない", () => {
    const away = applyEvent({ ...EMPTY_WORLD, staff: 3 }, { change: injectChange("nurse_away", "p-02"), text: "", person: "p-02" }, 3);
    expect(decideWorldReply({ action: "dispatch", person: "p-02", callee: "visiting_nurse", world: away, hour: 3 }, 0)).toMatchObject({
      ok: false,
      because: "訪問看護 来られない",
    });
    expect(decideWorldReply({ action: "dispatch", person: "p-02", callee: "care_service", world: away, hour: 3 }, 0)).toMatchObject({
      ok: true,
      status: "dispatched",
    });
    expect(decideWorldReply({ action: "dispatch", person: "p-02", world: { ...EMPTY_WORLD, staff: 0 }, hour: 3 }, 0)).toMatchObject({
      ok: false,
      because: "職員の空き なし",
    });
    expect(decideWorldReply({ action: "dispatch", person: "p-05", world: closed, hour: 3 }, 0)).toMatchObject({ ok: false, status: "blocked" });
  });

  it("福祉避難所は時間で受けやすくなる。電話が不通なら頼めない。市役所への報告・自分の避難", () => {
    expect([acceptOdds(6), acceptOdds(30), acceptOdds(60)]).toEqual([0.3, 0.6, 0.8]);
    const shelter = (hour: number, roll: number, world = EMPTY_WORLD) =>
      decideWorldReply({ action: "request_welfare_shelter", person: "p-06", world, hour }, roll);
    expect(shelter(6, 0.29).ok).toBe(true);
    expect(shelter(6, 0.3)).toMatchObject({ ok: false, status: "refused" });
    expect(shelter(60, 0.79).ok).toBe(true);
    expect(shelter(60, 0, { ...EMPTY_WORLD, phone: "down" })).toMatchObject({ ok: false, because: "電話 不通" });
    expect(decideWorldReply({ action: "report_city", person: null, world: EMPTY_WORLD, hour: 6 }, 0)).toMatchObject({ ok: true, status: "reported" });
    expect(decideWorldReply({ action: "evacuate_self", person: null, world: EMPTY_WORLD, hour: 6 }, 0.99)).toMatchObject({ ok: true, status: "evacuated" });
  });

  it("文の言い換え（T20 の Opus）は文だけ変え、失敗・空は固定の文（AI の印なし）", async () => {
    const a = ask({ world: closed });
    expect(await worldReply(a, 0, async () => "道が冠水して車で入れない")).toMatchObject({ ok: false, status: "blocked", text: "道が冠水して車で入れない", ai: true });
    expect(await worldReply(a, 0, async () => null)).toMatchObject({ text: "道が通れず近づけない", ai: false });
    expect(
      await worldReply(a, 0, async () => {
        throw new Error("失敗");
      }),
    ).toMatchObject({ text: "道が通れず近づけない", ai: false });
  });
});
