"use client";

// 話して入れる（T04）を画面から使う形。対応していないブラウザでは supported が false のまま（ボタンを出さない）。
// 対応の判定は描いたあと（useEffect）にする。サーバーの描画と食い違わないように最初は false。

import { useCallback, useEffect, useRef, useState } from "react";
import { createDictation, speechRecognitionOf, type Dictation, type DictationError, type DictationState } from "./dictation.ts";

export type UseDictation = {
  supported: boolean;
  state: DictationState;
  /** ブラウザ側の失敗（マイク不可・音声なし・認識失敗）。始め直すと消える */
  error: DictationError | null;
  /** 聞き始める。base は押したときの欄の文 */
  start: (base: string) => void;
  /** 人が止める（onDone が来る） */
  stop: () => void;
  /** 何も知らせずにやめる */
  abort: () => void;
};

export function useDictation(opts: {
  onText: (text: string) => void;
  onDone: (text: string, spoken: boolean) => void;
  maxLength?: number;
}): UseDictation {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<DictationError | null>(null);
  const dictation = useRef<Dictation | null>(null);
  // 知らせの先はいつも最新の描画の物（aiReady などが変わっても古い値で送らない）
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  const maxLength = opts.maxLength;

  useEffect(() => {
    const Ctor = speechRecognitionOf(window);
    if (!Ctor) return;
    const d = createDictation(
      Ctor,
      {
        onText: (t) => latest.current.onText(t),
        onDone: (t, spoken) => latest.current.onDone(t, spoken),
        onEnd: (e) => setError(e),
        onState: setState,
      },
      { maxLength },
    );
    dictation.current = d;
    setSupported(true);
    return () => {
      d.abort();
      dictation.current = null;
    };
  }, [maxLength]);

  const start = useCallback((base: string) => {
    setError(null);
    dictation.current?.start(base);
  }, []);
  const stop = useCallback(() => dictation.current?.stop(), []);
  const abort = useCallback(() => dictation.current?.abort(), []);
  return { supported, state, error, start, stop, abort };
}
