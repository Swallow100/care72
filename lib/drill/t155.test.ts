// T155 訓練の通話を会話に（docs/tasks/T155.md）のテスト。本物の API は呼ばない（偽の Claude の client・偽の TTS・Map の偽の R2・
// 偽のマイク〔偽の SpeechRecognition〕）。
// 1: 往復の 1 回（文の長さで 1〜3 分、声の印、想定の門を着信にも）と、保存・作り直し・要求の形
// 2: 外へ掛けた電話の往復の声（act と line）
// 3: 声の入力の下書き（偽のマイク・直す・マイク不可）
// 4: 読む所（経過の吹き出し・紙・採点・講評）と通話の画面の部品

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallLines, CallReply, callLeft, MIC_ERROR_LABELS } from "../../components/drill/CallTalk.tsx";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { TalkBox } from "../../components/drill/TalkBox.tsx";
import { TalkLines } from "../../components/drill/TalkLines.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { TtsClient, TtsParams } from "../gemini/tts.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { createDictation, dictationErrorOf, type SpeechRecognitionLike, type SpeechResultEvent } from "../speech/dictation.ts";
import { draftOnSpeech, draftOnType, draftToSend, EMPTY_DRAFT, type CallDraft } from "./call-input.ts";
import { abandonDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { CALL_IN_ASKS, CALL_OUT_ASKS, TALK_FIXED_SPEECH, TALK_MAX, TALK_TEXT_MAX, TALK_UI, type TalkLine } from "./dialogue.ts";
import type { ActionRecord, DrillState } from "./engine.ts";
import { profileOf } from "./fit.ts";
import { drillTalkHook } from "./hooks.ts";
import { actionPost } from "./http.ts";
import { callTalkPost, parseCallTalkRequest } from "./incoming-talk.ts";
import { loadDrillRecord, reviewContextOf } from "./record.ts";
import { loadCallRecords, respondCall, type CallRecord } from "./responses.ts";
import { reviewText } from "./review.ts";
import { scoreTalks } from "./score.ts";
import { parseTalkRequest, talkPost } from "./talk.ts";
import { TALK_LONG_CHARS, TALK_MINUTES_MAX, TALK_MINUTES_MIN, TALK_SHORT_CHARS, talkMinutesOf, talkRound } from "./talk-turn.ts";
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

const inputOf = (p: Params) => JSON.parse(p.messages[0].content as string) as Record<string, { text: string }>;

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const TOWNS = [...new Set(SEED_PEOPLE.map((p) => p.ledger.basic.address!.town))];

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
const ID = "drill-t155";
const ENV = { DB: null as unknown as ReturnType<typeof d1FromSqlite>, ANTHROPIC_API_KEY: "dummy" };

async function start() {
  expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID)).toEqual({ ok: true, id: ID });
}

async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}

async function firstCall(): Promise<CallRecord> {
  const calls = await loadCallRecords(db, ID);
  expect(calls.length).toBeGreaterThan(0);
  return calls[0];
}

function talkHook(answer: (p: Params) => unknown) {
  const { client, calls } = fake(answer);
  const hook = drillTalkHook({ ...ENV, DB: db }, careManager(), { claude: client, now: () => new Date(START) })!;
  return { hook, calls };
}

async function callTalk(signal: string, body: Record<string, unknown>, hook?: ReturnType<typeof talkHook>["hook"]): Promise<Response> {
  const s = await stored();
  const row = (await loadDrillRow(db, DEMO.id, ID))!;
  return callTalkPost(db, careManager(), ID, { step: row.step, actions: s.actions.length, signal, ...body }, hook ? { hook } : {});
}

async function outTalk(body: Record<string, unknown>, hook?: ReturnType<typeof talkHook>["hook"]): Promise<Response> {
  const s = await stored();
  return talkPost(db, careManager(), ID, { step: s.step, actions: s.actions.length, action: s.actions.at(-1)?.id, ...body }, hook ? { hook } : {});
}

