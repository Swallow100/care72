// T104 訓練の世界: 発災からの時間の目安（監督と世界に）・仮想の規模（下限と幅・おまかせ）・訓練する人（自分）の住む所と身の回り。
// 訓練は node:sqlite の D1 と種の 10 人で本物の道。Claude は偽の client だけ（本物の API は呼ばない）。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { aliasFor, type PseudonymInput } from "../pseudonym/index.ts";
import { isSourceId, sourceById } from "../sources/index.ts";
import { NO_BASIS } from "../sources/prompt.ts";
import { DEMO_AREA, NO_TOWN, areaOf } from "./area.ts";
import { drillScope, loadDrillRow, startDrill, stateOfRow, type StartOptions } from "./db.ts";
import { basisOf, createDirectorHook, DIRECTOR_SOURCES, DIRECTOR_SYSTEM, sceneText, weaknessText } from "./director.ts";
import {
  advance,
  cleanOptions,
  initialState,
  openingIncidents,
  step,
  worldExtras,
  type DirectorInput,
  type DrillState,
  type WorldInput,
} from "./engine.ts";
import {
  EVENT_CATALOG,
  eligibleAreaKinds,
  eligibleSelfKinds,
  INJECT_KINDS,
  isSelfKind,
  NOTE_LABELS,
  SELF_DRILL_MAX,
  type InjectKind,
  type SelfFacts,
} from "./event-catalog.ts";
import { parseStartOptions } from "./http.ts";
import { directorIncidents } from "./incident-types.ts";
import { T104_LABELS } from "./options.ts";
import { fitToScale, isDrillScale, pickScale, SCALE_CHOICES, scaleIncidents, scaleKey, scaleOfKey, scaleWords, type DrillScale } from "./scale.ts";
import { fireScheduled } from "./schedule.ts";
import { applyEvents, EMPTY_WORLD, type WorldEvent, type WorldState } from "./scenarios.ts";
import { homeFacts, homeTowns, homeWords } from "./self.ts";
import { bandOf, TIME_BANDS, TIMELINE, TIMELINE_SOURCES, timelineText } from "./time-odds.ts";
import { tickText as worldTickText } from "./world-oneshot.ts";

// ---------- 種と偽の Claude ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const SEED = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p)]));
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const NAMES = SEED_PEOPLE.map((p) => p.person.name);
const TOWNS = DEMO_AREA.towns.flatMap((t) => t.homes ?? [t.town]);

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPUS,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}
function fake(answer: (p: Params) => Message) {
  const calls: Params[] = [];
  const client: ClaudeClient = { beta: { messages: { create: async (params) => (calls.push(params), answer(params)) } } };
  return { client, calls };
}
const START = "2026-11-05T01:00:00.000Z";
const aiCtx = (claude: ClaudeClient): AskJsonContext => ({
  env: { ANTHROPIC_API_KEY: "dummy" },
  usage: d1UsageStore(db),
  office: { id: "office-demo", kind: "demo" },
  now: () => new Date(START),
  claude,
});
const seedLoad = async () => SEED as ReadonlyMap<string, PseudonymInput>;
const sent = (p: Params) => JSON.parse(p.messages[0].content as string) as Record<string, { text: string }>;
const systemOf = (p: Params) => (Array.isArray(p.system) ? p.system.map((b) => ("text" in b ? b.text : "")).join("\n") : String(p.system ?? ""));

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
const ID = "drill-t104";
async function startWith(scenario: DrillState["scenario"], options: StartOptions, rand?: () => number) {
  return startDrill(db, SCOPE, scenario, START, {}, () => ID, options, rand);
}
const storedState = async () => stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
const storedJson = async () => (await loadDrillRow(db, DEMO.id, ID))!.world;

/** 監督の入力の素（世界は全域の停電中） */
function directorInput(over: Partial<DirectorInput> = {}): DirectorInput {
  return {
    scenario: "earthquake",
    step: 1,
    hour: 8,
    world: { ...EMPTY_WORLD, staff: 1, quake: "6強", outage: { area: { scope: "office" }, since: 0, restoredAt: null } },
    incidents: [],
    participants: PARTICIPANTS,
    people: {},
    actions: [],
    ...over,
  };
}

const BANNED = /死亡|亡くな|死ん|関連死|心肺停止|診断|判定|重症|緊急度/;

