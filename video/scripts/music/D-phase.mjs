// 案 D「ずれて、そろう」（少し大胆な案）: 2 台のマリンバが同じ 12 の音の型を重ねる、ミニマル音楽の形。
// 発災時（108 秒〜）に 2 台目だけがわずかに速くなって少しずつずれ（拍がにじむ）、受入（146.7 秒）でちょうど 1 つずれた所で
// またそろう（新しい組み合わせの型になる）。ばらばらの情報がそろう、という道具の話に重ねた。
// イ短調 → ハ長調。131.0 BPM、3 拍子。パッドは 8 分ごとに脈打つ（拍がはっきりしていて音ハメもしやすい）。
import { Timeline, markWindows, notes, rng } from "./lib/core.mjs";
import * as I from "./lib/inst.mjs";
import { Mix } from "./lib/mixer.mjs";

export const meta = { id: "D-phase", title: "ずれて、そろう（少し大胆な案・ミニマル）" };

const BPM = 60 / (145.7 / 318); // 106 小節（3 拍）で 32.6 → 178.3

const form = [
  ["intro1", Array(9).fill(3)],
  ["intro2", Array(8).fill(3)],
  ["rise", Array(6).fill(3)],
  ["title", [3, 3, 3, 3]],
  ["pillars", [3, 3, 3, 3, 3, 3]],
  ["plan", Array(20).fill(3)],
  ["drill", Array(10).fill(3)],
  ["call", [3, 3, 3, 3]],
  ["drill2", Array(11).fill(3)],
  ["dis1", [3, 3, 3, 3, 3, 2]],
  ["emph2", [3, 3, 3, 2]],
  ["dis2", [3, 3, 3, 2]],
  ["emph3", [3, 3, 3]],
  ["dis3a", Array(8).fill(3)],
  ["dis3b", [3, 3, 3, 3]],
  ["receive", [3, 3]],
  ["claude", Array(10).fill(3)],
  ["numbers", Array(7).fill(3)],
  ["closing", [3, 3, 3, 3]],
  ["end", [3]],
];

const CH = {
  Am9: { bass: "A1", pad: "A2 E3 G3 B3 C4", set: "A3 B3 C4 E4 G4 B4" },
  Am: { bass: "A1", pad: "A2 E3 A3 C4", set: "A3 C4 E4 A4 B4 C5" },
  Fmaj9: { bass: "F1", pad: "F2 C3 E3 G3 A3", set: "A3 C4 E4 F4 G4 B4" },
  FA: { bass: "A1", pad: "A2 F3 C4 E4", set: "A3 C4 E4 F4 A4 C5" },
  G6: { bass: "G1", pad: "G2 D3 E3 B3", set: "G3 B3 D4 E4 G4 A4" },
  G: { bass: "G1", pad: "G2 D3 B3 D4", set: "G3 B3 D4 G4 A4 B4" },
  Cmaj9: { bass: "C2", pad: "C3 G3 B3 D4 E4", set: "G3 B3 C4 D4 E4 G4" },
  Em7: { bass: "E2", pad: "E2 B2 D3 G3", set: "G3 B3 D4 E4 G4 B4" },
  Dm9: { bass: "D2", pad: "D3 A3 C4 E4 F4", set: "A3 C4 D4 E4 F4 A4" },
  E7s: { bass: "E2", pad: "E2 B2 D3 A3", set: "A3 B3 D4 E4 A4 B4" },
  E7: { bass: "E2", pad: "E2 B2 D3 G#3", set: "G#3 B3 D4 E4 G#4 B4" },
};

// 12 の 8 分の型（和音の 6 つの音の番号）
const PAT = [0, 3, 5, 3, 4, 1, 2, 4, 5, 2, 3, 1];

