// 本人のスマホの流れ（docs/tasks/T10.md）: 緑は 1 問、赤は押した時に送って 1 画面 1 問（T49、押すたびに答えを送る）、
// 20 秒押さないと声の問い（読み上げのある端末）か定型文 → 30 秒録る → 送る、
// 延長、送ったあとは数えない。通信が無いときは端末に残して戻ったら送る。録音・定型文・文字起こしは偽物で差し替える。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechRecognitionLike } from "../speech/dictation.ts";
import type { SignalBody } from "./body.ts";
import {
  createPromptPlayer,
  pickAudioType,
  primeMicrophone,
  startRecording,
  startTranscript,
  type AudioLike,
  type RecorderLike,
  type StreamLike,
  type UtteranceLike,
} from "./media.ts";
import { createOutbox, OUTBOX_KEY, outcomeOf, readOutbox, type AttachItem, type SendOutcome, type StorageLike } from "./outbox.ts";
import {
  createPhone,
  IDLE_MS,
  LISTEN_MS,
  MAX_RECORD_MS,
  PROMPT_WAIT_MS,
  RECORD_MS,
  type PhoneDeps,
  type PhoneState,
} from "./phone.ts";
import type { Answers } from "./questions.ts";
import { VOICE_PROMPT_TEXT } from "./phrases.ts";

