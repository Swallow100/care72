// T118（docs/tasks/T118.md）の訓練の側のテスト。評価の台（T108、tools/eval/drill）が見つけた穴を、台が使った形で確かめる。
// - 本人役の言葉の掃除: 偽の返事に混ぜた禁じた言葉（tools/eval/drill/fake.ts の NOISE_WORDS と同じ形）が、刻み・通話・往復・訪問のどの道でも画面に出ない
// - 通話の最初の言葉と訪問の本人役も 1 訓練の数え（world.counts）に入り、ai_calls（1 日の上限の数え）と同じ数になる
// 本物の API は呼ばない（偽の client）。人は種の架空の 10 人だけ。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { act } from "./actions.ts";
import { DRILL_CALL_CAP, totalCalls } from "./clock.ts";
import { advance, initialState, type DrillState, type PersonaInput } from "./engine.ts";
import { drillHooks } from "./hooks.ts";
import {
  buildPersona,
  CALL_SYSTEM,
  cleanPersonaWords,
  loadPersonaSources,
  PERSONA_SYSTEM,
  personaCallReply,
  personaPlaces,
  personaTalkReply,
  personaTurns,
  personaVisitReport,
  SPEECH_MAX,
  TALK_SYSTEM,
  VISIT_SYSTEM,
  type PersonaAnswer,
} from "./persona.ts";
import { EMPTY_WORLD, type FixedTurn } from "./scenarios.ts";
import { pseudonymizeText } from "../pseudonym/index.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

function reply(value: unknown): Message {
  return {
    id: "msg_t118",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(answer: (p: Params) => unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(answer(params));
        },
      },
    },
  };
  return { client, calls };
}

const systemOf = (p: Params) => (p.system as Array<{ text: string }>).map((b) => b.text).join("\n");

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const SEED = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p)]));
const KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

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
const START = "2026-11-05T01:00:00.000Z";

const aiOf = (client: ClaudeClient): AskJsonContext => ({
  env: { ANTHROPIC_API_KEY: "dummy" },
  usage: d1UsageStore(db),
  office: { id: DEMO.id, kind: DEMO.kind },
  claude: client,
  now: () => new Date(START),
});

const aiCallRows = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM ai_calls").get() as { n: number }).n;

// 評価の台（tools/eval/drill/fake.ts の NOISE_WORDS）が偽の返事の言う事の後ろに「。」で足した形
const NOISE = {
  death: "もう死亡しているかもしれません",
  dose: "薬を2錠多めに飲ませました",
  diagnosis: "重症かもしれません",
  phone: "090-1234-5678 に電話ください",
};
const KEEP = "家の2階にいます";

// ---------- 1. 本人役の言葉の掃除 ----------

