// T127 訓練の着信に通話の中で返す・鳴らさなかった連絡を不在着信に（docs/tasks/T127.md）のテスト。本物の API は呼ばない
// （偽の Claude の client が決まった JSON を返す。偽の TTS と Map の偽の R2）。
// 1: 応答 → 往復 → 保存の形（着信の記録・世界の頼み事と時計・counts.call・ai_calls）、上限、応答の前・切った後・刻み違い・拒否・
//    応答のあとの手で断る、伏せきれない文、鍵なしの固定の言葉、作り直しが保存と同じ、取消の写しを外す、採点と講評の数、紙、声
// 2: 不在の選び方と経路の印、経過の行（対応・把握）、不在着信の一覧と折返の解消、画面の部品

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrillLog } from "../../components/drill/DrillLog.tsx";
import { MissedCalls, type MissedItem } from "../../components/drill/MissedCalls.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { TtsClient, TtsParams } from "../gemini/tts.ts";
import { findLeaks, pseudonymize, PseudonymLeakError, type PseudonymInput } from "../pseudonym/index.ts";
import {
  CALLS_PER_TICK,
  callerContact,
  callIndexes,
  MISSED_LABELS,
  missedIndexes,
  openMissedCalls,
  turnRoute,
  turnRoutes,
} from "./calls.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow, undoableAct } from "./db.ts";
import { CALL_IN_ASKS, CALL_OUT_ASKS, TALK_FIXED_SPEECH, TALK_LABELS, TALK_MAX, TALK_TEXT_MAX, TALK_UI, type TalkLine } from "./dialogue.ts";
import { talkMinutesOf } from "./talk-turn.ts";
import type { DrillState, DrillTurn } from "./engine.ts";
import { drillTalkHook } from "./hooks.ts";
import { actionPost } from "./http.ts";
import { callTalkPost, parseCallTalkRequest } from "./incoming-talk.ts";
import { TALK_SYSTEM } from "./persona.ts";
import { loadCallRecords, respondCall, type CallRecord } from "./responses.ts";
import { scoreTalks } from "./score.ts";
import { buildDrillLog, knowRouteOf, ROUTE_LABELS } from "./timeline.ts";
import { loadDrillScreen } from "./view.ts";
import { drillVoice, parseVoiceQuery, voiceHref, voiceKey, type VoiceBucket } from "./voice.ts";

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
const ID = "drill-t127";
const ENV = { DB: null as unknown as ReturnType<typeof d1FromSqlite>, ANTHROPIC_API_KEY: "dummy" };

async function start() {
  expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID)).toEqual({ ok: true, id: ID });
}

async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}

/** 大雨の 0 時間の着信（高橋・田中の家族）の 1 件目 */
async function firstCall(): Promise<CallRecord> {
  const calls = await loadCallRecords(db, ID);
  expect(calls.length).toBeGreaterThan(0);
  return calls[0];
}

const TALK_ANSWER = (over: Record<string, unknown> = {}) => ({ speech: "母は無事ですが、薬が残り少ないです", asks: ["medicine", "bogus", "water", "food"], ...over });

function talkHook(answer: (p: Params) => unknown = () => TALK_ANSWER()) {
  const { client, calls } = fake(answer);
  const hook = drillTalkHook({ ...ENV, DB: db }, careManager(), { claude: client, now: () => new Date(START) })!;
  return { hook, calls };
}

async function talk(signal: string, body: Record<string, unknown>, hook?: ReturnType<typeof talkHook>["hook"], p: Principal = careManager()): Promise<Response> {
  const s = await stored();
  const row = (await loadDrillRow(db, DEMO.id, ID))!;
  return callTalkPost(db, p, ID, { step: row.step, actions: s.actions.length, signal, ...body }, hook ? { hook } : {});
}

const aiRows = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM ai_calls WHERE purpose = 'persona'").get() as { n: number }).n;

// ---------- 1. 着信の通話の中で返す ----------

