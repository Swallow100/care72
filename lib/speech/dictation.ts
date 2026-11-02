// 話して入れる（T04）。ブラウザの Web Speech（SpeechRecognition）で日本語を文字にし、入れる欄の文に流す。
// 声は文字にするだけで、考える所（欄に分ける）は T03 の抽出（Claude）がする。録音はしない（発災時の録音は T10）。
//
// - 本人の言葉を言い換えない。認識の結果は前後の空白を落とすだけで、句点を足さない・字を直さない
// - 確定した区切り（息つぎ）ごとに改行でつなぐ。lib/intake/diff.ts の sentencesOf が改行で文を分けるので、
//   句点の無い話し言葉でも特記を元の文に戻せる
// - 止め方は 2 つ: 人が「停止」を押した（onDone。呼ぶ側が抽出に送る）と、ブラウザ側で終わった・失敗した（onEnd。送らない）
// - 画面（DOM）に触らない。SpeechRecognition は作る物を渡す（テストは偽物で差し替える）

/** 認識の候補 1 つ */
export type SpeechAlternative = { readonly transcript: string };

/** 認識の結果 1 つ。isFinal なら確定（もう変わらない） */
export type SpeechResult = { readonly isFinal: boolean; readonly length: number; readonly [index: number]: SpeechAlternative };

/** onresult の中身。results は話し始めからの全部（continuous） */
export type SpeechResultEvent = {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResult };
};

export type SpeechErrorEvent = { readonly error: string };

/** SpeechRecognition のうち、ここで使う所だけ（lib.dom に本体の型が無いので自前で持つ） */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * ブラウザの SpeechRecognition（Chrome・Edge・Safari は webkit の名前）。無ければ null（Firefox など）。
 * 引数は window。モジュールの先頭では window に触らない（サーバーとテストで読み込むため）
 */
export function speechRecognitionOf(scope: unknown): SpeechRecognitionCtor | null {
  if (!scope || (typeof scope !== "object" && typeof scope !== "function")) return null;
  const s = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const ctor = s.SpeechRecognition ?? s.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

export type DictationState = "idle" | "listening" | "stopping";

/** ブラウザ側の失敗の分け方。mic はマイクが使えない（許可なし・無い）、no_speech は声が無い、failed はそのほか（通信など） */
export type DictationError = "mic" | "no_speech" | "failed";

/** SpeechRecognition の error の文字を分ける。aborted（こちらで止めた）は null */
export function dictationErrorOf(error: string): DictationError | null {
  switch (error) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
    case "audio-capture":
      return "mic";
    case "no-speech":
      return "no_speech";
    default:
      return "failed";
  }
}

/**
 * 話した区切りを欄の文につなぐ。前が空ならそのまま、前が空白・改行で終われば続けて、ほかは改行を挟む。
 * 区切りの前後の空白だけ落とす（字は変えない）
 */
export function joinSpoken(before: string, piece: string): string {
  const p = piece.trim();
  if (p === "") return before;
  if (before === "" || /\s$/.test(before)) return before + p;
  return `${before}\n${p}`;
}

/**
 * 人が止めたあとに抽出へ送る文。押してから話して足したときだけ、欄の文をそのまま（直した所も含む）。
 * 何も足していない・空白だけなら null（送らない。AI の回数を使わない）
 */
export function dictationToSend({ text, spoken }: { text: string; spoken: boolean }): string | null {
  return spoken && text.trim() !== "" ? text : null;
}

export type DictationHandlers = {
  /** 欄に出す文（押したときの欄の文＋確定した区切り＋認識中の区切り）。結果が来るたび */
  onText: (text: string) => void;
  /**
   * 人が止めて、ブラウザが終わった。text は欄の文（認識中で残った区切りも足した物）、
   * spoken は押してから 1 字でも足されたか。抽出に送るかは呼ぶ側が決める
   */
  onDone: (text: string, spoken: boolean) => void;
  /** ブラウザ側で終わった・失敗した（人は止めていない、または止める前に失敗した）。送らない */
  onEnd: (error: DictationError | null) => void;
  onState?: (state: DictationState) => void;
};

