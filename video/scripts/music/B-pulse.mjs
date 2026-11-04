// 案 B「刻む時計」: 時計の刻み（4.5 kHz より上の短い音）を芯にした電子音。拍がはっきりしていて音ハメしやすい。
// ヘ短調 → 変イ長調。120.2 BPM、4 拍（3 つの所だけ 5・5・6 拍の小節で、2.5 秒ごとの山）。
// 頭は 1 秒に 1 つの刻み（本物の時計の速さ）、盛り上がるほど細かくなり、ロゴで最後の 1 つ。
import { Timeline, WINDOWS, markWindows, notes, rng } from "./lib/core.mjs";
import * as I from "./lib/inst.mjs";
import { Mix } from "./lib/mixer.mjs";

export const meta = { id: "B-pulse", title: "刻む時計（拍のはっきりした電子音）" };

const BPM = 60 / (145.7 / 292); // 73 小節で 32.6 → 178.3

const form = [
  ["intro1", [4, 4, 4, 4, 4, 4]],
  ["intro2", [4, 4, 4, 4, 4, 4]],
  ["rise", [4, 4, 4, 4]],
  ["title", [4, 4, 3]],
  ["pillars", [5, 5, 6]],
  ["plan", Array(14).fill(4)],
  ["drill", Array(7).fill(4)],
  ["call", [4, 7]],
  ["drill2", [4, 4, 4, 4, 4, 4, 4, 1]],
  ["dis1", [4, 4, 4, 4]],
  ["emph2", [4, 7]],
  ["dis2", [4, 4, 1]],
  ["emph3", [4, 5]],
  ["dis3a", [4, 4, 4, 4, 4, 3]],
  ["dis3b", [4, 4]],
  ["receive", [4, 4]],
  ["claude", [4, 4, 4, 4, 4, 4, 2]],
  ["numbers", [4, 4, 4, 4, 3]],
  ["closing", [4, 4, 4]],
  ["end", [4]],
];

const CH = {
  Fm9: { bass: "F1", pad: "F2 C3 Ab3 Eb4 G4", arp: "F3 Ab3 C4 Eb4 G4 Eb4 C4 Ab3" },
  Fm: { bass: "F1", pad: "F2 C3 F3 Ab3", arp: "F3 Ab3 C4 F4 Ab4 F4 C4 Ab3" },
  Db9: { bass: "Db2", pad: "Db3 Ab3 C4 Eb4 F4", arp: "Db3 Ab3 C4 Eb4 F4 Eb4 C4 Ab3" },
  Db7: { bass: "Db2", pad: "Db3 Ab3 C4 F4", arp: "Db3 F3 Ab3 C4 F4 C4 Ab3 F3" },
  Ab9: { bass: "Ab1", pad: "Ab2 Eb3 G3 Bb3 C4", arp: "Ab3 C4 Eb4 G4 Bb4 G4 Eb4 C4" },
  Ab7: { bass: "Ab1", pad: "Ab2 Eb3 G3 C4", arp: "Ab3 C4 Eb4 G4 C5 G4 Eb4 C4" },
  AbC: { bass: "C2", pad: "C3 Ab3 Eb4 G4", arp: "C4 Eb4 Ab4 G4 Eb4 C4 Ab3 Eb4" },
  Cm7: { bass: "C2", pad: "C3 G3 Bb3 Eb4", arp: "C4 Eb4 G4 Bb4 C5 Bb4 G4 Eb4" },
  Bbm9: { bass: "Bb1", pad: "Bb2 F3 Ab3 Db4 C4", arp: "Bb3 Db4 F4 Ab4 C5 Ab4 F4 Db4" },
  Bbm7: { bass: "Bb1", pad: "Bb2 F3 Ab3 Db4", arp: "Bb3 Db4 F4 Ab4 Bb4 Ab4 F4 Db4" },
  Ebs: { bass: "Eb2", pad: "Eb3 Ab3 Bb3 F4", arp: "Eb3 Ab3 Bb3 F4 Ab4 F4 Bb3 Ab3" },
  Eb: { bass: "Eb2", pad: "Eb3 G3 Bb3 F4", arp: "Eb3 G3 Bb3 F4 G4 F4 Bb3 G3" },
  GbF: { bass: "F1", pad: "F2 Gb3 Bb3 Db4", arp: "F3 Gb3 Bb3 Db4 F4 Db4 Bb3 Gb3" },
  BbmF: { bass: "F1", pad: "F2 Bb2 Db3 F3 Ab3", arp: "F3 Bb3 Db4 F4 Ab4 F4 Db4 Bb3" },
  C7s: { bass: "C2", pad: "C3 G3 Bb3 F4", arp: "C4 F4 G4 Bb4 C5 Bb4 G4 F4" },
  C7: { bass: "C2", pad: "C3 G3 Bb3 E4", arp: "C4 E4 G4 Bb4 C5 Bb4 G4 E4" },
};

