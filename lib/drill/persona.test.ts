// 訓練の本人役（docs/tasks/T18.md）のテスト。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 本人役の説明と送った物に氏名・カナ・住所・電話・町名・生年月日が無い、返事の形、安否への変換（表の行が骨、押せる人の門）、
// 未設定・上限・失敗で止まらない、D1 に種の 10 人で大雨を 3 時間まで進めると山田が赤・小林は夫の連絡で黄・佐藤は連絡なし、通話の口。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { advanceDrill, drillScope, startDrill } from "./db.ts";
import { initialState, step, type DrillIncident, type PersonaInput } from "./engine.ts";
import { drillHooks } from "./hooks.ts";
import {
  buildPersona,
  CALL_PICKUP_ODDS,
  cleanWords,
  createPersonaHook,
  decideCallPickup,
  fromRole,
  loadPersonaSources,
  PERSONA_SYSTEM,
  personaCallReply,
  personaTurns,
  reportersOf,
  tickText,
  whereOf,
  type PersonaAnswer,
} from "./persona.ts";
import { EMPTY_WORLD, SCENARIOS, type FixedTurn } from "./scenarios.ts";
import { loadDrillScreen } from "./view.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
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

/** 送った入力（本人役の説明・刻みの文） */
function sent(p: Params): { profile: string; tick: string } {
  const input = JSON.parse(p.messages[0].content as string) as Record<string, { text: string }>;
  return { profile: input["本人役"]?.text ?? "", tick: (input["この刻み"] ?? input["電話"])?.text ?? "" };
}

const NONE: PersonaAnswer = {
  condition: "家にいる",
  location: "home",
  action: "様子を見る",
  contactsCaremanager: false,
  from: "",
  pressesRed: false,
  redAnswers: null,
  speech: "",
};

const answer = (over: Partial<PersonaAnswer>): PersonaAnswer => ({ ...NONE, ...over });

// ---------- 種の 10 人 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({
  person: p.person,
  ledger: p.ledger,
  contacts: p.contacts,
  clocks: p.clocks,
});
const SEED = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p)]));
const input = (id: string) => SEED.get(id)!;
/** 10 人全員の鍵（漏れの見張り。氏名・カナ・家族の名前・電話・町名・生年月日） */
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const TOWNS = [...new Set(SEED_PEOPLE.map((p) => p.ledger.basic.address!.town))];

function expectNoPersonalData(text: string) {
  expect(findLeaks(text, ALL_KEY)).toEqual([]);
  for (const t of TOWNS) expect(text).not.toContain(t.replace(/(町|台)$/, ""));
  expect(text).not.toMatch(/090-?0000/);
}

const START = "2026-11-05T01:00:00.000Z";

function personaInput(person: string, over: Partial<PersonaInput> = {}): PersonaInput {
  return { step: 2, hour: 3, person, world: EMPTY_WORLD, incidents: [], state: null, lastAction: null, fixed: [], ...over };
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

function aiCtx(claude?: ClaudeClient, env: AskJsonContext["env"] = { ANTHROPIC_API_KEY: "dummy" }): AskJsonContext {
  return { env, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind }, now: () => new Date(START), claude };
}

const careManager = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});

const aiRows = () => sqlite.prepare("SELECT purpose, model, status FROM ai_calls").all() as Array<Record<string, unknown>>;

// ---------- 本人役の説明 ----------