describe("着信の往復（保存・上限・門）", () => {
  it("応答した着信に 8 回返せる（T155 で 3 から）。1 回は文の長さで 1〜3 分、counts.call と ai_calls に数え、頼み事を積む。9 回目は 409（終話）", async () => {
    await start();
    const call = await firstCall();
    expect(await respondCall(db, SCOPE, ID, call.signal, "answer")).toEqual({ ok: true, recorded: true });
    const { hook, calls } = talkHook();
    const before = await stored();
    // 8 回とも本人役が答える問い（待機の指示・同じ問いはコードの短い返事で呼ばない。T167。いる所の問いは記録で答える。T177）
    const asks = ["safe", "device_medicine", "contact_family", "injured", "can_move", "shelter", "advise_119", "can_evacuate"] as const;
    expect(asks).toHaveLength(TALK_MAX);
    let at = before.minute;
    for (const [i, ask] of asks.entries()) {
      const res = await talk(call.signal, { ask }, hook);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rounds: number; minute: number; lines: TalkLine[] };
      const [cm, them] = body.lines.slice(-2);
      at += talkMinutesOf(cm!.text, them!.text);
      expect(body).toMatchObject({ ok: true, signal: call.signal, rounds: i + 1, minute: at, ended: false });
      expect(body.lines).toHaveLength(2 * (i + 1));
    }
    expect(calls).toHaveLength(TALK_MAX);
    for (const c of calls) {
      expect(systemOf(c)).toContain(TALK_SYSTEM);
      expect(c.model).toBe(HAIKU);
      const text = inputOf(c)["電話"].text;
      // 相手から掛けてきた電話の続きと分かる。最初の言葉は着信の言う事
      expect(text).toContain("電話の向き: 相手から");
      expect(text).toContain(`最初に言った事: 「${call.saying}」`);
      expectNoPersonalData(JSON.stringify(inputOf(c)));
    }
    expect(inputOf(calls[0])["電話"].text).toContain("ケアマネの今の言葉: 「ご本人は無事ですか」");
    expect(inputOf(calls[2])["電話"].text).toContain("ケアマネの今の言葉: 「今どこにいますか」");
    // 1 日の上限と同じ数え方（askJson が ai_calls に 1 行ずつ）
    expect(aiRows()).toBe(TALK_MAX);

    const s = await stored();
    const first = before.minute + talkMinutesOf("ご本人は無事ですか", "母は無事ですが、薬が残り少ないです");
    expect(s.minute).toBe(at);
    expect(s.world.counts?.call).toBe(TALK_MAX);
    expect(s.world.asks?.[call.person]).toEqual([
      { kind: "medicine", at: first, done: null },
      { kind: "water", at: first, done: null },
    ]);
    // T130: ケアマネに言われた事を世界に積む（次の区切りの本人役の帳面に入る。8 つまで）
    expect(s.world.told?.[call.person]?.map((l) => l.ask)).toEqual([...asks]);

    // 着信の記録（採点・紙・経過が読む）に往復と話し手
    const rec = (await loadCallRecords(db, ID)).find((c) => c.signal === call.signal)!;
    expect(rec.response).toBe("answer");
    expect(rec.talk).toHaveLength(2 * TALK_MAX);
    expect(rec.talk![0]).toEqual({ who: "cm", text: "ご本人は無事ですか", ai: false, minute: before.minute, ask: "safe" });
    expect(rec.talk![1]).toEqual({ who: "them", text: "母は無事ですが、薬が残り少ないです", ai: true, minute: first, asks: ["medicine", "water"] });
    expect(rec.callee).toMatchObject({ kind: "family" });
    expect(rec.callee!.id).not.toBeNull();
    expect(rec.talkEnd).toBeNull();

    const ninth = await talk(call.signal, { ask: "injured" }, hook);
    expect(ninth.status).toBe(409);
    expect(await ninth.json()).toMatchObject({ ok: false, label: TALK_UI.ended });
    expect(calls).toHaveLength(TALK_MAX);
    expect(TALK_MAX).toBe(8);

    // 色と順は動かさない: 往復から聞いた安否（care_manager の signals）を足さない
    const heard = sqlite.prepare("SELECT COUNT(*) AS n FROM signals WHERE drill_id = ? AND source = 'care_manager'").get(ID) as { n: number };
    expect(heard.n).toBe(0);
  });

  it("画面は drill_events から作り直す: 時計と頼み事が保存と同じ。取消の写しは外す（最後の手は取り消せない）", async () => {
    await start();
    const call = await firstCall();
    // 先に手を 1 つ（取消の写しができる）。応答は手のあと
    const act = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0 });
    expect(act.status).toBe(200);
    expect(undoableAct((await loadDrillRow(db, DEMO.id, ID))!)).not.toBeNull();
    await respondCall(db, SCOPE, ID, call.signal, "answer");
    const { hook } = talkHook();
    expect((await talk(call.signal, { ask: "can_move" }, hook)).status).toBe(200);
    expect((await talk(call.signal, { text: "避難所には行けそうですか" }, hook)).status).toBe(200);
    const s = await stored();
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.state.minute).toBe(s.minute);
    expect(screen.state.world.asks).toEqual(s.world.asks);
    // T130: ケアマネに言われた事も作り直しと保存が同じ
    expect(screen.state.world.told).toEqual(s.world.told);
    expect(s.world.told?.[call.person]?.map((l) => l.text)).toEqual(["ご本人は動けますか", "避難所には行けそうですか"]);
    expect(undoableAct((await loadDrillRow(db, DEMO.id, ID))!)).toBeNull();
  });

  it("応答の記録が無くても往復で応答として残す（応答の POST は結果を待たない）。切ったら 409、拒否した着信も 409", async () => {
    await start();
    const [a, b] = await loadCallRecords(db, ID);
    const { hook } = talkHook();
    expect((await talk(a.signal, { ask: "safe" }, hook)).status).toBe(200);
    expect((await loadCallRecords(db, ID)).find((c) => c.signal === a.signal)!.response).toBe("answer");
    const end = await talk(a.signal, { end: true });
    expect(end.status).toBe(200);
    expect(await end.json()).toMatchObject({ ok: true, ended: true, rounds: 1 });
    const recA = (await loadCallRecords(db, ID)).find((c) => c.signal === a.signal)!;
    expect(recA.talkEnd).toBe((await stored()).minute);
    expect((await talk(a.signal, { ask: "injured" }, hook)).status).toBe(409);

    await respondCall(db, SCOPE, ID, b.signal, "decline");
    const declined = await talk(b.signal, { ask: "safe" }, hook);
    expect(declined.status).toBe(409);
    expect(await declined.json()).toMatchObject({ label: TALK_UI.ended });
  });

  it("応答のあとに手を打った着信・前の刻みの着信は続けない（409）。読んだ刻みと手の数が違えば競合（409）", async () => {
    await start();
    const call = await firstCall();
    await respondCall(db, SCOPE, ID, call.signal, "answer");
    const res = await callTalkPost(db, careManager(), ID, { step: 0, actions: 3, signal: call.signal, ask: "safe" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict" });
    // 応答のあとに手
    expect((await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0 })).status).toBe(200);
    expect((await talk(call.signal, { ask: "safe" })).status).toBe(409);
    // 進めたあとの前の刻みの着信
    expect((await advanceDrill(db, SCOPE, ID, 0, START)).ok).toBe(true);
    const other = (await loadCallRecords(db, ID)).find((c) => c.step === 0 && c.signal !== call.signal)!;
    expect((await talk(other.signal, { ask: "safe" })).status).toBe(409);
  });

  it("自由の 1 文に別の人の名前: 伏せて渡す。伏せきれない文は 400（伏字不可）で Claude を呼ばず何も書かない", async () => {
    await start();
    const call = await firstCall();
    await respondCall(db, SCOPE, ID, call.signal, "answer");
    const { hook, calls } = talkHook();
    const other = seedOf("p-05").person.name;
    expect((await talk(call.signal, { text: `${other}さんも近くにいますか` }, hook)).status).toBe(200);
    expect(calls).toHaveLength(1);
    const sent = inputOf(calls[0])["電話"].text;
    expect(sent).not.toContain(other);
    expectNoPersonalData(sent);
    // 電話番号の並びは「（電話）」に置き換えて渡す（lib/pseudonym の PHONE_MARK）
    const masked = await talk(call.signal, { text: "090-0000-0001 に掛け直してください" }, hook);
    expect(masked.status).toBe(200);
    expectNoPersonalData(inputOf(calls[1])["電話"].text);
    // 伏せきれない文は口が PseudonymLeakError を投げ、400（伏字不可）で何も書かない（外へ掛けた電話の往復と同じ口）
    const before = await stored();
    const leaking: typeof hook = async () => {
      throw new PseudonymLeakError([]);
    };
    const refused = await talk(call.signal, { text: "もう一度" }, leaking);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ ok: false, label: "伏字不可" });
    expect((await stored()).minute).toBe(before.minute);
    expect((await loadCallRecords(db, ID)).find((c) => c.signal === call.signal)!.talk).toHaveLength(4);
  });

  it("鍵なし（口なし）は固定の言葉で往復を残す（AI の印なし、counts.call は増えない）。上限の 1 訓練 150 も同じ", async () => {
    await start();
    const call = await firstCall();
    await respondCall(db, SCOPE, ID, call.signal, "answer");
    const res = await talk(call.signal, { ask: "shelter" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: Array<{ who: string; text: string; ai: boolean }> };
    expect(body.lines[0]).toMatchObject({ who: "cm", text: "避難するならどこに行きますか" });
    expect(body.lines[1]).toMatchObject({ who: "them", text: TALK_FIXED_SPEECH, ai: false });
    expect((await stored()).world.counts?.call ?? 0).toBe(0);
    expect(drillTalkHook({ DB: db }, careManager())).toBeUndefined();
  });

  it("API の壁（401・403・400・404）と要求の形", async () => {
    await start();
    const call = await firstCall();
    expect((await callTalkPost(db, null, ID, { step: 0, actions: 0, signal: call.signal, ask: "safe" })).status).toBe(401);
    expect((await callTalkPost(db, careManager({ role: "government" }), ID, { step: 0, actions: 0, signal: call.signal, ask: "safe" })).status).toBe(403);
    expect((await callTalkPost(db, careManager(), ID, { step: 0, actions: 0, signal: call.signal, ask: "bogus" })).status).toBe(400);
    expect((await callTalkPost(db, careManager(), ID, { step: 0, actions: 0, signal: call.signal, ask: "safe", text: "x" })).status).toBe(400);
    expect((await callTalkPost(db, careManager(), ID, { step: 0, actions: 0, signal: `${ID}-0-s99`, ask: "safe" })).status).toBe(404);
    expect((await callTalkPost(db, careManager(), "drill-none", { step: 0, actions: 0, signal: call.signal, ask: "safe" })).status).toBe(404);
    expect(parseCallTalkRequest({ signal: "s", text: "あ".repeat(TALK_TEXT_MAX + 1) })).toBeNull();
    expect(parseCallTalkRequest({ signal: "s", text: " 薬は? " })).toEqual({ signal: "s", text: "薬は?" });
    expect(parseCallTalkRequest({ signal: "s", end: true })).toEqual({ signal: "s", end: true });
  });

  it("問いの候補: 着信は 7 つ（安否・けが・機器・薬・移動・避難先・待機・119勧奨、2〜4 字）。外へ掛けた電話は前の 7 つのまま", () => {
    expect(CALL_IN_ASKS.map((k) => TALK_LABELS[k])).toEqual(["安否", "けが", "機器・薬", "移動", "避難先", "待機", "119勧奨"]);
    expect(CALL_OUT_ASKS).toHaveLength(7);
    for (const k of ["safe", "can_move", "shelter", "stay"] as const) expect(CALL_OUT_ASKS).not.toContain(k);
    for (const k of CALL_IN_ASKS) {
      expect(Array.from(TALK_LABELS[k]).length).toBeGreaterThanOrEqual(2);
      expect(Array.from(TALK_LABELS[k]).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("着信の往復を読む所（採点・経過・紙・声）", () => {
  it("採点の往復の数に着信の往復を足す。経過の対応に応答・拒否、把握に往復の行（経路は着信）。把握の時刻の元にもなる", async () => {
    await start();
    const [a, b] = await loadCallRecords(db, ID);
    await respondCall(db, SCOPE, ID, a.signal, "answer");
    await respondCall(db, SCOPE, ID, b.signal, "decline");
    const { hook } = talkHook();
    await talk(a.signal, { ask: "safe" }, hook);
    await talk(a.signal, { ask: "stay" }, hook);
    const calls = await loadCallRecords(db, ID);
    expect(scoreTalks([], calls)).toEqual({ turns: 2, calls: 1, voiced: 0 });

    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    const log = buildDrillLog(screen.ticks, screen.state.actions, { finished: false, calls });
    expect(log.act.filter((r) => r.source === "call").map((r) => (r.source === "call" ? r.c.response : null))).toEqual(["answer", "decline"]);
    const replies = log.know.filter((r) => r.source === "reply");
    expect(replies).toHaveLength(1);
    expect(knowRouteOf(replies[0])).toBe("call");

    const html = renderToStaticMarkup(
      createElement(DrillLog, {
        ticks: screen.ticks,
        actions: screen.state.actions,
        names: screen.names,
        startedAt: START,
        finished: false,
        initial: "act",
        calls,
      }),
    );
    expect(html).toContain(`data-call-act="${a.signal}"`);
    expect(html).toContain(`data-call-response="decline"`);
    expect(html).toContain(`data-reply="${a.signal}"`);
    expect(html).toContain("ご本人は無事ですか");
    // 把握の行の頭に経路の印
    expect(html).toContain(`data-route-mark="call"`);
  });

  it("声: 往復の掛けてきた人の言葉を、着信の声と同じ道で作る（TTS に名前が渡らない、R2 の鍵は id と行の番号だけ）", async () => {
    await start();
    const call = await firstCall();
    await respondCall(db, SCOPE, ID, call.signal, "answer");
    const { hook } = talkHook();
    await talk(call.signal, { ask: "safe" }, hook);
    const ttsCalls: TtsParams[] = [];
    const tts: TtsClient = {
      interactions: {
        create: async (params) => {
          ttsCalls.push(params);
          return { output_audio: { data: btoa("RIFF"), mime_type: "audio/wav" }, usage: { total_input_tokens: 10, total_output_tokens: 200 } };
        },
      },
    };
    const store = new Map<string, Uint8Array>();
    const bucket: VoiceBucket = {
      get: async (k) => (store.has(k) ? { arrayBuffer: async () => store.get(k)!.slice().buffer } : null),
      put: async (k, v) => {
        store.set(k, v.slice());
      },
    };
    const clip = { signal: call.signal, line: 1 };
    const r = await drillVoice({ db, bucket, env: { GEMINI_API_KEY: "dummy" }, tts, now: () => new Date(START) }, { office: DEMO }, ID, clip);
    expect(r.ok).toBe(true);
    expect(ttsCalls).toHaveLength(1);
    expectNoPersonalData(JSON.stringify(ttsCalls[0]));
    expect(store.has(voiceKey(ID, clip))).toBe(true);
    expect(voiceKey(ID, clip)).toBe(`drill/${ID}/${call.signal}-t1.wav`);
    // ケアマネの行（0）は声にしない
    expect((await drillVoice({ db, bucket, env: { GEMINI_API_KEY: "dummy" }, tts }, { office: DEMO }, ID, { signal: call.signal, line: 0 })).ok).toBe(false);
    expect(voiceHref(ID, clip)).toBe(`/api/drill/voice?drill=${ID}&signal=${call.signal}&line=1`);
    expect(parseVoiceQuery(new URLSearchParams(`drill=${ID}&signal=${call.signal}&line=1`))).toEqual({ drillId: ID, clip });
    expect(parseVoiceQuery(new URLSearchParams(`drill=${ID}&signal=${call.signal}&line=x`))).toBeNull();
    // 外へ掛けた電話の往復の行（T155）も行の番号で読む
    expect(parseVoiceQuery(new URLSearchParams(`drill=${ID}&act=a1&line=1`))).toEqual({ drillId: ID, clip: { act: "a1", line: 1 } });
    expect(parseVoiceQuery(new URLSearchParams(`drill=${ID}&act=a1&line=x`))).toBeNull();
  });
});

// ---------- 2. 不在着信と経路の印 ----------

const turn = (over: Partial<DrillTurn> & Pick<DrillTurn, "person">): DrillTurn => ({
  color: "green",
  source: "family",
  whereNow: null,
  injured: null,
  atHome: null,
  canMove: null,
  hasMedicine: null,
  saying: "停電しています",
  doing: null,
  ai: false,
  at: 1,
  ...over,
});

describe("不在着信と経路", () => {
  it("鳴らすのは 1 刻み 2 件まで。残りの電話の形の連絡と同じ人の 2 件目は不在、本人のボタン・言う事なしはボタン", () => {
    const turns = [
      turn({ person: "p-01", at: 1 }),
      turn({ person: "p-02", at: 1.1 }),
      turn({ person: "p-03", at: 1.2 }),
      turn({ person: "p-01", at: 1.3 }),
      turn({ person: "p-04", source: "agent", at: 1.4 }),
      turn({ person: "p-05", saying: null, at: 1.5 }),
    ];
    expect(CALLS_PER_TICK).toBe(2);
    expect(callIndexes(turns)).toEqual([0, 1]);
    expect(missedIndexes(turns)).toEqual([2, 3]);
    expect(turnRoutes(turns)).toEqual(["call", "call", "missed", "missed", "button", "button"]);
    expect(turnRoute(turns[4], false)).toBe("button");
    // 赤の 4 問に答えた物はボタン
    expect(turnRoute(turn({ person: "p-06", color: "red", injured: true }), false)).toBe("button");
  });

  it("まだ折返していない不在着信（新しい順）。不在の刻みから後のその人への本人電話・連絡先電話・訪問か、その人の着信への応答で外れる", () => {
    const ticks = [
      { step: 1, turns: [turn({ person: "p-01" }), turn({ person: "p-02" }), turn({ person: "p-03", at: 1 })] },
      { step: 2, turns: [turn({ person: "p-01", at: 3 }), turn({ person: "p-02", at: 3 }), turn({ person: "p-04", at: 3 }), turn({ person: "p-05", at: 3 })] },
    ];
    expect(openMissedCalls(ticks, []).map((m) => [m.turn.person, m.minute])).toEqual([
      ["p-04", 180],
      ["p-05", 180],
      ["p-03", 60],
    ]);
    // 不在の刻みより前の手は数えない。同じ刻み（不在が画面に出たあと）からの手は折返。ほかの手は数えない
    const acts = [
      { person: "p-03", kind: "call_contact", step: 0 },
      { person: "p-04", kind: "visit", step: 2 },
      { person: "p-05", kind: "report_city", step: 2 },
    ];
    expect(openMissedCalls(ticks, acts).map((m) => m.turn.person)).toEqual(["p-05", "p-03"]);
    expect(openMissedCalls(ticks, [...acts, { person: "p-03", kind: "call_person", step: 1 }]).map((m) => m.turn.person)).toEqual(["p-05"]);
    expect(openMissedCalls(ticks, acts, [{ person: "p-03", step: 2, response: "answer" }]).map((m) => m.turn.person)).toEqual(["p-05"]);
    expect(openMissedCalls(ticks, acts, [{ person: "p-03", step: 2, response: "decline" }]).map((m) => m.turn.person)).toEqual(["p-05", "p-03"]);
  });

  it("掛けてきた人の連絡先: 1 人ならその人、何人かならスマホのある人、次に電話のある人。本人の連絡は無し", () => {
    const c = (id: string, kind: "family" | "supporter" | "self", over: Partial<{ hasPhone: boolean; smartphone: boolean }> = {}) => ({
      id,
      kind,
      label: id,
      hasPhone: true,
      ...over,
    });
    expect(callerContact("family", [c("self", "self"), c("f1", "family")])?.id).toBe("f1");
    expect(callerContact("family", [c("f1", "family", { hasPhone: false }), c("f2", "family"), c("f3", "family", { smartphone: true })])?.id).toBe("f3");
    expect(callerContact("family", [c("f1", "family", { hasPhone: false }), c("f2", "family")])?.id).toBe("f2");
    expect(callerContact("supporter", [c("f1", "family"), c("s1", "supporter")])?.id).toBe("s1");
    expect(callerContact("agent", [c("f1", "family")])).toBeNull();
    expect(callerContact("family", [c("s1", "supporter")])).toBeNull();
  });

  it("経過の把握の行に経路の印（着信・不在・ボタン・公表・発信）。経過の並びは変えない", async () => {
    await start();
    expect((await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0 })).status).toBe(200);
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    const log = buildDrillLog(screen.ticks, screen.state.actions, { finished: false });
    const routes = new Set(log.know.map(knowRouteOf));
    expect(routes.has("call")).toBe(true);
    expect(routes.has("out")).toBe(true);
    for (const r of log.know) expect(knowRouteOf(r)).not.toBeNull();
    // 合成の刻みで不在とボタン
    const ticks = [
      {
        step: 0,
        hour: 1,
        incidents: [],
        turns: [turn({ person: "p-01" }), turn({ person: "p-02" }), turn({ person: "p-03" }), turn({ person: "p-04", source: "agent" })],
        finished: false,
        world: screen.state.world,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(DrillLog, { ticks, actions: [], names: { "p-03": "架空 三郎" }, startedAt: START, finished: false, initial: "know" }),
    );
    expect(html).toContain(`data-route-mark="missed"`);
    expect(html).toContain(`data-route-mark="button"`);
    expect(html).toContain(ROUTE_LABELS.missed);
    expect(Object.values(ROUTE_LABELS).every((v) => Array.from(v).length >= 2 && Array.from(v).length <= 4)).toBe(true);
  });

  it("不在着信の一覧: 新しい順に 4 件と「他 N 件」、折返のボタン（連絡先電話・本人電話）", () => {
    const item = (i: number, kind: MissedItem["kind"] = "call_contact"): MissedItem => ({
      key: `k${i}`,
      person: `p-0${i}`,
      name: `架空 ${i}`,
      caller: "家族 娘",
      minute: 60 * i,
      saying: "停電しています",
      ai: i === 1,
      kind,
      target: kind === "call_contact" ? `c${i}` : null,
    });
    const items = [item(5), item(4, "call_person"), item(3), item(2), item(1)];
    const html = renderToStaticMarkup(createElement(MissedCalls, { drillId: ID, step: 0, actions: 0, items }));
    expect(html).toContain(MISSED_LABELS.title);
    expect(html.match(/data-missed="/g)).toHaveLength(4);
    expect(html).toContain(`data-missed-more="1"`);
    expect(html).toContain(`data-missed-callback="call_person"`);
    expect(html).toContain(MISSED_LABELS.callback);
    expect(renderToStaticMarkup(createElement(MissedCalls, { drillId: ID, step: 0, actions: 0, items: [] }))).toBe("");
  });

  it("本物の道: 折返は連絡先電話の手で打て、打つと一覧から外れる", async () => {
    await start();
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    // 0 時間の家族の連絡を 1 件不在にした刻みを作る（同じ人の同じ時刻の 2 件目）
    const t0 = screen.ticks[0];
    const call = t0.turns.find((t) => t.source === "family" && t.saying)!;
    const ticks = [{ step: 0, turns: [...t0.turns, { ...call }] }];
    const open = openMissedCalls(ticks, screen.state.actions);
    expect(open.map((m) => m.turn.person)).toContain(call.person);
    const target = callerContact(call.source, screen.contacts[call.person] ?? [])!;
    expect(target.hasPhone).toBe(true);
    const res = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_contact", person: call.person, target: target.id }, START, { roll: () => 0 });
    expect(res.status).toBe(200);
    const after = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(openMissedCalls(ticks, after.state.actions).map((m) => m.turn.person)).not.toContain(call.person);
  });
});
