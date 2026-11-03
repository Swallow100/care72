// 本人のスマホの災害モードの流れ（docs/tasks/T10.md）。画面（components/phone）はここの状態を描き、押した物を渡すだけ。
// 画面（DOM）に触らない。送る道・音・録音は渡す（テストは偽物と偽の時計）。
//
//   上（無事・無事じゃない）
//   ├ 無事 → どこに いますか（家・避難所・ほか）→ 送る → とどきました
//   └ 無事じゃない → 信号を送る → 1 画面 1 問（lib/signals/questions.ts の枝。押すたびに答えを送る・とばす）→ とどきました（＋119 の 1 行）
//        ├ 頼みたい ことを「はなす」→ 定型文 → 60 秒録る（話している間は 60 秒ずつ延びる。上限 180 秒。T69b）
//        ├ けが・動けない・出られない・水・火やガス・機器の停止の答え → 残りの問いを飛ばして定型文と録音へ（T69b。
//        │   けが ある のあとに 動けるか がまだ無ければ「動けますか」の 1 問だけ聞いてから）
//        └ どの問いでも 20 秒押さない → 声の問い（T49）: 問いと選択肢を読み上げ（最初は AI の告知から）→ 10 秒聞く →
//             言葉の一致で答える（無ければ答えなしで次へ）→ … → 問いが終わったら定型文 → 60 秒録る（延長は押せば・話している間は自動）→ 録音を添える
//             └ 無音のまま止まった → 同じ定型文で聞き直す（2 回まで）→ それでも無音なら録音を送って「ろくおんを おくりました」
//
// - 赤の信号は押した時に送る（一覧にすぐ赤が出る）。答えは押すたびに、それまでの全部を同じ信号に送る（後勝ち）。録音はあとで添える
// - 20 秒は、赤を押した時か、最後に答えた時から数える。送ったあとは数えない。緑には音声が無い
// - 声の問いは、問いを読み上げる道（speak）がある端末だけ。無ければ今まで通り 20 秒で定型文へ。
//   声の問いに入ったら終わりまで声で進む（押せばその答えも取る）。録音は声の問いに入った時に始め、読み上げる間だけ止める（1 本のまま）
// - 声の問いで聞き取れた文字は録音の文字起こしにも足す（本人の言葉。聞き取りメモの元）
// - 無音のまま止まった（T37、docs/DECISIONS.md 11/3 04:0x の 9）: 1 回の聞き取り（定型文のあとの 30 秒）の間に文字が 1 字も
//   取れずに、ブラウザの文字起こしが無音で終わった（startTranscript の onSilence）か、30 秒が過ぎた。同じ定型文を流して聞き直し、
//   2 回聞き直しても無音なら録音を送って終える。文字起こしの無い端末は無音が分からないので聞き直さない（今まで通り）。
//   人が「送る」を押したときは聞き直さない
// - 録音は 1 本のまま（サーバーは 1 つの信号に 1 回だけ添える）。定型文を流す間は録音を止め（pause。できない端末は録ったまま）、
//   文字起こしは止めてから流す（定型文の声を文字にしない）。うめき声など文字にならない音は、どの回の物も同じ録音に残る
// - 戻るは無い。終わったら「もう 一度」で上へ

import { newSignalId, NO_ANSWERS, type PhoneColor, type SignalBody } from "./body.ts";
import type { AnswersItem, AttachItem, Delivery } from "./outbox.ts";
import { AI_NOTICE_VOICE } from "./phrases.ts";
import {
  choiceOf,
  firstQuestion,
  matchVoiceAnswer,
  nextQuestion,
  rushesToRecording,
  rushNext,
  voiceTextOf,
  type Answers,
  type Asker,
  type QuestionId,
} from "./questions.ts";
import type { WhereNow } from "../db/types.ts";

