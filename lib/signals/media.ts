// 本人のスマホの音: 定型文を流す（Gemini TTS の声か、ブラウザの speechSynthesis）、周りの音ごと録音する（MediaRecorder）、
// 同時に文字にする（Web Speech。lib/speech/dictation.ts）。docs/tasks/T10.md。
// 画面（DOM）に触らない。ブラウザの物は作る物・使う物を渡す（テストは偽物で差し替える）。
//
// 携帯のブラウザは、人が押した時（赤を押した時）でないと音を出させない・マイクの許可を聞けないことがある。
// 赤を押した時に prime で音の要素とマイクの許可を先に通しておき、20 秒あとに流す・録る。

import { createDictation, type SpeechRecognitionCtor } from "../speech/dictation.ts";
import { VOICE_PROMPT_TEXT } from "./phrases.ts";

// ---------- 定型文 ----------

/** HTMLAudioElement のうち使う所 */
export type AudioLike = {
  src: string;
  muted: boolean;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
};

/** SpeechSynthesisUtterance のうち使う所 */
export type UtteranceLike = {
  lang: string;
  rate: number;
  volume: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export type SynthLike = { speak(u: UtteranceLike): void; cancel(): void };

export type PromptResult = "audio" | "speech" | "none";

export const PROMPT_TIMEOUT_MS = 20_000; // 頭に AI の告知を足して声が 10 秒ほどになった（T48）

export type PromptPlayer = {
  /** 人が押した時に呼ぶ（音の要素に声を読み込み、鳴らせる状態にする） */
  prime(): void;
  /** 定型文を 1 回流し、終わるのを待つ。Gemini の声が無ければ speechSynthesis、どちらも無ければ none */
  play(): Promise<PromptResult>;
  /** 声の問い（T49）を端末の読み上げで 1 回読み、終わるのを待つ。読み上げが無ければ none */
  say(text: string): Promise<PromptResult>;
  /**
   * 会話の 1 文（T137）。Gemini の声の URL があれば鳴らし、LINE_START_MS で鳴り始めない・鳴らない時は端末の読み上げで同じ文を読む。
   * URL が無ければ端末の読み上げ
   */
  line(text: string, url: string | null): Promise<PromptResult>;
  /**
   * 鳴っている声を止める（T137b。読む間に本人が話し始めたとき）。止めた声は端末の読み上げで読み直さない。
   * あとから始めた声があれば、前の声の失敗で止めたり読み上げたりしない（相づちと問いが重なったとき）
   */
  stop(): void;
};

/** 会話の 1 文の声が鳴り始めるのを待つ上限（決まった文の声を初めて作る時など。過ぎたら端末の読み上げ） */
export const LINE_START_MS = 4_000;

function wait(start: (done: (ok: boolean) => void) => void, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      start(finish);
    } catch {
      finish(false);
    }
  });
}

