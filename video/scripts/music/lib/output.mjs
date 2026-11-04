// 書き出し: 24 bit の WAV、ffmpeg で大きさを計る・m4a にする、計測の表、図（PNG）。
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { SR, Stereo, rng } from "./core.mjs";
import { Biquad, fft, loudness, truePeakDb } from "./dsp.mjs";

/** 24 bit の PCM（三角分布のディザ）で書く */
export function writeWav24(path, st) {
  const n = st.n;
  const data = Buffer.alloc(n * 6);
  const r = rng(424242);
  const scale = 8388607;
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (const ch of [st.L, st.R]) {
      const d = (r() - r()) / scale; // ±1 LSB の三角
      let v = Math.round((ch[i] + d) * scale);
      if (v > 8388607) v = 8388607;
      if (v < -8388608) v = -8388608;
      data[o++] = v & 255;
      data[o++] = (v >> 8) & 255;
      data[o++] = (v >> 16) & 255;
    }
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 6, 28);
  h.writeUInt16LE(6, 32);
  h.writeUInt16LE(24, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

/** ffmpeg の loudnorm で計る（音は変えない） */
export function ffMeasure(ff, file) {
  const r = spawnSync(ff, ["-hide_banner", "-i", file, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const json = text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const j = JSON.parse(json);
    return { I: Number(j.input_i), TP: Number(j.input_tp), LRA: Number(j.input_lra) };
  } catch {
    throw new Error(`loudnorm の結果が読めない: ${text.slice(-400)}`);
  }
}

/** 試聴用の m4a（AAC）。この ffmpeg には ipod の muxer が無いので -f mp4 */
export function ffM4a(ff, wav, m4a, title) {
  const enc = spawnSync(ff, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  const codec = /libfdk_aac/.test(enc) ? ["-c:a", "libfdk_aac", "-b:a", "256k"] : ["-c:a", "aac", "-b:a", "256k"];
  const r = spawnSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, ...codec, "-ar", "48000", "-metadata", `title=${title}`, "-f", "mp4", m4a], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`m4a にできない: ${r.stderr}`);
}

/**
 * 強調の窓の端（動画の音量が段で変わる瞬間）の谷: 端の ±0.03 秒の RMS と、窓の前（1.5〜0.5 秒前）の RMS の差（dB）。
 * 戻りは窓の終わりの直後に置くので、幅を広く取ると戻りの頭を拾う。段の瞬間だけを見る
 */
export function windowEdges(st, windows = []) {
  const rmsAt = (a, b) => {
    let e = 0;
    const i0 = Math.max(0, Math.round(a * SR)), i1 = Math.min(st.n, Math.round(b * SR));
    for (let i = i0; i < i1; i++) e += st.L[i] * st.L[i] + st.R[i] * st.R[i];
    return 10 * Math.log10(e / Math.max(1, 2 * (i1 - i0)) + 1e-20);
  };
  return windows.map(([a, b]) => {
    const ref = rmsAt(a - 1.5, a - 0.5);
    return { window: [a, b], startDb: +(rmsAt(a - 0.03, a + 0.03) - ref).toFixed(1), endDb: +(rmsAt(b - 0.03, b + 0.03) - ref).toFixed(1) };
  });
}

/** 計測: 区間ごとの大きさ、1〜4 kHz の割合、隣の標本との差の最大、左右の相関、クリックの候補 */
export function analyze(st, { sections = [], marks = [], windows = [] } = {}) {
  const ld = loudness(st);
  const tp = truePeakDb(st);
  // 1〜4 kHz の割合（全体は 40 Hz〜16 kHz）
  const band = (lo, hi) => {
    let e = 0;
    for (const ch of [st.L, st.R]) {
      const x = Float32Array.from(ch);
      for (const f of [new Biquad("hp", lo, 0.707), new Biquad("hp", lo, 0.707), new Biquad("lp", hi, 0.707), new Biquad("lp", hi, 0.707)]) f.run(x);
      for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    }
    return e;
  };
  const all = band(40, 16000);
  const voice = band(1000, 4000);
  const low = band(40, 300);
  // 隣の差と相関
  let maxJump = 0, jumpAt = 0, sl = 0, sr = 0, slr = 0;
  for (let i = 1; i < st.n; i++) {
    const j = Math.max(Math.abs(st.L[i] - st.L[i - 1]), Math.abs(st.R[i] - st.R[i - 1]));
    if (j > maxJump) {
      maxJump = j;
      jumpAt = i / SR;
    }
    sl += st.L[i] * st.L[i];
    sr += st.R[i] * st.R[i];
    slr += st.L[i] * st.R[i];
  }
  const corr = slr / Math.sqrt(sl * sr + 1e-30);
  // クリックの候補: 2 階差（高域）の大きさが、前後 20 ms の 2 階差の RMS の 12 倍を超える所
  const clicks = [];
  {
    const w = Math.round(0.02 * SR);
    const d2 = new Float32Array(st.n);
    for (let i = 2; i < st.n; i++) {
      const a = st.L[i] - 2 * st.L[i - 1] + st.L[i - 2];
      const b = st.R[i] - 2 * st.R[i - 1] + st.R[i - 2];
      d2[i] = Math.max(Math.abs(a), Math.abs(b));
    }
    let acc = 0;
    const sq = new Float64Array(st.n + 1);
    for (let i = 0; i < st.n; i++) sq[i + 1] = sq[i] + d2[i] * d2[i];
    for (let i = w; i < st.n - w; i += 1) {
      if (d2[i] < 0.002) continue;
      const rms = Math.sqrt((sq[i + w] - sq[i - w] - d2[i] * d2[i]) / (2 * w));
      // 途切れ（1〜2 標本だけの跳び）だけを数える。短い高い音（刻み・ハット）は 2 階差が何標本も続くので外れる
      const around = Math.max(d2[i - 4], d2[i - 3], d2[i + 3], d2[i + 4]);
      if (d2[i] > 12 * rms + 0.001 && d2[i] > 4 * around) {
        const t = i / SR;
        if (!clicks.length || t - clicks[clicks.length - 1].t > 0.05) clicks.push({ t: +t.toFixed(3), ratio: +(d2[i] / (rms + 1e-9)).toFixed(1) });
      }
      acc++;
    }
  }
  // 区間ごとの大きさ（瞬間の値の平均を 2 乗の平均で）
  const secLoud = sections.map((s, k) => {
    const end = sections[k + 1]?.at ?? 180;
    const a = Math.floor(s.at / ld.hopSec), b = Math.floor(end / ld.hopSec);
    let e = 0, c = 0;
    for (let h = Math.max(a + 4, 4); h < b; h++) {
      e += 10 ** (ld.momentary[h] / 10);
      c++;
    }
    return { name: s.name, at: s.at, lufs: c ? +(10 * Math.log10(e / c)).toFixed(1) : null };
  });
  const edges = windowEdges(st, windows);
  return {
    edges,
    I: +ld.I.toFixed(2),
    LRA: +ld.LRA.toFixed(1),
    TP: +tp.toFixed(2),
    voiceBandShareDb: +(10 * Math.log10(voice / all)).toFixed(1),
    lowShareDb: +(10 * Math.log10(low / all)).toFixed(1),
    maxJump: +maxJump.toFixed(4),
    maxJumpAt: +jumpAt.toFixed(3),
    corr: +corr.toFixed(3),
    clicks: clicks.slice(0, 20),
    clickCount: clicks.length,
    sections: secLoud,
    ld,
    marks,
  };
}

// ---------- 図（PNG） ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/**
 * 図: 上は大きさ（灰 = 瞬間、紺 = 短時間、緑 = 動画の中で聞こえる大きさ = 短時間 + 音楽の音量）、
 * 下は帯域（30 Hz〜16 kHz、1/6 オクターブ、上ほど高い）。横は 1 秒 10 px。
 * 区切りの印: 青の縦線 = 台本の区切り、赤の帯 = 強調（0.05）、黄の帯 = 声のない所（0.3）、橙の縦線 = 曲の山
 */
export function plot(path, st, an, { volume, hits = [], specMarks = [], emph = [] } = {}) {
  const W = 1800, H1 = 300, H2 = 216, PAD = 8, H = PAD + H1 + PAD + H2 + PAD;
  const img = Buffer.alloc(W * H * 3, 255);
  const px = (x, y, c) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const o = (y * W + x) * 3;
    img[o] = c[0];
    img[o + 1] = c[1];
    img[o + 2] = c[2];
  };
  const xOf = (t) => Math.round((t / 180) * (W - 1));
  const yOf = (lufs) => PAD + Math.round(((-5 - Math.max(-65, Math.min(-5, lufs))) / 60) * (H1 - 1));
  // 地: 音量 0.3（黄）と 0.05（赤）
  if (volume) {
    for (let x = 0; x < W; x++) {
      const v = volume((x / (W - 1)) * 180);
      const c = v >= 0.29 ? [255, 244, 200] : v <= 0.06 ? [255, 214, 214] : [246, 246, 246];
      for (let y = PAD; y < PAD + H1; y++) px(x, y, c);
    }
  }
  // 目盛り: 10 dB ごと、10 秒ごと
  for (let l = -60; l <= -10; l += 10) for (let x = 0; x < W; x += 2) px(x, yOf(l), [205, 205, 205]);
  for (let t = 0; t <= 180; t += 10) for (let y = PAD; y < PAD + H1; y += t % 30 === 0 ? 1 : 3) px(xOf(t), y, [190, 190, 190]);
  for (const t of specMarks) for (let y = PAD; y < PAD + H1; y++) px(xOf(t), y, [60, 110, 220]);
  for (const t of hits) for (let y = PAD; y < PAD + H1; y += 2) px(xOf(t), y, [235, 130, 20]);
  const line = (arr, c, thick) => {
    let prev = null;
    for (let x = 0; x < W; x++) {
      const t = (x / (W - 1)) * 180;
      const h = Math.min(arr.length - 1, Math.floor(t / an.ld.hopSec));
      const y = yOf(arr[h]);
      if (prev !== null) {
        const [a, b] = prev < y ? [prev, y] : [y, prev];
        for (let yy = a; yy <= b; yy++) for (let k = 0; k < thick; k++) px(x, yy + k, c);
      }
      prev = y;
    }
  };
  line(an.ld.momentary, [170, 170, 170], 1);
  line(an.ld.shortTerm, [20, 40, 110], 2);
  if (volume) {
    const eff = an.ld.shortTerm.map((v, h) => v + 20 * Math.log10(volume(h * an.ld.hopSec)) + 14);
    line(eff, [30, 150, 60], 1);
  }
  // 帯域
  const N = 8192, hop = SR / 10, cols = Math.floor(st.n / hop);
  const bands = 54;
  const edges = [];
  for (let b = 0; b <= bands; b++) edges.push(30 * 2 ** (b / 6));
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const y0 = PAD + H1 + PAD;
  for (let c = 0; c < cols; c++) {
    const s0 = c * hop - N / 2;
    for (let i = 0; i < N; i++) {
      const k = s0 + i;
      re[i] = k >= 0 && k < st.n ? ((st.L[k] + st.R[k]) / 2) * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bands; b++) {
      const k0 = Math.max(1, Math.floor((edges[b] / SR) * N)), k1 = Math.max(k0 + 1, Math.floor((edges[b + 1] / SR) * N));
      let e = 0;
      for (let k = k0; k < k1; k++) e += re[k] * re[k] + im[k] * im[k];
      const d = 10 * Math.log10(e + 1e-20);
      const v = Math.max(0, Math.min(1, (d + 10) / 70)); // おおよそ -10〜60
      const col = [Math.round(255 - 235 * v), Math.round(255 - 205 * v), Math.round(255 - 120 * v)];
      const yy0 = y0 + H2 - Math.round(((b + 1) * H2) / bands), yy1 = y0 + H2 - Math.round((b * H2) / bands);
      const x0 = xOf(c / 10), x1 = xOf((c + 1) / 10);
      for (let y = yy0; y < yy1; y++) for (let x = x0; x < Math.max(x0 + 1, x1); x++) px(x, y, col);
    }
  }
  // 1 kHz と 4 kHz の線
  for (const f of [1000, 4000]) {
    const b = 6 * Math.log2(f / 30);
    const y = y0 + H2 - Math.round((b * H2) / bands);
    for (let x = 0; x < W; x += 3) px(x, y, [220, 60, 60]);
  }
  for (const t of specMarks) for (let y = y0; y < y0 + H2; y += 4) px(xOf(t), y, [60, 110, 220]);
  writePng(path, W, H, img);
}

export { Stereo };
