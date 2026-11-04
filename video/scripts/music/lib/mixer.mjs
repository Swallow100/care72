// まとめ（ミキサー）。パートを 1 つずつ作って加工し、まとめと送り（残響・遅れ）に足してから捨てる（メモリを抑える）。
import { SR, Stereo, dbToGain } from "./core.mjs";
import { automate, chorus, eqStereo, pingpong, pump, reverb } from "./dsp.mjs";

export class Mix {
  /**
   * sends: { 名前: { type: "reverb" | "echo", ret: 戻りの dB, to?: { 別の送り: dB }, ...加工の設定 } }
   */
  constructor({ sends = {} } = {}) {
    this.master = new Stereo();
    this.sendOpts = sends;
    this.sendBufs = {};
    this.log = [];
  }
  sendBuf(name) {
    if (!this.sendOpts[name]) throw new Error(`送りが無い: ${name}`);
    if (!this.sendBufs[name]) this.sendBufs[name] = new Stereo();
    return this.sendBufs[name];
  }
  /**
   * パート 1 つ。fn(bus) で音を足す。opts:
   *   gain（dB）、eq（[[type, f, q, gain]]）、chorus、pump（{ times, depth, release }）、auto（[[秒, dB]]）、
   *   width（左右の広さ、1 がそのまま）、sends（{ 送り: dB }）
   */
  part(name, opts, fn) {
    const t0 = Date.now();
    const bus = new Stereo();
    fn(bus);
    const t1 = Date.now();
    if (opts.eq) eqStereo(bus, opts.eq);
    if (opts.chorus) chorus(bus, opts.chorus);
    if (opts.pump) pump(bus, opts.pump.times, opts.pump);
    if (opts.auto) automate(bus, opts.auto);
    if (opts.width !== undefined && opts.width !== 1) {
      const w = opts.width;
      for (let i = 0; i < bus.n; i++) {
        const m = (bus.L[i] + bus.R[i]) * 0.5;
        const s = (bus.L[i] - bus.R[i]) * 0.5 * w;
        bus.L[i] = m + s;
        bus.R[i] = m - s;
      }
    }
    const g = dbToGain(opts.gain ?? 0);
    let peak = 0, sum = 0;
    for (let i = 0; i < bus.n; i++) {
      const l = bus.L[i] * g, r = bus.R[i] * g;
      if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error(`${name}: 数でない値（${i / SR} 秒）`);
      this.master.L[i] += l;
      this.master.R[i] += r;
      const a = Math.max(Math.abs(l), Math.abs(r));
      if (a > peak) peak = a;
      sum += l * l + r * r;
    }
    for (const [s, d] of Object.entries(opts.sends ?? {})) {
      const sb = this.sendBuf(s);
      const k = g * dbToGain(d);
      for (let i = 0; i < bus.n; i++) {
        sb.L[i] += bus.L[i] * k;
        sb.R[i] += bus.R[i] * k;
      }
    }
    this.log.push({
      name,
      peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(1),
      rmsDb: +(10 * Math.log10(sum / (2 * bus.n) + 1e-20)).toFixed(1),
      synthSec: (t1 - t0) / 1000,
      mixSec: (Date.now() - t1) / 1000,
    });
    if (process.env.MUSIC_DEBUG) console.log(`  part ${name}: 合成 ${(t1 - t0) / 1000} 秒、加工 ${(Date.now() - t1) / 1000} 秒`);
  }
  /** 送りを加工して戻す（echo を先に。echo の to で残響へも送れる）。まとめを返す */
  finish() {
    const names = Object.keys(this.sendOpts).sort((a, b) => (this.sendOpts[a].type === "echo" ? -1 : 0) - (this.sendOpts[b].type === "echo" ? -1 : 0));
    for (const name of names) {
      const o = this.sendOpts[name];
      const inp = this.sendBufs[name];
      if (!inp) continue;
      const t0 = Date.now();
      const wet = o.type === "echo" ? pingpong(inp, o) : reverb(inp, o);
      if (process.env.MUSIC_DEBUG) console.log(`  send ${name}: ${(Date.now() - t0) / 1000} 秒`);
      if (o.eq) eqStereo(wet, o.eq);
      const k = dbToGain(o.ret ?? 0);
      for (let i = 0; i < wet.n; i++) {
        this.master.L[i] += wet.L[i] * k;
        this.master.R[i] += wet.R[i] * k;
      }
      for (const [to, d] of Object.entries(o.to ?? {})) {
        const sb = this.sendBuf(to);
        const kk = k * dbToGain(d);
        for (let i = 0; i < wet.n; i++) {
          sb.L[i] += wet.L[i] * kk;
          sb.R[i] += wet.R[i] * kk;
        }
      }
      delete this.sendBufs[name];
    }
    return this.master;
  }
}

/**
 * まとめの仕上げ: 25 Hz より下を切る、声の帯域（2〜3 kHz の広い山）を 3 dB 下げる、頭と終わりを整える。
 * end は音が消えきる秒（そこから後は 0）。fadeFrom から end まで下げる
 */
export function masterChain(st, { pocketDb = -3, pocketF = 2500, pocketQ = 0.6, air = 0, fadeFrom = 179.2, end = 179.9 } = {}) {
  eqStereo(st, [
    ["hp", 25, 0.707],
    ["hp", 25, 0.707],
    ["peak", pocketF, pocketQ, pocketDb],
    ["highshelf", 11000, 1, air],
  ]);
  const a = Math.round(0.05 * SR);
  for (let i = 0; i < a; i++) {
    const x = Math.sin((0.5 * Math.PI * i) / a) ** 2;
    st.L[i] *= x;
    st.R[i] *= x;
  }
  const f0 = Math.round(fadeFrom * SR), f1 = Math.round(end * SR);
  for (let i = f0; i < st.n; i++) {
    const x = i >= f1 ? 0 : Math.cos((0.5 * Math.PI * (i - f0)) / (f1 - f0)) ** 2;
    st.L[i] *= x;
    st.R[i] *= x;
  }
}

export { automate };