export function createPromptPlayer(deps: {
  audio: AudioLike | null;
  /** 声の URL（app/api/signals/voice）。鍵が無いときは 404 */
  voiceUrl: string;
  synth: SynthLike | null;
  Utterance: (new (text: string) => UtteranceLike) | null;
  timeoutMs?: number;
}): PromptPlayer {
  const { audio, synth, Utterance } = deps;
  const timeoutMs = deps.timeoutMs ?? PROMPT_TIMEOUT_MS;
  /** Gemini の声が使えない（読み込めない・鳴らせない） */
  let audioFailed = audio === null;
  let primed: Promise<void> | null = null;
  /** 音の要素に今入っている声（会話の 1 文を鳴らしたあと、定型文の声に戻すため） */
  let src: string | null = null;
  /** 声の番号。止めた・あとから始めた声があれば、前の声の続き（止める・読み上げに替える）を当てない */
  let gen = 0;

  return {
    prime() {
      if (audio && !primed) {
        audio.onerror = () => {
          audioFailed = true;
        };
        audio.muted = true;
        audio.src = deps.voiceUrl;
        src = deps.voiceUrl;
        primed = audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          .catch(() => {
            audioFailed = true;
          })
          .finally(() => {
            audio.muted = false;
          });
      }
      // speechSynthesis も押した時に 1 回鳴らしておく（音量 0）
      if (synth && Utterance) {
        try {
          const u = new Utterance(" ");
          u.volume = 0;
          synth.speak(u);
        } catch {
          // 鳴らせない端末
        }
      }
    },
    async play() {
      const mine = ++gen;
      if (primed) await primed;
      if (audio && !audioFailed) {
        const ok = await wait((done) => {
          audio.onended = () => done(true);
          audio.onerror = () => done(false);
          audio.muted = false;
          if (src !== deps.voiceUrl) {
            audio.src = deps.voiceUrl;
            src = deps.voiceUrl;
          }
          audio.currentTime = 0;
          audio.play().catch(() => done(false));
        }, timeoutMs);
        if (ok) return "audio";
        if (mine !== gen) return "none";
        audio.pause();
      }
      if (mine !== gen) return "none";
      return speakWith(VOICE_PROMPT_TEXT);
    },
    say(text) {
      return speakWith(text);
    },
    async line(text, url) {
      const mine = ++gen;
      if (primed) await primed;
      if (audio && url) {
        const ok = await wait((done) => {
          const late = setTimeout(() => done(false), LINE_START_MS);
          audio.onended = () => done(true);
          audio.onerror = () => {
            clearTimeout(late);
            done(false);
          };
          audio.muted = false;
          audio.src = url;
          src = url;
          audio.currentTime = 0;
          audio.play().then(
            () => clearTimeout(late),
            () => {
              clearTimeout(late);
              done(false);
            },
          );
        }, timeoutMs);
        if (ok) return "audio";
        // 止めた・あとの声が始まった: 前の声で止めたり読み上げたりしない
        if (mine !== gen) return "none";
        try {
          audio.pause();
        } catch {
          // 止められない
        }
      }
      if (mine !== gen) return "none";
      return speakWith(text);
    },
    stop() {
      gen++;
      try {
        audio?.pause();
      } catch {
        // 止められない
      }
      try {
        synth?.cancel();
      } catch {
        // 止められない
      }
    },
  };

  /** 端末の読み上げで 1 回読む（前の声は止める） */
  async function speakWith(text: string): Promise<PromptResult> {
    if (synth && Utterance) {
      const ok = await wait((done) => {
        const u = new Utterance(text);
        u.lang = "ja-JP";
        u.rate = 0.9;
        u.volume = 1;
        u.onend = () => done(true);
        u.onerror = () => done(false);
        synth.cancel();
        synth.speak(u);
      }, timeoutMs);
      if (ok) return "speech";
    }
    return "none";
  }
}

// ---------- 録音 ----------

export type TrackLike = { stop(): void };
export type StreamLike = { getTracks(): TrackLike[] };
export type GetUserMedia = (c: { audio: boolean }) => Promise<StreamLike>;

/** MediaRecorder のうち使う所 */
export type RecorderLike = {
  readonly state: string;
  readonly mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  /** 一時停止・再開（無い端末もある） */
  pause?(): void;
  resume?(): void;
};

export type RecorderCtor = {
  new (stream: StreamLike, options?: { mimeType?: string }): RecorderLike;
  isTypeSupported?(type: string): boolean;
};

/** 録る形の順（Chrome・Edge は webm、Safari は mp4、Firefox は ogg） */
export const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const;

export function pickAudioType(isTypeSupported: ((t: string) => boolean) | undefined): string | null {
  if (!isTypeSupported) return null;
  return AUDIO_TYPES.find((t) => isTypeSupported(t)) ?? null;
}

export type RecordingSession = {
  readonly mimeType: string;
  /** 止めて、録れた音声。何も録れていなければ null */
  stop(): Promise<Blob | null>;
  /** 聞き直しの定型文を流す間だけ止める。できない端末は何もしない（録ったまま） */
  pause(): void;
  resume(): void;
};

