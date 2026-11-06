// T93 本人役の深さ（docs/tasks/T93.md）のテスト。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 本人役の文（分の時刻・呼ばれた理由・前の呼びからの手と結果・119 を勧められた）、決まり 8・9、通話の往復（3 往復・4 往復目は 409・
// 伏字不可・頼み事を積む・counts.call・刻み違い・切る・取消・上限）、訪問の様子（着いたときだけ・禁じる語・頼み事の範囲）、画面の部品。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LatestResult, ActionLog } from "../../components/drill/ActionLog.tsx";
import { DrillRowDetail } from "../../components/drill/DrillRowDetail.tsx";
import { TalkBox } from "../../components/drill/TalkBox.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillScenario } from "../db/types.ts";
import { findLeaks, pseudonymize, pseudonymizeText, type PseudonymInput } from "../pseudonym/index.ts";
import { act, applyResult, type ActionHooks } from "./actions.ts";
import { DRILL_CALL_CAP } from "./clock.ts";
import { drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import {
  ASK_LABELS,
  CALL_OUT_ASKS,
  canTalk,
  dialogueFields,
  pushAsks,
  TALK_ASKS,
  TALK_FIXED_SPEECH,
  TALK_LABELS,
  TALK_MAX,
  TALK_TEXT_MAX,
  TALK_UI,
  withResultAsks,
  type TalkLine,
  type VisitHook,
} from "./dialogue.ts";
import { talkMinutesOf } from "./talk-turn.ts";
import { initialState, type ActionRecord, type ActionResult, type DrillState, type PersonaInput } from "./engine.ts";
import { createVisitHook, drillHooks, drillTalkHook } from "./hooks.ts";
import { actionPost, undoPost } from "./http.ts";
import {
  buildPersona,
  CALL_SYSTEM,
  loadPersonaSources,
  PERSONA_SYSTEM,
  personaPlaces,
  personaVisitReport,
  TALK_SYSTEM,
  tickText,
  VISIT_SYSTEM,
} from "./persona.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { talkPost } from "./talk.ts";
import { loadDrillScreen } from "./view.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown): Message {
  return {
    id: "msg_test",
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
const inputOf = (p: Params) => JSON.parse(p.messages[0].content as string) as Record<string, { text: string }>;

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const SEED = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p)]));
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const TOWNS = [...new Set(SEED_PEOPLE.map((p) => p.ledger.basic.address!.town))];
const seedOf = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

function expectNoPersonalData(text: string) {
  expect(findLeaks(text, ALL_KEY)).toEqual([]);
  for (const t of TOWNS) expect(text).not.toContain(t);
  expect(text).not.toMatch(/090-?0000/);
}

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
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
const SCOPE = drillScope(careManager())!;
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t93";
const ENV = { DB: null as unknown as ReturnType<typeof d1FromSqlite>, ANTHROPIC_API_KEY: "dummy" };

async function start(scenario: DrillScenario = "heavy_rain") {
  expect(await startDrill(db, SCOPE, scenario, START, {}, () => ID)).toEqual({ ok: true, id: ID });
}

async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}

/** 本人電話（p-01）を打つ。roll 0 で線がつながり本人が出る。鍵が無いので最初の言葉は固定の言葉 */
async function callYamada(): Promise<ActionRecord> {
  const res = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0 });
  expect(res.status).toBe(200);
  const rec = (await stored()).actions.at(-1)!;
  expect(rec.result).toMatchObject({ status: "connected" });
  expect(rec.result!.speech).not.toBeNull();
  return rec;
}

const TALK_ANSWER = (over: Record<string, unknown> = {}) => ({ speech: "薬がもう少しで切れそうで、心細いです", asks: ["medicine", "bogus", "water", "food"], ...over });

function talkHook(answer: (p: Params) => unknown = () => TALK_ANSWER()) {
  const { client, calls } = fake(answer);
  const hook = drillTalkHook({ ...ENV, DB: db }, careManager(), { claude: client, now: () => new Date(START) })!;
  return { hook, calls };
}

async function talk(body: Record<string, unknown>, hook?: ReturnType<typeof talkHook>["hook"]): Promise<Response> {
  const s = await stored();
  return talkPost(db, careManager(), ID, { step: s.step, actions: s.actions.length, action: s.actions.at(-1)?.id, ...body }, hook ? { hook } : {});
}

// ---------- 1. 本人役の文 ----------

const persona01 = () => buildPersona(SEED.get("p-01")!, { on: "2026-11-05" });