const T0 = Date.parse("2026-11-04T01:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

/** 待っている約束を流す（偽の時計は進めない） */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// ---------- 流れ ----------

type Harness = {
  phone: ReturnType<typeof createPhone>;
  states: PhoneState[];
  signals: SignalBody[];
  recordings: Array<{ item: AttachItem; audio: Blob | null }>;
  /** 送った答え（押すたびに、それまでの全部） */
  answers: Array<{ signalId: string; answers: Answers }>;
  calls: string[];
};

function harness(over: Partial<PhoneDeps> = {}): Harness {
  const h = { states: [], signals: [], recordings: [], answers: [], calls: [] } as unknown as Harness;
  let n = 0;
  h.phone = createPhone({
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    sendSignal: async (b) => {
      h.signals.push(b);
      return "sent";
    },
    sendRecording: async (item, audio) => {
      h.recordings.push({ item, audio });
      return "sent";
    },
    sendAnswers: async (item) => {
      h.answers.push(item);
      return "sent";
    },
    prime: () => h.calls.push("prime"),
    playPrompt: async () => {
      h.calls.push("prompt");
    },
    startRecording: async () => {
      h.calls.push("record");
      return { stop: async () => new Blob([new Uint8Array([9])], { type: "audio/webm" }) };
    },
    startTranscript: () => {
      h.calls.push("transcript");
      return { stop: async () => "あしが いたい" };
    },
    onChange: (s) => h.states.push(s),
    ...over,
  });
  return h;
}

const steps = (h: Harness) =>
  h.states.map((s) => (s.step === "question" ? `q:${s.id}${s.voice ? `:${s.voice}` : ""}` : s.step));

/** 問いを全部とばして終わりまで */
const skipAll = (h: Harness) => {
  for (let i = 0; i < 30 && h.phone.state.step === "question"; i++) h.phone.skip();
};

describe("画面の流れ", () => {
  it("緑 → どこに いますか（家）→ 送る → とどきました。音声は無い", async () => {
    const h = harness();
    h.phone.green();
    expect(h.phone.state).toEqual({ step: "where" });
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(h.phone.state).toEqual({ step: "where" });
    h.phone.where("home");
    await flush();
    expect(steps(h)).toEqual(["where", "sending", "done"]);
    expect(h.phone.state).toEqual({ step: "done", color: "green", delivery: "sent" });
    expect(h.signals).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        color: "green",
        whereNow: "home",
        answers: { injured: null, atHome: null, canMove: null, hasMedicine: null },
        occurredAt: "2026-11-04T01:00:00.000Z",
        sentAt: "2026-11-04T01:00:00.000Z",
      },
    ]);
    expect(h.calls).toEqual([]);
  });

  it("赤 → 押した時に信号 → 1 画面 1 問を枝で → 押すたびにそれまでの答えを送る → とどきました。20 秒以内に押し続ければ声に替わらない", async () => {
    const h = harness();
    h.phone.red();
    expect(h.calls).toEqual(["prime"]);
    // 赤は押した時に送る（答えはまだ無い）
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0]).toMatchObject({ color: "red", whereNow: null, answers: { injured: null, atHome: null, canMove: null, hasMedicine: null } });
    const path = [
      ["injured", "yes"],
      ["injuryPart", "leg"],
      ["bleeding", "no"],
      ["atHome", "yes"],
      ["floor", "f1"],
      ["room", "kitchen"],
      ["canMove", "no"],
      ["exit", "no"],
      ["trappedBy", "furniture"],
      ["body", "chest"],
      ["water", "none"],
      ["fireGas", "no"],
      ["hasMedicine", "yes"],
      ["nearby", "alone"],
      ["contact", "phone"],
      ["request", "none"],
    ] as const;
    for (const [q, c] of path) {
      vi.advanceTimersByTime(IDLE_MS - 1);
      expect(h.phone.state).toMatchObject({ step: "question", id: q, voice: null });
      h.phone.answer(c);
    }
    await flush();
    vi.advanceTimersByTime(IDLE_MS * 2);
    await flush();
    expect(steps(h)).toEqual([...path.map(([q]) => `q:${q}`), "sending", "done"]);
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    // 押すたびに送り、どれも同じ信号へ。最後はそれまでの全部
    expect(h.answers).toHaveLength(path.length);
    expect(h.answers.every((a) => a.signalId === h.signals[0].id)).toBe(true);
    expect(h.answers[0].answers).toEqual({ injured: { choice: "yes", via: "press" } });
    expect(Object.keys(h.answers.at(-1)!.answers)).toEqual(path.map(([q]) => q));
    expect(h.signals).toHaveLength(1);
    expect(h.calls).toEqual(["prime"]);
  });

  it("とばす: 答えを送らずに問いの次へ。どこで止めても答えた所までは届いている。台帳に機器がある人だけ機器の問い", async () => {
    const h = harness();
    h.phone.red();
    h.phone.answer("no");
    h.phone.skip();
    expect(h.phone.state).toMatchObject({ step: "question", id: "canMove" });
    expect(h.answers).toHaveLength(1);
    skipAll(h);
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(steps(h)).not.toContain("q:device");

    const d = harness({ hasDevice: true });
    d.phone.red();
    skipAll(d);
    expect(steps(d)).toContain("q:device");
    // 知らない選択肢は受けない
    const e = harness();
    e.phone.red();
    e.phone.answer("severe");
    expect(e.phone.state).toMatchObject({ step: "question", id: "injured" });
    expect(e.answers).toEqual([]);
  });

  it("頼みたい ことを「はなす」: 定型文 → 30 秒録る（声の問いでなくても）", async () => {
    const h = harness();
    h.phone.red();
    for (let i = 0; i < 30 && h.phone.state.step === "question" && (h.phone.state as { id: string }).id !== "request"; i++) h.phone.skip();
    h.phone.answer("speak");
    await flush();
    expect(h.phone.state.step).toBe("recording");
    expect(h.calls).toEqual(["prime", "prompt", "record", "transcript"]);
  });

  it("赤 →「けがは ありますか」で 20 秒押さない → 信号を先に送る → 定型文 → 30 秒録る → 録音を添えて とどきました", async () => {
    const h = harness();
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(h.phone.state.step).toBe("question");
    vi.advanceTimersByTime(1);
    await flush();
    // 録り終わるのを待たずに赤を送る（答えていないので全部 null）
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0]).toMatchObject({ color: "red", answers: { injured: null, atHome: null, canMove: null, hasMedicine: null } });
    expect(h.calls).toEqual(["prime", "prompt", "record", "transcript"]);
    expect(h.phone.state).toEqual({ step: "recording", startedAt: T0 + IDLE_MS, until: T0 + IDLE_MS + RECORD_MS });

    vi.advanceTimersByTime(RECORD_MS - 1);
    expect(h.phone.state.step).toBe("recording");
    vi.advanceTimersByTime(1);
    await flush();
    expect(steps(h)).toEqual(["q:injured", "prompt", "recording", "sending", "done"]);
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.recordings).toHaveLength(1);
    expect(h.recordings[0].item).toEqual({
      signalId: h.signals[0].id,
      transcript: "あしが いたい",
      durationSec: 30,
      recordedAt: new Date(T0 + IDLE_MS + RECORD_MS).toISOString(),
    });
    expect(h.recordings[0].audio?.type).toBe("audio/webm");
    expect(h.signals).toHaveLength(1);
  });

  it("2 問答えたあとに 20 秒押さない: 答えた 2 つはもう届いていて、音声へ（20 秒は最後に答えた時から）", async () => {
    const h = harness();
    h.phone.red();
    vi.advanceTimersByTime(15_000);
    h.phone.answer("no");
    vi.advanceTimersByTime(15_000);
    h.phone.answer("yes");
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(h.phone.state).toMatchObject({ step: "question", id: "floor" });
    vi.advanceTimersByTime(1);
    await flush();
    expect(h.answers.at(-1)!.answers).toEqual({ injured: { choice: "no", via: "press" }, atHome: { choice: "yes", via: "press" } });
    expect(h.phone.state.step).toBe("recording");
  });

  it("延長は押すたびに 30 秒、上限 120 秒。「送る」で早く止める", async () => {
    const h = harness();
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    const start = T0 + IDLE_MS;
    h.phone.extend();
    expect(h.phone.state).toMatchObject({ step: "recording", until: start + 2 * RECORD_MS });
    for (let i = 0; i < 5; i++) h.phone.extend();
    expect(h.phone.state).toMatchObject({ step: "recording", until: start + MAX_RECORD_MS });
    vi.advanceTimersByTime(40_000);
    expect(h.phone.state.step).toBe("recording");
    h.phone.finish();
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.recordings[0].item.durationSec).toBe(40);
  });

  it("送ったあとは数えない（もう音声に替わらない）。「もう 一度」で上へ", async () => {
    const h = harness();
    h.phone.red();
    skipAll(h);
    await flush();
    vi.advanceTimersByTime(IDLE_MS * 5);
    await flush();
    expect(h.calls).toEqual(["prime"]);
    expect(h.phone.state.step).toBe("done");
    h.phone.again();
    expect(h.phone.state).toEqual({ step: "top" });
    // 上では押していないボタンの操作を受けない
    h.phone.answer("yes");
    h.phone.where("home");
    expect(h.phone.state).toEqual({ step: "top" });
  });

  it("マイクも文字起こしも使えない: 録らずに、送った赤だけで とどきました", async () => {
    const h = harness({ startRecording: async () => null, startTranscript: () => null });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(steps(h)).toEqual(["q:injured", "prompt", "sending", "done"]);
    expect(h.signals).toHaveLength(1);
    expect(h.recordings).toEqual([]);
  });

  it("定型文が終わらなくても 15 秒で録り始める", async () => {
    const h = harness({ playPrompt: () => new Promise(() => {}) });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(h.phone.state.step).toBe("prompt");
    vi.advanceTimersByTime(PROMPT_WAIT_MS);
    await flush();
    expect(h.phone.state.step).toBe("recording");
  });

  it("通信が無い: 信号が端末に残ったら「まだ とどいて いません」（queued）", async () => {
    const h = harness({ sendSignal: async () => "queued" });
    h.phone.green();
    h.phone.where("shelter");
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "green", delivery: "queued" });
  });

  it("画面を閉じたら数えるのをやめ、録っていれば止める（送らない）", async () => {
    const stopped: string[] = [];
    const h = harness({
      startRecording: async () => ({
        stop: async () => {
          stopped.push("rec");
          return null;
        },
      }),
    });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    h.phone.dispose();
    vi.advanceTimersByTime(MAX_RECORD_MS);
    await flush();
    expect(stopped).toEqual(["rec"]);
    expect(h.recordings).toEqual([]);
    expect(h.phone.state.step).toBe("recording");
  });
});

