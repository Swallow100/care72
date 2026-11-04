// 案 C「静かな見守り」: 倍音がゆっくり揺れるパッドと低い鐘、遠くの心音のような拍。ニ長調（発災時はロ短調）。
// 72.5 BPM（安静の心拍の速さ。題名の 72 にも重ねた）、4 拍（3 つの所だけ 3 拍の小節を 3 つ）。
import { Timeline, holdSpan, notes, rng, windowAt } from "./lib/core.mjs";
import * as I from "./lib/inst.mjs";
import { Mix } from "./lib/mixer.mjs";

export const meta = { id: "C-ambient", title: "静かな見守り（柔らかい環境音寄り）" };

const BPM = 60 / (145.7 / 176); // 44 小節で 32.6 → 178.3

const form = [
  ["intro1", [3, 4, 4, 4]],
  ["intro2", [4, 4, 4, 4]],
  ["rise", [4, 4]],
  ["title", [4, 3]],
  ["pillars", [3, 3, 3]],
  ["plan", [4, 4, 4, 4, 4, 4, 4, 4, 2]],
  ["drill", [4, 4, 4, 4]],
  ["call", [4, 3]],
  ["drill2", [4, 4, 4, 4, 2]],
  ["dis1", [4, 5]],
  ["emph2", [4, 3]],
  ["dis2", [5]],
  ["emph3", [3, 3]],
  ["dis3a", [4, 4, 5]],
  ["dis3b", [4, 3]],
  ["receive", [4]],
  ["claude", [4, 4, 4, 4]],
  ["numbers", [4, 4, 3]],
  ["closing", [4, 3]],
  ["end", [4]],
];

// pad（柱の音）、set（鐘・木の音で使う音の並び）、bass
const CH = {
  D9: { bass: "D2", pad: "D2 A2 E3 F#3 C#4", set: "A3 D4 E4 F#4 A4 C#5" },
  D6: { bass: "D2", pad: "D2 A2 F#3 B3 E4", set: "A3 B3 D4 F#4 A4 B4" },
  Bm9: { bass: "B1", pad: "B1 F#2 D3 A3 C#4", set: "F#3 B3 C#4 D4 F#4 A4" },
  Bm: { bass: "B1", pad: "B1 F#2 B2 D3 F#3", set: "F#3 B3 D4 F#4 B4 D5" },
  G9: { bass: "G1", pad: "G1 D2 A2 B2 F#3 C#4", set: "D4 F#4 A4 B4 C#5 D5" },
  Em9: { bass: "E2", pad: "E2 B2 D3 F#3 G3", set: "B3 D4 E4 F#4 G4 B4" },
  A6s: { bass: "A1", pad: "A1 E2 B2 D3 F#3", set: "A3 B3 D4 E4 F#4 A4" },
  A: { bass: "A1", pad: "A1 E2 C#3 E3 B3", set: "A3 C#4 E4 B4 C#5 E5" },
  FsM: { bass: "F#1", pad: "F#1 C#2 A2 E3 G#3", set: "C#4 E4 F#4 G#4 A4 C#5" },
  DF: { bass: "F#1", pad: "F#1 D2 A2 E3 F#3", set: "A3 D4 E4 F#4 A4 D5" },
  CB: { bass: "B1", pad: "B1 E2 G2 C3 D3", set: "E4 G4 B4 C5 D5 E5" },
  GB: { bass: "B1", pad: "B1 D2 G2 A2 D3", set: "D4 G4 A4 B4 D5 F#5" },
  Em7: { bass: "E2", pad: "E2 B2 D3 G3", set: "B3 D4 E4 G4 B4 D5" },
  F7: { bass: "F#1", pad: "F#1 C#2 A#2 E3", set: "C#4 E4 F#4 A#4 C#5 E5" },
};

