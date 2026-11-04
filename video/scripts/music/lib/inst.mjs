// 楽器。どれも (bus, 秒, MIDI, 設定) で bus に足す。外の音源・サンプルは使わず、式で作る。
//   piano     弦の倍音を 1 本ずつ減衰させる（打弦の位置、非調和、2 段の減衰、ダンパー、フェルトの音）
//   ensemble  弦・パッド（鋸歯の折り返しを抑え、揺れ・ずれを付け、SVF で丸める）
//   airPad    倍音を 1 本ずつゆっくり揺らすパッド
//   bass・pluck・kick・hat・shaker・tick・boom・timpani・marimba・epiano・bell・noiseSwell
import { SR, clamp, mtof, panGains, rng } from "./core.mjs";
import { Biquad, SVF, blep, onePoleCoef, sinp } from "./dsp.mjs";

const MAXN = SR * 32;
const SCR = new Float64Array(MAXN);
const SCR_L = new Float64Array(MAXN);
const SCR_R = new Float64Array(MAXN);
const LN1000 = 6.907755278982137; // -60 dB

/** 1 標本ごとの減衰（T60 秒で -60 dB） */
const decayPer = (t60) => Math.exp(-LN1000 / (Math.max(t60, 1e-4) * SR));

/** 頭を cos² で上げる（クリックを出さない） */
function rampIn(buf, len, n) {
  const k = Math.min(n, len);
  for (let i = 0; i < k; i++) {
    const x = Math.sin((0.5 * Math.PI * i) / k);
    buf[i] *= x * x;
  }
}
function rampOut(buf, len, n) {
  const k = Math.min(n, len);
  for (let i = 0; i < k; i++) {
    const x = Math.sin((0.5 * Math.PI * i) / k);
    buf[len - 1 - i] *= x * x;
  }
}
/** SCR の 0〜len を bus に足す */
function flushMono(bus, start, len, pan, gain) {
  const [gl, gr] = panGains(pan);
  const L = bus.L, R = bus.R;
  const a = gl * gain, b = gr * gain;
  const end = Math.min(bus.n, start + len);
  for (let i = Math.max(0, start), j = i - start; i < end; i++, j++) {
    const v = SCR[j];
    L[i] += v * a;
    R[i] += v * b;
  }
  SCR.fill(0, 0, len); // 次の音のために空にしておく
}
function flushStereo(bus, start, len, gain) {
  const L = bus.L, R = bus.R;
  const end = Math.min(bus.n, start + len);
  for (let i = Math.max(0, start), j = i - start; i < end; i++, j++) {
    L[i] += SCR_L[j] * gain;
    R[i] += SCR_R[j] * gain;
  }
  SCR_L.fill(0, 0, len);
  SCR_R.fill(0, 0, len);
}

/** 減衰する正弦を SCR に足す（途中の標本 sw から減衰の速さを変える）。終わりの標本を返す */
function dampedSine(f, amp, t60a, t60b, sw, maxLen, thr = 1e-4) {
  const w = (2 * Math.PI * f) / SR;
  const ra = decayPer(t60a);
  const rb = decayPer(t60b);
  const la = Math.log(ra), lb = Math.log(rb);
  const lnThr = Math.log(thr);
  let end = lnThr / la;
  if (end > sw) end = sw + (lnThr - sw * la) / lb;
  end = Math.min(maxLen, Math.ceil(end));
  const c = Math.cos(w), s = Math.sin(w);
  let re = amp, im = 0;
  let cr = ra * c, ci = ra * s;
  const k1 = Math.min(sw, end);
  for (let i = 0; i < k1; i++) {
    SCR[i] += im;
    const t = re * cr - im * ci;
    im = re * ci + im * cr;
    re = t;
  }
  cr = rb * c;
  ci = rb * s;
  for (let i = k1; i < end; i++) {
    SCR[i] += im;
    const t = re * cr - im * ci;
    im = re * ci + im * cr;
    re = t;
  }
  return end;
}

