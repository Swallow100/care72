// 音の加工: フィルター、発振の表、遅れ、残響（FDN）、往復の遅れ、コーラス、大きさの曲線、
// 先読みの制限（真のピーク）、大きさの計り（BS.1770 の LUFS）、FFT。
import { LENGTH, SR, Stereo, clamp, dbToGain, rng } from "./core.mjs";

// ---------- 発振 ----------
const TBL = 8192;
const SIN = new Float64Array(TBL + 1);
for (let i = 0; i <= TBL; i++) SIN[i] = Math.sin((2 * Math.PI * i) / TBL);
/** phase は周（0〜1）。表を線形に補う正弦 */
export function sinp(phase) {
  const x = (phase - Math.floor(phase)) * TBL;
  const i = x | 0;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * (x - i);
}
/** polyBLEP（鋸歯の折り返しを抑える） */
export function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// ---------- フィルター ----------
/** これより小さい値は 0 にする（非正規化数で遅くならないように。-600 dB なので音には影響しない） */
const TINY = 1e-30;
/** RBJ の biquad。type: lp hp bp peak lowshelf highshelf。shelf の q は傾き（1 が標準） */
export class Biquad {
  constructor(type, f, q = Math.SQRT1_2, gainDb = 0) {
    this.z1 = 0;
    this.z2 = 0;
    this.set(type, f, q, gainDb);
  }
  set(type, f, q = Math.SQRT1_2, gainDb = 0) {
    const w = (2 * Math.PI * clamp(f, 5, SR * 0.49)) / SR;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const A = 10 ** (gainDb / 40);
    let alpha = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === "lowshelf" || type === "highshelf") alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
    switch (type) {
      case "lp":
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case "hp":
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case "bp":
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case "peak":
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case "highshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
      default:
        throw new Error(`知らないフィルター: ${type}`);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(v) {
    const y = this.b0 * v + this.z1;
    this.z1 = this.b1 * v - this.a1 * y + this.z2;
    this.z2 = this.b2 * v - this.a2 * y;
    if (this.z1 < TINY && this.z1 > -TINY) this.z1 = 0;
    if (this.z2 < TINY && this.z2 > -TINY) this.z2 = 0;
    return y;
  }
  /** その場で（TDF-II） */
  run(x, from = 0, to = x.length) {
    let z1 = this.z1, z2 = this.z2;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = from; i < to; i++) {
      const v = x[i];
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      // 無音が続くと状態が非正規化数になり、計算が数十倍遅くなる。小さすぎる値は 0 にする
      if (z1 < TINY && z1 > -TINY) z1 = 0;
      if (z2 < TINY && z2 > -TINY) z2 = 0;
      x[i] = y;
    }
    this.z1 = z1; this.z2 = z2;
  }
}

/** EQ の並びをステレオにその場でかける。eq: [[type, f, q, gain], ...] */
export function eqStereo(st, eq, from = 0, to = st.n) {
  for (const [type, f, q, g] of eq) {
    new Biquad(type, f, q, g).run(st.L, from, to);
    new Biquad(type, f, q, g).run(st.R, from, to);
  }
}