/** 山本さん（p-01）へ本人電話。出て最初の言葉がある */
async function callYamada(): Promise<ActionRecord> {
  const res = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0 });
  expect(res.status).toBe(200);
  const rec = (await stored()).actions.at(-1)!;
  expect(rec.result).toMatchObject({ status: "connected" });
  return rec;
}

// ---------- 1. 往復の 1 回 ----------

describe("往復の 1 回（時計・声の印・想定の門）", () => {
  it("1 往復の時計は自分と相手の言葉の字数で 1〜3 分（空白は数えない）", () => {
    expect(TALK_MAX).toBe(8);
    expect(TALK_TEXT_MAX).toBe(120);
    expect(talkMinutesOf("", "")).toBe(TALK_MINUTES_MIN);
    expect(talkMinutesOf("あ".repeat(TALK_SHORT_CHARS - 10), "い".repeat(10))).toBe(1);
    expect(talkMinutesOf("あ".repeat(TALK_SHORT_CHARS), "い")).toBe(2);
    expect(talkMinutesOf("あ  い".repeat(10), "")).toBe(1);
    expect(talkMinutesOf("あ".repeat(TALK_LONG_CHARS), "")).toBe(2);
    expect(talkMinutesOf("あ".repeat(TALK_LONG_CHARS), "い")).toBe(TALK_MINUTES_MAX);
    expect(talkMinutesOf("あ".repeat(500), "い".repeat(500))).toBe(3);
  });

  it("声の印は自由の文にだけ。決まった問いには付けない。口が無ければ固定の言葉（AI の印なし）", () => {
    const world = { counts: { director: 0, persona: 0, call: 0, free: 0 } } as unknown as DrillState["world"];
    const spoken = talkRound({ world, person: "p-01", at: 100, text: "薬は残っていますか", voice: true, reply: null, fit: null });
    expect(spoken.cm).toEqual({ who: "cm", text: "薬は残っていますか", ai: false, minute: 100, voice: true });
    expect(spoken.them).toEqual({ who: "them", text: TALK_FIXED_SPEECH, ai: false, minute: 100 + spoken.minutes });
    expect(spoken.minutes).toBe(1);
    const asked = talkRound({ world, person: "p-01", at: 100, ask: "safe", voice: true, reply: null, fit: null });
    expect(asked.cm.voice).toBeUndefined();
    expect(asked.world).toBe(world);
  });

  it("想定の門: 大雨の想定で地震の文は落とし、落とした数を世界の gated に。全部落ちたら固定の言葉", () => {
    const world = { counts: { director: 0, persona: 0, call: 0, free: 0 } } as unknown as DrillState["world"];
    const fit = profileOf("heavy_rain");
    const r = talkRound({
      world,
      person: "p-01",
      at: 10,
      ask: "safe",
      reply: { said: "ご本人は無事ですか", speech: "無事です。地震で棚が倒れました。", asks: ["water"], ai: true, called: true },
      fit,
    });
    expect(r.them).toMatchObject({ text: "無事です。", ai: true, asks: ["water"] });
    expect(r.world.gated).toEqual({ "persona:fit:quake_word": 1 });
    expect(r.world.counts?.call).toBe(1);
    const all = talkRound({
      world,
      person: "p-01",
      at: 10,
      ask: "safe",
      reply: { said: "ご本人は無事ですか", speech: "地震がこわいです。", asks: ["water"], ai: true, called: true },
      fit,
    });
    expect(all.them).toEqual({ who: "them", text: TALK_FIXED_SPEECH, ai: false, minute: 10 + all.minutes });
    // 言葉が使えなければ頼み事も積まない
    expect(all.world.asks).toBeUndefined();
  });

  it("要求の形: voice は自由の文と一緒の true だけ。120 字まで", () => {
    expect(parseCallTalkRequest({ signal: "s", text: "薬は?", voice: true })).toEqual({ signal: "s", text: "薬は?", voice: true });
    expect(parseCallTalkRequest({ signal: "s", ask: "safe", voice: true })).toBeNull();
    expect(parseCallTalkRequest({ signal: "s", text: "薬は?", voice: "yes" })).toBeNull();
    expect(parseCallTalkRequest({ signal: "s", text: "あ".repeat(TALK_TEXT_MAX) })).not.toBeNull();
    expect(parseCallTalkRequest({ signal: "s", text: "あ".repeat(TALK_TEXT_MAX + 1) })).toBeNull();
    expect(parseTalkRequest({ action: "a1", text: "今どこですか", voice: true })).toEqual({ action: "a1", text: "今どこですか", voice: true });
    expect(parseTalkRequest({ action: "a1", end: true, voice: true })).toBeNull();
  });
});

