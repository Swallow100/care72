// 本人のスマホの災害モードの流れ（docs/tasks/T10.md）。画面（components/phone）はここの状態を描き、押した物を渡すだけ。
// 画面（DOM）に触らない。送る道・音・録音は渡す（テストは偽物と偽の時計）。
//
//   上（無事・無事じゃない）
//   ├ 無事 → どこに いますか（家・避難所・ほか）→ 送る → とどきました
//   └ 無事じゃない → 信号を送る → 1 画面 1 問（lib/signals/questions.ts の枝。押すたびに答えを送る・とばす）→ とどきました（＋119 の 1 行）
//        ├ 頼みたい ことを「はなす」→ 定型文 → 60 秒録る（話している間は 60 秒ずつ延びる。上限 180 秒。T69b）
//        ├ けが・動けない・出られない・水・火やガス・機器の停止の答え → 残りの問いを飛ばして定型文と録音へ（T69b。
//        │   けが ある のあとに 動けるか がまだ無ければ「動けますか」の 1 問だけ聞いてから）
//        └ 1 つも押さずに 20 秒 → 声の問い（T49）: 問いと選択肢を読み上げ（最初は AI の告知から）→ 10 秒聞く →
//             言葉の一致で答える（無ければ答えなしで次へ）→ … → 問いが終わったら定型文 → 60 秒録る（延長は押せば・話している間は自動）→ 録音を添える
//             └ 無音のまま止まった → 同じ定型文で聞き直す（2 回まで）→ それでも無音なら録音を送って「ろくおんを おくりました」
//
// - 赤の信号は押した時に送る（一覧にすぐ赤が出る）。答えは押すたびに、それまでの全部を同じ信号に送る（後勝ち）。録音はあとで添える
// - 20 秒は、赤を押した時か、最後に答えた時から数える。送ったあとは数えない。緑には音声が無い
// - 声の問いは、問いを読み上げる道（speak）がある端末だけ。無ければ今まで通り 20 秒で定型文へ。
//   声の問いに入ったら終わりまで声で進む（押せばその答えも取る）。録音は声の問いに入った時に始め、読み上げる間だけ止める（1 本のまま）
// - 声の問いで聞き取れた文字は録音の文字起こしにも足す（本人の言葉。聞き取りメモの元）
// - 無音のまま止まった（T37）: 1 回の聞き取り（定型文のあとの 30 秒）の間に文字が 1 字も
//   取れずに、ブラウザの文字起こしが無音で終わった（startTranscript の onSilence）か、30 秒が過ぎた。同じ定型文を流して聞き直し、
//   2 回聞き直しても無音なら録音を送って終える。文字起こしの無い端末は無音が分からないので聞き直さない（今まで通り）。
//   人が「送る」を押したときは聞き直さない
// - 録音は 1 本のまま（サーバーは 1 つの信号に 1 回だけ添える）。定型文を流す間は録音を止め（pause。できない端末は録ったまま）、
//   文字起こしは止めてから流す（定型文の声を文字にしない）。うめき声など文字にならない音は、どの回の物も同じ録音に残る
// - 場所（T69b）: 避難所 → 計画の避難先 1・2 から選ぶ（台帳に避難先がある人だけ。押す画面だけ）。車・ほかの ところ → 本人の画面だけ
//   「いまの 場所を おくりますか」（はい なら端末の位置を 1 回取って信号に添える。取れない・断られたら何も送らず次へ。声の問いでは聞かない）
// - 押せる人・マイク（T77、docs/progress/qa-20261104.md の中 14）: 答え・とばすを 1 つでも押した人は、考えている間に声の問いへ
//   替えず（20 秒で声にしない）、録音の無音の聞き直しも挟まない（「おくる」を押せる。60 秒か話し終わるまで録って送る）。
//   マイクが無い・許されていない（赤を押した時の許可か、録り始めて分かる）ときは、声の問いにも定型文と録音にも入らず、
//   「たのみたい ことは ありますか」（はなす）も聞かない。押せばそのまま次の問いへ（赤はもう届いている）
// - 戻るは無い。終わったら「最初から」で上へ（家族の画面と同じ言葉。T80）
// - 声の聞き取りの会話（T137）: 会話の道（talk）を渡した端末では、20 秒押さない人の声の問い（T49）の代わりに短い会話をする。
//   定型文（AI の告知から）→ 聞く（話し終えて 3 秒静かになるまで。話さなければ 15 秒）→ 次の手（lib/signals/talk.ts の planTalk と
//   サーバーの nextTalk。Claude は次の 1 文だけ）→ 読む → 聞く … → 締め（119 の文で終わる）→ 録音と会話の記録を添えて送る。
//   命に関わる言葉・終えたい・上限は締め、聞き取れないが 2 回続いたらボタンの答え方（はいなら緑・いいえなら赤）に替えて応答不明瞭の印。
//   サーバーに届かない・遅い（8 秒）ときは端末だけで決まった問いを続ける。決まった問いのまま取れた答えは押した答えと同じに送る（声の印）

