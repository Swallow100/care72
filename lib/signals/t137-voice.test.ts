// 声の聞き取りの会話（docs/tasks/T137.md）の声。決まった文は id で頼まれ、文はサーバーの表から（端末から文を受けない）。
// AI の 1 文は会話の API の中で作り、3 秒で間に合わなければ端末の読み上げ。端末は声が鳴らなければ同じ文を読み上げる。
// Gemini と音の要素は偽物。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMERGENCY_TEXT } from "../forms/own-sheet.ts";
import { createPromptPlayer, LINE_START_MS, type AudioLike, type UtteranceLike } from "./media.ts";
import { closingVoice, fixedLine, TALK_TOPIC_SPECS, TALK_VOICE_PATH, talkVoicePath } from "./talk.ts";
import { readTalkReply } from "./talk-client.ts";
import { isTalkFixedId, talkFixedTexts, talkFixedVoice, talkLineVoice, talkTextHash, talkVoiceByHash, talkVoiceKey } from "./voice.ts";

const NO_KEY = { people: [], contacts: [], rules: [], secrets: [] };

class FakeBucket {
  objects = new Map<string, Uint8Array>();
  async put(key: string, value: Uint8Array) {
    this.objects.set(key, value);
    return null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { arrayBuffer: async () => o.buffer as ArrayBuffer } : null;
  }
}

const ctx = (seen: { inputs: string[] }, delayMs = 0) => ({
  env: {},
  usage: { reserve: async () => true, finish: async () => {}, countDay: async () => 0 },
  office: { id: "office-demo", kind: "demo" as const },
  tts: {
    interactions: {
      create: async (params: { input: string }) => {
        seen.inputs.push(params.input);
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return { output_audio: { data: btoa("RIFF"), mime_type: "audio/wav" } };
      },
    },
  },
});

describe("会話の声（サーバー）", () => {
  it("決まった文は id で頼む（話題の問い・ボタンの問い・締め）。知らない id は作らない。1 回作って置く", async () => {
    const texts = talkFixedTexts();
    expect(texts["topic-injured"]).toBe(TALK_TOPIC_SPECS.injured.text);
    expect(texts["close-grasped"].endsWith(EMERGENCY_TEXT)).toBe(true);
    expect(isTalkFixedId("close-danger")).toBe(true);
    expect(isTalkFixedId("close-anything")).toBe(false);
    expect(isTalkFixedId("../prompt")).toBe(false);
    const bucket = new FakeBucket();
    const seen = { inputs: [] as string[] };
    expect(await talkFixedVoice(bucket, "close-cap", ctx(seen))).not.toBeNull();
    expect(await talkFixedVoice(bucket, "close-cap", ctx(seen))).not.toBeNull();
    expect(seen.inputs).toHaveLength(1);
    expect(await talkFixedVoice(bucket, "nope", ctx(seen))).toBeNull();
    // 鍵が無ければ作らない
    expect(await talkFixedVoice(new FakeBucket(), "topic-injured", { ...ctx(seen), tts: undefined })).toBeNull();
  });

  it("AI の 1 文: 3 秒で間に合えば URL、間に合わなければ null で、作るのは続けて置く（次は置いた物）。GET は読むだけ", async () => {
    {
      const bucket = new FakeBucket();
      const seen = { inputs: [] as string[] };
      const kept: Promise<unknown>[] = [];
      const text = "じぶんで たてますか";
      const hash = await talkTextHash(text);
      expect(await talkLineVoice(bucket, text, ctx(seen, 10), NO_KEY, { keep: (p) => kept.push(p), waitMs: 1000 })).toBe(talkVoicePath(hash));
      expect(TALK_VOICE_PATH.test(talkVoicePath(hash))).toBe(true);
      expect(await talkVoiceByHash(bucket, hash)).not.toBeNull();

      const slowText = "そばに だれか いますか";
      expect(await talkLineVoice(bucket, slowText, ctx(seen, 200), NO_KEY, { keep: (p) => kept.push(p), waitMs: 20 })).toBeNull();
      await Promise.all(kept);
      expect(bucket.objects.has(talkVoiceKey(await talkTextHash(slowText)))).toBe(true);
      expect(await talkVoiceByHash(bucket, "not-a-hash")).toBeNull();
      // 置いた物は作り直さない
      expect(await talkLineVoice(bucket, text, ctx(seen, 10), NO_KEY)).toBe(talkVoicePath(hash));
      expect(seen.inputs).toEqual([text, slowText]);
    }
  });
});