export function compose() {
  const tl = new Timeline({ bpm: BPM, anchor: 32.6, anchorSection: "title", form });
  const beat = tl.beat;
  const T = (sec, b = 0) => tl.at(sec, b);
  const r = rng(72);

  // [区間, 頭の拍, 長さ, 和音, 設定]
  const S = [];
  const add = (sec, b0, len, ch, o = {}) => S.push({ sec, b0, len, ch: CH[ch], name: ch, ...o });
  for (let k = 0; k < 6; k++) add("intro1", k * 4, 4, k % 4 < 2 ? "Fm9" : "Db9", { lvl: 0 });
  for (let k = 0; k < 6; k++) add("intro2", k * 4, 4, ["Fm9", "Fm9", "Db9", "Db9", "Bbm9", "C7s"][k], { lvl: 1 });
  add("rise", 0, 4, "Db9", { lvl: 2 });
  add("rise", 4, 4, "Ebs", { lvl: 2 });
  add("rise", 8, 4, "Ebs", { lvl: 3 });
  add("rise", 12, 3.5, "Eb", { lvl: 3, beforeTitle: true });
  add("title", 0, 11, "Ab9", { lvl: 2, hit: true });
  add("pillars", 0, 5, "Ab9", { lvl: 3, accent: true });
  add("pillars", 5, 5, "Fm9", { lvl: 3, accent: true });
  add("pillars", 10, 6, "Db9", { lvl: 3, accent: true });
  ["Ab9", "Cm7", "Db9", "Bbm9", "AbC", "Db9", "Ebs"].forEach((c, k) => add("plan", k * 8, 8, c, { lvl: 4 }));
  ["Fm9", "Db9", "Ab9", "Ebs", "Fm9", "Db9", "Ebs"].forEach((c, k) => add("drill", k * 4, 4, c, { lvl: 5 }));
  add("call", 0, 11, "Ab9", { lvl: 1, hold: true });
  ["Db9", "Ebs", "Fm9", "AbC", "Db9", "Ebs", "Fm9"].forEach((c, k) => add("drill2", k * 4, 4, c, { lvl: 6 }));
  add("drill2", 28, 1, "Eb", { lvl: 2, stop: true });
  ["Fm", "GbF", "Fm", "BbmF"].forEach((c, k) => add("dis1", k * 4, 4, c, { lvl: 7, dark: true }));
  add("emph2", 0, 11, "Fm9", { lvl: 1, hold: true, dark: true });
  add("dis2", 0, 4, "GbF", { lvl: 7, dark: true });
  add("dis2", 4, 5, "BbmF", { lvl: 7, dark: true });
  add("emph3", 0, 9, "Fm9", { lvl: 1, hold: true, dark: true });
  ["Fm9", "Db9", "Bbm9", "C7s", "C7", "Fm9"].forEach((c, k) => add("dis3a", k * 4, k === 5 ? 3 : 4, c, { lvl: 7, dark: true }));
  add("dis3b", 0, 4, "Db9", { lvl: 6, lift: true });
  add("dis3b", 4, 4, "Ebs", { lvl: 6, lift: true });
  add("receive", 0, 8, "Ab9", { lvl: 4, accent: true, open: true });
  ["Ab7", "Bbm7", "Cm7", "Db7", "Ebs", "Ab9"].forEach((c, k) => add("claude", k * 4, 4, c, { lvl: 4, light: true }));
  add("claude", 24, 2, "Eb", { lvl: 3, light: true });
  ["Db9", "AbC", "Bbm9", "Fm9"].forEach((c, k) => add("numbers", k * 4, 4, c, { lvl: 3, warm: true }));
  add("numbers", 16, 3, "Ebs", { lvl: 3, warm: true });
  add("closing", 0, 4, "Db9", { lvl: 3, warm: true });
  add("closing", 4, 4, "Ebs", { lvl: 3, warm: true });
  add("closing", 8, 4, "Eb", { lvl: 2, warm: true });
  add("end", 0, 3.2, "Ab9", { lvl: 2, final: true });
  for (const s of S) {
    s.t0 = T(s.sec, s.b0);
    s.t1 = T(s.sec, s.b0 + s.len);
  }
  // 強調の窓: 窓の中のパッドは窓の頭の後の拍から窓の終わりの 0.35 秒前まで。窓の前の和音は早めに消す。
  // 戻りは窓の終わりの後の拍（93.5・121.4・130.4 秒）
  markWindows(tl, S, (s) => s.hold);
  const nearEdge = (t) => WINDOWS.some(([a, b2]) => Math.abs(t - a) < 0.15 || Math.abs(t - b2) < 0.15);

  // キックの時刻（パッドと刻みを押し下げるのにも使う）
  const kicks = [];
  const groove = (s) => !s.hold && !s.stop && !s.final && s.lvl >= 4;
  for (const s of S) {
    if (!groove(s) && !s.hit && !s.accent) continue;
    for (let k = 0; k < Math.round(s.len); k++) {
      const bt = s.b0 + k;
      const bar = tl.bars.find((b) => Math.abs(b.beat - (tl.sec(s.sec).beat + bt)) < 1e-6);
      const pos = k; // 和音の頭からの拍
      let on = false;
      if (s.hit || s.accent) on = pos === 0;
      else if (s.light) on = pos % 2 === 0;
      else if (s.warm) on = pos % 4 === 0;
      else if (s.lvl >= 5) on = true;
      else on = pos % 2 === 0;
      if (s.preHold && T(s.sec, bt) >= s.cut - 0.45) break;
      if (on) kicks.push({ t: T(s.sec, bt), v: s.dark ? 0.85 : bar ? 0.8 : 0.72, dark: s.dark });
      if (s.dark && pos % 4 === 3) kicks.push({ t: T(s.sec, bt + 0.5), v: 0.5, dark: true });
    }
  }
  const kickTimes = kicks.map((k) => k.t);

  const mix = new Mix({
    sends: {
      hall: { type: "reverb", rt60: 2.4, size: 1, damp: 0.45, pre: 0.02, hp: 220, lp: 6000, ret: -5 },
      echo: { type: "echo", time: beat * 0.75, feedback: 0.36, lp: 3000, hp: 300, ret: -9, to: { hall: -6 } },
    },
  });

  // 時計の刻み（左右に少し振る。「チク・タク」で高さを変える）
  mix.part("tick", { gain: 1, sends: { hall: -16, echo: -14 } }, (b) => {
    const step = (s) => {
      if (s.final) return 0;
      if (s.sec === "intro1") return 2;
      if (s.sec === "intro2") return 1;
      if (s.sec === "rise") return s.b0 >= 12 ? 0.25 : s.b0 >= 8 ? 0.5 : 1;
      if (s.hit) return 0;
      if (s.hold) return 1;
      if (s.stop) return 0;
      if (s.dark) return 0.25;
      if (s.warm) return s.sec === "closing" ? 1 : 0;
      if (s.lvl >= 5) return 0.5;
      return 0.5;
    };
    for (const s of S) {
      const st = step(s);
      if (!st) continue;
      const n = Math.round(s.len / st);
      for (let k = 0; k < n; k++) {
        const bt = s.b0 + k * st;
        const t = T(s.sec, bt);
        if (t >= s.t1 - 1e-6) break;
        const onBeat = Math.abs(bt - Math.round(bt)) < 1e-6;
        const tock = Math.round(bt / Math.max(st, 1)) % 2 === 1;
        let v = onBeat ? 0.55 : 0.32;
        if (s.sec === "rise") v *= 0.6 + 0.5 * (s.b0 / 12);
        if (s.hold) v = 0.4;
        if (s.dark) v *= onBeat ? 1 : 0.8;
        if (s.sec === "closing") v *= 1 - s.b0 / 14;
        if (nearEdge(t) || t >= s.cut - 0.05) continue; // 窓の端（動画の音量の段）と窓の直前には置かない
        I.tick(b, t, { vel: v, pitch: tock ? 0.84 : 1, pan: tock ? -0.25 : 0.25 });
      }
    }
    // 最後の 1 つ（ロゴ）
    I.tick(b, T("end"), { vel: 0.6, pitch: 1 });
    I.tick(b, T("end") + beat, { vel: 0.3, pitch: 0.84, pan: -0.25 });
  });

  // パッド（キックで押し下げる）
  mix.part("pad", { gain: -7, eq: [["hp", 90, 0.7], ["peak", 2600, 0.7, -4]], chorus: { rate: 0.18, depth: 0.003, mix: 0.4 }, pump: { times: kickTimes, depth: 0.18, release: 0.17 }, sends: { hall: -3 } }, (b) => {
    for (const s of S) {
      const pad = notes(s.ch.pad);
      const dur = s.t1 - s.t0;
      const v = s.hold ? 0.45 : s.hit || s.final ? 0.8 : s.sec === "intro1" ? 0.42 : s.sec === "rise" ? 0.55 + 0.05 * (s.b0 / 4) : 0.58;
      const cutoff = s.dark ? 800 : s.sec.startsWith("intro") ? 700 : s.sec === "rise" ? 900 + 300 * (s.b0 / 4) : s.warm ? 1500 : 1300;
      // 盛り上がりは小節ごとに少しずつ大きく（頭から 0 で始めない）
      const rb = s.b0 / 4;
      const curve = s.sec === "rise" ? [[0, -6 + 2 * rb], [dur, -2 + 2 * rb]] : null;
      const t0 = s.win ? s.span.from : s.t0 - 0.02;
      const len = s.win ? s.span.to - s.span.from : s.preHold ? s.cut - s.t0 - 0.03 : dur + (s.beforeTitle ? -0.06 : 0.03);
      for (const m of pad) {
        I.ensemble(b, t0, m, {
          dur: len,
          attack: s.sec === "rise" ? 0.4 : s.hit ? 0.03 : s.hold ? 0.5 : 0.35,
          curve,
          release: s.beforeTitle ? 0.1 : s.win || s.preHold ? 0.25 : s.final ? 1.4 : 0.6,
          vel: v,
          cutoff,
          q: 0.75,
          voices: 3,
          detune: 16,
          vib: 2,
          vibRate: 0.4,
          wave: "mix",
          width: 0.9,
        });
      }
    }
  });

  // 16 分の刻み（はじく音。切れ目は低め、声の帯域を空ける）
  mix.part("arp", { gain: -10, eq: [["hp", 180, 0.7], ["peak", 2500, 0.8, -6], ["lp", 5000, 0.7]], pump: { times: kickTimes, depth: 0.12, release: 0.14 }, sends: { echo: -6, hall: -12 } }, (b) => {
    for (const s of S) {
      if (s.hold || s.stop || s.final || s.sec === "intro1" || s.hit) continue;
      const arp = notes(s.ch.arp);
      const step = s.sec === "intro2" ? 0.5 : s.warm ? 0.5 : 0.25;
      const n = Math.round(s.len / step);
      for (let k = 0; k < n; k++) {
        const bt = s.b0 + k * step;
        const t = T(s.sec, bt);
        if (t >= s.cut - 0.05) break;
        let m = arp[k % 8];
        if (s.dark) m -= 12;
        let c0 = s.sec === "intro2" ? 700 : s.dark ? 1100 : s.light ? 2000 : 1500;
        if (s.sec === "rise") c0 = 900 + 1500 * ((s.b0 + k * step) / 16);
        const accent = k % 4 === 0;
        I.pluck(b, t, m, { vel: (accent ? 0.62 : 0.45) * (s.sec === "intro2" ? 0.7 : 1), dur: step * beat * 0.7, decay: 0.22, cutoff0: c0, cutoff1: 260, cutoffDecay: 0.06, sub: 0.1, pan: k % 2 ? 0.3 : -0.3 });
      }
    }
  });

  // 低音（8 分のはじく音と、下の正弦）
  mix.part("bass", { gain: -6.5, eq: [["lp", 900, 0.7]], pump: { times: kickTimes, depth: 0.3, release: 0.12 } }, (b) => {
    for (const s of S) {
      let root = notes(s.ch.bass)[0];
      if (root >= 39) root -= 12;
      const dur = s.t1 - s.t0;
      // 下の正弦（持続）
      const sv = s.hold ? 0.4 : s.hit || s.final ? 0.9 : s.sec === "intro1" ? 0.5 : 0.6;
      if (s.win) I.bass(b, s.span.from, root, { dur: s.span.to - s.span.from, attack: 0.3, release: 0.25, vel: sv, harm: [1, 0.25, 0.06] });
      else I.bass(b, s.t0, root, { dur: (s.preHold ? s.cut - s.t0 : dur) - 0.04, attack: s.hit ? 0.005 : 0.03, release: s.beforeTitle || s.preHold ? 0.06 : s.final ? 1.0 : 0.2, vel: sv, harm: [1, 0.25, 0.06] });
      // 8 分（拍のある所だけ）
      if (s.hold || s.stop || s.final || s.hit || s.sec.startsWith("intro")) continue;
      const pat = s.dark ? [0, 0, 12, 0, 1, 0, 12, 0] : s.light ? [0, null, 12, null, 0, null, 7, 12] : [0, 0, 12, 0, 0, 7, 12, 0];
      const n = Math.round(s.len / 0.5);
      for (let k = 0; k < n; k++) {
        const iv = pat[k % 8];
        if (iv === null) continue;
        const t = T(s.sec, s.b0 + k * 0.5);
        if (t >= s.cut - 0.1) break;
        I.pluck(b, t, root + 12 + iv, { vel: k % 2 ? 0.5 : 0.7, dur: beat * 0.32, decay: 0.3, cutoff0: s.dark ? 700 : 900, cutoff1: 140, cutoffDecay: 0.07, sub: 0.6, q: 0.8 });
      }
    }
  });

  // 太鼓（キック、裏のハット、2・4 拍の軽い音）
  mix.part("drums", { gain: -8.5, sends: { hall: -20 } }, (b) => {
    for (const k of kicks) I.kick(b, k.t, { vel: k.v, f0: k.dark ? 44 : 48, f1: k.dark ? 105 : 118, decay: k.dark ? 0.36 : 0.32, click: 0.05 });
    for (const s of S) {
      if (!groove(s)) continue;
      for (let k = 0; k < Math.round(s.len); k++) {
        const t = T(s.sec, s.b0 + k);
        if (t >= s.cut - 0.05) break;
        // 裏のハット
        I.hat(b, t + beat * 0.5, { vel: s.light ? 0.18 : 0.22, decay: 0.025, pan: 0.2 });
        if (s.dark) {
          I.hat(b, t + beat * 0.25, { vel: 0.14, decay: 0.02, pan: -0.15 });
          I.hat(b, t + beat * 0.75, { vel: 0.16, decay: 0.02, pan: -0.15 });
        }
        // 2・4 拍: 高い所の雑音と低い胴（声の帯域を避ける）
        if ((s.lvl >= 6 || s.dark) && k % 2 === 1) {
          I.shaker(b, t, { vel: 0.55, f: 5800, q: 1.3, decay: 0.07, attack: 0.002, pan: 0 });
          I.kick(b, t, { vel: 0.22, f0: 170, f1: 240, decay: 0.05, click: 0.0 });
        }
      }
    }
  });

  // 電気ピアノの和音（3 つ・作り方・数字と声・締め）
  mix.part("keys", { gain: -8, eq: [["peak", 2500, 0.8, -4]], sends: { hall: -5, echo: -12 } }, (b) => {
    for (const s of S) {
      const pad = notes(s.ch.pad);
      if (s.accent || s.hit || s.final) {
        for (const [k, m] of pad.entries()) I.epiano(b, s.t0 + k * 0.008, m + 12, { vel: s.final ? 0.55 : 0.6, dur: (s.t1 - s.t0) * 0.9, decay: 1.2 });
      } else if (s.light || s.warm) {
        // 2 拍ごとに短く
        for (let k = 0; k < s.len; k += 2) {
          const t = T(s.sec, s.b0 + k + (s.light ? 0.5 : 0));
          if (t >= s.t1 - 1e-6) break;
          for (const [j, m] of pad.entries()) I.epiano(b, t + j * 0.006, m + 12, { vel: s.warm ? 0.45 : 0.38, dur: s.warm ? beat * 1.8 : beat * 0.6 });
        }
      }
    }
  });

  // 山: 題名の前の高まりと低い響き
  const hits = [
    { name: "題名", at: T("title") },
    { name: "3 つの 1（計画）", at: T("pillars", 0) },
    { name: "3 つの 2（訓練）", at: T("pillars", 5) },
    { name: "3 つの 3（発災時）", at: T("pillars", 10) },
    { name: "発災時", at: T("dis1") },
    { name: "受入（長調に戻る）", at: T("receive") },
    { name: "ロゴ（最後の刻み）", at: T("end") },
  ];
  mix.part("fx", { gain: -6, sends: { hall: -4 } }, (b) => {
    I.noiseSwell(b, T("title") - beat * 0.5, { length: beat * 12, f0: 250, f1: 3200, gain: 0.5 });
    I.boom(b, T("title"), { vel: 0.75, f0: 36, f1: 70, decay: 2.2 });
    for (const k of [0, 5, 10]) I.boom(b, T("pillars", k), { vel: 0.4, f0: 42, f1: 64, decay: 0.7 });
    I.boom(b, T("dis1"), { vel: 0.7, f0: 34, f1: 60, decay: 1.6 });
    I.boom(b, T("receive"), { vel: 0.45, f0: 40, f1: 60, decay: 1.4 });
    I.boom(b, T("end"), { vel: 0.5, f0: 38, f1: 56, decay: 1.1 });
  });

  const master = mix.finish();
  const sections = [...tl.sections.values()].map((s) => ({ name: s.name, at: tl.t(s.beat) })).filter((s) => s.at < 180);
  const holds = [
    ["着信", "call"],
    ["並び替え", "emph2"],
    ["録音", "emph3"],
  ].map(([name, n]) => ({ name, from: T(n), to: T(n) + tl.sec(n).beats * beat }));
  void r;
  return {
    master,
    timeline: tl,
    log: mix.log,
    sections,
    hits,
    holds,
    beatsPerBar: 4,
    anchors: {
      問いかけ: T("intro1"), 気づき: T("rise"), 題名: T("title"), "3 つ": T("pillars"), 道具: T("plan"), 訓練: T("drill"),
      着信: T("call"), 着信の後: T("drill2"), 発災時: T("dis1"), 並び替え: T("emph2"), 並び替えの後: T("dis2"), 録音: T("emph3"),
      録音の後: T("dis3a"), 作り方: T("claude"), 数字と声: T("numbers"), 締め: T("closing"), ロゴ: T("end"), 終わり: 179.9,
    },
    masterOpts: { fadeFrom: 179.2, end: 179.9 },
  };
}