describe("着信の往復（声で入れた文・想定の門・作り直し）", () => {
  it("声で入れた文は応答の記録に voice の印で残り、作り直した状態が保存と同じ。本人役に名前が渡らない", async () => {
    await start();
    const call = await firstCall();
    await respondCall(db, SCOPE, ID, call.signal, "answer");
    const { hook, calls } = talkHook(() => ({ speech: "母は家にいます。地震は大丈夫でした。", asks: ["medicine"] }));
    const before = await stored();
    const res = await callTalk(call.signal, { text: "今どこにいますか、薬はありますか", voice: true }, hook);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: TalkLine[]; minute: number };
    expect(body.lines[0]).toMatchObject({ who: "cm", text: "今どこにいますか、薬はありますか", voice: true });
    // 着信にも想定の門（大雨の想定で地震の文を落とす。T155 で着信の道にも）
    expect(body.lines[1]).toMatchObject({ who: "them", text: "母は家にいます。", ai: true });
    expect(body.minute).toBe(before.minute + talkMinutesOf(body.lines[0].text, body.lines[1].text));
    expect(calls).toHaveLength(1);
    expectNoPersonalData(JSON.stringify(inputOf(calls[0])));

    const s = await stored();
    expect(s.world.gated?.["persona:fit:quake_word"]).toBe(1);
    // T130 の帳面: 言われた事（自由の文）を世界に積む
    expect(s.world.told?.[call.person]?.at(-1)).toMatchObject({ text: "今どこにいますか、薬はありますか" });
    const rec = (await loadCallRecords(db, ID)).find((c) => c.signal === call.signal)!;
    expect(rec.talk?.[0]?.voice).toBe(true);
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.state.minute).toBe(s.minute);
    expect(screen.state.world.asks).toEqual(s.world.asks);
    expect(scoreTalks([], await loadCallRecords(db, ID))).toEqual({ turns: 1, calls: 1, voiced: 1 });
  });
});

// ---------- 2. 外へ掛けた電話の往復 ----------