describe("会話の声（端末）", () => {
  function player(behavior: "plays" | "fails" | "hangs") {
    const spoken: string[] = [];
    const audio: AudioLike & { srcs: string[] } = {
      srcs: [],
      _src: "",
      get src() {
        return (this as unknown as { _src: string })._src;
      },
      set src(v: string) {
        (this as unknown as { _src: string })._src = v;
        this.srcs.push(v);
      },
      muted: false,
      currentTime: 0,
      play() {
        if (behavior === "fails") return Promise.reject(new Error("no"));
        if (behavior === "hangs") return new Promise<void>(() => {});
        setTimeout(() => this.onended?.(), 100);
        return Promise.resolve();
      },
      pause() {},
      onended: null,
      onerror: null,
    } as never;
    class U implements UtteranceLike {
      lang = "";
      rate = 1;
      volume = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const synth = {
      speak: (u: UtteranceLike) => {
        spoken.push((u as U).text);
        setTimeout(() => u.onend?.(), 10);
      },
      cancel: () => {},
    };
    return { p: createPromptPlayer({ audio, voiceUrl: "/api/signals/voice", synth, Utterance: U }), audio, spoken };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("声の URL があれば鳴らす。鳴らない・鳴り始めない（4 秒）ときは同じ文を読み上げる。URL が無ければ読み上げ", async () => {
    const ok = player("plays");
    const r1 = ok.p.line("けがはありますか", fixedLine("injured").voice!);
    await vi.advanceTimersByTimeAsync(200);
    expect(await r1).toBe("audio");
    expect(ok.spoken).toEqual([]);
    // 定型文に戻すときは元の声に入れ替える
    const back = ok.p.play();
    await vi.advanceTimersByTimeAsync(200);
    await back;
    expect(ok.audio.srcs.at(-1)).toBe("/api/signals/voice");

    const bad = player("fails");
    const r2 = bad.p.line("けがはありますか", closingVoice("grasped"));
    await vi.advanceTimersByTimeAsync(50);
    expect(await r2).toBe("speech");
    expect(bad.spoken).toEqual(["けがはありますか"]);

    const slow = player("hangs");
    const r3 = slow.p.line("うごけますか", "/api/signals/voice?fixed=topic-canMove");
    await vi.advanceTimersByTimeAsync(LINE_START_MS + 50);
    expect(await r3).toBe("speech");

    const none = player("plays");
    const r4 = none.p.line("そばに だれか いますか", null);
    await vi.advanceTimersByTimeAsync(50);
    expect(await r4).toBe("speech");
  });

  it("サーバーの返事の確かめ: 声の URL は決まった形だけ受ける。長すぎる文・知らない値は捨てる", () => {
    const line = { text: "じぶんで たてますか", question: "じぶんで たてますか", easy: null, by: "ai", topic: "canMove" };
    expect(readTalkReply({ kind: "ask", called: true, line: { ...line, voice: "/api/signals/voice?talk=0123456789abcdef0123456789abcdef" } })).toMatchObject({
      kind: "ask",
      line: { voice: "/api/signals/voice?talk=0123456789abcdef0123456789abcdef" },
    });
    const other = readTalkReply({ kind: "ask", called: true, line: { ...line, voice: "https://example.com/x.wav" } });
    expect(other?.kind === "ask" && other.line.voice).toBeFalsy();
    expect(readTalkReply({ kind: "ask", called: true, line: { ...line, text: "あ".repeat(81) } })).toBeNull();
    expect(readTalkReply({ kind: "ask", called: true, line: { ...line, topic: "weather" } })).toBeNull();
    expect(readTalkReply({ kind: "close", end: "grasped", called: true })).toEqual({ kind: "close", end: "grasped", called: true });
    expect(readTalkReply({ kind: "danger", danger: "fire" })).toEqual({ kind: "danger", danger: "fire", called: false });
    expect(readTalkReply({ kind: "boom" })).toBeNull();
  });
});
