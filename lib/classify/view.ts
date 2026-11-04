// 信号の行の分類を画面の形にする（components/list/Classification.tsx が使う）。ブラウザでも読める（D1・Claude に触らない）。
// 状態は 5 つ: 録音も文字も無い（出さない）・未分類（まだ分けていない）・分類なし（理由つき）・AI の分類・人の分類（修正済）。

import { CLASSIFY_ERRORS, RECORDING_CLASSES, type ClassifyError, type RecordingClass, type SignalRow } from "../db/types.ts";
import { hearingViewOf, type HearingSource } from "../signals/hearing.ts";

/**
 * 分類を読むときの信号の列。担当一覧の行の詳細（T13）は SELECT にこれを足す。
 * 聞き取りの列（answers・ai_memo・memo）は、引用と同じ文が聞き取りの欄にあるかを見るため（T64）
 */
export const CLASSIFY_COLUMNS =
  "transcript, recording_key, classes, classified_by, ai_classes, ai_confidence, ai_quote, ai_model, ai_error, ai_at, answers, ai_memo, memo";

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

/** classes の JSON を読む。6 つの値でない物は捨てる */
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

/**
 * 聞き取りの欄（T49）に出している文。分類の引用と同じ文なら引用を出さない（同じ文を 2 回出さない）。
 * 比べるのは画面に出す文（直した文か Claude の文。lib/signals/hearing.ts の hearingViewOf と同じ選び方）で、違えば両方出す
 */
function hearingTexts(row: HearingSource): Set<string> {
  const view = hearingViewOf(row);
  return new Set((view?.rows ?? []).flatMap((r) => (r.text?.trim() ? [r.text.trim()] : [])));
}

function aiOf(row: SignalClassFields, shown: Set<string>): AiClassView | null {
  const classes = parseClassList(row.ai_classes);
  if (!classes || classes.length === 0) return null;
  const quote = row.ai_quote?.trim() && !shown.has(row.ai_quote.trim()) ? row.ai_quote : null;
  return { classes, confidence: row.ai_confidence, quote, model: row.ai_model };
}

/** 信号の行から分類の形を作る。聞き取りの列（answers・ai_memo・memo）があれば、同じ文の引用を外す */
export function classViewOf(row: SignalClassFields & HearingSource): ClassView {
  const current = parseClassList(row.classes);
  const shown = hearingTexts(row);
  if (row.classified_by === "care_manager" && current && current.length > 0) {
    return { kind: "human", classes: current, ai: aiOf(row, shown) };
  }
  if (row.classified_by === "claude" && current && current.length > 0) {
    const ai = aiOf(row, shown);
    return { kind: "ai", ...(ai ?? { confidence: null, quote: null, model: null }), classes: current };
  }
  if (row.ai_error && (CLASSIFY_ERRORS as readonly string[]).includes(row.ai_error)) {
    return { kind: "none", error: row.ai_error };
  }
  if (!row.transcript?.trim() && !row.recording_key) return { kind: "absent" };
  return { kind: "pending" };
}

// ---------- 録音のまとめ（T69b） ----------

/** 録音のまとめの形（T69b）。text は出す文、by は human（ケアマネが直した。AI の印なし）か ai（Claude。AI の印）か null（まだ・失敗） */
export type SignalSummary = {
  text: string | null;
  by: "human" | "ai" | null;
  /** まとめられなかった理由（Claude を呼んで失敗したとき）。まだなら null */
  error: SignalRow["ai_summary_error"];
};

/**
 * まとめの中の本人の仮名（「A さん」）を「本人」に（T88）。まとめは本人 1 人の鍵で伏せた文字起こしから作るので、仮名は本人の A さんだけ。
 * Claude には仮名で渡したまま（名前を渡さない線は変えない）、画面と保存の文だけ元の呼び方にする
 */
export function ownCall(text: string): string {
  return text.replace(/(?<![A-Za-z])A[ 　]?さん/gu, "本人");
}

/**
 * 信号の行からまとめの形（T69b）。ケアマネが直した文（summary）があればそれ、無ければ Claude の文（ai_summary）。
 * Claude の文の仮名は「本人」に（T88 より前に保存した文も）
 */
export function summaryOf(s: Partial<Pick<SignalRow, "ai_summary" | "ai_summary_error" | "summary">>): SignalSummary {
  const human = s.summary?.trim();
  if (human) return { text: human, by: "human", error: null };
  const ai = s.ai_summary?.trim();
  if (ai) return { text: ownCall(ai), by: "ai", error: null };
  return { text: null, by: null, error: s.ai_summary_error ?? null };
}
