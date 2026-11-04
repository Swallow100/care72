// T103 地図の雨の範囲（docs/tasks/T103.md。決めは (c)）。
// - 平時（訓練でない担当一覧。デモ事業所も本物の事業所も）は本物の雨雲（T72 の旗 JMA_NOWCAST。既定は off で何も出さない）。
//   デモの固定の帯は描かない（ハザードの既定の層は残す）
// - 訓練は筋書きの雨（lib/drill/rain.ts の表の種と時刻ごとの形）: 不規則な縁、時刻で北東へ動き、強まり弱まる。強さの段は被害状況の
//   警戒レベル（世界の状態）を超えない。サーバーと手元で同じ絵（決まった種、時計・乱数を使わない）。「デモ」の印と参考にした過去の雨の出典
// - 強さは T116 で降水量（mm/h）の 8 段（lib/map/rain-scale.ts）に替えた。前の弱・強・猛の 3 段の所は段の下の境（0・1・5・10・20・30）で言い直した
// - 雨は色と連絡順に使わない（ルールの表だけ）
// テストは外へ出ない（fetch を偽にして、呼ばれたら落とす）。

import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SidePane } from "../../components/list/SidePane.tsx";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import type { GeoPoint } from "../db/types.ts";
import { HEAVY_RAIN_TRACK, RAIN_TRACKS, rainTrackOf, type RainTrack } from "../drill/rain.ts";
import { applyEvents, EMPTY_WORLD, scenarioOf, type WorldState } from "../drill/scenarios.ts";
import { checkMark, sourceById } from "../sources/index.ts";
import type { TriageSignal } from "../triage/index.ts";
import { demoOverlay, rainCapOf, type RainBand } from "./demo.ts";
import { drillRain, rainAnchor, rainFrame } from "./drill-rain.ts";
import { rainColor, type RainMin } from "./rain-scale.ts";
import { buildSidePane, sideDisasterOf } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const signals = new Map<string, TriageSignal[]>([
  ["p-01", [{ color: "red", source: "self", at: at(0.5), injured: null, canMove: null, classes: ["unknown"] }]],
  ["p-03", [{ color: "green", source: "family", at: at(-1) }]],
]);
const situation = { now: at(3.5), disasterAt: at(-2), outageAt: at(0), outageTowns: null };
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02", { situation, signals });
const ANCHOR = rainAnchor(rows.flatMap((r) => (r.location ? [r.location] : [])));

const fetchSpy = vi.fn(() => {
  throw new Error("テストから外へ出ない");
});
beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
afterAll(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

/** 世界の状態を想定の表のとおりに hour まで当てる（訓練の画面の被害状況と同じ） */
function worldAt(id: "heavy_rain" | "short", hour: number): WorldState {
  return scenarioOf(id)
    .ticks.filter((t) => t.hour <= hour)
    .reduce((w, t) => applyEvents(w, t.events.filter((e) => (e.at ?? t.hour) <= hour), t.hour), EMPTY_WORLD);
}

/** 描いた段（下の境 mm/h、弱い順） */
const strengths = (bands: RainBand[]) => [...new Set(bands.map((b) => b.min))].sort((a, b) => a - b);
const main = (bands: RainBand[], k: RainMin) => bands.find((b) => b.min === k && b.main) ?? null;
/** 輪の重心（頂点の平均） */
const centroid = (ring: GeoPoint[]) => ({
  lat: ring.reduce((a, p) => a + p.lat, 0) / ring.length,
  lng: ring.reduce((a, p) => a + p.lng, 0) / ring.length,
});
/** 輪の面積（km²、真ん中の緯度で平面に写して） */
function areaKm2(ring: GeoPoint[]): number {
  const k = 111.32;
  const c = Math.cos((ring[0].lat * Math.PI) / 180);
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.lng * k * c * (b.lat * k) - b.lng * k * c * (a.lat * k);
  }
  return Math.abs(s) / 2;
}
function inside(p: GeoPoint, ring: GeoPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) hit = !hit;
  }
  return hit;
}

