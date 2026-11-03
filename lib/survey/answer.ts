// アンケートの答えの形（送る・保存する・写す）。記号と選択肢は tools/survey/questions.ts が正（README の記号と同じ）。
// 写しの行は docs/survey/README.md の表の 1 行（tools/survey/answers.ts の parseAnswers がそのまま読む形）。

import { findRisks } from "../../tools/survey/answers.ts";
import {
  CHOICE_QUESTIONS,
  COLUMNS,
  OTHER_FIELDS,
  TEXT_FIELDS,
  type ChoiceKey,
  type TextKey,
} from "../../tools/survey/questions.ts";
import type { SurveyResponseRow } from "../db/types.ts";

/** 送る答え。選んだ記号（問 4・問 6 だけ複数）と、文の欄（記入欄とその他の記入）。答えなしは空か null */
export type SurveyAnswers = {
  choices: Record<ChoiceKey, string[]>;
  free: Record<TextKey, string | null>;
};

export type AnswerParse = { ok: true; value: SurveyAnswers } | { ok: false; error: "invalid" | "empty" };

/** 文の欄の名前と、表の列の名前（survey_responses） */
export const TEXT_DB_COLUMN: Record<TextKey, keyof SurveyResponseRow> = {
  q5: "q5",
  q9reason: "q9_reason",
  comment: "comment",
  roleOther: "role_other",
  q3Other: "q3_other",
  q4Other: "q4_other",
  q6Other: "q6_other",
};

/** 改行をそろえ、制御文字（改行とタブを除く）を外し、前後の空白を落とす */
function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

/**
 * 送られた答えを読む。知らない記号・2 つ以上の単一選択・長すぎる文・形の違いは invalid。
 * その他の記入は、その他を選んだときだけ残す（選んでいなければ捨てる）。
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
    // 表の並び（a・b・c…）にそろえる
    choices[q.key] = allowed.filter((c) => codes.includes(c));
  }
  const free = {} as Record<TextKey, string | null>;
  for (const f of TEXT_FIELDS) {
    const v = input[f.key];
    if (v === undefined || v === null) {
      free[f.key] = null;
      continue;
    }
    if (typeof v !== "string") return { ok: false, error: "invalid" };
    const text = cleanText(v);
    if (text.length > f.max) return { ok: false, error: "invalid" };
    free[f.key] = text === "" ? null : text;
  }
  for (const o of OTHER_FIELDS) if (!choices[o.of].includes(o.code)) free[o.key] = null;
  const answered =
    CHOICE_QUESTIONS.some((q) => choices[q.key].length > 0) || TEXT_FIELDS.some((f) => free[f.key] !== null);
  if (!answered) return { ok: false, error: "empty" };
  return { ok: true, value: { choices, free } };
}

/** 表の列の値（記号を並べた文字。答えなしは null） */
const codesOf = (codes: string[]): string | null => (codes.length ? codes.join("") : null);

export type ResponseColumns = Omit<SurveyResponseRow, "id" | "token" | "source_hash" | "submitted_at">;

/** 答えを表の列へ（survey_responses の id・token・source_hash・submitted_at を除いた所） */
export function answerColumns(a: SurveyAnswers): ResponseColumns {
  const out = {} as Record<string, string | null>;
  for (const q of CHOICE_QUESTIONS) out[q.key] = codesOf(a.choices[q.key]);
  for (const f of TEXT_FIELDS) out[TEXT_DB_COLUMN[f.key]] = a.free[f.key];
  return out as ResponseColumns;
}

/** 表の列の並び（INSERT に使う） */
export const RESPONSE_COLUMNS: ReadonlyArray<keyof ResponseColumns> = [
  ...CHOICE_QUESTIONS.map((q) => q.key),
  ...TEXT_FIELDS.map((f) => TEXT_DB_COLUMN[f.key]),
] as ReadonlyArray<keyof ResponseColumns>;

/** 表の行から答えへ（一覧と写しで使う） */
export function answersOfRow(row: SurveyResponseRow): SurveyAnswers {
  const choices = {} as Record<ChoiceKey, string[]>;
  for (const q of CHOICE_QUESTIONS) {
    const v = row[q.key];
    choices[q.key] = typeof v === "string" && v ? v.split("") : [];
  }
  const free = {} as Record<TextKey, string | null>;
  for (const f of TEXT_FIELDS) {
    const v = row[TEXT_DB_COLUMN[f.key]];
    free[f.key] = typeof v === "string" ? v : null;
  }
  return { choices, free };
}

/** 引用が「よい」か（README: 空と「よくない」は同じに扱い、文の欄を写さない） */
export const quoteAllowed = (a: SurveyAnswers): boolean => a.choices.quote.includes("a");

/** 表の 1 つの欄に入る文に（| は 、 に、改行は空白に） */
function cellText(text: string): string {
  return text.replace(/\|/g, "、").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * docs/survey/answers.md の表の 1 行（docs/survey/README.md の形。列は questions.ts の COLUMNS の並び）。
 * - 番号は Web の答えの通し番号（W001・W002…）
 * - 問 4・問 6 は b,c,f のように並べる
 * - 引用が「よい」でない人は、文の欄（記入欄もその他の記入も）を写さない（空にする）
 */
export function answerLine(id: string, a: SurveyAnswers): string {
  const quoteOk = quoteAllowed(a);
  const cell = (column: string): string => {
    if (column === "番号") return id;
    const choice = CHOICE_QUESTIONS.find((q) => q.column === column);
    if (choice) return a.choices[choice.key].join(",");
    const text = TEXT_FIELDS.find((f) => f.column === column);
    if (text) {
      const v = a.free[text.key];
      return quoteOk && v ? cellText(v) : "";
    }
    return "";
  };
  return `| ${COLUMNS.map(cell).join(" | ")} |`;
}

/** Web の答えの番号（W001…）。審査員の試しは T001…（本物と混ぜない） */
export function answerId(seq: number, judge: boolean): string {
  return `${judge ? "T" : "W"}${String(seq).padStart(3, "0")}`;
}

/** 文の欄に名前・電話・メール・リンクの疑いがあるか（写す前に作者が確かめる印。疑った文字は返さない） */
export function answerRisks(a: SurveyAnswers): string[] {
  const found = new Set<string>();
  for (const f of TEXT_FIELDS) {
    const text = a.free[f.key];
    if (text) for (const r of findRisks(text)) found.add(r);
  }
  return [...found];
}

/** 選んだ記号を選択肢の言葉に（一覧に出す）。その他の記入があれば添える。答えなしは null */
export function choiceText(key: ChoiceKey, codes: string[], other: string | null = null): string | null {
  const q = CHOICE_QUESTIONS.find((x) => x.key === key);
  if (!q || codes.length === 0) return null;
  return q.choices
    .filter((c) => codes.includes(c.code))
    .map((c) => (q.other && c.code === q.other.code && other ? `${c.label}（${other}）` : c.label))
    .join("・");
}