/** 赤を押して（最後に答えて）から音声に替わるまで */
export const IDLE_MS = 20_000;
/** 1 回に録る長さ。延長は 1 回押すごとにこれだけ足す（T69b で 30 秒 → 60 秒。話し終わるまで録る） */
export const RECORD_MS = 60_000;
/** 録る長さの上限（延長を足しても。T69b で 120 秒 → 180 秒） */
export const MAX_RECORD_MS = 180_000;
/**
 * 話している（文字起こしが動いている）とみなす間（T69b）。録る時間が来たときに、これより新しく文字が届いていれば
 * RECORD_MS だけ自動で延ばす（上限 MAX_RECORD_MS）。話し終わって静かになれば延ばさずに送る
 */
export const TALKING_MS = 15_000;
/** 定型文が終わらないときに待つ上限 */
export const PROMPT_WAIT_MS = 25_000; // 声の頭に AI の告知（T48）。端末の声の打ち切り（PROMPT_TIMEOUT_MS）より長く
/** 無音のまま止まったときに、同じ定型文で聞き直す回数の上限 */
export const MAX_REASKS = 2;
/** 声の問いで答えを聞く長さ（T49） */
export const LISTEN_MS = 10_000;
/** 声の問いの読み上げが終わらないときに待つ上限 */
export const SPEAK_WAIT_MS = 15_000;

/** 声の問いの段: 読み上げている・聞いている（T49） */
export type VoiceStep = "speaking" | "listening";

export type PhoneState =
  | { step: "top" }
  | { step: "where" }
  /** first は赤の流れの最初の問い（AI の告知を出す）。voice は声の問いの段（押す問いは null） */
  | { step: "question"; id: QuestionId; answers: Answers; first: boolean; voice: VoiceStep | null }
  | { step: "prompt" }
  | { step: "recording"; startedAt: number; until: number }
  | { step: "sending"; color: PhoneColor }
  /** silent: 文字が 1 字も取れないまま録音だけ送った（「ろくおんを おくりました」） */
  | { step: "done"; color: PhoneColor; delivery: Delivery; silent?: true };

export type Stoppable<T> = { stop(): Promise<T> };

/** 録音。定型文を流す間だけ止める（pause・resume が無い端末は録ったまま） */
export type Recording = Stoppable<Blob | null> & { pause?(): void; resume?(): void };

/** 文字起こしの知らせ。onSilence は 1 字も取れないまま無音で止まったとき、onText は文字が届いたとき（T69b。録音の自動の延長） */
export type TranscriptEvents = { onSilence(): void; onText?(text: string): void };

