// 点数の表（T157）が読む、台ごとの数の JSON の形と、回のフォルダの読み方。
// 型は台の物をそのまま借りる（import type なので、台の中身は読み込まない）。読むのは数の JSON だけで、記録の jsonl は読まない。
//
//   訓練     <回>/summary.json（version 1・runs・totals・diversity）
//   書類     <回>/result.json（forms・inputs・papers・calls・leaks）
//   声の会話 <回>/summary.json（bench "talk"。T157 より前は totals だけの形）
//   ほか     <回>/scorecard.json（GenericScorecard。T156 の使う側の模擬など）

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Summary as DrillSummary } from "./drill/report.ts";
import type { RunResult as FormsRunResult } from "./forms/run.ts";
import type { TalkEvalSummary } from "./talk/run.ts";
import type { RunClient } from "./findings.ts";
import type { BenchData, GenericScorecard } from "./scorecard-items.ts";

export type DrillSummaryLike = Pick<DrillSummary, "version" | "stamp" | "client" | "runs" | "totals" | "diversity" | "judgeMean">;
export type FormsResultLike = Pick<FormsRunResult, "run" | "mode" | "forms" | "inputs" | "papers" | "calls" | "leaks">;
/** 声の会話の summary.json（T157 から version・bench・run・real を足した。前は totals だけ） */
export type TalkSummaryLike = { version?: 1; bench?: "talk"; run?: string; real?: boolean; totals: TalkEvalSummary["totals"] };

const readJson = (path: string): unknown => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
};

const clientOfName = (name: string): RunClient => (/-real$/.test(name) ? "real" : /-replay$/.test(name) ? "replay" : "fake");

const isDrill = (x: unknown): x is DrillSummaryLike => {
  const o = x as DrillSummaryLike;
  return !!o && o.version === 1 && Array.isArray(o.runs) && !!o.totals && !!o.diversity;
};
const isForms = (x: unknown): x is FormsResultLike => {
  const o = x as FormsResultLike;
  return !!o && Array.isArray(o.forms) && Array.isArray(o.papers) && !!o.calls && !!o.leaks;
};
/** 声の会話の summary.json（T157 の形か、前の totals だけの形） */
export function talkOf(x: unknown): TalkSummaryLike | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (o.bench === "talk" && o.totals && typeof o.totals === "object") return o as unknown as TalkSummaryLike;
  if (typeof o.closedEarly === "number" && typeof o.banned === "number") return { totals: o as unknown as TalkEvalSummary["totals"] };
  return null;
}
const isGeneric = (x: unknown): x is GenericScorecard => {
  const o = x as GenericScorecard;
  return !!o && o.version === 1 && typeof o.bench === "string" && !!o.values && typeof o.values === "object";
};

/** 回のフォルダを読む（台の数の JSON が無ければ空） */
export function readRunDir(dir: string): BenchData[] {
  const name = basename(dir);
  const out: BenchData[] = [];
  const generic = readJson(join(dir, "scorecard.json"));
  if (isGeneric(generic)) out.push({ bench: generic.bench, run: generic.run ?? name, client: generic.client ?? clientOfName(name), generic });
  const summary = readJson(join(dir, "summary.json"));
  if (isDrill(summary)) out.push({ bench: "drill", run: summary.stamp ?? name, client: summary.client, data: summary });
  else {
    const talk = talkOf(summary);
    if (talk) out.push({ bench: "talk", run: talk.run ?? name, client: talk.real === undefined ? clientOfName(name) : talk.real ? "real" : "fake", data: talk });
  }
  const result = readJson(join(dir, "result.json"));
  if (isForms(result)) out.push({ bench: "forms", run: result.run ?? name, client: result.mode, data: result });
  return out;
}