/**
 * ピアノ。hold は鍵盤（かペダル）を離すまでの秒。felt はフェルトの度合い（0〜1、大きいほど丸く、こもる）。
 * 倍音 k の高さは k·f0·√(1+Bk²)。大きさは打つ位置 x0 の sin と、打つ強さで決まる切れ目で決める。
 */
export function piano(bus, t, m, o = {}) {
  const vel = clamp(o.vel ?? 0.6, 0.02, 1);
  const felt = o.felt ?? 0.4;
  const bright = o.bright ?? 1;
  const hold = Math.max(0.05, o.hold ?? 1.5);
  const r = rng(o.seed ?? ((m * 7919) ^ Math.round(t * 1000)));
  const f0 = mtof(m) * (1 + (o.cents ?? 0) / 1731.234);
  const B = 4e-5 * Math.exp(0.062 * (m - 21));
  const T60 = clamp(15 * 2 ** (-(m - 36) / 17), 0.9, 22) * (o.sustain ?? 1);
  const Tdamp = clamp(0.5 * 2 ** (-(m - 48) / 28), 0.08, 1.1);
  const fc = (380 + 3300 * vel * vel) * (1 - 0.55 * felt) * bright + f0 * 1.2;
  const beta = 0.85 + (1 - vel) * 0.45;
  const x0 = 0.118 + r() * 0.012;
  const sw = Math.round(hold * SR);
  const parts = [];
  let total = 0;
  // SCR は前の音のあとで空にしてある（flushMono）
  for (let k = 1; k <= 52; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > 11500) break;
    let a = Math.abs(Math.sin(Math.PI * k * x0)) / k ** beta;
    a /= 1 + (fk / fc) ** 2;
    if (a < 2e-4) continue;
    parts.push({ k, fk, a });
    total += a;
  }
  let len = 0;
  const norm = 1 / Math.max(total, 1e-6);
  for (const p of parts) {
    const Tk = T60 / (1 + 0.09 * (p.k - 1) + (p.fk / 2600) ** 2);
    const Td = Tdamp / (1 + 0.22 * (p.k - 1));
    const a = p.a * norm;
    const det = (r() - 0.5) * 1.6; // セント
    // 速く減る音（打った直後）と、ゆっくり残る音（わずかにずらして弦どうしのうなり）
    len = Math.max(len, dampedSine(p.fk, a * 0.6, Tk * 0.22, Td, sw, MAXN));
    len = Math.max(len, dampedSine(p.fk * (1 + det / 1731.234), a * 0.4, Tk, Td, sw, MAXN));
  }
  // ハンマーの当たり（短い雑音を低域に）とフェルトの音
  const thumpN = Math.round(0.03 * SR);
  const lpA = onePoleCoef(clamp(f0 * 3, 250, 2200));
  const lpB = onePoleCoef(320);
  let z = 0, zf = 0;
  const thumpAmp = 0.05 * vel * (0.6 + 0.4 * (1 - felt));
  const feltAmp = 0.07 * felt * vel;
  for (let i = 0; i < thumpN; i++) {
    const nz = r() * 2 - 1;
    z = nz * (1 - lpA) + z * lpA;
    zf = nz * (1 - lpB) + zf * lpB;
    SCR[i] += z * thumpAmp * Math.exp(-i / (0.0035 * SR)) + zf * feltAmp * Math.exp(-i / (0.012 * SR));
  }
  len = Math.max(len, thumpN);
  rampIn(SCR, len, Math.round(0.003 * SR));
  rampOut(SCR, len, Math.round(0.02 * SR));
  const pan = o.pan ?? clamp((m - 62) / 42, -0.55, 0.55);
  flushMono(bus, Math.round(t * SR), len, pan, (o.gain ?? 1) * vel ** 1.35 * 0.9);
}

/**
 * 弦・パッド。dur の間は鳴り、そのあと release 秒で消える。voices 本を detune セントずつずらし、揺れ（vib セント）を付ける。
 * wave: saw・tri・mix。cutoff は SVF の切れ目（attack の間に上がる）。curve は鳴っている間の dB の点 [[頭からの秒, dB], ...]
 */
