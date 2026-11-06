// 書類の AI の評価の台（T107）。npm run eval:forms
//
//   node tools/eval/forms/cli.ts [--real] [--gold] [--paper=all|pdf|png|none] [--forms=komorebi,aozora] [--inputs=text-,photo-p-01]
//                                [--people=p-01,p-02] [--paper-all-forms] [--out=<回の置き場>] [--corpus=<様式の置き場>] [--no-corpus] [--no-progress] [--max-usd=10]
//                                [--replay=<前の本物の回のフォルダ> --run=<回の名前>]
//                                [--forms=catalog | --forms=cat-sapporo-1,cat-kumamoto-2] [--catalog-fetch]
//                                [--review] [--no-review] [--review-only=<様式>:<入力>,...] [--reread-max=N] [--drift-from=<比べる回のフォルダ>]
//
// - 既定は偽の client（本物の API を呼ばない）。--gold は崩さない偽（台の数え方の確かめ）
// - 紙の AI の照合（T136）は偽の回は既定で回す（--no-review で止める）。本物の回は --review のときだけ（紙 1 枚 1 回の Sonnet）
// - --real は本物の API。鍵は環境変数 ANTHROPIC_API_KEY だけを読む（台は鍵のファイルを探さない・読まない。人が node の --env-file で渡す）
// - 回のフォルダ（既定 ../care72-qa/eval/forms/<日時>-<fake|real>/）に calls.jsonl・steps.jsonl・judgements.jsonl・result.json・
//   report.md・findings.json（指摘、T157）・sent/（送った画像）・filled/（埋めた紙と index.html）。リポジトリの中を指すと止まる
// - 前の回との差の md を docs/progress/eval-forms-<回>.md に（数だけ）。終わりに 1 行の要約
// - 一覧の様式（T134、lib/forms/municipal-forms.ts）: --forms=catalog で取り込める物を全部、cat-<様式の id> で選んで。原本は置き場の
//   版のハッシュが同じファイル → 回の置き場の親の _catalog/ の写し → --catalog-fetch のときだけ一覧の URL から取る（版が同じ物を写しに置く）。
//   読み取りは一覧の道（共有の対応表）で、2 つ目の事業所が AI を呼ばずに写せたかを数える

import dns from "node:dns";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reviewDrift, type DriftPaper } from "./drift.ts";
import { diffMarkdown, oneLine, writeIndex } from "./report.ts";
import { writeFormsFindings } from "./findings.ts";
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

// 数え直し（T133）: 前の本物の回の返事で、今のコードの紙と数を出す（API を呼ばない。前の回のフォルダは読むだけ）
const replayDir = value("replay");
if (real && replayDir) {
  console.error("--real と --replay は一緒に使えない");
  process.exit(2);
}

/**
 * 一覧の公式の URL を取る（T140）。評価の 4 回目で浜松市が取れなかったのは、作業者の端末から IPv6 の経路で TLS が途中で切られた物
 * （IPv4 なら取れて、版のハッシュは一覧と同じ）。名前は IPv4 を先に引き、接続の失敗（例外）は間を置いて 3 回まで試す。
 * 取る URL は変えない（一覧の url と、fetchOfficial が許す転送の先だけ）。アプリの受け口（Workers の fetch）は触らない
 */
dns.setDefaultResultOrder("ipv4first");
async function catalogFetch(url: string): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw last;
}

const t0 = Date.now();
const result = await runEval({
  mode: real ? "real" : replayDir ? "replay" : "fake",
  ...(replayDir ? { replayDir, runId: value("run") } : {}),
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
  // 一覧の URL から取る（転送は自分でたどる。lib/forms/municipal-http.ts の fetchOfficial が一覧のホストの中だけに絞る）
  catalogFetch: flag("catalog-fetch") ? catalogFetch : null,
  review: flag("review") || (!real && !flag("no-review")),
  // 照合を回す紙を絞る（本物の回の費用のため）と、再考する紙の数の上限
  ...(list("review-only") ? { reviewOnly: list("review-only") } : {}),
  ...(value("reread-max") ? { rereadMax: Math.max(0, Math.floor(Number(value("reread-max")) || 0)) } : {}),
  log: (line) => process.stderr.write(`${line}\n`),
});
// 読み取りの揺れ（T175）: 比べる回は同じコードで数え直した物（--replay）にする。古いコードの回と比べるとコードの差が混ざる
const driftFrom = value("drift-from");
if (driftFrom) {
  const other = JSON.parse(readFileSync(join(driftFrom, "result.json"), "utf8")) as { papers: DriftPaper[] };
  result.drift = { from: driftFrom, ...reviewDrift(other.papers, result.papers) };
  writeFileSync(join(result.dir, "result.json"), JSON.stringify(result, null, 2), "utf8");
}
const prev = previousRun(outRoot, result);
const md = diffMarkdown(result, prev);
writeFileSync(join(result.dir, "report.md"), md, "utf8");
if (!flag("no-progress")) writeFileSync(join(REPO_ROOT, "docs", "progress", `eval-forms-${result.run}.md`), md, "utf8");
const index = writeIndex(result);
// 指摘（T157）: 共通の形の findings.json を回のフォルダに（数と様式の id だけ。tools/eval/findings.ts）
const found = writeFormsFindings(result, outRoot);
process.stderr.write(`回のフォルダ ${result.dir}\n一覧 ${index}\n指摘 ${found.findings}（守りの外れ ${found.guarded}）\n${Math.round((Date.now() - t0) / 1000)} 秒\n`);
console.log(oneLine(result, prev));
