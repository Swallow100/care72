// 通話の画面の下書き（docs/tasks/T155.md の 1・2）。文字で打った文とマイクで話した文（Web Speech の文字起こし、lib/speech/dictation.ts）を
// 1 つの欄の下書きに持ち、送る前に直せる。声で足した文は送る行に voice の印を付ける（直したあとも。色と順には使わない）。
// 画面（DOM）にも fetch にも触らない（components/drill/CallTalk.tsx が使う。テストは偽の SpeechRecognition で）。

import { TALK_TEXT_MAX } from "./dialogue.ts";

/** 下書き。voiced は送ってから声で 1 字でも足したか */
export type CallDraft = { text: string; voiced: boolean };

export const EMPTY_DRAFT: CallDraft = { text: "", voiced: false };

const clip = (t: string): string => Array.from(t).slice(0, TALK_TEXT_MAX).join("");

/** 文字起こしが届いた（欄の文の全部。lib/speech の onText）。前と違えば声で足した印 */
export function draftOnSpeech(d: CallDraft, text: string): CallDraft {
  const next = clip(text);
  return { text: next, voiced: d.voiced || (next !== d.text && next.trim() !== "") };
}

/** 人が欄を打った・直した。声の印はそのまま（声で入れた文を直した物も声の行）。欄を空にしたら印を外す */
export function draftOnType(d: CallDraft, text: string): CallDraft {
  const next = clip(text);
  return { text: next, voiced: next.trim() === "" ? false : d.voiced };
}

/** 送る物（空なら null）。声の印は自由の文にだけ */
export function draftToSend(d: CallDraft): { text: string; voice?: true } | null {
  const text = d.text.trim();
  if (!text) return null;
  return d.voiced ? { text, voice: true } : { text };
}