describe("本人役の説明", () => {
  it("10 人とも氏名・カナ・住所・電話・町名・生年月日が無く、周りの人は役割名", () => {
    // 見張りが効くこと（家族の名前・電話・カナ・町名を見つける）
    expect(findLeaks("森 恵子さんに 090-0000-0011", ALL_KEY).length).toBeGreaterThan(0);
    expect(findLeaks("ヤマダ", ALL_KEY).length).toBeGreaterThan(0);
    expect(() => expectNoPersonalData("くぬぎ谷のあたり")).toThrow();
    for (const p of SEED_PEOPLE) {
      const persona = buildPersona(seedInput(p), { on: "2026-11-05" });
      expectNoPersonalData(persona.profile.text);
      expectNoPersonalData(PERSONA_SYSTEM);
    }
    const yamada = buildPersona(input("p-01"), { on: "2026-11-05" }).profile.text;
    expect(yamada).toContain("84 歳");
    expect(yamada).toContain("要介護3");
    expect(yamada).toContain("在宅酸素");
    expect(yamada).toContain("- 娘: 家族、市内、車あり、スマホあり");
    expect(yamada).toContain("- 支援者 1: 支援者、隣人、近所、スマホなし、82 歳");
    // 山田は本人がスマホを使える（審査員の本人スマホ。T26 で種を直した）ので、押せる人は本人と娘
    expect(yamada).toContain("スマホ 使える");
    expect(yamada).toContain("押せる人（スマホで赤・緑を押してケアマネに連絡できる人）: 本人、娘");
    // 避難先の名前（場所の名前）は渡さない
    expect(yamada).not.toContain("小学校");
    const sato = buildPersona(input("p-04"), { on: "2026-11-05" }).profile.text;
    expect(sato).toContain("認知症あり");
    expect(sato).toContain("スマホ 持たない");
    expect(sato).toContain("押せる人（スマホで赤・緑を押してケアマネに連絡できる人）: 息子");
  });

  it("押せる人: 本人は連絡手段のスマホが「使える」だけ、家族・支援者はスマホのある人だけ。訪問看護などの事業所は連絡しない", () => {
    const pressers = (id: string) => reportersOf(input(id)).filter((r) => r.canPress).map((r) => `${r.role}:${r.source}`);
    expect(pressers("p-01")).toEqual(["本人:agent", "娘:family"]);
    expect(pressers("p-02")).toEqual(["夫:family"]);
    expect(pressers("p-04")).toEqual(["息子:family"]);
    expect(pressers("p-05")).toEqual(["甥:family"]);
    expect(pressers("p-07")).toEqual(["本人:agent", "弟:family"]);
    expect(pressers("p-08")).toEqual(["本人:agent", "息子:family"]);
    expect(reportersOf(input("p-02")).map((r) => r.role)).not.toContain("訪問看護");
    expect(reportersOf(input("p-04")).find((r) => r.role === "民生委員")).toMatchObject({ source: "supporter", canPress: false });
  });

  it("刻みの文: 停電はこの家が地区に入るかで、ほかの人の道路・施設は書かない。断水は 3 つの言い方", async () => {
    let s = initialState("heavy_rain", ["p-01", "p-03", "p-05"], START);
    for (let i = 0; i < 3; i++) s = (await step(s)).state;
    const at3 = (person: string) =>
      tickText(personaInput(person, { world: s.world }), buildPersona(input(person), { on: "2026-11-05" }));
    expect(at3("p-01")).toContain("この家は停電中（1 時間から）");
    expect(at3("p-03")).toContain("この家は停電していない");
    expect(at3("p-05")).toContain("川沿いの市道 通行止（家の近くの道）");
    expect(at3("p-01")).not.toContain("川沿いの市道");
    expect(at3("p-01")).toContain("電話 不安定");
    const dry = tickText(
      personaInput("p-03", { world: { ...EMPTY_WORLD, water: "out" } }),
      buildPersona(input("p-03"), { on: "2026-11-05" }),
    );
    expect(dry).toContain("断水 断水中");
  });
});

// ---------- 返事 → 安否 ----------

const YAMADA_3H: FixedTurn = SCENARIOS.heavy_rain.ticks[2].turns.find((t) => t.person === "p-01")!;