describe("筋書きの雨の表（lib/drill/rain.ts）", () => {
  it("大雨と 10 分版は同じ表、地震と仮想は雨の表なし", () => {
    expect(rainTrackOf("heavy_rain")).toBe(HEAVY_RAIN_TRACK);
    expect(rainTrackOf("short")).toBe(HEAVY_RAIN_TRACK);
    expect(rainTrackOf("earthquake")).toBeNull();
    expect(rainTrackOf("virtual")).toBeNull();
    expect(Object.keys(RAIN_TRACKS).sort()).toEqual(["heavy_rain", "short"]);
  });

  it("種は表に固定した整数、時刻は 0 から増える順、根拠は出典の登録簿の id", () => {
    expect(Number.isInteger(HEAVY_RAIN_TRACK.seed)).toBe(true);
    const hours = HEAVY_RAIN_TRACK.keys.map((k) => k.hour);
    expect(hours[0]).toBe(0);
    expect([...hours].sort((a, b) => a - b)).toEqual(hours);
    expect(new Set(hours).size).toBe(hours.length);
    expect(sourceById(HEAVY_RAIN_TRACK.basis).publisher).toBe("気象庁");
    expect(HEAVY_RAIN_TRACK.keys.at(-1)?.peak).toBe(0);
  });
});

