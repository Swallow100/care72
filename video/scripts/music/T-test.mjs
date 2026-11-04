// 道具の通しの確かめ（頭の 12 秒だけ鳴る）。node scripts/music/render.mjs T
import { Timeline, notes } from "./lib/core.mjs";
import * as I from "./lib/inst.mjs";
import { Mix } from "./lib/mixer.mjs";

export const meta = { id: "T-test", title: "道具の確かめ" };

export function compose() {
  const tl = new Timeline({ bpm: 120, anchor: 32.6, anchorSection: "b", form: [["a", Array(16).fill(4)], ["b", Array(73).fill(4)], ["c", [4]]] });
  const mix = new Mix({ sends: { hall: { type: "reverb", rt60: 2.6, ret: -4 } } });
  mix.part("piano", { sends: { hall: -6 } }, (b) => {
    let t = 0.5;
    for (const m of notes("C3 G3 E4 D4 C4 G4 E5 C5")) {
      I.piano(b, t, m, { vel: 0.55, hold: 1.2 });
      t += 0.45;
    }
    I.piano(b, 4.2, 36, { vel: 0.7, hold: 3 });
    for (const m of notes("C4 E4 G4 B4")) I.piano(b, 4.2, m, { vel: 0.5, hold: 3, felt: 0.8 });
  });
  mix.part("pad", { sends: { hall: -3 } }, (b) => {
    for (const m of notes("C3 G3 E4")) I.ensemble(b, 7, m, { dur: 3, attack: 0.8, release: 1.2, vel: 0.5 });
    for (const m of notes("A2 E3 C4")) I.airPad(b, 7, m, { dur: 3, attack: 1, release: 1.5, vel: 0.5 });
  });
  mix.part("drums", { sends: { hall: -14 } }, (b) => {
    for (let k = 0; k < 8; k++) {
      I.kick(b, 0.5 + k * 0.5, { vel: 0.7 });
      I.hat(b, 0.75 + k * 0.5, { vel: 0.3 });
      I.tick(b, 0.5 + k * 0.25, { vel: 0.3 });
      I.shaker(b, 0.62 + k * 0.5, { vel: 0.3 });
    }
    I.boom(b, 10, { vel: 0.8 });
    I.timpani(b, 10, 38, { vel: 0.7 });
  });
  mix.part("keys", { sends: { hall: -8 } }, (b) => {
    for (const [k, m] of notes("C4 E4 G4 C5").entries()) {
      I.marimba(b, 8 + k * 0.25, m, { vel: 0.6 });
      I.epiano(b, 9.2 + k * 0.25, m - 12, { vel: 0.6, dur: 1 });
      I.bell(b, 10.4 + k * 0.3, m, { vel: 0.4 });
      I.bass(b, 8 + k * 0.5, m - 24, { vel: 0.7, dur: 0.4 });
      I.pluck(b, 9 + k * 0.25, m - 12, { vel: 0.6 });
    }
    I.noiseSwell(b, 12, { length: 2 });
  });
  const master = mix.finish();
  return {
    master,
    timeline: tl,
    log: mix.log,
    sections: [{ name: "試し", at: 0 }, { name: "無音", at: 13 }],
    hits: [{ name: "響き", at: 10 }],
    holds: [],
    anchors: {},
    masterOpts: { fadeFrom: 179, end: 179.9 },
  };
}
