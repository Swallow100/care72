// 録音のまとめ（T69b）。Claude（Haiku、用途 summary）が本人のスマホの録音の文字起こしを、ケアマネが 5 秒で読める 2 文以内（80 字まで）に
// 言い換える。作者の判断（11/4 01:1x）で、前の決まり「要約しない」を変えた。線:
// - 本人の元の言葉（文字起こし）と必ず並べて出す（components/list/Summary.tsx）。AI の印。ケアマネが直せる（直すと人の文になり AI の印が外れる）
// - 色と連絡の順に使わない（lib/triage の入力に無い。ai_summary・summary はどこからも表に渡さない）
// - 言った事の言い換えだけ。言っていない事・重さ・急ぐかどうか・病名・医療の言葉・助言を足さない（指示で縛り、返ったあとも
//   文字起こしに無い禁じる語が出たら形の違いにして捨てる）
// - 入力は分類と同じ伏せた文だけ（lib/pseudonym の鍵 → pseudonymizeText → askJson の門）。位置・避難先の名前・台帳は渡さない
// - 録音を添えたあとに分類と並べて 1 回（lib/classify/summary-http.ts の afterRecording。順に呼ぶと waitUntil の 30 秒に収まらない）。
//   失敗は ai_summary_error に残し、ケアマネの「生成」でもう一度呼べる（同じ 20 秒）
// - 用途は summary（ai_calls の数え方）で、呼び方は RECORDING_SUMMARY（Haiku・high・4000・20 秒・再試行なし。lib/claude/models.ts）。
//   summary の既定（Sonnet）はアンケートの集計（tools/survey）が使うので変えない
// - ケアマネの直し・API はこのファイルに置かない（Claude を呼ぶ所は本人の記録の行を読まない決まり。summary-http.ts）
// - 119 の 1 行・AI の告知・本人の画面には何も出さない（本人の画面はまとめを知らない）

import type { D1Database } from "@cloudflare/workers-types";
import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { RECORDING_SUMMARY } from "../claude/models.ts";
import type { ClassifyError, SignalRow } from "../db/types.ts";
import { pseudonymizeText, type ForClaude } from "../pseudonym/index.ts";
import { classifyErrorOf } from "./classify.ts";
import { SUMMARY_EDIT_MAX, SUMMARY_MAX } from "./labels.ts";
import { summaryOf, type SignalSummary } from "./view.ts";
import { pseudonymKeyFor, type ClassifyDeps, type ClassifyTarget } from "./store.ts";

/** 長さの上限（字）は画面も読むので lib/classify/labels.ts に置く */
export { SUMMARY_EDIT_MAX, SUMMARY_MAX };

/**
 * 指示。コードの定数だけで、氏名・住所・電話・本人の値を入れない。どの用途にも先に付く指示（lib/claude/call.ts の COMMON_SYSTEM:
 * 仮名・診断しない・下書き）のあとに足される
 */
export const SUMMARY_SYSTEM = [
  `本人のスマホの録音の文字起こしを、ケアマネが 5 秒で読める 2 文以内（${SUMMARY_MAX} 字まで）にまとめる。言った事の言い換えだけ。`,
  "入力は JSON。「文字起こし」がまとめる文。返すのは summary の 1 つだけ。",
  "",
  "決まり:",
  "1. 文字起こしに書かれた事だけを短く言い換える。言っていない事を足さない。推し量らない。",
  "2. 重さ・どのくらい危ないか・急ぐかどうか・病名・医療の言葉・助言・指示を書かない。本人の状態を言い切らない。",
  "3. 伏せ字（（氏名）（町名）（電話））と役割名（娘・支援者 1 など）はそのまま。「A さん」は本人。",
  "4. 聞き取れない・うめき声だけ・何のことか分からないときは、分かる言葉だけで短く。何も分からなければ空文字。",
].join("\n");

/** 返事の形。長さは返ったあとにコードで切る（文法では縛らない） */
export const SummarySchema = z.object({ summary: z.string() });

/** まとめの元。分類と同じく伏せた文だけ（位置・避難先の名前・台帳の欄は持たない） */
export type SummaryInput = { text: ForClaude<{ text: string }> | null };

export type SummaryResult = { ok: true; model: string; summary: string } | { ok: false; error: ClassifyError };

/** Claude に渡す要求。入力は伏せた文だけ（型で縛る） */
export function buildSummaryRequest(input: { text: ForClaude<{ text: string }> }): AskJsonRequest<typeof SummarySchema> {
  return { purpose: "summary", spec: RECORDING_SUMMARY, system: SUMMARY_SYSTEM, input: { 文字起こし: input.text }, schema: SummarySchema };
}

/** 画面・紙・README に書かない語（CLAUDE.md）。まとめに出たら、本人が言った言葉でなければ捨てる */
export const SUMMARY_BANNED = ["診断", "判定", "重症", "緊急度"] as const;