// ---------- 無音のまま止まったら聞き直す（T37） ----------

/** 文字起こしの偽物: 回ごとに返す文字（null は無音）。silenceAfter を渡すと、その時間で無音の知らせを出す */
function transcripts(texts: Array<string | null>, opts: { silenceAfter?: number } = {}) {
  const log: string[] = [];
  let n = 0;
  const start: NonNullable<PhoneDeps["startTranscript"]> = (events) => {
    const i = n++;
    log.push(`transcript${i + 1}`);
    if (opts.silenceAfter !== undefined && texts[i] == null) setTimeout(() => events.onSilence(), opts.silenceAfter);
    return {
      stop: async () => {
        log.push(`stop${i + 1}`);
        return texts[i] ?? null;
      },
    };
  };
  return { start, log };
}

/** 録音の偽物（止める・再開を数える） */
function pausingRecorder() {
  const log: string[] = [];
  const rec = {
    pause: () => log.push("pause"),
    resume: () => log.push("resume"),
    stop: async () => {
      log.push("stop");
      return new Blob([new Uint8Array([7])], { type: "audio/webm" });
    },
  };
  return { log, startRecording: async () => rec };
}

describe("無音のまま止まったら、同じ定型文で 2 回まで聞き直す（T37）", () => {
  it("30 秒 無音 → 定型文 → 無音 → 定型文 → 無音: 録音を 1 本送って「ろくおんを おくりました」", async () => {
    const tr = transcripts([null, null, null]);
    const rec = pausingRecorder();
    const h = harness({ startTranscript: tr.start, startRecording: rec.startRecording });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(h.phone.state.step).toBe("recording");
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(RECORD_MS);
      await flush();
    }
    expect(h.phone.state.step).toBe("recording");
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(steps(h)).toEqual(["q:injured", "prompt", "recording", "prompt", "recording", "prompt", "recording", "sending", "done"]);
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent", silent: true });
    // 定型文は初めの 1 回と聞き直しの 2 回。録音は 1 本のまま、定型文の間だけ止める
    expect(h.calls.filter((c) => c === "prompt")).toHaveLength(3);
    expect(rec.log).toEqual(["pause", "resume", "pause", "resume", "stop"]);
    expect(tr.log).toEqual(["transcript1", "stop1", "transcript2", "stop2", "transcript3", "stop3"]);
    expect(h.signals).toHaveLength(1);
    expect(h.recordings).toHaveLength(1);
    expect(h.recordings[0].item).toMatchObject({ signalId: h.signals[0].id, transcript: null, durationSec: 90 });
    expect(h.recordings[0].audio?.size).toBe(1);
  });

  it("ブラウザが無音で止めた（no-speech）ら 30 秒を待たずに聞き直す", async () => {
    const tr = transcripts([null, null, null], { silenceAfter: 8_000 });
    const h = harness({ startTranscript: tr.start });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    vi.advanceTimersByTime(8_000);
    await flush();
    expect(tr.log).toEqual(["transcript1", "stop1", "transcript2"]);
    expect(h.phone.state).toMatchObject({ step: "recording", until: T0 + IDLE_MS + 8_000 + RECORD_MS });
    vi.advanceTimersByTime(8_000);
    await flush();
    vi.advanceTimersByTime(8_000);
    await flush();
    expect(h.phone.state).toMatchObject({ step: "done", silent: true });
    expect(h.recordings[0].item).toMatchObject({ transcript: null, durationSec: 24 });
  });

  it("2 回目で話せたら、その文字を添えて「とどきました」", async () => {
    const tr = transcripts([null, "あしが いたい"]);
    const h = harness({ startTranscript: tr.start });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(h.phone.state.step).toBe("recording");
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.calls.filter((c) => c === "prompt")).toHaveLength(2);
    expect(h.recordings[0].item).toMatchObject({ transcript: "あしが いたい", durationSec: 60 });
  });

  it("話せた回は聞き直さない（1 回目で話せば今まで通り 30 秒で送る）", async () => {
    const tr = transcripts(["たすけて"]);
    const h = harness({ startTranscript: tr.start });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.calls.filter((c) => c === "prompt")).toHaveLength(1);
    expect(h.recordings[0].item.transcript).toBe("たすけて");
  });

  it("「送る」を押したら聞き直さない（無音でも録音を送る）", async () => {
    const tr = transcripts([null]);
    const h = harness({ startTranscript: tr.start });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    vi.advanceTimersByTime(5_000);
    h.phone.finish();
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent", silent: true });
    expect(h.calls.filter((c) => c === "prompt")).toHaveLength(1);
    expect(h.recordings[0].item).toMatchObject({ transcript: null, durationSec: 5 });
  });

  it("文字起こしの無い端末は無音が分からないので聞き直さない（今まで通り 30 秒で送って「とどきました」）", async () => {
    const h = harness({ startTranscript: () => null });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(steps(h)).toEqual(["q:injured", "prompt", "recording", "sending", "done"]);
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.recordings[0].item).toMatchObject({ transcript: null, durationSec: 30 });
  });

  it("録音の無い端末で無音のまま: 送る物が無いので「とどきました」（赤はもう届いている）", async () => {
    const tr = transcripts([null, null, null]);
    const h = harness({ startTranscript: tr.start, startRecording: async () => null });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(RECORD_MS);
      await flush();
    }
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.recordings).toEqual([]);
  });

  it("聞き直しの定型文の間に閉じたら、続きを録らない", async () => {
    const tr = transcripts([null, null, null]);
    const h = harness({ startTranscript: tr.start, playPrompt: () => new Promise(() => {}) });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS + PROMPT_WAIT_MS);
    await flush();
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(h.phone.state.step).toBe("prompt");
    h.phone.dispose();
    vi.advanceTimersByTime(PROMPT_WAIT_MS + RECORD_MS * 3);
    await flush();
    expect(tr.log).toEqual(["transcript1", "stop1"]);
    expect(h.recordings).toEqual([]);
  });
});