/** 録り始める。マイクが使えない・MediaRecorder が無いときは null */
export async function startRecording(deps: {
  getUserMedia: GetUserMedia | null;
  Recorder: RecorderCtor | null;
}): Promise<RecordingSession | null> {
  if (!deps.getUserMedia || !deps.Recorder) return null;
  let stream: StreamLike;
  try {
    stream = await deps.getUserMedia({ audio: true });
  } catch {
    return null;
  }
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const type = pickAudioType(deps.Recorder.isTypeSupported?.bind(deps.Recorder));
  let rec: RecorderLike;
  try {
    rec = type ? new deps.Recorder(stream, { mimeType: type }) : new deps.Recorder(stream);
  } catch {
    release();
    return null;
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  try {
    rec.start(1000);
  } catch {
    release();
    return null;
  }
  const mimeType = rec.mimeType || type || "audio/webm";
  let stopped: Promise<Blob | null> | null = null;
  return {
    mimeType,
    pause() {
      try {
        if (rec.state === "recording") rec.pause?.();
      } catch {
        // 止められない端末は録ったまま
      }
    },
    resume() {
      try {
        if (rec.state === "paused") rec.resume?.();
      } catch {
        // 止めていない
      }
    },
    stop() {
      if (!stopped) {
        stopped = wait((done) => {
          rec.onstop = () => done(true);
          rec.onerror = () => done(false);
          if (rec.state === "inactive") done(true);
          else rec.stop();
        }, 4000).then(() => {
          release();
          return chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;
        });
      }
      return stopped;
    },
  };
}

/**
 * マイクの許可を先に聞いておく（赤を押した時）。もう許可されていれば何もしない。
 * 聞いたらすぐ止める（録るのは 20 秒操作が無かったときだけ。マイクを開いたままにしない）。
 * 返すのはマイクが使えそうか（T77）: 許可済み・開けたら true、マイクの道が無い・断られた・開けなかったら false。
 * false なら本人のスマホは声の問いにも録音にも入らない（lib/signals/phone.ts の micReady）
 */
export async function primeMicrophone(deps: {
  getUserMedia: GetUserMedia | null;
  queryPermission?: () => Promise<string>;
}): Promise<boolean> {
  if (!deps.getUserMedia) return false;
  try {
    const state = deps.queryPermission ? await deps.queryPermission() : null;
    if (state === "granted") return true;
    if (state === "denied") return false;
  } catch {
    // permissions.query で microphone を聞けない端末（Firefox など）は、そのまま聞く
  }
  try {
    const s = await deps.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    // 断られた・マイクが無い。録るときにもう一度試し、だめなら録音なしで送る
    return false;
  }
}

// ---------- 文字起こし ----------

export type TranscriptSession = {
  /** 止めて、文字になった物（言い換えない）。何も取れなければ null */
  stop(): Promise<string | null>;
};

/** 長い無音でブラウザが止めたときに聞き直す回数（録っている間だけ） */
export const TRANSCRIPT_RESTARTS = 5;
/** 会話の間ずっと聞くとき（T137b）の聞き直しの上限（ブラウザは静かな間や通信で止めるので多めに。5 分の会話で足りる数） */
export const KEEP_ALIVE_RESTARTS = 60;

/** 文字起こしの知らせ（lib/signals/phone.ts の TranscriptEvents と同じ形） */
export type TranscriptEvents = {
  /** 1 字も取れないまま、ブラウザが無音で止めた（no-speech か、何も聞かずに終わった）。聞き直しは呼ぶ側が決める */
  onSilence?: () => void;
  /** 文字が届いた（途中の文字も）。話している間は録る時間を延ばす（T69b） */
  onText?: (text: string) => void;
  /** ブラウザが止めても回数を限らず続きから聞き直す（T137b。会話の間ずっと聞く） */
  keepAlive?: true;
};

/**
 * Web Speech で文字にし始める。無い端末は null（録音だけ送る）。
 * 人が止める前にブラウザが終わったら続きから聞き直す（TRANSCRIPT_RESTARTS 回まで）。
 * ただし onSilence を渡したときは、1 字も取れずに無音で終わったら聞き直さずに知らせる（T37: 定型文で聞き直すため）
 */
export function startTranscript(Ctor: SpeechRecognitionCtor | null, events: TranscriptEvents = {}): TranscriptSession | null {
  if (!Ctor) return null;
  let text = "";
  let stopping = false;
  let restarts = 0;
  let resolveDone: (v: string | null) => void = () => {};
  const done = new Promise<string | null>((r) => (resolveDone = r));
  const finish = (t: string) => resolveDone(t.trim() ? t.trim() : null);

  const d = createDictation(Ctor, {
    onText: (t) => {
      const changed = t !== text;
      text = t;
      if (changed && t.trim()) events.onText?.(t);
    },
    onDone: (t) => finish(t),
    onEnd: (error) => {
      // 1 字も取れずに無音で終わった: 聞き直しを呼ぶ側に任せる（マイク・通信の失敗は下の聞き直しへ）
      if (!stopping && events.onSilence && !text.trim() && (error === "no_speech" || error === null)) {
        events.onSilence();
        return;
      }
      // 人が止める前に終わった（無音・通信）。録っている間は続きから聞き直す。
      // 会話の間ずっと聞く（keepAlive）ときも、マイクが使えない・失敗が続く（KEEP_ALIVE_RESTARTS 回）ときは聞き直さない（空回りしない）
      const keep = events.keepAlive && error !== "mic" && restarts < KEEP_ALIVE_RESTARTS;
      if (!stopping && (keep || restarts < TRANSCRIPT_RESTARTS)) {
        restarts++;
        if (d.start(text)) return;
      }
      if (stopping || (!keep && restarts >= TRANSCRIPT_RESTARTS)) finish(text);
    },
  });
  if (!d.start("")) return null;
  return {
    stop() {
      stopping = true;
      if (d.state === "listening") d.stop();
      else finish(text);
      return done;
    },
  };
}
