// T116 地図の雨を降水量の段ごとの色に（docs/tasks/T116.md）。
// - 訓練の筋書きの雨（T103）を、気象庁の降水ナウキャストと同じ 8 段（1 時間の降水量 mm/h）と同じ色で描く。本物の雨雲と同じ読み方
// - 筋書きの表の強さは芯の降水量（mm/h）。強まって弱まり、時刻で北東へ動き、縁は不規則のまま。描く段は世界の警戒レベルの上限まで
// - 凡例（mm/h の段）を地図の右下に。「デモ」「想定値」の印と参考の出典は残し、地図に「気象庁」の語は出さない（T103）
// - 状態の 4 色のピンは、赤や黄の雨の上でも読める縁取り（面の色の縁と、その外の細い線）
// - 本物の雨雲（NowcastLayer）の画像は変えない: 気象庁の画像を加工せずに重ね、訓練の画面には重ねない（凡例は T151 で訓練の雨と同じ帯に）
// テストは外へ出ない（fetch を偽にして、呼ばれたら落とす）。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { NowcastLayer } from "../../components/map/NowcastLayer.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { HEAVY_RAIN_TRACK, type RainTrack } from "../drill/rain.ts";
import { applyEvents, EMPTY_WORLD, scenarioOf, type WorldState } from "../drill/scenarios.ts";
import { sourceById } from "../sources/index.ts";
import { demoOverlay, rainCapOf } from "./demo.ts";
import { drillRain, rainAnchor, rainFrame } from "./drill-rain.ts";
import { BASE_SIZE, fitView } from "./geo.ts";
import { RAIN_OPACITY, RAIN_STEPS, RAIN_STEPS_SOURCE, rainColor, rainStepOf, type RainMin } from "./rain-scale.ts";
import { mapPins, sideDisasterOf } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
const pins = mapPins(rows, "tier");
/** 発災時の行（ルールの表の結果つき。訓練の画面の右の面と同じ入力） */
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const drows = toCaseloadRows(people, clocks, contacts, "2026-11-02", {
  situation: { now: at(3.5), disasterAt: at(-2), outageAt: at(0), outageTowns: null },
  signals: new Map(),
});
const ANCHOR = rainAnchor(rows.flatMap((r) => (r.location ? [r.location] : [])));

