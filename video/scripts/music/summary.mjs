// 書き出した案の計測と拍の表を Markdown の表にする。node scripts/music/summary.mjs [A B C D]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib.mjs";

const ids = { A: "A-piano", B: "B-pulse", C: "C-ambient", D: "D-phase" };
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ids);
const dir = join(ROOT, "out", "music");
const f = (x, d = 2) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));

console.log("| 案 | BPM | 拍子 | I（LUFS） | 真のピーク | LRA | 1〜4 kHz の割合 | 窓の端の谷（88・93 / 116・121 / 126・130 秒） | クリック候補 |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const rows = [];
for (const k of want) {
  const id = ids[k];
  const b = join(dir, `${id}.beats.json`), r = join(dir, `${id}.report.json`);
  if (!existsSync(b) || !existsSync(r)) continue;
  const beats = JSON.parse(readFileSync(b, "utf8"));
  const rep = JSON.parse(readFileSync(r, "utf8"));
  rows.push({ id, beats, rep });
  const edges = (rep.windowEdges ?? []).map((e) => `${f(e.startDb, 0)}・${f(e.endDb, 0)}`).join(" / ");
  console.log(`| ${id} | ${f(beats.bpm, 2)} | ${beats.beatsPerBar} | ${f(rep.ffmpeg.wav.I)} | ${f(rep.ffmpeg.wav.TP)} dBTP | ${f(rep.ffmpeg.wav.LRA, 1)} | ${f(rep.voiceBandShareDb, 1)} dB | ${edges} dB | ${rep.clickCount} |`);
}
for (const { id, beats } of rows) {
  console.log(`\n### ${id} の山と区切り\n`);
  console.log(`- 山: ${beats.hits.map((h) => `${h.name} ${h.at.toFixed(2)}`).join("、")}`);
  console.log(`- 息をつく所: ${beats.holds.map((h) => `${h.name} ${h.from.toFixed(2)}〜${h.to.toFixed(2)}`).join("、")}`);
  console.log(`- 区間: ${beats.sections.map((s) => `${s.label} ${s.at.toFixed(2)}`).join("、")}`);
  console.log(`- 台本の区切りとのずれ（曲の区切り − 台本、秒）: ${beats.anchors.filter((a) => a.diff !== null).map((a) => `${a.name} ${a.diff >= 0 ? "+" : ""}${a.diff.toFixed(2)}`).join("、")}`);
}