import { newSignalId, NO_ANSWERS, type PhoneColor, type SignalBody } from "./body.ts";
import type { AnswersItem, AttachItem, Delivery, LocationItem, ReportedPosition } from "./outbox.ts";
import { AI_NOTICE_VOICE } from "./phrases.ts";
import {
  buttonLine,
  buttonQuestions,
  buttonVoice,
  closingOf,
  closingVoice,
  fixedLine,
  heardTurn,
  newTalkLog,
  planTalk,
  TALK_OPENING,
  talkReplies,
  topicOfQuestion,
  yesNoChoice,
  type TalkBy,
  type TalkEnd,
  type TalkLine,
  type TalkLog,
} from "./talk.ts";
import type { TalkReply } from "./talk-ai.ts";
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

/** 会話（T137）で、話し始めを待つ長さ。話さなければこの長さで 1 往復を閉じる */
export const TALK_LISTEN_MS = 15_000;
/** 会話で、話し終えたとみなす静かな間（最後に文字が届いてから） */
export const TALK_QUIET_MS = 3_000;
/** 会話の 1 回の答えの長さの上限（話し続けても閉じる） */
export const TALK_TURN_MAX_MS = 45_000;
/** 会話の次の手をサーバーに聞いて待つ上限。過ぎたら端末だけで決まった問い */
export const TALK_WAIT_MS = 8_000;
/** 締めの文（119 の文まで）が終わらないときに待つ上限 */
export const CLOSING_WAIT_MS = 25_000;

export type PhoneState =
  | { step: "top" }
  | { step: "where" }
  /** first は赤の流れの最初の問い（AI の告知を出す）。voice は声の問いの段（押す問いは null） */
  | { step: "question"; id: QuestionId; answers: Answers; first: boolean; voice: VoiceStep | null }
  /** いまの 場所を おくりますか（T69b。車・ほかの ところ のあと、本人の画面だけ） */
  | { step: "locate"; answers: Answers }
  | { step: "prompt" }
  /**
   * 声の聞き取りの会話（T137）。line は読む文（ふりがなを落とした文）、easy は決まった文の画面の文（AI の文は null）、
   * by は文を作った物（ai は AI の印）、first は最初の問い（AI の告知を出す）。thinking は次の 1 文を決めている間
   */
  | { step: "talk"; line: string; easy: string | null; by: TalkBy; first: boolean; voice: VoiceStep | "thinking" }
  /** ボタンの答え方（T137。聞き取れないが続いたとき）: はい（緑）・いいえ（赤）・とばす */
  | { step: "yesno"; id: QuestionId; answers: Answers; voice: "speaking" | null }
  /** 会話の締め（T137）。easy は画面の文。danger は命に関わる言葉のとき（119 の文を先に読んだ） */
  | { step: "closing"; easy: string; danger: boolean }
  | { step: "recording"; startedAt: number; until: number }
  | { step: "sending"; color: PhoneColor }
  /** silent: 文字が 1 字も取れないまま録音だけ送った（「ろくおんを おくりました」） */
  | { step: "done"; color: PhoneColor; delivery: Delivery; silent?: true };

export type Stoppable<T> = { stop(): Promise<T> };

/** 録音。定型文を流す間だけ止める（pause・resume が無い端末は録ったまま） */
export type Recording = Stoppable<Blob | null> & { pause?(): void; resume?(): void };