function record(over: Partial<ActionRecord> & Pick<ActionRecord, "id" | "kind" | "atMinute">): ActionRecord {
  return {
    person: "p-01",
    target: null,
    callee: null,
    calleeLabel: null,
    at: over.atMinute / 60,
    endMinute: over.atMinute + 5,
    minutes: 5,
    step: 1,
    before: { person: null, marks: {}, staff: 2, phone: "ok", roadClosed: false },
    result: null,
    ...over,
  };
}

function result(over: Partial<ActionResult> & Pick<ActionResult, "status" | "atMinute">): ActionResult {
  return { ok: true, because: null, text: "", ai: false, speech: null, speechAi: false, pickup: null, cleared: [], staff: 0, crossed: [], heard: null, ...over };
}

function input(over: Partial<PersonaInput> = {}): PersonaInput {
  return { step: 2, hour: 3, person: "p-01", world: EMPTY_WORLD, incidents: [], state: null, lastAction: null, fixed: [], ...over };
}

describe("本人役の文（tickText）", () => {
  it("時刻は分まで（連続の時計の小数の時刻）。刻みの道の整数の時刻は今までと同じ", () => {
    expect(tickText(input({ hour: 3.25, toMinute: 195 }), persona01())).toContain("時刻: 発災から 3 時間 15 分");
    expect(tickText(input({ hour: 3 + 1 / 6 }), persona01())).toContain("時刻: 発災から 3 時間 10 分");
    expect(tickText(input({ hour: 3 }), persona01())).toContain("時刻: 発災から 3 時間\n");
    expect(tickText(input({ hour: 3.25 }), persona01())).not.toMatch(/3\.25|0\.25/);
  });

  it("呼ばれた理由の 1 行（table は書かない。状況の文・手の結果・時計・巡回）", () => {
    const at = (reasons: PersonaInput["reasons"], over: Partial<PersonaInput> = {}) =>
      tickText(input({ hour: 6, toMinute: 360, since: 180, reasons, ...over }), persona01());
    expect(at(["table"])).not.toContain("この区切りで起きた事");
    expect(at(["clock"])).toContain("この区切りで起きた事: 持ちこたえる時間が半分を過ぎた（または切れた）");
    expect(at(["round"], { state: { color: "green", source: "agent", whereNow: "home", at: 1, saying: null, doing: null } })).toContain(
      "前の連絡から 5 時間たった",
    );
    const incident = { actor: "director" as const, at: 5, change: { kind: "note" as const, topic: "relief" as never }, text: "近所の人が様子を見に来た", ai: false, person: "p-01" };
    expect(at(["incident"], { incidents: [incident] })).toContain("この区切りで起きた事: 近所の人が様子を見に来た");
    const call = record({ id: "a1", kind: "call_person", atMinute: 200, result: result({ status: "noAnswer", ok: false, atMinute: 205 }) });
    const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-01", role: "nurse", arrive: 300, back: null, arrived: true, from: "a2" }] };
    const text = at(["action"], { actions: [call], world });
    expect(text).toMatch(/この区切りで起きた事: ケアマネが.+ → 呼び出したが出ない。訪問看護が来た/);
  });

  it("前の呼びから（since 以後）の手を全部、結果の言葉つきで。前の手は書かない。相手は役割名", () => {
    const old = record({ id: "a1", kind: "visit", atMinute: 60, result: result({ status: "arrived", atMinute: 100 }) });
    const call = record({ id: "a2", kind: "call_person", atMinute: 185, result: result({ status: "noAnswer", ok: false, atMinute: 190 }) });
    const nurse = record({
      id: "a3",
      kind: "dispatch",
      atMinute: 240,
      target: "c-01-1",
      result: result({ status: "dispatched", atMinute: 250, arriveAt: 300 }),
    });
    const talked = record({
      id: "a4",
      kind: "call_contact",
      atMinute: 260,
      target: "c-01-1",
      result: result({ status: "connected", atMinute: 265, speech: "はい", talk: [line("cm", 265), line("them", 267), line("cm", 267), line("them", 269)] }),
    });
    const text = tickText(input({ hour: 5, toMinute: 300, since: 180, actions: [old, call, nurse, talked], lastAction: talked }), persona01());
    expect(text).toContain("3 時間 5 分にケアマネが");
    expect(text).toContain("→ 呼び出したが出ない");
    expect(text).toContain("（相手 娘） → 向かってもらえる、5 時間ごろ着く");
    expect(text).toContain("つながった、2 往復話した");
    expect(text).not.toContain("1 時間にケアマネが");
    // 刻みの道（since が無い）は前の刻みから。手の一覧が無ければ直前の 1 つ（今までの形）
    const legacy = tickText(input({ step: 2, lastAction: call }), persona01());
    expect(legacy).toContain("ケアマネがした事:\n- 3 時間 5 分にケアマネが");
    expect(tickText(input({ step: 3, actions: [old] }), persona01())).toContain("ケアマネがした事: なし");
  });

  it("向かっている人・届いた物・頼み事（T92 の行）と、119 を勧められた。名前・町名・電話は出ない", () => {
    const world: WorldState = {
      ...EMPTY_WORLD,
      arrivals: [
        { person: "p-01", role: "supporter", arrive: 300, back: null, arrived: false, from: "a1" },
        { person: "p-01", role: "medicine", arrive: 200, back: null, arrived: true, from: "a2" },
      ],
      supplies: { "p-01": { medicine: 200 } },
      asks: { "p-01": [{ kind: "water", at: 100, done: null }, { kind: "medicine", at: 90, done: 200 }] },
      advised: { "p-01": 125 },
    };
    const persona = persona01();
    const text = tickText(input({ hour: 4, toMinute: 240, world, reasons: ["action"], since: 180 }), persona);
    expect(text).toContain("支援者が 5 時間ごろ来る予定");
    expect(text).toContain("薬が届いた（3 時間 20 分）");
    expect(text).toContain("頼んでいる事: 水（まだ）");
    expect(text).toContain("頼んだ事: 薬（済んだ）");
    expect(text).toContain("ケアマネから 119 への連絡を勧められた（2 時間 5 分）");
    expect(text).toContain("薬の配達が来た");
    expectNoPersonalData(pseudonymizeText(text, persona.key).text);
  });

  it("決まり 8・9 が指示の文にある（決まり 6・7 はそのまま）", () => {
    expect(PERSONA_SYSTEM).toContain("8. ケアマネの手が届いたあとの最初の連絡は、その手の結果を受けた様子を言う（来た人がいる・物が届いた・移った）。頼んだ事が済んでいなければ、また頼んでよい。");
    expect(PERSONA_SYSTEM).toContain("9. 119 を勧められたら、かけるか・かけないかを言葉で言う");
    expect(PERSONA_SYSTEM).toContain("救急が来た先の事は言わない");
    expect(PERSONA_SYSTEM).toContain("6. 名前・住所・電話番号を言わない。「A さん」とも言わない。");
    expect(PERSONA_SYSTEM).toContain("7. 「診断」「判定」「重症」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。");
    expect(TALK_SYSTEM).toContain("かけるか・かけないかを言葉で言う");
    expect(TALK_SYSTEM).toContain("「死亡」と言わない");
    expect(VISIT_SYSTEM).toContain("病名を言い切らない");
    // 最初の言葉の指示は今のまま（頼み事は往復と訪問から）
    expect(CALL_SYSTEM).toContain("ケアマネは「大丈夫ですか。今どこにいますか」と聞いている。");
  });
});