export function ensemble(bus, t, m, o = {}) {
  const dur = Math.max(0.05, o.dur ?? 2);
  const attack = Math.max(0.05, o.attack ?? 0.5);
  const release = Math.max(0.08, o.release ?? 1);
  const voices = o.voices ?? 3;
  const detune = o.detune ?? 8;
  const vib = o.vib ?? 6;
  const vibRate = o.vibRate ?? 5.1;
  const cutoff = o.cutoff ?? 2200;
  const q = o.q ?? 0.62;
  const wave = o.wave ?? "saw";
  const width = o.width ?? 0.7;
  const pan = o.pan ?? 0;
  const r = rng(o.seed ?? ((m * 104729) ^ Math.round(t * 997)));
  const f0 = mtof(m);
  const len = Math.min(MAXN, Math.round((dur + release * 1.6) * SR));
  SCR_L.fill(0, 0, len);
  SCR_R.fill(0, 0, len);
  for (let v = 0; v < voices; v++) {
    const off = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
    const cents = off * detune * 0.5 + (r() - 0.5) * detune * 0.35;
    const f = f0 * 2 ** (cents / 1200);
    const vp = clamp(pan + off * width * 0.5, -1, 1);
    const [gl, gr] = panGains(vp);
    let ph = r();
    const vr = vibRate * (0.92 + r() * 0.16);
    const vph = r();
    const vdelay = 0.25 + r() * 0.3;
    for (let i = 0; i < len; i++) {
      const tt = i / SR;
      const vd = vib * Math.min(1, Math.max(0, (tt - vdelay) / 0.6));
      const fi = f * (1 + (vd / 1731.234) * sinp(vph + tt * vr));
      const dt = fi / SR;
      ph += dt;
      if (ph >= 1) ph -= 1;
      let y;
      if (wave === "tri") y = 1 - 4 * Math.abs(ph - 0.5);
      else {
        const saw = 2 * ph - 1 - blep(ph, dt);
        y = wave === "mix" ? saw * 0.55 + (1 - 4 * Math.abs(ph - 0.5)) * 0.45 : saw;
      }
      SCR_L[i] += y * gl;
      SCR_R[i] += y * gr;
    }
  }
  // 丸める（切れ目は attack の間に上がる）と大きさ
  const fl = new SVF(cutoff * 0.4, q);
  const fr = new SVF(cutoff * 0.4, q);
  const hpc = onePoleCoef(o.hp ?? 45);
  let hl = 0, hr = 0;
  const curve = o.curve ?? null;
  let ci = 0;
  const relStart = Math.round(dur * SR);
  const relK = decayPer(release * 0.9);
  let env = 0;
  let relEnv = 1;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    if ((i & 31) === 0) {
      const a = Math.min(1, tt / attack);
      env = a < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * a) : 1;
      const c = cutoff * (0.38 + 0.62 * Math.sqrt(env));
      fl.set(c, q);
      fr.set(c, q);
    }
    let g = env;
    if (curve) {
      while (ci < curve.length - 1 && curve[ci + 1][0] <= tt) ci++;
      let d;
      if (tt <= curve[0][0]) d = curve[0][1];
      else if (ci >= curve.length - 1) d = curve[curve.length - 1][1];
      else d = curve[ci][1] + ((curve[ci + 1][1] - curve[ci][1]) * (tt - curve[ci][0])) / (curve[ci + 1][0] - curve[ci][0]);
      g *= 10 ** (d / 20);
    }
    if (i >= relStart) {
      relEnv *= relK;
      g *= relEnv;
    }
    let l = fl.tick(SCR_L[i]);
    let rr = fr.tick(SCR_R[i]);
    hl = l * (1 - hpc) + hl * hpc;
    hr = rr * (1 - hpc) + hr * hpc;
    SCR_L[i] = (l - hl) * g;
    SCR_R[i] = (rr - hr) * g;
  }
  const k = Math.round(0.02 * SR);
  for (let i = 0; i < k; i++) {
    const x = Math.sin((0.5 * Math.PI * i) / k) ** 2;
    SCR_L[len - 1 - i] *= x;
    SCR_R[len - 1 - i] *= x;
  }
  flushStereo(bus, Math.round(t * SR), len, (o.gain ?? 1) * (o.vel ?? 0.6) * (0.55 / Math.sqrt(voices)));
}