// ---------- 1. 時間の目安 ----------

describe("時間ごとの起きやすさの目安（lib/drill/time-odds.ts）", () => {
  it("帯は 0〜3・3〜12・12〜24・24〜72 時間で、どの帯にも行があり、どの行にも登録簿の出典が 1 つ以上・種類は出来事の表の物", () => {
    expect(TIME_BANDS.map((b) => [b.from, b.to])).toEqual([
      [0, 3],
      [3, 12],
      [12, 24],
      [24, 72],
    ]);
    for (const b of TIME_BANDS) {
      expect(TIMELINE[b.id].length, b.id).toBeGreaterThan(0);
      for (const l of TIMELINE[b.id]) {
        expect(l.sources.length, l.text).toBeGreaterThan(0);
        for (const id of l.sources) expect(isSourceId(id), id).toBe(true);
        for (const k of l.kinds) expect((INJECT_KINDS as readonly string[]).includes(k), k).toBe(true);
        expect(l.text, l.text).not.toMatch(BANNED);
        // 自分の種類は目安に入れない（訓練の主役は担当の人）
        for (const k of l.kinds) expect(isSelfKind(k), k).toBe(false);
      }
    }
  });

  it("帯の境（3 時間は 3〜12 の帯、72 時間は最後の帯、負・数でない値は最初の帯）", () => {
    expect(bandOf(0).id).toBe("h0");
    expect(bandOf(2.99).id).toBe("h0");
    expect(bandOf(3).id).toBe("h3");
    expect(bandOf(11.5).id).toBe("h3");
    expect(bandOf(12).id).toBe("h12");
    expect(bandOf(24).id).toBe("h24");
    expect(bandOf(72).id).toBe("h24");
    expect(bandOf(-1).id).toBe("h0");
    expect(bandOf(Number.NaN).id).toBe("h0");
  });

  it("出典は全部監督の根拠の一覧にあり、健康の助言の文書は監督の一覧にも指示にも入れない", () => {
    for (const id of TIMELINE_SOURCES) expect(DIRECTOR_SOURCES as readonly string[], id).toContain(id);
    for (const id of ["jadec-insulin-2023", "jrs-respiratory-2012", "jsth-pe-2020", "mhlw-ecs-2018"]) {
      expect(DIRECTOR_SOURCES as readonly string[]).not.toContain(id);
      expect(DIRECTOR_SYSTEM).not.toContain(id);
    }
    // 新しく足した出典は登録簿にあり、未確認（作者の確認の欄は空のまま）
    for (const id of ["soumu-iburi-2019", "soumu-tsushin-2026", "mhlw-water-2016", "cao-hinanjo-2016", "cao-fukushi-2021"]) {
      expect(sourceById(id).checkedOn).toBeNull();
      expect(DIRECTOR_SOURCES as readonly string[]).toContain(id);
    }
  });

  it("監督の文は今の帯の行だけ（種類と出典の id つき）、世界の文は文だけ", () => {
    const at = (h: number) => timelineText(h, { with: "director" });
    expect(at(1)).toContain("発災から 0〜3 時間");
    expect(at(1)).toContain("出典: soumu-iburi-2019");
    expect(at(1)).not.toContain("発災から 3〜12 時間");
    expect(at(14)).toContain("種類: water_station");
    expect(at(14)).toContain("mhlw-water-2016");
    const w = timelineText(30, { with: "world" });
    expect(w).toContain("発災から 24〜72 時間");
    expect(w).not.toContain("出典:");
    expect(w).not.toContain("種類:");
  });

  it("監督の想定の文に今の帯の目安が入る（時刻が進むと帯が変わる）", () => {
    const aliasOf = new Map(PARTICIPANTS.map((p, i) => [p, aliasFor(i)]));
    expect(sceneText(directorInput({ hour: 2 }), aliasOf, 72)).toContain("この時間帯（発災から 0〜3 時間）に起きやすい事");
    expect(sceneText(directorInput({ hour: 30 }), aliasOf, 72)).toContain("この時間帯（発災から 24〜72 時間）に起きやすい事");
  });

  it("目安の出典に合う種類は監督が根拠を選べる（表の一覧の中だけ）。前からの根拠の決まりは変わらない", () => {
    expect(basisOf("outage_spread", "soumu-iburi-2019")).toBe("soumu-iburi-2019");
    expect(basisOf("mobile_down", "soumu-tsushin-2026")).toBe("soumu-tsushin-2026");
    expect(basisOf("water_station", "mhlw-water-2016")).toBe("mhlw-water-2016");
    expect(basisOf("outage_eta", "soumu-iburi-2019")).toBe("soumu-iburi-2019");
    expect(basisOf("outage_eta", "mhlw-bcp-2020")).toBe("mhlw-bcp-2020");
    // 表の一覧に無い出典・根拠なしは捨てる
    expect(basisOf("mobile_down", "mhlw-water-2016")).toBeNull();
    expect(basisOf("outage_spread", NO_BASIS)).toBeNull();
    expect(basisOf("aftershock", "soumu-iburi-2019")).toBeNull();
  });

  it("偽の Opus: 監督に渡る想定の文に目安が入り、根拠の一覧（system）に新しい出典。氏名・町名は渡らない", async () => {
    const { client, calls } = fake(() => reply({ events: [] }));
    const hook = createDirectorHook({ load: seedLoad, ai: aiCtx(client), on: "2026-11-05" });
    await hook(directorInput({ hour: 14 }));
    expect(calls).toHaveLength(1);
    const body = JSON.stringify(sent(calls[0]));
    expect(sent(calls[0])["想定"].text).toContain("この時間帯（発災から 12〜24 時間）に起きやすい事");
    expect(systemOf(calls[0])).toContain("soumu-iburi-2019");
    expect(systemOf(calls[0])).toContain("mhlw-water-2016");
    for (const n of NAMES) expect(body).not.toContain(n);
    for (const t of TOWNS) expect(body).not.toContain(t);
  });

  it("世界（仮想）の刻みの文にも今の帯の目安（文だけ）", () => {
    const input = { ...directorInput({ scenario: "virtual", hour: 5 }), hints: { reached: [], clocks: [] }, session: null, minute: 300 } satisfies WorldInput;
    const text = worldTickText(input, { key: { people: [], places: [] } as never }, 3, 72);
    expect(text).toContain("この時間帯（発災から 3〜12 時間）に起きやすい事");
    expect(text).not.toContain("出典:");
  });
});