function line(who: TalkLine["who"], minute: number, over: Partial<TalkLine> = {}): TalkLine {
  return { who, text: who === "cm" ? "今どこにいますか" : "家にいます", ai: who === "them", minute, ...over };
}

// ---------- 2. 通話の往復 ----------

describe("通話の往復", () => {
  it("偽の client で 8 往復（T155 で 3 から）。9 往復目は 409（終話）。時計は文の長さで 1〜3 分、counts.call、頼み事は範囲の中の 2 つまでを積む", async () => {
    await start();
    const call = await callYamada();
    const { hook, calls } = talkHook();
    const before = await stored();
    const asks = ["where", "device_medicine", "will_call_back", "injured", "can_evacuate", "contact_family", "where", "injured"] as const;
    expect(asks).toHaveLength(TALK_MAX);
    let at = before.minute;
    for (const [i, ask] of asks.entries()) {
      const res = await talk({ ask }, hook);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { minute: number; lines: TalkLine[] };
      const [cm, them] = body.lines.slice(-2);
      at += talkMinutesOf(cm!.text, them!.text);
      expect(body).toMatchObject({ ok: true, action: call.id, rounds: i + 1, minute: at, ended: false });
      expect(body.lines).toHaveLength(2 * (i + 1));
    }
    expect(calls).toHaveLength(TALK_MAX);
    for (const c of calls) {
      expect(systemOf(c)).toContain(TALK_SYSTEM);
      expect(c.model).toBe(HAIKU);
      expectNoPersonalData(JSON.stringify(inputOf(c)));
    }
    // 2 回目の入力にそれまでの話（最初の言葉・1 往復目）と今の問い
    const second = inputOf(calls[1])["電話"].text;
    expect(second).toContain(`最初に言った事: 「${call.result!.speech}」`);
    expect(second).toContain("- ケアマネ: 「今どこにいますか」");
    expect(second).toContain("ケアマネの今の言葉: 「医療機器や薬は大丈夫ですか」");

    const s = await stored();
    const r = s.actions.at(-1)!.result!;
    const first = before.minute + talkMinutesOf("今どこにいますか", "薬がもう少しで切れそうで、心細いです");
    expect(r.talk).toHaveLength(2 * TALK_MAX);
    expect(r.talk![0]).toEqual({ who: "cm", text: "今どこにいますか", ai: false, minute: before.minute, ask: "where" });
    expect(r.talk![1]).toEqual({ who: "them", text: "薬がもう少しで切れそうで、心細いです", ai: true, minute: first, asks: ["medicine", "water"] });
    expect(s.minute).toBe(at);
    expect(s.world.counts?.call).toBe(TALK_MAX);
    // 同じ種類の未対応は重ねない
    expect(s.world.asks?.["p-01"]).toEqual([
      { kind: "medicine", at: first, done: null },
      { kind: "water", at: first, done: null },
    ]);
    // 色・聞いた安否は変えない（手の返事のまま）
    expect(r.heard).toEqual(call.result!.heard);

    const ninth = await talk({ ask: "injured" }, hook);
    expect(ninth.status).toBe(409);
    expect(await ninth.json()).toMatchObject({ ok: false, label: TALK_UI.ended });
    expect(calls).toHaveLength(TALK_MAX);
    expect(canTalk(r)).toBe(false);
  });

  it("画面は drill_events から作り直す: 往復・頼み事・時計が同じ。取消で手ごと戻すと往復と頼み事も消える", async () => {
    await start();
    await callYamada();
    const { hook } = talkHook();
    await talk({ ask: "where" }, hook);
    await talk({ text: "薬は何日分ありますか" }, hook);
    const s = await stored();
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.state.actions.at(-1)!.result!.talk).toEqual(s.actions.at(-1)!.result!.talk);
    expect(screen.state.world.asks).toEqual(s.world.asks);
    expect(screen.state.minute).toBe(s.minute);

    const undo = await undoPost(db, careManager(), ID, { step: s.step, actions: s.actions.length });
    expect(undo.status).toBe(200);
    const after = await stored();
    expect(after.actions).toEqual([]);
    expect(after.world.asks ?? {}).toEqual({});
    expect((await loadDrillScreen(db, SCOPE, ID, null))!.state.actions).toEqual([]);
  });

  it("自由の 1 文は事業所の全員の鍵で伏せて渡す。伏せきれない文は 400（伏字不可）で Claude を呼ばず何も書かない", async () => {
    await start();
    await callYamada();
    const { hook, calls } = talkHook();
    const other = seedOf("p-05").person.name;
    const ok = await talk({ text: `${other}さんも近くにいますか` }, hook);
    expect(ok.status).toBe(200);
    expect(calls).toHaveLength(1);
    const sent = inputOf(calls[0])["電話"].text;
    expect(sent).not.toContain(other);
    expectNoPersonalData(sent);
    // 保存はケアマネの画面の文（伏せて名前に戻した物）
    const saved = (await stored()).actions.at(-1)!.result!.talk![0];
    expect(saved).toMatchObject({ who: "cm", ai: false });
    expect(saved.ask).toBeUndefined();

    const before = await stored();
    // 生年月日はどの書き方でも伏せる（T118）。伏せきれない物の例は電話の数字を含む長い数字の並び
    const digits = seedOf("p-01").contacts.find((c) => c.kind === "self")!.phone!.replace(/-/g, "");
    const res = await talk({ text: `番号 ${digits}2345 で合っていますか` }, hook);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, label: "伏字不可" });
    expect(calls).toHaveLength(1);
    expect(await stored()).toEqual(before);
  });

  it("形の違い（ask と text の両方・120 字超え・一覧に無い問い・空）は 400。刻み・手の数の違い・最新でない手は 409", async () => {
    await start();
    const call = await callYamada();
    const s = await stored();
    const post = (b: Record<string, unknown>) => talkPost(db, careManager(), ID, { step: s.step, actions: s.actions.length, action: call.id, ...b });
    expect((await post({ ask: "where", text: "はい" })).status).toBe(400);
    expect((await post({ text: "あ".repeat(TALK_TEXT_MAX + 1) })).status).toBe(400);
    expect((await post({ text: "  " })).status).toBe(400);
    expect((await post({ ask: "call_119_now" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ end: false })).status).toBe(400);
    expect((await post({ step: s.step + 1, ask: "where" })).status).toBe(409);
    expect((await post({ actions: s.actions.length + 1, ask: "where" })).status).toBe(409);
    expect((await post({ action: "a9", ask: "where" })).status).toBe(409);
    expect((await talkPost(db, null, ID, { step: 0, actions: 1, action: call.id, ask: "where" })).status).toBe(401);
    expect((await talkPost(db, careManager({ role: "government" }), ID, { step: 0, actions: 1, action: call.id, ask: "where" })).status).toBe(403);
    expect((await talkPost(db, careManager(), "drill-none", { step: 0, actions: 1, action: call.id, ask: "where" })).status).toBe(404);
    // 往復のあと別の手を打つと、前の電話は続けられない
    const after = await actionPost(db, careManager(), ID, { step: s.step, actions: 1, kind: "note", person: "p-01", target: null }, START, { roll: () => 0 });
    expect(after.status).toBe(200);
    expect((await talkPost(db, careManager(), ID, { step: s.step, actions: 2, action: call.id, ask: "where" })).status).toBe(409);
  });

  it("出なかった電話・訪問・切ったあとは 409。切るは Claude を呼ばず時計も進めない", async () => {
    await start();
    // 出ない（roll 0.99）
    const miss = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0.99 });
    expect(miss.status).toBe(200);
    expect((await stored()).actions[0].result!.status).not.toBe("connected");
    expect((await talk({ ask: "where" })).status).toBe(409);

    const call = await actionPost(db, careManager(), ID, { step: 0, actions: 1, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0 });
    expect(call.status).toBe(200);
    const { hook, calls } = talkHook();
    const before = await stored();
    const end = await talk({ end: true }, hook);
    expect(end.status).toBe(200);
    expect(await end.json()).toMatchObject({ ok: true, rounds: 0, minute: before.minute });
    expect(calls).toHaveLength(0);
    expect((await stored()).actions.at(-1)!.result!.talkEnd).toBe(before.minute);
    expect((await talk({ ask: "where" }, hook)).status).toBe(409);
  });

  it("鍵が無い・1 訓練の上限（150）は Claude を呼ばず固定の言葉（AI の印なし）。数は増やさない", async () => {
    await start();
    await callYamada();
    const plain = await talk({ ask: "injured" });
    expect(plain.status).toBe(200);
    expect((await stored()).actions.at(-1)!.result!.talk!.at(-1)).toMatchObject({ who: "them", text: TALK_FIXED_SPEECH, ai: false });
    expect(drillTalkHook({ DB: db }, careManager())).toBeUndefined();

    sqlite
      .prepare("UPDATE drills SET world = json_set(world, '$.world.counts', json(?)) WHERE id = ?")
      .run(JSON.stringify({ director: DRILL_CALL_CAP, persona: 0, call: 0, free: 0 }), ID);
    const { hook, calls } = talkHook();
    const capped = await talk({ ask: "where" }, hook);
    expect(capped.status).toBe(200);
    expect(calls).toHaveLength(0);
    const s = await stored();
    expect(s.actions.at(-1)!.result!.talk!.at(-1)).toMatchObject({ text: TALK_FIXED_SPEECH, ai: false });
    expect(s.world.counts?.call).toBe(0);
  });

  it("本人役の言葉に禁じる語・人の生き死にがあれば捨てて固定の言葉（頼み事も積まない）", async () => {
    await start();
    await callYamada();
    const { hook } = talkHook(() => TALK_ANSWER({ speech: "母はもう亡くなったかもしれない", asks: ["medicine"] }));
    expect((await talk({ ask: "where" }, hook)).status).toBe(200);
    const s = await stored();
    expect(s.actions.at(-1)!.result!.talk!.at(-1)).toMatchObject({ text: TALK_FIXED_SPEECH, ai: false });
    expect(s.actions.at(-1)!.result!.talk!.at(-1)!.asks).toBeUndefined();
    expect(s.world.asks ?? {}).toEqual({});
  });

  it("決まった問いは 7 つ（画面は 2〜4 字）、頼み事の印は 9 つ（1〜2 字）。使わない語を含まない", () => {
    expect(CALL_OUT_ASKS).toHaveLength(7);
    for (const k of TALK_ASKS) {
      expect(Array.from(TALK_LABELS[k]).length).toBeGreaterThanOrEqual(2);
      expect(Array.from(TALK_LABELS[k]).length).toBeLessThanOrEqual(5);
    }
    for (const v of [...Object.values(TALK_LABELS), ...Object.values(ASK_LABELS), ...Object.values(TALK_UI)]) {
      expect(v).not.toMatch(/診断|判定|重症|緊急度|札|死亡/);
    }
    expect(Object.keys(ASK_LABELS)).toHaveLength(9);
    expect(TALK_MAX).toBe(8);
  });
});

