// 本人のスマホの災害モードの流れ（docs/tasks/T10.md）。画面（components/phone）はここの状態を描き、押した物を渡すだけ。
// 画面（DOM）に触らない。送る道・音・録音は渡す（テストは偽物と偽の時計）。
//
//   上（無事・無事じゃない）
//   ├ 無事 → どこに いますか（家・避難所・ほか）→ 送る → とどきました
//   └ 無事じゃない → 1 問ずつ（けが・家・動けるか・くすり）→ 送る → とどきました（＋119 の 1 行）
//        └ どの問いでも 20 秒押さない → 信号を送る（それまでの答え）→ 定型文 → 30 秒録る（延長は押せば）→ 録音を添える
//
// - 20 秒は、赤を押した時か、最後に答えた時から数える。送ったあとは数えない。緑には音声が無い
// - 赤の信号は 20 秒で音声に替わった時に先に送る（録り終わる 30 秒を待たずに一覧に赤が出る）。録音と文字起こしはあとで添える
// - 戻るは無い。終わったら「もう 一度」で上へ

import { newSignalId, NO_ANSWERS, type PhoneColor, type RedAnswers, type SignalBody } from "./body.ts";
import type { AttachItem, Delivery } from "./outbox.ts";
import { RED_QUESTIONS } from "./phrases.ts";
import type { WhereNow } from "../db/types.ts";

/** 赤を押して（最後に答えて）から音声に替わるまで */
export const IDLE_MS = 20_000;
/** 1 回に録る長さ。延長は 1 回押すごとにこれだけ足す */
export const RECORD_MS = 30_000;
/** 録る長さの上限（延長を足しても） */
export const MAX_RECORD_MS = 120_000;
/** 定型文が終わらないときに待つ上限 */
export const PROMPT_WAIT_MS = 15_000;

export type PhoneState =
  | { step: "top" }
  | { step: "where" }
  | { step: "question"; index: number; answers: RedAnswers }
  | { step: "prompt" }
  | { step: "recording"; startedAt: number; until: number }
  | { step: "sending"; color: PhoneColor }
  | { step: "done"; color: PhoneColor; delivery: Delivery };

export type Stoppable<T> = { stop(): Promise<T> };

export type PhoneDeps = {
  now?: () => number;
  newId?: () => string;
  sendSignal(body: SignalBody): Promise<Delivery>;
  sendRecording(item: AttachItem, audio: Blob | null): Promise<Delivery>;
  /** 赤を押した時（人が押した時に、音とマイクの許可を通しておく） */
  prime?(): void;
  /** 定型文を流して、終わるのを待つ */
  playPrompt(): Promise<unknown>;
  startRecording(): Promise<Stoppable<Blob | null> | null>;
  startTranscript?(): Stoppable<string | null> | null;
  onChange(state: PhoneState): void;
};

export type Phone = {
  readonly state: PhoneState;
  green(): void;
  red(): void;
  where(where: WhereNow): void;
  answer(value: boolean): void;
  /** 録音の延長 */
  extend(): void;
  /** 録音を止めて送る */
  finish(): void;
  /** 終わったあと上へ */
  again(): void;
  /** 画面を閉じた。数えるのをやめ、録っていれば止める（送らない） */
  dispose(): void;
};

const iso = (ms: number) => new Date(ms).toISOString();