describe("筋書きの雨の形（lib/map/drill-rain.ts）", () => {
  /** 上限なし（どの段も描く） */
  const ALL = Number.POSITIVE_INFINITY;

  it("同じ表と時刻なら同じ絵（何度作っても、小数の時刻でも）。種を変えると縁が変わる", () => {
    for (const h of [0, 1, 2.5, 3, 7.25, 12, 23.5]) {
      expect(drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR)).toEqual(drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR));
    }
    const other: RainTrack = { ...HEAVY_RAIN_TRACK, seed: HEAVY_RAIN_TRACK.seed + 1 };
    expect(drillRain(other, 3, ALL, ANCHOR)).not.toEqual(drillRain(HEAVY_RAIN_TRACK, 3, ALL, ANCHOR));
  });

  it("時計と乱数を使わない（Date・Math.random を読まない）", () => {
    const src = readFileSync(new URL("./drill-rain.ts", import.meta.url), "utf8") + readFileSync(new URL("../drill/rain.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Math\.random|Date\.now|new Date/);
  });

  it("位置は 5 桁に丸める（約 1 m。サーバーと手元で端数が食い違わない）", () => {
    for (const b of drillRain(HEAVY_RAIN_TRACK, 3, ALL, ANCHOR)) {
      for (const p of b.ring) {
        expect(Math.round(p.lat * 1e5) / 1e5).toBe(p.lat);
        expect(Math.round(p.lng * 1e5) / 1e5).toBe(p.lng);
      }
    }
  });

  it("縁は不規則（帯の芯からの距離が一定でない）で、小さな雨も散らばる", () => {
    const b = main(drillRain(HEAVY_RAIN_TRACK, 3, ALL, ANCHOR), 0)!;
    const c = centroid(b.ring);
    const d = b.ring.map((p) => Math.hypot(p.lat - c.lat, (p.lng - c.lng) * 0.83));
    const m = d.reduce((a, x) => a + x, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / d.length);
    expect(sd / m).toBeGreaterThan(0.2);
    expect(b.ring.length).toBeGreaterThanOrEqual(40);
    const extra = [0, 1, 3, 6, 9, 12].map((h) => drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR).filter((x) => !x.main).length);
    expect(Math.max(...extra)).toBeGreaterThan(0);
    for (const h of [0, 3, 9]) {
      for (const x of drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR).filter((y) => !y.main)) expect(x.min).toBeLessThan(10);
    }
  });

  it("時刻で北東へ動く（いちばん外の帯の重心の緯度も経度も増える）", () => {
    const hs = [0, 3, 6, 12, 18, 24];
    const cs = hs.map((h) => centroid(main(drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR), 0)!.ring));
    for (let i = 1; i < cs.length; i++) {
      expect(cs[i].lat, `${hs[i]} 時間`).toBeGreaterThan(cs[i - 1].lat);
      expect(cs[i].lng, `${hs[i]} 時間`).toBeGreaterThan(cs[i - 1].lng);
    }
    // 間の時刻は前後の間（連続の時計で滑らかに）
    const mid = centroid(main(drillRain(HEAVY_RAIN_TRACK, 4.5, ALL, ANCHOR), 0)!.ring);
    expect(mid.lat).toBeGreaterThan(cs[1].lat);
    expect(mid.lat).toBeLessThan(cs[2].lat);
  });

  it("強まって弱まる: 発災のすぐあとに強い段が増え、1 日で弱い段だけになり、最後の時刻のあとは雨なし", () => {
    const at = (h: number) => strengths(drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR));
    expect(at(0)).toEqual([0, 1, 5, 10]);
    expect(at(3)).toEqual([0, 1, 5, 10, 20, 30]);
    expect(at(24)).toEqual([0, 1, 5]);
    const last = HEAVY_RAIN_TRACK.keys.at(-1)!.hour;
    expect(at(last)).toEqual([]);
    expect(at(48)).toEqual([]);
    expect(at(72)).toEqual([]);
    const area = (h: number) => areaKm2(main(drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR), 0)!.ring);
    expect(area(3)).toBeGreaterThan(area(0));
    expect(area(3)).toBeGreaterThan(area(24));
    // 強い段（10〜20）の帯も 3 時間がいちばん広い
    const core = (h: number) => areaKm2(main(drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR), 10)!.ring);
    expect(core(3)).toBeGreaterThan(core(0));
    expect(core(3)).toBeGreaterThan(core(12));
    expect(rainFrame(HEAVY_RAIN_TRACK, 3)!.peak).toBeGreaterThan(rainFrame(HEAVY_RAIN_TRACK, 24)!.peak);
  });

  it("強い所は弱い所の内側（入れ子。段ごとに 1 つ前の段の内側）", () => {
    const steps: RainMin[] = [0, 1, 5, 10, 20, 30, 50, 80];
    for (const h of [0, 1, 3, 6, 9, 12, 18, 24]) {
      const bands = drillRain(HEAVY_RAIN_TRACK, h, ALL, ANCHOR);
      for (let i = 1; i < steps.length; i++) {
        const inner = main(bands, steps[i]);
        if (!inner) continue;
        const outer = main(bands, steps[i - 1])!;
        for (const p of inner.ring) expect(inside(p, outer.ring), `${h} 時間 段 ${steps[i]}`).toBe(true);
      }
    }
  });

  it("描く段は渡した上限の降水量の下まで（警戒レベルの上限）。上限 0 は雨なし", () => {
    expect(strengths(drillRain(HEAVY_RAIN_TRACK, 3, 20, ANCHOR))).toEqual([0, 1, 5, 10]);
    expect(strengths(drillRain(HEAVY_RAIN_TRACK, 3, 50, ANCHOR))).toEqual([0, 1, 5, 10, 20, 30]);
    expect(drillRain(HEAVY_RAIN_TRACK, 3, 0, ANCHOR)).toEqual([]);
  });

  it("帯は利用者の位置の範囲の真ん中に合わせる（本物の事業所の訓練でも地図の中を通る）。位置が無ければ松山市の市街", () => {
    expect(rainAnchor([])).toEqual({ lat: 33.84, lng: 132.765 });
    expect(rainAnchor([{ lat: 34, lng: 135 }, { lat: 34.2, lng: 135.4 }])).toEqual({ lat: 34.1, lng: 135.2 });
    const far = rainAnchor([{ lat: 35.6812, lng: 139.7671 }]);
    const c = centroid(main(drillRain(HEAVY_RAIN_TRACK, 6, Number.POSITIVE_INFINITY, far), 0)!.ring);
    expect(Math.abs(c.lat - far.lat)).toBeLessThan(0.1);
    expect(Math.abs(c.lng - far.lng)).toBeLessThan(0.1);
  });
});

