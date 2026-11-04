// 台本の食い違いと時間割を確かめる。
// node scripts/check.mjs
// - src/timeline.ts の場面が 0 秒から 180 秒まで隙間なく続き、場面の中の絵も隙間なく続くか
// - 文（N01〜）の日本語が docs/video/PLAN.md・SCRIPT.md・timeline.ts で同じか。英語と秒が SCRIPT.md と timeline.ts で同じか
// - 1 秒あたりの字数の目安（数字は読みが長いので 2 字、英字は 0.6 字に数える）。6 を超えたら知らせる（止めはしない）
// - ［ ］の埋める所の一覧
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
import { LINES, SCENES, TOTAL_SECONDS } from "../src/timeline.ts";
import { plain, sayAt } from "../src/voice.ts";

const errors = [];
const warns = [];
const close = (a, b) => Math.abs(a - b) < 0.001;

// 場面と絵
let t = 0;
for (const s of SCENES) {
  if (!close(s.at, t)) errors.push(`${s.id}: 始まり ${s.at} が前の終わり ${t} と合わない`);
  let u = s.at;
  for (const sh of s.shots) {
    if (!close(sh.at, u)) errors.push(`${s.id}: 絵「${sh.label}」の始まり ${sh.at} が前の終わり ${u} と合わない`);
    if (!(sh.end > sh.at)) errors.push(`${s.id}: 絵「${sh.label}」の長さが 0 以下`);
    u = sh.end;
  }
  if (!close(u, s.end)) errors.push(`${s.id}: 最後の絵の終わり ${u} が場面の終わり ${s.end} と合わない`);
  t = s.end;
}
if (!close(t, TOTAL_SECONDS)) errors.push(`最後の場面の終わり ${t} が ${TOTAL_SECONDS} 秒でない`);

// 文の秒
let prev = 0;
for (const l of LINES) {
  if (!(l.end > l.at)) errors.push(`${l.id}: 終わりが始まりより前`);
  if (l.at < prev - 0.001) errors.push(`${l.id}: 前の文と重なる`);
  if (l.end > TOTAL_SECONDS) errors.push(`${l.id}: ${TOTAL_SECONDS} 秒を超える`);
  prev = l.end;
}

// 声に合わせて出す言葉（cues）: 言葉が文の中にあるか、出る時刻が絵の中か（声の区切りは public/assets.json にあれば使う）
const assetsFile = join(ROOT, "public", "assets.json");
const voice = existsSync(assetsFile) ? (JSON.parse(readFileSync(assetsFile, "utf8")).voice ?? {}) : {};
const lineById = new Map(LINES.map((l) => [l.id, l]));
for (const s of SCENES) {
  for (const sh of s.shots) {
    for (const c of sh.cues ?? []) {
      const l = lineById.get(c.line);
      if (!l) {
        errors.push(`${s.id}: 言葉「${c.text}」の文 ${c.line} が無い`);
        continue;
      }
      const say = c.say ?? c.text;
      if (!plain(l.ja).includes(plain(say))) {
        errors.push(`${s.id}: 言葉「${say}」が ${c.line} の文に無い（文を直したら cues の text か say も直す）\n  文: ${l.ja}`);
        continue;
      }
      const at = sayAt(l, voice[c.line], say) + (c.shift ?? 0);
      if (at < sh.at - 0.5 || at > sh.end - 0.3) warns.push(`${s.id}: 言葉「${c.text}」が ${at.toFixed(2)} 秒に出る（絵は ${sh.at}〜${sh.end} 秒）`);
    }
  }
}

// 白い帯の言葉（marker）は、その絵に出る言葉（cues の text か lines）と同じ字か
for (const s of SCENES) {
  for (const sh of s.shots) {
    if (!sh.marker) continue;
    const shown = [...(sh.cues ?? []).filter((c) => c.slot !== "mark" && c.slot !== "lead").map((c) => c.text), ...(sh.lines ?? [])];
    if (!shown.includes(sh.marker)) errors.push(`${s.id}: 白い帯の言葉「${sh.marker}」が絵「${sh.label}」に出る言葉に無い`);
  }
}

