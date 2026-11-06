// 本人のスマホの声の聞き取りの会話（docs/tasks/T137.md・T137b.md）の流れ。マイク・声・文字起こし・サーバーは偽物（偽の時計）。
// 20 秒押さない → 定型文（AI の告知から）→ 聞く → 次の手（サーバー）→ 読む … → 締め（119 の文で終わる）→ 録音と会話の記録を送る。
// 聞き取りは会話の間ずっと 1 本（T137b）: 読む間に本人が話したら声を止めて聞く、考える間の言葉も次の手の材料、読んだ文の声の拾いは答えにしない。
// 聞き取れないが続く → ボタンの答え方（はい・いいえ・とばす）と応答不明瞭の印。危ない言葉は決まった文で締める。サーバーに届かないときは決まった問い。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhoneView } from "../../components/phone/PhoneView.tsx";
import { EMERGENCY_TEXT } from "../forms/own-sheet.ts";
import type { SignalBody } from "./body.ts";
import type { AttachItem } from "./outbox.ts";
import {
  createPhone,
  IDLE_MS,
  TALK_FILLER_MS,
  TALK_LISTEN_MS,
  TALK_QUIET_MS,
  TALK_WAIT_MS,
  type PhoneDeps,
  type PhoneState,
  type TranscriptEvents,
} from "./phone.ts";
import type { Answers } from "./questions.ts";
import { fillerText, fixedLine, TALK_MAX_TURNS, TALK_TOPIC_SPECS, type TalkLine, type TalkLog } from "./talk.ts";
import type { TalkReply } from "./talk-ai.ts";