describe("返事を安否に", () => {
  it("表の行がある刻みは形が表のまま（赤・本人・けが）で、言う事だけ Haiku の言葉。AI の印", () => {
    const persona = buildPersona(input("p-01"));
    const turns = personaTurns(
      personaInput("p-01", { fixed: [YAMADA_3H] }),
      persona,
      answer({ contactsCaremanager: false, pressesRed: false, speech: "いたいよう、足が動かん" }),
    );
    expect(turns).toEqual([
      {
        person: "p-01",
        color: "red",
        source: "agent",
        whereNow: null,
        injured: true,
        atHome: null,
        canMove: null,
        hasMedicine: null,
        saying: "いたいよう、足が動かん",
        doing: "4 問の途中で止まった",
        ai: true,
        at: 3,
      },
    ]);
  });

  it("表の行がある刻みで Haiku の言葉が使えなければ表の言葉（AI の印なし）", () => {
    const persona = buildPersona(input("p-01"));
    const [t] = personaTurns(personaInput("p-01", { fixed: [YAMADA_3H] }), persona, answer({ speech: "重症です" }));
    expect(t).toMatchObject({ color: "red", saying: "いたい、うごけない", ai: false });
  });

  it("表の行が無い刻み: 押せる人（小林の夫）の緑は家族の緑、いる所つき", () => {
    const persona = buildPersona(input("p-02"));
    const turns = personaTurns(
      personaInput("p-02"),
      persona,
      answer({ contactsCaremanager: true, from: "夫", location: "home", speech: "呼吸器の電池が心配です", action: "電池を見ている" }),
    );
    expect(turns).toEqual([
      {
        person: "p-02",
        color: "green",
        source: "family",
        whereNow: "home",
        injured: null,
        atHome: null,
        canMove: null,
        hasMedicine: null,
        saying: "呼吸器の電池が心配です",
        doing: "電池を見ている。家にいる",
        ai: true,
        at: 3,
      },
    ]);
  });

  it("スマホを持たない本人（佐藤・伊藤）は赤を押せない（連絡なし）。押せる本人（山田・加藤）は赤と 4 問", () => {
    const red = answer({
      contactsCaremanager: true,
      from: "本人",
      pressesRed: true,
      location: "home",
      redAnswers: { injured: false, atHome: true, canMove: false, hasMedicine: null },
      speech: "動けん",
    });
    expect(personaTurns(personaInput("p-04"), buildPersona(input("p-04")), red)).toEqual([]);
    expect(personaTurns(personaInput("p-05"), buildPersona(input("p-05")), red)).toEqual([]);
    // 押せない支援者（民生委員、スマホ未確認）も同じ
    expect(personaTurns(personaInput("p-04"), buildPersona(input("p-04")), { ...red, from: "民生委員" })).toEqual([]);
    const pressed = { color: "red", source: "agent", whereNow: null, injured: false, atHome: true, canMove: false, hasMedicine: null, ai: true };
    const [yamada] = personaTurns(personaInput("p-01"), buildPersona(input("p-01")), red);
    expect(yamada).toMatchObject({ person: "p-01", ...pressed });
    const [kato] = personaTurns(personaInput("p-07"), buildPersona(input("p-07")), red);
    expect(kato).toMatchObject({ person: "p-07", ...pressed });
  });

  it("Haiku の揺れを受ける: 「夫です」「娘さん」は役割名に、いる所の外の値は返事を捨てずに読む。表の行の安否は消えない", () => {
    expect(fromRole("娘さん")).toBe("娘");
    expect(fromRole("夫です。")).toBe("夫");
    expect(fromRole("支援者 1")).toBe("支援者 1");
    expect(whereOf("自宅")).toBe("home");
    expect(whereOf("Shelter")).toBe("shelter");
    expect(whereOf("どこか")).toBeNull();
    const [husband] = personaTurns(
      personaInput("p-02"),
      buildPersona(input("p-02")),
      answer({ contactsCaremanager: true, from: "夫です", location: "自宅", speech: "電池が心配です" }),
    );
    expect(husband).toMatchObject({ color: "green", source: "family", whereNow: "home" });
    const [yamada] = personaTurns(
      personaInput("p-01", { fixed: [YAMADA_3H] }),
      buildPersona(input("p-01")),
      answer({ location: "床の上", speech: "いたい" }),
    );
    expect(yamada).toMatchObject({ color: "red", source: "agent", injured: true, saying: "いたい", ai: true });
  });

  it("連絡しない・知らない呼び方は連絡なし。いる所が分からない連絡は安否不明", () => {
    const persona = buildPersona(input("p-06"));
    expect(personaTurns(personaInput("p-06"), persona, NONE)).toEqual([]);
    expect(personaTurns(personaInput("p-06"), persona, answer({ contactsCaremanager: true, from: "隣の人" }))).toEqual([]);
    const [t] = personaTurns(
      personaInput("p-06"),
      persona,
      answer({ contactsCaremanager: true, from: "息子", location: "unknown", speech: "母と連絡がつかない" }),
    );
    expect(t).toMatchObject({ color: "unknown", source: "family", whereNow: null });
  });

  it("言葉の決まり: 仮名は「本人」に、診断・判定・重症は捨てる、長さで切る、電話番号らしい並びは捨てる", () => {
    const key = buildPersona(input("p-01")).key;
    expect(cleanWords("A さんは 2 階にいます", key, 60)).toBe("本人は 2 階にいます");
    expect(cleanWords("判定をお願いします", key, 60)).toBeNull();
    expect(cleanWords("診断してほしい", key, 60)).toBeNull();
    expect(cleanWords("090-1234-5678 に電話して", key, 60)).toBeNull();
    expect(cleanWords("あ".repeat(80), key, 60)).toHaveLength(60);
    expect(cleanWords("   ", key, 60)).toBeNull();
  });
});

