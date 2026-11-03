// アンケートの答えの形（送る・保存する・写す）。記号と選択肢は tools/survey/questions.ts が正（紙と README の記号と同じ）。
// 写しの行は docs/survey/README.md の表の 1 行（tools/survey/answers.ts の parseAnswers がそのまま読む形）。

import { findRisks } from "../../tools/survey/answers.ts";
import {
  CHOICE_QUESTIONS,
  COLUMNS,
  FREE_QUESTIONS,
  type ChoiceKey,
  type FreeKey,
} from "../../tools/survey/questions.ts";
import type { SurveyAnswerRow } from "../db/types.ts";
import { FREE_MAX } from "./form.ts";

/** 送る答え。選んだ記号（問 3 だけ複数）と自由記述。答えなしは入れないか空 */
export type SurveyAnswers = {
  choices: Record<ChoiceKey, string[]>;
  free: Record<FreeKey, string | null>;
};

export type AnswerParse = { ok: true; value: SurveyAnswers } | { ok: false; error: "invalid" | "empty" };

/** 改行をそろえ、制御文字（改行とタブを除く）を外し、前後の空白を落とす */
function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

/**
 * 送られた答えを読む。知らない記号・2 つ以上の単一選択・長すぎる文・形の違いは invalid。
 * どの問いにも答えていなければ empty。知らない問いの名前は無視する。
 */
export function parseSurveyAnswers(raw: unknown): AnswerParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "invalid" };
  const input = raw as Record<string, unknown>;
  const choices = {} as Record<ChoiceKey, string[]>;
  for (const q of CHOICE_QUESTIONS) {
    const v = input[q.key];
    const allowed = q.choices.map((c) => c.code);
    if (v === undefined || v === null || v === "") {
      choices[q.key] = [];
      continue;
    }
    const list = Array.isArray(v) ? v : [v];
    if (!list.every((x): x is string => typeof x === "string" && allowed.includes(x))) return { ok: false, error: "invalid" };
    const codes = [...new Set(list)];
    if (!q.multi && codes.length > 1) return { ok: false, error: "invalid" };
    // 紙と同じ並び（a・b・c…）にそろえる
    choices[q.key] = allowed.filter((c) => codes.includes(c));
  }
  const free = {} as Record<FreeKey, string | null>;
  for (const q of FREE_QUESTIONS) {
    const v = input[q.key];
    if (v === undefined || v === null) {
      free[q.key] = null;
      continue;
    }
    if (typeof v !== "string") return { ok: false, error: "invalid" };
    const text = cleanText(v);
    if (text.length > FREE_MAX) return { ok: false, error: "invalid" };
    free[q.key] = text === "" ? null : text;
  }
  const answered =
    CHOICE_QUESTIONS.some((q) => choices[q.key].length > 0) || FREE_QUESTIONS.some((q) => free[q.key] !== null);
  if (!answered) return { ok: false, error: "empty" };
  return { ok: true, value: { choices, free } };
}

/** 表の列の値（記号を並べた文字。答えなしは null） */
const codesOf = (codes: string[]): string | null => (codes.length ? codes.join("") : null);

/** 答えを表の列へ（survey_answers の token・source_hash・submitted_at を除いた所） */
export function answerColumns(a: SurveyAnswers): Omit<SurveyAnswerRow, "token" | "source_hash" | "submitted_at"> {
  return {
    role: codesOf(a.choices.role),
    experience: codesOf(a.choices.experience),
    q1: codesOf(a.choices.q1),
    q2: codesOf(a.choices.q2),
    q3: codesOf(a.choices.q3),
    q4: a.free.q4,
    q5: codesOf(a.choices.q5),
    q6: codesOf(a.choices.q6),
    q7: codesOf(a.choices.q7),
    q7_reason: a.free.q7reason,
    quote: codesOf(a.choices.quote),
  };
}

/** 表の行から答えへ（一覧と写しで使う） */
export function answersOfRow(row: SurveyAnswerRow): SurveyAnswers {
  const split = (v: string | null) => (v ? v.split("") : []);
  return {
    choices: {
      role: split(row.role),
      experience: split(row.experience),
      q1: split(row.q1),
      q2: split(row.q2),
      q3: split(row.q3),
      q5: split(row.q5),
      q6: split(row.q6),
      q7: split(row.q7),
      quote: split(row.quote),
    },
    free: { q4: row.q4, q7reason: row.q7_reason },
  };
}

/** 引用が「よい」か（README: 空と「よくない」は同じに扱い、記入欄の文を写さない） */
export const quoteAllowed = (a: SurveyAnswers): boolean => a.choices.quote.includes("a");

/** 表の 1 つの欄に入る文に（| は 、 に、改行は空白に） */
function cellText(text: string): string {
  return text.replace(/\|/g, "、").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * docs/survey/answers.md の表の 1 行（docs/survey/README.md の形。列は questions.ts の COLUMNS の並び）。
 * - 番号は Web の答えの通し番号（W001・W002…。紙の 001… と重ならない）
 * - 問 3 は b,c,f のように並べる
 * - 引用が「よい」でない人は、問 4・問 7 の理由の文を写さない（空にする）
 */
export function answerLine(id: string, a: SurveyAnswers): string {
  const quoteOk = quoteAllowed(a);
  const cell = (column: string): string => {
    if (column === "番号") return id;
    const choice = CHOICE_QUESTIONS.find((q) => q.column === column);
    if (choice) return a.choices[choice.key].join(",");
    const free = FREE_QUESTIONS.find((q) => q.column === column);
    if (free) {
      const text = a.free[free.key];
      return quoteOk && text ? cellText(text) : "";
    }
    return "";
  };
  return `| ${COLUMNS.map(cell).join(" | ")} |`;
}

/** Web の答えの番号（W001…）。審査員の試しは T001…（本物と混ぜない） */
export function answerId(seq: number, judge: boolean): string {
  return `${judge ? "T" : "W"}${String(seq).padStart(3, "0")}`;
}

/** 自由記述に名前・電話・メール・リンクの疑いがあるか（写す前に作者が確かめる印。疑った文字は返さない） */
export function answerRisks(a: SurveyAnswers): string[] {
  const found = new Set<string>();
  for (const q of FREE_QUESTIONS) {
    const text = a.free[q.key];
    if (text) for (const r of findRisks(text)) found.add(r);
  }
  return [...found];
}

/** 選んだ記号を選択肢の言葉に（一覧に出す）。答えなしは null */
export function choiceText(key: ChoiceKey, codes: string[]): string | null {
  const q = CHOICE_QUESTIONS.find((x) => x.key === key);
  if (!q || codes.length === 0) return null;
  return q.choices
    .filter((c) => codes.includes(c.code))
    .map((c) => c.label)
    .join("・");
}
