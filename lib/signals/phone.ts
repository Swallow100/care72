// 本人のスマホの災害モードの流れ（docs/tasks/T10.md）。画面（components/phone）はここの状態を描き、押した物を渡すだけ。
// 画面（DOM）に触らない。送る道・音・録音は渡す（テストは偽物と偽の時計）。
//
//   上（無事・無事じゃない）
//   ├ 無事 → どこに いますか（家・避難所・ほか）→ 送る → とどきました
//   └ 無事じゃない → 1 問ずつ（けが・家・動けるか・くすり）→ 送る → とどきました（＋119 の 1 行）
//        └ どの問いでも 20 秒押さない → 信号を送る（それまでの答え）→ 定型文 → 30 秒録る（延長は押せば）→ 録音を添える
//             └ 無音のまま止まった → 同じ定型文で聞き直す（2 回まで）→ それでも無音なら録音を送って「ろくおんを おくりました」
//
// - 20 秒は、赤を押した時か、最後に答えた時から数える。送ったあとは数えない。緑には音声が無い
// - 赤の信号は 20 秒で音声に替わった時に先に送る（録り終わる 30 秒を待たずに一覧に赤が出る）。録音と文字起こしはあとで添える
// - 無音のまま止まった（T37、docs/DECISIONS.md 11/3 04:0x の 9）: 1 回の聞き取り（定型文のあとの 30 秒）の間に文字が 1 字も
//   取れずに、ブラウザの文字起こしが無音で終わった（startTranscript の onSilence）か、30 秒が過ぎた。同じ定型文を流して聞き直し、
//   2 回聞き直しても無音なら録音を送って終える。文字起こしの無い端末は無音が分からないので聞き直さない（今まで通り）。
//   人が「送る」を押したときは聞き直さない
// - 録音は 1 本のまま（サーバーは 1 つの信号に 1 回だけ添える）。定型文を流す間は録音を止め（pause。できない端末は録ったまま）、
//   文字起こしは止めてから流す（定型文の声を文字にしない）。うめき声など文字にならない音は、どの回の物も同じ録音に残る
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
/** 無音のまま止まったときに、同じ定型文で聞き直す回数の上限 */
export const MAX_REASKS = 2;

export type PhoneState =
  | { step: "top" }
  | { step: "where" }
  | { step: "question"; index: number; answers: RedAnswers }
  | { step: "prompt" }
  | { step: "recording"; startedAt: number; until: number }
  | { step: "sending"; color: PhoneColor }
  /** silent: 文字が 1 字も取れないまま録音だけ送った（「ろくおんを おくりました」） */
  | { step: "done"; color: PhoneColor; delivery: Delivery; silent?: true };

export type Stoppable<T> = { stop(): Promise<T> };

/** 録音。定型文を流す間だけ止める（pause・resume が無い端末は録ったまま） */
export type Recording = Stoppable<Blob | null> & { pause?(): void; resume?(): void };

/** 文字起こしの知らせ。onSilence は 1 字も取れないまま無音で止まったとき */
export type TranscriptEvents = { onSilence(): void };

