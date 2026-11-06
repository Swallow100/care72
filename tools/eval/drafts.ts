// 指摘から作業の下書き（T157）。findings.json（tools/eval/findings.ts の形）を 1 つ以上読み、同じ原因（cause）の指摘をまとめて、
// docs/tasks に置ける作業の下書き（何を直すか・疑うファイル・再現の手順・受け入れの確かめ）を出す。
//
//   npm run eval:drafts -- <findings.json か回のフォルダ>...                 下書きを出す（書かない）
//   npm run eval:drafts -- <…> --out <置き場>                                 置き場に 1 原因 1 ファイル（draft-<原因>.md）と一覧（index.md）
//   npm run eval:drafts -- <…> --min mid                                      重さ「中」から（high・mid・low）
//
// 根拠の抜き書き（evidence）は写さない。受け入れの確かめは tools/eval/guards.ts の GUARDS にそのまま足せる形で書く（足し方は docs/progress/t157.md）。

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BENCH_LABELS, FINDINGS_FILE, readFindings, SEVERITIES, SEVERITY_LABELS, type Accept, type Bench, type Finding, type FindingsFile, type Severity } from "./findings.ts";
import { itemOf } from "./scorecard-items.ts";

export type Draft = {
  cause: string;
  benches: Bench[];
  title: string;
  severity: Severity;
  /** 合計の数と、出た回 */
  count: number;
  runs: string[];
  firstSeen: string;
  places: Array<{ text: string; count: number }>;
  refs: string[];
  suspects: string[];
  repro: string[];
  accept: Accept;
  /** 外れた守り（tools/eval/guards.ts の id。直した物が戻った） */
  guards: string[];
};

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { high: 0, mid: 1, low: 2 };

/** 同じ原因の指摘をまとめる（重い順・数の多い順） */
export function groupFindings(files: ReadonlyArray<FindingsFile>, opts: { min?: Severity } = {}): Draft[] {
  const min = SEVERITY_ORDER[opts.min ?? "low"];
  const by = new Map<string, Array<{ f: Finding; run: string }>>();
  for (const file of files) for (const f of file.findings) if (SEVERITY_ORDER[f.severity] <= min) by.set(f.cause, [...(by.get(f.cause) ?? []), { f, run: file.run }]);
  const out: Draft[] = [];
  for (const [cause, xs] of by) {
    const severity = xs.map((x) => x.f.severity).sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b])[0];
    const places = new Map<string, number>();
    for (const { f } of xs) {
      const text = [f.where.screen, f.where.file].filter(Boolean).join("・") || "-";
      places.set(text, (places.get(text) ?? 0) + f.count);
    }
    out.push({
      cause,
      benches: [...new Set(xs.map((x) => x.f.bench))],
      title: xs[0].f.title,
      severity,
      count: xs.reduce((n, x) => n + x.f.count, 0),
      runs: [...new Set(xs.map((x) => x.run))].sort(),
      firstSeen: xs.map((x) => x.f.firstSeen).sort()[0],
      places: [...places].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
      refs: [...new Set(xs.flatMap((x) => (x.f.where.refs ?? []).map((r) => `${x.run} ${r}`)))].slice(0, 8),
      suspects: [...new Set(xs.flatMap((x) => x.f.suspects))],
      repro: [...new Set(xs.flatMap((x) => x.f.repro))].slice(0, 4),
      accept: xs[0].f.accept,
      guards: cause.startsWith("guard:") ? [cause.slice("guard:".length)] : [],
    });
  }
  // 守りの外れは、同じ項目を受け入れに持つ下書き（同じ原因）に寄せる（重さは「重」に）。寄せる先が無ければそのまま
  for (const g of out.filter((d) => d.guards.length > 0)) {
    const into = out.find((d) => d.guards.length === 0 && d.accept.item === g.accept.item);
    if (!into) continue;
    into.guards.push(...g.guards);
    into.severity = "high";
    into.runs = [...new Set([...into.runs, ...g.runs])].sort();
    into.suspects = [...new Set([...into.suspects, ...g.suspects])];
    out.splice(out.indexOf(g), 1);
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.cause.localeCompare(b.cause));
}

/** 原因の鍵からファイルの名前（英数字と - だけ） */
export const slugOf = (cause: string) => cause.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

const opWord = (op: Accept["op"]) => (op === "<=" ? "以下" : op === ">=" ? "以上" : "ちょうど");

/** 受け入れの確かめの言葉（項目の名前か、同じ原因の指摘の数） */
export function acceptText(a: Accept): string {
  const item = itemOf(a.item);
  const what = item ? `点数の表の「${item.label}」（${a.item}）` : a.item.startsWith("count:") ? `同じ原因の指摘の数（${a.item}）` : a.item;
  return `${what}が ${a.value} ${opWord(a.op)}`;
}

