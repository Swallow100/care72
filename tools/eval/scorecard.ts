// 評価の点数の表（T157）。各台の回の結果（数の JSON）を集め、「項目 × r1…rN」の表を docs/progress/eval-scorecard.md に作る。
//
//   npm run eval:scorecard                                         種（r1〜r5）だけで表を作り直す
//   npm run eval:scorecard -- --runs r6=<訓練の回> r6=<書類の回> r6=<声の会話の回>   同じ名前の回は 1 つの列に
//   npm run eval:scorecard -- --runs <回のフォルダ>...             名前を付けなければ回のフォルダの名前が列の名前
//
// 引数: --runs <[名前=]回のフォルダ>...（次の -- の引数まで）・--out <md>（既定 docs/progress/eval-scorecard.md）・--no-seed（種の r1〜r5 を並べない）・
//       --print（書かずに出す）
//
// 回のフォルダは各台の置き場（リポジトリの隣の care72-qa/eval/<台>/<回>）。読むのは数の JSON だけ（tools/eval/scorecard-shapes.ts）。
// 印: 前の回（その項目に数のある、左の一番近い列）より悪い向きに動いた物に「（悪）」、しきい値か守り（tools/eval/guards.ts）を外れた物に「（外）」。

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BENCH_LABELS, meets, type Bench, type RunClient } from "./findings.ts";
import { GUARDS, guardsOn, type Guard } from "./guards.ts";
import { combine, genericItems, ITEMS, rawOf, type BenchData, type Item } from "./scorecard-items.ts";
import { SEED, type SeedRound } from "./scorecard-seed.ts";
import { readRunDir } from "./scorecard-shapes.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_OUT = join(REPO, "docs", "progress", "eval-scorecard.md");

export type Cell = { value: number | null; shown?: string; frac?: readonly [number, number] };
export type Column = {
  label: string;
  /** seed（手で写した数）か run（回のフォルダ） */
  from: "seed" | "run";
  /** 回のフォルダの名前と台・client（run の列だけ） */
  sources: Array<{ bench: Bench; run: string; client: RunClient }>;
  cells: Record<string, Cell>;
};

/** 回のフォルダの列。同じ名前の回は 1 つの列に（同じ台が 2 つ以上なら項目の agg で 1 つの数に） */
export function runColumns(entries: ReadonlyArray<{ label: string; data: ReadonlyArray<BenchData> }>): { columns: Column[]; extra: Item[] } {
  const order: string[] = [];
  const byLabel = new Map<string, BenchData[]>();
  for (const e of entries) {
    if (!byLabel.has(e.label)) order.push(e.label);
    byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), ...e.data]);
  }
  // ほかの台（scorecard.json）の項目
  const extra = new Map<string, Item>();
  for (const ds of byLabel.values()) for (const d of ds) if ("generic" in d) for (const it of genericItems(d.generic)) if (!extra.has(it.id) && !ITEMS.some((x) => x.id === it.id)) extra.set(it.id, it);
  const items = [...ITEMS, ...extra.values()];
  const columns = order.map((label): Column => {
    const ds = byLabel.get(label)!;
    const cells: Record<string, Cell> = {};
    for (const item of items) {
      const raws = ds.filter((d) => d.bench === item.bench).map((d) => rawOf(item, d));
      const c = combine(item, raws);
      if (c.value !== null) cells[item.id] = c.frac ? { value: c.value, frac: c.frac } : { value: c.value };
    }
    return { label, from: "run", sources: ds.map((d) => ({ bench: d.bench, run: d.run, client: d.client })), cells };
  });
  return { columns, extra: [...extra.values()] };
}

export function seedColumns(seed: ReadonlyArray<SeedRound> = SEED): Column[] {
  return seed.map((r) => ({ label: r.round, from: "seed", sources: [], cells: { ...r.values } }));
}

// ---------- 数の出し方 ----------

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const comma = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en-US") : round(v, 2).toLocaleString("en-US"));