export type PhoneDeps = {
  now?: () => number;
  newId?: () => string;
  sendSignal(body: SignalBody): Promise<Delivery>;
  sendRecording(item: AttachItem, audio: Blob | null): Promise<Delivery>;
  /** 赤を押した時（人が押した時に、音とマイクの許可を通しておく） */
  prime?(): void;
  /** 定型文を流して、終わるのを待つ */
  playPrompt(): Promise<unknown>;
  startRecording(): Promise<Recording | null>;
  startTranscript?(events: TranscriptEvents): Stoppable<string | null> | null;
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
  let recording: Recording | null = null;
  let transcript: Stoppable<string | null> | null = null;
  let signal: { id: string; delivery: Promise<Delivery> } | null = null;
  // ---- 音声の回（toVoice から送るまで） ----
  /** 文字起こしが使える（無音が分かる）。使えない端末は聞き直さない */
  let canReask = false;
  /** 聞き直した回数 */
  let asks = 0;
  /** 取れた文字（聞き取りの回ごと） */
  let heard: string[] = [];
  /** 聞き取った長さの合計（定型文を流した間は数えない） */
  let listenedMs = 0;
  /** 今の聞き取りの始まり。聞き取っていなければ null */
  let listeningAt: number | null = null;
  /** 聞き取りの番号。止めた文字起こしの遅れた知らせを当てない */
  let attempt = 0;
  /** 聞き取りを閉じて文字を待っている間（押した「送る」はあとで当てる） */
  let ending = false;
  let finishWanted = false;

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

  /** 定型文を流して終わるのを待つ（終わらなければ PROMPT_WAIT_MS で打ち切る） */
  const playPrompt = () =>
    Promise.race([
      Promise.resolve()
        .then(() => deps.playPrompt())
        .catch(() => undefined),
      new Promise((r) => setTimeout(r, PROMPT_WAIT_MS)),
    ]);

  /** 文字起こしを始める。無音で止まったら、この回の聞き取りを閉じる */
  function openTranscript() {
    const mine = ++attempt;
    transcript =
      deps.startTranscript?.({
        onSilence: () => {
          if (mine === attempt) void windowEnded();
        },
      }) ?? null;
  }

  /** 聞き取りの 1 回を始める（画面は録っている、30 秒） */
  function listen() {
    const startedAt = now();
    listeningAt = startedAt;
    set({ step: "recording", startedAt, until: startedAt + RECORD_MS });
    after(RECORD_MS, () => void windowEnded());
  }

  /** 今の聞き取りの長さを足して閉じる */
  function closeListening(at: number) {
    if (listeningAt !== null) listenedMs += Math.max(0, at - listeningAt);
    listeningAt = null;
  }

  /** 20 秒押さなかった: 信号を先に送り、定型文を流して録る */
  async function toVoice() {
    if (state.step !== "question") return;
    const mine = run;
    const b = body("red", null, state.answers);
    signal = { id: b.id, delivery: deps.sendSignal(b) };
    set({ step: "prompt" });
    await playPrompt();
    if (mine !== run) return;
    const rec = await deps.startRecording().catch(() => null);
    if (mine !== run) {
      void rec?.stop();
      return;
    }
    recording = rec;
    asks = 0;
    heard = [];
    listenedMs = 0;
    listeningAt = null;
    ending = false;
    finishWanted = false;
    openTranscript();
    canReask = transcript !== null;
    if (!recording && !transcript) {
      // マイクも文字起こしも使えない: 録らずに信号だけ（もう送ってある）
      set({ step: "sending", color: "red" });
      const delivery = await signal.delivery;
      if (mine !== run) return;
      set({ step: "done", color: "red", delivery });
      return;
    }
    listen();
  }

  /**
   * 聞き取りの 1 回が終わった（30 秒が過ぎた・ブラウザが無音で止めた）。文字が取れていれば送る。
   * 無音なら同じ定型文で聞き直す（MAX_REASKS 回まで）。聞き直せない（文字起こしが無い・回数が尽きた）ときは送る
   */
  async function windowEnded() {
    if (state.step !== "recording" || !signal || ending) return;
    if (!canReask || !transcript || asks >= MAX_REASKS) {
      await stopRecording();
      return;
    }
    clear();
    ending = true;
    const mine = run;
    const t = transcript;
    transcript = null;
    attempt++;
    closeListening(now());
    try {
      recording?.pause?.();
    } catch {
      // 止められない録音は録ったまま（定型文も入る）
    }
    const text = (await t.stop().catch(() => null))?.trim() ?? "";
    ending = false;
    if (mine !== run) return;
    if (text) heard.push(text);
    if (text || finishWanted) {
      await stopRecording();
      return;
    }
    // 無音: 同じ定型文で聞き直す
    asks++;
    set({ step: "prompt" });
    await playPrompt();
    if (mine !== run) return;
    try {
      recording?.resume?.();
    } catch {
      // 止めていない録音
    }
    openTranscript();
    listen();
  }

  /** 録音と文字起こしを止めて添える（聞き直しで取れた文字も合わせる） */
  async function stopRecording() {
    if (state.step !== "recording" || !signal) return;
    if (ending) {
      finishWanted = true;
      return;
    }
    clear();
    const mine = run;
    const sig = signal;
    set({ step: "sending", color: "red" });
    const endedAt = now();
    closeListening(endedAt);
    const t = transcript;
    transcript = null;
    attempt++;
    const [audio, text] = await Promise.all([
      recording?.stop().catch(() => null) ?? Promise.resolve(null),
      t?.stop().catch(() => null) ?? Promise.resolve(null),
    ]);
    recording = null;
    if (text?.trim()) heard.push(text.trim());
    const words = heard.length > 0 ? heard.join("\n") : null;
    const delivery = await sig.delivery;
    if (audio || words) {
      await deps
        .sendRecording(
          { signalId: sig.id, transcript: words, durationSec: Math.round(listenedMs / 1000), recordedAt: iso(endedAt) },
          audio,
        )
        .catch(() => "queued" as const);
    }
    if (mine !== run) return;
    // 文字起こしが使えて 1 字も取れず、録音だけ送った
    const silent = canReask && words === null && audio !== null;
    set({ step: "done", color: "red", delivery, ...(silent ? { silent: true as const } : {}) });
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
      if (state.step !== "recording" || ending) return;
      const until = Math.min(state.until + RECORD_MS, state.startedAt + MAX_RECORD_MS);
      set({ ...state, until });
      after(until - now(), () => void windowEnded());
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
      attempt++;
      ending = false;
    },
  };
}