/** tools/eval/guards.ts の GUARDS に足す 1 件（id・since・task・label を書いて貼る） */
export function guardSnippet(d: Draft): string {
  const bench = d.benches[0];
  return [
    "{",
    `  id: "${slugOf(d.cause)}",`,
    `  bench: "${bench}",`,
    `  item: "${d.accept.item}",`,
    `  op: "${d.accept.op}",`,
    `  value: ${d.accept.value},`,
    `  since: "<直したあとの最初の回>",`,
    `  task: "<直した作業 TNNN>",`,
    `  label: "${d.title}",`,
    `  suspects: [${d.suspects.map((s) => `"${s}"`).join(", ")}],`,
    "},",
  ].join("\n");
}

export function draftMarkdown(d: Draft): string {
  const lines: string[] = [];
  lines.push(`# 下書き: ${d.title}`);
  lines.push("");
  lines.push(`評価の台の指摘（${d.cause}）から作った作業の下書き（tools/eval/drafts.ts）。番号・意図・触らない所を足して docs/tasks に置く。`);
  lines.push("");
  lines.push(`- 台: ${d.benches.map((b) => BENCH_LABELS[b]).join("・")}`);
  lines.push(`- 重さ: ${SEVERITY_LABELS[d.severity]}`);
  lines.push(`- 数: ${d.count}（回 ${d.runs.length}: ${d.runs.join("・")}）`);
  lines.push(`- 初めて出た回: ${d.firstSeen}`);
  lines.push("");
  lines.push("## 何を直すか");
  lines.push("");
  lines.push(`${d.title}。場所ごとの数:`);
  lines.push("");
  for (const p of d.places) lines.push(`- ${p.text}: ${p.count}`);
  lines.push("");
  lines.push("## 疑うファイル");
  lines.push("");
  for (const s of d.suspects) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## 再現の手順");
  lines.push("");
  d.repro.forEach((r, i) => lines.push(`${i + 1}. ${/^(npm|node) /.test(r) ? `\`${r}\`` : r}`));
  if (d.refs.length > 0) {
    lines.push("");
    lines.push("記録の行（回のフォルダの中。リポジトリの外）:");
    lines.push("");
    for (const r of d.refs) lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push("## 受け入れの確かめ");
  lines.push("");
  lines.push(`- ${acceptText(d.accept)}（次の回の台で）`);
  if (d.guards.length > 0) {
    // 守りはもう表にある（直した物が戻った）。守りは足さない
    lines.push(`- 守り ${d.guards.join("・")}（tools/eval/guards.ts）が外れた。直した物が戻っている`);
    lines.push("");
    return lines.join("\n");
  }
  lines.push("- 直したら tools/eval/guards.ts の GUARDS に足し、次の回から戻らないようにする（value は直したあとの回の数）:");
  lines.push("");
  lines.push("```ts");
  lines.push(guardSnippet(d));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function indexMarkdown(ds: ReadonlyArray<Draft>): string {
  const lines = ["# 指摘の下書きの一覧", "", "| 重さ | 台 | 原因 | 数 | 回 | 初めて | 下書き |", "| --- | --- | --- | ---: | ---: | --- | --- |"];
  for (const d of ds) lines.push(`| ${SEVERITY_LABELS[d.severity]} | ${d.benches.map((b) => BENCH_LABELS[b]).join("・")} | ${d.title} | ${d.count} | ${d.runs.length} | ${d.firstSeen} | draft-${slugOf(d.cause)}.md |`);
  lines.push("");
  return lines.join("\n");
}

/** 引数の道（findings.json か回のフォルダ）を読む */
export function loadFindings(paths: ReadonlyArray<string>): { files: FindingsFile[]; missing: string[] } {
  const files: FindingsFile[] = [];
  const missing: string[] = [];
  for (const p of paths) {
    const path = existsSync(p) && statSync(p).isDirectory() ? join(p, FINDINGS_FILE) : p;
    const f = readFindings(path);
    if (f) files.push(f);
    else missing.push(p);
  }
  return { files, missing };
}

/** 下書きを置き場に書く（1 原因 1 ファイルと一覧）。書いたファイルを返す */
export function writeDrafts(ds: ReadonlyArray<Draft>, dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const out = ds.map((d) => {
    const path = join(dir, `draft-${slugOf(d.cause)}.md`);
    writeFileSync(path, draftMarkdown(d), "utf8");
    return path;
  });
  const index = join(dir, "index.md");
  writeFileSync(index, indexMarkdown(ds), "utf8");
  return [index, ...out];
}

function main(): void {
  const argv = process.argv.slice(2);
  const paths: string[] = [];
  let out: string | null = null;
  let min: Severity = "low";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = resolve(argv[++i]);
    else if (a === "--min") {
      const m = argv[++i] as Severity;
      if (!SEVERITIES.includes(m)) {
        console.error("--min は high・mid・low");
        process.exitCode = 2;
        return;
      }
      min = m;
    } else if (!a.startsWith("--")) paths.push(resolve(a));
  }
  const { files, missing } = loadFindings(paths);
  for (const m of missing) console.error(`findings.json が読めない: ${m}`);
  const ds = groupFindings(files, { min });
  if (out) {
    const written = writeDrafts(ds, out);
    console.log(`下書き ${ds.length}: ${written[0]}`);
    return;
  }
  console.log(indexMarkdown(ds));
  for (const d of ds) console.log(draftMarkdown(d));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
