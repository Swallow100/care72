// 録画に入らなかったアプリの音（訓練の着信の声など）を、録画の秒にそろえた WAV にして public/audio/app/<番号>.wav に置く。
// Video.tsx の AppAudio が、その録画の絵（速さ 1 の footage）で from 秒から鳴らす。
// node scripts/app-audio.mjs
//
// 声のファイルは撮る道具（record.mjs の訓練の場面）が録画の連番と同じフォルダに残す（Gemini の読み上げ。assets は commit しない）。
// 下の表の at は「録画の頭から何秒で鳴り始めるか」、length は「声のファイルの頭から何秒まで使うか」（文の切れ目の間で切る）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const CLIPS = [
  // 強調の着信（小林 トシの夫、11/5 昼の大雨想定 R08-5）。3.0 秒に「出る」を押す。声は 8.3 秒で 3 つの文
  // （訪問看護の方が来てくれました。／停電して、呼吸器は電池に切り替わりました。／電池は残り50分ほどです。）。絵は 5 秒なので、
  // 真ん中の文（声の 2.8〜5.75 秒）を 3.2 秒から置く。ほかの 2 つの文は通話の窓の字で読める
  { id: "R08", take: "R08-5", file: "voice.wav", at: 3.2, skip: 2.8, length: 2.95, fade: 0.12 },
];

/** 16bit の PCM の WAV を読む（fmt と data の塊だけ見る） */
function readWav(path) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error(`WAV でない: ${path}`);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { format: b.readUInt16LE(off + 8), channels: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === "data") data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`fmt か data が無い: ${path}`);
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`16bit の PCM だけ読める: ${path}（format ${fmt.format}、${fmt.bits}bit）`);
  return { ...fmt, data };
}

function writeWav(path, { channels, rate }, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

const out = join(ROOT, "public", "audio", "app");
mkdirSync(out, { recursive: true });
for (const c of CLIPS) {
  const src = join(ROOT, "assets", "rec", c.take, c.file);
  if (!existsSync(src)) {
    console.log(`${c.id}: ${src} が無い（飛ばす）`);
    continue;
  }
  const w = readWav(src);
  const frames = w.data.length / 2 / w.channels;
  // skip は声の頭から飛ばす秒（文の途中の 1 つだけを使うとき）。頭と終わりは fade で短く薄くする（切った所で音が跳ねないように）
  const skip = Math.round((c.skip ?? 0) * w.rate);
  const use = Math.max(0, Math.min(frames - skip, Math.round(c.length * w.rate)));
  const fade = Math.round((c.fade ?? 0) * w.rate);
  const lead = Math.round(c.at * w.rate);
  const samples = new Array((lead + use) * w.channels).fill(0);
  for (let i = 0; i < use; i++) {
    const tail = fade > 0 && i > use - fade ? (use - i) / fade : 1;
    const head = fade > 0 && skip > 0 && i < fade ? i / fade : 1;
    const g = Math.min(tail, head);
    for (let ch = 0; ch < w.channels; ch++) samples[(lead + i) * w.channels + ch] = w.data.readInt16LE(((skip + i) * w.channels + ch) * 2) * g;
  }
  writeWav(join(out, `${c.id}.wav`), w, samples);
  console.log(`${c.id}: ${c.take}/${c.file} の ${c.skip ?? 0} 秒から ${c.length} 秒を、録画の ${c.at} 秒に置いた → public/audio/app/${c.id}.wav`);
}
console.log("次: node scripts/scan.mjs（public/assets.json の音の一覧に入れる）");
