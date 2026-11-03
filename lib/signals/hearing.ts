// 聞き取りの欄（T49）を画面の形にする。ブラウザでも読める（D1・Claude に触らない）。
// 欄ごとに 3 つの出どころを重ねる: ケアマネが直した文（memo）→ 本人・家族が押した答え（answers）→ Claude の聞き取りメモ（ai_memo）。
// - 押した答え（「わからない」のほか）がある欄は Claude の文を出さない（人が押した物が先。AI は空いている欄を埋めるだけ）
// - ケアマネが直した欄は直した文だけを出し、AI の印を外す（空にした欄も人の値）
// - どれも色と連絡の順に使わない（lib/triage の入力に無い）。ここは並べるだけ

import { HEARING_FIELD_LABELS } from "../labels.ts";
import {
  HEARING_FIELDS,
  QUESTIONS,
  readAnswers,
  UNKNOWN_CHOICE,
  type AnswerVia,
  type Answers,
  type HearingField,
} from "./questions.ts";

/** 聞き取りメモ・直した欄の 1 欄の長さの上限（字）。Claude の写しは 30 字（lib/classify） */
export const MEMO_TEXT_MAX = 60;

/** 欄ごとの文。キーがあれば値（null は空にした） */
export type HearingMemo = Partial<Record<HearingField, string | null>>;

/** memo・ai_memo の JSON を読む。知らない欄・文でない値は捨てる */
export function readMemo(text: string | null | undefined): HearingMemo {
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: HearingMemo = {};
    for (const f of HEARING_FIELDS) {
      if (!(f in v)) continue;
      const x = (v as Record<string, unknown>)[f];
      if (x === null) out[f] = null;
      else if (typeof x === "string") out[f] = Array.from(x.trim()).slice(0, MEMO_TEXT_MAX).join("") || null;
    }
    return out;
  } catch {
    return {};
  }
}

export type HearingAnswer = { question: string; choice: string; via: AnswerVia; unknown: boolean };

export type HearingRow = {
  field: HearingField;
  label: string;
  /** 押した（声で取れた）答え。問いの表の順 */
  answers: HearingAnswer[];
  /** 出す文。直した文か Claude の文。無ければ null */
  text: string | null;
  /** 文の出どころ。human はケアマネが直した（AI の印なし）、ai は Claude の写し（AI の印） */
  textBy: "human" | "ai" | null;
};

export type HearingView = { rows: HearingRow[] };

export type HearingSource = { answers?: string | null; ai_memo?: string | null; memo?: string | null };

/** 欄ごとの押した答え */
function answersOf(answers: Answers, field: HearingField): HearingAnswer[] {
  const out: HearingAnswer[] = [];
  for (const q of QUESTIONS) {
    if (q.field !== field) continue;
    const a = answers[q.id];
    if (!a) continue;
    const c = q.choices.find((x) => x.id === a.choice);
    if (!c) continue;
    out.push({ question: q.label, choice: c.label, via: a.via, unknown: c.id === UNKNOWN_CHOICE });
  }
  return out;
}

/** 欄の形。答えも文も無ければ null（欄を出さない） */
export function hearingViewOf(row: HearingSource): HearingView | null {
  const answers = readAnswers(row.answers);
  const ai = readMemo(row.ai_memo);
  const human = readMemo(row.memo);
  const rows: HearingRow[] = [];
  for (const field of HEARING_FIELDS) {
    const pressed = answersOf(answers, field);
    const known = pressed.some((a) => !a.unknown);
    let text: string | null = null;
    let textBy: HearingRow["textBy"] = null;
    if (field in human) {
      text = human[field] ?? null;
      textBy = "human";
    } else if (!known && ai[field]) {
      text = ai[field] ?? null;
      textBy = "ai";
    }
    if (pressed.length === 0 && textBy === null) continue;
    rows.push({ field, label: HEARING_FIELD_LABELS[field], answers: pressed, text, textBy });
  }
  return rows.length > 0 ? { rows } : null;
}