describe("本人役の言葉の掃除（全部の道で同じ決まり）", () => {
  it("死亡・薬の量・診断・電話の文だけを落とし、残りの文は使う。全部落ちれば言葉なし", () => {
    for (const bad of Object.values(NOISE)) {
      expect(cleanPersonaWords(`${KEEP}。${bad}`, KEY, SPEECH_MAX), bad).toBe(`${KEEP}。`);
      expect(cleanPersonaWords(bad, KEY, SPEECH_MAX), bad).toBeNull();
    }
  });

  it("薬の量（数と単位・量の言葉）、病名、医療の助言、人の生き死にの言い方を落とす。頼み事と体の訴えは残す", () => {
    const dropped = [
      "インスリンは10単位打ちました",
      "酸素は2L/分にしています",
      "ワーファリンを1mg増やしました",
      "痛み止めを半錠飲みました",
      "薬の用量が分からない",
      "糖尿病があるので心配です",
      "肺炎かもしれない",
      "母は認知症なので",
      "薬を飲んだほうがいいですよ",
      "安静にしていてください",
      "息を引き取ったかもしれない",
      "このままでは死んでしまう",
      "救急車が来て運ばれた",
    ];
    for (const s of dropped) expect(cleanPersonaWords(s, KEY, SPEECH_MAX), s).toBeNull();
    const kept = ["薬を届けてください", "胸が少し痛い", "足を打った", "水が2リットルしかない", "水が一滴もない", "包帯を一包み持ってきて", "がんばって待っています", "病院に行きたい", "必死に逃げた"];
    for (const s of kept) expect(cleanPersonaWords(s, KEY, SPEECH_MAX), s).toBe(s);
  });

  it("落としたことは決まりの名前だけをログに残す（言葉の中身は書かない）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanPersonaWords(`${KEEP}。${NOISE.death}`, KEY, SPEECH_MAX);
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("死亡");
    expect(logged).not.toContain(KEEP);
  });

  const persona01 = () => buildPersona(SEED.get("p-01")!, { on: "2026-11-05" });

  it("刻みの道: 言う事・する事・様子に死亡・薬の量があれば、その文を落として画面に出さない", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const input: PersonaInput = { step: 2, hour: 3, person: "p-01", world: EMPTY_WORLD, incidents: [], state: null, lastAction: null, fixed: [] };
    const answer: PersonaAnswer = {
      condition: "家の中で亡くなった",
      location: "home",
      action: "薬を2錠多めに飲ませた",
      contactsCaremanager: true,
      from: "本人",
      pressesRed: false,
      redAnswers: null,
      speech: `${KEEP}。${NOISE.death}`,
    };
    const persona = persona01();
    const reporter = persona.reporters.find((r) => r.canPress);
    expect(reporter).toBeDefined();
    const turns = personaTurns(input, persona, { ...answer, from: reporter!.role });
    expect(turns).toHaveLength(1);
    expect(turns[0].saying).toBe(`${KEEP}。`);
    expect(turns[0].doing).toBeNull();

    // 想定の表の行がある刻みも、AI の言う事から同じく落とす（全部落ちれば表の言葉）
    const fixed: FixedTurn = { person: "p-01", color: "green", source: "agent", saying: "家にいる", whereNow: "home" } as FixedTurn;
    const t2 = personaTurns({ ...input, fixed: [fixed] }, persona, { ...answer, speech: NOISE.dose });
    expect(t2[0].saying).toBe("家にいる");
    expect(t2[0].ai).toBe(false);
  });

  it("通話の最初の言葉・往復・訪問の道も同じ決まりで落とす", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sources = await loadPersonaSources(db, DEMO.id);
    const { client } = fake((p) => {
      const sys = systemOf(p);
      if (sys.includes(VISIT_SYSTEM)) return { condition: `居間にいる。${NOISE.death}`, location: "home", asks: [], speech: `${KEEP}。${NOISE.dose}` };
      if (sys.includes(TALK_SYSTEM)) return { speech: `${KEEP}。${NOISE.dose}`, asks: ["medicine"] };
      if (sys.includes(CALL_SYSTEM)) return { speech: `${KEEP}。${NOISE.death}` };
      return { speech: "" };
    });
    const ai = aiOf(client);
    const persona = buildPersona(sources.get("p-01")!, { on: "2026-11-05", places: personaPlaces(ai, sources) });
    const callee = persona.reporters[0].role;
    const base = { person: "p-01", hour: 3, world: EMPTY_WORLD, incidents: [], state: null };

    const call = await personaCallReply(persona, { ...base, callee }, "answers", ai);
    expect(call.speech).toBe(`${KEEP}。`);

    const talkText = pseudonymizeText("けがはありませんか", persona.key);
    const talk = await personaTalkReply(persona, talkText, persona.key, ai);
    expect(talk.speech).toBe(`${KEEP}。`);
    expect(talk.asks).toEqual(["medicine"]);

    const visit = await personaVisitReport(persona, base, ai);
    expect(visit?.speech).toBe(`${KEEP}。`);
    expect(visit?.condition).toBe("居間にいる。");
  });

  it("指示の文に本人役の決まり（名前・住所・電話・病名・薬の量・助言・死亡）がどの道にもある", () => {
    for (const sys of [PERSONA_SYSTEM, CALL_SYSTEM, TALK_SYSTEM, VISIT_SYSTEM]) {
      expect(sys).toContain("死亡");
      expect(sys).toContain("薬の量");
      expect(sys).toContain("病名");
      expect(sys).toContain("助言");
    }
  });
});

