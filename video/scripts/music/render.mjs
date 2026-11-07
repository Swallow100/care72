// BGM の案を 1 つ書き出す。node scripts/music/render.mjs <A|B|C|D|T>
//   → out/music/<id>.wav（48 kHz・24 bit・ステレオ・180.0 秒）、<id>.m4a（試聴用 AAC）、<id>.beats.json（拍の表）、
//     <id>.report.json（計測）、<id>.png（大きさと帯域の図）
// 大きさは -16 LUFS にそろえ（平らに上げ下げ）、真のピークを -2 dBTP で止める。ffmpeg の loudnorm は計るだけ（音は変えない）。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, ffmpeg } from "../lib.mjs";
import { LENGTH, SR, WINDOWS, dbToGain } from "./lib/core.mjs";
import { limit, loudness, truePeakDb } from "./lib/dsp.mjs";
import { masterChain } from "./lib/mixer.mjs";
import { analyze, ffM4a, ffMeasure, plot, writeWav24 } from "./lib/output.mjs";

const TARGET = -16;
const CEIL = -2.0;
const which = (process.argv[2] ?? "").toUpperCase();
const here = join(ROOT, "scripts", "music");
const file = readdirSync(here).find((f) => f.startsWith(`${which}-`) && f.endsWith(".mjs"));
if (!file) {
  console.error("使い方: node scripts/music/render.mjs <A|B|C|D|E|T>");
  process.exit(2);
}
const outDir = join(ROOT, "out", "music");
mkdirSync(outDir, { recursive: true });

// 台本の区切り（秒は動画の頭から）。曲の山はここに合わせる
const SPEC = [
  ["問いかけ", 0], ["理由", 16.7], ["気づき", 35.6], ["題名", 42.1], ["3 つ", 46.4], ["計画", 55.6], ["訓練", 81.9], ["着信", 99.5], ["着信の後", 105],
  ["発災時", 124.7], ["録音", 140.76], ["録音の後", 142.9], ["山田の行", 148.7], ["山田の行の後", 150.6], ["使い分け", 162.2],
  ["締め", 165.2], ["終わりの画面", 177.4], ["終わり", 180],
];

// 曲の区間の名前（どの案も同じ名前で区間を切る）
const LABEL = {
  intro1: "問いかけ", intro2: "課題", rise: "気づきの盛り上がり", title: "題名", pillars: "3 つ（計画・訓練・発災時）",
  plan: "道具: 計画", drill: "道具: 訓練", call: "着信（息をつく）", drill2: "訓練の続き", dis1: "発災時",
  emph2: "並び替え（息をつく）", dis2: "発災時（電話）", emph3: "録音（息をつく）", dis3a: "発災時（ルール・詳細）",
  dis3b: "声のない所へ（明るく）", receive: "受入（長調に戻る）", claude: "使い分け", numbers: "数字と声", closing: "締め", end: "ロゴ",
};

// 動画の音楽の音量（src/Video.tsx の musicVolume と同じ形。timeline.ts は読むだけ）
async function volumeFn() {
  try {
    const tl = await import(pathToFileURL(join(ROOT, "src", "timeline.ts")).href);
    return (s) => {
      for (const scene of tl.SCENES) for (const shot of scene.shots) if (shot.emphasis && s >= shot.at && s < shot.end) return 0.05;
      for (const line of tl.LINES) if (s >= line.at - 0.2 && s < line.end + 0.2) return 0.12;
      return 0.3;
    };
  } catch (e) {
    console.warn(`timeline.ts を読めなかった（図の音量は省く）: ${e.message}`);
    return null;
  }
}