// ---------- 呼び口 ----------

describe("呼び口（createPersonaHook）", () => {
  const hookWith = (claude: ClaudeClient | undefined, env?: AskJsonContext["env"]) =>
    createPersonaHook({ load: async () => SEED, ai: aiCtx(claude, env), on: "2026-11-05" });

  it("Haiku・考える深さ medium（T89）・構造化出力で 1 人 1 回。送った物全部に氏名・住所・電話・町名が無い", async () => {
    const { client, calls } = fake(() => reply(NONE));
    const hook = hookWith(client);
    let s = initialState("heavy_rain", SEED_PEOPLE.map((p) => p.person.id), START);
    for (let i = 0; i < 3; i++) s = (await step(s, { persona: hook })).state;
    expect(calls).toHaveLength(30);
    for (const p of calls) {
      expect(p.model).toBe(HAIKU);
      expect(p.output_config?.effort).toBe("medium");
      // 考える分も出力の上限に入るので 8000（T67。medium にしても上限は high のときのまま、T89）
      expect(p.max_tokens).toBe(8000);
      expect(p.output_config?.format?.type).toBe("json_schema");
      expectNoPersonalData(JSON.stringify(p));
    }
    expect(aiRows().every((r) => r.purpose === "persona" && r.model === HAIKU && r.status === "ok")).toBe(true);
  });

  it("鍵なし・上限・呼び出しの失敗・形の違い・台帳を読めない: 表の行があれば表の固定の安否（AI の印なし）、無ければ連絡なし（止まらない）", async () => {
    const yamada = personaInput("p-01", { fixed: [YAMADA_3H] });
    const kobayashi = personaInput("p-02");
    const table = [
      {
        person: "p-01",
        color: "red",
        source: "agent",
        whereNow: null,
        injured: true,
        atHome: null,
        canMove: null,
        hasMedicine: null,
        saying: "いたい、うごけない",
        doing: "4 問の途中で止まった",
        ai: false,
        at: 3,
      },
    ];
    const boom = fake(() => {
      throw new Anthropic.APIConnectionError({ message: "つながらない" });
    });
    const failing = [
      hookWith(undefined, {}),
      hookWith(fake(() => reply(NONE)).client, { ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }),
      hookWith(boom.client),
      hookWith(fake(() => reply({ speech: "いたい" })).client),
      hookWith(fake(() => reply("JSON でない")).client),
      createPersonaHook({
        load: async () => {
          throw new Error("D1 が読めない");
        },
        ai: aiCtx(fake(() => reply(NONE)).client),
      }),
    ];
    for (const hook of failing) {
      expect(await hook(yamada)).toEqual(table);
      expect(await hook(kobayashi)).toEqual([]);
    }
    // 台帳に無い本人も同じ（表の行があれば表、無ければ連絡なし）
    expect(await hookWith(fake(() => reply(NONE)).client)(personaInput("p-99"))).toEqual([]);
    expect(await hookWith(fake(() => reply(NONE)).client)(personaInput("p-99", { fixed: [{ ...YAMADA_3H, person: "p-99" }] }))).toEqual([
      { ...table[0], person: "p-99" },
    ]);
  });

  it("押せる人も表の行も無い人は呼ばない", async () => {
    const { client, calls } = fake(() => reply(NONE));
    const lonely = { ...input("p-05"), contacts: input("p-05").contacts.map((c) => ({ ...c, has_smartphone: 0 as const })) };
    const hook = createPersonaHook({ load: async () => new Map([["p-05", lonely]]), ai: aiCtx(client) });
    expect(await hook(personaInput("p-05"))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("drillHooks: 鍵が無い・ケアマネの役でなければ渡さない", () => {
    expect(drillHooks({ DB: db }, careManager())).toBeUndefined();
    expect(drillHooks({ DB: db, ANTHROPIC_API_KEY: "  " }, careManager())).toBeUndefined();
    expect(drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager({ role: "medical", caseloadOf: null }))).toBeUndefined();
    expect(drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, null)).toBeUndefined();
    expect(drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager())?.persona).toBeTypeOf("function");
    expect(drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager())?.director).toBeTypeOf("function");
  });

  it("台帳は D1 から 1 回の batch で読み、種の入力と同じ本人役になる", async () => {
    const loaded = await loadPersonaSources(db, "office-demo");
    expect([...loaded.keys()].sort()).toEqual(SEED_PEOPLE.map((p) => p.person.id).sort());
    for (const id of ["p-01", "p-04", "p-07"]) {
      expect(buildPersona(loaded.get(id)!, { on: "2026-11-05" }).profile.text).toBe(
        buildPersona(input(id), { on: "2026-11-05" }).profile.text,
      );
    }
    expect((await loadPersonaSources(db, "office-partner")).size).toBe(0);
  });
});

