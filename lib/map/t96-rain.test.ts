// T96 雨雲の見た目（docs/tasks/T96.md の 1）。
// 淡い青灰の面と、細く短い雨の筋を不規則な間で（長い線を等間隔に並べない）。強いほど筋が詰み面が濃い。気象庁の色の段は使わない。
// 凡例の言葉とデモの印はそのまま。見た目は手元の dev で 375・1280、ライトとダークを撮った（docs/progress/t96）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { demoOverlay, RAIN_FILL, RAIN_SLANT_DEG, RAIN_STREAK, RAIN_STYLE, rainStreaks, type RainStreak } from "./demo.ts";
import { mapPins } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
const pins = mapPins(rows, "tier");
const STRENGTHS = [1, 2, 3] as const;

const len = (s: RainStreak) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const stdev = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** 気象庁の降水ナウキャストの色の段（凡例の 8 色）。デモの雨雲はこのどれとも同じにしない */
const JMA_RAIN_STEPS = ["#f2f2ff", "#a0d2ff", "#218cff", "#0041ff", "#fff500", "#ff9900", "#ff2800", "#b40068"];

describe("雨雲の筋（lib/map/demo.ts の rainStreaks）", () => {
  it("決まった並び（描くたびに変わらない。サーバーと手元の描画が食い違わない）で、強さごとの本数", () => {
    for (const k of STRENGTHS) {
      expect(rainStreaks(k)).toEqual(rainStreaks(k));
      expect(rainStreaks(k)).toHaveLength(RAIN_STYLE[k].streaks);
    }
    expect(rainStreaks(1)).not.toEqual(rainStreaks(2).slice(0, RAIN_STYLE[1].streaks));
  });

  it("筋は短く（タイルの 4 分の 1 より短い）、同じ向きに斜め（縦から左へ）", () => {
    for (const k of STRENGTHS) {
      const [lo, hi] = RAIN_STYLE[k].length;
      for (const group of rainStreaks(k)) {
        for (const s of group) {
          expect(len(s)).toBeGreaterThanOrEqual(lo - 0.2);
          expect(len(s)).toBeLessThanOrEqual(hi + 0.2);
          expect(len(s)).toBeLessThan(RAIN_STYLE[k].tile / 4);
          // 下へ落ちて左へ流れる
          expect(s.y2).toBeGreaterThan(s.y1);
          expect(s.x2).toBeLessThan(s.x1);
          const deg = (Math.atan2(s.x1 - s.x2, s.y2 - s.y1) * 180) / Math.PI;
          expect(Math.abs(deg - RAIN_SLANT_DEG)).toBeLessThan(2);
        }
      }
    }
  });

  it("間は不規則（等間隔の格子に並ばない）で、タイル全体に散らばる", () => {
    for (const k of STRENGTHS) {
      const tile = RAIN_STYLE[k].tile;
      const starts = rainStreaks(k).map((g) => g[0]);
      for (const axis of ["x1", "y1"] as const) {
        const sorted = starts.map((s) => s[axis]).sort((a, b) => a - b);
        const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
        // 等間隔なら隙間のばらつきは 0
        expect(stdev(gaps), `${k} ${axis}`).toBeGreaterThan(0.8);
        // 片側に寄らない（タイルの 4 つの帯のどれにも筋の始まりがある）
        for (let q = 0; q < 4; q++) {
          expect(sorted.some((v) => v >= (tile * q) / 4 && v < (tile * (q + 1)) / 4), `${k} ${axis} ${q}`).toBe(true);
        }
      }
      // 始まりはタイルの中
      for (const s of starts) {
        expect(s.x1).toBeGreaterThanOrEqual(0);
        expect(s.x1).toBeLessThanOrEqual(tile);
        expect(s.y1).toBeGreaterThanOrEqual(0);
        expect(s.y1).toBeLessThanOrEqual(tile);
      }
    }
  });

  it("タイルの端をまたぐ筋は反対の端にも写す（くり返しの境で切れない）", () => {
    for (const k of STRENGTHS) {
      const tile = RAIN_STYLE[k].tile;
      for (const group of rainStreaks(k)) {
        const [s] = group;
        const outX = s.x2 < 0;
        const outY = s.y2 > tile;
        expect(group).toHaveLength((outX ? 2 : 1) * (outY ? 2 : 1));
        if (outX) expect(group.some((c) => Math.abs(c.x1 - (s.x1 + tile)) < 0.11 && c.y1 === s.y1)).toBe(true);
        if (outY) expect(group.some((c) => c.x1 === s.x1 && Math.abs(c.y1 - (s.y1 - tile)) < 0.11)).toBe(true);
      }
    }
  });

  it("強いほど筋の量（面積あたりの筋の長さの合計）が多く、帯の重なる芯ほど面が濃い", () => {
    const ink = (k: (typeof STRENGTHS)[number]) =>
      rainStreaks(k).reduce((a, g) => a + len(g[0]), 0) / (RAIN_STYLE[k].tile * RAIN_STYLE[k].tile);
    expect(ink(2)).toBeGreaterThan(ink(1));
    expect(ink(3)).toBeGreaterThan(ink(2));
    const core = 1 - STRENGTHS.reduce<number>((a, k) => a * (1 - RAIN_STYLE[k].fill), 1);
    expect(core).toBeGreaterThan(RAIN_STYLE[1].fill * 1.6);
    // 弱だけの所も地図の上で見える濃さ、芯でも下の地図とピンが透ける濃さ
    expect(RAIN_STYLE[1].fill).toBeGreaterThanOrEqual(0.2);
    expect(core).toBeLessThan(0.6);
  });

  it("色は淡い青灰の面と、澄んだ青の筋。気象庁の雨雲の色の段のどれとも違う", () => {
    const [fr, fg, fb] = rgb(RAIN_FILL);
    // 青が強く、彩りは控えめ（灰に近い）、明るい
    expect(fb).toBeGreaterThan(fg);
    expect(fg).toBeGreaterThan(fr);
    expect(fb - fr).toBeLessThan(80);
    expect((fr + fg + fb) / 3).toBeGreaterThan(150);
    const [sr, sg, sb] = rgb(RAIN_STREAK);
    expect(sb).toBeGreaterThan(sg);
    expect(sg).toBeGreaterThan(sr);
    // 筋は面より暗い（地図の上で筋が読める）
    expect(sr + sg + sb).toBeLessThan(fr + fg + fb - 150);
    for (const c of [RAIN_FILL, RAIN_STREAK]) expect(JMA_RAIN_STEPS).not.toContain(c.toLowerCase());
  });
});