// ---------- 端末に残して送り直す ----------

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const body = (n: number, color: "red" | "green" = "red"): SignalBody => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  color,
  whereNow: color === "green" ? "home" : null,
  answers: { injured: null, atHome: null, canMove: null, hasMedicine: null },
  occurredAt: "2026-11-04T01:00:00.000Z",
  sentAt: "2026-11-04T01:00:00.000Z",
});

function transport(outcome: () => SendOutcome | "throw") {
  const sent: Array<{ kind: string; id: string; sentAt: string; audio?: boolean; transcript?: string | null }> = [];
  return {
    sent,
    t: {
      async signal(b: SignalBody) {
        const o = outcome();
        if (o === "throw") throw new TypeError("Failed to fetch");
        if (o === "ok") sent.push({ kind: "signal", id: b.id, sentAt: b.sentAt });
        return o;
      },
      async attach(item: AttachItem & { sentAt: string }, audio: Blob | null) {
        const o = outcome();
        if (o === "throw") throw new TypeError("Failed to fetch");
        if (o === "ok") sent.push({ kind: "attach", id: item.signalId, sentAt: item.sentAt, audio: audio !== null, transcript: item.transcript });
        return o;
      },
      async answers(item: { signalId: string; answers: Answers }) {
        const o = outcome();
        if (o === "throw") throw new TypeError("Failed to fetch");
        if (o === "ok") sent.push({ kind: `answers:${Object.keys(item.answers).join(",")}`, id: item.signalId, sentAt: "" });
        return o;
      },
    },
  };
}