export function compose() {
  const tl = new Timeline({ bpm: BPM, anchor: 32.6, anchorSection: "title", form });
  const beat = tl.beat;
  const T = (sec, b = 0) => tl.at(sec, b);
  const r = rng(4810);

  const S = [];
  const add = (sec, b0, len, ch, o = {}) => S.push({ sec, b0, len, ch: CH[ch], name: ch, ...o });
  add("intro1", 0, 7, "D9", { lvl: 0 });
  add("intro1", 7, 8, "G9", { lvl: 0 });
  add("intro2", 0, 8, "Bm9", { lvl: 1 });
  add("intro2", 8, 8, "G9", { lvl: 1 });
  add("rise", 0, 4, "Em9", { lvl: 2, rise: 0 });
  add("rise", 4, 4, "A6s", { lvl: 2, rise: 1 });
  add("title", 0, 7, "D9", { lvl: 3, hit: true });
  add("pillars", 0, 3, "G9", { lvl: 3, accent: true });
  add("pillars", 3, 3, "A6s", { lvl: 3, accent: true });
  add("pillars", 6, 3, "Bm9", { lvl: 3, accent: true });
  ["D9", "DF", "G9", "Em9"].forEach((c, k) => add("plan", k * 8, 8, c, { lvl: 4 }));
  add("plan", 32, 2, "A6s", { lvl: 3 });
  ["Bm9", "G9", "D6", "A6s"].forEach((c, k) => add("drill", k * 4, 4, c, { lvl: 5 }));
  add("call", 0, 7, "D9", { lvl: 1, hold: true });
  ["G9", "D6", "Em9", "Bm9"].forEach((c, k) => add("drill2", k * 4, 4, c, { lvl: 5 }));
  add("drill2", 16, 2, "A6s", { lvl: 3 });
  add("dis1", 0, 4, "Bm", { lvl: 6, dark: true });
  add("dis1", 4, 5, "CB", { lvl: 6, dark: true });
  add("emph2", 0, 7, "Bm9", { lvl: 1, hold: true, dark: true });
  add("dis2", 0, 5, "GB", { lvl: 6, dark: true });
  add("emph3", 0, 6, "Em7", { lvl: 1, hold: true, dark: true });
  add("dis3a", 0, 4, "Bm", { lvl: 6, dark: true });
  add("dis3a", 4, 4, "G9", { lvl: 6, dark: true });
  add("dis3a", 8, 5, "F7", { lvl: 6, dark: true });
  add("dis3b", 0, 4, "G9", { lvl: 5, lift: true });
  add("dis3b", 4, 3, "A6s", { lvl: 5, lift: true });
  add("receive", 0, 4, "D9", { lvl: 4, accent: true });
  ["D6", "Em9", "FsM", "G9"].forEach((c, k) => add("claude", k * 4, 4, c, { lvl: 4, light: true }));
  ["G9", "DF", "Em9"].forEach((c, k) => add("numbers", k * 4, k === 2 ? 3 : 4, c, { lvl: 3, warm: true }));
  add("closing", 0, 4, "G9", { lvl: 3, warm: true });
  add("closing", 4, 3, "A6s", { lvl: 3, warm: true });
  add("end", 0, 2.2, "D9", { lvl: 2, final: true });
  for (const s of S) {
    s.t0 = T(s.sec, s.b0);
    s.t1 = T(s.sec, s.b0 + s.len);
  }

  const mix = new Mix({
    sends: {
      hall: { type: "reverb", rt60: 4.2, size: 1.3, damp: 0.5, pre: 0.03, hp: 150, lp: 5500, ret: -2, width: 1 },
      echo: { type: "echo", time: beat * 1.5, feedback: 0.42, lp: 2600, hp: 300, ret: -8, to: { hall: -3 } },
    },
  });

  // 柱の音（倍音が 1 本ずつ揺れる。和音の切れ目で重ねてつなぐ）
  // 強調の窓（hold）の前の和音は早めに消し、窓の頭で新しい和音を立てる（動画の音量の段差を音の変わり目に重ねる）。
  // 窓のあとの和音は速く立ち上げる
  // C は残響が長い（4.2 秒）ので、窓の中の音は窓の終わりの 1 秒前に消す（残響が窓の終わりの段に残らないように）
  const holdC = (s) => {
    const sp = holdSpan(tl, windowAt(s.t0, s.t1));
    return { from: sp.from, to: sp.to - 0.65 };
  };
  const beforeHold = (s) => {
    const k = S.indexOf(s);
    return k >= 0 && k < S.length - 1 && S[k + 1].hold;
  };
  const afterHold = (s) => {
    const k = S.indexOf(s);
    return k > 0 && S[k - 1].hold;
  };
  mix.part("air", { gain: -2, eq: [["hp", 45, 0.7], ["peak", 2600, 0.7, -5], ["highshelf", 6000, 1, -4]], sends: { hall: -4 } }, (b) => {
    for (const s of S) {
      const dur = s.t1 - s.t0;
      const v = s.hold ? 0.5 : s.hit ? 0.85 : s.final ? 0.7 : s.sec === "intro1" ? 0.5 : s.rise !== undefined ? 0.6 + 0.1 * s.rise : s.dark ? 0.62 : s.light ? 0.54 : 0.6;
      const curve = s.rise !== undefined ? [[0, -2 + s.rise * 2.5], [dur, 0.5 + s.rise * 2.5]] : null;
      const early = beforeHold(s);
      for (const m of notes(s.ch.pad)) {
        // 窓の中の柱の音は、窓の頭の後の拍から窓の終わりの 0.35 秒前まで
        const span = s.hold ? holdC(s) : null;
        I.airPad(b, span ? span.from : s.t0 - (afterHold(s) ? 0 : 0.3), m, {
          dur: span ? span.to - span.from : dur + (afterHold(s) ? 0 : 0.3) - (early ? 0.25 : 0),
          attack: s.hit ? 0.25 : s.hold ? 0.35 : afterHold(s) ? 0.3 : s.sec === "intro1" && s.b0 === 0 ? 3.5 : 1.4,
          release: s.final ? 1.6 : s.rise === 1 || s.hold ? 0.3 : early ? 0.35 : 2.2,
          vel: v,
          partials: s.dark ? 6 : 9,
          tilt: s.dark ? 1.7 : s.light ? 1.25 : 1.45,
          maxF: 4200,
          detune: 3.5,
          curve,
        });
      }
    }
  });

  // 低い持続（正弦）
  mix.part("sub", { gain: -7, eq: [["lp", 200, 0.7]] }, (b) => {
    for (const s of S) {
      let m = notes(s.ch.bass)[0];
      if (m >= 39) m -= 12;
      if (m < 29) m += 12;
      const dur = s.t1 - s.t0;
      if (s.hold) {
        const span = holdC(s);
        I.bass(b, span.from, m, { dur: span.to - span.from, attack: 0.4, release: 0.25, vel: 0.4, harm: [1, 0.22, 0.05], drive: 0.8 });
        continue;
      }
      const pre = beforeHold(s);
      I.bass(b, s.t0, m, { dur: dur - (pre ? 0.2 : 0), attack: s.hit ? 0.01 : 0.4, release: s.final ? 1.2 : pre ? 0.15 : 0.8, vel: s.hit ? 0.85 : 0.6, harm: [1, 0.22, 0.05], drive: 0.8 });
    }
  });

  // 鐘（低め、和音の頭とその後にまばらに）。遠くで鳴るように遅れと残響を多めに
  const hits = [];
  mix.part("bells", { gain: -9, eq: [["peak", 2600, 0.8, -5], ["lp", 6000, 0.7]], sends: { hall: 0, echo: -6 } }, (b) => {
    for (const s of S) {
      const set = notes(s.ch.set);
      if (s.hold) {
        const span = holdC(s);
        I.bell(b, span.from, set[0], { vel: 0.42, decay: 3, attack: 0.006 });
        I.bell(b, span.from + 0.012, set[3], { vel: 0.3, decay: 2.5, attack: 0.006 });
        continue;
      }
      if (s.hit || s.accent || s.final || afterHold(s)) {
        I.bell(b, s.t0, set[0] - 12, { vel: 0.8, decay: 6 });
        I.bell(b, s.t0 + 0.01, set[1], { vel: 0.5, decay: 5 });
        I.bell(b, s.t0 + 0.02, set[4], { vel: 0.35, decay: 4 });
        continue;
      }
      // まばら: 2 拍ごと（盛り上がりは 1 拍、のちに半拍）
      const step = s.rise !== undefined ? (s.rise ? 0.5 : 1) : s.sec === "intro1" ? 4 : s.sec === "intro2" ? 2 : 2;
      for (let k = 0; k * step < s.len - 1e-6; k++) {
        const t = T(s.sec, s.b0 + k * step) + (r() - 0.5) * 0.01;
        const idx = [2, 4, 3, 5, 1, 4, 2, 3][(k + s.b0) % 8];
        const v = s.rise !== undefined ? 0.28 + 0.03 * k : 0.3 + (k % 2 ? 0 : 0.06);
        I.bell(b, t, set[idx] + (s.light ? 12 : 0), { vel: s.light ? v * 0.7 : v, decay: s.light ? 2.5 : 4, attack: 0.008 });
      }
    }
  });

  // 柔らかい木の音（マリンバを柔らかいばちで）: 計画・訓練・作り方の刻み
  mix.part("wood", { gain: -10, eq: [["peak", 2600, 0.8, -4]], sends: { hall: -6, echo: -10 } }, (b) => {
    for (const s of S) {
      if (!["plan", "drill", "drill2", "claude", "dis1", "dis2", "dis3a", "dis3b", "numbers"].includes(s.sec) || s.hold) continue;
      const set = notes(s.ch.set);
      const step = s.warm ? 1 : 0.5;
      const pat = [0, 2, 4, 1, 3, 5, 2, 4];
      for (let k = 0; k * step < s.len - 1e-6; k++) {
        const t = T(s.sec, s.b0 + k * step);
        const onBeat = k % (1 / step) === 0;
        let m = set[pat[k % 8]];
        if (s.dark) m -= 12;
        const v = (onBeat ? 0.5 : 0.36) * (s.sec === "drill" || s.sec === "drill2" ? 1.1 : 1) * (s.warm ? 0.8 : 1);
        I.marimba(b, t, m, { vel: v, hard: 0.08, decay: 1.3 });
      }
    }
  });

  // 心音のような拍（低い 2 つの音）: 3 つ・計画・訓練・発災時
  mix.part("heart", { gain: -8, eq: [["lp", 400, 0.7]], sends: { hall: -16 } }, (b) => {
    for (const s of S) {
      const on = ["pillars", "plan", "drill", "drill2", "dis1", "dis2", "dis3a", "dis3b", "receive"].includes(s.sec) && !s.hold;
      if (!on && !s.hit) continue;
      if (s.hit) {
        I.kick(b, s.t0, { vel: 0.8, f0: 40, f1: 70, decay: 0.5, click: 0 });
        continue;
      }
      for (let k = 0; k < s.len; k++) {
        const pos = (s.b0 + k) % 4;
        const t = T(s.sec, s.b0 + k);
        const strong = s.dark || s.sec === "drill" || s.sec === "drill2" ? true : pos === 0 || pos === 2;
        if (!strong) continue;
        const v = s.dark ? 0.7 : pos === 0 ? 0.6 : 0.45;
        I.kick(b, t, { vel: v, f0: 42, f1: 72, decay: 0.24, click: 0 });
        I.kick(b, t + beat * 0.3, { vel: v * 0.55, f0: 42, f1: 66, decay: 0.2, click: 0 });
      }
    }
  });

  // 電気ピアノ（柔らかく、作り方・数字と声・締め）
  mix.part("keys", { gain: -11, eq: [["peak", 2500, 0.8, -4]], sends: { hall: -4 } }, (b) => {
    for (const s of S) {
      if (!(s.light || s.warm || s.final || s.accent)) continue;
      const set = notes(s.ch.set);
      const chord = [set[0], set[2], set[3], set[5]];
      const times = s.final || s.accent ? [0] : s.light ? [0, 1.5, 3] : [0, 2];
      for (const k of times) {
        if (k >= s.len) continue;
        const t = T(s.sec, s.b0 + k);
        for (const [j, m] of chord.entries()) I.epiano(b, t + j * 0.012, m - 12, { vel: s.final ? 0.55 : 0.45, dur: beat * (s.light ? 1.2 : 1.9), index: 1.2 });
      }
    }
  });

  // 題名の前の高まり（雑音を帯域で上げる、ごく小さく）と、山の低い響き
  mix.part("fx", { gain: -10, sends: { hall: -2 } }, (b) => {
    I.noiseSwell(b, T("title") - 0.25, { length: beat * 7, f0: 200, f1: 1800, gain: 0.35 });
    I.boom(b, T("title"), { vel: 0.75, f0: 36, f1: 52, decay: 2.6, attack: 0.03 });
    I.boom(b, T("dis1"), { vel: 0.5, f0: 32, f1: 46, decay: 2.0, attack: 0.03 });
    I.boom(b, T("receive"), { vel: 0.4, f0: 36, f1: 48, decay: 2.0, attack: 0.03 });
  });
  hits.push(
    { name: "題名", at: T("title") },
    { name: "3 つの 1（計画）", at: T("pillars", 0) },
    { name: "3 つの 2（訓練）", at: T("pillars", 3) },
    { name: "3 つの 3（発災時）", at: T("pillars", 6) },
    { name: "発災時", at: T("dis1") },
    { name: "受入（長調に戻る）", at: T("receive") },
    { name: "ロゴ", at: T("end") },
  );

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
    beatsPerBar: 4,
    anchors: {
      問いかけ: T("intro1"), 気づき: T("rise"), 題名: T("title"), "3 つ": T("pillars"), 道具: T("plan"), 訓練: T("drill"),
      着信: T("call"), 着信の後: T("drill2"), 発災時: T("dis1"), 並び替え: T("emph2"), 並び替えの後: T("dis2"), 録音: T("emph3"),
      録音の後: T("dis3a"), 作り方: T("claude"), 数字と声: T("numbers"), 締め: T("closing"), ロゴ: T("end"), 終わり: 179.9,
    },
    masterOpts: { fadeFrom: 179.0, end: 179.9 },
  };
}