describe("雨雲の描き（components/map/CaseMap.tsx の Rain）", () => {
  const svgOf = (level: 3 | 4 | 5) => {
    const html = renderToStaticMarkup(
      createElement(CaseMap, { pins, layers: ["flood"], demo: demoOverlay({ kind: "heavy_rain", level }), unplaced: 0 }),
    );
    return { html, rain: html.match(/<svg[^>]*data-demo="rain"[\s\S]*?<\/svg>/)?.[0] ?? "" };
  };

  it("レベル 5: 帯ごとにぼかした面と筋の 2 枚。斜線（回した長い線）・破線の縁は無い", () => {
    const { html, rain } = svgOf(5);
    expect(rain).not.toBe("");
    expect([...rain.matchAll(/<pattern /g)]).toHaveLength(3);
    expect([...rain.matchAll(/data-rain-fill="\d"/g)]).toHaveLength(3);
    expect([...rain.matchAll(/data-rain-streaks="\d"/g)]).toHaveLength(3);
    expect(rain).toContain("feGaussianBlur");
    expect(rain).not.toContain("stroke-dasharray");
    expect(rain).not.toContain("rotate(");
    const lines = [...rain.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"[^>]*>/g)];
    expect(lines.length).toBeGreaterThanOrEqual(STRENGTHS.reduce<number>((a, k) => a + RAIN_STYLE[k].streaks, 0));
    for (const m of lines) {
      const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThan(10);
      expect(m[0]).toContain('stroke-linecap="round"');
      expect(m[0]).toContain(`stroke="${RAIN_STREAK}"`);
    }
    // 凡例の言葉とデモの印はそのまま
    expect(html).toContain('data-demo="label"');
    expect(html).toContain("大雨 レベル 5");
    expect(html).toContain("想定値");
  });

  it("レベル 3 は弱の帯だけ（面 1 枚と筋 1 枚）", () => {
    const { rain } = svgOf(3);
    expect([...rain.matchAll(/<pattern /g)]).toHaveLength(1);
    expect(rain).toContain('data-rain-fill="1"');
    expect(rain).not.toContain('data-rain-fill="2"');
  });
});