// ---------- 2. 本人役の呼び出しの数え ----------

describe("通話の最初の言葉と訪問の本人役も 1 訓練の数えに入る", () => {
  function hooksWith(answer: (p: Params) => unknown) {
    const { client, calls } = fake(answer);
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) })!;
    return { hooks, calls };
  }
  const answer = (p: Params) => {
    const sys = systemOf(p);
    if (sys.includes(VISIT_SYSTEM)) return { condition: "居間の椅子に座っている", location: "home", asks: ["water"], speech: "来てくれてありがとう" };
    return { speech: "家にいます、大丈夫です" };
  };
  const SELF = { id: "c-01-0", kind: "self" as const, label: "本人", hasPhone: true };

  /** 連続の時計の訓練（T90。1 訓練の数えを使う形）を 0 時間まで進めた物（監督と本人役を呼ぶ） */
  async function started(hooks: ReturnType<typeof hooksWith>["hooks"], over: Partial<DrillState["world"]> = {}): Promise<DrillState> {
    const base = initialState("heavy_rain", ["p-01"], START, { clock: true });
    const r = await advance({ ...base, world: { ...base.world, ...over } }, 0, hooks);
    return r!.state;
  }

  it("通話（本人電話）で 1・訪問で 1 を world.counts に足し、ai_calls の行の数と同じ", async () => {
    const { hooks, calls } = hooksWith(answer);
    const base = await started(hooks);
    const before = totalCalls(base.world.counts);
    expect(before).toBe(aiCallRows());
    const called = await act(base, { kind: "call_person", person: "p-01", target: SELF }, hooks, () => 0);
    expect(called.record.result).toMatchObject({ status: "connected", speechAi: true });
    expect(calls.filter((c) => systemOf(c).includes(CALL_SYSTEM))).toHaveLength(1);
    expect(called.state.world.counts).toMatchObject({ call: 1 });
    expect(totalCalls(called.state.world.counts)).toBe(before + 1);
    expect(totalCalls(called.state.world.counts)).toBe(aiCallRows());

    const visited = await act(called.state, { kind: "visit", person: "p-01", target: null }, hooks, () => 0);
    expect(visited.record.result).toMatchObject({ status: "arrived", visit: { condition: "居間の椅子に座っている" } });
    expect(calls.filter((c) => systemOf(c).includes(VISIT_SYSTEM))).toHaveLength(1);
    expect(totalCalls(visited.state.world.counts)).toBe(before + 2);
    // 1 日の上限（AI_DAILY_LIMIT）の数え（ai_calls）も同じ
    expect(aiCallRows()).toBe(before + 2);
  });

  it("1 訓練の上限（150）に達していれば、通話の相手も訪問も Claude を呼ばず固定の言葉（数も増やさない）", async () => {
    const { hooks, calls } = hooksWith(answer);
    const capped = await started(hooks, { counts: { director: DRILL_CALL_CAP, persona: 0, call: 0, free: 0 } });
    const r = await act(capped, { kind: "call_person", person: "p-01", target: SELF }, hooks, () => 0);
    expect(r.record.result).toMatchObject({ status: "connected", speechAi: false });
    expect(r.record.result!.speech).not.toBeNull();
    const v = await act(r.state, { kind: "visit", person: "p-01", target: null }, hooks, () => 0);
    expect(v.record.result!.visit).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(totalCalls(v.state.world.counts)).toBe(DRILL_CALL_CAP);
    expect(aiCallRows()).toBe(0);
  });
});