describe("外へ掛けた電話の往復（行を返す・声の印・相手の声）", () => {
  it("往復の要求は往復の全部の行を返し、声で入れた文に印。8 往復まで", async () => {
    await start();
    const call = await callYamada();
    const { hook } = talkHook(() => ({ speech: "家にいます。薬はあと少しです。", asks: [] }));
    const res = await outTalk({ text: "今どちらにいますか", voice: true }, hook);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: TalkLine[]; rounds: number; ended: boolean };
    expect(body).toMatchObject({ ok: true, action: call.id, rounds: 1, ended: false });
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({ who: "cm", voice: true });
    const r = (await stored()).actions.at(-1)!.result!;
    expect(r.talk?.[0]?.voice).toBe(true);
    expect(scoreTalks((await stored()).actions)).toEqual({ turns: 1, calls: 1, voiced: 1 });
    for (let i = 1; i < TALK_MAX; i++) expect((await outTalk({ ask: CALL_OUT_ASKS[i % CALL_OUT_ASKS.length] }, hook)).status).toBe(200);
    expect((await outTalk({ ask: "where" }, hook)).status).toBe(409);
    const end = await outTalk({ end: true });
    expect(await end.json()).toMatchObject({ ok: true, ended: true });
  });

  it("相手の行の声は act と line で、文は D1 の手の記録から（TTS に名前が渡らない、R2 の鍵は id と行の番号だけ）", async () => {
    await start();
    const call = await callYamada();
    const { hook } = talkHook(() => ({ speech: "はい、家にいます。", asks: [] }));
    await outTalk({ ask: "where" }, hook);
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
    const clip = { act: call.id, line: 1 };
    const r = await drillVoice({ db, bucket, env: { GEMINI_API_KEY: "dummy" }, tts, now: () => new Date(START) }, { office: DEMO }, ID, clip);
    expect(r.ok).toBe(true);
    expect(ttsCalls).toHaveLength(1);
    expect(JSON.stringify(ttsCalls[0])).toContain("家にいます");
    expectNoPersonalData(JSON.stringify(ttsCalls[0]));
    expect(voiceKey(ID, clip)).toBe(`drill/${ID}/act-${call.id}-t1.wav`);
    expect(store.has(voiceKey(ID, clip))).toBe(true);
    // 自分の行（0）と無い行は声にしない
    expect((await drillVoice({ db, bucket, env: { GEMINI_API_KEY: "dummy" }, tts }, { office: DEMO }, ID, { act: call.id, line: 0 })).ok).toBe(false);
    expect((await drillVoice({ db, bucket, env: { GEMINI_API_KEY: "dummy" }, tts }, { office: DEMO }, ID, { act: call.id, line: 9 })).ok).toBe(false);
    expect(voiceHref(ID, clip)).toBe(`/api/drill/voice?drill=${ID}&act=${call.id}&line=1`);
    expect(parseVoiceQuery(new URLSearchParams(`drill=${ID}&act=${call.id}&line=1`))).toEqual({ drillId: ID, clip });
    // 最初の言葉の声は今までどおり
    expect(voiceKey(ID, { act: call.id })).toBe(`drill/${ID}/act-${call.id}.wav`);
  });
});

// ---------- 3. 声の入力の下書き ----------

/** 偽のマイク（SpeechRecognition の偽物）。say で認識の結果を流す */
class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: SpeechResultEvent) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  results: Array<{ isFinal: boolean; length: number; 0: { transcript: string } }> = [];
  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {}
  /** 認識中の区切りは同じ位置で置き換わり、確定すると次の区切りへ（本物の continuous と同じ） */
  say(text: string, isFinal: boolean) {
    const last = this.results.at(-1);
    if (last && !last.isFinal) this.results.pop();
    this.results.push({ isFinal, length: 1, 0: { transcript: text } });
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results as unknown as SpeechResultEvent["results"] });
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
}