const stripQuotes = (s: string) => s.replace(/^[「『"']+/, "").replace(/[」』"']+$/, "");

/**
 * Claude の文を決まりに合わせる: 前後の空白・かぎ括弧を外し、改行と続いた空白を 1 つに、80 字で切る。空なら null。
 * 本人の言葉（伏せた文字起こし）に無い禁じる語が出たら null（重さ・判定を仕組みが足したことになるので出さない）
 */
export function normalizeSummary(raw: string, text: string): string | null {
  const s = stripQuotes(raw.trim()).replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (SUMMARY_BANNED.some((w) => s.includes(w) && !text.includes(w))) return null;
  return Array.from(s).slice(0, SUMMARY_MAX).join("");
}

/**
 * 伏せた文を Claude（Haiku、用途 summary）に 1 回渡してまとめる。文が無ければ呼ばない。
 * AI の層の失敗は理由で返す。仮名化を通っていない入力（型を外して渡した物）は投げる
 */
export async function summarize(input: SummaryInput, ctx: AskJsonContext): Promise<SummaryResult> {
  if (!input.text || !input.text.text.trim()) return { ok: false, error: "no_text" };
  try {
    const r = await askJson(buildSummaryRequest({ text: input.text }), ctx);
    const summary = normalizeSummary(r.value.summary, input.text.text);
    if (summary === null) return { ok: false, error: "bad_output" };
    return { ok: true, model: r.model, summary };
  } catch (e) {
    const error = classifyErrorOf(e);
    if (error) return { ok: false, error };
    throw e;
  }
}

// ---------- 信号の行に書く ----------

export type SummarizeOutcome =
  | { status: "not_found" }
  /** もう試みた（ai_summary_at がある）。生成（force）でも、まとめがあれば呼ばない */
  | { status: "skipped"; view: SignalSummary }
  | { status: "summarized"; result: SummaryResult; view: SignalSummary };

type SignalForSummary = Pick<SignalRow, "id" | "transcript" | "ai_summary" | "ai_summary_at" | "ai_summary_error" | "summary">;

async function readSignal(db: D1Database, t: Pick<ClassifyTarget, "officeId" | "personId" | "signalId">): Promise<SignalForSummary | null> {
  return db
    .prepare(
      `SELECT s.id, s.transcript, s.ai_summary, s.ai_summary_at, s.ai_summary_error, s.summary
         FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND s.person_id = ?2 AND p.office_id = ?3 AND s.drill_id IS NULL`,
    )
    .bind(t.signalId, t.personId, t.officeId)
    .first<SignalForSummary>();
}

/**
 * 信号の録音を Claude で 1 回まとめて書く。もう試みた信号は何もしない（force は「生成」: まとめがまだ無いときだけ呼び直す）。
 * 投げない（失敗は ai_summary_error に残す）。分類（classes・ai_*）と聞き取り（answers・memo）には触らない
 */
export async function summarizeSignal(
  db: D1Database,
  t: Pick<ClassifyTarget, "officeId" | "personId" | "signalId">,
  deps: ClassifyDeps,
  opts: { force?: boolean } = {},
): Promise<SummarizeOutcome> {
  const sig = await readSignal(db, t);
  if (!sig) return { status: "not_found" };
  if (sig.ai_summary || (sig.ai_summary_at !== null && !opts.force)) return { status: "skipped", view: summaryOf(sig) };

  let result: SummaryResult;
  if (!sig.transcript?.trim()) result = { ok: false, error: "no_text" };
  else {
    try {
      const key = await pseudonymKeyFor(db, t.officeId, t.personId);
      result = key ? await summarize({ text: pseudonymizeText(sig.transcript, key) }, await deps.ai()) : { ok: false, error: "failed" };
    } catch (e) {
      const error = classifyErrorOf(e);
      // 文字起こしをログに出さない（名前だけ）
      if (!error) console.error("まとめに失敗", e instanceof Error ? e.name : typeof e);
      result = { ok: false, error: error ?? "failed" };
    }
  }
  const at = deps.now();
  const guard = opts.force ? "ai_summary IS NULL" : "ai_summary_at IS NULL";
  if (result.ok) {
    await db
      .prepare(
        `UPDATE signals SET ai_summary = ?2, ai_summary_model = ?3, ai_summary_error = NULL, ai_summary_at = ?4 WHERE id = ?1 AND ${guard}`,
      )
      .bind(sig.id, result.summary, result.model, at)
      .run();
  } else {
    await db
      .prepare(`UPDATE signals SET ai_summary_error = ?2, ai_summary_at = ?3 WHERE id = ?1 AND ${guard}`)
      .bind(sig.id, result.error, at)
      .run();
  }
  const after = await readSignal(db, t);
  return { status: "summarized", result, view: summaryOf(after ?? sig) };
}