export function formatCell(item: Item, c: Cell | undefined): string {
  if (!c) return "-";
  if (c.shown !== undefined) return c.shown;
  if (c.value === null) return "-";
  switch (item.unit) {
    case "frac":
      return c.frac ? `${comma(c.frac[0])}/${comma(c.frac[1])}` : `${round(c.value * 100, 1)}%`;
    case "rate":
      // 分子・分母があれば並べる（種の表と同じ書き方）
      return c.frac ? `${comma(c.frac[0])}/${comma(c.frac[1])}` : `${round(c.value * 100, 1)}%`;
    case "score":
      return c.value.toFixed(2);
    case "sec":
      return round(c.value, 1).toFixed(1);
    case "usd":
      return c.value.toFixed(2);
    default:
      return comma(c.value);
  }
}

/** しきい値と守り（項目の threshold と GUARDS） */
export function limitsOf(item: Item, guards: ReadonlyArray<Guard> = GUARDS, client?: RunClient): Array<{ op: Guard["op"]; value: number; from: string }> {
  return [...(item.threshold ? [{ ...item.threshold, from: "しきい値" }] : []), ...guardsOn(item.id, guards, client).map((g) => ({ op: g.op, value: g.value, from: `守り ${g.id}` }))];
}

/** 印（前の回より悪い・しきい値の外） */
export function marksOf(item: Item, prev: Cell | undefined, cur: Cell | undefined, guards: ReadonlyArray<Guard> = GUARDS, client?: RunClient): { worse: boolean; outside: boolean } {
  const v = cur?.value ?? null;
  const p = prev?.value ?? null;
  const worse = v !== null && p !== null && item.better !== null && (item.better === "higher" ? v < p - 1e-9 : v > p + 1e-9);
  const outside = v !== null && limitsOf(item, guards, client).some((l) => !meets(v, l.op, l.value));
  return { worse, outside };
}

const BETTER_LABELS = { higher: "多いほど良い", lower: "少ないほど良い" } as const;
const opLabel = (op: Guard["op"]) => (op === "<=" ? "≦" : op === ">=" ? "≧" : "＝");