/**
 * 文字起こしの知らせ。onSilence は 1 字も取れないまま無音で止まったとき（渡さなければブラウザが続きから聞き直す。
 * 押せる人の録音は無音で閉じない。T77）、onText は文字が届いたとき（T69b。録音の自動の延長）
 */
export type TranscriptEvents = { onSilence?(): void; onText?(text: string): void };

export type PhoneDeps = {
  now?: () => number;
  newId?: () => string;
  sendSignal(body: SignalBody): Promise<Delivery>;
  sendRecording(item: AttachItem, audio: Blob | null): Promise<Delivery>;
  /** 聞き取りの答え（T49）。押すたびに、それまでの全部 */
  sendAnswers(item: AnswersItem): Promise<Delivery>;
  /** 台帳に機器がある（機器の問いを聞く） */
  hasDevice?: boolean;
  /** 台帳の避難先の数（T69b。0 なら「どこの 避難所ですか」を聞かない） */
  shelters?: number;
  /**
   * 端末の位置を 1 回取る（T69b。Geolocation、10 秒・高精度なし）。取れない・断られたら null。押した時にすぐ呼ぶ（許可の窓を押した操作から出す）。
   * 無ければ「いまの 場所を おくりますか」は出さない
   */
  locate?(): Promise<ReportedPosition | null>;
  /** 位置を信号に添えて送る（T69b） */
  sendLocation?(item: LocationItem): Promise<Delivery>;
  /** 声の問いを読み上げて、終わるのを待つ（端末の読み上げ）。無ければ声の問いは無い */
  speak?(text: string): Promise<unknown>;
  /** 赤を押した時（人が押した時に、音とマイクの許可を通しておく） */
  prime?(): void;
  /**
   * 赤を押した時のマイクの許可の結果（prime のあと。T77）。false はマイクが無い・許されていない: 声の問いにも、
   * 定型文と録音にも入らず、「たのみたい ことは ありますか」（はなす）も聞かない。無ければ分からないまま（録り始めて分かる）
   */
  micReady?(): Promise<boolean>;
  /** 定型文を流して、終わるのを待つ */
  playPrompt(): Promise<unknown>;
  startRecording(): Promise<Recording | null>;
  startTranscript?(events: TranscriptEvents): Stoppable<string | null> | null;
  /**
   * 声の聞き取りの会話（T137）。1 往復を聞くたびに会話の記録の全部を送り、次の手を受け取る（app/api/signals/[id]/talk）。
   * 届かない・失敗は null（端末の決まりで決まった問いを続ける）。無ければ会話をせず、今までの声の問い（T49）
   */
  talk?(signalId: string, log: TalkLog): Promise<TalkReply | null>;
  /** 会話の 1 文を読んで、終わるのを待つ。voice は Gemini の声の URL（無い・鳴らない時は端末の読み上げ）。無ければ speak */
  say?(text: string, voice?: string | null): Promise<unknown>;
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
  /** ボタンの答え方（T137）: はい（true）・いいえ（false） */
  yesNo(yes: boolean): void;
  /** いまの 場所を おくりますか（T69b）: はい（true）・いいえ（false） */
  locate(send: boolean): void;
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
  const asker: Asker = { who: "self", hasDevice: deps.hasDevice ?? false, shelters: deps.shelters ?? 0 };
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
  let canHear = false;
  /** 無音なら定型文で聞き直す（文字起こしが使えて、押せない人。T77） */
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
  /** 場所を送るかの画面のあとの問い（T69b） */
  let afterLocate: QuestionId | null = null;
  // ---- 押せる人・マイク（T77） ----
  /**
   * 赤のあとに答え・とばす・場所を送るかを押した（押せる人）。押せる人には、考えている間に声の問いへ替えず（20 秒で声にしない）、
   * 録音の無音の聞き直しも挟まない（「おくる」を押せる。60 秒か話し終わるまで録って送る）
   */
  let pressed = false;
  /** 赤を押した時のマイクの許可（micReady）。分からない間は null */
  let micOk: boolean | null = null;
  /** マイクが無い・許されていないと分かった。声の問い・定型文と録音・「はなす」の問いに入らない */
  let micMissing = false;
  // ---- 声の聞き取りの会話（T137） ----
  /** 会話の記録。会話に入っていなければ null */
  let talkLog: TalkLog | null = null;
  /** 今読んだ（聞いている）1 文 */
  let talkLine: TalkLine | null = null;
  /** 今の 1 往復の聞き取り */
  let talkTranscript: Stoppable<string | null> | null = null;
  /** 今の 1 往復を聞き始めた時刻 */
  let talkTurnAt = 0;
  /** 文字起こしが使えた（聞き取れないが続いたのを本人の答えとして数える。使えない端末は印を付けない） */
  let talkEars = false;
  /** ボタンの答え方で聞く残りの問い */
  let buttonQueue: QuestionId[] = [];

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
    // 声の問いで進んでいる間は、押す画面だけの問い（避難所の名前）を聞かず、声だけの問い（連絡手段）を聞く。
    // マイクが無いと分かったら「はなす」の問いを聞かない（T77）。答えで決まっている問い（外にいる人の 外に出られるか）も聞かない
    const a: Asker = { ...asker, ...(voiceMode ? { voice: true } : {}), ...(micMissing ? { mic: false } : {}) };
    return rushing ? rushNext(id, answers, a) : nextQuestion(id, choice, a, answers);
  }

  /** 声の問いの聞き取りを閉じる（押した・次へ進んだ）。取れた文字は返さない */
  function dropAnswerListening() {
    ask++;
    const t = answerTranscript;
    answerTranscript = null;
    if (t) void t.stop().catch(() => null);
    closeListening(now());
  }

  /** 場所を送るかの画面を出て、その次の問いへ（20 秒押さなければ送らずに次へ） */
  function leaveLocate() {
    if (state.step !== "locate") return;
    const next = afterLocate;
    afterLocate = null;
    advance(next);
  }

  /** 次の問いへ。null は問いの終わり */
  function advance(next: QuestionId | null) {
    clear();
    if (next !== null && !(voiceMode && next === "request")) {
      if (voiceMode) void askByVoice(next, false);
      else {
        set({ step: "question", id: next, answers, first: false, voice: null });
        // 押せる人・マイクの無い人は 20 秒で声に替えない（T77）
        if (!pressed && !micMissing) after(IDLE_MS, () => void toVoice());
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

  /**
   * 20 秒押さなかった: 問いを声で読む端末なら声の問いへ、無ければ定型文へ。
   * 押せる人（答えを押した）とマイクが無い・許されていない人には何もしない（T77。押せばそのまま進む。赤はもう届いている）
   */
  async function toVoice() {
    if (state.step !== "question" || state.voice !== null) return;
    if (pressed || micMissing) return;
    if (!deps.speak) {
      void toPrompt();
      return;
    }
    const mine = run;
    const my = ask;
    const id = state.id;
    // 録音は声の問いに入った時に始める（周りの音も残す）。読み上げる間は止める
    const rec = await deps.startRecording().catch(() => null);
    if (mine !== run) {
      void rec?.stop();
      return;
    }
    // マイクを待つ間に押した: 押した方の流れ（押す画面のまま次の問い）に任せる。声の問いに入らず、開いたマイクは閉じる
    if (my !== ask || pressed) {
      void rec?.stop().catch(() => null);
      return;
    }
    // マイクが無い・許されていない（録音も文字起こしもできない）: 声の問いに入らない（T77）。許可が通っていて録音だけ無い端末は文字起こしで進む
    if (!rec && micOk !== true) {
      micMissing = true;
      return;
    }
    voiceMode = true;
    recording = rec;
    // 会話の道がある端末は、問いの表を読む代わりに短い会話（T137）
    if (deps.talk) {
      startTalk();
      return;
    }
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

  // ---------- 声の聞き取りの会話（T137） ----------

  /** 1 文を読んで終わるのを待つ（終わらなければ打ち切る） */
  const sayOnce = (text: string, waitMs: number, voice: string | null = null) =>
    Promise.race([
      Promise.resolve()
        .then(() => (deps.say ? deps.say(text, voice) : deps.speak?.(text)))
        .catch(() => undefined),
      new Promise((r) => setTimeout(r, waitMs)),
    ]);

  function startTalk() {
    talkLog = newTalkLog(iso(now()));
    talkEars = false;
    buttonQueue = [];
    void talkSay(TALK_OPENING);
  }

  const talkState = (line: TalkLine, voice: VoiceStep | "thinking"): PhoneState => ({
    step: "talk",
    line: line.text,
    easy: line.easy,
    by: line.by,
    first: line.topic === "open",
    voice,
  });

  /** 1 文を読む（最初の問いは定型文の声。録音は読む間だけ止める）→ 聞く */
  async function talkSay(line: TalkLine) {
    const mine = run;
    const my = ++ask;
    talkLine = line;
    set(talkState(line, "speaking"));
    pauseRecording();
    if (line.topic === "open") await playPrompt();
    else await sayOnce(line.text, SPEAK_WAIT_MS, line.voice ?? null);
    if (mine !== run || my !== ask) return;
    resumeRecording();
    talkListen(my);
  }

  /** 聞く: 話し終えて静かになるまで（話さなければ TALK_LISTEN_MS、話し続けても TALK_TURN_MAX_MS） */
  function talkListen(my: number) {
    if (!talkLine) return;
    const mine = run;
    set(talkState(talkLine, "listening"));
    listeningAt = now();
    talkTurnAt = listeningAt;
    const live = () => mine === run && my === ask;
    talkTranscript =
      deps.startTranscript?.({
        onSilence: () => {
          if (live()) void talkHeard(my);
        },
        onText: () => {
          if (!live()) return;
          if (now() - talkTurnAt >= TALK_TURN_MAX_MS) void talkHeard(my);
          else after(TALK_QUIET_MS, () => void talkHeard(my));
        },
      }) ?? null;
    if (talkTranscript) talkEars = true;
    after(TALK_LISTEN_MS, () => void talkHeard(my));
  }

  /** 1 往復を閉じて、本人の言葉を記録に足し、次の手へ */
  async function talkHeard(my: number) {
    if (my !== ask || state.step !== "talk" || !talkLog || !talkLine) return;
    clear();
    const mine = run;
    const token = ++ask;
    const t = talkTranscript;
    talkTranscript = null;
    closeListening(now());
    const text = (await t?.stop().catch(() => null))?.trim() ?? "";
    if (mine !== run || token !== ask || !talkLog) return;
    if (text) heard.push(text);
    const turn = heardTurn(talkLine, text || null, iso(talkTurnAt));
    talkLog.turns.push(turn);
    // 決まった問いのまま取れた答えは、押した答えと同じに送る（声の印。ルールの表の 4 列にもなる）
    if (turn.answer) record(turn.answer.id, turn.answer.choice, "voice");
    await talkNext(token);
  }

  /** 次の手: 端末の決まり（planTalk）を先に当て、次の 1 文はサーバー（Claude）に聞く。届かなければ決まった問い */
  async function talkNext(token: number) {
    const log = talkLog;
    if (!log || !talkLine) return;
    const mine = run;
    const plan = planTalk(log, { hasDevice: asker.hasDevice, answers, now: now() });
    if (plan.kind === "danger") {
      log.danger = plan.danger;
      return talkClose("danger");
    }
    if (plan.kind === "close") return talkClose(plan.end);
    if (plan.kind === "buttons") return toButtons();
    set(talkState(talkLine, "thinking"));
    let reply: TalkReply | null = null;
    if (deps.talk && signal) {
      const asked = deps.talk(signal.id, structuredClone(log)).catch(() => null);
      reply = await Promise.race([asked, new Promise<null>((r) => setTimeout(() => r(null), TALK_WAIT_MS))]);
    }
    if (mine !== run || token !== ask || !talkLog) return;
    if (reply?.called) log.aiCalls++;
    if (!reply) return talkSay(fixedLine(plan.fallback));
    if (reply.kind === "danger") {
      log.danger = reply.danger;
      return talkClose("danger");
    }
    if (reply.kind === "close") return talkClose(reply.end);
    if (reply.kind === "buttons") return toButtons();
    const line = reply.line;
    const ok = typeof line?.text === "string" && line.text.length > 0 && line.text.length <= 80;
    return talkSay(ok ? line : fixedLine(plan.fallback));
  }

  /** ボタンの答え方へ（聞き取れないが続いた）。文字起こしの使えた端末だけ応答不明瞭の印 */
  function toButtons() {
    if (!talkLog) return;
    if (talkEars) talkLog.unclear = true;
    buttonQueue = buttonQuestions(talkLog, answers);
    void buttonAsk();
  }

  /** ボタンの答え方の次の 1 問を読む（はいなら みどり…）。20 秒押さなければ答えなしで次へ。全部終えたら締め */
  async function buttonAsk() {
    if (!talkLog) return;
    const id = buttonQueue.shift();
    if (!id) return talkClose(talkLog.unclear ? "unclear" : "grasped");
    const mine = run;
    const my = ++ask;
    set({ step: "yesno", id, answers, voice: "speaking" });
    pauseRecording();
    await sayOnce(buttonLine(id), SPEAK_WAIT_MS, buttonVoice(id));
    if (mine !== run || my !== ask) return;
    resumeRecording();
    set({ step: "yesno", id, answers, voice: null });
    after(IDLE_MS, () => {
      if (my !== ask || !talkLog) return;
      ask++;
      talkLog.turns.push({ ask: buttonLine(id), by: "fixed", topic: topicOfQuestion(id), reply: null, heard: "silent", at: iso(now()) });
      void buttonAsk();
    });
  }

  /** 締めの文（119 の文で終わる）を読んで、録音と会話の記録を添えて送る */
  async function talkClose(end: TalkEnd) {
    const log = talkLog;
    if (!log || log.end !== null) return;
    clear();
    const mine = run;
    ++ask;
    log.end = end;
    const t = talkTranscript;
    talkTranscript = null;
    if (t) {
      closeListening(now());
      const text = (await t.stop().catch(() => null))?.trim() ?? "";
      if (text && talkLine) log.turns.push(heardTurn(talkLine, text, iso(talkTurnAt)));
      if (text) heard.push(text);
    }
    if (mine !== run) return;
    const c = closingOf(end);
    log.closing = c.text;
    set({ step: "closing", easy: c.easy, danger: end === "danger" });
    pauseRecording();
    await sayOnce(c.text, CLOSING_WAIT_MS, closingVoice(end));
    if (mine !== run) return;
    await sendTalk();
  }

  /** 録音を止めて、会話の記録と本人の言葉を添える */
  async function sendTalk() {
    const log = talkLog;
    if (!log || !signal) return;
    const mine = run;
    const sig = signal;
    set({ step: "sending", color: "red" });
    const endedAt = now();
    closeListening(endedAt);
    const audio = await (recording?.stop().catch(() => null) ?? Promise.resolve(null));
    recording = null;
    const words = talkReplies(log);
    const delivery = await redDelivery();
    await deps
      .sendRecording(
        { signalId: sig.id, transcript: words, durationSec: Math.round(listenedMs / 1000), recordedAt: iso(endedAt), talk: structuredClone(log) },
        audio,
      )
      .catch(() => "queued" as const);
    if (mine !== run) return;
    // 文字が 1 字も取れず、ボタンも押さず、録音だけ送った
    const pressedAny = log.turns.some((x) => x.heard === "press");
    const silent = talkEars && words === null && !pressedAny && audio !== null;
    set({ step: "done", color: "red", delivery, ...(silent ? { silent: true as const } : {}) });
  }

  // ---------- 定型文と録音 ----------

  /**
   * 文字起こしを始める。無音で止まったら、この回の聞き取りを閉じる（聞き直しへ）。
   * 押せる人は聞き直さないので無音で閉じない（ブラウザが続きから聞き直し、60 秒か話し終わるまで録る。T77）
   */
  function openTranscript() {
    const mine = ++attempt;
    const onText = () => {
      if (mine === attempt) lastHeardAt = now();
    };
    const onSilence = () => {
      if (mine === attempt) void windowEnded();
    };
    transcript = deps.startTranscript?.(pressed ? { onText } : { onSilence, onText }) ?? null;
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
    // マイクが無い・許されていないと分かっている（T77）: 話してもらう定型文を流さず、送った赤と答えだけで終える
    if (micMissing && !recording) {
      await finishQuestions();
      return;
    }
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
      if (!rec && micOk !== true) micMissing = true;
    }
    asks = 0;
    ending = false;
    finishWanted = false;
    // マイクが無ければ文字起こし（Web Speech もマイクを使う）も聞けない。無音の聞き直しで定型文を流し続けない（T77）
    if (!micMissing) openTranscript();
    // 押せる人は無音で聞き直さない（「おくる」を押せる。T77）
    canHear = transcript !== null;
    canReask = canHear && !pressed;
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
    const silent = canHear && words === null && audio !== null;
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
      pressed = false;
      micOk = null;
      micMissing = false;
      heard = [];
      listenedMs = 0;
      listeningAt = null;
      talkLog = null;
      talkLine = null;
      buttonQueue = [];
      try {
        deps.prime?.();
      } catch {
        // 音・マイクを先に通せなくても進める
      }
      // マイクの許可の結果（T77）。無い・断られたと分かったら、声の問いと録音に入らない。押した次の問いから「はなす」を聞かない
      const mine = run;
      void Promise.resolve()
        .then(() => deps.micReady?.())
        .then(
          (ok) => {
            if (mine !== run || ok === undefined) return;
            micOk = ok;
            if (!ok) micMissing = true;
          },
          () => undefined,
        );
      // 赤は押した時に送る（一覧にすぐ赤が出る）。答えはこの信号に足していく
      const b = body("red", null);
      signal = { id: b.id, delivery: deps.sendSignal(b).catch((): Delivery => "queued") };
      const first = firstQuestion(asker);
      if (first === null) {
        void finishQuestions();
        return;
      }
      set({ step: "question", id: first, answers, first: true, voice: null });
      // 20 秒押さなければ声の問い（押せない人のため）。マイクが無いと分かれば toVoice は何もしない
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
      pressed = true;
      dropAnswerListening();
      record(id, choice, "press");
      const next = nextAfter(id, choice);
      // 車・ほかの ところ（T69b）: 位置を送るかを聞く（押す画面だけ。位置を取れる端末だけ）
      if (!voiceMode && choiceOf(id, choice)?.asksLocation && deps.locate && deps.sendLocation && signal) {
        clear();
        afterLocate = next;
        set({ step: "locate", answers });
        after(IDLE_MS, () => leaveLocate());
        return;
      }
      advance(next);
    },
    yesNo(yes) {
      if (state.step !== "yesno" || !talkLog) return;
      const id = state.id;
      const choice = yesNoChoice(id, yes);
      clear();
      ask++;
      pressed = true;
      if (choice) record(id, choice, "press");
      talkLog.turns.push({
        ask: buttonLine(id),
        by: "fixed",
        topic: topicOfQuestion(id),
        reply: null,
        heard: "press",
        ...(choice ? { answer: { id, choice } } : {}),
        at: iso(now()),
      });
      void buttonAsk();
    },
    skip() {
      if (state.step === "yesno" && talkLog) {
        const id = state.id;
        clear();
        ask++;
        pressed = true;
        talkLog.turns.push({ ask: buttonLine(id), by: "fixed", topic: topicOfQuestion(id), reply: null, heard: "skip", at: iso(now()) });
        void buttonAsk();
        return;
      }
      if (state.step !== "question") return;
      const id = state.id;
      pressed = true;
      dropAnswerListening();
      advance(nextAfter(id, null));
    },
    locate(send) {
      if (state.step !== "locate") return;
      pressed = true;
      clear();
      if (send && signal && deps.locate && deps.sendLocation) {
        const signalId = signal.id;
        const sendLocation = deps.sendLocation;
        // 押した操作の中で位置を取り始める（許可の窓）。待たずに次の問いへ。取れない・断られたら何も送らない
        void deps
          .locate()
          .then((pos) => (pos ? sendLocation({ signalId, ...pos }) : null))
          .catch(() => null);
      }
      leaveLocate();
    },
    extend() {
      if (state.step !== "recording" || ending) return;
      const until = Math.min(state.until + RECORD_MS, state.startedAt + MAX_RECORD_MS);
      set({ ...state, until });
      after(until - now(), () => void timeUp());
    },
    finish() {
      // 会話の途中で「送る」: 締めの文を読んで送る（T137）
      if (state.step === "talk" && talkLog) {
        void talkClose("send");
        return;
      }
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
      void talkTranscript?.stop().catch(() => null);
      recording = null;
      transcript = null;
      answerTranscript = null;
      talkTranscript = null;
      attempt++;
      ending = false;
    },
  };
}

/** 問いにある選択肢か */
function nextQuestionKnows(id: QuestionId, choice: string): boolean {
  return choiceOf(id, choice) !== undefined;
}