// ---------- 3. 訪問の様子 ----------

function visitAi(answer: (p: Params) => unknown): { ai: AskJsonContext; calls: Params[] } {
  const { client, calls } = fake(answer);
  return { ai: { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind }, claude: client, now: () => new Date(START) }, calls };
}

const VISIT_ANSWER = (over: Record<string, unknown> = {}) => ({ condition: "居間の椅子に座っている", location: "home", asks: ["water", "power"], speech: "来てくれてありがとう", ...over });

describe("訪問の様子と頼み事", () => {
  it("着いたときだけ呼ぶ（引き返した・通行止は呼ばない）。様子は返事に、頼み事は世界に。聞いた安否は今のまま", async () => {
    const seen: string[] = [];
    const visit: VisitHook = async (v) => {
      seen.push(v.person);
      return { report: { condition: "居間にいる", asks: ["water"], speech: "来てくれてありがとう", ai: true }, called: true };
    };
    const base = initialState("heavy_rain", ["p-01", "p-03"], START);
    const arrived = await act(base, { kind: "visit", person: "p-01", target: null }, { visit }, () => 0);
    expect(arrived.record.result).toMatchObject({ status: "arrived", visit: { condition: "居間にいる", asks: ["water"], ai: true } });
    expect(arrived.record.result!.heard).toMatchObject({ via: "visit", color: "green" });
    expect(arrived.state.world.asks?.["p-01"]).toEqual([{ kind: "water", at: arrived.record.endMinute, done: null }]);
    expect(seen).toEqual(["p-01"]);

    const back = await act(base, { kind: "visit", person: "p-01", target: null }, { visit }, () => 0.999);
    expect(back.record.result!.status).toBe("turnedBack");
    expect(back.record.result!.visit).toBeUndefined();
    const closed: DrillState = { ...base, world: { ...base.world, roads: [{ id: "r-t93", label: "家の前の道", open: false, person: "p-03" }] } };
    const blocked = await act(closed, { kind: "visit", person: "p-03", target: null }, { visit }, () => 0);
    expect(blocked.record.result!.status).toBe("blocked");
    expect(seen).toEqual(["p-01"]);
    // 電話の手では呼ばない
    await act(base, { kind: "call_person", person: "p-01", target: { id: "c-01-0", kind: "self", label: "本人", hasPhone: true } }, { visit }, () => 0);
    expect(seen).toEqual(["p-01"]);
  });

  it("Haiku の返事: 禁じる語の様子は捨てる、頼み事は一覧の中の 3 つまで。入力に名前・町名・電話が無い", async () => {
    const sources = await loadPersonaSources(db, DEMO.id);
    const { ai, calls } = visitAi(() => VISIT_ANSWER({ condition: "足を骨折しているようだ", asks: ["water", "pizza", "food", "battery", "warmth"] }));
    const persona = buildPersona(sources.get("p-01")!, { on: "2026-11-05", places: personaPlaces(ai, sources) });
    const r = await personaVisitReport(persona, { person: "p-01", hour: 3.5, world: EMPTY_WORLD, incidents: [], state: null }, ai);
    expect(r).toEqual({ condition: null, asks: ["water", "food", "battery"], speech: "来てくれてありがとう", ai: true });
    expect(calls).toHaveLength(1);
    expect(systemOf(calls[0])).toContain(VISIT_SYSTEM);
    expect(calls[0].model).toBe(HAIKU);
    const sent = JSON.stringify(inputOf(calls[0]));
    expectNoPersonalData(sent);
    expect(inputOf(calls[0])["訪問"].text).toContain("発災から 3 時間 30 分");

    const { ai: ai2 } = visitAi(() => VISIT_ANSWER({ condition: "", speech: "", asks: [] }));
    expect(await personaVisitReport(persona, { person: "p-01", hour: 3, world: EMPTY_WORLD, incidents: [], state: null }, ai2)).toBeNull();
  });

  it("訪問の口は鍵があれば drillHooks に入り、結末の人と 1 訓練の上限では呼ばない", async () => {
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager());
    expect(hooks?.visit).toBeTypeOf("function");
    expect(drillHooks({ DB: db }, careManager())?.visit).toBeUndefined();
    const { ai, calls } = visitAi(() => VISIT_ANSWER());
    const visit = createVisitHook({ load: () => loadPersonaSources(db, DEMO.id), ai });
    const w = (over: Partial<WorldState>): WorldState => ({ ...EMPTY_WORLD, ...over });
    expect(await visit({ person: "p-01", hour: 3, world: w({ ended: { "p-01": { at: 2, label: "x" } } }), incidents: [], state: null })).toEqual({ report: null, called: false });
    expect(await visit({ person: "p-01", hour: 3, world: w({ counts: { director: DRILL_CALL_CAP, persona: 0, call: 0, free: 0 } }), incidents: [], state: null })).toEqual({ report: null, called: false });
    expect(calls).toHaveLength(0);
    expect(await visit({ person: "p-01", hour: 3, world: EMPTY_WORLD, incidents: [], state: null })).toMatchObject({ report: { condition: "居間の椅子に座っている", asks: ["water", "power"] }, called: true });
    expect(calls).toHaveLength(1);
  });
});