describe("被害状況（警戒レベル・浸水）と地図の雨が食い違わない", () => {
  for (const id of ["heavy_rain", "short"] as const) {
    it(`${id}: どの刻みでも雨の段は警戒レベルの上限まで、解除のあとは雨なし、浸水の刻みは強い雨（20 mm/h 以上の段）`, () => {
      const hours = scenarioOf(id).hours;
      for (const h of hours) {
        const w = worldAt(id, h);
        const side = sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: w.alertLevel }, { rain: { scenario: id, hour: h } })!;
        const d = demoOverlay(side.scene!);
        for (const b of d.rain) expect(b.min, `${h} 時間`).toBeLessThan(rainCapOf(w.alertLevel));
        if (w.alertLevel === null) expect(d.rain, `${h} 時間`).toEqual([]);
        if (w.flood && h <= 6) expect(strengths(d.rain), `${h} 時間`).toContain(20);
      }
    });
  }

  it("大雨の想定の刻みごとの段（レベル 3 → 4 → 3 → 解除。レベル 3 は 10〜20 まで、4 は 30〜50 まで）", () => {
    const at = (h: number) => {
      const w = worldAt("heavy_rain", h);
      const side = sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: w.alertLevel }, { rain: { scenario: "heavy_rain", hour: h } })!;
      return strengths(demoOverlay(side.scene!).rain);
    };
    expect(at(0)).toEqual([0, 1, 5, 10]);
    expect(at(1)).toEqual([0, 1, 5, 10, 20, 30]);
    expect(at(3)).toEqual([0, 1, 5, 10, 20, 30]);
    expect(at(24)).toEqual([0, 1, 5]);
    expect(at(48)).toEqual([]);
    expect(at(72)).toEqual([]);
  });
});