// 文書を読む
const docs = join(ROOT, "..", "docs", "video");
const plan = readFileSync(join(docs, "PLAN.md"), "utf8");
const script = readFileSync(join(docs, "SCRIPT.md"), "utf8");
const byId = new Map(LINES.map((l) => [l.id, l]));

const toSec = (s) => {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// SCRIPT.md の台本の表: | N01 | 0:00.5–0:06.5 | 日本語 | 英語 |
const inScript = new Set();
for (const row of script.split(/\r?\n/)) {
  if (!row.startsWith("| N")) continue;
  const cells = row.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length !== 4 || !/^N\d{2}$/.test(cells[0])) continue;
  const [id, time, ja, en] = cells;
  inScript.add(id);
  const l = byId.get(id);
  if (!l) {
    errors.push(`SCRIPT.md の ${id} が timeline.ts に無い`);
    continue;
  }
  if (ja !== l.ja) errors.push(`${id} の日本語が SCRIPT.md と timeline.ts で違う\n  SCRIPT:   ${ja}\n  timeline: ${l.ja}`);
  if (en !== l.en) errors.push(`${id} の英語が SCRIPT.md と timeline.ts で違う\n  SCRIPT:   ${en}\n  timeline: ${l.en}`);
  const [a, b] = time.split("–");
  if (!close(toSec(a ?? ""), l.at) || !close(toSec(b ?? ""), l.end)) errors.push(`${id} の秒が SCRIPT.md（${time}）と timeline.ts（${l.at}–${l.end}）で違う`);
}

// PLAN.md の表の中の「N01 文」
const inPlan = new Set();
for (const row of plan.split(/\r?\n/)) {
  if (!row.startsWith("|")) continue;
  for (const cell of row.split("|").map((c) => c.trim())) {
    const m = /^(N\d{2}) (.+)$/.exec(cell);
    if (!m) continue;
    inPlan.add(m[1]);
    const l = byId.get(m[1]);
    if (!l) errors.push(`PLAN.md の ${m[1]} が timeline.ts に無い`);
    else if (m[2] !== l.ja) errors.push(`${m[1]} の日本語が PLAN.md と timeline.ts で違う\n  PLAN:     ${m[2]}\n  timeline: ${l.ja}`);
  }
}
for (const l of LINES) {
  if (!inScript.has(l.id)) errors.push(`${l.id} が SCRIPT.md の台本の表に無い`);
  if (!inPlan.has(l.id)) errors.push(`${l.id} が PLAN.md の絵コンテに無い`);
}

// 声の速さの目安
const weight = (s) => {
  let n = 0;
  for (const ch of s) {
    if (/[\s、。，．・「」（）［］()…,.!?:;]/.test(ch)) continue;
    if (/[0-9]/.test(ch)) n += 2;
    else if (/[A-Za-z]/.test(ch)) n += 0.6;
    else if (ch === "%") n += 4;
    else n += 1;
  }
  return n;
};
let total = 0;
for (const l of LINES) {
  const w = weight(l.ja);
  total += w;
  const rate = w / (l.end - l.at);
  if (rate > 6) warns.push(`${l.id}: 1 秒に ${rate.toFixed(1)} 字（${w.toFixed(0)} 字 / ${(l.end - l.at).toFixed(1)} 秒）。読んで秒に入るか測る`);
}

const blanks = LINES.filter((l) => l.ja.includes("［")).map((l) => l.id);

console.log(`場面 ${SCENES.length}、文 ${LINES.length}、声の字数の目安 ${total.toFixed(0)} 字 / ${TOTAL_SECONDS} 秒`);
if (blanks.length) console.log(`埋める所のある文: ${blanks.join(" ")}`);
for (const w of warns) console.log(`目安: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`誤り: ${e}`);
  process.exit(1);
}
console.log("食い違いなし");