// ---------- 4. 世界と保存の形 ----------

describe("頼み事と保存の形", () => {
  it("同じ種類の未対応は積まない。済んだ物があれば新しく積む", () => {
    let w = pushAsks(EMPTY_WORLD, "p-01", ["medicine", "water"], 100);
    w = pushAsks(w, "p-01", ["medicine"], 120);
    expect(w.asks?.["p-01"]).toHaveLength(2);
    w = { ...w, asks: { "p-01": w.asks!["p-01"].map((a) => (a.kind === "medicine" ? { ...a, done: 130 } : a)) } };
    w = pushAsks(w, "p-01", ["medicine"], 140);
    expect(w.asks?.["p-01"]).toEqual([
      { kind: "medicine", at: 100, done: 130 },
      { kind: "water", at: 100, done: null },
      { kind: "medicine", at: 140, done: null },
    ]);
    expect(pushAsks(EMPTY_WORLD, "p-01", [], 1)).toBe(EMPTY_WORLD);
  });

  it("保存の形を読む: 形の違う行・範囲の外の頼み事・問いは捨てる。往復の頼み事と時計は applyResult が作り直しでも当てる", () => {
    const f = dialogueFields({
      talk: [
        { who: "cm", text: "今どこにいますか", ai: false, minute: 200, ask: "where" },
        { who: "them", text: "家です", ai: true, minute: 202, asks: ["water", "nope"] },
        { who: "x", text: "", minute: 1 },
        { who: "cm", text: 3, minute: 2 },
      ],
      visit: { condition: "居間", asks: ["food", "z"], speech: "", ai: true },
      talkEnd: "no",
    });
    expect(f.talk).toHaveLength(2);
    expect(f.talk![1].asks).toEqual(["water"]);
    expect(f.visit).toEqual({ condition: "居間", asks: ["food"], speech: null, ai: true });
    expect(f.talkEnd).toBeUndefined();
    expect(dialogueFields({})).toEqual({});

    const r: ActionResult = result({ status: "connected", atMinute: 200, speech: "はい", talk: f.talk });
    expect(withResultAsks(EMPTY_WORLD, "p-01", r).asks?.["p-01"]).toEqual([{ kind: "water", at: 202, done: null }]);
    let s = initialState("heavy_rain", ["p-01"], START);
    s = { ...s, actions: [record({ id: "a1", kind: "call_person", atMinute: 195 })] };
    s = applyResult(s, "a1", r);
    expect(s.minute).toBe(202);
    expect(s.world.asks?.["p-01"]).toEqual([{ kind: "water", at: 202, done: null }]);
  });
});

