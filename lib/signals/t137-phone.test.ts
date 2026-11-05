// 本人のスマホの声の聞き取りの会話（docs/tasks/T137.md）の流れ。マイク・読み上げ・文字起こし・サーバーは偽物（偽の時計）。
// 20 秒押さない → 定型文（AI の告知から）→ 聞く → 次の手（サーバー）→ 読む … → 締め（119 の文で終わる）→ 録音と会話の記録を送る。
// 聞き取れないが続く → ボタンの答え方（はい・いいえ・とばす）と応答不明瞭の印。危ない言葉は決まった文で締める。サーバーに届かないときは決まった問い。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhoneView } from "../../components/phone/PhoneView.tsx";
import { EMERGENCY_TEXT } from "../forms/own-sheet.ts";
import type { SignalBody } from "./body.ts";
import type { AttachItem } from "./outbox.ts";
import { createPhone, IDLE_MS, TALK_LISTEN_MS, TALK_QUIET_MS, TALK_WAIT_MS, type PhoneDeps, type PhoneState } from "./phone.ts";
import type { Answers } from "./questions.ts";
import { fixedLine, TALK_MAX_TURNS, TALK_TOPIC_SPECS, type TalkLine, type TalkLog } from "./talk.ts";
import type { TalkReply } from "./talk-ai.ts";

const T0 = Date.parse("2026-11-04T01:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** 1 往復ごとの本人の言葉。文字があれば 1 秒後に文字が届き、無ければ 1 秒後に無音で止まる */
function talkTranscripts(texts: Array<string | null>) {
  let n = 0;
  const start: NonNullable<PhoneDeps["startTranscript"]> = (events) => {
    const text = texts[n++] ?? null;
    setTimeout(() => (text ? events.onText?.(text) : events.onSilence?.()), 1000);
    return { stop: async () => text };
  };
  return { start, count: () => n };
}

type H = {
  phone: ReturnType<typeof createPhone>;
  states: PhoneState[];
  said: string[];
  logs: TalkLog[];
  recordings: Array<{ item: AttachItem; audio: Blob | null }>;
  answers: Answers[];
  recLog: string[];
  signals: SignalBody[];
};

function harness(texts: Array<string | null>, replies: Array<TalkReply | null | "hang">, over: Partial<PhoneDeps> = {}): H {
  const h: H = { states: [], said: [], logs: [], recordings: [], answers: [], recLog: [], signals: [] } as unknown as H;
  const tr = talkTranscripts(texts);
  let i = 0;
  let id = 0;
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
    },
    speak: async (text) => {
      h.said.push(text);
    },
    startRecording: async () => rec,
    startTranscript: tr.start,
    talk: async (_signalId, log) => {
      h.logs.push(log);
      const r = replies[i++];
      if (r === "hang") return new Promise<TalkReply | null>(() => {});
      return r ?? null;
    },
    onChange: (s) => h.states.push(s),
    ...over,
  });
  return h;
}

const ask = (line: TalkLine, called = false): TalkReply => ({ kind: "ask", line, called });
const aiLine = (topic: TalkLine["topic"], text: string): TalkLine => ({ text, question: text, easy: null, by: "ai", topic });

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
    expect(sent.talk!.closing!.endsWith(EMERGENCY_TEXT)).toBe(true);
    // 録音は 1 本で、読む間は止める
    expect(h.recLog.filter((x) => x === "stop")).toEqual(["stop"]);
    expect(h.recLog.filter((x) => x === "pause").length).toBeGreaterThanOrEqual(4);
    // サーバーには毎回それまでの全部
    expect(h.logs.map((l) => l.turns.length)).toEqual([1, 2, 3, 4]);
  });

  it("うめき声 → 黙る: ボタンの答え方へ（応答不明瞭の印）。はい・いいえ・押さない・とばす で答え、締めて送る", async () => {
    const h = harness(["うー…", null], [ask(fixedLine("injured"))]);
    h.phone.red();
    await tick(IDLE_MS);
    await oneTurn();
    await tick(1000 + 10);
    expect(h.phone.state).toMatchObject({ step: "yesno", id: "injured" });
    expect(h.logs).toHaveLength(1);
    expect(h.said.at(-1)).toBe("けがはありますか。はいならみどり、いいえならあかをおしてください");
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

  it("サーバーに届かない・遅い（8 秒）: 端末だけで決まった問いを続ける", async () => {
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

  it("話さなければ 15 秒で 1 往復を閉じる。「送る」で締めて送る", async () => {
    const h = harness(["もしもし", "あの、ええと、うちの ねこが"], [ask(fixedLine("injured"))], {
      // 文字が届かないまま 15 秒待つ端末（無音の知らせが無い）
      startTranscript: (() => {
        let n = 0;
        return () => {
          const text = ["もしもし", "あの、ええと、うちの ねこが"][n++] ?? null;
          return { stop: async () => text };
        };
      })(),
    });
    h.phone.red();
    await tick(IDLE_MS);
    await tick(TALK_LISTEN_MS + 10);
    expect(h.said.at(-1)).toBe(TALK_TOPIC_SPECS.injured.text);
    h.phone.finish();
    await tick(10);
    expect(h.phone.state).toMatchObject({ step: "done" });
    const talk = h.recordings[0].item.talk!;
    expect(talk.end).toBe("send");
    // 送る前に聞いていた分も記録に入る
    expect(talk.turns.map((t) => t.reply)).toEqual(["もしもし", "あの、ええと、うちの ねこが"]);
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
    expect(h.phone.state).toMatchObject({ step: "question", id: "injured", voice: "listening" });
  });
});

describe("画面（T137）", () => {
  const on = { green() {}, red() {}, where() {}, answer() {}, skip() {}, locate() {}, extend() {}, finish() {}, again() {}, yesNo() {} };
  const html = (state: PhoneState) => renderToStaticMarkup(createElement(PhoneView, { state, nowMs: T0, on }));

  it("会話: 最初は AI の告知と定型文、AI の文には AI の印、決まった文はやさしい日本語。送るボタンと 119 の 1 行", () => {
    const first = html({ step: "talk", line: "x", easy: null, by: "fixed", first: true, voice: "listening" });
    expect(first).toContain('data-notice="ai"');
    expect(first).toContain("data-prompt");
    expect(first).toContain('data-emergency');
    const byAi = html({ step: "talk", line: "じぶんで たてますか", easy: null, by: "ai", first: false, voice: "listening" });
    expect(byAi).toContain('data-talk-line="ai"');
    expect(byAi).toContain(">AI<");
    expect(byAi).toContain('data-choice="send"');
    const fixed = html({ step: "talk", line: "動けますか", easy: TALK_TOPIC_SPECS.canMove.easy, by: "fixed", first: false, voice: "speaking" });
    expect(fixed).toContain('data-talk-line="fixed"');
    expect(fixed).toContain("<ruby");
    expect(fixed).not.toContain('data-ai="listening"');
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
});
