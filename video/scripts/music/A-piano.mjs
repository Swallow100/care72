// 案 A「澄んだピアノ」: フェルトのピアノの 8 分の刻みと弦のパッド。変ホ長調（発災時はハ短調）。90.6 BPM、4 拍。
// 題名 32.6 秒とロゴ 178.3 秒が小節の頭。3 つ（38〜46 秒）は 1 小節に 1 つの和音。強調の窓では刻みを止めてパッドだけにする。
import { Stereo, Timeline, markWindows, notes, rng } from "./lib/core.mjs";
import { reverb } from "./lib/dsp.mjs";
import * as I from "./lib/inst.mjs";
import { Mix } from "./lib/mixer.mjs";

export const meta = { id: "A-piano", title: "澄んだピアノ（ドキュメンタリー風）" };

// 220 拍で 32.6 → 178.3（55 小節）
const BPM = 60 / (145.7 / 220);

const form = [
  ["intro1", [4, 4, 4, 4, 4]],
  ["intro2", [4, 4, 4, 4]],
  ["rise", [4, 4, 4]],
  ["title", [4, 4]],
  ["pillars", [4, 4, 4]],
  ["plan", [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2]],
  ["drill", [4, 4, 4, 4, 4]],
  ["call", [4, 6]],
  ["drill2", [4, 4, 4, 4, 4, 2]],
  ["dis1", [4, 4, 3]],
  ["emph2", [4, 5]],
  ["dis2", [4, 3]],
  ["emph3", [4, 3]],
  ["dis3a", [4, 4, 4, 4]],
  ["dis3b", [4, 4]],
  ["receive", [5]],
  ["claude", [4, 4, 4, 4, 4]],
  ["numbers", [4, 4, 4, 2]],
  ["closing", [4, 5]],
  ["end", [4]],
];

// 和音: bass（低音）、arp（8 分の 8 つ）、pad（弦）
const CH = {
  Cm9: { bass: "C2", arp: "C3 G3 D4 Eb4 G4 Eb4 D4 G3", pad: "C3 G3 D4 Eb4" },
  Cm: { bass: "C2", arp: "C3 G3 C4 Eb4 G4 Eb4 C4 G3", pad: "C3 G3 C4 Eb4" },
  Ab9: { bass: "Ab1", arp: "Ab2 Eb3 Bb3 C4 G4 C4 Bb3 Eb3", pad: "Ab2 Eb3 G3 C4" },
  Ab7: { bass: "Ab1", arp: "Ab2 Eb3 G3 C4 Eb4 C4 G3 Eb3", pad: "Ab2 Eb3 G3 C4" },
  AbLyd: { bass: "Eb2", arp: "Eb3 Ab3 Bb3 C4 D4 C4 Bb3 Ab3", pad: "Eb3 Ab3 C4 D4" },
  Eb9: { bass: "Eb2", arp: "Eb3 Bb3 F4 G4 Bb4 G4 F4 Bb3", pad: "Eb3 Bb3 D4 G4" },
  Eb7: { bass: "Eb2", arp: "Eb3 Bb3 D4 G4 Bb4 G4 D4 Bb3", pad: "Eb3 Bb3 D4 G4" },
  EbG: { bass: "G1", arp: "G2 Eb3 Bb3 D4 F4 D4 Bb3 Eb3", pad: "G2 Eb3 Bb3 D4" },
  Bbs: { bass: "Bb1", arp: "Bb2 F3 C4 Eb4 F4 Eb4 C4 F3", pad: "Bb2 F3 C4 Eb4" },
  Bb: { bass: "Bb1", arp: "Bb2 F3 C4 D4 F4 D4 C4 F3", pad: "Bb2 F3 C4 D4" },
  Fm9: { bass: "F1", arp: "F2 C3 Ab3 Eb4 G4 Eb4 Ab3 C3", pad: "F2 C3 Ab3 Eb4" },
  Fm7: { bass: "F1", arp: "F2 C3 Eb3 Ab3 C4 Ab3 Eb3 C3", pad: "F2 C3 Eb3 Ab3" },
  Gm7: { bass: "G1", arp: "G2 D3 Bb3 D4 F4 D4 Bb3 D3", pad: "G2 D3 F3 Bb3" },
  Gsus: { bass: "G1", arp: "G2 D3 C4 D4 G4 D4 C4 D3", pad: "G2 D3 C4 F4" },
  G: { bass: "G1", arp: "G2 D3 B3 D4 G4 D4 B3 D3", pad: "G2 D3 B3 F4" },
  AbC: { bass: "C2", arp: "C3 Ab3 Eb4 G4 C4 G4 Eb4 Ab3", pad: "C3 Ab3 Eb4 G4" },
  BbC: { bass: "C2", arp: "C3 Bb3 D4 F4 Bb3 F4 D4 Bb3", pad: "C3 Bb3 D4 F4" },
  FmC: { bass: "C2", arp: "C3 Ab3 C4 F4 Ab3 F4 C4 Ab3", pad: "C3 F3 Ab3 C4" },
};