export type DictationOptions = {
  /** 既定 ja-JP */
  lang?: string;
  /** 欄の文の上限（字）。超えたら切って止める（人が止めたのと同じ扱い） */
  maxLength?: number;
  /** 「停止」のあと onend を待つ長さ（ms）。来なければ打ち切って終える。既定 4000 */
  stopTimeoutMs?: number;
};

export type Dictation = {
  /** 聞き始める。base は押したときの欄の文。始められなければ false（onEnd("failed") も呼ぶ） */
  start(base: string): boolean;
  /** 人が止める。onend のあとに onDone */
  stop(): void;
  /** 何も呼ばずにやめる（画面を閉じた・別の人に移った・切り替えた） */
  abort(): void;
  readonly state: DictationState;
};

export function createDictation(Ctor: SpeechRecognitionCtor, handlers: DictationHandlers, opts: DictationOptions = {}): Dictation {
  const max = opts.maxLength ?? Infinity;
  const cut = (s: string) => (s.length > max ? s.slice(0, max) : s);

  let rec: SpeechRecognitionLike | null = null;
  let state: DictationState = "idle";
  /** 押したときの欄の文 */
  let base = "";
  /** base ＋ 確定した区切り */
  let text = "";
  /** 認識中の区切り（確定の前。結果が来るたびに置き換える） */
  let interim = "";
  /** results のうち text に入れた数 */
  let folded = 0;
  let byUser = false;
  let error: DictationError | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setState = (s: DictationState) => {
    state = s;
    handlers.onState?.(s);
  };
  const view = () => cut(joinSpoken(text, interim));

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function finish() {
    clearTimer();
    rec = null;
    text = view();
    interim = "";
    const spoken = text !== base;
    setState("idle");
    handlers.onText(text);
    if (byUser && error === null) handlers.onDone(text, spoken);
    else handlers.onEnd(error);
  }

  function stop() {
    if (state !== "listening" || !rec) return;
    byUser = true;
    setState("stopping");
    const r = rec;
    timer = setTimeout(() => {
      if (rec !== r) return;
      r.onresult = r.onerror = r.onend = null;
      try {
        r.abort();
      } catch {
        // もう終わっている
      }
      finish();
    }, opts.stopTimeoutMs ?? 4000);
    try {
      r.stop();
    } catch {
      finish();
    }
  }

  return {
    get state() {
      return state;
    },
    start(initial: string) {
      if (state !== "idle") return false;
      const r = new Ctor();
      r.lang = opts.lang ?? "ja-JP";
      r.continuous = true;
      r.interimResults = true;
      base = cut(initial);
      text = base;
      interim = "";
      folded = 0;
      byUser = false;
      error = null;

      r.onresult = (e) => {
        if (rec !== r) return;
        let pending = "";
        for (let i = folded; i < e.results.length; i++) {
          const res = e.results[i];
          const t = res && res.length > 0 ? res[0].transcript : "";
          // 確定は前から続いている物だけ入れる（間に認識中があれば、そのあとの確定も認識中として出す）
          if (res?.isFinal && i === folded) {
            text = joinSpoken(text, t);
            folded = i + 1;
          } else {
            pending += t.trim();
          }
        }
        interim = pending;
        handlers.onText(view());
        if (text.length >= max) stop();
      };
      r.onerror = (e) => {
        if (rec !== r) return;
        error = dictationErrorOf(e.error) ?? error;
      };
      r.onend = () => {
        if (rec !== r) return;
        finish();
      };

      rec = r;
      setState("listening");
      try {
        r.start();
      } catch {
        rec = null;
        error = "failed";
        setState("idle");
        handlers.onEnd(error);
        return false;
      }
      return true;
    },
    stop,
    abort() {
      clearTimer();
      const r = rec;
      rec = null;
      interim = "";
      if (r) {
        r.onresult = r.onerror = r.onend = null;
        try {
          r.abort();
        } catch {
          // もう終わっている
        }
      }
      if (state !== "idle") setState("idle");
    },
  };
}