export function scorecardMarkdown(columns: ReadonlyArray<Column>, opts: { extra?: ReadonlyArray<Item>; guards?: ReadonlyArray<Guard>; command?: string } = {}): string {
  const guards = opts.guards ?? GUARDS;
  const items = [...ITEMS, ...(opts.extra ?? [])];
  const benches = [...new Set(items.map((x) => x.bench))];
  const lines: string[] = [];
  lines.push("# 評価の点数の表");
  lines.push("");
  lines.push("T157 の道具（tools/eval/scorecard.ts）が作った表。手で直さない（作り直すと消える）。台の回の数と、r1〜r5 は手で写した種（tools/eval/scorecard-seed.ts）。");
  lines.push("");
  lines.push(`- 作り方: \`${opts.command ?? "npm run eval:scorecard"}\``);
  lines.push("- 印: 「（悪）」は前の回（左の一番近い数のある列）より悪い向きに動いた物、「（外）」はしきい値か守り（tools/eval/guards.ts）を外れた物");
  lines.push("- 種の出典: docs/progress/eval-r5.md の「r1〜r5 の要約」の表。r4 は主の列（着信の回・同じ紙の列は写していない）。表の字のままの所は数にしていない");
  lines.push("- 回ごとに選び方（想定・人・様式・入力）が違う。違う選び方の列どうしの差は目安");
  const runCols = columns.filter((c) => c.from === "run");
  if (runCols.length > 0) {
    lines.push("");
    lines.push("## 列");
    lines.push("");
    for (const c of runCols) {
      const src = c.sources.map((s) => `${BENCH_LABELS[s.bench]} ${s.run}（${s.client === "fake" ? "偽" : s.client === "real" ? "本物" : "数え直し"}）`).join("・");
      lines.push(`- ${c.label}: ${src || "数の JSON なし"}`);
    }
    if (runCols.some((c) => c.sources.some((s) => s.client === "fake"))) lines.push("- 偽の client の回の数は台の確かめ用で、AI の力ではない");
  }
  for (const bench of benches) {
    const rows = items.filter((x) => x.bench === bench && columns.some((c) => c.cells[x.id] !== undefined));
    if (rows.length === 0) continue;
    lines.push("");
    lines.push(`## ${BENCH_LABELS[bench]}`);
    lines.push("");
    lines.push(`| 項目 | 向き | しきい値 | ${columns.map((c) => c.label).join(" | ")} |`);
    lines.push(`| --- | --- | --- | ${columns.map(() => "---:").join(" | ")} |`);
    for (const item of rows) {
      let prev: Cell | undefined;
      const cells = columns.map((c) => {
        const cur = c.cells[item.id];
        const { worse, outside } = marksOf(item, prev, cur, guards, c.sources.find((x) => x.bench === item.bench)?.client);
        if (cur && cur.value !== null) prev = cur;
        return `${formatCell(item, cur)}${worse ? "（悪）" : ""}${outside ? "（外）" : ""}`;
      });
      const limits = limitsOf(item, guards)
        .map((l) => `${opLabel(l.op)} ${item.unit === "frac" ? comma(l.value) : formatCell(item, { value: l.value })}`)
        .filter((x, i, a) => a.indexOf(x) === i)
        .join("・");
      lines.push(`| ${item.label}${item.seedOnly ? "（種だけ）" : ""}${item.notes?.length ? "（注）" : ""} | ${item.better ? BETTER_LABELS[item.better] : "-"} | ${limits || "-"} | ${cells.join(" | ")} |`);
    }
  }
  // 数え方を変えた項目の注（T161。tools/eval/scorecard-items.ts の notes）。前の回と比べるときに混ざらないよう
  const noted = items.filter((x) => x.notes?.length && columns.some((c) => c.cells[x.id] !== undefined));
  if (noted.length > 0) {
    lines.push("");
    lines.push("## 注");
    lines.push("");
    lines.push("数え方を変えた項目。前の回の列は前の数え方の数のまま（数え直していない）。");
    lines.push("");
    for (const item of noted) for (const n of item.notes!) lines.push(`- ${BENCH_LABELS[item.bench]} ${item.label}: ${n}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------- 引数 ----------

export type ScorecardArgs = { runs: Array<{ label: string; dir: string }>; out: string; seed: boolean; print: boolean };

export function parseArgs(argv: ReadonlyArray<string>): ScorecardArgs {
  const runs: ScorecardArgs["runs"] = [];
  let out = DEFAULT_OUT;
  let seed = true;
  let print = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = resolve(argv[++i]);
    else if (a.startsWith("--out=")) out = resolve(a.slice(6));
    else if (a === "--no-seed") seed = false;
    else if (a === "--print") print = true;
    else if (a === "--runs") continue;
    else if (!a.startsWith("--")) {
      const m = /^([^=\\/:]+)=(.+)$/.exec(a);
      const dir = resolve(m ? m[2] : a);
      runs.push({ label: m ? m[1] : basename(dir), dir });
    }
  }
  return { runs, out, seed, print };
}

export function buildScorecard(a: ScorecardArgs): { md: string; columns: Column[]; empty: string[] } {
  const entries = a.runs.map((r) => ({ label: r.label, data: readRunDir(r.dir) }));
  const empty = a.runs.filter((_, i) => entries[i].data.length === 0).map((r) => r.dir);
  const { columns: runs, extra } = runColumns(entries);
  const columns = [...(a.seed ? seedColumns() : []), ...runs];
  const command = ["npm run eval:scorecard", ...(a.runs.length > 0 ? ["--", "--runs", ...a.runs.map((r) => `${r.label}=<${basename(r.dir)}>`)] : []), ...(a.seed ? [] : ["--no-seed"])].join(" ");
  return { md: scorecardMarkdown(columns, { extra, command }), columns, empty };
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const { md, empty } = buildScorecard(a);
  for (const d of empty) console.error(`数の JSON が無い: ${d}`);
  if (a.print) {
    console.log(md);
    return;
  }
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out, md, "utf8");
  console.log(`点数の表: ${a.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