// ---------- 2. 規模 ----------

describe("仮想の規模（lib/drill/scale.ts）", () => {
  it("選べる規模は大雨 警戒レベル 3〜5 と地震 震度 5強〜7 の 7 つ。外の値は受けない", () => {
    expect(SCALE_CHOICES.map(scaleKey)).toEqual([
      "heavy_rain:3",
      "heavy_rain:4",
      "heavy_rain:5",
      "earthquake:5強",
      "earthquake:6弱",
      "earthquake:6強",
      "earthquake:7",
    ]);
    for (const bad of [
      { kind: "earthquake", level: "1" },
      { kind: "earthquake", level: "5弱" },
      { kind: "heavy_rain", level: 2 },
      { kind: "heavy_rain", level: "4" },
      { kind: "tsunami", level: 3 },
      null,
      "earthquake:7",
    ])
      expect(isDrillScale(bad), JSON.stringify(bad)).toBe(false);
    for (const s of SCALE_CHOICES) expect(scaleOfKey(scaleKey(s))).toEqual(s);
  });

  it("おまかせは幅の外に出ない（乱数の端も）。乱数を刻むと 7 つ全部が出る", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 700; i++) {
      const s = pickScale(() => i / 700);
      expect(isDrillScale(s)).toBe(true);
      seen.add(scaleKey(s));
    }
    expect(seen.size).toBe(SCALE_CHOICES.length);
    for (const r of [0, 0.9999999, 1, -0.5, Number.NaN]) expect(isDrillScale(pickScale(() => r)), String(r)).toBe(true);
  });

  it("仮想をおまかせで始めると、引いた規模を残し（scaleAuto）、最初の区切りに規模の出来事（AI の印なし）", async () => {
    expect(await startWith("virtual", { clock: true }, () => 0.99)).toEqual({ ok: true, id: ID });
    const s = await storedState();
    expect(s.options?.scale).toEqual({ kind: "earthquake", level: "7" });
    expect(s.options?.scaleAuto).toBe(true);
    expect(s.world.quake).toBe("7");
    // 保存から読み直しても同じ規模（引き直さない）
    expect((await storedState()).options?.scale).toEqual({ kind: "earthquake", level: "7" });
  });

  it("仮想で規模を選ぶと、その規模のまま（大雨は警戒レベルと大雨）", async () => {
    expect(await startWith("virtual", { clock: true, scale: { kind: "heavy_rain", level: 4 } })).toEqual({ ok: true, id: ID });
    const s = await storedState();
    expect(s.options?.scale).toEqual({ kind: "heavy_rain", level: 4 });
    expect(s.options?.scaleAuto).toBeUndefined();
    expect(s.world.alertLevel).toBe(4);
    expect(s.world.weather).toBe("rain");
    expect(s.world.quake).toBeNull();
  });

  it("固定の筋（大雨想定・地震想定・10 分版）に規模を送っても、保存の形は送らないときと 1 字も変わらない", async () => {
    for (const scenario of ["heavy_rain", "earthquake", "short"] as const) {
      const clock = scenario === "short" ? {} : { clock: true as const };
      expect(await startWith(scenario, { ...clock, scale: { kind: "earthquake", level: "7" } })).toEqual({ ok: true, id: ID });
      const withScale = await storedJson();
      sqlite.close();
      sqlite = migratedSqlite();
      for (const s of seedStatements()) sqlite.exec(s);
      db = d1FromSqlite(sqlite);
      expect(await startWith(scenario, { ...clock })).toEqual({ ok: true, id: ID });
      expect(await storedJson(), scenario).toBe(withScale);
      expect((await storedState()).options?.scale, scenario).toBeUndefined();
      sqlite.close();
      sqlite = migratedSqlite();
      for (const s of seedStatements()) sqlite.exec(s);
      db = d1FromSqlite(sqlite);
    }
  });

  it("規模の出来事は仮想の最初の区切りだけ。規模の無い訓練・固定の筋・2 つ目からは無い", () => {
    const v = initialState("virtual", PARTICIPANTS, START, { clock: true, scale: { kind: "earthquake", level: "6弱" } });
    expect(openingIncidents(v, true).map((e) => [e.change, e.text, e.ai, e.actor])).toEqual([
      [{ kind: "quake", intensity: "6弱" }, "地震 震度 6弱", false, "world"],
    ]);
    expect(openingIncidents(v, false)).toEqual([]);
    expect(openingIncidents(initialState("virtual", PARTICIPANTS, START, { clock: true }), true)).toEqual([]);
    expect(openingIncidents(initialState("heavy_rain", PARTICIPANTS, START, { clock: true, scale: { kind: "heavy_rain", level: 5 } }), true)).toEqual([]);
  });

  it("世界の余震は規模の震度まで（超えた分は規模の震度に）。大雨の訓練では余震を当てない", () => {
    const quake = (intensity: string) => ({ actor: "director" as const, at: 2, ai: true, change: { kind: "quake" as const, intensity }, text: `余震 震度 ${intensity}` });
    const road = { actor: "director" as const, at: 2, ai: true, change: { kind: "weather" as const, state: "rain" as const }, text: "大雨" };
    const eq: DrillScale = { kind: "earthquake", level: "6弱" };
    expect(fitToScale([quake("7"), quake("4"), road], eq).map((e) => [e.change, e.text])).toEqual([
      [{ kind: "quake", intensity: "6弱" }, "余震 震度 6弱"],
      [{ kind: "quake", intensity: "4" }, "余震 震度 4"],
      [road.change, "大雨"],
    ]);
    expect(fitToScale([quake("4"), road], { kind: "heavy_rain", level: 3 }).map((e) => e.change.kind)).toEqual(["weather"]);
    expect(fitToScale([quake("7")], null).map((e) => e.change)).toEqual([{ kind: "quake", intensity: "7" }]);
  });

  it("偽の世界: 仮想の最初の区切りで世界の返した大きな余震は規模に抑えられ、世界には規模の 1 行が渡る", async () => {
    const seen: WorldInput[] = [];
    const s0 = initialState("virtual", PARTICIPANTS, START, { clock: true, scale: { kind: "earthquake", level: "5強" } });
    const r = await advance(s0, 0, {
      world: async (input) => {
        seen.push(input);
        return { incidents: [{ actor: "director", at: 0, ai: true, change: { kind: "quake", intensity: "7" }, text: "余震 震度 7" }] };
      },
    });
    expect(seen[0].scale).toEqual({ kind: "earthquake", level: "5強" });
    expect(seen[0].self).toBeUndefined();
    expect(r!.state.world.quake).toBe("5強");
    expect(r!.tick.incidents.filter((e) => e.change.kind === "quake").map((e) => e.text)).toEqual(["地震 震度 5強", "余震 震度 5強"]);
    expect(scaleWords({ kind: "earthquake", level: "5強" })).toContain("最大震度 5強");
  });

  it("開始の受け口: 規模は 7 つのどれか、自宅は短い町名だけ", () => {
    expect(parseStartOptions({ scale: { kind: "earthquake", level: "6強" }, home: " みずほし町 " })).toEqual({
      scale: { kind: "earthquake", level: "6強" },
      home: "みずほし町",
    });
    expect(parseStartOptions({ scale: { kind: "earthquake", level: "3" } })).toBeNull();
    expect(parseStartOptions({ scale: "heavy_rain:4" })).toBeNull();
    expect(parseStartOptions({ home: "" })).toBeNull();
    expect(parseStartOptions({ home: 3 })).toBeNull();
    expect(parseStartOptions({ home: "あ".repeat(41) })).toBeNull();
    // 保存の読み直しも同じ形だけ残す
    expect(cleanOptions({ scale: { kind: "earthquake", level: "1" } as never, home: "  " })).toEqual({});
    expect(cleanOptions({ scale: { kind: "heavy_rain", level: 3 }, scaleAuto: true })).toEqual({ scale: { kind: "heavy_rain", level: 3 }, scaleAuto: true });
  });
});