/**
 * 倍音を 1 本ずつゆっくり揺らすパッド（声に聞こえない、丸い柱のような音）。
 * partials 本の倍音を 1/k^tilt で並べ、それぞれを 0.05〜0.3 Hz の揺れで上下させる。左右は倍音ごとに散らす
 */
export function airPad(bus, t, m, o = {}) {
  const dur = Math.max(0.1, o.dur ?? 4);
  const attack = Math.max(0.1, o.attack ?? 1.5);
  const release = Math.max(0.2, o.release ?? 2.5);
  const partials = o.partials ?? 8;
  const tilt = o.tilt ?? 1.4;
  const r = rng(o.seed ?? ((m * 15485863) ^ Math.round(t * 991)));
  const f0 = mtof(m);
  const len = Math.min(MAXN, Math.round((dur + release * 1.7) * SR));
  SCR_L.fill(0, 0, len);
  SCR_R.fill(0, 0, len);
  const maxF = o.maxF ?? 5000;
  let total = 0;
  const parts = [];
  for (let k = 1; k <= partials; k++) {
    const f = f0 * k;
    if (f > maxF) break;
    const a = 1 / k ** tilt;
    parts.push({ k, f, a });
    total += a;
  }
  for (const p of parts) {
    for (let c = 0; c < 2; c++) {
      const cents = (c === 0 ? -1 : 1) * (o.detune ?? 3) * (0.6 + r() * 0.8);
      const f = p.f * 2 ** (cents / 1200);
      const w = (2 * Math.PI * f) / SR;
      const cw = Math.cos(w), sw = Math.sin(w);
      let re = Math.cos(r() * 2 * Math.PI), im = Math.sin(r() * 2 * Math.PI);
      const rate = 0.05 + r() * 0.25;
      const ph = r();
      const depth = p.k === 1 ? 0.25 : 0.7;
      const [gl, gr] = panGains(clamp((r() * 2 - 1) * (o.width ?? 0.8), -1, 1));
      const a = (p.a / total) * 0.5;
      for (let i = 0; i < len; i++) {
        const mod = 1 - depth * 0.5 * (1 + sinp(ph + (i / SR) * rate));
        const v = im * a * mod;
        SCR_L[i] += v * gl;
        SCR_R[i] += v * gr;
        const tt = re * cw - im * sw;
        im = re * sw + im * cw;
        re = tt;
      }
    }
  }
  const relStart = Math.round(dur * SR);
  const relK = decayPer(release * 0.9);
  let relEnv = 1;
  const curve = o.curve ?? null;
  let ci = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const a = Math.min(1, tt / attack);
    let g = a < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * a) : 1;
    if (curve) {
      while (ci < curve.length - 1 && curve[ci + 1][0] <= tt) ci++;
      let d;
      if (tt <= curve[0][0]) d = curve[0][1];
      else if (ci >= curve.length - 1) d = curve[curve.length - 1][1];
      else d = curve[ci][1] + ((curve[ci + 1][1] - curve[ci][1]) * (tt - curve[ci][0])) / (curve[ci + 1][0] - curve[ci][0]);
      g *= 10 ** (d / 20);
    }
    if (i >= relStart) {
      relEnv *= relK;
      g *= relEnv;
    }
    SCR_L[i] *= g;
    SCR_R[i] *= g;
  }
  const k = Math.round(0.03 * SR);
  for (let i = 0; i < k; i++) {
    const x = Math.sin((0.5 * Math.PI * i) / k) ** 2;
    SCR_L[len - 1 - i] *= x;
    SCR_R[len - 1 - i] *= x;
  }
  flushStereo(bus, Math.round(t * SR), len, (o.gain ?? 1) * (o.vel ?? 0.6));
}