const fetchSpy = vi.fn(() => {
  throw new Error("テストから外へ出ない");
});
beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
afterAll(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

/** 気象庁の降水ナウキャストの凡例の 8 段（弱い方から）と色（気象情報の配色の指針の降水量の段の値） */
const JMA_STEPS = [
  [0, "#f2f2ff"],
  [1, "#a0d2ff"],
  [5, "#218cff"],
  [10, "#0041ff"],
  [20, "#faf500"],
  [30, "#ff9900"],
  [50, "#ff2800"],
  [80, "#b40068"],
] as const;

function worldAt(id: "heavy_rain" | "short", hour: number): WorldState {
  return scenarioOf(id)
    .ticks.filter((t) => t.hour <= hour)
    .reduce((w, t) => applyEvents(w, t.events.filter((e) => (e.at ?? t.hour) <= hour), t.hour), EMPTY_WORLD);
}
const mins = (bands: { min: RainMin }[]) => [...new Set(bands.map((b) => b.min))].sort((a, b) => a - b);
const top = (bands: { min: RainMin }[]) => Math.max(-1, ...bands.map((b) => b.min));
const html = (level: 3 | 4 | 5, hour = 3, track: RainTrack = HEAVY_RAIN_TRACK) =>
  renderToStaticMarkup(
    createElement(CaseMap, { pins, layers: [], demo: demoOverlay({ kind: "heavy_rain", level, drill: { track, hour, anchor: ANCHOR } }), unplaced: 0 }),
  );
const svgOf = (h: string) => h.match(/<svg[^>]*data-demo="rain"[\s\S]*?<\/svg>/)?.[0] ?? "";
const legendOf = (h: string) => h.match(/<div[^>]*data-rain-legend[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
/** 芯の降水量を強くした表（警戒レベル 5 の色の段まで見るため。形と動きは大雨の想定と同じ） */
const STRONG: RainTrack = { ...HEAVY_RAIN_TRACK, keys: HEAVY_RAIN_TRACK.keys.map((k) => ({ ...k, peak: k.peak * 2.4 })) };

describe("降水量の段（lib/map/rain-scale.ts）", () => {
  it("気象庁の降水ナウキャストと同じ 8 段と色（弱い方から）", () => {
    expect(RAIN_STEPS.map((s) => [s.min, s.color])).toEqual(JMA_STEPS.map(([m, c]) => [m, c]));
    expect(RAIN_STEPS.map((s) => s.label)).toEqual(["1 未満", "1〜5", "5〜10", "10〜20", "20〜30", "30〜50", "50〜80", "80 以上"]);
    for (let i = 0; i + 1 < RAIN_STEPS.length; i++) expect(RAIN_STEPS[i].max).toBe(RAIN_STEPS[i + 1].min);
    expect(RAIN_STEPS.at(-1)!.max).toBeNull();
  });

  it("降水量 → 段: 下の境の値はその段に入り、上の境の値は次の段（0・負・数でない値は雨なし）", () => {
    const cases: [number, RainMin | null][] = [
      [0, null],
      [-1, null],
      [Number.NaN, null],
      [0.1, 0],
      [0.99, 0],
      [1, 1],
      [4.99, 1],
      [5, 5],
      [9.99, 5],
      [10, 10],
      [19.9, 10],
      [20, 20],
      [29.9, 20],
      [30, 30],
      [49.9, 30],
      [50, 50],
      [79.9, 50],
      [80, 80],
      [150, 80],
      [Number.POSITIVE_INFINITY, 80],
    ];
    for (const [mm, min] of cases) expect(rainStepOf(mm)?.min ?? null, `${mm} mm/h`).toBe(min);
    for (const [m, c] of JMA_STEPS) expect(rainColor(m)).toBe(c);
  });

  it("出典は登録簿の気象庁の雨雲の頁（作者の確認の印つき）", () => {
    const s = sourceById(RAIN_STEPS_SOURCE);
    expect(s.publisher).toBe("気象庁");
    expect(s.url).toMatch(/^https:\/\/www\.jma\.go\.jp\/bosai\/nowc\//);
  });
});

describe("筋書きの雨の強さは芯の降水量（lib/drill/rain.ts）", () => {
  const keys = HEAVY_RAIN_TRACK.keys;

  it("表の強さは mm/h。強まって（3 時間がいちばん強い）弱まり、最後は 0", () => {
    const peaks = keys.map((k) => k.peak);
    const i3 = keys.findIndex((k) => k.hour === 3);
    expect(Math.max(...peaks)).toBe(keys[i3].peak);
    for (let i = 1; i <= i3; i++) expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
    for (let i = i3 + 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(peaks.at(-1)).toBe(0);
  });

  it("表の時刻の芯の降水量は、その時刻の世界の警戒レベルの上限より弱い", () => {
    for (const k of keys) {
      const w = worldAt("heavy_rain", k.hour);
      if (k.peak === 0) continue;
      expect(k.peak, `${k.hour} 時間`).toBeLessThan(rainCapOf(w.alertLevel));
    }
  });

  it("警戒レベルの上限: 3 は 10〜20 まで、4 は 30〜50 まで、5 は 80 以上まで、解除は雨なし", () => {
    expect(rainCapOf(3)).toBe(20);
    expect(rainCapOf(4)).toBe(50);
    expect(rainCapOf(5)).toBe(Number.POSITIVE_INFINITY);
    expect(rainCapOf(null)).toBe(0);
    expect(top(drillRain(STRONG, 3, rainCapOf(3), ANCHOR))).toBe(10);
    expect(top(drillRain(STRONG, 3, rainCapOf(4), ANCHOR))).toBe(30);
    expect(top(drillRain(STRONG, 3, rainCapOf(5), ANCHOR))).toBe(80);
    expect(drillRain(STRONG, 3, rainCapOf(null), ANCHOR)).toEqual([]);
  });

  it("時刻で段が変わる: 0 時間は 10〜20 まで、3 時間は 30〜50 まで、24 時間は 5〜10 まで、30 時間のあとは雨なし", () => {
    const at = (h: number) => top(drillRain(HEAVY_RAIN_TRACK, h, Number.POSITIVE_INFINITY, ANCHOR));
    expect(at(0)).toBe(10);
    expect(at(1)).toBe(30);
    expect(at(3)).toBe(30);
    expect(at(12)).toBe(20);
    expect(at(24)).toBe(5);
    expect(at(30)).toBe(-1);
    expect(at(48)).toBe(-1);
    // 間の時刻は前後の間の強さ（連続の時計の分まで）
    expect(rainFrame(HEAVY_RAIN_TRACK, 2)!.peak).toBeGreaterThan(rainFrame(HEAVY_RAIN_TRACK, 1)!.peak);
    expect(rainFrame(HEAVY_RAIN_TRACK, 2)!.peak).toBeLessThan(rainFrame(HEAVY_RAIN_TRACK, 3)!.peak);
  });

  for (const id of ["heavy_rain", "short"] as const) {
    it(`${id}: 15 分ごとのどの時刻でも、描く段は世界の警戒レベルの上限より下`, () => {
      const drawn = new Set<number>();
      for (let h = 0; h <= 72; h += 0.25) {
        const w = worldAt(id, h);
        const side = sideDisasterOf(drows, { kind: "heavy_rain", alertLevel: w.alertLevel }, { rain: { scenario: id, hour: h } })!;
        const d = demoOverlay(side.scene!);
        for (const b of d.rain) {
          expect(b.min, `${h} 時間 レベル ${w.alertLevel}`).toBeLessThan(rainCapOf(w.alertLevel));
          drawn.add(b.min);
        }
      }
      // 上限で切るだけで、雨は描く（強い雨の段も出る）
      expect([...drawn].sort((a, b) => a - b)).toEqual([0, 1, 5, 10, 20, 30]);
    });
  }

  it("輪は弱い段から並ぶ（強い段が上に重なる）。段ごとの帯は 1 つ", () => {
    for (const h of [0, 1, 3, 6, 12, 24]) {
      const bands = drillRain(STRONG, h, Number.POSITIVE_INFINITY, ANCHOR);
      const order = bands.map((b) => b.min);
      expect(order, `${h} 時間`).toEqual([...order].sort((a, b) => a - b));
      const main = bands.filter((b) => b.main);
      expect(new Set(main.map((b) => b.min)).size).toBe(main.length);
    }
  });

  it("帯のまわりの小さな雨は弱い段だけ（10 未満）", () => {
    for (const h of [0, 3, 6, 9]) {
      for (const b of drillRain(STRONG, h, Number.POSITIVE_INFINITY, ANCHOR).filter((x) => !x.main)) expect(b.min).toBeLessThan(10);
    }
  });
});

describe("訓練の雨の描き（components/map/CaseMap.tsx の Rain）", () => {
  it("輪ごとに段の色の塗り 1 枚（淡い面・雨の筋・ぼかしは無い）。色は凡例と同じ値で、まとめて透かす", () => {
    const h = html(5, 3, STRONG);
    const svg = svgOf(h);
    const demo = demoOverlay({ kind: "heavy_rain", level: 5, drill: { track: STRONG, hour: 3, anchor: ANCHOR } });
    const polys = [...svg.matchAll(/<polygon [^>]*>/g)].map((m) => m[0]);
    expect(polys).toHaveLength(demo.rain.length);
    demo.rain.forEach((b, i) => {
      expect(polys[i]).toContain(`fill="${rainColor(b.min)}"`);
      expect(polys[i]).toContain(`data-rain-step="${b.min}"`);
    });
    for (const [m] of JMA_STEPS) expect(svg).toContain(`data-rain-step="${m}"`);
    expect(svg).toContain(`<g opacity="${RAIN_OPACITY}">`);
    for (const w of ["<pattern", "<line", "feGaussianBlur", "stroke-dasharray", "fill-opacity", "#8ba9c2", "#35669a", "currentColor", "var("]) {
      expect(svg, w).not.toContain(w);
    }
  });

  it("凡例: 地図の右下に 8 段（T151 から横の帯で左が弱い）、境の値、「想定」と mm/h。「気象庁」「警報」の語は無い", () => {
    const h = html(4);
    const legend = legendOf(h);
    expect(legend).not.toBe("");
    expect(legend).toMatch(/class="[^"]*absolute right-1 bottom-1[^"]*"/);
    const chips = [...legend.matchAll(/data-rain-legend-step="(\d+)" style="background:(#[0-9a-f]{6})/g)].map((m) => [Number(m[1]), m[2]]);
    expect(chips).toEqual(JMA_STEPS.map(([m, c]) => [m, c]));
    const bounds = [...legend.matchAll(/data-rain-legend-bound="(\d+)"[^>]*>(\d+)</g)].map((m) => Number(m[2]));
    expect(bounds).toEqual([1, 5, 10, 20, 30, 50, 80]);
    expect(legend).toContain("想定");
    expect(legend).toContain("mm/h");
    for (const s of RAIN_STEPS) expect(legend).toContain(s.label);
    for (const w of ["気象庁", "警報", "注意報"]) expect(h, w).not.toContain(w);
    // 「デモ」「想定値」の印と参考の出典は残る
    expect(h).toContain('data-demo="label"');
    expect(h).toContain("想定値");
    expect(h).toContain('data-demo="basis"');
  });

  it("雨を描かないとき（平時・解除）は凡例も出さない", () => {
    const calm = renderToStaticMarkup(createElement(CaseMap, { pins, layers: [], demo: demoOverlay({ kind: "heavy_rain", level: 4 }), unplaced: 0 }));
    expect(calm).not.toContain("data-rain-legend");
    const lifted = renderToStaticMarkup(
      createElement(CaseMap, { pins, layers: [], demo: demoOverlay({ kind: "heavy_rain", level: null, drill: { track: HEAVY_RAIN_TRACK, hour: 3, anchor: ANCHOR } }), unplaced: 0 }),
    );
    expect(lifted).not.toContain("data-rain-legend");
  });
});

describe("ピンの縁取り（赤や黄の雨の上でも読める）", () => {
  const disasterPins = pins.map((p, i) => ({ ...p, tone: (["urgent", "check", "unknown", "ok"] as const)[i % 4], state: ["至急", "要確認", "不明", "無事"][i % 4] }));

  it("名前の印と点は、面の色の縁（2px）とその外の細い線で囲む（ライトは白の縁、ダークは暗い面の縁）", () => {
    const h = html(4);
    const out = renderToStaticMarkup(createElement(CaseMap, { pins: disasterPins, layers: [], demo: null, unplaced: 0 }));
    for (const src of [h, out]) {
      const labels = [...src.matchAll(/<span class="([^"]*)"><span class="px-1 /g)].map((m) => m[1]);
      const plain = [...src.matchAll(/<a [^>]*><span class="([^"]*)">/g)].map((m) => m[1]);
      for (const c of [...labels, ...plain]) {
        expect(c).toContain("ring-2 ring-panel");
        expect(c).toMatch(/outline-1 outline-offset-2 outline-ink\/\d+/);
        expect(c).not.toContain("ring-ink/15");
      }
      const dots = [...src.matchAll(/<span class="([^"]*size-2 rounded-full[^"]*)"/g)].map((m) => m[1]);
      expect(dots.length).toBeGreaterThan(0);
      for (const c of dots) {
        expect(c).toContain("ring-2 ring-panel");
        expect(c).toMatch(/outline-1 outline-offset-2 outline-ink\/\d+/);
      }
    }
    // 状態の 4 色の印は前のまま（塗りの色と文字の色は変えない）
    for (const t of ["bg-state-urgent-fill text-on-state-urgent", "bg-state-check-fill text-on-state-check", "bg-state-unknown-fill", "bg-state-ok-fill"]) {
      expect(out).toContain(t);
    }
  });
});

describe("本物の雨雲は変えない（NowcastLayer）", () => {
  it("気象庁の画像を加工せずに重ね（透かし・色の変え・混ぜ方なし）、凡例は訓練の雨と同じ帯（T151 で気象庁の凡例の画像から替えた）", () => {
    const view = fitView(pins.map((p) => p.location), { minZ: 11, maxZ: 15, fallback: ANCHOR });
    const h = renderToStaticMarkup(
      createElement(NowcastLayer, { time: { basetime: "20261105000000", validtime: "20261105000000" }, view, size: BASE_SIZE }),
    );
    const tiles = [...h.matchAll(/<img [^>]*data-layer="nowcast"[^>]*>/g)].map((m) => m[0]);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t).not.toMatch(/opacity|filter|mix-blend|brightness|saturate|hue-rotate/);
      expect(t).toContain('src="/api/jma/nowc/tile/');
    }
    expect(h).not.toContain("jma.go.jp");
    expect(h).toContain('data-rain-legend="nowcast"');
    expect(h).not.toContain('data-rain-legend="drill"');
  });

  it("訓練の画面は本物の雨雲を重ねない（筋書きの雨だけ）", () => {
    const src = readFileSync(new URL("../../app/drill/[id]/page.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/nowcast/);
  });
});
