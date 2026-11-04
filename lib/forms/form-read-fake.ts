// 様式の読み取りの偽の返事（テストと評価の台の偽の client が使う。本物の API は呼ばない）。T120 から 1 頁 1 回で読むので、
// 前からの返事の形（ReadResult。正解の表・固定の返事）から、頼まれた頁の分を 1 頁の返事の形（PageReadSchema）にして返す。

import type Anthropic from "@anthropic-ai/sdk";
import { toPageRead } from "./form-read.ts";
import type { ReadResult } from "./mapping.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** 頼みの入力の JSON（利用者の文の最後の文の塊）。読めなければ null */
export function requestInput(params: Params): Record<string, unknown> | null {
  const content = params.messages[0]?.content;
  const text = typeof content === "string" ? content : (content ?? []).filter((b): b is Anthropic.Beta.Messages.BetaTextBlockParam => b.type === "text").map((b) => b.text).at(-1);
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 頼まれた頁の番号（様式の読み取りの入力の「頁」）。無ければ 1 */
export function requestedPage(params: Params): number {
  const page = (requestInput(params)?.頁 as { no?: unknown } | undefined)?.no;
  return typeof page === "number" && Number.isInteger(page) && page >= 1 ? page : 1;
}

/** 続きの頼みで渡した読み済みの欄（段と欄の名前）。続きの頼みでなければ null */
export function requestedDone(params: Params): Array<{ 段: string; 欄: string }> | null {
  const done = requestInput(params)?.読み済み;
  return Array.isArray(done) ? (done as Array<{ 段: string; 欄: string }>) : null;
}

/**
 * 前からの返事の形から、頼まれた頁の返事の文（JSON）。続きの頼みなら、読み済みの欄の後ろの欄だけ
 */
export function pageReadReply(answer: ReadResult, params: Params): string {
  const page = toPageRead(answer, requestedPage(params));
  const done = requestedDone(params);
  if (!done) return JSON.stringify(page);
  const seen = new Set(done.map((d) => `${d.段}\u0000${d.欄}`));
  return JSON.stringify({ ...page, sections: page.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => !seen.has(`${s.name}\u0000${f.label}`)) })).filter((s) => s.fields.length > 0) });
}
