// T151b 平時の雨雲が町の縮尺でも出ること・見えている所に雨が無いときの「範囲内 雨なし」（docs/tasks/T151b.md）。
// - 地図が段 10 より寄ると段 10 のタイルを引き伸ばし、段 5 より引くと段 5 のタイルを縮めて並べる（画像は加工しない）
// - 見えている画素の範囲、雨の有無（透明でない画素）、まとめ方
// - 凡例の左の「範囲内 雨なし」は、雨が無いと分かったときだけ
// テストは外へ出ない（fetch を偽にして、呼ばれたら落とす）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NowcastLayer, NowcastNote } from "../../components/map/NowcastLayer.tsx";
import { LEGEND_W } from "../../components/map/RainScaleLegend.tsx";
import { NOWC_ZOOM } from "../jma/nowcast.ts";
import { BASE_SIZE, project, tilesFor, type View } from "./geo.ts";
import { MAP_UI } from "./labels.ts";
import { hasRain, rainInView, TILE_PX, visiblePixels } from "./rain-in-view.ts";
import { RAIN_STEPS } from "./rain-scale.ts";

const fetchSpy = vi.fn(() => {
  throw new Error("テストから外へ出ない");
});
beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
afterAll(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const MATSUYAMA = { lat: 33.84, lng: 132.765 };
const at = (z: number): View => ({ z, center: project(MATSUYAMA, z) });
const TIME = { basetime: "20261106034000", validtime: "20261106034000" };

describe("雨雲のタイルの段（町の縮尺でも出る）", () => {
  it("地図が段 10 より寄ると段 10 のタイルを引き伸ばして並べ、枠を覆う（右の面の地図のふだんの 12〜15）", () => {
    for (const z of [11, 12, 13, 14, 15, 18]) {
      const tiles = tilesFor(at(z), BASE_SIZE, { range: NOWC_ZOOM });
      expect(tiles.length, `z${z}`).toBeGreaterThan(0);
      expect(tiles.every((t) => t.z === 10)).toBe(true);
      // 1 枚の大きさは 256 × 2^(z − 10) px
      expect(tiles[0].width).toBeCloseTo(((256 * 2 ** (z - 10)) / BASE_SIZE.w) * 100);
      // 枠の真ん中を覆うタイルがある
      expect(tiles.some((t) => t.left <= 50 && t.left + t.width >= 50 && t.top <= 50 && t.top + t.height >= 50)).toBe(true);
    }
  });

  it("段 5 より引くと段 5 のタイルを縮めて並べる。5〜10 の間はその段のまま", () => {
    const far = tilesFor(at(4), BASE_SIZE, { range: NOWC_ZOOM });
    expect(far.every((t) => t.z === 5)).toBe(true);
    expect(far[0].width).toBeCloseTo((128 / BASE_SIZE.w) * 100);
    expect(tilesFor(at(7), BASE_SIZE, { range: NOWC_ZOOM }).every((t) => t.z === 7)).toBe(true);
  });

  it("画面の地図（段 13）でも雨雲のタイルを Workers の route の段 10 で重ねる（加工しない）", () => {
    const h = renderToStaticMarkup(createElement(NowcastLayer, { time: TIME, view: at(13), size: BASE_SIZE }));
    const srcs = [...h.matchAll(/<img src="([^"]+)"[^>]*data-layer="nowcast"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((s) => s.startsWith(`/api/jma/nowc/tile/${TIME.basetime}/${TIME.validtime}/10/`))).toBe(true);
  });
});

describe("見えている所の雨（lib/map/rain-in-view.ts）", () => {
  it("見えている画素: 枠に全部入るタイルは全部、はみ出すタイルは見えている所だけ、引き伸ばしたタイルは一部、外なら null", () => {
    expect(visiblePixels({ left: 10, top: 10, width: 50, height: 50 })).toEqual({ x0: 0, y0: 0, x1: 256, y1: 256 });
    // 左半分が枠の外
    expect(visiblePixels({ left: -25, top: 0, width: 50, height: 100 })).toEqual({ x0: 128, y0: 0, x1: 256, y1: 256 });
    // 段 13 で段 10 を 8 倍に引き伸ばした 1 枚: 枠（100%）は 1 枚の 352/2048 ほど
    const big = visiblePixels({ left: -300, top: -200, width: (2048 / 352) * 100, height: (2048 / 300) * 100 });
    expect(big).not.toBeNull();
    expect(big!.x1 - big!.x0).toBeLessThanOrEqual(Math.ceil((352 / 2048) * 256) + 1);
    expect(visiblePixels({ left: 120, top: 0, width: 50, height: 50 })).toBeNull();
    expect(visiblePixels({ left: -60, top: 0, width: 50, height: 50 })).toBeNull();
  });

  it("雨の有無は見えている範囲の透明でない画素（気象庁のタイルの番号 0・1 は透明）", () => {
    const data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
    const all = { x0: 0, y0: 0, x1: TILE_PX, y1: TILE_PX };
    expect(hasRain(data, TILE_PX, all)).toBe(false);
    data[(200 * TILE_PX + 10) * 4 + 3] = 255; // (10, 200) に雨
    expect(hasRain(data, TILE_PX, all)).toBe(true);
    expect(hasRain(data, TILE_PX, { x0: 0, y0: 0, x1: 128, y1: 128 })).toBe(false);
    expect(hasRain(data, TILE_PX, { x0: 0, y0: 128, x1: 128, y1: 256 })).toBe(true);
  });

  it("まとめ: 1 枚でも雨があれば雨あり、全部読めて雨が無ければ雨なし、読めないタイルがあれば分からない", () => {
    expect(rainInView([false, true, null])).toBe("rain");
    expect(rainInView([false, false])).toBe("none");
    expect(rainInView([false, null])).toBe("unknown");
    expect(rainInView([])).toBe("unknown");
  });
});

describe("凡例の左の「範囲内 雨なし」", () => {
  it("雨が無いと分かったときだけ。凡例と同じ下の線で、凡例の左（地図を隠さない小さな字）", () => {
    const none = renderToStaticMarkup(createElement(NowcastNote, { state: "none" }));
    expect(none).toContain(`>${MAP_UI.rainNone}<`);
    expect(MAP_UI.rainNone).toBe("範囲内 雨なし");
    expect(none).toMatch(/class="[^"]*absolute bottom-1[^"]*text-\[10px\][^"]*"/);
    expect(none).toContain(`right:${LEGEND_W + 8}px`);
    for (const s of ["checking", "rain", "unknown"] as const) {
      expect(renderToStaticMarkup(createElement(NowcastNote, { state: s }))).toBe("");
    }
    // サーバーの描画（読む前）では出さない
    const h = renderToStaticMarkup(createElement(NowcastLayer, { time: TIME, view: at(13), size: BASE_SIZE }));
    expect(h).not.toContain("data-rain-note");
  });
});

describe("凡例の色は気象庁のタイルの色の表と同じ", () => {
  // 11/6 に手元で気象庁の雨雲のタイル（hrpns、段 10 と 6）を 1 枚ずつ読んだときの色の表（番号 0・1 は透明、2 から上が 8 段）
  const PALETTE = ["#ffffff", "#ffffff", "#f2f2ff", "#a0d2ff", "#218cff", "#0041ff", "#faf500", "#ff9900", "#ff2800", "#b40068"];
  it("番号 2〜9 が lib/map/rain-scale.ts の 8 段の色（20〜30 mm/h の黄は #faf500）", () => {
    expect(PALETTE.slice(2)).toEqual(RAIN_STEPS.map((s) => s.color));
  });
});