/** Cytomic の SVF（切れ目を標本ごとに変えられる） */
export class SVF {
  constructor(f = 1000, q = Math.SQRT1_2) {
    this.ic1 = 0;
    this.ic2 = 0;
    this.set(f, q);
  }
  set(f, q = this.q ?? Math.SQRT1_2) {
    this.q = q;
    const g = Math.tan((Math.PI * clamp(f, 10, SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  /** 低域・帯域・高域を同時に出す。戻りは低域。this.band・this.high も更新 */
  tick(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (this.ic1 < TINY && this.ic1 > -TINY) this.ic1 = 0;
    if (this.ic2 < TINY && this.ic2 > -TINY) this.ic2 = 0;
    this.band = v1;
    this.high = v0 - this.k * v1 - v2;
    return v2;
  }
}

/** 1 極の低域（係数は切れ目から） */
export const onePoleCoef = (f) => Math.exp((-2 * Math.PI * f) / SR);

// ---------- 遅れ ----------
/** 2 の冪の長さの輪。読みは線形補間 */
class Ring {
  constructor(minLen) {
    let n = 1;
    while (n < minLen + 4) n <<= 1;
    this.buf = new Float64Array(n);
    this.mask = n - 1;
    this.w = 0;
  }
  push(v) {
    this.buf[this.w] = v < TINY && v > -TINY ? 0 : v;
    this.w = (this.w + 1) & this.mask;
  }
  /** d 標本前（1 以上、小数可） */
  read(d) {
    const p = this.w - d;
    const i = Math.floor(p);
    const f = p - i;
    const a = this.buf[i & this.mask];
    const b = this.buf[(i + 1) & this.mask];
    return a + (b - a) * f;
  }
  readInt(d) {
    return this.buf[(this.w - d) & this.mask];
  }
}

/**
 * 残響（FDN 8 本、Hadamard、線ごとの高域の減衰、2 本を揺らす）。入りはステレオ、戻りは響きだけ。
 * rt60 は低めの帯域で -60 dB までの秒。damp は高域の減り（0〜0.8）。
 */
export function reverb(inp, { rt60 = 2.4, size = 1, damp = 0.35, pre = 0.02, hp = 160, lp = 7500, width = 1, seed = 7, early = 0.25 } = {}) {
  const out = new Stereo(inp.n);
  const r = rng(seed);
  const base = [44.3, 51.1, 58.7, 66.1, 72.9, 81.3, 89.9, 99.7];
  const lens = base.map((ms) => Math.round(((ms * size) / 1000) * SR) | 1);
  const lines = lens.map((l) => new Ring(l + 64));
  const gains = lens.map((l) => 10 ** ((-3 * l) / (rt60 * SR)));
  const lpState = new Float64Array(8);
  const d = clamp(damp, 0, 0.9);
  // 入りの拡散（各チャンネル 4 つの全域通過）
  const apMs = [
    [4.77, 3.59, 12.73, 9.31],
    [4.93, 3.79, 12.31, 9.97],
  ];
  const apG = [0.72, 0.72, 0.64, 0.64];
  const aps = apMs.map((row) => row.map((ms) => ({ ring: new Ring(Math.round((ms * size * SR) / 1000) + 2), len: Math.round((ms * size * SR) / 1000) })));
  const preLen = Math.max(1, Math.round(pre * SR));
  const preL = new Ring(preLen + 2);
  const preR = new Ring(preLen + 2);
  const modRate = [0.11 + r() * 0.05, 0.17 + r() * 0.05, 0.23 + r() * 0.05];
  const modDepth = 0.0009 * SR; // ±0.9 ms
  const modLines = [1, 4, 6];
  const v = new Float64Array(8);
  const s = Math.SQRT1_2 / 2; // 1/sqrt(8)
  const n = inp.n;
  for (let i = 0; i < n; i++) {
    preL.push(inp.L[i]);
    preR.push(inp.R[i]);
    let xl = preL.readInt(preLen);
    let xr = preR.readInt(preLen);
    for (let k = 0; k < 4; k++) {
      const a = aps[0][k];
      const dl = a.ring.readInt(a.len);
      const yl = -apG[k] * xl + dl;
      a.ring.push(xl + apG[k] * yl);
      xl = yl;
      const b = aps[1][k];
      const dr = b.ring.readInt(b.len);
      const yr = -apG[k] * xr + dr;
      b.ring.push(xr + apG[k] * yr);
      xr = yr;
    }
    // 線を読む（3 本は揺らす）
    for (let k = 0; k < 8; k++) {
      let len = lens[k];
      const mi = modLines.indexOf(k);
      if (mi >= 0) {
        const ph = (i / SR) * modRate[mi];
        len += modDepth * (1 + sinp(ph + mi * 0.31)) + 1;
        v[k] = lines[k].read(len);
      } else v[k] = lines[k].readInt(len);
    }
    const oL = v[0] + v[2] - v[4] + v[6];
    const oR = v[1] - v[3] + v[5] + v[7];
    // 高域の減衰（1 極）と残る量
    for (let k = 0; k < 8; k++) {
      let lp = v[k] * (1 - d) + lpState[k] * d;
      if (lp < TINY && lp > -TINY) lp = 0;
      lpState[k] = lp;
      v[k] = lp * gains[k];
    }
    // Hadamard 8（速い Walsh-Hadamard）
    for (let h = 1; h < 8; h <<= 1) {
      for (let j = 0; j < 8; j += h << 1) {
        for (let q = j; q < j + h; q++) {
          const a = v[q];
          const b = v[q + h];
          v[q] = a + b;
          v[q + h] = a - b;
        }
      }
    }
    for (let k = 0; k < 8; k++) lines[k].push(v[k] * s + (k & 1 ? xr : xl) * 0.5);
    const e = early;
    const L = oL * 0.5 + xl * e;
    const R = oR * 0.5 + xr * e;
    const mid = (L + R) * 0.5;
    const side = (L - R) * 0.5 * width;
    out.L[i] = mid + side;
    out.R[i] = mid - side;
  }
  eqStereo(out, [
    ["hp", hp, 0.7],
    ["lp", lp, 0.7],
  ]);
  return out;
}

/** 往復の遅れ（左で入り、右と左を行き来）。戻りは遅れの音だけ */
export function pingpong(inp, { time = 0.375, feedback = 0.38, lp = 3200, hp = 250 } = {}) {
  const out = new Stereo(inp.n);
  const len = Math.round(time * SR);
  const dl = new Ring(len + 2);
  const dr = new Ring(len + 2);
  const lpc = onePoleCoef(lp);
  const hpc = onePoleCoef(hp);
  let lpl = 0, lpr = 0, hpl = 0, hpr = 0;
  for (let i = 0; i < inp.n; i++) {
    const mono = (inp.L[i] + inp.R[i]) * 0.5;
    const yl = dl.readInt(len);
    const yr = dr.readInt(len);
    lpl = yl * (1 - lpc) + lpl * lpc;
    lpr = yr * (1 - lpc) + lpr * lpc;
    hpl = lpl * (1 - hpc) + hpl * hpc;
    hpr = lpr * (1 - hpc) + hpr * hpc;
    if (lpl < TINY && lpl > -TINY) lpl = 0;
    if (lpr < TINY && lpr > -TINY) lpr = 0;
    if (hpl < TINY && hpl > -TINY) hpl = 0;
    if (hpr < TINY && hpr > -TINY) hpr = 0;
    const fl = lpl - hpl;
    const fr = lpr - hpr;
    dl.push(mono + fr * feedback);
    dr.push(fl * feedback);
    out.L[i] = fl;
    out.R[i] = fr;
  }
  return out;
}

/** コーラス（その場で）。3 つの揺れる遅れ */
export function chorus(st, { rate = 0.21, depth = 0.0035, base = 0.011, mix = 0.45, from = 0, to = st.n } = {}) {
  const maxLen = Math.round((base + depth * 2) * 1.4 * SR) + 8;
  const rl = new Ring(maxLen);
  const rr = new Ring(maxLen);
  const b = base * SR;
  const dp = depth * SR;
  for (let i = from; i < to; i++) {
    const l = st.L[i];
    const r = st.R[i];
    rl.push(l);
    rr.push(r);
    const ph = (i / SR) * rate;
    const wl = rl.read(b + dp * (1 + sinp(ph))) * 0.5 + rl.read(b + dp * (1 + sinp(ph + 0.33)) * 1.31) * 0.5;
    const wr = rr.read(b + dp * (1 + sinp(ph + 0.5))) * 0.5 + rr.read(b + dp * (1 + sinp(ph + 0.83)) * 1.27) * 0.5;
    st.L[i] = l * (1 - mix * 0.5) + wl * mix;
    st.R[i] = r * (1 - mix * 0.5) + wr * mix;
  }
}

/** 大きさの曲線（dB の点 [[秒, dB], ...] を直線でつなぎ、外は端の値）をその場でかける */
export function automate(st, points) {
  if (!points || points.length === 0) return;
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (let i = 0; i < st.n; i++) {
    const t = i / SR;
    while (k < pts.length - 1 && pts[k + 1][0] <= t) k++;
    let g;
    if (t <= pts[0][0]) g = pts[0][1];
    else if (k >= pts.length - 1) g = pts[pts.length - 1][1];
    else {
      const [t0, d0] = pts[k];
      const [t1, d1] = pts[k + 1];
      g = d0 + ((d1 - d0) * (t - t0)) / Math.max(1e-9, t1 - t0);
    }
    const a = g <= -119 ? 0 : 10 ** (g / 20);
    st.L[i] *= a;
    st.R[i] *= a;
  }
}

/** 決まった時刻（キックなど）で下げて戻す（サイドチェインの代わり）。その場で */
export function pump(st, times, { depth = 0.45, attack = 0.006, release = 0.22 } = {}) {
  const env = new Float32Array(st.n);
  for (const t of times) {
    const s0 = Math.round(t * SR);
    const a = Math.round(attack * SR);
    const len = Math.round(release * 5 * SR);
    for (let j = 0; j < len; j++) {
      const i = s0 + j;
      if (i < 0 || i >= st.n) continue;
      const e = j < a ? j / a : Math.exp(-(j - a) / (release * SR));
      if (e > env[i]) env[i] = e;
    }
  }
  for (let i = 0; i < st.n; i++) {
    const g = 1 - depth * env[i];
    st.L[i] *= g;
    st.R[i] *= g;
  }
}

// ---------- 大きさの計り ----------
/** BS.1770 の K 特性の 2 段（48 kHz の値を任意の速さで作る） */
function kFilters() {
  // 段 1: 高域の棚（+4 dB 付近）
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / SR);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const s1 = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0,
  };
  // 段 2: 高域通過（RLB）
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / SR);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const s2 = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / a01, a2: (1 - K1 / Q1 + K1 * K1) / a01 };
  return [s1, s2];
}
function runBiq(x, c) {
  const y = new Float64Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = c.b0 * v + z1;
    z1 = c.b1 * v - c.a1 * o + z2;
    z2 = c.b2 * v - c.a2 * o;
    if (z1 < TINY && z1 > -TINY) z1 = 0;
    if (z2 < TINY && z2 > -TINY) z2 = 0;
    y[i] = o;
  }
  return y;
}
/** K 特性をかけた 2 乗の和を 100 ms ごとに（瞬間・短時間・統合の元） */
function kSquares(st) {
  const [s1, s2] = kFilters();
  const hop = SR / 10;
  const nh = Math.floor(st.n / hop);
  const sq = new Float64Array(nh);
  for (const ch of [st.L, st.R]) {
    const y = runBiq(runBiq(ch, s1), s2);
    for (let h = 0; h < nh; h++) {
      let s = 0;
      for (let i = h * hop; i < (h + 1) * hop; i++) s += y[i] * y[i];
      sq[h] += s;
    }
  }
  return { sq, hop, nh };
}
const lufsOf = (meanSq) => -0.691 + 10 * Math.log10(Math.max(meanSq, 1e-20));
/** 統合（I）、短時間（3 秒、0.1 秒ごと）、瞬間（0.4 秒）、LRA */
export function loudness(st) {
  const { sq, hop, nh } = kSquares(st);
  const block = (w) => {
    const out = new Float64Array(nh);
    for (let h = 0; h < nh; h++) {
      let s = 0;
      const a = Math.max(0, h - w + 1);
      for (let j = a; j <= h; j++) s += sq[j];
      out[h] = s / (w * hop);
    }
    return out;
  };
  const mom = block(4);
  const st3 = block(30);
  // 統合: 0.4 秒の区切り（75% 重なり）に門
  const blocks = [];
  for (let h = 3; h < nh; h++) blocks.push(mom[h]);
  const abs = blocks.filter((z) => lufsOf(z) > -70);
  const rel = lufsOf(abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length)) - 10;
  const gated = abs.filter((z) => lufsOf(z) > rel);
  const I = lufsOf(gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length));
  // LRA（EBU 3342）: 短時間の値の 10〜95%
  const stv = [];
  for (let h = 29; h < nh; h += 1) stv.push(st3[h]);
  const sAbs = stv.filter((z) => lufsOf(z) > -70);
  const sRel = lufsOf(sAbs.reduce((a, b) => a + b, 0) / Math.max(1, sAbs.length)) - 20;
  const sl = sAbs.filter((z) => lufsOf(z) > sRel).map(lufsOf).sort((a, b) => a - b);
  const pick = (p) => sl[Math.min(sl.length - 1, Math.max(0, Math.floor(p * (sl.length - 1))))] ?? -70;
  const LRA = sl.length ? pick(0.95) - pick(0.1) : 0;
  return {
    I,
    LRA,
    momentary: Array.from(mom, lufsOf),
    shortTerm: Array.from(st3, lufsOf),
    hopSec: 0.1,
  };
}