// ---------- 3. 訓練する人（自分）の住む所と身の回り ----------

const facts = (over: Partial<SelfFacts> = {}): SelfFacts => ({
  world: { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0, restoredAt: null } },
  hour: 2,
  night: false,
  home: null,
  ...over,
});
const SELF_KINDS: InjectKind[] = ["self_outage", "self_family", "self_late", "self_battery"];

describe("訓練する人の住む所（lib/drill/self.ts）", () => {
  it("選べる地区: デモは架空の街の町、ほかの事業所は台帳の町名（町名なしを入れない）", () => {
    expect(homeTowns("office-demo", [])).toEqual(TOWNS);
    const ledgers = [{ basic: { address: { town: "西町" } } }, { basic: { address: { town: "東町" } } }, { basic: { address: { town: " 西町 " } } }, { basic: {} }];
    expect(homeTowns("office-other", ledgers as never)).toEqual(["西町", "東町"].sort((a, b) => a.localeCompare(b, "ja")));
    expect(homeTowns("office-other", ledgers as never)).not.toContain(NO_TOWN);
  });

  it("監督に渡す言い方は別名と地形の一言だけ（町名を書かない）。既定は事業所の近く", () => {
    expect(homeWords({ home: null }, DEMO_AREA)).toBe("事業所の近く");
    expect(homeWords({ home: "みずほし町" }, DEMO_AREA)).toBe("乙地区（標高 5〜10 m。近くの川 宮前川・重信川）");
    expect(homeWords({ home: "みずほし町" }, DEMO_AREA)).not.toContain("みずほし町");
    const other = areaOf("office-other", [{ ledger: SEED.get("p-01")!.ledger }]);
    expect(homeWords({ home: "知らない町" }, other)).toBe("担当の地区の外");
    expect(homeFacts({ home: "かわなぎ町" }, DEMO_AREA)).toEqual({ floodM: 5, landslide: false });
    expect(homeFacts({ home: null }, DEMO_AREA)).toBeNull();
  });

  it("開始: 大雨想定・地震想定の自宅は担当一覧の人の地区の中だけ。10 分版・仮想に来たら捨てる", async () => {
    expect(await startWith("heavy_rain", { clock: true, home: "みずほし町" })).toEqual({ ok: true, id: ID });
    expect((await storedState()).options?.home).toBe("みずほし町");
    sqlite.close();
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
    expect(await startWith("earthquake", { clock: true, home: "知らない町" })).toEqual({ ok: false, error: "invalid" });
    expect(await startWith("short", { home: "みずほし町" })).toEqual({ ok: true, id: ID });
    expect((await storedState()).options?.home).toBeUndefined();
  });

  it("監督に渡る自分の欄は連続の時計の大雨想定・地震想定だけ（10 分版・刻みの道・仮想は無し）", () => {
    expect(worldExtras(initialState("heavy_rain", PARTICIPANTS, START, { clock: true }))).toEqual({ self: { home: null } });
    expect(worldExtras(initialState("earthquake", PARTICIPANTS, START, { clock: true, home: "そらみ台" }))).toEqual({ self: { home: "そらみ台" } });
    expect(worldExtras(initialState("heavy_rain", PARTICIPANTS, START))).toEqual({});
    expect(worldExtras(initialState("short", PARTICIPANTS, START))).toEqual({});
    expect(worldExtras(initialState("virtual", PARTICIPANTS, START, { clock: true }))).toEqual({});
  });
});

