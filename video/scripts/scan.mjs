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
import { ROOT, capture, ffmpeg } from "./lib.mjs";
import { LINES, SCENES } from "../src/timeline.ts";
import { chunks, speechSegments } from "../src/voice.ts";

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

// 声の区切り（話している所）。画面の言葉を声に合わせて出す（src/voice.ts の sayAt）。
// 黙っている所は -38 dB より小さい音が 0.09 秒以上続く所。区切りの数が文の「、」「。」の数と違う文は知らせる（その文は割合で出す）
const voice = {};
const ff = ffmpeg();
const unmatched = [];
for (const l of LINES) {
  const file = ["wav", "mp3", "m4a"].map((ext) => join(narration, `${l.id}.${ext}`)).find((p) => existsSync(p));
  if (!file) continue;
  const r = capture(ff.cmd, [...ff.pre, "-hide_banner", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.09", "-f", "null", "-"]);
  const log = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  if (!d) continue;
  const length = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const silences = [];
  let open = null;
  for (const m of log.matchAll(/silence_(start|end): (-?\d+(?:\.\d+)?)/g)) {
    if (m[1] === "start") open = Math.max(0, Number(m[2]));
    else if (open !== null) {
      silences.push([open, Number(m[2])]);
      open = null;
    }
  }
  if (open !== null) silences.push([open, length]);
  const segments = speechSegments(silences, length).map(([s, e]) => [Number(s.toFixed(3)), Number(e.toFixed(3))]);
  voice[l.id] = segments;
  if (segments.length !== chunks(l.ja).length) unmatched.push(`${l.id}（声 ${segments.length}・文 ${chunks(l.ja).length}）`);
}

writeFileSync(join(pub, "assets.json"), JSON.stringify({ footage, audio, marks, bg, voice }, null, 2) + "\n");

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
if (unmatched.length) console.log(`声の区切りが文の区切りと合わない文（言葉は文の中の割合で出す）: ${unmatched.join(" ")}`);