describe("通信が無いとき（端末に残して、戻ったら送る）", () => {
  it("つながっていれば送って消す", async () => {
    const storage = new MemoryStorage();
    const { t, sent } = transport(() => "ok");
    const box = createOutbox({ storage, owner: "self:p-01", transport: t });
    expect(await box.sendSignal(body(1))).toBe("sent");
    expect(sent.map((s) => s.kind)).toEqual(["signal"]);
    expect(storage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it("送れない（通信の失敗）: 端末に残す。戻ったら 1 回だけ送る。送った時刻はそのときの今", async () => {
    const storage = new MemoryStorage();
    let online = false;
    const { t, sent } = transport(() => (online ? "ok" : "throw"));
    const box = createOutbox({ storage, owner: "self:p-01", transport: t });
    expect(await box.sendSignal(body(1))).toBe("queued");
    expect(readOutbox(storage)).toEqual([{ kind: "signal", owner: "self:p-01", body: body(1) }]);
    expect(box.pending()).toBe(1);

    vi.setSystemTime(T0 + 600_000);
    online = true;
    await Promise.all([box.flush(), box.flush()]);
    expect(sent).toEqual([{ kind: "signal", id: body(1).id, sentAt: new Date(T0 + 600_000).toISOString() }]);
    expect(box.pending()).toBe(0);
    expect(storage.getItem(OUTBOX_KEY)).toBeNull();
    await box.flush();
    expect(sent).toHaveLength(1);
  });

  it("画面を開き直しても、端末に残った物を送る（同じ id なのでサーバーで重ならない）", async () => {
    const storage = new MemoryStorage();
    const off = transport(() => "throw");
    await createOutbox({ storage, owner: "self:p-01", transport: off.t }).sendSignal(body(1));
    const on = transport(() => "ok");
    const box = createOutbox({ storage, owner: "self:p-01", transport: on.t });
    expect(box.pending()).toBe(1);
    await box.flush();
    expect(on.sent.map((s) => s.id)).toEqual([body(1).id]);
  });

  it("録音は信号のあと。信号が残っている間は録音も残し、戻ったら信号 → 録音の順に送る", async () => {
    const storage = new MemoryStorage();
    let online = false;
    const { t, sent } = transport(() => (online ? "ok" : "throw"));
    const box = createOutbox({ storage, owner: "self:p-01", transport: t });
    await box.sendSignal(body(1));
    const audio = new Blob([new Uint8Array([1])], { type: "audio/webm" });
    const attach = { signalId: body(1).id, transcript: "たすけて", durationSec: 30, recordedAt: "2026-11-04T01:01:00.000Z" };
    expect(await box.sendRecording(attach, audio)).toBe("queued");
    // 音声は端末に書かない（文字起こしは書く）
    expect(storage.getItem(OUTBOX_KEY)).not.toContain("blob");
    expect(readOutbox(storage).map((x) => x.kind)).toEqual(["signal", "attach"]);
    online = true;
    await box.flush();
    expect(sent.map((s) => `${s.kind}:${s.audio ?? ""}`)).toEqual(["signal:", "attach:true"]);
    expect(box.pending()).toBe(0);
  });

  it("画面を閉じて開き直すと音声は消え、文字起こしだけ送る。文字起こしも無ければ捨てる", async () => {
    const storage = new MemoryStorage();
    const off = transport(() => "throw");
    const first = createOutbox({ storage, owner: "self:p-01", transport: off.t });
    await first.sendSignal(body(1));
    await first.sendRecording({ signalId: body(1).id, transcript: "いたい", durationSec: 30, recordedAt: "x" }, new Blob(["a"]));
    await first.sendSignal(body(2));
    await first.sendRecording({ signalId: body(2).id, transcript: null, durationSec: 30, recordedAt: "x" }, new Blob(["a"]));
    const on = transport(() => "ok");
    const box = createOutbox({ storage, owner: "self:p-01", transport: on.t });
    await box.flush();
    expect(on.sent.map((s) => `${s.kind}:${s.id.slice(-1)}:${s.audio ?? ""}:${s.transcript ?? ""}`)).toEqual([
      "signal:1::",
      "attach:1:false:いたい",
      "signal:2::",
    ]);
    expect(box.pending()).toBe(0);
  });

  it("送り直しても通らない応答（平時の 409 など）は捨てる。前が送れない間は後ろを送らない", async () => {
    const storage = new MemoryStorage();
    const outcomes: Array<SendOutcome | "throw"> = ["throw", "drop", "ok"];
    const { t, sent } = transport(() => outcomes.shift() ?? "ok");
    const box = createOutbox({ storage, owner: "self:p-01", transport: t });
    expect(await box.sendSignal(body(1))).toBe("queued");
    // 2 つ目を足すと、前の 1 つ目から順に送る（1 つ目は捨て、2 つ目は届く）
    expect(await box.sendSignal(body(2))).toBe("sent");
    expect(sent.map((s) => s.id)).toEqual([body(2).id]);
    expect(box.pending()).toBe(0);
    expect(outcomeOf(409)).toBe("drop");
    expect(outcomeOf(400)).toBe("drop");
    expect(outcomeOf(403)).toBe("drop");
    expect(outcomeOf(503)).toBe("retry");
    expect(outcomeOf(401)).toBe("retry");
    expect(outcomeOf(200)).toBe("ok");
  });

  it("同じ端末のほかの人の物・同じ本人でもほかの役（家族）の物は送らず、消さない", async () => {
    const storage = new MemoryStorage();
    await createOutbox({ storage, owner: "self:p-02", transport: transport(() => "throw").t }).sendSignal(body(9));
    await createOutbox({ storage, owner: "family:p-01", transport: transport(() => "throw").t }).sendSignal(body(8));
    const { t, sent } = transport(() => "ok");
    const box = createOutbox({ storage, owner: "self:p-01", transport: t });
    expect(box.pending()).toBe(0);
    await box.sendSignal(body(1));
    expect(sent.map((s) => s.id)).toEqual([body(1).id]);
    expect(readOutbox(storage).map((x) => x.owner)).toEqual(["self:p-02", "family:p-01"]);
  });

  it("端末に書けない（プライベートの窓など）ときも、開いている間は覚えて送り直す", async () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    let online = false;
    const { t, sent } = transport(() => (online ? "ok" : "throw"));
    const box = createOutbox({ storage: broken, owner: "self:p-01", transport: t });
    expect(await box.sendSignal(body(1))).toBe("queued");
    online = true;
    await box.flush();
    expect(sent.map((s) => s.id)).toEqual([body(1).id]);
  });
});

// ---------- 音（偽物） ----------

class FakeAudio implements AudioLike {
  src = "";
  muted = false;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  plays: boolean[] = [];
  constructor(private ok: boolean) {}
  play() {
    this.plays.push(this.muted);
    if (!this.ok) return Promise.reject(new Error("NotSupportedError"));
    if (!this.muted) setTimeout(() => this.onended?.(), 3000);
    return Promise.resolve();
  }
  pause() {}
}

class FakeUtterance implements UtteranceLike {
  lang = "";
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth() {
  const spoken: FakeUtterance[] = [];
  return {
    spoken,
    speak(u: UtteranceLike) {
      spoken.push(u as FakeUtterance);
      setTimeout(() => u.onend?.(), 2000);
    },
    cancel() {},
  };
}

describe("定型文を流す", () => {
  it("Gemini の声がある: 押した時に音を出さずに読み込み、20 秒あとに流して終わるのを待つ", async () => {
    const audio = new FakeAudio(true);
    const synth = fakeSynth();
    const player = createPromptPlayer({ audio, voiceUrl: "/api/signals/voice", synth, Utterance: FakeUtterance });
    player.prime();
    expect(audio.src).toBe("/api/signals/voice");
    expect(audio.plays).toEqual([true]);
    await flush();
    const p = player.play();
    await flush();
    vi.advanceTimersByTime(3000);
    expect(await p).toBe("audio");
    expect(audio.plays).toEqual([true, false]);
    // speechSynthesis は押した時の音量 0 の 1 回だけ
    expect(synth.spoken.map((u) => [u.text, u.volume])).toEqual([[" ", 0]]);
  });

  it("Gemini の声が無い（鍵なしの 404）: ブラウザの speechSynthesis で同じ文を日本語で読む", async () => {
    const audio = new FakeAudio(false);
    const synth = fakeSynth();
    const player = createPromptPlayer({ audio, voiceUrl: "/api/signals/voice", synth, Utterance: FakeUtterance });
    player.prime();
    await flush();
    const p = player.play();
    await flush();
    vi.advanceTimersByTime(2000);
    expect(await p).toBe("speech");
    const last = synth.spoken.at(-1)!;
    expect([last.text, last.lang, last.volume]).toEqual([VOICE_PROMPT_TEXT, "ja-JP", 1]);
  });

  it("どちらも無ければ none（録音へ進む）", async () => {
    const player = createPromptPlayer({ audio: null, voiceUrl: "", synth: null, Utterance: null });
    player.prime();
    expect(await player.play()).toBe("none");
  });
});

class FakeRecorder implements RecorderLike {
  static supported = ["audio/webm;codecs=opus", "audio/webm"];
  static isTypeSupported(t: string) {
    return FakeRecorder.supported.includes(t);
  }
  state = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public stream: StreamLike,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
  }
  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2])]) });
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([3])]) });
    setTimeout(() => this.onstop?.(), 10);
  }
}