// ---------- 5. 画面 ----------

const NAMES = { "p-01": seedOf("p-01").person.name };

function talkRecord(talk: TalkLine[], over: Partial<ActionResult> = {}): ActionRecord {
  return record({
    id: "a1",
    kind: "call_person",
    atMinute: 180,
    callee: "self",
    calleeLabel: "本人",
    result: result({ status: "connected", atMinute: 185, speech: "はい、もしもし", speechAi: true, talk, ...over }),
  });
}

describe("画面（TalkBox・LatestResult・履歴・行の詳細）", () => {
  it("往復の欄: 問いのボタン 7 つと自由の 1 文の欄と「切る」。吹き出しは往復ごと、本人役の言葉に AI の印。8 往復で問いが消える", () => {
    const talk = [line("cm", 185, { ask: "where" }), line("them", 187, { asks: ["medicine"] })];
    const html = renderToStaticMarkup(createElement(TalkBox, { drillId: ID, step: 1, actions: 1, action: talkRecord(talk), speaker: "本人" }));
    for (const k of CALL_OUT_ASKS) expect(html).toContain(`data-talk-ask="${k}"`);
    // 掛かってきた電話だけの問い（T127）は外へ掛けた電話の欄に出さない
    expect(html).not.toContain(`data-talk-ask="stay"`);
    expect(html).toContain(TALK_UI.hangUp);
    expect(html.toLowerCase()).toContain(`maxlength="${TALK_TEXT_MAX}"`);
    expect(html.match(/data-talk-line=/g)).toHaveLength(2);
    expect(html).toContain('data-talk-line="them" data-speech-ai=""');
    expect(html).toContain(`data-ask-mark="medicine"`);
    expect(html).toContain("focus-visible:outline-solid");
    expect(html).not.toMatch(/rounded-full|tracking-|gradient|shadow-/);

    const full = Array.from({ length: TALK_MAX }, (_, i) => [line("cm", 185 + 4 * i), line("them", 187 + 4 * i)]).flat();
    const done = renderToStaticMarkup(createElement(TalkBox, { drillId: ID, step: 1, actions: 1, action: talkRecord(full), speaker: "本人" }));
    expect(done).not.toContain("data-talk-ask=");
    expect(done.match(/data-talk-line=/g)).toHaveLength(2 * TALK_MAX);
  });

  it("LatestResult は続けられる電話にだけ往復の欄を出す。履歴は「通話 2 往復」に畳み、開くと全文", () => {
    const talk = [line("cm", 185), line("them", 187), line("cm", 187), line("them", 189)];
    const a = talkRecord(talk);
    const latest = renderToStaticMarkup(createElement(LatestResult, { action: a, names: NAMES, ticks: [], talk: { drillId: ID, step: 1, actions: 1 } }));
    expect(latest).toContain("data-talk-box");
    const noTalk = renderToStaticMarkup(createElement(LatestResult, { action: a, names: NAMES, ticks: [] }));
    expect(noTalk).not.toContain("data-talk-ask=");
    expect(noTalk).toContain("data-talk-fold");
    const log = renderToStaticMarkup(createElement(ActionLog, { actions: [a], hours: [0, 3], current: 1, names: NAMES }));
    expect(log).toContain(`${TALK_UI.talk} 2 ${TALK_UI.rounds}`);
    expect(log.match(/data-talk-line=/g)).toHaveLength(4);
  });

  it("訪問の結果: 様子の 1 行（AI の印）と頼み事の印。行の詳細に未対応の頼み事を灰の文字で（色の印にしない）", () => {
    const v = record({
      id: "a2",
      kind: "visit",
      atMinute: 120,
      result: result({ status: "arrived", atMinute: 160, visit: { condition: "居間の椅子に座っている", asks: ["water", "power"], speech: "来てくれてありがとう", ai: true } }),
    });
    const html = renderToStaticMarkup(createElement(LatestResult, { action: v, names: NAMES, ticks: [] }));
    expect(html).toContain("data-visit-report");
    expect(html).toContain("居間の椅子に座っている");
    expect(html).toContain('data-ask-mark="water"');
    expect(html).toContain(ASK_LABELS.power);

    const detail = {
      personId: "p-01",
      tone: "ok",
      reason: "無事",
      contacts: [],
      supporters: [],
      clocks: [],
      destinations: { first: null, second: null, transport: null },
      signals: [],
    } as unknown as Parameters<typeof DrillRowDetail>[0]["detail"];
    const row = renderToStaticMarkup(
      createElement(DrillRowDetail, { detail, startedAt: START, asks: [{ kind: "water", at: 100, done: null }, { kind: "medicine", at: 90, done: 120 }] }),
    );
    expect(row).toContain("data-open-asks");
    expect(row).toContain(ASK_LABELS.water);
    expect(row).not.toContain(`data-ask-mark="medicine"`);
    expect(row).not.toMatch(/data-open-asks[^>]*class="[^"]*(tone-|bg-)/);
  });
});