describe("場面と画面", () => {
  it("平時（担当一覧）の大雨の場面は雨を描かず、デモの帯も出さない。ハザードの既定の層は残す", () => {
    for (const office of ["demo", "regular"] as const) {
      const side = sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: 4 }, { office });
      const data = buildSidePane(rows, { sort: "tier", disaster: side });
      if (office === "demo") {
        expect(data.demo?.rain).toEqual([]);
        expect(data.demo?.layers).toEqual(["flood", "landslide"]);
      }
      const html = renderToStaticMarkup(createElement(SidePane, { data }));
      expect(html, office).not.toContain('data-demo="label"');
      expect(html, office).not.toContain('data-demo="rain"');
      expect(html, office).not.toContain("想定値");
    }
  });

  it("訓練の大雨: 「デモ」の印・場面の名前・想定値・参考にした過去の雨（出典の登録簿の題名と確認の印）", () => {
    const side = sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: 4 }, { rain: { scenario: "heavy_rain", hour: 3 } })!;
    const data = buildSidePane(rows, { sort: "tier", disaster: side });
    const html = renderToStaticMarkup(createElement(SidePane, { data }));
    const s = sourceById(HEAVY_RAIN_TRACK.basis);
    expect(html).toMatch(/data-demo="label"[^>]*><span class="font-bold">デモ<\/span><span[^>]*>大雨 レベル 4<\/span>/);
    expect(html).toContain('data-demo="rain"');
    expect(html).toContain("想定値");
    const basis = html.match(/<[^>]*data-demo="basis"[\s\S]*?<\/span><\/span>/)?.[0] ?? "";
    expect(basis).toContain(`href="${s.url}"`);
    expect(basis).toContain("平成30年7月豪雨");
    expect(basis).toContain(checkMark(HEAVY_RAIN_TRACK.basis));
    // 本物の警報と見間違える言葉を使わない（出典の題名にも無い）
    for (const w of ["警報", "注意報", "速報", "気象庁"]) expect(html, w).not.toContain(w);
  });

  it("訓練の雨は帯と小さな雨の輪を全部描く。色は降水量の段の色（T116。前は T96 の淡い面と筋）", () => {
    const demo = demoOverlay({ kind: "heavy_rain", level: 5, drill: { track: HEAVY_RAIN_TRACK, hour: 3, anchor: ANCHOR } });
    const html = renderToStaticMarkup(createElement(CaseMap, { pins: [], layers: [], demo, unplaced: 0 }));
    const svg = html.match(/<svg[^>]*data-demo="rain"[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect([...svg.matchAll(/data-rain-step=/g)]).toHaveLength(demo.rain.length);
    expect(demo.rain.some((b) => !b.main)).toBe(true);
    for (const b of demo.rain) expect(svg).toContain(`fill="${rainColor(b.min)}"`);
    expect(svg).not.toContain("<pattern");
    // 雨雲の切替が出る
    expect(html).toContain('data-toggle="rain"');
  });

  it("輪の点は 0.1px に丸める（サーバーと手元の投影の最後の桁の違いで描き直しが食い違わない）", () => {
    const demo = demoOverlay({ kind: "heavy_rain", level: 4, drill: { track: HEAVY_RAIN_TRACK, hour: 3, anchor: ANCHOR } });
    const html = renderToStaticMarkup(createElement(CaseMap, { pins: [], layers: [], demo, unplaced: 0 }));
    const nums = [...html.matchAll(/<polygon points="([^"]+)"/g)].flatMap((m) => m[1].split(/[ ,]/).map(Number));
    expect(nums.length).toBeGreaterThan(100);
    for (const n of nums) expect(Math.round(n * 10) / 10).toBe(n);
  });

  it("訓練の仮想モードと地震は筋書きの雨を描かない", () => {
    const virtual = sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: 4 }, { scene: false, rain: { scenario: "virtual", hour: 3 } })!;
    expect(virtual.scene).toBeNull();
    const quake = sideDisasterOf(rows, { kind: "earthquake", alertLevel: null }, { rain: { scenario: "earthquake", hour: 3 } })!;
    expect(demoOverlay(quake.scene!).rain).toEqual([]);
  });
});

describe("雨は色と連絡順に使わない", () => {
  it("雨の時刻を変えても結果・ピンの色・重なりの順は同じ", () => {
    const pane = (hour: number | null) =>
      buildSidePane(rows, {
        sort: "tier",
        disaster: sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: 4 }, hour === null ? {} : { rain: { scenario: "heavy_rain", hour } }),
      });
    const base = pane(null);
    for (const h of [0, 3, 12, 72]) {
      const p = pane(h);
      expect(p.pins).toEqual(base.pins);
      expect(p.states).toEqual(base.states);
      expect(p.hazards).toEqual(base.hazards);
    }
  });

  it("ルールの表（lib/triage）は地図・雨の表を読まない", () => {
    const dir = new URL("../triage/", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/from ["'][^"']*(\/map\/|drill\/rain)/);
    }
  });
});

describe("画面の入口", () => {
  it("訓練の画面は想定と見ている時刻（連続の時計の分まで）を渡す", () => {
    const src = readFileSync(new URL("../../app/drill/[id]/page.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/rain: \{ scenario: s\.drill\.scenario, hour: nowHour\(s\.state\) \}/);
  });

  it("担当一覧はデモ事業所でも本物の雨雲を重ねる（旗が on のときだけ。既定は off）", () => {
    const src = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/nowcast: nowcastOn\(env\) \}/);
    expect(src).not.toMatch(/nowcastOn\(env\) && principal\.office\.kind !== "demo"/);
  });
});