describe("録音と文字起こし（偽物）", () => {
  it("形は webm（Chrome）を先に、無ければ mp4（Safari）", () => {
    expect(pickAudioType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickAudioType(FakeRecorder.isTypeSupported)).toBe("audio/webm;codecs=opus");
    expect(pickAudioType(undefined)).toBeNull();
  });

  it("録って止めると音声の塊。マイクを閉じる", async () => {
    const stopped: string[] = [];
    const stream = { getTracks: () => [{ stop: () => stopped.push("track") }] };
    const s = await startRecording({ getUserMedia: async () => stream, Recorder: FakeRecorder });
    expect(s?.mimeType).toBe("audio/webm;codecs=opus");
    const p = s!.stop();
    vi.advanceTimersByTime(10);
    const blob = await p;
    expect(blob?.size).toBe(3);
    expect(blob?.type).toBe("audio/webm;codecs=opus");
    expect(stopped).toEqual(["track"]);
  });

  it("マイクが使えない・MediaRecorder が無い端末は null（録音なしで送る）", async () => {
    expect(await startRecording({ getUserMedia: async () => Promise.reject(new Error("NotAllowedError")), Recorder: FakeRecorder })).toBeNull();
    expect(await startRecording({ getUserMedia: null, Recorder: FakeRecorder })).toBeNull();
    expect(await startRecording({ getUserMedia: async () => ({ getTracks: () => [] }), Recorder: null })).toBeNull();
  });

  it("マイクの許可は赤を押した時に聞いてすぐ閉じる。もう許可されていれば聞かない", async () => {
    let opened = 0;
    let closed = 0;
    const getUserMedia = async () => {
      opened++;
      return { getTracks: () => [{ stop: () => closed++ }] };
    };
    await primeMicrophone({ getUserMedia, queryPermission: async () => "prompt" });
    expect([opened, closed]).toEqual([1, 1]);
    await primeMicrophone({ getUserMedia, queryPermission: async () => "granted" });
    expect(opened).toBe(1);
  });

  it("文字起こし: 言い換えずにそのまま。ブラウザが無音で止めたら続きから聞き直す", async () => {
    const made: FakeRecognition[] = [];
    class FakeRecognition implements SpeechRecognitionLike {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: SpeechRecognitionLike["onresult"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      constructor() {
        made.push(this);
      }
      start() {}
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {}
      say(text: string) {
        const res = Object.assign([{ transcript: text }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: Object.assign([res], {}) });
      }
    }
    const s = startTranscript(FakeRecognition)!;
    made[0].say("あしが");
    made[0].onerror?.({ error: "no-speech" });
    made[0].onend?.();
    expect(made).toHaveLength(2);
    expect(made[1].lang).toBe("ja-JP");
    made[1].say("いたい");
    const p = s.stop();
    vi.advanceTimersByTime(0);
    expect(await p).toBe("あしが\nいたい");
    expect(startTranscript(null)).toBeNull();
  });

  it("文字起こし: onSilence を渡すと、1 字も取れずに無音で止まったときは聞き直さずに知らせる（T37）", async () => {
    const made: SilentRecognition[] = [];
    class SilentRecognition implements SpeechRecognitionLike {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: SpeechRecognitionLike["onresult"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      constructor() {
        made.push(this);
      }
      start() {}
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {}
      say(text: string) {
        const res = Object.assign([{ transcript: text }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: Object.assign([res], {}) });
      }
    }
    let silences = 0;
    const s = startTranscript(SilentRecognition, { onSilence: () => silences++ })!;
    made[0].onerror?.({ error: "no-speech" });
    made[0].onend?.();
    expect(silences).toBe(1);
    expect(made).toHaveLength(1);
    expect(await s.stop()).toBeNull();

    // 何か取れたあとの無音・マイクや通信の失敗は、今まで通り続きから聞き直す
    const s2 = startTranscript(SilentRecognition, { onSilence: () => silences++ })!;
    made[1].say("あしが");
    made[1].onerror?.({ error: "no-speech" });
    made[1].onend?.();
    expect(made).toHaveLength(3);
    made[2].onerror?.({ error: "network" });
    made[2].onend?.();
    expect(made).toHaveLength(4);
    expect(silences).toBe(1);
    const p = s2.stop();
    vi.advanceTimersByTime(0);
    expect(await p).toBe("あしが");
  });

  it("録音: 聞き直しの定型文の間だけ止めて再開する。止められない端末は何もしない", async () => {
    const calls: string[] = [];
    class PausingRecorder extends FakeRecorder {
      pause() {
        this.state = "paused";
        calls.push("pause");
      }
      resume() {
        this.state = "recording";
        calls.push("resume");
      }
    }
    const stream = { getTracks: () => [{ stop: () => {} }] };
    const s = await startRecording({ getUserMedia: async () => stream, Recorder: PausingRecorder });
    s!.pause();
    s!.pause();
    s!.resume();
    s!.resume();
    expect(calls).toEqual(["pause", "resume"]);
    const plain = await startRecording({ getUserMedia: async () => stream, Recorder: FakeRecorder });
    expect(() => {
      plain!.pause();
      plain!.resume();
    }).not.toThrow();
  });
});

// ---------- 聞き取りの答えを端末に残す（T49） ----------

describe("聞き取りの答え（端末に残して、戻ったら送る。T49）", () => {
  const mem = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };
  const sig = (): SignalBody => ({
    id: "00000000-0000-4000-8000-000000000001",
    color: "red",
    whereNow: null,
    answers: { injured: null, atHome: null, canMove: null, hasMedicine: null },
    occurredAt: new Date(T0).toISOString(),
    sentAt: new Date(T0).toISOString(),
  });

  it("通信が無い間の答えは、同じ信号の新しい答えで置き換えて 1 つだけ残す。戻ったら信号 → 答えの順に 1 回ずつ", async () => {
    const storage = mem();
    let online = false;
    const { t, sent } = transport(() => (online ? "ok" : "throw"));
    const box = createOutbox({ storage, owner: "self:p-01", transport: t });
    const id = sig().id;
    expect(await box.sendSignal(sig())).toBe("queued");
    await box.sendAnswers({ signalId: id, answers: { injured: { choice: "no", via: "press" } } });
    await box.sendAnswers({ signalId: id, answers: { injured: { choice: "no", via: "press" }, atHome: { choice: "yes", via: "press" } } });
    expect(readOutbox(storage).map((x) => x.kind)).toEqual(["signal", "answers"]);
    online = true;
    await box.flush();
    expect(sent.map((x) => x.kind)).toEqual(["signal", "answers:injured,atHome"]);
    expect(box.pending()).toBe(0);
  });

  it("送っている間に足した新しい答えは、古い答えを送り終えても消さずに送る", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const box = createOutbox({
      storage: mem(),
      owner: "self:p-01",
      transport: {
        signal: async () => "ok",
        attach: async () => "ok",
        answers: async (item) => {
          if (Object.keys(item.answers).length === 1) await gate;
          sent.push(Object.keys(item.answers).join(","));
          return "ok";
        },
      },
    });
    const id = sig().id;
    const first = box.sendAnswers({ signalId: id, answers: { injured: { choice: "no", via: "press" } } });
    await flush();
    const second = box.sendAnswers({ signalId: id, answers: { injured: { choice: "no", via: "press" }, atHome: { choice: "no", via: "press" } } });
    release();
    expect(await first).toBe("sent");
    expect(await second).toBe("sent");
    expect(sent).toEqual(["injured", "injured,atHome"]);
    expect(box.pending()).toBe(0);
  });
});