// ---------- 大雨を 3 時間まで（D1） ----------

/** 偽の本人役: 表の行があればそれらしい言い換え、小林は 3 時間に夫が電池の連絡、ほかは連絡なし */
function rainPersona(p: Params): Message {
  const { profile, tick } = sent(p);
  const fixedRow = tick.includes("この通りに連絡する");
  if (profile.includes("在宅酸素") && tick.includes("発災から 3 時間")) {
    return reply(answer({ speech: "いたいよう、足が動かん", condition: "床に座りこんでいる", location: "home" }));
  }
  if (fixedRow) return reply(answer({ speech: "はい、大丈夫です" }));
  if (profile.includes("人工呼吸器") && tick.includes("発災から 3 時間")) {
    return reply(
      answer({ contactsCaremanager: true, from: "夫", location: "home", speech: "呼吸器の電池があと少ししかない。心配です", action: "電池を見ている" }),
    );
  }
  return reply(NONE);
}

describe("大雨を 3 時間まで（D1・本人役）", () => {
  it("山田が赤を押し（けが・AI の言葉）、小林は夫の連絡で要確認、佐藤は 3 時間に連絡なし", async () => {
    const { client, calls } = fake(rainPersona);
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) });
    expect(hooks?.persona).toBeDefined();
    const scope = drillScope(careManager())!;
    const started = await startDrill(db, scope, "heavy_rain", START, hooks, () => "drill-t18");
    expect(started).toEqual({ ok: true, id: "drill-t18" });
    for (const expected of [0, 1]) {
      const r = await advanceDrill(db, scope, "drill-t18", expected, START, hooks);
      expect(r.ok).toBe(true);
    }
    // 本人役は 10 人 × 3 刻み。監督（T19、Opus）は 1 刻み 1 回で、偽の返事は形が違うので差し込みなし
    expect(calls.filter((c) => c.model === HAIKU)).toHaveLength(30);
    expect(calls.filter((c) => c.model !== HAIKU)).toHaveLength(3);

    const screen = (await loadDrillScreen(db, scope, "drill-t18", null))!;
    expect(screen.state.hour).toBe(3);
    const row = (id: string) => screen.rows.find((r) => r.id === id)!;
    const ranked = [...screen.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    expect(ranked[0].id).toBe("p-01");
    expect(row("p-01").triage).toMatchObject({ color: "red" });
    expect(row("p-01").triage!.reason).toContain("けが");
    expect(row("p-02").triage).toMatchObject({ color: "yellow" });

    const at3 = screen.ticks.find((t) => t.hour === 3)!;
    expect(at3.turns.map((t) => [t.person, t.color, t.source, t.ai])).toEqual([
      ["p-01", "red", "agent", true],
      ["p-06", "green", "family", true],
      ["p-02", "green", "family", true],
    ].sort((a, b) => order(a[0] as string) - order(b[0] as string)));
    expect(at3.turns.find((t) => t.person === "p-04")).toBeUndefined();
    expect(at3.turns.find((t) => t.person === "p-01")!.saying).toBe("いたいよう、足が動かん");

    // 安否の文字起こしは Haiku の言葉、行の詳細の AI の印の元
    const transcripts = sqlite
      .prepare("SELECT id, person_id, transcript FROM signals WHERE drill_id = 'drill-t18' AND occurred_at = ?")
      .all(new Date(Date.parse(START) + 3 * 3_600_000).toISOString()) as Array<{ id: string; person_id: string; transcript: string }>;
    const kobayashi = transcripts.find((t) => t.person_id === "p-02")!;
    expect(kobayashi.transcript).toBe("呼吸器の電池があと少ししかない。心配です");
    expect(screen.aiSignals).toContain(kobayashi.id);
    expect(screen.aiSignals).toContain(transcripts.find((t) => t.person_id === "p-01")!.id);
  });
});