const T0 = Date.parse("2026-11-04T01:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

type H = {
  phone: ReturnType<typeof createPhone>;
  states: PhoneState[];
  /** 読んだ文（定型文は「（定型文）」） */
  said: string[];
  /** 読んだ文の声の URL */
  voices: Array<string | null>;
  logs: TalkLog[];
  recordings: Array<{ item: AttachItem; audio: Blob | null }>;
  answers: Answers[];
  recLog: string[];
  signals: SignalBody[];
  hushed: number;
  /** 文字起こしを開いた回数（会話の間ずっと 1 本） */
  opened: number;
  /** 本人が話した（今の文字起こしの全部に足して知らせる） */
  words(text: string): void;
};

type HarnessOptions = {
  /** この文を読む声は、止められるまで終わらない（読む間の話し始めを試す） */
  hangOn?: string;
  /** サーバーの返事を待たせる（ミリ秒） */
  talkDelay?: number;
};

/**
 * texts は問いを読むごとの本人の言葉（読み終えて 1 秒後に話す。null は黙る）。replies はサーバーの返事（"hang" は返さない）。
 * 締め・相づち・ボタンの文を読んだときは本人は話さない
 */
function harness(texts: Array<string | null>, replies: Array<TalkReply | null | "hang">, over: Partial<PhoneDeps> = {}, opt: HarnessOptions = {}): H {
  const h = { states: [], said: [], voices: [], logs: [], recordings: [], answers: [], recLog: [], signals: [], hushed: 0, opened: 0 } as unknown as H;
  let full = "";
  let events: TranscriptEvents | null = null;
  let turn = 0;
  let i = 0;
  let id = 0;
  let stopHang: (() => void) | null = null;
  h.words = (text: string) => {
    full = full ? `${full}\n${text}` : text;
    events?.onText?.(full);
  };
  const afterLine = () => {
    const text = texts[turn++];
    if (text != null) setTimeout(() => h.words(text), 1000);
  };
  const rec = {
    pause: () => h.recLog.push("pause"),
    resume: () => h.recLog.push("resume"),
    stop: async () => {
      h.recLog.push("stop");
      return new Blob([new Uint8Array([7])], { type: "audio/webm" });
    },
  };
  h.phone = createPhone({
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    sendSignal: async (b) => {
      h.signals.push(b);
      return "sent";
    },
    sendRecording: async (item, audio) => {
      h.recordings.push({ item, audio });
      return "sent";
    },
    sendAnswers: async (item) => {
      h.answers.push(item.answers);
      return "sent";
    },
    hasDevice: true,
    playPrompt: async () => {
      h.said.push("（定型文）");
      afterLine();
    },
    speak: async (text) => {
      h.said.push(text);
    },
    say: async (text, voice) => {
      h.said.push(text);
      h.voices.push(voice ?? null);
      if (text === opt.hangOn) await new Promise<void>((r) => (stopHang = r));
      // 問いの文（決まった問い・AI の文）のあとだけ本人が話す
      if (!voice || voice.includes("fixed=topic-")) afterLine();
    },
    hush: () => {
      h.hushed++;
      stopHang?.();
    },
    startRecording: async () => rec,
    startTranscript: (e) => {
      h.opened++;
      events = e;
      return { stop: async () => full || null };
    },
    talk: async (_signalId, log) => {
      h.logs.push(log);
      const r = replies[i++];
      if (opt.talkDelay) await new Promise((res) => setTimeout(res, opt.talkDelay));
      if (r === "hang") return new Promise<TalkReply | null>(() => {});
      return r ?? null;
    },
    onChange: (s) => h.states.push(s),
    ...over,
  });
  return h;
}

const ask = (line: TalkLine, called = false): TalkReply => ({ kind: "ask", line, called });
const aiLine = (topic: TalkLine["topic"], text: string, item?: string): TalkLine => ({ text, question: text, easy: null, by: "ai", topic, ...(item ? { item } : {}) });

/** 1 往復: 文字が届く（1 秒）→ 静かな間（3 秒）で閉じる */
const oneTurn = () => tick(1000 + TALK_QUIET_MS + 10);

describe("声の聞き取りの会話（T137）", () => {
  it("20 秒押さない → 定型文 → AI と決まった問いで聞き返す → 表の 2 問を聞いて「つかめた」→ 締め（119 の文）→ 録音と会話の記録", async () => {
    const h = harness(
      ["あしが いたい", "はい", "たてん", "うごけない"],
      [
        ask(fixedLine("injured")),
        ask(aiLine("canMove", "じぶんで たてますか"), true),
        ask(fixedLine("canMove"), true),
        { kind: "close", end: "grasped", called: true },
      ],
    );
    h.phone.red();
    await tick(IDLE_MS);
    expect(h.phone.state).toMatchObject({ step: "talk", first: true, voice: "listening" });
    expect(h.said).toEqual(["（定型文）"]);
    for (let k = 0; k < 4; k++) await oneTurn();
    await tick(10);
    expect(h.said.slice(1, 4)).toEqual([TALK_TOPIC_SPECS.injured.text, "じぶんで たてますか", TALK_TOPIC_SPECS.canMove.text]);
    // 決まった問い・締めは作り置きの声（id）、AI の文は会話の API の声（ここでは無い）
    expect(h.voices.slice(0, 3)).toEqual(["/api/signals/voice?fixed=topic-injured", null, "/api/signals/voice?fixed=topic-canMove"]);
    expect(h.voices.at(-1)).toBe("/api/signals/voice?fixed=close-grasped");
    // 締めは 119 の文で終わる
    expect(h.said.at(-1)!.endsWith(EMERGENCY_TEXT)).toBe(true);
    expect(h.phone.state).toMatchObject({ step: "done", color: "red", delivery: "sent" });
    // 決まった問いのまま取れた答えは送る（声の印）。AI が言い換えた問いの「たてん」は取らない
    expect(h.answers.at(-1)).toEqual({ injured: { choice: "yes", via: "voice" }, canMove: { choice: "no", via: "voice" } });
    const sent = h.recordings[0].item;
    expect(sent.transcript).toBe("あしが いたい\nはい\nたてん\nうごけない");
    expect(sent.talk).toMatchObject({ end: "grasped", unclear: false, aiCalls: 3, danger: null });
    expect(sent.talk!.turns.map((t) => [t.topic, t.by, t.heard])).toEqual([
      ["open", "fixed", "text"],
      ["injured", "fixed", "text"],
      ["canMove", "ai", "text"],
      ["canMove", "fixed", "text"],
    ]);
    // 聞き取りは会話の間 1 本。録音も 1 本で、読む間も止めない（T137b）
    expect(h.opened).toBe(1);
    expect(h.recLog).toEqual(["stop"]);
    // サーバーには毎回それまでの全部
    expect(h.logs.map((l) => l.turns.length)).toEqual([1, 2, 3, 4]);
  });

  it("うめき声 → 黙る: ボタンの答え方へ（応答不明瞭の印）。はい・いいえ・押さない・とばす で答え、自動で送る", async () => {
    const h = harness(["うー…", null], [ask(fixedLine("injured"))]);
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(TALK_LISTEN_MS + 10);
    expect(h.phone.state).toMatchObject({ step: "yesno", id: "injured" });
    expect(h.logs).toHaveLength(1);
    expect(h.said.at(-1)).toBe("けがはありますか。はいならみどり、いいえならあかをおしてください");
    expect(h.voices.at(-1)).toBe("/api/signals/voice?fixed=button-injured");
    h.phone.yesNo(true);
    await tick(10);
    expect(h.phone.state).toMatchObject({ step: "yesno", id: "canMove" });
    h.phone.yesNo(false);
    await tick(10);
    expect(h.phone.state).toMatchObject({ step: "yesno", id: "atHome" });
    await tick(IDLE_MS + 10);
    expect(h.phone.state).toMatchObject({ step: "yesno", id: "hasMedicine" });
    h.phone.skip();
    await tick(10);
    expect(h.phone.state).toMatchObject({ step: "done", color: "red" });
    expect(h.answers.at(-1)).toEqual({ injured: { choice: "yes", via: "press" }, canMove: { choice: "no", via: "press" } });
    const talk = h.recordings[0].item.talk!;
    expect(talk).toMatchObject({ unclear: true, end: "unclear" });
    expect(talk.turns.slice(2).map((t) => [t.topic, t.heard])).toEqual([
      ["injured", "press"],
      ["canMove", "press"],
      ["place", "silent"],
      ["hasMedicine", "skip"],
    ]);
  });

  it("命に関わる言葉: サーバーに聞かず、119 の文と「すぐ しらせます」を読んで締める", async () => {
    const h = harness(["けむりが でてる、いきが くるしい"], []);
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(10);
    expect(h.logs).toHaveLength(0);
    expect(h.said.at(-1)).toBe(`${EMERGENCY_TEXT}。すぐケアマネジャーにしらせます`);
    expect(h.states).toContainEqual({ step: "closing", easy: "すぐ ケアマネジャーに しらせます", danger: true });
    expect(h.recordings[0].item.talk).toMatchObject({ end: "danger", danger: "fire" });
  });

  it("サーバーに届かない・遅い（16 秒）: 端末だけで決まった問いを続ける", async () => {
    const h = harness(["あしが いたい", "はい"], [null, "hang"]);
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(10);
    expect(h.said.at(-1)).toBe(TALK_TOPIC_SPECS.injured.text);
    await oneTurn();
    expect(h.phone.state).toMatchObject({ step: "talk", voice: "thinking" });
    await tick(TALK_WAIT_MS);
    expect(h.said.at(-1)).toBe(TALK_TOPIC_SPECS.canMove.text);
  });

  it("話さなければ 15 秒で 1 往復を閉じる。締めるときは聞いていた往復の答えも入れる", async () => {
    const h = harness([null, null], [ask(fixedLine("injured"))]);
    h.phone.red();
    await tick(IDLE_MS);
    await tick(TALK_LISTEN_MS + 10);
    expect(h.said.at(-1)).toBe(TALK_TOPIC_SPECS.injured.text);
    h.words("あの、ええと、うちの ねこが");
    h.phone.finish();
    await tick(10);
    expect(h.phone.state).toMatchObject({ step: "done" });
    const talk = h.recordings[0].item.talk!;
    expect(talk.end).toBe("send");
    expect(talk.turns.map((t) => t.reply)).toEqual([null, "あの、ええと、うちの ねこが"]);
  });

  it("噛み合わない話が続いても、上限（10 回）で締めて「また あとで ききます」", async () => {
    const texts = Array.from({ length: TALK_MAX_TURNS }, (_, i) => `きょうは おまつり ${"あいうえおかきくけこ"[i]}`);
    const replies = Array.from({ length: TALK_MAX_TURNS }, () => ask(aiLine("nearby", "そばに だれか いますか"), true));
    const h = harness(texts, replies);
    h.phone.red();
    await tick(IDLE_MS);
    for (let k = 0; k < TALK_MAX_TURNS; k++) await oneTurn();
    await tick(10);
    expect(h.recordings[0].item.talk).toMatchObject({ end: "cap" });
    expect(h.said.at(-1)).toContain("またあとでききます");
    expect(h.logs).toHaveLength(TALK_MAX_TURNS - 1);
  });

  it("会話の道が無い端末は今までの声の問い（T49）", async () => {
    const h = harness(["ないです"], [], { talk: undefined });
    h.phone.red();
    await tick(IDLE_MS);
    expect(h.phone.state).toMatchObject({ step: "question", id: "injured" });
  });
});

describe("聞き続ける（T137b）", () => {
  it("読む間に本人が話し始めたら、声を止めて聞く。その言葉はその問いの答え", async () => {
    const line = aiLine("canMove", "じぶんで たてますか");
    const h = harness(["あしが いたい", null], [ask(line, true), "hang"], {}, { hangOn: "じぶんで たてますか" });
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(10);
    expect(h.phone.state).toMatchObject({ step: "talk", voice: "speaking", line: "じぶんで たてますか" });
    h.words("たてない、こしが いたい");
    await tick(10);
    expect(h.hushed).toBe(1);
    expect(h.phone.state).toMatchObject({ step: "talk", voice: "listening" });
    await tick(TALK_QUIET_MS + 10);
    expect(h.logs.at(-1)!.turns.at(-1)).toMatchObject({ ask: "じぶんで たてますか", reply: "たてない、こしが いたい", heard: "text" });
  });

  it("読んだ文の声を拾っても止めず、答えにしない（自分の問いの「ガスのにおい」を危ない言葉に取らない）", async () => {
    const h = harness(["あしが いたい", null], [ask(fixedLine("fireGas")), "hang"], {}, { hangOn: TALK_TOPIC_SPECS.fireGas.text });
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(10);
    expect(h.phone.state).toMatchObject({ step: "talk", voice: "speaking" });
    h.words("火やガスのにおいはしますか");
    await tick(10);
    expect(h.hushed).toBe(0);
    expect(h.phone.state).toMatchObject({ step: "talk", voice: "speaking" });
  });

  it("読んだ文の声のあとに本人の答えが続いても、答えだけを取る", async () => {
    const h = harness(["あしが いたい"], [ask(fixedLine("injured")), "hang"]);
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(10);
    // 問いの声の拾い（区切りが別）と本人の答え
    h.words("けがはありますか");
    h.words("はい");
    await tick(TALK_QUIET_MS + 10);
    const turn = h.logs.at(-1)!.turns.at(-1)!;
    expect(turn).toMatchObject({ reply: "はい", answer: { id: "injured", choice: "yes" } });
  });

  it("考える間に届いた言葉は前の答えに足し、次の手を決め直す（1 回まで）", async () => {
    const h = harness(["あしが"], [ask(fixedLine("injured")), ask(fixedLine("canMove"))], {}, { talkDelay: 2_000 });
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    // 考えている間（サーバーを待つ間）に続きを話した
    h.words("いたくて たてない");
    await tick(2_000 + 10);
    expect(h.logs).toHaveLength(2);
    expect(h.logs[1].turns.at(-1)!.reply).toBe("あしが\nいたくて たてない");
    await tick(2_000 + 10);
    expect(h.said.at(-1)).toBe(TALK_TOPIC_SPECS.canMove.text);
  });

  it("次の 1 文が遅いときは、作り置きの相づちを先に流す（本人が話したあとは「わかりました」、黙ったあとは「しょうしょう…」）", async () => {
    const h = harness(["あしが いたい", null], [ask(fixedLine("injured")), ask(fixedLine("canMove"))], {}, { talkDelay: 4_000 });
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(TALK_FILLER_MS + 10);
    expect(h.said.at(-1)).toBe(fillerText("heard"));
    expect(h.voices.at(-1)).toBe("/api/signals/voice?fixed=filler-heard");
    await tick(4_000);
    expect(h.said.at(-1)).toBe(TALK_TOPIC_SPECS.injured.text);
    await tick(TALK_LISTEN_MS + TALK_FILLER_MS + 10);
    expect(h.said).toContain(fillerText("wait"));
  });
});

describe("画面（T137）", () => {
  const on = { green() {}, red() {}, where() {}, answer() {}, skip() {}, locate() {}, extend() {}, finish() {}, again() {}, yesNo() {} };
  const html = (state: PhoneState) => renderToStaticMarkup(createElement(PhoneView, { state, nowMs: T0, on }));

  it("会話: 最初は AI の告知と定型文、AI の文には AI の印、決まった文はやさしい日本語。いつも「AI が きいています」と 119 の 1 行。「送る」は無い（T137b）", () => {
    const first = html({ step: "talk", line: "x", easy: null, by: "fixed", first: true, voice: "listening" });
    expect(first).toContain('data-notice="ai"');
    expect(first).toContain("data-prompt");
    expect(first).toContain("data-emergency");
    const byAi = html({ step: "talk", line: "じぶんで たてますか", easy: null, by: "ai", first: false, voice: "listening" });
    expect(byAi).toContain('data-talk-line="ai"');
    expect(byAi).toContain(">AI<");
    const fixed = html({ step: "talk", line: "動けますか", easy: TALK_TOPIC_SPECS.canMove.easy, by: "fixed", first: false, voice: "speaking" });
    expect(fixed).toContain('data-talk-line="fixed"');
    expect(fixed).toContain("<ruby");
    for (const page of [first, byAi, fixed]) {
      expect(page).toContain('data-ai="listening"');
      expect(page).not.toContain('data-choice="send"');
    }
  });

  it("ボタンの答え方: はい（緑の面）・いいえ（赤の面）・とばす。締め", () => {
    const yn = html({ step: "yesno", id: "canMove", answers: {}, voice: null });
    expect(yn).toMatch(/phone-fill-ok[^"]*" data-press="overlay" data-choice="yes"/);
    expect(yn).toMatch(/phone-fill-urgent[^"]*" data-press="overlay" data-choice="no"/);
    expect(yn).toContain('data-choice="skip"');
    expect(yn).toContain("data-emergency");
    const closing = html({ step: "closing", easy: "すぐ ケアマネジャーに しらせます", danger: true });
    expect(closing).toContain('data-closing="danger"');
    expect(closing).toContain("data-emergency");
  });

  it("問いのカード（T137b）: 印のある答えは面そのものを塗って大きく、端の色の線は無い。印の無い答えは灰の枠", () => {
    const q = html({ step: "question", id: "injured", answers: {}, first: false, voice: null });
    expect(q).toMatch(/phone-fill-urgent[^"]*" data-press="overlay" data-choice="yes" data-tone="urgent"/);
    expect(q).toMatch(/phone-fill-ok[^"]*" data-press="overlay" data-choice="no" data-tone="ok"/);
    expect(q).toMatch(/phone-choice[^"]*" data-press="" data-choice="unknown"/);
    expect(q).toMatch(/flex-\[2\][^"]*" data-press="overlay" data-choice="yes"/);
    const bleeding = html({ step: "question", id: "bleeding", answers: {}, first: false, voice: null });
    expect(bleeding).toMatch(/phone-fill-check[^"]*" data-press="overlay" data-choice="yes"/);
  });
});