/** 低音（正弦に 2・3 倍音を少し、柔らかく歪ませる）。小さなスピーカーでも聞こえるように倍音を残す */
export function bass(bus, t, m, o = {}) {
  const dur = Math.max(0.05, o.dur ?? 1);
  const attack = Math.max(0.004, o.attack ?? 0.012);
  const release = Math.max(0.03, o.release ?? 0.18);
  const harm = o.harm ?? [1, 0.32, 0.12, 0.05];
  const drive = o.drive ?? 1.2;
  const f0 = mtof(m);
  const len = Math.min(MAXN, Math.round((dur + release * 2.2) * SR));
  SCR.fill(0, 0, len);
  const decay = o.decay ? decayPer(o.decay) : 1;
  let amp = 1;
  const relStart = Math.round(dur * SR);
  const relK = decayPer(release);
  const w = (2 * Math.PI * f0) / SR;
  const norm = Math.tanh(drive);
  let rel = 1;
  for (let i = 0; i < len; i++) {
    const ph = w * i;
    let y = 0;
    for (let h = 0; h < harm.length; h++) y += harm[h] * Math.sin(ph * (h + 1));
    const a = i < attack * SR ? Math.sin((0.5 * Math.PI * i) / (attack * SR)) ** 2 : 1;
    amp *= decay;
    if (i >= relStart) rel *= relK;
    SCR[i] = (Math.tanh(y * drive) / norm) * a * amp * rel;
  }
  rampOut(SCR, len, Math.round(0.015 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? 0, (o.gain ?? 1) * (o.vel ?? 0.7) * 0.5);
}

/** はじく音（鋸歯＋矩形の下を SVF で、切れ目を素早く下げる）。低音にも、刻みにも */
export function pluck(bus, t, m, o = {}) {
  const dur = Math.max(0.03, o.dur ?? 0.25);
  const decay = o.decay ?? 0.35;
  const release = o.release ?? 0.08;
  const c0 = o.cutoff0 ?? 2400;
  const c1 = o.cutoff1 ?? 280;
  const cDecay = o.cutoffDecay ?? 0.09;
  const q = o.q ?? 0.9;
  const sub = o.sub ?? 0.4;
  const f = mtof(m);
  const len = Math.min(MAXN, Math.round((dur + release * 3) * SR));
  SCR.fill(0, 0, len);
  const svf = new SVF(c0, q);
  let ph = 0, ph2 = 0;
  const dt = f / SR;
  const ak = decayPer(decay);
  let amp = 1;
  const relStart = Math.round(dur * SR);
  const relK = decayPer(release);
  for (let i = 0; i < len; i++) {
    ph += dt;
    if (ph >= 1) ph -= 1;
    ph2 += dt * 0.5;
    if (ph2 >= 1) ph2 -= 1;
    const saw = 2 * ph - 1 - blep(ph, dt);
    const sq = ph2 < 0.5 ? 1 : -1; // 1 オクターブ下の矩形（低いので折り返しは小さい）
    if ((i & 15) === 0) svf.set(c1 + (c0 - c1) * Math.exp(-i / (cDecay * SR)), q);
    const y = svf.tick(saw * (1 - sub * 0.5) + sq * sub * 0.5);
    amp *= ak;
    if (i >= relStart) amp *= relK;
    SCR[i] = y * amp;
  }
  rampIn(SCR, len, Math.round(0.003 * SR));
  rampOut(SCR, len, Math.round(0.012 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? 0, (o.gain ?? 1) * (o.vel ?? 0.6) * 0.6);
}

/** 柔らかいキック（正弦の高さを下げ、短い当たりを低域に） */
export function kick(bus, t, o = {}) {
  const f0 = o.f0 ?? 47;
  const f1 = o.f1 ?? 115;
  const pd = o.pitchDecay ?? 0.035;
  const decay = o.decay ?? 0.34;
  const click = o.click ?? 0.08;
  const len = Math.round((decay * 3.2 + 0.02) * SR);
  SCR.fill(0, 0, len);
  const r = rng(o.seed ?? Math.round(t * 1000));
  let ph = 0;
  const lp = onePoleCoef(o.clickLp ?? 1800);
  let z = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const f = f0 + (f1 - f0) * Math.exp(-tt / pd);
    ph += f / SR;
    const a = Math.exp(-tt / decay);
    let y = Math.sin(2 * Math.PI * ph) * a;
    if (i < 0.006 * SR) {
      z = (r() * 2 - 1) * (1 - lp) + z * lp;
      y += z * click * Math.exp(-tt / 0.0012);
    }
    SCR[i] = Math.tanh(y * 1.4) / Math.tanh(1.4);
  }
  rampIn(SCR, len, Math.round(0.0015 * SR));
  rampOut(SCR, len, Math.round(0.02 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? 0, (o.gain ?? 1) * (o.vel ?? 0.8));
}

/** ハイハット（白い雑音を高域だけに、短く） */
export function hat(bus, t, o = {}) {
  const decay = o.decay ?? 0.035;
  const len = Math.round((decay * 5 + 0.005) * SR);
  SCR.fill(0, 0, len);
  const r = rng(o.seed ?? Math.round(t * 7777));
  const h1 = new Biquad("hp", o.hp ?? 7500, 0.7);
  const h2 = new Biquad("peak", o.tone ?? 10500, 1.2, 4);
  for (let i = 0; i < len; i++) {
    const e = Math.exp(-i / (decay * SR));
    SCR[i] = h2.tick(h1.tick(r() * 2 - 1)) * e;
  }
  rampIn(SCR, len, Math.round(0.0008 * SR));
  rampOut(SCR, len, Math.round(0.005 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? 0.15, (o.gain ?? 1) * (o.vel ?? 0.3) * 0.35);
}

/** シェイカー（帯域の雑音、少し立ち上がる） */
export function shaker(bus, t, o = {}) {
  const decay = o.decay ?? 0.05;
  const att = o.attack ?? 0.006;
  const len = Math.round((att + decay * 5) * SR);
  SCR.fill(0, 0, len);
  const r = rng(o.seed ?? Math.round(t * 3331));
  const bp = new Biquad("bp", o.f ?? 7200, o.q ?? 1.1);
  const hp = new Biquad("hp", 4500, 0.7);
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const e = tt < att ? tt / att : Math.exp(-(tt - att) / decay);
    SCR[i] = hp.tick(bp.tick(r() * 2 - 1)) * e;
  }
  rampOut(SCR, len, Math.round(0.004 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? -0.2, (o.gain ?? 1) * (o.vel ?? 0.3) * 0.6);
}

/** 時計のような刻み（高い所の短い共鳴）。声の帯域を避けて 4.5 kHz より上 */
export function tick(bus, t, o = {}) {
  const modes = o.modes ?? [
    [4700, 0.0045, 1],
    [7300, 0.003, 0.6],
    [10100, 0.002, 0.35],
  ];
  const len = Math.round(0.03 * SR);
  SCR.fill(0, 0, len);
  for (const [f, d, a] of modes) dampedSine(f * (o.pitch ?? 1), a, d * 6.9, d * 6.9, len, len, 1e-5);
  const r = rng(o.seed ?? Math.round(t * 5003));
  const hp = new Biquad("hp", 6000, 0.7);
  for (let i = 0; i < 0.002 * SR; i++) SCR[i] += hp.tick(r() * 2 - 1) * 0.4 * Math.exp(-i / (0.0006 * SR));
  rampIn(SCR, len, 24);
  rampOut(SCR, len, Math.round(0.004 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? 0.25, (o.gain ?? 1) * (o.vel ?? 0.3) * 0.25);
}

/** 低い響き（題名などの大きな山）。正弦を高い所から下げ、長く残す */
export function boom(bus, t, o = {}) {
  const f0 = o.f0 ?? 36;
  const f1 = o.f1 ?? 62;
  const decay = o.decay ?? 1.8;
  const pd = o.pitchDecay ?? 0.18;
  const len = Math.min(MAXN, Math.round(decay * 4.2 * SR));
  SCR.fill(0, 0, len);
  let ph = 0;
  const att = o.attack ?? 0.008;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const f = f0 + (f1 - f0) * Math.exp(-tt / pd);
    ph += f / SR;
    const a = (tt < att ? Math.sin((0.5 * Math.PI * tt) / att) ** 2 : 1) * Math.exp(-tt / decay);
    const y = Math.sin(2 * Math.PI * ph) + 0.25 * Math.sin(4 * Math.PI * ph) + 0.08 * Math.sin(6 * Math.PI * ph);
    SCR[i] = (Math.tanh(y * 1.1) / Math.tanh(1.1)) * a;
  }
  rampOut(SCR, len, Math.round(0.05 * SR));
  flushMono(bus, Math.round(t * SR), len, 0, (o.gain ?? 1) * (o.vel ?? 0.8) * 0.8);
}

/** ティンパニのような太鼓（膜の振動の比、柔らかいばち） */
export function timpani(bus, t, m, o = {}) {
  const f0 = mtof(m);
  const ratios = [1, 1.504, 1.742, 2.0, 2.245, 2.494, 2.8];
  const amps = [1, 0.5, 0.32, 0.22, 0.15, 0.1, 0.06];
  const decay = o.decay ?? 2.2;
  const len = Math.min(MAXN, Math.round(decay * 1.4 * SR));
  SCR.fill(0, 0, len);
  const soft = o.soft ?? 0.6;
  for (let k = 0; k < ratios.length; k++) {
    const a = amps[k] * (k === 0 ? 1 : 1 - soft * 0.6);
    dampedSine(f0 * ratios[k], a, decay / (1 + k * 0.45), decay / (1 + k * 0.45), len, len);
  }
  const r = rng(o.seed ?? Math.round(t * 911));
  const lp = onePoleCoef(260);
  let z = 0;
  for (let i = 0; i < 0.04 * SR; i++) {
    z = (r() * 2 - 1) * (1 - lp) + z * lp;
    SCR[i] += z * 0.6 * Math.exp(-i / (0.008 * SR));
  }
  rampIn(SCR, len, Math.round(0.004 * SR));
  rampOut(SCR, len, Math.round(0.05 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? 0, (o.gain ?? 1) * (o.vel ?? 0.7) * 0.45);
}

/** マリンバ（板の振動の比 1・4・10 に近い。共鳴管で基音が少し長く残る） */
export function marimba(bus, t, m, o = {}) {
  const f0 = mtof(m);
  const hard = o.hard ?? 0.35;
  const T = clamp(1.7 * 2 ** (-(m - 48) / 22), 0.25, 2.6) * (o.decay ?? 1);
  const len = Math.min(MAXN, Math.round(T * 1.5 * SR));
  SCR.fill(0, 0, len);
  const modes = [
    [1, 1, T],
    [3.984, 0.08 + 0.3 * hard, T * 0.32],
    [10.668, 0.02 + 0.12 * hard, T * 0.12],
  ];
  for (const [ratio, a, d] of modes) if (f0 * ratio < 12000) dampedSine(f0 * ratio, a, d, d, len, len);
  // 共鳴管: 基音をわずかに遅らせて足す
  dampedSine(f0 * 1.0007, 0.35, T * 1.25, T * 1.25, len, len);
  const r = rng(o.seed ?? ((m * 31) ^ Math.round(t * 1000)));
  const lp = onePoleCoef(900 + 2400 * hard);
  let z = 0;
  for (let i = 0; i < 0.006 * SR; i++) {
    z = (r() * 2 - 1) * (1 - lp) + z * lp;
    SCR[i] += z * 0.12 * hard * Math.exp(-i / (0.0012 * SR));
  }
  rampIn(SCR, len, Math.round(0.002 * SR));
  rampOut(SCR, len, Math.round(0.03 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? clamp((m - 66) / 30, -0.6, 0.6), (o.gain ?? 1) * (o.vel ?? 0.6) * 0.5);
}

/** 電気ピアノ風（FM、指数は打った直後だけ大きい）。丸く、声の下に入りやすい */
export function epiano(bus, t, m, o = {}) {
  const f = mtof(m);
  const dur = Math.max(0.05, o.dur ?? 1.2);
  const T = clamp(3.2 * 2 ** (-(m - 60) / 20), 0.6, 6) * (o.decay ?? 1);
  const release = o.release ?? 0.25;
  const len = Math.min(MAXN, Math.round(Math.min(T * 1.3, dur + release * 3) * SR));
  SCR.fill(0, 0, len);
  const idx0 = (o.index ?? 1.6) * (0.4 + 0.6 * (o.vel ?? 0.6));
  const w = (2 * Math.PI * f) / SR;
  const ak = decayPer(T);
  const relStart = Math.round(dur * SR);
  const relK = decayPer(release);
  let a = 1;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const idx = idx0 * Math.exp(-tt / 0.35) + 0.25;
    const mod = Math.sin(w * i) * idx;
    a *= ak;
    if (i >= relStart) a *= relK;
    SCR[i] = (Math.sin(w * i + mod) * 0.85 + Math.sin(w * 2 * i) * 0.1 * Math.exp(-tt / 0.6)) * a;
  }
  rampIn(SCR, len, Math.round(0.003 * SR));
  rampOut(SCR, len, Math.round(0.015 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? clamp((m - 62) / 40, -0.5, 0.5), (o.gain ?? 1) * (o.vel ?? 0.6) * 0.42);
}

/** 低めの鐘（自由な板の比 1・2.76・5.40。柔らかい立ち上がり） */
export function bell(bus, t, m, o = {}) {
  const f0 = mtof(m);
  const T = (o.decay ?? 4) * clamp(2 ** (-(m - 72) / 24), 0.5, 2);
  const len = Math.min(MAXN, Math.round(T * 1.4 * SR));
  SCR.fill(0, 0, len);
  const ratios = o.ratios ?? [1, 2.756, 5.404];
  const amps = o.amps ?? [1, 0.28, 0.08];
  for (let k = 0; k < ratios.length; k++) if (f0 * ratios[k] < 12000) dampedSine(f0 * ratios[k], amps[k], T / (1 + k * 1.2), T / (1 + k * 1.2), len, len);
  rampIn(SCR, len, Math.round((o.attack ?? 0.004) * SR));
  rampOut(SCR, len, Math.round(0.03 * SR));
  flushMono(bus, Math.round(t * SR), len, o.pan ?? 0, (o.gain ?? 1) * (o.vel ?? 0.5) * 0.5);
}

/** 雑音の高まり（帯域を上げながら大きく）。戻りは end 秒に頂点、そのあと短く消える */
export function noiseSwell(bus, tEnd, o = {}) {
  const length = o.length ?? 3;
  const f0 = o.f0 ?? 300;
  const f1 = o.f1 ?? 2400;
  const tail = o.tail ?? 0.06;
  const len = Math.round((length + tail) * SR);
  SCR_L.fill(0, 0, len);
  SCR_R.fill(0, 0, len);
  const r = rng(o.seed ?? 99);
  const sl = new SVF(f0, 0.8);
  const sr = new SVF(f0, 0.8);
  for (let i = 0; i < len; i++) {
    const x = Math.min(1, i / (length * SR));
    if ((i & 31) === 0) {
      const f = f0 * (f1 / f0) ** x;
      sl.set(f, 0.8);
      sr.set(f, 0.8);
    }
    sl.tick(r() * 2 - 1);
    sr.tick(r() * 2 - 1);
    const g = i < length * SR ? x ** 2.2 : Math.exp(-(i - length * SR) / (0.012 * SR));
    SCR_L[i] = sl.band * g;
    SCR_R[i] = sr.band * g;
  }
  flushStereo(bus, Math.round((tEnd - length) * SR), len, (o.gain ?? 1) * 0.5);
}