export function compose() {
  const tl = new Timeline({ bpm: BPM, anchor: 32.6, anchorSection: "title", form });
  const beat = tl.beat;
  const r = rng(2026);
  const jit = (s = 0.006) => (r() - 0.5) * 2 * s;
  const vj = (v, s = 0.04) => Math.max(0.05, v + (r() - 0.5) * 2 * s);
  const T = (sec, b = 0) => tl.at(sec, b);

  // 和音の並び: [区間, 頭からの拍, 長さ（拍）, 和音, 強さ, 刻み（8: 8 分、16: 16 分、4: 4 分、0: なし）]
  const S = [];
  const add = (sec, b0, len, ch, vel, dens = 8, extra = {}) => S.push({ sec, b0, len, ch: CH[ch], name: ch, vel, dens, ...extra });
  // 問いかけ（ピアノだけ、まばら）
  add("intro1", 0, 4, "Cm9", 0.4, 4);
  add("intro1", 4, 4, "Ab7", 0.41, 4);
  add("intro1", 8, 4, "Eb9", 0.42, 4);
  add("intro1", 12, 4, "Fm9", 0.43, 4);
  add("intro1", 16, 4, "Gsus", 0.44, 4);
  add("intro2", 0, 4, "Cm9", 0.36, 8);
  add("intro2", 4, 4, "Ab9", 0.37, 8);
  add("intro2", 8, 4, "Fm9", 0.38, 8);
  add("intro2", 12, 4, "Gsus", 0.39, 8);
  // 盛り上がり（8 分 → 16 分）
  add("rise", 0, 4, "Ab9", 0.4, 8);
  add("rise", 4, 4, "Bbs", 0.46, 8);
  add("rise", 8, 3.5, "Bbs", 0.52, 16);
  // 題名（大きな和音のあと、静かに刻む）
  add("title", 0, 8, "Eb9", 0.36, 8, { hit: true });
  // 3 つ: 1 小節に 1 つ（A♭ → B♭ → Cm、低音が上がる）
  add("pillars", 0, 4, "Ab9", 0.42, 8, { accent: true });
  add("pillars", 4, 4, "Bbs", 0.42, 8, { accent: true });
  add("pillars", 8, 4, "Cm9", 0.42, 8, { accent: true });
  // 計画（2 小節に 1 つの和音、E♭ の持続から）
  add("plan", 0, 8, "Eb9", 0.4);
  add("plan", 8, 8, "AbLyd", 0.4);
  add("plan", 16, 8, "Cm9", 0.41);
  add("plan", 24, 8, "Ab9", 0.42);
  add("plan", 32, 4, "Bbs", 0.43);
  add("plan", 36, 4, "Bb", 0.43);
  add("plan", 40, 2, "Bbs", 0.38, 4);
  // 訓練（1 小節に 1 つ、拍を足す）
  add("drill", 0, 4, "Cm9", 0.44);
  add("drill", 4, 4, "Ab9", 0.44);
  add("drill", 8, 4, "EbG", 0.45);
  add("drill", 12, 4, "Fm9", 0.46);
  add("drill", 16, 4, "Bbs", 0.47);
  // 着信: 落ち着く和音で止まる（刻みなし、パッドだけ）
  add("call", 0, 10, "Eb9", 0.34, 0, { breath: true });
  // 訓練の続き（厚く、低い線を足す）
  add("drill2", 0, 4, "Ab9", 0.44);
  add("drill2", 4, 4, "EbG", 0.45);
  add("drill2", 8, 4, "Fm9", 0.46);
  add("drill2", 12, 4, "Cm9", 0.47);
  add("drill2", 16, 4, "Ab9", 0.48);
  add("drill2", 20, 2, "Bbs", 0.4, 0, { breath: true });
  // 発災時（ハ短調、低い刻み）
  add("dis1", 0, 4, "Cm", 0.46, 8, { dark: true });
  add("dis1", 4, 4, "AbC", 0.47, 8, { dark: true });
  add("dis1", 8, 3, "FmC", 0.48, 8, { dark: true });
  add("emph2", 0, 9, "Cm9", 0.3, 0, { breath: true, dark: true });
  add("dis2", 0, 4, "AbC", 0.47, 8, { dark: true });
  add("dis2", 4, 3, "BbC", 0.48, 8, { dark: true });
  add("emph3", 0, 7, "FmC", 0.3, 0, { breath: true, dark: true });
  add("dis3a", 0, 4, "Cm9", 0.46, 8, { dark: true });
  add("dis3a", 4, 4, "Ab9", 0.47, 8, { dark: true });
  add("dis3a", 8, 4, "Fm9", 0.48, 8, { dark: true });
  add("dis3a", 12, 2, "Gsus", 0.49, 8, { dark: true });
  add("dis3a", 14, 2, "G", 0.5, 8, { dark: true });
  // 声のない所（141〜143 秒）で明るく
  add("dis3b", 0, 4, "Ab9", 0.46, 8, { lift: true });
  add("dis3b", 4, 4, "Bbs", 0.47, 8, { lift: true });
  // 受入: 長調に戻る（147.9〜150 秒は声がない）
  add("receive", 0, 5, "Eb9", 0.5, 8, { accent: true });
  // 作り方（軽く、短く切る）
  add("claude", 0, 4, "Eb7", 0.46, 8, { light: true });
  add("claude", 4, 4, "Fm7", 0.46, 8, { light: true });
  add("claude", 8, 4, "Gm7", 0.47, 8, { light: true });
  add("claude", 12, 4, "Ab7", 0.48, 8, { light: true });
  add("claude", 16, 4, "Bbs", 0.48, 8, { light: true });
  // 数字と声（温かく）
  add("numbers", 0, 4, "Ab9", 0.4, 8, { warm: true });
  add("numbers", 4, 4, "EbG", 0.4, 8, { warm: true });
  add("numbers", 8, 4, "Fm9", 0.41, 8, { warm: true });
  add("numbers", 12, 2, "Bbs", 0.4, 4, { warm: true });
  // 締め（広げて、ロゴで E♭）
  add("closing", 0, 4, "Ab9", 0.42, 8, { warm: true });
  add("closing", 4, 3, "Bbs", 0.42, 8, { warm: true });
  add("closing", 7, 2, "Bb", 0.4, 4, { warm: true });
  add("end", 0, 2.6, "Eb9", 0.45, 0, { final: true });

  for (const s of S) {
    s.t0 = T(s.sec, s.b0);
    s.t1 = T(s.sec, s.b0 + s.len);
  }
  // 強調の窓: 窓の中のパッドは窓の頭の後の拍から窓の終わりの 0.35 秒前まで（窓の端で音楽を谷にする）。窓の前の和音は早めに消す
  markWindows(tl, S, (s) => s.breath);

  const mix = new Mix({
    sends: {
      hall: { type: "reverb", rt60: 2.9, size: 1.15, damp: 0.42, pre: 0.025, hp: 180, lp: 6500, ret: -3.5 },
    },
  });

  // ピアノ（刻みと和音）
  mix.part("piano", { gain: 0, eq: [["lowshelf", 220, 1, 1.5], ["peak", 3200, 0.8, -3], ["highshelf", 7000, 1, -2]], sends: { hall: -7 } }, (b) => {
    for (const s of S) {
      const arp = notes(s.ch.arp);
      const pedalUp = s.preHold ? s.cut : s.t1 + 0.07;
      const felt = s.light ? 0.45 : 0.62;
      if (s.hit || s.accent || s.final) {
        // 頭の和音（低音を 2 オクターブ、上は 4 音）
        const bassM = notes(s.ch.bass)[0];
        const v = s.final ? 0.6 : s.hit ? 0.7 : s.accent ? 0.6 : 0.5;
        I.piano(b, s.t0, bassM, { vel: v, hold: pedalUp - s.t0, felt });
        I.piano(b, s.t0 + 0.004, bassM + 12, { vel: v * 0.85, hold: pedalUp - s.t0, felt });
        for (const [k, m] of notes(s.ch.pad).entries()) I.piano(b, s.t0 + 0.012 + k * 0.006, m + 12, { vel: v * 0.62, hold: pedalUp - s.t0, felt });
        if (s.final) {
          // ロゴ: 上に F を足して、ゆっくり消える
          I.piano(b, s.t0 + 0.33, notes("F4")[0], { vel: 0.3, hold: 1.6, felt: 0.7 });
          I.piano(b, s.t0 + 0.66, notes("Bb4")[0], { vel: 0.26, hold: 1.3, felt: 0.75 });
        }
      } else if (!s.breath && s.dens > 0) {
        // 低音（和音の頭）
        const bassM = notes(s.ch.bass)[0];
        // 発災時は下の 8 分の刻みが低音を受け持つので、ここは 1 オクターブ上だけ
        I.piano(b, s.t0 + jit(0.004), bassM + 12, { vel: vj(s.vel + (s.dark ? 0 : 0.05)), hold: pedalUp - s.t0, felt });
      }
      if (s.breath) {
        // 息をつく所: 和音を 1 度だけ柔らかく。強調の窓なら、窓の頭より前にダンパーで止める
        const v = 0.3;
        const room = s.win ? s.win[0] - s.t0 - 0.15 : s.t1 - s.t0;
        if (room < 0.25) continue;
        const hold = Math.min(room, s.win ? 0.6 : room);
        I.piano(b, s.t0, notes(s.ch.bass)[0] + 12, { vel: v, hold, felt: 0.75 });
        for (const [k, m] of notes(s.ch.pad).entries()) I.piano(b, s.t0 + 0.02 + k * 0.03, m + (s.dark ? 0 : 12), { vel: v * 0.7, hold, felt: 0.75 });
        continue;
      }
      if (s.dens === 0) continue;
      // 刻み
      const step = s.dens === 16 ? 0.25 : s.dens === 4 ? 1 : 0.5;
      const count = Math.floor(s.len / step + 1e-6);
      for (let k = 0; k < count; k++) {
        const bt = s.b0 + k * step;
        const t = T(s.sec, bt) + jit();
        if (t >= s.cut - 0.05) break; // 窓の前は早めに止める
        // 刻みの形: 訓練は 3+3+2 のまとまり、作り方は 3 度ずつ上がる分散、ほかは上がって下がる
        const drillish = s.sec === "drill" || s.sec === "drill2";
        const shape = drillish ? [0, 4, 6, 1, 4, 7, 2, 5] : s.light ? [0, 2, 1, 3, 2, 4, 3, 5] : [0, 1, 2, 3, 4, 5, 6, 7];
        const idx = s.dens === 4 ? [1, 3, 4, 5][k % 4] : shape[k % 8];
        let m = arp[idx];
        if (s.dens === 16) m = arp[(k * 3) % 8] + (k >= 8 ? 12 : 0);
        if (s.lift && k % 8 >= 3 && k % 8 <= 5) m += 12;
        // 和音の頭で低音と同じ音になるなら省く（同じ音が重なって頭だけ大きくなる）
        if (k === 0 && !s.hit && !s.accent && m === notes(s.ch.bass)[0] + 12) continue;
        const onBeat = Math.abs(bt - Math.round(bt)) < 1e-6;
        const strong = drillish ? [0, 3, 6].includes(k % 8) : onBeat;
        let v = s.vel * (strong ? 1 : 0.84);
        if (s.dens === 16) v = s.vel * (0.68 + 0.32 * (k / count));
        if (s.light) v *= 0.95;
        const hold = s.light ? step * beat * 0.55 : pedalUp - t;
        I.piano(b, t, m, { vel: vj(v, 0.03), hold, felt: s.light ? 0.4 : felt });
      }
      // 発災時の低い刻み（左手、8 分の同じ音）
      if (s.dark) {
        const low = notes(s.ch.bass)[0];
        for (let k = 0; k < Math.floor(s.len / 0.5 + 1e-6); k++) {
          const t = T(s.sec, s.b0 + k * 0.5);
          if (t >= s.cut - 0.05) break;
          I.piano(b, t, k % 4 === 2 ? low + 7 : low, { vel: vj(0.3 + (k % 2 ? 0 : 0.05), 0.02), hold: 0.5 * beat * 0.8, felt: 0.7 });
        }
      }
    }
  });

  // 弦のパッド（3 本ずつ、ゆっくり立ち上がる）
  mix.part("strings", { gain: -7, eq: [["hp", 70, 0.7], ["peak", 350, 0.9, 2], ["peak", 2600, 0.7, -4]], sends: { hall: -2 } }, (b) => {
    for (const s of S) {
      if (s.sec === "intro1" && s.b0 < 8) continue;
      const pad = notes(s.ch.pad);
      const dur = s.t1 - s.t0;
      const isRise = s.sec === "rise";
      const v = s.breath ? 0.42 : s.hit || s.final ? 0.75 : isRise ? 0.5 + 0.12 * (s.b0 / 4) : s.sec === "intro1" ? 0.3 : s.sec === "intro2" ? 0.42 : s.warm ? 0.62 : s.light ? 0.46 : 0.52;
      // 題名の前の最後の和音は短く消す（題名の前に息をつく）。強調の窓の前の和音も早めに消す
      const beforeTitle = isRise && s.b0 === 8;
      const t0 = s.win ? s.span.from : s.t0 - 0.02;
      const len = s.win ? s.span.to - s.span.from : s.preHold ? s.cut - s.t0 - 0.03 : dur + (beforeTitle ? -0.05 : 0.05);
      for (const m of pad) {
        I.ensemble(b, t0, m, {
          dur: len,
          attack: isRise ? dur * 0.9 : s.hit ? 0.25 : s.breath ? 0.6 : 0.7,
          release: beforeTitle ? 0.12 : s.win || s.preHold ? 0.3 : s.final ? 1.2 : 1.1,
          vel: v,
          cutoff: s.dark ? 1200 : s.warm ? 1700 : 1500,
          voices: 3,
          detune: 9,
          vib: 5,
          wave: "mix",
        });
      }
      // 低い線（チェロ）: 訓練の続き・数字と声・締め
      if (s.sec === "drill2" || s.warm) {
        const line = notes(s.ch.bass)[0] + 12;
        I.ensemble(b, s.t0, line, { dur: dur, attack: 0.35, release: 0.9, vel: 0.5, cutoff: 900, voices: 2, detune: 5, vib: 7, wave: "saw" });
      }
    }
  });

  // 低音（正弦。和音の頭で）
  mix.part("bass", { gain: -6, eq: [["lp", 220, 0.7]] }, (b) => {
    for (const s of S) {
      if (s.sec === "intro1" && s.b0 < 8) continue;
      // 低音は E♭1（39 Hz）〜 C2（65 Hz）に収める
      let m = notes(s.ch.bass)[0];
      if (m >= 39) m -= 12;
      const dur = s.t1 - s.t0;
      const v = s.breath ? 0.32 : s.hit || s.final ? 0.85 : s.light ? 0.4 : 0.6;
      const beforeTitle = s.sec === "rise" && s.b0 === 8;
      if (s.win) {
        I.bass(b, s.span.from, m, { dur: s.span.to - s.span.from, attack: 0.3, release: 0.25, vel: v, harm: [1, 0.3, 0.1] });
        continue;
      }
      I.bass(b, s.t0, m, { dur: (s.preHold ? s.cut - s.t0 : dur) - 0.05, attack: s.hit ? 0.006 : 0.04, release: beforeTitle || s.preHold ? 0.08 : s.final ? 0.9 : 0.25, vel: v, harm: [1, 0.3, 0.1] });
    }
  });

  // 拍（柔らかいキックとシェイカー）: 訓練・訓練の続き・発災時
  const kicks = [];
  mix.part("pulse", { gain: -9, sends: { hall: -18 } }, (b) => {
    for (const s of S) {
      const on = ["drill", "drill2", "dis1", "dis2", "dis3a", "dis3b"].includes(s.sec) && !s.breath;
      if (!on) continue;
      for (let k = 0; k < s.len; k++) {
        const bt = s.b0 + k;
        const t = T(s.sec, bt);
        if (s.preHold && t >= s.cut - 0.45) break; // 窓の前はキックの余韻が窓の頭に残らないように
        const barPos = bt % 4;
        if (s.dark || s.lift) {
          // 心臓のような 2 つ（1 拍目と 3 拍目）
          if (barPos === 0 || barPos === 2) {
            I.kick(b, t, { vel: 0.62, f0: 44, f1: 90, decay: 0.28, click: 0.02 });
            I.kick(b, t + beat * 0.36, { vel: 0.36, f0: 44, f1: 80, decay: 0.22, click: 0.0 });
            kicks.push(t);
          }
        } else if (barPos === 0 || barPos === 2) {
          I.kick(b, t, { vel: 0.6, f0: 46, f1: 95, decay: 0.3, click: 0.02 });
          kicks.push(t);
        }
        for (let j = 0; j < 4; j++) {
          const tt = t + j * beat * 0.25;
          if (tt >= s.cut - 0.05) break;
          I.shaker(b, tt + jit(0.003), { vel: j === 2 ? 0.34 : j === 0 ? 0.22 : 0.16, decay: 0.045 });
        }
      }
    }
  });

  // 大きな山（題名・発災時・受入・ロゴ）: 低い響きとティンパニ
  const hits = [
    { name: "題名", at: T("title") },
    { name: "3 つの 1（計画）", at: T("pillars", 0) },
    { name: "3 つの 2（訓練）", at: T("pillars", 4) },
    { name: "3 つの 3（発災時）", at: T("pillars", 8) },
    { name: "発災時", at: T("dis1") },
    { name: "受入（長調に戻る）", at: T("receive") },
    { name: "ロゴ", at: T("end") },
  ];
  mix.part("hits", { gain: -5, sends: { hall: -6 } }, (b) => {
    I.boom(b, T("title"), { vel: 0.72, f0: 38, f1: 66, decay: 2.4 });
    I.timpani(b, T("title"), notes("Eb2")[0], { vel: 0.62, decay: 2.6 });
    for (const k of [0, 4, 8]) I.timpani(b, T("pillars", k), notes(["Ab2", "Bb2", "C3"][k / 4])[0], { vel: 0.42, decay: 1.6 });
    I.timpani(b, T("dis1"), notes("C2")[0], { vel: 0.75, decay: 2.2 });
    I.boom(b, T("dis1"), { vel: 0.6, f0: 34, f1: 58, decay: 1.6 });
    I.timpani(b, T("receive"), notes("Eb2")[0], { vel: 0.5, decay: 2 });
    I.boom(b, T("end"), { vel: 0.5, f0: 36, f1: 55, decay: 1.2 });
  });

  // 題名の前の逆回しの響き（題名の和音を残響ごと逆に）。32.6 の 0.33 秒前で切る
  mix.part("swell", { gain: -4 }, (b) => {
    const len = 3.2;
    const tmp = new Stereo(Math.round(len * 48000));
    for (const m of notes("Eb2 Bb2 G3 Bb3 F4 G4")) I.piano(tmp, 0.02, m, { vel: 0.7, hold: 3, felt: 0.5 });
    const wet = reverb(tmp, { rt60: 2.5, pre: 0.01 });
    const end = T("title") - beat * 0.5;
    const n = tmp.n;
    const s0 = Math.round((end - len) * 48000);
    for (let i = 0; i < n; i++) {
      const j = n - 1 - i;
      const fade = Math.min(1, i / (0.6 * 48000)) * Math.min(1, (n - i) / (0.012 * 48000));
      b.L[s0 + i] += (tmp.L[j] * 0.5 + wet.L[j]) * fade;
      b.R[s0 + i] += (tmp.R[j] * 0.5 + wet.R[j]) * fade;
    }
  });

  const master = mix.finish();
  const sections = [...tl.sections.values()].map((s) => ({ name: s.name, at: tl.t(s.beat) })).filter((s) => s.at < 180);
  const holds = ["call", "emph2", "emph3"].map((n) => ({ name: { call: "着信", emph2: "並び替え", emph3: "録音" }[n], from: T(n), to: T(n) + tl.sec(n).beats * beat }));
  return {
    master,
    timeline: tl,
    log: mix.log,
    sections,
    hits,
    holds,
    beatsPerBar: 4,
    anchors: {
      問いかけ: T("intro1"),
      気づき: T("rise"),
      題名: T("title"),
      "3 つ": T("pillars"),
      道具: T("plan"),
      訓練: T("drill"),
      着信: T("call"),
      着信の後: T("drill2"),
      発災時: T("dis1"),
      並び替え: T("emph2"),
      並び替えの後: T("dis2"),
      録音: T("emph3"),
      録音の後: T("dis3a"),
      作り方: T("claude"),
      数字と声: T("numbers"),
      締め: T("closing"),
      ロゴ: T("end"),
      終わり: 179.9,
    },
    masterOpts: { fadeFrom: 179.1, end: 179.9 },
  };
}
