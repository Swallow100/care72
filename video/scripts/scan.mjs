// 素材の置き場（video/assets）から Remotion の読み場（video/public）へ写し、public の下の素材を数えて public/assets.json に書く。
// 編集の枠（src/assets.ts）はこれを読み、無い素材は仮の面（撮影待ち）で描く。
// node scripts/scan.mjs
//
// 置き場（docs/video/MATERIALS.md の「置き場所」。どれも commit しない）:
//   assets/rec/R10-1/00001.jpg …   録画の連番（番号-何回目）。同じ番号が 2 回以上あれば一番大きい回を使う
//   assets/voice/N01.wav …         作者の声（あればこちらを使う）
//   assets/voice-tts/N01.wav …     仮の声（scripts/tts-placeholder.ps1 が作る）
// 写し先:
//   public/footage/R10/00001.jpg … 録画（同じドライブなら hard link で、場所を食わない）
//   public/audio/narration/N01.wav …
// 録画の古い回を使うときは、新しい回のフォルダの名前を変えるか消す。
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROOT } from "./lib.mjs";
import { LINES, SCENES } from "../src/timeline.ts";

const pub = join(ROOT, "public");
const store = join(ROOT, "assets");
const FRAME = /^\d{5}\.jpg$/;

function place(src, dst) {
  try {
    linkSync(src, dst);
  } catch {
    copyFileSync(src, dst);
  }
}

// 録画: assets/rec/<番号>-<回> → public/footage/<番号>。markers.json の押した所（taps）は assets.json の marks へ
const synced = {};
const marks = {};
const recDir = join(store, "rec");
if (existsSync(recDir)) {
  const takes = {};
  for (const name of readdirSync(recDir)) {
    const m = /^(R\d{2})-(\d+)$/.exec(name);
    if (!m || !statSync(join(recDir, name)).isDirectory()) continue;
    const take = Number(m[2]);
    if (!takes[m[1]] || take > takes[m[1]].take) takes[m[1]] = { take, dir: join(recDir, name), name };
  }
  for (const [id, t] of Object.entries(takes)) {
    const frames = readdirSync(t.dir).filter((f) => FRAME.test(f)).sort();
    if (frames.length === 0) continue;
    const out = join(pub, "footage", id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const f of frames) place(join(t.dir, f), join(out, f));
    synced[id] = t.name;
    const mj = join(t.dir, "markers.json");
    if (existsSync(mj)) {
      const taps = JSON.parse(readFileSync(mj, "utf8")).taps;
      if (Array.isArray(taps) && taps.length) marks[id] = { taps };
    }
  }
}

// 声: assets/voice（作者）→ なければ assets/voice-tts（仮）→ public/audio/narration
const narration = join(pub, "audio", "narration");
const voiceFrom = {};
for (const l of LINES) {
  for (const [kind, dir] of [
    ["作者", join(store, "voice")],
    ["仮", join(store, "voice-tts")],
  ]) {
    const src = ["wav", "mp3", "m4a"].map((ext) => join(dir, `${l.id}.${ext}`)).find((p) => existsSync(p));
    if (!src) continue;
    mkdirSync(narration, { recursive: true });
    for (const ext of ["wav", "mp3", "m4a"]) rmSync(join(narration, `${l.id}.${ext}`), { force: true });
    copyFileSync(src, join(narration, `${l.id}.${src.split(".").pop()}`));
    voiceFrom[l.id] = kind;
    break;
  }
}

// 数える
const footage = {};
const footageDir = join(pub, "footage");
if (existsSync(footageDir)) {
  for (const id of readdirSync(footageDir)) {
    const dir = join(footageDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const n = readdirSync(dir).filter((f) => FRAME.test(f)).length;
    if (n > 0) footage[id] = n;
  }
}

const audio = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(wav|mp3|m4a)$/i.test(name)) audio.push(relative(pub, p).split(sep).join("/"));
  }
}
walk(join(pub, "audio"));

mkdirSync(pub, { recursive: true });
// 背景の生成動画の連番（scripts/bg.mjs が public/bg/<番号>/ に作る）
const bg = {};
const bgDir = join(pub, "bg");
if (existsSync(bgDir)) {
  for (const id of readdirSync(bgDir)) {
    const dir = join(bgDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const n = readdirSync(dir).filter((f) => FRAME.test(f)).length;
    if (n > 0) bg[id] = n;
  }
}

writeFileSync(join(pub, "assets.json"), JSON.stringify({ footage, audio, marks, bg }, null, 2) + "\n");

// 足りない録画と声を出す
const wanted = new Set();
for (const s of SCENES) for (const sh of s.shots) for (const id of [sh.footage, ...(sh.footages ?? [])]) if (id) wanted.add(id);
const missing = [...wanted].filter((id) => !footage[id]).sort();
const used = Object.entries(synced).map(([id, name]) => `${id}←${name}`);
console.log(`録画 ${Object.keys(footage).length} 本（${Object.entries(footage).map(([id, n]) => `${id} ${(n / 30).toFixed(1)} 秒`).join("、") || "なし"}）`);
if (used.length) console.log(`assets/rec から写した回: ${used.join(" ")}`);
if (Object.keys(bg).length) console.log(`背景 ${Object.keys(bg).sort().join(" ")}`);
console.log(missing.length ? `撮影待ちの録画: ${missing.join(" ")}` : "録画は全部ある");
const own = Object.values(voiceFrom).filter((k) => k === "作者").length;
const tts = Object.values(voiceFrom).filter((k) => k === "仮").length;
const none = LINES.filter((l) => !voiceFrom[l.id]).map((l) => l.id);
console.log(`声: 作者 ${own} 文、仮 ${tts} 文、なし ${none.length} 文${none.length ? `（${none.join(" ")}）` : ""}`);
console.log(`音 ${audio.length} 本を public/assets.json に書いた`);