export type PhoneDeps = {
  now?: () => number;
  newId?: () => string;
  sendSignal(body: SignalBody): Promise<Delivery>;
  sendRecording(item: AttachItem, audio: Blob | null): Promise<Delivery>;
  /** 聞き取りの答え（T49）。押すたびに、それまでの全部 */
  sendAnswers(item: AnswersItem): Promise<Delivery>;
  /** 台帳に機器がある（機器の問いを聞く） */
  hasDevice?: boolean;
  /** 声の問いを読み上げて、終わるのを待つ（端末の読み上げ）。無ければ声の問いは無い */
  speak?(text: string): Promise<unknown>;
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
  /** 問いの選択肢を押した（choice は lib/signals/questions.ts の選択肢の id） */
  answer(choice: string): void;
  /** 問いをとばす */
  skip(): void;
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


/** 2 つの届き方のうち悪い方（捨てた → 残した → 届いた） */
export function worseDelivery(a: Delivery, b: Delivery): Delivery {
  const rank: Record<Delivery, number> = { sent: 0, queued: 1, dropped: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function createPhone(deps: PhoneDeps): Phone {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => newSignalId());
  const asker: Asker = { who: "self", hasDevice: deps.hasDevice ?? false };
  let state: PhoneState = { step: "top" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 流れの番号。押し直し・閉じたあとに、前の流れの続き（await のあと）を当てない */
  let run = 0;
  let pressedAt = 0;
  let recording: Recording | null = null;
  let transcript: Stoppable<string | null> | null = null;
  let signal: { id: string; delivery: Promise<Delivery> } | null = null;
  // ---- 聞き取りの問い（T49） ----
  let answers: Answers = {};
  /** 最後に送った答えの届き方。無ければ答えを送っていない */
  let lastAnswers: Promise<Delivery> | null = null;
  /** 声の問いに入った（終わりまで声で進む） */
  let voiceMode = false;
  /** 声の問いの番号。押した・次へ進んだあとに、前の問いの読み上げ・聞き取りの続きを当てない */
  let ask = 0;
  /** 声の問いの聞き取り（10 秒） */
  let answerTranscript: Stoppable<string | null> | null = null;
  // ---- 音声の回（定型文から送るまで） ----
  /** 文字起こしが使える（無音が分かる）。使えない端末は聞き直さない */
  let canReask = false;
  /** 聞き直した回数 */
  let asks = 0;
  /** 取れた文字（声の問いの答えと、聞き取りの回ごと） */
  let heard: string[] = [];
  /** 聞き取った長さの合計（定型文・問いを読んだ間は数えない） */
  let listenedMs = 0;
  /** 今の聞き取りの始まり。聞き取っていなければ null */
  let listeningAt: number | null = null;
  /** 聞き取りの番号。止めた文字起こしの遅れた知らせを当てない */
  let attempt = 0;
  /** 聞き取りを閉じて文字を待っている間（押した「送る」はあとで当てる） */
  let ending = false;
  let finishWanted = false;
  /** 今の聞き取りで最後に文字が届いた時刻（T69b。話している間は録る時間を延ばす） */
  let lastHeardAt: number | null = null;
  /** 残りの問いを飛ばして録音へ急ぐ（T69b） */
  let rushing = false;

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

  const body = (color: PhoneColor, whereNow: WhereNow | null, id: string = newId()): SignalBody => {
    const at = iso(pressedAt);
    return { id, color, whereNow, answers: { ...NO_ANSWERS }, occurredAt: at, sentAt: at };
  };

  async function deliver(b: SignalBody) {
    const mine = run;
    set({ step: "sending", color: b.color });
    const delivery = await deps.sendSignal(b);
    if (mine !== run) return;
    set({ step: "done", color: b.color, delivery });
  }

  /** 赤の信号と最後の答えの届き方（悪い方） */
  async function redDelivery(): Promise<Delivery> {
    const [d1, d2] = await Promise.all([
      signal?.delivery ?? Promise.resolve<Delivery>("sent"),
      lastAnswers ?? Promise.resolve<Delivery>("sent"),
    ]);
    return worseDelivery(d1, d2);
  }

  /** 定型文を流して終わるのを待つ（終わらなければ PROMPT_WAIT_MS で打ち切る） */
  const playPrompt = () =>
    Promise.race([
      Promise.resolve()
        .then(() => deps.playPrompt())
        .catch(() => undefined),
      new Promise((r) => setTimeout(r, PROMPT_WAIT_MS)),
    ]);

  const pauseRecording = () => {
    try {
      recording?.pause?.();
    } catch {
      // 止められない録音は録ったまま
    }
  };
  const resumeRecording = () => {
    try {
      recording?.resume?.();
    } catch {
      // 止めていない録音
    }
  };

  /** 今の聞き取りの長さを足して閉じる */
  function closeListening(at: number) {
    if (listeningAt !== null) listenedMs += Math.max(0, at - listeningAt);
    listeningAt = null;
  }

  // ---------- 聞き取りの問い（T49） ----------

  /** 答えを記録して、それまでの全部を送る（待たない） */
  function record(id: QuestionId, choice: string, via: "press" | "voice") {
    if (!signal) return;
    answers = { ...answers, [id]: { choice, via } };
    lastAnswers = deps
      .sendAnswers({ signalId: signal.id, answers: { ...answers } })
      .catch((): Delivery => "queued");
  }

  /**
   * 答えた（choice が null ならとばした）あとの次の問い。録音へ急ぐ答え（T69b）を押した・声で一致したら、
   * 残りを飛ばす（けが のあとの 動けるか の 1 問だけは聞く）
   */
  function nextAfter(id: QuestionId, choice: string | null): QuestionId | null {
    if (rushesToRecording(id, choice)) rushing = true;
    return rushing ? rushNext(id, answers, asker) : nextQuestion(id, choice, asker);
  }

  /** 声の問いの聞き取りを閉じる（押した・次へ進んだ）。取れた文字は返さない */
  function dropAnswerListening() {
    ask++;
    const t = answerTranscript;
    answerTranscript = null;
    if (t) void t.stop().catch(() => null);
    closeListening(now());
  }

  /** 次の問いへ。null は問いの終わり */
  function advance(next: QuestionId | null) {
    clear();
    if (next !== null && !(voiceMode && next === "request")) {
      if (voiceMode) void askByVoice(next, false);
      else {
        set({ step: "question", id: next, answers, first: false, voice: null });
        after(IDLE_MS, () => void toVoice());
      }
      return;
    }
    // 問いの終わり: 声で進んだ・頼みたい ことを「はなす」・録音へ急ぐ答え（T69b）なら定型文と録音へ、ほかは送れたかを出す
    if (voiceMode || rushing || answers.request?.choice === "speak") void toPrompt();
    else void finishQuestions();
  }

  async function finishQuestions() {
    const mine = run;
    set({ step: "sending", color: "red" });
    const delivery = await redDelivery();
    if (mine !== run) return;
    set({ step: "done", color: "red", delivery });
  }

  /** 20 秒押さなかった: 問いを声で読む端末なら声の問いへ、無ければ定型文へ */
  async function toVoice() {
    if (state.step !== "question" || state.voice !== null) return;
    if (!deps.speak) {
      void toPrompt();
      return;
    }
    voiceMode = true;
    const mine = run;
    const my = ask;
    const id = state.id;
    // 録音は声の問いに入った時に始める（周りの音も残す）。読み上げる間は止める
    const rec = await deps.startRecording().catch(() => null);
    if (mine !== run) {
      void rec?.stop();
      return;
    }
    recording = rec;
    // マイクを待つ間に押した: 押した方の流れ（もう次の問いを声で読んでいる）に任せ、古い問いを読み直さない
    if (my !== ask) return;
    void askByVoice(id, true);
  }

  /** 1 つの問いを声で: 読み上げ（最初は AI の告知から）→ 10 秒聞く → 言葉の一致で答える → 次へ */
  async function askByVoice(id: QuestionId, notice: boolean) {
    const mine = run;
    const my = ++ask;
    // 赤の流れの最初の問いを声にするときは、読み上げる AI の告知と同じ文字の告知も出したまま（T48）
    const first = id === firstQuestion(asker);
    set({ step: "question", id, answers, first, voice: "speaking" });
    pauseRecording();
    const text = `${notice ? `${AI_NOTICE_VOICE}。` : ""}${voiceTextOf(id)}`;
    await Promise.race([
      Promise.resolve()
        .then(() => deps.speak?.(text))
        .catch(() => undefined),
      new Promise((r) => setTimeout(r, SPEAK_WAIT_MS)),
    ]);
    if (mine !== run || my !== ask) return;
    resumeRecording();
    set({ step: "question", id, answers, first, voice: "listening" });
    listeningAt = now();
    answerTranscript =
      deps.startTranscript?.({
        onSilence: () => {
          if (mine === run && my === ask) void answerHeard(id, my);
        },
      }) ?? null;
    after(LISTEN_MS, () => void answerHeard(id, my));
  }

  /** 声の問いの聞き取りが終わった（10 秒・無音）。言葉が一致すれば答え、無ければ答えなしで次へ */
  async function answerHeard(id: QuestionId, my: number) {
    if (my !== ask || state.step !== "question") return;
    clear();
    const mine = run;
    const token = ++ask;
    const t = answerTranscript;
    answerTranscript = null;
    closeListening(now());
    const text = (await t?.stop().catch(() => null))?.trim() ?? "";
    // 文字を待つ間に押した: 押した答えが先（声の答えで上書きしない・2 回進めない）
    if (mine !== run || token !== ask) return;
    if (text) heard.push(text);
    const choice = matchVoiceAnswer(text, id);
    if (choice) record(id, choice, "voice");
    advance(nextAfter(id, choice));
  }

  // ---------- 定型文と録音 ----------

  /** 文字起こしを始める。無音で止まったら、この回の聞き取りを閉じる */
  function openTranscript() {
    const mine = ++attempt;
    transcript =
      deps.startTranscript?.({
        onSilence: () => {
          if (mine === attempt) void windowEnded();
        },
        onText: () => {
          if (mine === attempt) lastHeardAt = now();
        },
      }) ?? null;
  }

  /** 聞き取りの 1 回を始める（画面は録っている、60 秒） */
  function listen() {
    const startedAt = now();
    listeningAt = startedAt;
    lastHeardAt = null;
    set({ step: "recording", startedAt, until: startedAt + RECORD_MS });
    after(RECORD_MS, () => void timeUp());
  }

  /**
   * 録る時間が来た（T69b）。話している（TALKING_MS より新しく文字が届いた）なら RECORD_MS だけ自動で延ばす（上限 MAX_RECORD_MS）。
   * 話していなければ今まで通り聞き取りの 1 回を閉じる（文字があれば送る・無音なら聞き直す）
   */
  function timeUp() {
    if (state.step !== "recording" || ending) return;
    const t = now();
    const cap = state.startedAt + MAX_RECORD_MS;
    if (lastHeardAt !== null && t - lastHeardAt <= TALKING_MS && state.until < cap) {
      const until = Math.min(state.until + RECORD_MS, cap);
      set({ ...state, until });
      after(until - t, () => void timeUp());
      return;
    }
    void windowEnded();
  }

  /** 問いが終わった（か、問いを声にできない端末で 20 秒押さなかった）: 定型文を流して録る */
  async function toPrompt() {
    if (!signal) return;
    clear();
    const mine = run;
    set({ step: "prompt" });
    pauseRecording();
    await playPrompt();
    if (mine !== run) return;
    if (recording) resumeRecording();
    else {
      const rec = await deps.startRecording().catch(() => null);
      if (mine !== run) {
        void rec?.stop();
        return;
      }
      recording = rec;
    }
    asks = 0;
    ending = false;
    finishWanted = false;
    openTranscript();
    canReask = transcript !== null;
    if (!recording && !transcript) {
      // マイクも文字起こしも使えない: 録らずに信号と答えだけ（もう送ってある）
      set({ step: "sending", color: "red" });
      const delivery = await redDelivery();
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
    pauseRecording();
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
    resumeRecording();
    openTranscript();
    listen();
  }

  /** 録音と文字起こしを止めて添える（声の問いと聞き直しで取れた文字も合わせる） */
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
    const delivery = await redDelivery();
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
      answers = {};
      lastAnswers = null;
      voiceMode = false;
      rushing = false;
      heard = [];
      listenedMs = 0;
      listeningAt = null;
      try {
        deps.prime?.();
      } catch {
        // 音・マイクを先に通せなくても進める
      }
      // 赤は押した時に送る（一覧にすぐ赤が出る）。答えはこの信号に足していく
      const b = body("red", null);
      signal = { id: b.id, delivery: deps.sendSignal(b).catch((): Delivery => "queued") };
      const first = firstQuestion(asker);
      if (first === null) {
        void finishQuestions();
        return;
      }
      set({ step: "question", id: first, answers, first: true, voice: null });
      after(IDLE_MS, () => void toVoice());
    },
    where(where) {
      if (state.step !== "where") return;
      void deliver(body("green", where));
    },
    answer(choice) {
      if (state.step !== "question") return;
      const id = state.id;
      if (!nextQuestionKnows(id, choice)) return;
      dropAnswerListening();
      record(id, choice, "press");
      advance(nextAfter(id, choice));
    },
    skip() {
      if (state.step !== "question") return;
      const id = state.id;
      dropAnswerListening();
      advance(nextAfter(id, null));
    },
    extend() {
      if (state.step !== "recording" || ending) return;
      const until = Math.min(state.until + RECORD_MS, state.startedAt + MAX_RECORD_MS);
      set({ ...state, until });
      after(until - now(), () => void timeUp());
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
      ask++;
      clear();
      void recording?.stop().catch(() => null);
      void transcript?.stop().catch(() => null);
      void answerTranscript?.stop().catch(() => null);
      recording = null;
      transcript = null;
      answerTranscript = null;
      attempt++;
      ending = false;
    },
  };
}

/** 問いにある選択肢か */
function nextQuestionKnows(id: QuestionId, choice: string): boolean {
  return choiceOf(id, choice) !== undefined;
}
