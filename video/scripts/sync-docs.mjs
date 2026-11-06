// 台本（docs/video/SCRIPT.md）の表と、計画（PLAN.md）の時間割と絵コンテを src/timeline.ts から作り直す。
// node scripts/sync-docs.mjs → npm run check
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LINES, SCENES } from "../src/timeline.ts";
import { ROOT } from "./lib.mjs";

const docs = join(ROOT, "..", "docs", "video");
const time = (t) => {
  const m = Math.floor(t / 60);
  const s = +(t - m * 60).toFixed(2);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

// SCRIPT.md の台本の表
const scriptPath = join(docs, "SCRIPT.md");
let script = readFileSync(scriptPath, "utf8");
const rows = LINES.map((l) => `| ${l.id} | ${time(l.at)}–${time(l.end)} | ${l.ja} | ${l.en} |`).join("\n");
script = script.replace(/(\| ID \| 秒 \| ナレーション \| 英語の字幕（案） \|\n\| --- \| --- \| --- \| --- \|\n)(\| N\d\d .*\n)+/, `$1${rows}\n`);
writeFileSync(scriptPath, script);

// PLAN.md の時間割と絵コンテ
const planPath = join(docs, "PLAN.md");
let plan = readFileSync(planPath, "utf8");
const inScene = (s) => LINES.filter((l) => l.at >= s.at - 0.01 && l.at < s.end - 0.01);
const table = SCENES.map((s) => {
  const ls = inScene(s).map((l) => l.id).join("・") || "（声なし）";
  return `| ${s.id} ${s.title} | ${time(s.at)}–${time(s.end)} | ${+(s.end - s.at).toFixed(1)} | ${ls} |`;
}).join("\n");
plan = plan.replace(/(\| 場面 \| 秒 \| 長さ \| 文 \|\n\| --- \| --- \| --- \| --- \|\n)(\| S\d .*\n)+/, `$1${table}\n`);
const words = (sh) => {
  const out = [];
  if (sh.chip) out.push(`右上に「${sh.chip}」`);
  if (sh.survey) out.push(`問「${sh.survey.question}」と選択肢 ${sh.survey.rows.length} つの人数`);
  if (sh.stat) out.push(`右下に「${sh.stat.label} ${sh.stat.text.replaceAll("／", "")} ${sh.stat.value}」`.replace(/ 」$/, "」"));
  if (sh.sub) out.push(`「${sh.sub.replaceAll("／", "／")}」`);
  if (sh.source) out.push(`出典「${sh.source}」`);
  if (sh.marker) out.push(`白い帯「${sh.marker}」`);
  return out.join("、") || "—";
};
const boards = SCENES.map((s) => {
  const head = `### ${s.id} ${s.title}（${time(s.at)}–${time(s.end)}）\n\n| 秒 | 画面 | 声 | 文字 |\n| --- | --- | --- | --- |\n`;
  const body = s.shots
    .map((sh) => {
      const say = LINES.filter((l) => l.at >= sh.at - 0.01 && l.at < sh.end - 0.01).map((l) => `${l.id} ${l.ja}`);
      const rec = [sh.footage, ...(sh.footages ?? [])].filter(Boolean);
      const screen = rec.length ? `${sh.label}（${[...new Set(rec)].join("・")}）` : sh.label;
      return `| ${time(sh.at)}–${time(sh.end)} | ${screen} | ${say.join(" ") || "（声なし、または前の文の続き）"} | ${words(sh)} |`;
    })
    .join("\n");
  return head + body + "\n";
}).join("\n");
plan = plan.replace(/### S1 [\s\S]*?(\n## 演出)/, `${boards}$1`);
writeFileSync(planPath, plan);
console.log("SCRIPT.md と PLAN.md を作り直した");