// ---------- 真のピーク（4 倍の補間） ----------
const TP_TAPS = 12;
const TP = (() => {
  const ph = [];
  for (let p = 1; p < 4; p++) {
    const frac = p / 4;
    const h = [];
    let sum = 0;
    for (let k = -TP_TAPS + 1; k <= TP_TAPS; k++) {
      const x = k - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TP_TAPS + 0.5));
      h.push(sinc * w);
      sum += sinc * w;
    }
    ph.push(h.map((v) => v / sum));
  }
  return ph;
})();
function tpAt(x, i) {
  let m = Math.abs(x[i]);
  for (const h of TP) {
    let s = 0;
    for (let k = -TP_TAPS + 1, j = 0; k <= TP_TAPS; k++, j++) {
      const idx = i + k;
      if (idx >= 0 && idx < x.length) s += x[idx] * h[j];
    }
    const a = Math.abs(s);
    if (a > m) m = a;
  }
  return m;
}
/** 標本ごとの真のピーク（左右の大きい方）。小さい所は標本の値で済ませる */
export function truePeakEnvelope(st, floor = 0.25) {
  const env = new Float32Array(st.n);
  for (let i = 0; i < st.n; i++) {
    const a = Math.max(Math.abs(st.L[i]), Math.abs(st.R[i]));
    if (a < floor) {
      env[i] = a;
      continue;
    }
    env[i] = Math.max(tpAt(st.L, i), tpAt(st.R, i));
  }
  return env;
}
export function truePeakDb(st) {
  const env = truePeakEnvelope(st, 0.05);
  let m = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > m) m = env[i];
  return 20 * Math.log10(Math.max(m, 1e-12));
}

