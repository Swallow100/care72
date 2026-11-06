// 評価の台（tools/eval）の指摘の共通の形（T157）。訓練・書類・声の会話・使う側の模擬（T156）が同じ形で findings.json を書く。
// 台ごとの import を持たない（どの台からも、T156 からも、この 1 つだけを読めば使える）。
//
// 指摘 1 つ = 同じ原因（cause）の引っかかりを、1 回の結果の中でまとめた物。回をまたいだ「初めて出た回」は、同じ置き場の前の回の
// findings.json を名前の順にたどって引き継ぐ（firstSeenFrom）。r1〜r5 には findings.json が無いので、この仕組みは r6 からの回で数える。
//
// 根拠の抜き書き（evidence）は台詞や名前が入りうるので、回のフォルダ（リポジトリの外）の findings.json にだけ置く。
// 下書き（tools/eval/drafts.ts）と点数の表には写さない。場所（where）には絶対の道を入れない（回の名前と、回のフォルダからの相対の名前）。

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 台。persona は使う側の模擬（T156） */
export type Bench = "drill" | "forms" | "talk" | "persona";
export const BENCHES: ReadonlyArray<Bench> = ["drill", "forms", "talk", "persona"];
export const BENCH_LABELS: Readonly<Record<Bench, string>> = { drill: "訓練", forms: "書類", talk: "声の会話", persona: "使う側の模擬" };

/** 重さ 3 段。high 重（利用者に害・漏れ・止まる）、mid 中（結果が違う・筋が崩れる）、low 軽（見た目・偏り・目安の外） */
export type Severity = "high" | "mid" | "low";
export const SEVERITIES: ReadonlyArray<Severity> = ["high", "mid", "low"];
export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = { high: "重", mid: "中", low: "軽" };

/** 回の client（偽・本物・数え直し） */
export type RunClient = "fake" | "real" | "replay";

/** 場所。画面（利用者が見る所）か、ファイル（記録のファイル・様式など。回のフォルダからの相対の名前）と、記録の行 */
export type Place = {
  /** 画面（例「訓練 > 経過」） */
  screen?: string;
  /** ファイル（例「run-01.jsonl」「judgements.jsonl」。絶対の道は入れない） */
  file?: string;
  /** 記録の行（例「run-01.jsonl seq 304」） */
  refs?: string[];
};

export type AcceptOp = "<=" | ">=" | "==";

/**
 * 受け入れの確かめ（数で言える物）。item は点数の表の項目の id（tools/eval/scorecard-items.ts）か、`count:<cause>`（その回の同じ原因の指摘の数の合計）。
 * そのまま tools/eval/guards.ts の GUARDS に足せる形（id・since・task を足す）
 */
export type Accept = { item: string; op: AcceptOp; value: number };

export type Finding = {
  /** 回をまたいで同じ物を指す鍵（cause と、細かい場所〔様式・筋など〕） */
  id: string;
  bench: Bench;
  /** 原因の鍵（例 drill:banned:shown:dose、forms:paper.wrong）。下書きはこれでまとめる */
  cause: string;
  /** 台の決まりの名前（例 banned:dose、paper.wrong） */
  rule: string;
  /** 短い題（数と種類だけ。中身の写し・名前を入れない） */
  title: string;
  where: Place;
  severity: Severity;
  /** この回で引っかかった数 */
  count: number;
  /** 再現の手順（台の回し方と、記録のどこを見るか） */
  repro: string[];
  /** 疑うファイル（リポジトリの中の相対の名前） */
  suspects: string[];
  accept: Accept;
  /** 初めて出た回（回の名前） */
  firstSeen: string;
  /** 根拠の抜き書き（回のフォルダの中だけ。下書き・表には写さない） */
  evidence?: string[];
};

export type FindingsFile = {
  version: 1;
  bench: Bench;
  /** 回の名前（回のフォルダの名前） */
  run: string;
  client: RunClient;
  findings: Finding[];
};

export const FINDINGS_FILE = "findings.json";

/** 指摘の鍵（cause と細かい場所） */
export function findingId(cause: string, detail?: string | null): string {
  return detail ? `${cause}@${detail}` : cause;
}

/** 抜き書きは 5 つまで・1 つ 80 字まで（回のフォルダの中でも長くしない） */
export function clipEvidence(xs: ReadonlyArray<string>, max = 5): string[] {
  return [...new Set(xs.filter(Boolean))].slice(0, max).map((x) => Array.from(x).slice(0, 80).join(""));
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { high: 0, mid: 1, low: 2 };

/** 重い順・数の多い順・鍵の順 */
export function sortFindings(fs: ReadonlyArray<Finding>): Finding[] {
  return [...fs].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.id.localeCompare(b.id));
}

/** 前の回の findings.json（同じ置き場・同じ client・この回より前の名前）を新しい順に */
export function previousFindings(root: string, run: string, client: RunClient): FindingsFile[] {
  if (!existsSync(root)) return [];
  const out: FindingsFile[] = [];
  const names = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < run)
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const name of names) {
    const f = readFindings(join(root, name, FINDINGS_FILE));
    if (f && f.client === client) out.push(f);
  }
  return out;
}

/** 初めて出た回を、前の回の findings.json から引き継ぐ（同じ id が前にあれば、その firstSeen） */
export function withFirstSeen(findings: ReadonlyArray<Finding>, previous: ReadonlyArray<FindingsFile>): Finding[] {
  const seen = new Map<string, string>();
  // 古い回から順に見て、いちばん古い firstSeen を残す
  for (const f of [...previous].reverse()) for (const x of f.findings) if (!seen.has(x.id)) seen.set(x.id, x.firstSeen);
  return findings.map((x) => ({ ...x, firstSeen: seen.get(x.id) ?? x.firstSeen }));
}

/** 回の findings.json を書く（初めて出た回は同じ置き場の前の回から引き継ぐ）。書いた道を返す */
export function writeFindings(dir: string, file: Omit<FindingsFile, "version">, opts: { root?: string } = {}): string {
  const previous = opts.root ? previousFindings(opts.root, file.run, file.client) : [];
  const body: FindingsFile = { version: 1, ...file, findings: sortFindings(withFirstSeen(file.findings, previous)) };
  const path = join(dir, FINDINGS_FILE);
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return path;
}

export function isFindingsFile(x: unknown): x is FindingsFile {
  const o = x as FindingsFile;
  return !!o && o.version === 1 && BENCHES.includes(o.bench) && typeof o.run === "string" && Array.isArray(o.findings);
}

/** findings.json を読む（無い・形が違えば null） */
export function readFindings(path: string): FindingsFile | null {
  if (!existsSync(path)) return null;
  try {
    const x = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isFindingsFile(x) ? x : null;
  } catch {
    return null;
  }
}

/** 同じ原因の指摘の数の合計（受け入れの `count:<cause>` の値） */
export function causeCounts(findings: ReadonlyArray<Finding>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.cause] = (out[f.cause] ?? 0) + f.count;
  return out;
}

/** 受け入れの確かめに合うか */
export function meets(value: number, op: AcceptOp, target: number): boolean {
  if (op === "<=") return value <= target + 1e-9;
  if (op === ">=") return value >= target - 1e-9;
  return Math.abs(value - target) < 1e-9;
}
