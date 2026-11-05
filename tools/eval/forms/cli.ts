// 書類の AI の評価の台（T107）。npm run eval:forms
//
//   node tools/eval/forms/cli.ts [--real] [--gold] [--paper=all|pdf|png|none] [--forms=komorebi,aozora] [--inputs=text-,photo-p-01]
//                                [--people=p-01,p-02] [--paper-all-forms] [--out=<回の置き場>] [--corpus=<様式の置き場>] [--no-corpus] [--no-progress] [--max-usd=10]
//                                [--review] [--no-review]
//
// - 既定は偽の client（本物の API を呼ばない）。--gold は崩さない偽（台の数え方の確かめ）
// - 紙の AI の照合（T136）は偽の回は既定で回す（--no-review で止める）。本物の回は --review のときだけ（紙 1 枚 1 回の Sonnet）
// - --real は本物の API。鍵は環境変数 ANTHROPIC_API_KEY だけを読む（台は鍵のファイルを探さない・読まない。人が node の --env-file で渡す）
// - 回のフォルダ（既定 ../care72-qa/eval/forms/<日時>-<fake|real>/）に calls.jsonl・steps.jsonl・judgements.jsonl・result.json・
//   report.md・sent/（送った画像）・filled/（埋めた紙と index.html）。リポジトリの中を指すと止まる
// - 前の回との差の md を docs/progress/eval-forms-<回>.md に（数だけ）。終わりに 1 行の要約

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffMarkdown, oneLine, writeIndex } from "./report.ts";
import { previousRun, REPO_ROOT, runEval, type PaperMode } from "./run.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const list = (name: string) => value(name)?.split(",").map((s) => s.trim()).filter(Boolean);

const real = flag("real");
const apiKey = real ? process.env.ANTHROPIC_API_KEY?.trim() : undefined;
if (real && !apiKey) {
  console.error("本物の回は鍵が要る: 環境変数 ANTHROPIC_API_KEY（node の --env-file で鍵のファイルを渡す）。台は鍵を探さない");
  process.exit(2);
}
const paper = (value("paper") ?? "all") as PaperMode;
if (!["none", "png", "pdf", "all"].includes(paper)) {
  console.error("--paper は all・pdf・png・none");
  process.exit(2);
}
// 費用の見積もりの上限（ドル、本物の回だけ。既定 10）。超えたら次の様式・入力を始めない
const maxUsdRaw = value("max-usd");
const maxUsd = maxUsdRaw === undefined ? (real ? 10 : null) : Number(maxUsdRaw);
if (maxUsd !== null && !(Number.isFinite(maxUsd) && maxUsd > 0)) {
  console.error("--max-usd は正の数");
  process.exit(2);
}
const outRoot = value("out") ?? process.env.CARE72_EVAL_OUT ?? join(REPO_ROOT, "..", "care72-qa", "eval", "forms");
const corpusRoot = flag("no-corpus") ? null : (value("corpus") ?? process.env.CARE72_EVAL_CORPUS ?? join(REPO_ROOT, "..", "care72-eval-corpus", "forms"));

const t0 = Date.now();
const result = await runEval({
  mode: real ? "real" : "fake",
  fakeStyle: flag("gold") ? "gold" : "noisy",
  apiKey,
  outRoot,
  corpusRoot,
  progressDir: flag("no-progress") ? null : join(REPO_ROOT, "docs", "progress"),
  paper,
  paperAllForms: flag("paper-all-forms"),
  forms: list("forms"),
  inputs: list("inputs"),
  people: list("people"),
  maxUsd,
  review: flag("review") || (!real && !flag("no-review")),
  log: (line) => process.stderr.write(`${line}\n`),
});
const prev = previousRun(outRoot, result);
const md = diffMarkdown(result, prev);
writeFileSync(join(result.dir, "report.md"), md, "utf8");
if (!flag("no-progress")) writeFileSync(join(REPO_ROOT, "docs", "progress", `eval-forms-${result.run}.md`), md, "utf8");
const index = writeIndex(result);
process.stderr.write(`回のフォルダ ${result.dir}\n一覧 ${index}\n${Math.round((Date.now() - t0) / 1000)} 秒\n`);
console.log(oneLine(result, prev));