describe("声の入力（偽のマイク）", () => {
  it("話した声は欄に文字で出て、直してから送れる。声で足した文は voice の印（直しても）。欄を空にすると印を外す", () => {
    let draft: CallDraft = EMPTY_DRAFT;
    const d = createDictation(FakeRecognition, {
      onText: (t) => (draft = draftOnSpeech(draft, t)),
      onDone: (t) => (draft = draftOnSpeech(draft, t)),
      onEnd: () => {},
    });
    expect(d.start("")).toBe(true);
    const mic = FakeRecognition.last!;
    mic.say("今どこに", false);
    expect(draft).toEqual({ text: "今どこに", voiced: true });
    mic.say("今どこにいますか", true);
    d.stop();
    expect(draft.text).toBe("今どこにいますか");
    // 送る前に直す（文字を打つ）
    draft = draftOnType(draft, "今どこにいますか、けがは");
    expect(draftToSend(draft)).toEqual({ text: "今どこにいますか、けがは", voice: true });
    draft = draftOnType(draft, "");
    expect(draft.voiced).toBe(false);
    expect(draftToSend(draft)).toBeNull();
    // 打っただけの文は声の印なし
    expect(draftToSend(draftOnType(EMPTY_DRAFT, " 薬は? "))).toEqual({ text: "薬は?" });
    // 長い文は欄の上限で切る
    expect(Array.from(draftOnSpeech(EMPTY_DRAFT, "あ".repeat(TALK_TEXT_MAX + 30)).text)).toHaveLength(TALK_TEXT_MAX);
  });

  it("マイクの許可が無い・断られた時は「マイク不可」で文字だけで続ける（下書きは残る）", () => {
    let draft: CallDraft = draftOnType(EMPTY_DRAFT, "打った文");
    let ended: string | null = "none";
    const d = createDictation(FakeRecognition, {
      onText: (t) => (draft = draftOnSpeech(draft, t)),
      onDone: () => {},
      onEnd: (e) => (ended = e),
    });
    d.start(draft.text);
    FakeRecognition.last!.fail("not-allowed");
    expect(ended).toBe("mic");
    expect(dictationErrorOf("not-allowed")).toBe("mic");
    expect(MIC_ERROR_LABELS.mic).toBe(TALK_UI.micDenied);
    expect(draftToSend(draft)).toEqual({ text: "打った文" });
  });
});

// ---------- 4. 読む所と画面 ----------

function line(who: TalkLine["who"], minute: number, over: Partial<TalkLine> = {}): TalkLine {
  return { who, text: who === "cm" ? "今どこにいますか" : "家にいます", ai: who === "them", minute, ...over };
}