export function createPhone(deps: PhoneDeps): Phone {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => newSignalId());
  let state: PhoneState = { step: "top" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 流れの番号。押し直し・閉じたあとに、前の流れの続き（await のあと）を当てない */
  let run = 0;
  let pressedAt = 0;
  let recording: Stoppable<Blob | null> | null = null;
  let transcript: Stoppable<string | null> | null = null;
  let signal: { id: string; delivery: Promise<Delivery> } | null = null;

  const set = (s: PhoneState) => {
    state = s;
    deps.onChange(s);
  };
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const after = (ms: number, fn: () => void) => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, Math.max(0, ms));
  };

  const body = (color: PhoneColor, whereNow: WhereNow | null, answers: RedAnswers): SignalBody => {
    const at = iso(pressedAt);
    return { id: newId(), color, whereNow, answers: { ...answers }, occurredAt: at, sentAt: at };
  };

  async function deliver(b: SignalBody) {
    const mine = run;
    set({ step: "sending", color: b.color });
    const delivery = await deps.sendSignal(b);
    if (mine !== run) return;
    set({ step: "done", color: b.color, delivery });
  }

  /** 20 秒押さなかった: 信号を先に送り、定型文を流して録る */
  async function toVoice() {
    if (state.step !== "question") return;
    const mine = run;
    const b = body("red", null, state.answers);
    signal = { id: b.id, delivery: deps.sendSignal(b) };
    set({ step: "prompt" });
    await Promise.race([
      Promise.resolve()
        .then(() => deps.playPrompt())
        .catch(() => undefined),
      new Promise((r) => setTimeout(r, PROMPT_WAIT_MS)),
    ]);
    if (mine !== run) return;
    const rec = await deps.startRecording().catch(() => null);
    if (mine !== run) {
      void rec?.stop();
      return;
    }
    recording = rec;
    transcript = deps.startTranscript?.() ?? null;
    if (!recording && !transcript) {
      // マイクも文字起こしも使えない: 録らずに信号だけ（もう送ってある）
      set({ step: "sending", color: "red" });
      const delivery = await signal.delivery;
      if (mine !== run) return;
      set({ step: "done", color: "red", delivery });
      return;
    }
    const startedAt = now();
    set({ step: "recording", startedAt, until: startedAt + RECORD_MS });
    after(RECORD_MS, () => void stopRecording());
  }

  async function stopRecording() {
    if (state.step !== "recording" || !signal) return;
    clear();
    const mine = run;
    const { startedAt } = state;
    const sig = signal;
    set({ step: "sending", color: "red" });
    const endedAt = now();
    const [audio, text] = await Promise.all([
      recording?.stop().catch(() => null) ?? Promise.resolve(null),
      transcript?.stop().catch(() => null) ?? Promise.resolve(null),
    ]);
    recording = null;
    transcript = null;
    const delivery = await sig.delivery;
    if (audio || text) {
      await deps
        .sendRecording(
          { signalId: sig.id, transcript: text, durationSec: Math.round((endedAt - startedAt) / 1000), recordedAt: iso(endedAt) },
          audio,
        )
        .catch(() => "queued" as const);
    }
    if (mine !== run) return;
    set({ step: "done", color: "red", delivery });
  }

  return {
    get state() {
      return state;
    },
    green() {
      if (state.step !== "top") return;
      run++;
      pressedAt = now();
      set({ step: "where" });
    },
    red() {
      if (state.step !== "top") return;
      run++;
      pressedAt = now();
      signal = null;
      try {
        deps.prime?.();
      } catch {
        // 音・マイクを先に通せなくても進める
      }
      set({ step: "question", index: 0, answers: { ...NO_ANSWERS } });
      after(IDLE_MS, () => void toVoice());
    },
    where(where) {
      if (state.step !== "where") return;
      void deliver(body("green", where, NO_ANSWERS));
    },
    answer(value) {
      if (state.step !== "question") return;
      const answers = { ...state.answers, [RED_QUESTIONS[state.index]]: value };
      if (state.index + 1 < RED_QUESTIONS.length) {
        set({ step: "question", index: state.index + 1, answers });
        after(IDLE_MS, () => void toVoice());
        return;
      }
      clear();
      void deliver(body("red", null, answers));
    },
    extend() {
      if (state.step !== "recording") return;
      const until = Math.min(state.until + RECORD_MS, state.startedAt + MAX_RECORD_MS);
      set({ ...state, until });
      after(until - now(), () => void stopRecording());
    },
    finish() {
      void stopRecording();
    },
    again() {
      if (state.step !== "done") return;
      run++;
      signal = null;
      set({ step: "top" });
    },
    dispose() {
      run++;
      clear();
      void recording?.stop().catch(() => null);
      void transcript?.stop().catch(() => null);
      recording = null;
      transcript = null;
    },
  };
}
