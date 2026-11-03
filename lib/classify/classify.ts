// 録音と自由文の分類（T12）。Claude（Haiku）が文字起こしを「けが・動けない・水が来た・機器が止まった・その他・不明」に分けるだけ（その他は T64）。
// 色と順位は決めない（lib/triage が signals.classes を読んで決める）。本番（本人のスマホの録音）と訓練（T18 のペルソナ）が同じ入力の形を使う。
//
// - Claude に渡すのは lib/pseudonym を通した文だけ（ClassifyInput の型で縛り、askJson が実行時にも確かめる）。本人の台帳は渡さない
// - 文字起こしが無ければ呼ばない（うめき声・黙っているは不明。docs/DECISIONS.md 9）
// - 確信が 0.6 未満なら不明。不明はほかと一緒にしない。引用は文字起こしに無ければ捨て、10 字に切る（作った根拠を出さない）
// - 鍵が無い・上限・断られた・形が違う・呼び出しの失敗・伏せきれないは、投げずに理由を返す（分類なし。色は答えだけで決まる）

import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import { RECORDING_CLASSES, type ClassifyError, type RecordingClass } from "../db/types.ts";
import { PseudonymLeakError, pseudonymizeText, type ForClaude, type PseudonymKey } from "../pseudonym/index.ts";
import type { RedAnswers } from "../signals/body.ts";
import { ANSWER_LABELS } from "../signals/labels.ts";
import { RED_QUESTIONS } from "../signals/phrases.ts";
import { QUESTION_NAMES } from "./labels.ts";
import { HEARING_FIELDS, type HearingField } from "../signals/questions.ts";
import { CLASSIFY_SYSTEM, ClassifySchema, CONFIDENCE_MIN, MEMO_MAX, QUOTE_MAX, type ClassifyAnswer } from "./prompt.ts";

/** 音の特徴（端末の MediaRecorder から取れれば）。無音の割合は 0〜1 */
export type AudioFeatures = { durationSec: number | null; silenceRatio: number | null };

/** 分類の元（伏せる前）。サーバーと訓練の中だけで持ち、Claude には sealClassifyInput を通してから渡す */
export type ClassifySource = {
  /** 文字起こしか自由文。無ければ null */
  transcript: string | null;
  /** 赤の 4 問の答え。答えの無い信号（家族の自由文など）は null */
  answers: RedAnswers | null;
  audio: AudioFeatures | null;
};

/** Claude に渡す形。どちらも lib/pseudonym の伏せ方を通した文（印の無い文は型で通らない） */
export type ClassifyInput = {
  /** 文字起こしか自由文（名前・町名・電話を伏せた物）。無ければ null で、呼ばずに「文字なし」 */
  text: ForClaude<{ text: string }> | null;
  /** 答えと音の特徴（コードの決まった言葉の文。同じ伏せ方を通す） */
  facts: ForClaude<{ text: string }>;
};

/** 分類の結果。categories は 6 つの値で 1 つ以上、不明はほかと一緒にしない */
export type Classification = {
  categories: RecordingClass[];
  /** 0〜1 */
  confidence: number;
  /** 文字起こし（伏せた文）からの引用。10 字まで、無ければ空文字 */
  quote: string;
  /**
   * 聞き取りメモ（T49）。欄ごとに文字起こし（伏せた文）からそのまま写した 30 字まで、無ければ null。
   * 色と連絡の順に使わない（lib/triage の入力に無い）。押した答えのある欄は画面で人の答えが先（lib/signals/hearing.ts）
   */
  memo: Record<HearingField, string | null>;
};

export type ClassifyResult =
  | { ok: true; model: string; value: Classification }
  | { ok: false; error: ClassifyError };

/** 答えと音の特徴の文「けが 未回答・自宅・動けない・薬 あり。録音 30 秒・無音 40%」。名前を入れない決まった言葉だけ */
export function factsText(answers: RedAnswers | null, audio: AudioFeatures | null): string {
  const a = answers
    ? RED_QUESTIONS.map((q) => {
        const v = answers[q];
        return v === null ? `${QUESTION_NAMES[q]} 未回答` : ANSWER_LABELS[q][v ? 0 : 1];
      }).join("・")
    : "答えなし";
  const sound: string[] = [];
  if (audio?.durationSec != null) sound.push(`録音 ${audio.durationSec} 秒`);
  if (audio?.silenceRatio != null) sound.push(`無音 ${Math.round(Math.min(Math.max(audio.silenceRatio, 0), 1) * 100)}%`);
  return `${a}。${sound.length > 0 ? sound.join("・") : "音の特徴なし"}`;
}