// ---------- 声の問い（T49） ----------

describe("20 秒押さないと問いを声で（読み上げのある端末。T49）", () => {
  function voiceHarness(heard: Array<string | null>) {
    const spoken: string[] = [];
    const tr = transcripts(heard);
    const rec = pausingRecorder();
    const h = harness({
      speak: async (text) => {
        spoken.push(text);
      },
      startTranscript: tr.start,
      startRecording: rec.startRecording,
    });
    return { h, spoken, tr, rec };
  }

  it("最初は AI の告知から問いと選択肢を読み、10 秒聞いて言葉の一致で答える（声の印）。答えが無ければ答えなしで次へ。問いが終わったら定型文と録音", async () => {
    // 答える順: けが「ない」→ 家「はい」→ 階 無言 → 動けるか「うごけない」→ 出られるか 関係ない言葉 → 以下 無言
    const { h, spoken, rec } = voiceHarness(["ないです", "はい", null, "うごけない", "あー", null, null, null, null, null, null, "あしが いたい"]);
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(h.phone.state).toMatchObject({ step: "question", id: "injured", voice: "listening" });
    expect(spoken[0]).toBe("これはAI、人ではないしくみが聞いています。こたえはケアマネジャーにとどきます。けがはありますか。ある、ない、わからない");
    for (let i = 0; i < 12 && h.phone.state.step === "question"; i++) {
      vi.advanceTimersByTime(LISTEN_MS);
      await flush();
    }
    expect(spoken[1]).toBe("いまは家ですか。はい、いいえ、わからない");
    expect(spoken.slice(1).every((t) => !t.startsWith("これは"))).toBe(true);
    // 頼みたい ことは声の問いでは聞かない（定型文と録音で聞く）
    expect(spoken.some((t) => t.startsWith("たのみたい"))).toBe(false);
    expect(h.phone.state.step).toBe("recording");
    expect(h.answers.at(-1)!.answers).toEqual({
      injured: { choice: "no", via: "voice" },
      atHome: { choice: "yes", via: "voice" },
      canMove: { choice: "no", via: "voice" },
    });
    // 録音は 1 本: 声の問いに入った時に始め、読み上げる間は止める
    expect(rec.log.filter((x) => x === "stop")).toEqual([]);
    expect(rec.log[0]).toBe("pause");
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(h.phone.state).toMatchObject({ step: "done", color: "red" });
    expect(h.recordings).toHaveLength(1);
    // 声の問いで聞き取れた文字も文字起こしに（本人の言葉）
    expect(h.recordings[0].item.transcript).toBe(["ないです", "はい", "うごけない", "あー", "あしが いたい"].join("\n"));
  });

  it("声の問いでも押せばその答え（押した印）。聞いていた分は捨てて次の問いを読む", async () => {
    const { h, spoken } = voiceHarness(["いいえ"]);
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    h.phone.answer("yes");
    await flush();
    expect(h.answers.at(-1)!.answers).toEqual({ injured: { choice: "yes", via: "press" } });
    expect(h.phone.state).toMatchObject({ step: "question", id: "injuryPart" });
    expect(spoken.at(-1)).toContain("けがはどこですか");
  });

  it("読み上げの無い端末は今まで通り 20 秒で定型文へ（声の問いは無い）", async () => {
    const h = harness();
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(h.phone.state.step).toBe("recording");
    expect(steps(h)).toEqual(["q:injured", "prompt", "recording"]);
  });
});