/** 先読みの制限（真のピークで ceiling dB を超えない）。その場で。下げた最大の dB を返す */
export function limit(st, { ceilingDb = -2, lookahead = 0.004, release = 0.12 } = {}) {
  const ceil = dbToGain(ceilingDb);
  const env = truePeakEnvelope(st, ceil * 0.5);
  const n = st.n;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = env[i] > ceil ? ceil / env[i] : 1;
  const la = Math.max(1, Math.round(lookahead * SR));
  // 先読みの窓の最小（後ろから）
  const minAhead = new Float32Array(n);
  {
    // 単純な単調な deque
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (tail > head && need[q[tail - 1]] >= need[i]) tail--;
      q[tail++] = i;
      while (q[head] > i + la) head++;
      minAhead[i] = need[q[head]];
    }
  }
  // 先読みの窓で滑らかに下げ（箱の平均）、戻すのは指数で
  const g = new Float32Array(n);
  let acc = 0;
  const box = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    acc += minAhead[i];
    if (i >= la) acc -= minAhead[i - la];
    // 窓の中の値はどれも頂点で要る値以下なので、平均も頂点で要る値以下になる
    box[i] = i + 1 < la ? minAhead[i] : acc / la;
  }
  const rc = Math.exp(-1 / (release * SR));
  let cur = 1;
  let worst = 1;
  const where = [];
  for (let i = 0; i < n; i++) {
    const target = box[i];
    cur = target < cur ? target : target + (cur - target) * rc;
    g[i] = cur;
    if (cur < worst) worst = cur;
    // 1 dB より多く下げた所を記録（0.25 秒ごとにまとめる）
    if (cur < 0.891) {
      const t = i / SR;
      const last = where[where.length - 1];
      const db = 20 * Math.log10(cur);
      if (last && t - last.to < 0.25) {
        last.to = t;
        if (db < last.db) last.db = db;
      } else where.push({ from: t, to: t, db });
    }
  }
  for (let i = 0; i < n; i++) {
    st.L[i] *= g[i];
    st.R[i] *= g[i];
  }
  limit.where = where.map((w) => ({ from: +w.from.toFixed(2), to: +w.to.toFixed(2), db: +w.db.toFixed(2) }));
  return 20 * Math.log10(worst);
}

// ---------- FFT ----------
/** 実数の FFT（基数 2、その場、re・im） */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export { LENGTH };