const t0 = Date.now();
let tLap = t0;
const lap = (what) => {
  if (process.env.MUSIC_DEBUG) console.log(`  [${((Date.now() - tLap) / 1000).toFixed(1)} 秒] ${what}`);
  tLap = Date.now();
};
const mod = await import(pathToFileURL(join(here, file)).href);
const song = mod.compose();
const { id, title } = mod.meta;
const st = song.master;
if (st.n !== LENGTH) throw new Error(`長さが ${st.n}（${LENGTH} のはず）`);
console.log(`${id}: 作曲と合成 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);

lap("作曲と合成");
masterChain(st, song.masterOpts ?? {});
lap("仕上げ");
// 大きさをそろえる: 計る → 平らに → 制限 → もう一度
let gainDb = 0;
for (let pass = 0; pass < 4; pass++) {
  const I = loudness(st).I;
  const d = TARGET - I;
  if (Math.abs(d) < 0.05 && pass > 0) break;
  const g = dbToGain(d);
  for (let i = 0; i < st.n; i++) {
    st.L[i] *= g;
    st.R[i] *= g;
  }
  gainDb += d;
  const gr = limit(st, { ceilingDb: CEIL });
  if (limit.where?.length) console.log(`  制限した所: ${limit.where.slice(0, 12).map((w) => `${w.from}〜${w.to} 秒 ${w.db} dB`).join("、")}`);
  console.log(`  大きさ ${I.toFixed(2)} → ${TARGET}（${d >= 0 ? "+" : ""}${d.toFixed(2)} dB）、制限で最大 ${gr.toFixed(2)} dB`);
}
for (let i = 0; i < st.n; i++) {
  if (!Number.isFinite(st.L[i]) || !Number.isFinite(st.R[i])) throw new Error(`数でない値（${i / SR} 秒）`);
}
// 終わりの 0.1 秒は無音
for (let i = Math.round(179.9 * SR); i < st.n; i++) {
  if (st.L[i] !== 0 || st.R[i] !== 0) throw new Error("179.9 秒より後に音がある");
}

lap("大きさ");
const wav = join(outDir, `${id}.wav`);
const m4a = join(outDir, `${id}.m4a`);
writeWav24(wav, st);
const ff = ffmpeg().cmd;
const meas = ffMeasure(ff, wav);
ffM4a(ff, wav, m4a, `ケア72 BGM ${id}`);
const measM4a = process.env.MUSIC_M4A_MEASURE ? ffMeasure(ff, m4a) : { I: null, TP: null, LRA: null };
lap("WAV・ffmpeg");
console.log(`  ffmpeg: WAV ${meas.I} LUFS / ${meas.TP} dBTP / LRA ${meas.LRA}、m4a ${measM4a.I} LUFS / ${measM4a.TP} dBTP`);
if (Math.abs(meas.I - TARGET) > 0.5) throw new Error(`大きさが目標から外れた: ${meas.I}`);
if (meas.TP > -1.5) throw new Error(`真のピークが -1.5 dBTP を超えた: ${meas.TP}`);

// 拍の表
const tl = song.timeline;
const beats = tl.beatTimes().map((t) => +t.toFixed(4));
const downbeats = tl.downbeats().filter((t) => t >= 0 && t < 180).map((t) => +t.toFixed(4));
const anchors = SPEC.map(([name, spec]) => {
  const m = song.anchors?.[name];
  const near = beats.reduce((a, b) => (Math.abs(b - spec) < Math.abs(a - spec) ? b : a), beats[0]);
  const nearDown = downbeats.reduce((a, b) => (Math.abs(b - spec) < Math.abs(a - spec) ? b : a), downbeats[0]);
  return { name, spec, music: m ?? null, nearestBeat: near, nearestDownbeat: nearDown, diff: m !== undefined && m !== null ? +(m - spec).toFixed(3) : null };
});
const beatsJson = {
  id,
  title,
  bpm: +tl.bpm.toFixed(4),
  beatSec: +tl.beat.toFixed(5),
  beatsPerBar: song.beatsPerBar ?? 4,
  offsetSec: beats[0],
  note: "拍は一定の速さ。小節の長さはところどころ変わる（downbeats が曲の小節の頭）。hits は曲の山、holds は音楽が息をつく所（強調の窓）",
  beats,
  downbeats,
  sections: song.sections.map((s) => ({ name: s.name, label: LABEL[s.name] ?? s.name, at: +s.at.toFixed(3) })),
  hits: (song.hits ?? []).map((h) => ({ name: h.name, at: +h.at.toFixed(3) })),
  holds: (song.holds ?? []).map((h) => ({ name: h.name, from: +h.from.toFixed(3), to: +h.to.toFixed(3) })),
  anchors,
  sampleRate: SR,
  lengthSec: 180,
};
writeFileSync(join(outDir, `${id}.beats.json`), `${JSON.stringify(beatsJson, null, 1)}\n`);

// 計測と図
const vol = await volumeFn();
const an = analyze(st, { sections: song.sections, windows: WINDOWS });
lap("計測");
const report = {
  id,
  title,
  ffmpeg: { wav: meas, m4a: measM4a },
  own: { I: an.I, TP: an.TP, LRA: an.LRA },
  gainDb: +gainDb.toFixed(2),
  limited: limit.where ?? [],
  voiceBandShareDb: an.voiceBandShareDb,
  lowShareDb: an.lowShareDb,
  maxJump: an.maxJump,
  maxJumpAt: an.maxJumpAt,
  corr: an.corr,
  windowEdges: an.edges,
  clickCount: an.clickCount,
  clicks: an.clicks,
  sections: an.sections,
  parts: song.log,
  seconds: +((Date.now() - t0) / 1000).toFixed(1),
};
writeFileSync(join(outDir, `${id}.report.json`), `${JSON.stringify(report, null, 1)}\n`);
plot(join(outDir, `${id}.png`), st, an, {
  volume: vol,
  hits: (song.hits ?? []).map((h) => h.at),
  specMarks: SPEC.map(([, t]) => t),
});
console.log(
  `  ${id}: I ${an.I} / TP ${an.TP} / LRA ${an.LRA} / 1〜4 kHz ${an.voiceBandShareDb} dB / 低域 ${an.lowShareDb} dB / 跳び ${an.maxJump}（${an.maxJumpAt} 秒）/ 相関 ${an.corr} / クリック候補 ${an.clickCount}`,
);
console.log(`  窓の端の谷（窓の前との差）: ${an.edges.map((e) => `${e.window[0]} 秒 ${e.startDb} dB・${e.window[1]} 秒 ${e.endDb} dB`).join("、")}`);
console.log(`  区間: ${an.sections.map((s) => `${s.name} ${s.lufs}`).join("、")}`);
console.log(`  書いた: ${wav}（${existsSync(m4a) ? "m4a・" : ""}beats.json・report.json・png） ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
