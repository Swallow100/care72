// 話して入れる（T04）のテスト。SpeechRecognition は偽物（ブラウザもマイクも使わない）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreNote, sentencesOf } from "../intake/diff.ts";
import {
  createDictation,
  dictationErrorOf,
  dictationToSend,
  joinSpoken,
  speechRecognitionOf,
  type DictationError,
  type DictationState,
  type SpeechRecognitionLike,
  type SpeechResult,
} from "./dictation.ts";

/** 偽の SpeechRecognition。作られた物を並べておき、テストから結果・失敗・終わりを送る */
class FakeRecognition implements SpeechRecognitionLike {
  static made: FakeRecognition[] = [];
  static failStart = false;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  /** 話し始めからの結果（continuous） */
  private results: SpeechResult[] = [];
  constructor() {
    FakeRecognition.made.push(this);
  }
  start() {
    if (FakeRecognition.failStart) throw new Error("InvalidStateError");
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  abort() {
    this.aborted++;
  }
  /** 結果を送る。確定した物は残り、認識中の物は次で置き換わる（ブラウザと同じ） */
  say(pieces: Array<[string, boolean]>) {
    const kept = this.results.filter((r) => r.isFinal);
    const resultIndex = kept.length;
    this.results = [...kept, ...pieces.map(([t, isFinal]) => ({ isFinal, length: 1, 0: { transcript: t } }))];
    this.onresult?.({ resultIndex, results: { ...this.results, length: this.results.length } });
  }
  fail(error: string) {
    this.onerror?.({ error });
  }
  end() {
    this.onend?.();
  }
}

function setup(opts: Parameters<typeof createDictation>[2] = {}) {
  const log = {
    texts: [] as string[],
    done: [] as Array<{ text: string; spoken: boolean }>,
    ended: [] as Array<DictationError | null>,
    states: [] as DictationState[],
  };
  const d = createDictation(
    FakeRecognition,
    {
      onText: (t) => log.texts.push(t),
      onDone: (text, spoken) => log.done.push({ text, spoken }),
      onEnd: (e) => log.ended.push(e),
      onState: (s) => log.states.push(s),
    },
    opts,
  );
  const last = () => FakeRecognition.made[FakeRecognition.made.length - 1];
  const field = () => log.texts[log.texts.length - 1];
  return { d, log, last, field };
}

beforeEach(() => {
  FakeRecognition.made = [];
  FakeRecognition.failStart = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("speechRecognitionOf（対応しているか）", () => {
  it("無ければ null（Firefox など。ボタンを出さない）", () => {
    expect(speechRecognitionOf({})).toBeNull();
    expect(speechRecognitionOf(undefined)).toBeNull();
    expect(speechRecognitionOf(null)).toBeNull();
    expect(speechRecognitionOf({ SpeechRecognition: "x" })).toBeNull();
  });
  it("標準の名前、無ければ webkit の名前", () => {
    class A {}
    class B {}
    expect(speechRecognitionOf({ webkitSpeechRecognition: B })).toBe(B);
    expect(speechRecognitionOf({ SpeechRecognition: A, webkitSpeechRecognition: B })).toBe(A);
  });
});

describe("話して入れる: 欄に流れる", () => {
  it("日本語で、続けて・認識中も聞く", () => {
    const { d, last } = setup();
    expect(d.start("")).toBe(true);
    expect(last().lang).toBe("ja-JP");
    expect(last().continuous).toBe(true);
    expect(last().interimResults).toBe(true);
    expect(last().started).toBe(1);
    expect(d.state).toBe("listening");
  });

  it("認識中の区切りは置き換わり、確定した区切りは改行でつながる。押したときの欄の文は残る", () => {
    const { d, last, field } = setup();
    d.start("訪問 11/2");
    last().say([["はちじゅう", false]]);
    expect(field()).toBe("訪問 11/2\nはちじゅう");
    last().say([["88歳独居", false]]);
    expect(field()).toBe("訪問 11/2\n88歳独居");
    last().say([["88歳独居", true], ["認知", false]]);
    expect(field()).toBe("訪問 11/2\n88歳独居\n認知");
    last().say([["認知症で民生委員の〇〇さんが週2回来る", true]]);
    last().say([["土砂の区域", true]]);
    expect(field()).toBe("訪問 11/2\n88歳独居\n認知症で民生委員の〇〇さんが週2回来る\n土砂の区域");
  });

  it("字を変えない（前後の空白を落とすだけ。句点を足さない・半角や伏せ字もそのまま）", () => {
    const { d, last, field } = setup();
    d.start("");
    const said = ["  ﾍﾙﾊﾟｰ さん は 火曜 ", "インスリン4単位 朝", "〇〇さんって言ってた"];
    for (const s of said) last().say([[s, true]]);
    expect(field()).toBe(said.map((s) => s.trim()).join("\n"));
    expect(field()).not.toContain("。");
  });

  it("欄の文が空白・改行で終わっていれば改行を足さない", () => {
    expect(joinSpoken("メモ\n", "続き")).toBe("メモ\n続き");
    expect(joinSpoken("メモ ", "続き")).toBe("メモ 続き");
    expect(joinSpoken("", " 続き ")).toBe("続き");
    expect(joinSpoken("メモ", "   ")).toBe("メモ");
  });

  it("話した文は改行で文に分かれ、特記を元の 1 行に戻せる（言い換えない）", () => {
    const { d, last, field } = setup();
    d.start("");
    last().say([["娘は県外で夜は来られない", true]]);
    last().say([["民生委員の〇〇さんが週2回来る", true]]);
    const text = field();
    expect(sentencesOf(text)).toEqual(["娘は県外で夜は来られない", "民生委員の〇〇さんが週2回来る"]);
    // 伏せた文（仮名化のあと）の 2 行目を Claude が写したら、元の 2 行目に戻る
    const scrubbed = "娘は県外で夜は来られない\n民生委員の（氏名）が週2回来る";
    expect(restoreNote("民生委員の（氏名）が週2回来る", text, scrubbed)).toBe("民生委員の〇〇さんが週2回来る");
  });
});

describe("話して入れる: 止める", () => {
  it("人が止めると、ブラウザが終わったあとに 1 回だけ onDone（残った認識中の区切りも入る）", () => {
    const { d, last, log } = setup();
    d.start("");
    last().say([["88歳独居", true], ["土砂の", false]]);
    d.stop();
    expect(last().stopped).toBe(1);
    expect(d.state).toBe("stopping");
    expect(log.done).toEqual([]);
    last().end();
    expect(log.done).toEqual([{ text: "88歳独居\n土砂の", spoken: true }]);
    expect(log.ended).toEqual([]);
    expect(d.state).toBe("idle");
    expect(log.states).toEqual(["listening", "stopping", "idle"]);
    // 終わったあとの知らせは無視
    last().end();
    last().say([["あと", true]]);
    expect(log.done).toHaveLength(1);
  });

  it("何も話さずに止めると spoken は false（呼ぶ側は送らない）", () => {
    const { d, last, log } = setup();
    d.start("書いた文");
    d.stop();
    last().end();
    expect(log.done).toEqual([{ text: "書いた文", spoken: false }]);
  });

  it("ブラウザ側で終わったときは送らない（onEnd）", () => {
    const { d, last, log } = setup();
    d.start("");
    last().say([["88歳", true]]);
    last().end();
    expect(log.done).toEqual([]);
    expect(log.ended).toEqual([null]);
    expect(d.state).toBe("idle");
  });

  it("失敗は分けて知らせ、止めていても送らない", () => {
    const cases: Array<[string, DictationError]> = [
      ["not-allowed", "mic"],
      ["service-not-allowed", "mic"],
      ["audio-capture", "mic"],
      ["no-speech", "no_speech"],
      ["network", "failed"],
      ["language-not-supported", "failed"],
    ];
    for (const [error, want] of cases) {
      FakeRecognition.made = [];
      const { d, last, log } = setup();
      d.start("");
      last().say([["途中まで", true]]);
      d.stop();
      last().fail(error);
      last().end();
      expect(log.done).toEqual([]);
      expect(log.ended).toEqual([want]);
      // 欄の文は残る（直して抽出できる）
      expect(log.texts[log.texts.length - 1]).toBe("途中まで");
    }
    expect(dictationErrorOf("aborted")).toBeNull();
  });

  it("aborted の知らせは失敗にしない", () => {
    const { d, last, log } = setup();
    d.start("");
    last().say([["88歳", true]]);
    d.stop();
    last().fail("aborted");
    last().end();
    expect(log.done).toEqual([{ text: "88歳", spoken: true }]);
  });

  it("止めたあと onend が来なければ打ち切って終える", () => {
    vi.useFakeTimers();
    const { d, last, log } = setup({ stopTimeoutMs: 1000 });
    d.start("");
    last().say([["88歳", false]]);
    d.stop();
    vi.advanceTimersByTime(999);
    expect(log.done).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(last().aborted).toBe(1);
    expect(log.done).toEqual([{ text: "88歳", spoken: true }]);
    // 遅れて来た終わりは無視
    last().end();
    expect(log.done).toHaveLength(1);
  });

  it("上限の字数で切って止める（人が止めたのと同じ）", () => {
    const { d, last, log, field } = setup({ maxLength: 10 });
    d.start("12345");
    last().say([["あいうえおかきくけこ", true]]);
    expect(field()).toBe("12345\nあいうえ");
    expect(last().stopped).toBe(1);
    last().end();
    expect(log.done).toEqual([{ text: "12345\nあいうえ", spoken: true }]);
  });

  it("abort は何も知らせない（画面を閉じた・別の人に移った）", () => {
    const { d, last, log } = setup();
    d.start("");
    last().say([["88歳", true]]);
    d.abort();
    expect(last().aborted).toBe(1);
    expect(d.state).toBe("idle");
    last().end();
    expect(log.done).toEqual([]);
    expect(log.ended).toEqual([]);
  });

  it("始められなければ false と onEnd(failed)。聞いている間はもう 1 つ始めない", () => {
    FakeRecognition.failStart = true;
    const a = setup();
    expect(a.d.start("")).toBe(false);
    expect(a.log.ended).toEqual(["failed"]);
    expect(a.d.state).toBe("idle");
    FakeRecognition.failStart = false;
    const b = setup();
    expect(b.d.start("")).toBe(true);
    expect(b.d.start("")).toBe(false);
  });
});

describe("話した文は送る前に直せる", () => {
  it("止めたあとの欄の文を直し、もう一度話すと直した文のあとに続く。送るのは直した文", () => {
    const { d, last, log } = setup();
    d.start("");
    last().say([["佐藤さんは88歳独居", true]]);
    d.stop();
    last().end();
    // 欄で直す（人が打ち直した文が base になる）
    const edited = "88歳、独居。";
    d.start(edited);
    last().say([["土砂の区域", true]]);
    d.stop();
    last().end();
    expect(log.done[1]).toEqual({ text: "88歳、独居。\n土砂の区域", spoken: true });
  });

  it("聞いている間に直した所は、次の音声の文字で上書きしない（T143）。直した時に見えていた認識中の区切りは足し直さない", () => {
    const { d, last, field, log } = setup();
    d.start("");
    last().say([["88歳独居", true], ["認知", false]]);
    expect(field()).toBe("88歳独居\n認知");
    // 人が欄を直す（認識中の「認知」も直した文に入る）
    const edited = "88歳、独居。\n認知症あり";
    d.edit(edited);
    // さっきの認識中の区切りが確定しても足さない
    last().say([["認知症で", true]]);
    expect(field()).toBe(edited);
    // そのあとに話した確定の区切りは、直した文のあとにつながる
    last().say([["土砂の区域", true]]);
    expect(field()).toBe(`${edited}\n土砂の区域`);
    d.stop();
    last().end();
    expect(log.done[0]).toEqual({ text: `${edited}\n土砂の区域`, spoken: true });
  });

  it("止まっているときの edit は何もしない（止めたあとは欄の文をそのまま始めに渡す）", () => {
    const { d, last, log } = setup();
    d.edit("無視される");
    d.start("始め");
    last().say([["続き", true]]);
    d.stop();
    last().end();
    expect(log.done[0]).toEqual({ text: "始め\n続き", spoken: true });
  });

  it("送るのは話して足したときだけで、欄の文そのまま（空白だけは送らない）", () => {
    expect(dictationToSend({ text: "88歳\n独居", spoken: true })).toBe("88歳\n独居");
    expect(dictationToSend({ text: "書いた文", spoken: false })).toBeNull();
    expect(dictationToSend({ text: "  \n ", spoken: true })).toBeNull();
  });
});
