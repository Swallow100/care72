// 信号の行の分類を画面の形にする（components/list/Classification.tsx が使う）。ブラウザでも読める（D1・Claude に触らない）。
// 状態は 5 つ: 録音も文字も無い（出さない）・未分類（まだ分けていない）・分類なし（理由つき）・AI の分類・人の分類（修正済）。

import { CLASSIFY_ERRORS, RECORDING_CLASSES, type ClassifyError, type RecordingClass, type SignalRow } from "../db/types.ts";

/** 分類を読むときの信号の列。担当一覧の行の詳細（T13）は SELECT にこれを足す */
export const CLASSIFY_COLUMNS =
  "transcript, recording_key, classes, classified_by, ai_classes, ai_confidence, ai_quote, ai_model, ai_error, ai_at";

export type SignalClassFields = Pick<
  SignalRow,
  | "transcript"
  | "recording_key"
  | "classes"
  | "classified_by"
  | "ai_classes"
  | "ai_confidence"
  | "ai_quote"
  | "ai_model"
  | "ai_error"
  | "ai_at"
>;

/** Claude の分類（AI の印を付けて出す） */
export type AiClassView = {
  classes: RecordingClass[];
  confidence: number | null;
  quote: string | null;
  model: string | null;
};

export type ClassView =
  /** 録音も文字起こしも無い信号（ボタンだけの赤・緑）。分類の欄を出さない */
  | { kind: "absent" }
  /** 録音か文字があり、まだ分けていない（分けている途中） */
  | { kind: "pending" }
  /** 分けられなかった。色は答えだけで決まる */
  | { kind: "none"; error: ClassifyError }
  | ({ kind: "ai" } & AiClassView)
  /** ケアマネが直した。以後は人の分類が効く。ai は直す前の Claude の分類（無ければ null） */
  | { kind: "human"; classes: RecordingClass[]; ai: AiClassView | null };

/** classes の JSON を読む。5 つの値でない物は捨てる */
export function parseClassList(text: string | null): RecordingClass[] | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    if (!Array.isArray(v)) return null;
    return RECORDING_CLASSES.filter((c) => v.includes(c));
  } catch {
    return null;
  }
}

function aiOf(row: SignalClassFields): AiClassView | null {
  const classes = parseClassList(row.ai_classes);
  if (!classes || classes.length === 0) return null;
  return { classes, confidence: row.ai_confidence, quote: row.ai_quote || null, model: row.ai_model };
}

export function classViewOf(row: SignalClassFields): ClassView {
  const current = parseClassList(row.classes);
  if (row.classified_by === "care_manager" && current && current.length > 0) {
    return { kind: "human", classes: current, ai: aiOf(row) };
  }
  if (row.classified_by === "claude" && current && current.length > 0) {
    const ai = aiOf(row);
    return { kind: "ai", ...(ai ?? { confidence: null, quote: null, model: null }), classes: current };
  }
  if (row.ai_error && (CLASSIFY_ERRORS as readonly string[]).includes(row.ai_error)) {
    return { kind: "none", error: row.ai_error };
  }
  if (!row.transcript?.trim() && !row.recording_key) return { kind: "absent" };
  return { kind: "pending" };
}