describe("声の問いの途中で押した（T49）", () => {
  it("文字を待つ間に押した: 押した答えが残り（声で上書きしない）、1 回だけ進む", async () => {
    let release: (t: string | null) => void = () => {};
    const h = harness({
      speak: async () => {},
      startRecording: async () => null,
      startTranscript: () => ({ stop: () => new Promise<string | null>((r) => (release = r)) }),
    });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(h.phone.state).toMatchObject({ step: "question", id: "injured", voice: "listening", first: true });
    vi.advanceTimersByTime(LISTEN_MS); // 10 秒: 文字を待ち始める
    await flush();
    h.phone.answer("yes");
    release("いいえ");
    await flush();
    expect(h.answers.at(-1)!.answers).toEqual({ injured: { choice: "yes", via: "press" } });
    expect(h.phone.state).toMatchObject({ step: "question", id: "injuryPart" });
    expect(steps(h).filter((s) => s.startsWith("q:atHome"))).toEqual([]);
  });

  it("マイクを待つ間に押した: 古い問いを読み直さない", async () => {
    let open: () => void = () => {};
    const spoken: string[] = [];
    const h = harness({
      speak: async (t) => {
        spoken.push(t);
      },
      startRecording: () => new Promise((r) => (open = () => r(null))),
      startTranscript: () => null,
    });
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    h.phone.answer("no");
    await flush();
    open();
    await flush();
    expect(spoken.some((t) => t.includes("けがはありますか"))).toBe(false);
    expect(h.phone.state).toMatchObject({ step: "question", id: "atHome" });
  });
});