describe("画面（通話の画面・吹き出し）", () => {
  it("吹き出しに声の印（自分の行だけ）。通話の画面の返す欄は文字の欄・送信・問いの候補・残り・切る。避ける型を使わない", () => {
    const lines = [line("cm", 10, { voice: true }), line("them", 12), line("cm", 12, { ask: "safe" }), line("them", 13)];
    const bubbles = renderToStaticMarkup(createElement(TalkLines, { lines, speaker: "家族 娘" }));
    expect(bubbles.match(/data-voice-mark/g)).toHaveLength(1);
    expect(bubbles).toContain(TALK_UI.voice);

    const reply = renderToStaticMarkup(
      createElement(CallReply, { asks: CALL_IN_ASKS, lines, canReply: true, busy: false, onSend: async () => true, onHangUp: () => {}, mark: "incoming" }),
    );
    expect(reply).toContain("data-call-text");
    expect(reply.toLowerCase()).toContain(`maxlength="${TALK_TEXT_MAX}"`);
    for (const k of CALL_IN_ASKS) expect(reply).toContain(`data-incoming-ask="${k}"`);
    expect(reply).toContain(`data-call-left="${TALK_MAX - 2}"`);
    expect(reply).toContain(`data-incoming-action="hangup"`);
    expect(reply).toContain(TALK_UI.send);
    expect(reply).not.toMatch(/rounded-full|tracking-|gradient|shadow-|<details/);
    // 描いた時はマイクの対応がまだ分からない（描いたあとに見る）ので、マイクのボタンは出さない
    expect(reply).not.toContain("data-call-mic");
    expect(callLeft(Array.from({ length: TALK_MAX }, () => [line("cm", 1), line("them", 2)]).flat())).toBe(0);

    const ended = renderToStaticMarkup(
      createElement(CallReply, { asks: CALL_IN_ASKS, lines, canReply: false, busy: false, onSend: async () => true, onHangUp: () => {}, mark: "incoming" }),
    );
    expect(ended).not.toContain("data-call-text");
    expect(ended).toContain(`data-incoming-action="hangup"`);

    const conv = renderToStaticMarkup(createElement(CallLines, { speaker: "本人", first: { text: "はい、もしもし", ai: true }, lines }));
    expect(conv).toContain("data-call-first");
    expect(conv).toContain("はい、もしもし");
  });

  it("外へ掛けた電話も、続けられる間は着信と同じ通話の画面を重ねる（相手・名前・最初の言葉・返す欄）。終わった電話は吹き出しだけ", () => {
    const action = {
      id: "a1",
      kind: "call_person",
      person: "p-01",
      target: "c-1",
      callee: "self",
      calleeLabel: "本人",
      at: 3,
      atMinute: 180,
      endMinute: 185,
      minutes: 5,
      step: 1,
      before: { person: null, marks: {}, staff: 2, phone: "ok", roadClosed: false },
      result: {
        status: "connected",
        ok: true,
        text: "",
        ai: false,
        speech: "はい、もしもし",
        speechAi: true,
        pickup: null,
        cleared: [],
        staff: 0,
        crossed: [],
        atMinute: 185,
        heard: null,
        talk: [line("cm", 185, { voice: true }), line("them", 186)],
      },
    } as unknown as ActionRecord;
    const html = renderToStaticMarkup(
      createElement(TalkBox, { drillId: ID, step: 1, actions: 1, action, speaker: "本人", name: "山田 花子", voice: "/api/drill/voice?drill=x&act=a1" }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("data-call-first");
    expect(html).toContain("山田 花子");
    expect(html).toContain(TALK_UI.calling);
    expect(html).toContain("data-call-text");
    expect(html).toContain("data-talk-play");
    expect(html.match(/data-voice-mark/g)).toHaveLength(1);
    const done = { ...action, result: { ...action.result!, talkEnd: 190 } } as ActionRecord;
    const closed = renderToStaticMarkup(createElement(TalkBox, { drillId: ID, step: 1, actions: 1, action: done, speaker: "本人" }));
    expect(closed).not.toContain('role="dialog"');
    expect(closed.match(/data-talk-line=/g)).toHaveLength(2);
  });
});

describe("読む所（紙・講評）", () => {
  it("訓練記録の紙に外へ掛けた電話と着信の往復の言葉の全部と声の印。講評の入力に通話の言葉（伏せきれない行は渡さない）", async () => {
    await start();
    const call = await firstCall();
    await respondCall(db, SCOPE, ID, call.signal, "answer");
    const { hook } = talkHook(() => ({ speech: "母は家にいます。", asks: [] }));
    expect((await callTalk(call.signal, { text: "ご本人は動けますか", voice: true }, hook)).status).toBe(200);
    expect((await callTalk(call.signal, { end: true })).status).toBe(200);
    await callYamada();
    expect((await outTalk({ text: "今どちらですか" }, hook)).status).toBe(200);
    expect(await abandonDrill(db, SCOPE, ID, "2026-11-05T02:00:00.000Z")).toEqual({ ok: true });
    const rec = await loadDrillRecord(db, SCOPE, ID, "2026-11-05T02:00:00.000Z");
    if (rec === null || rec === "running") throw new Error("記録が無い");

    const paper = renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: DEMO.name, today: "2026-11-05" }));
    expect(paper).toContain("ご本人は動けますか");
    expect(paper).toContain("今どちらですか");
    expect(paper.match(/data-paper-voice/g)).toHaveLength(1);
    expect(paper).toContain("data-talk-lines=");

    const ctx = reviewContextOf(rec);
    const alias = new Map(rec.score.participants.map((p, i) => [p, `${String.fromCharCode(65 + i)} さん`]));
    const text = reviewText(ctx, alias, { words: (t) => (t.includes("今どちら") ? null : t) });
    expect(text).toContain("通話の言葉");
    expect(text).toContain("自分（声）: 「ご本人は動けますか」");
    expect(text).toContain("相手: 「母は家にいます。」");
    expect(text).not.toContain("今どちらですか");
    expect(text).toContain("うち声で入れた言葉 1");
    // 検査の口を渡さなければ言葉の欄を作らない（前の形）
    expect(reviewText(ctx, alias)).not.toContain("通話の言葉");
  });
});