describe("自分の出来事（出来事の表の self_*）", () => {
  it("表の 4 行は「自分」の種類で、参加者の台帳からは差し込めない（全体の種類の一覧に入らない）", () => {
    for (const k of SELF_KINDS) {
      expect(isSelfKind(k)).toBe(true);
      expect(EVENT_CATALOG[k].touches).toBe("none");
      expect(EVENT_CATALOG[k].label.length).toBeLessThanOrEqual(4);
      expect(EVENT_CATALOG[k].words).not.toMatch(BANNED);
    }
    const area = eligibleAreaKinds(
      PARTICIPANTS.map((p) => ({ person: p, source: SEED.get(p)!, state: null })),
      facts().world,
    );
    for (const k of SELF_KINDS) expect(area.has(k)).toBe(false);
    expect(DIRECTOR_SYSTEM).toContain("（自分）");
    expect(NOTE_LABELS.self_family_ok).toBe("家族無事");
  });

  it("差し込める自分の種類: 全域の停電・地区の停電と住む所・夜の出勤・停電 6 時間の電池。訓練に 2 つまで", () => {
    expect(eligibleSelfKinds(facts())).toEqual(["self_outage", "self_family"]);
    expect(eligibleSelfKinds(facts({ night: true }))).toEqual(["self_outage", "self_family", "self_late"]);
    expect(eligibleSelfKinds(facts({ night: true, hour: 6 }))).not.toContain("self_late");
    expect(eligibleSelfKinds(facts({ hour: 6 }))).toContain("self_battery");
    // 浸水 3 m の地区の停電: 住む所がかわなぎ町（実の区画は 3 m より深い）なら自宅も停電、事業所の近く・みずほし町（0.5 m）は入らない
    const hazard: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "hazard", hazard: "flood", minDepthM: 3 }, since: 3, restoredAt: null } };
    expect(eligibleSelfKinds(facts({ world: hazard, home: homeFacts({ home: "かわなぎ町" }, DEMO_AREA) }))).toContain("self_outage");
    expect(eligibleSelfKinds(facts({ world: hazard, home: null }))).not.toContain("self_outage");
    expect(eligibleSelfKinds(facts({ world: hazard, home: homeFacts({ home: "みずほし町" }, DEMO_AREA) }))).not.toContain("self_outage");
    // 地区の停電では携帯の電池を出さない（事業所で充電できる）
    expect(eligibleSelfKinds(facts({ world: hazard, hour: 12 }))).not.toContain("self_battery");
    // 停電の無い世界・復旧のあと
    expect(eligibleSelfKinds(facts({ world: EMPTY_WORLD }))).toEqual(["self_family"]);
    // 1 度起きた種類はもう出さず、2 つ起きたら何も出さない
    const one = { ...facts().world, notes: { self_outage: 1 } };
    expect(eligibleSelfKinds(facts({ world: one }))).toEqual(["self_family"]);
    const two = { ...facts().world, notes: { self_outage: 1, self_family: 2 } };
    expect(eligibleSelfKinds(facts({ world: two, hour: 8 }))).toEqual([]);
    expect(SELF_DRILL_MAX).toBe(2);
  });

  it("家族の連絡は何時間後かに無事が分かる予定を積み、時刻が来ると状況になる", () => {
    const parts = EVENT_CATALOG.self_family.build({ person: null }, 3, 2);
    const world = applyEvents(
      { ...EMPTY_WORLD },
      parts.map((p): WorldEvent => ({ change: p.change, text: p.text, at: 3 })),
      3,
    );
    expect(world.notes?.self_family).toBe(3);
    expect(world.scheduled?.map((s) => s.at)).toEqual([300]);
    const fired = fireScheduled(world, 300);
    expect(fired.incidents.map((e) => [e.change, e.text])).toEqual([[{ kind: "note", topic: "self_family_ok" }, "自分の家族 無事を確認"]]);
    expect(fireScheduled(world, 299).incidents).toEqual([]);
  });

  it("監督の返事の自分の種類は、自分の欄のある訓練でだけ状況になる（1 区切りに全体と合わせて 1 つ。人の印なし）", async () => {
    const answer = {
      events: [
        { target: "自分", kind: "self_outage", text: "自宅が停電", reason: "全域の停電", basis: NO_BASIS },
        { target: "全体", kind: "aftershock", text: "余震", reason: "地震", basis: NO_BASIS },
      ],
    };
    const { client, calls } = fake(() => reply(answer));
    const hook = createDirectorHook({ load: seedLoad, ai: aiCtx(client), on: "2026-11-05" });
    const withSelf = await hook(directorInput({ self: { home: "みずほし町" } }));
    const events = Array.isArray(withSelf) ? withSelf : withSelf.events;
    expect(events.map((e) => [e.inject, e.person ?? null])).toEqual([["self_outage", null]]);
    const incidents = directorIncidents(events, new Set(PARTICIPANTS), 8);
    // 文は Opus の 1 行（掃除のあと。使えなければ表の固定の文）
    expect(incidents.map((e) => [e.change, e.text, e.person ?? null, e.ai])).toEqual([[{ kind: "note", topic: "self_outage" }, "自宅が停電", null, true]]);
    // 弱点の文: 住む所は別名と地形の一言（町名なし）、自分に差し込める種類
    const weak = sent(calls[0])["弱点"].text;
    expect(weak).toContain("訓練する人（自分）: 住む所 乙地区（標高 5〜10 m。近くの川 宮前川・重信川）");
    expect(weak).toMatch(/自分に差し込める種類: self_outage、self_family/);
    expect(weak).not.toMatch(/全体に差し込める種類: .*self_/);
    for (const t of TOWNS) expect(JSON.stringify(sent(calls[0]))).not.toContain(t);
    // 自分の欄の無い訓練（10 分版・前からの訓練）: 自分の種類は捨てて、全体の余震が当たる
    const without = await hook(directorInput());
    const ev2 = Array.isArray(without) ? without : without.events;
    expect(ev2.map((e) => e.inject)).toEqual(["aftershock"]);
    expect(sent(calls[1])["弱点"].text).not.toContain("訓練する人（自分）");
  });

  it("連続の時計の大雨想定で、監督に自分の欄（既定は事業所の近く）が渡る。10 分版の監督の入力は前と同じ", async () => {
    const got: DirectorInput[] = [];
    const director = async (input: DirectorInput) => (got.push(input), []);
    await advance(initialState("heavy_rain", PARTICIPANTS, START, { clock: true }), 0, { director });
    expect(got[0].self).toEqual({ home: null });
    expect(got[0].scale).toBeUndefined();
    const short: DirectorInput[] = [];
    await step(initialState("short", PARTICIPANTS, START), { director: async (input) => (short.push(input), []) });
    expect(short[0].self).toBeUndefined();
    expect(short[0].scale).toBeUndefined();
  });

  it("弱点の文の自分の行は self があるときだけ", () => {
    expect(weaknessText([], EMPTY_WORLD, 3, [])).not.toContain("訓練する人");
    expect(weaknessText([], EMPTY_WORLD, 3, [], { home: "事業所の近く", kinds: [] })).toContain("住む所 事業所の近く。自分に差し込める種類: なし");
  });
});

describe("開始の設定の言葉（T104）", () => {
  it("2〜5 字の漢語・かな（読点なし）", () => {
    for (const v of Object.values(T104_LABELS)) {
      expect(v.length).toBeLessThanOrEqual(5);
      expect(v).not.toMatch(/[、。]/);
    }
    expect(scaleIncidents({ kind: "heavy_rain", level: 3 }).map((e) => e.text)).toEqual(["警戒レベル 3", "大雨"]);
  });
});
