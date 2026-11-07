// 合成の共通の部品: 標本化の速さ、ステレオの入れ物、乱数、音名、拍の表（Timeline）。
// 外の音源は使わない。全部この期間に書いたコードで音を作る。

export const SR = 48000;
export const SECONDS = 180;
export const LENGTH = SR * SECONDS; // 8,640,000 frames

/** ステレオの入れ物（Float32） */
export class Stereo {
  constructor(n = LENGTH) {
    this.n = n;
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
}

/** 決まった種から同じ並びを出す乱数（mulberry32）。0〜1 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C4"・"Eb3"・"F#2" → MIDI の番号（C4 = 60）。数ならそのまま */
export function midi(name) {
  if (typeof name === "number") return name;
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`音名が読めない: ${name}`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
/** "C3 G3 Eb4" → [48, 55, 63] */
export const notes = (s) => (Array.isArray(s) ? s.map(midi) : s.trim().split(/\s+/).map(midi));
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
export const dbToGain = (d) => 10 ** (d / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smp = (t) => Math.round(t * SR);

/**
 * 強調の窓（src/timeline.ts の emphasis の絵。動画は音楽を 0.05 に下げる）。
 * 動画の音量は窓の端で段になって変わるので、窓の頭と終わりでは音楽を谷にする（持続音の上で段が鳴らないように）
 */
export const WINDOWS = [
  // 11/8 の台本（案 E）。前の台本の窓は [88, 93]・[116, 121]・[126, 130]（案 A〜D はその秒で作った）
  [99.5, 105],
  [140.76, 142.9],
  [148.7, 150.6],
];
/** 窓 w の中で音を置いてよい範囲: 窓の頭の後の最初の拍から、窓の終わりの 0.35 秒前まで */
export function holdSpan(tl, w) {
  const [a, b] = w;
  const k = Math.ceil((a + 0.05 - tl.anchor) / tl.beat);
  return { from: tl.t(k), to: b - 0.35 };
}
/** 秒 t を含む窓（無ければ null） */
export const windowAt = (t0, t1) => WINDOWS.find(([a, b]) => t0 < b && t1 > a) ?? null;

/**
 * 和音の並び S（t0・t1・hold か breath の印）に窓の印を付ける: 窓の和音には win・span、窓の前の和音には preHold と cut
 * （刻みを止める秒。窓の頭の 0.3 秒前か、和音の終わりの早い方）。ほかの和音の cut は t1
 */
export function markWindows(tl, S, isHold) {
  for (const s of S) s.cut = s.t1;
  for (const [k, s] of S.entries()) {
    const w = isHold(s) ? windowAt(s.t0, s.t1) : null;
    if (!w) continue;
    s.win = w;
    s.span = holdSpan(tl, w);
    if (k > 0) {
      const p = S[k - 1];
      p.preHold = true;
      p.cut = Math.min(p.t1, w[0] - 0.3);
    }
  }
}

/** 定パワーの定位。-1（左）〜 1（右） */
export function panGains(pan) {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * 拍の表。速さは一定（bpm）で、小節の長さは小節ごとに決められる（4 拍・3 拍・2 拍など）。
 * form は [名前, [小節の拍数...]] の並び。anchorSection の頭が anchor 秒（題名 32.6）。
 * 拍の番号は anchor を 0 にした数（前は負）。
 */
export class Timeline {
  constructor({ bpm, anchor = 32.6, anchorSection, form }) {
    this.bpm = bpm;
    this.beat = 60 / bpm;
    this.anchor = anchor;
    this.bars = [];
    this.sections = new Map();
    let total = 0;
    const starts = [];
    for (const [name, bars] of form) {
      starts.push({ name, at: total, bars });
      total += bars.reduce((a, b) => a + b, 0);
    }
    const a = starts.find((s) => s.name === anchorSection);
    if (!a) throw new Error(`anchorSection が無い: ${anchorSection}`);
    const shift = -a.at;
    for (const s of starts) {
      const first = this.bars.length;
      let b = s.at + shift;
      for (const n of s.bars) {
        this.bars.push({ beat: b, beats: n, section: s.name });
        b += n;
      }
      this.sections.set(s.name, { name: s.name, bar: first, bars: s.bars.length, beat: s.at + shift, beats: s.bars.reduce((x, y) => x + y, 0) });
    }
    this.endBeat = total + shift;
  }
  /** 拍の番号 → 秒 */
  t(beat) {
    return this.anchor + beat * this.beat;
  }
  /** 区間 name の頭からの拍 → 秒 */
  at(name, beat = 0) {
    return this.t(this.sec(name).beat + beat);
  }
  sec(name) {
    const s = this.sections.get(name);
    if (!s) throw new Error(`区間が無い: ${name}`);
    return s;
  }
  /** 区間の小節の頭の拍（区間の頭からの拍）の並び */
  barBeats(name) {
    const s = this.sec(name);
    return this.bars.slice(s.bar, s.bar + s.bars).map((b) => b.beat - s.beat);
  }
  downbeats() {
    return this.bars.map((b) => this.t(b.beat));
  }
  /** 0 秒以上 180 秒未満の拍の秒 */
  beatTimes(from = this.bars[0].beat, to = this.endBeat) {
    const out = [];
    for (let b = Math.ceil(from); b < to; b++) {
      const t = this.t(b);
      if (t >= 0 && t < 180) out.push(t);
    }
    return out;
  }
}