/** 参加者の並び（担当一覧のカナ順）。安否は本人ごとに Promise.all の順で並ぶ */
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const order = (id: string) => PARTICIPANTS.indexOf(id);

// ---------- 通話の相手（T20 の口） ----------

describe("通話の相手", () => {
  it("出る・背景の音だけ・出ないは電話の様子の割合で先に決める（不通は出ない、手段が無ければ出ない）", () => {
    expect(decideCallPickup("ok", 0)).toBe("answers");
    expect(decideCallPickup("ok", CALL_PICKUP_ODDS.ok.answers)).toBe("background_only");
    expect(decideCallPickup("ok", 0.99)).toBe("no_answer");
    expect(decideCallPickup("busy", 0.6)).toBe("background_only");
    // 規制（T125）はかけ直せば時々つながる
    expect(decideCallPickup("down", 0)).toBe("answers");
    expect(decideCallPickup("down", 0.99)).toBe("no_answer");
    expect(decideCallPickup("ok", 0, false)).toBe("no_answer");
  });

  it("出るときだけ Haiku が言葉を作る。出ない・背景の音だけ・周りにいない相手は呼ばない。送った物に氏名が無い", async () => {
    const { client, calls } = fake(() => reply({ speech: "はあ、どちらさん？ 今ごはん食べよるんよ" }));
    const persona = buildPersona(input("p-04"));
    const call = { person: "p-04", hour: 3, world: EMPTY_WORLD, incidents: [] as DrillIncident[], state: null, callee: "本人" };
    expect(await personaCallReply(persona, call, "no_answer", aiCtx(client))).toEqual({ pickup: "no_answer", speech: null, ai: false });
    expect(await personaCallReply(persona, call, "background_only", aiCtx(client))).toEqual({
      pickup: "background_only",
      speech: null,
      ai: false,
    });
    expect(await personaCallReply(persona, { ...call, callee: "隣の人" }, "answers", aiCtx(client))).toEqual({
      pickup: "no_answer",
      speech: null,
      ai: false,
    });
    expect(calls).toHaveLength(0);
    expect(await personaCallReply(persona, call, "answers", aiCtx(client))).toEqual({
      pickup: "answers",
      speech: "はあ、どちらさん？ 今ごはん食べよるんよ",
      ai: true,
    });
    expect(calls).toHaveLength(1);
    expect(sent(calls[0]).tick).toContain("電話に出た人: 本人");
    expectNoPersonalData(JSON.stringify(calls[0]));
    // 失敗は言葉なし
    const boom = fake(() => {
      throw new Anthropic.APIConnectionError({ message: "つながらない" });
    });
    expect(await personaCallReply(persona, call, "answers", aiCtx(boom.client))).toEqual({ pickup: "answers", speech: null, ai: false });
  });
});