export function compose() {
  const tl = new Timeline({ bpm: BPM, anchor: 32.6, anchorSection: "title", form });
  const beat = tl.beat;
  const e8 = beat / 2;
  const T = (sec, b = 0) => tl.at(sec, b);
  const r = rng(318);

  const S = [];
  const add = (sec, b0, len, ch, o = {}) => S.push({ sec, b0, len, ch: CH[ch], name: ch, ...o });
  add("intro1", 0, 27, "Am9", { lvl: 0 });
  add("intro2", 0, 12, "Fmaj9", { lvl: 1 });
  add("intro2", 12, 12, "Am9", { lvl: 1 });
  add("rise", 0, 6, "Fmaj9", { lvl: 2 });
  add("rise", 6, 6, "G6", { lvl: 2 });
  add("rise", 12, 5.5, "G", { lvl: 3, beforeTitle: true });
  add("title", 0, 12, "Cmaj9", { lvl: 3, hit: true });
  add("pillars", 0, 6, "Fmaj9", { lvl: 3, accent: true });
  add("pillars", 6, 6, "G6", { lvl: 3, accent: true });
  add("pillars", 12, 6, "Am9", { lvl: 3, accent: true });
  ["Cmaj9", "Am9", "Fmaj9", "G6", "Em7"].forEach((c, k) => add("plan", k * 12, 12, c, { lvl: 4 }));
  add("drill", 0, 12, "Am9", { lvl: 5 });
  add("drill", 12, 12, "Fmaj9", { lvl: 5 });
  add("drill", 24, 6, "G6", { lvl: 5 });
  add("call", 0, 12, "Cmaj9", { lvl: 1, hold: true });
  add("drill2", 0, 12, "Fmaj9", { lvl: 5 });
  add("drill2", 12, 12, "G6", { lvl: 5 });
  add("drill2", 24, 6, "Em7", { lvl: 5 });
  add("drill2", 30, 3, "E7s", { lvl: 5 });
  add("dis1", 0, 17, "Am", { lvl: 6, dark: true });
  add("emph2", 0, 11, "Am9", { lvl: 1, hold: true, dark: true });
  add("dis2", 0, 11, "FA", { lvl: 6, dark: true });
  add("emph3", 0, 9, "Dm9", { lvl: 1, hold: true, dark: true });
  ["Am", "Dm9", "E7s", "E7"].forEach((c, k) => add("dis3a", k * 6, 6, c, { lvl: 6, dark: true }));
  add("dis3b", 0, 6, "Fmaj9", { lvl: 5, lift: true });
  add("dis3b", 6, 6, "G6", { lvl: 5, lift: true });
  add("receive", 0, 6, "Cmaj9", { lvl: 4, accent: true });
  ["Cmaj9", "Dm9", "Em7", "Fmaj9", "G6"].forEach((c, k) => add("claude", k * 6, 6, c, { lvl: 4, light: true }));
  add("numbers", 0, 9, "Fmaj9", { lvl: 3, warm: true });
  add("numbers", 9, 6, "Em7", { lvl: 3, warm: true });
  add("numbers", 15, 6, "Dm9", { lvl: 3, warm: true });
  add("closing", 0, 6, "Fmaj9", { lvl: 3, warm: true });
  add("closing", 6, 3, "G6", { lvl: 3, warm: true });
  add("closing", 9, 3, "G", { lvl: 2, warm: true });
  add("end", 0, 3.4, "Cmaj9", { lvl: 2, final: true });
  for (const s of S) {
    s.t0 = T(s.sec, s.b0);
    s.t1 = T(s.sec, s.b0 + s.len);
  }
  // 強調の窓: 窓の中のパッドは窓の頭の後の拍から窓の終わりの 0.35 秒前まで。窓の前の和音は早めに消す
  markWindows(tl, S, (s) => s.hold);
  const chordAt = (t) => S.find((s) => t >= s.t0 - 1e-6 && t < s.t1 - 1e-6) ?? null;

  // ずれる所: 108.2 秒（dis1）〜 146.7 秒（receive）。2 台目はこの間に 8 分 1 つぶん多く打つ
  const P0 = T("dis1");
  const P1 = T("receive");
  const n1 = Math.round((P1 - P0) / e8); // 168
  const e8b = (P1 - P0) / (n1 + 1);

  const mix = new Mix({
    sends: {
      hall: { type: "reverb", rt60: 2.6, size: 1.1, damp: 0.42, pre: 0.02, hp: 200, lp: 6500, ret: -5 },
    },
  });

  // マリンバ 1（いつも拍の上）とマリンバ 2（初めは 3 つ遅れて重なり、発災時にずれ、受入で 1 つずれてそろう）
  const playMarimba = (b, which) => {
    const startT = T("intro1");
    const K0 = Math.round((P0 - startT) / e8);
    // 打つ時刻と型の番号の並び。2 台目: P0 の前は 3 つ遅れ、P0〜P1 は 169 打（1 台目は 168 打）、P1 から 4 つ遅れ
    const ev = [];
    for (let t = startT, k = 0; t < 179; t += e8, k++) {
      if (which === 1) ev.push({ tt: t, idx: k });
      else if (t < P0 - 1e-6) ev.push({ tt: t, idx: k + 3 });
      else if (t >= P1 - 1e-6) ev.push({ tt: t, idx: k + 4 });
    }
    if (which === 2) for (let j = 0; j <= n1; j++) ev.push({ tt: P0 + j * e8b, idx: K0 + 3 + j });
    ev.sort((a, b2) => a.tt - b2.tt);
    for (const { tt, idx } of ev) {
      const k = idx;
      const s = chordAt(tt + 1e-4);
      if (!s || s.hold || s.final || (s.hit && tt - s.t0 < e8 * 0.5)) continue;
      if (s.beforeTitle && tt > s.t1 - e8 * 0.6) continue;
      if (s.preHold && tt >= s.cut - 0.05) continue; // 窓の前は早めに止める（ずれる 2 台目の音を落とさないよう、窓の前の和音だけ）
      if (which === 2 && (s.sec === "intro1" || s.sec === "intro2" || (s.sec === "rise" && s.b0 < 6))) continue;
      // 頭の静かな所は 4 分だけ
      if (s.sec === "intro1" && k % 2 === 1) continue;
      if (s.warm && k % 2 === 1) continue;
      const set = notes(s.ch.set);
      let m = set[PAT[((idx % 12) + 12) % 12]];
      if (which === 2) m += s.light ? 12 : 0;
      if (s.dark && which === 1) m -= 12;
      const strong = idx % 6 === 0 || idx % 6 === 3;
      let v = (strong ? 0.56 : 0.44) * (which === 2 ? 0.85 : 1);
      if (s.sec === "intro1") v *= 0.7;
      if (s.sec === "intro2") v *= 0.8;
      if (s.sec === "rise") v *= 0.85 + 0.25 * ((s.b0 + (tt - s.t0) / beat) / 18);
      if (s.light) v *= 0.85;
      if (s.warm) v *= 0.85;
      I.marimba(b, tt + (r() - 0.5) * 0.004, m, { vel: v, hard: s.dark ? 0.52 : 0.45, pan: which === 1 ? -0.45 : 0.45, decay: s.light ? 0.7 : 1 });
    }
  };
  mix.part("marimba1", { gain: -3, sends: { hall: -8 } }, (b) => playMarimba(b, 1));
  mix.part("marimba2", { gain: -4, sends: { hall: -7 } }, (b) => playMarimba(b, 2));

  // 低いマリンバ（訓練・発災時の根音）
  mix.part("marimbaLow", { gain: -6, sends: { hall: -10 } }, (b) => {
    for (const s of S) {
      if (!(s.sec === "drill" || s.sec === "drill2" || s.dark || s.lift) || s.hold) continue;
      const root = notes(s.ch.bass)[0] + 12;
      for (let k = 0; k < s.len; k++) {
        const t = T(s.sec, s.b0 + k);
        if (s.preHold && t >= s.cut - 0.05) break;
        const pos = (s.b0 + k) % 3;
        if (pos === 1) continue;
        I.marimba(b, t, pos === 0 ? root : root + 7, { vel: pos === 0 ? 0.6 : 0.42, hard: 0.2, decay: 1.2, pan: 0 });
      }
    }
  });

  // 脈打つパッド: 8 分ごとに頭で上がって下がる。2 小節でふくらむ
  mix.part("pulse", { gain: -9, eq: [["hp", 110, 0.7], ["peak", 2500, 0.7, -5], ["lp", 4500, 0.7]], sends: { hall: -4 } }, (b) => {
    for (const s of S) {
      const dur = s.t1 - s.t0;
      const v = s.hold ? 0.45 : s.hit || s.final ? 0.75 : s.sec === "intro1" ? 0.35 : 0.55;
      // 盛り上がりは 0 から立ち上げず、和音ごとに少しずつ大きく
      const rb = s.sec === "rise" ? s.b0 / 6 : 0;
      const curve = s.sec === "rise" ? [[0, -5 + 2.5 * rb], [dur, -1.5 + 2.5 * rb]] : null;
      for (const m of notes(s.ch.pad)) {
        const t0 = s.win ? s.span.from : s.t0 - 0.02;
        const len = s.win ? s.span.to - s.span.from : s.preHold ? s.cut - s.t0 - 0.03 : dur + (s.beforeTitle ? -0.05 : 0.04);
        I.ensemble(b, t0, m, { dur: len, attack: s.sec === "rise" ? 0.35 : s.hit ? 0.05 : s.win ? 0.5 : 0.3, release: s.beforeTitle ? 0.1 : s.win || s.preHold ? 0.25 : s.final ? 1.3 : 0.5, vel: v, cutoff: s.dark ? 1100 : s.sec === "rise" ? 1300 + 250 * rb : 1700, voices: 3, detune: 7, vib: 3, wave: "tri", curve });
      }
    }
    // 脈（拍がある所だけ）
    const pulsing = (s) => !s.hold && !s.final && s.sec !== "intro1" && !(s.hit && false) && !s.warm;
    const env = new Float32Array(b.n).fill(1);
    for (const s of S) {
      if (!pulsing(s)) continue;
      const depth = s.sec === "intro2" ? 0.3 : s.dark ? 0.65 : s.light ? 0.45 : 0.55;
      for (let t = s.t0; t < s.t1 - 1e-6; t += e8) {
        const k = Math.round((t - T("intro1")) / e8);
        const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k % 12)) / 12); // 2 小節でふくらむ
        const i0 = Math.round(t * 48000), i1 = Math.min(b.n, Math.round((t + e8) * 48000));
        for (let i = i0; i < i1; i++) {
          const x = (i - i0) / 48000;
          const a = x < 0.006 ? x / 0.006 : 1;
          const g = (1 - depth) + depth * a * Math.exp(-x / (e8 * 0.45));
          env[i] = g * (0.8 + 0.2 * swell);
        }
      }
    }
    for (let i = 0; i < b.n; i++) {
      b.L[i] *= env[i];
      b.R[i] *= env[i];
    }
  });

  // 低音（三角の持続と下の正弦）
  mix.part("bass", { gain: -6, eq: [["lp", 400, 0.7]] }, (b) => {
    for (const s of S) {
      let m = notes(s.ch.bass)[0];
      if (m >= 39) m -= 12;
      if (m < 29) m += 12;
      const dur = s.t1 - s.t0;
      if (s.sec === "intro1" && s.b0 === 0) {
        I.bass(b, s.t0 + beat * 9, m, { dur: dur - beat * 9, attack: 1.5, release: 0.6, vel: 0.45, harm: [1, 0.25, 0.08] });
        continue;
      }
      if (s.win) {
        I.bass(b, s.span.from, m, { dur: s.span.to - s.span.from, attack: 0.3, release: 0.25, vel: 0.4, harm: [1, 0.3, 0.1] });
        continue;
      }
      I.bass(b, s.t0, m, { dur: (s.preHold ? s.cut - s.t0 : dur) - 0.04, attack: s.hit ? 0.006 : 0.05, release: s.beforeTitle || s.preHold ? 0.06 : s.final ? 1.1 : 0.3, vel: s.hold ? 0.4 : s.hit || s.final ? 0.85 : 0.62, harm: [1, 0.3, 0.1] });
      I.ensemble(b, s.t0, m + 12, { dur: s.preHold ? s.cut - s.t0 - 0.05 : dur, attack: 0.25, release: s.preHold ? 0.2 : 0.5, vel: s.hold ? 0.3 : 0.45, cutoff: 700, voices: 2, detune: 4, vib: 2, wave: "tri" });
    }
  });

  // 低い太鼓と響き（題名・3 つ・発災時の小節の頭・受入・ロゴ）
  const hits = [
    { name: "題名", at: T("title") },
    { name: "3 つの 1（計画）", at: T("pillars", 0) },
    { name: "3 つの 2（訓練）", at: T("pillars", 6) },
    { name: "3 つの 3（発災時）", at: T("pillars", 12) },
    { name: "発災時（2 台目がずれ始める）", at: P0 },
    { name: "受入（ずれがそろう）", at: P1 },
    { name: "ロゴ", at: T("end") },
  ];
  mix.part("drums", { gain: -6, sends: { hall: -8 } }, (b) => {
    I.boom(b, T("title"), { vel: 0.7, f0: 36, f1: 64, decay: 2.2 });
    I.timpani(b, T("title"), notes("C2")[0], { vel: 0.6, decay: 2.4 });
    for (const [k, m] of [[0, "F2"], [6, "G2"], [12, "A2"]]) I.timpani(b, T("pillars", k), notes(m)[0], { vel: 0.5, decay: 1.5 });
    for (const s of S) {
      if (!s.dark || s.hold) continue;
      for (let k = 0; k < s.len; k += 3) {
        const t = T(s.sec, s.b0 + k);
        if (s.preHold && t >= s.cut - 0.6) break;
        I.timpani(b, t, notes("A1")[0], { vel: k === 0 ? 0.55 : 0.4, decay: 1.1, soft: 0.8 });
      }
    }
    I.boom(b, P0, { vel: 0.55, f0: 34, f1: 55, decay: 1.6 });
    I.timpani(b, P1, notes("C2")[0], { vel: 0.5, decay: 2 });
    I.boom(b, T("end"), { vel: 0.45, f0: 36, f1: 52, decay: 1.2 });
  });

  // ビブラフォン風の鐘（山の和音）
  mix.part("vibes", { gain: -10, eq: [["peak", 2600, 0.8, -4]], sends: { hall: -2 } }, (b) => {
    for (const s of S) {
      if (!(s.hit || s.accent || s.final || s.hold || s.warm)) continue;
      const set = notes(s.ch.set);
      const times = s.warm ? [0, s.len >= 6 ? 3 : null].filter((x) => x !== null) : [0];
      for (const k of times) {
        // 窓の中の和音は窓の頭の後の拍で（窓の端で鳴り続けないように）
        const t = s.win ? s.span.from : T(s.sec, s.b0 + k);
        for (const [j, m] of [set[0], set[2], set[4]].entries()) I.bell(b, t + j * 0.01, m, { vel: s.hold ? 0.35 : 0.5, decay: s.final ? 3.5 : 3, ratios: [1, 3.98, 10.1], amps: [1, 0.12, 0.025], attack: 0.003 });
      }
    }
  });

  const master = mix.finish();
  const sections = [...tl.sections.values()].map((s) => ({ name: s.name, at: tl.t(s.beat) })).filter((s) => s.at < 180);
  const holds = [
    ["着信", "call"],
    ["並び替え", "emph2"],
    ["録音", "emph3"],
  ].map(([name, n]) => ({ name, from: T(n), to: T(n) + tl.sec(n).beats * beat }));
  return {
    master,
    timeline: tl,
    log: mix.log,
    sections,
    hits,
    holds,
    beatsPerBar: 3,
    anchors: {
      問いかけ: T("intro1"), 気づき: T("rise"), 題名: T("title"), "3 つ": T("pillars"), 道具: T("plan"), 訓練: T("drill"),
      着信: T("call"), 着信の後: T("drill2"), 発災時: T("dis1"), 並び替え: T("emph2"), 並び替えの後: T("dis2"), 録音: T("emph3"),
      録音の後: T("dis3a"), 作り方: T("claude"), 数字と声: T("numbers"), 締め: T("closing"), ロゴ: T("end"), 終わり: 179.9,
    },
    masterOpts: { fadeFrom: 179.1, end: 179.9 },
  };
}