/**
 * 分類の元を Claude に渡せる形にする（本人の鍵で名前・町名・電話を伏せる）。
 * 伏せたあとに元の情報が残っていれば PseudonymLeakError（送らない。呼ぶ側は「送信不可」にする）
 */
export function sealClassifyInput(src: ClassifySource, key: PseudonymKey): ClassifyInput {
  const t = src.transcript?.trim();
  return {
    text: t ? pseudonymizeText(t, key) : null,
    facts: pseudonymizeText(factsText(src.answers, src.audio), key),
  };
}

/** Claude に渡す要求。入力は伏せた文だけ（型で縛る） */
export function buildClassifyRequest(input: {
  text: ForClaude<{ text: string }>;
  facts: ForClaude<{ text: string }>;
}): AskJsonRequest<typeof ClassifySchema> {
  return {
    purpose: "classify",
    system: CLASSIFY_SYSTEM,
    input: { 文字起こし: input.text, 答えと音: input.facts },
    schema: ClassifySchema,
  };
}

const stripBrackets = (s: string) => s.replace(/^[「『"']+/, "").replace(/[」』"']+$/, "");

/** 引用: 伏せた文字起こしに無ければ捨てる（作った根拠を出さない）。あれば 10 字に切る */
export function quoteOf(raw: string, text: string): string {
  const q = stripBrackets(raw.trim()).trim();
  if (!q || !text.includes(q)) return "";
  return Array.from(q).slice(0, QUOTE_MAX).join("");
}

/**
 * 聞き取りメモの 1 欄: 伏せた文字起こしに無ければ捨てる（言い換え・作った言葉を出さない）。あれば 30 字に切る。
 * 確信が低くても写しは本人の言葉なので残す（分類の「不明」とは別）
 */
export function memoTextOf(raw: string | null | undefined, text: string): string | null {
  if (typeof raw !== "string") return null;
  const q = stripBrackets(raw.trim()).trim();
  if (!q || !text.includes(q)) return null;
  return Array.from(q).slice(0, MEMO_MAX).join("");
}

/** 聞き取りメモを決まりに合わせる。memo の無い返事は全部 null */
export function normalizeMemo(memo: ClassifyAnswer["memo"], text: string): Record<HearingField, string | null> {
  return Object.fromEntries(HEARING_FIELDS.map((f) => [f, memoTextOf(memo?.[f], text)])) as Record<HearingField, string | null>;
}

/** Claude の返事を決まりに合わせる: 確信を 0〜1 に、0.6 未満と空は不明、不明はほかと一緒にしない、並びは 6 つの順 */
export function normalizeClassification(answer: ClassifyAnswer, text: string): Classification {
  const confidence = Math.min(Math.max(answer.confidence, 0), 1);
  const picked = new Set(answer.categories);
  let categories: RecordingClass[] = RECORDING_CLASSES.filter((c) => c !== "unknown" && picked.has(c));
  if (categories.length === 0 || confidence < CONFIDENCE_MIN) categories = ["unknown"];
  return { categories, confidence, quote: quoteOf(answer.quote, text), memo: normalizeMemo(answer.memo, text) };
}

/** AI の層の失敗を分類なしの理由に。知らない失敗（仮名化を通っていない入力など）は null で、呼ぶ側に投げ直させる */
export function classifyErrorOf(e: unknown): ClassifyError | null {
  if (e instanceof AiNotConfigured) return "not_configured";
  if (e instanceof AiLimitReached) return "limit";
  if (e instanceof AiRefused) return "refused";
  if (e instanceof AiBadOutput) return "bad_output";
  if (e instanceof AiCallFailed) return "failed";
  if (e instanceof PseudonymLeakError) return "leak";
  return null;
}

/**
 * 伏せた文を Claude（Haiku、用途 classify）に 1 回渡して分ける。文が無ければ呼ばない。
 * AI の層の失敗は理由で返す。仮名化を通っていない入力（型を外して渡した物）は投げる
 */
export async function classify(input: ClassifyInput, ctx: AskJsonContext): Promise<ClassifyResult> {
  if (!input.text || !input.text.text.trim()) return { ok: false, error: "no_text" };
  try {
    const r = await askJson(buildClassifyRequest({ text: input.text, facts: input.facts }), ctx);
    return { ok: true, model: r.model, value: normalizeClassification(r.value, input.text.text) };
  } catch (e) {
    const error = classifyErrorOf(e);
    if (error) return { ok: false, error };
    throw e;
  }
}
