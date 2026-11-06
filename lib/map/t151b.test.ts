// T151b 平時の雨雲が町の縮尺でも出ること・見えている所に雨が無いときの「範囲内 雨なし」（docs/tasks/T151b.md）。
// - 地図が段 10 より寄ると段 10 のタイルを引き伸ばし、段 5 より引くと段 5 のタイルを縮めて並べる（画像は加工しない）
// - 見えている画素の範囲、雨の有無（透明でない画素）、まとめ方
// - 凡例の左の「範囲内 雨なし」は、雨が無いと分かったときだけ
// テストは外へ出ない（fetch を偽にして、呼ばれたら落とす）。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NowcastLayer, NowcastNote } from "../../components/map/NowcastLayer.tsx";
import { LEGEND_W } from "../../components/map/RainScaleLegend.tsx";
import { latestTime, NOWC_ZOOM, nowcTileUpstream, parseTimes, tileResponse } from "../jma/nowcast.ts";
import { NOWCAST_OPACITY } from "./layers.ts";
import { pickHazard, pickRain, rainShown, shownHazards, type LayerPick } from "./layer-pick.ts";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { HEAVY_RAIN_TRACK } from "../drill/rain.ts";
import { demoOverlay } from "./demo.ts";
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

describe("強さの取り違えが無いこと（雨雲の route は気象庁のタイルをそのまま渡す）", () => {
  // 11/6 の取り寄せの形: 時刻の一覧は実況だけ（basetime と validtime が同じ）、要素は hrpns と hrpns_nd
  const TIMES = [
    { basetime: "20261106042500", validtime: "20261106042500", elements: ["hrpns", "hrpns_nd"] },
    { basetime: "20261106042000", validtime: "20261106042000", elements: ["hrpns", "hrpns_nd"] },
  ];

  it("時刻は一番新しい実況、タイルは要素 hrpns・同じ時刻・同じ段と番号の URL", () => {
    const t = latestTime(parseTimes(TIMES));
    expect(t).toEqual({ basetime: "20261106042500", validtime: "20261106042500" });
    expect(nowcTileUpstream(t!, 10, 907, 395)).toBe(
      "https://www.jma.go.jp/bosai/jmatile/data/nowc/20261106042500/none/20261106042500/surf/hrpns/10/907/395.png",
    );
  });

  it("route は取ったタイルの中身を 1 バイトも変えずに返す（色の付け替えは訓練の雨だけ）", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 9, 8, 7]);
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return url.endsWith(".json") ? Response.json(TIMES) : new Response(png, { status: 200 });
    };
    const res = await tileResponse(
      { basetime: "20261106042000", validtime: "20261106042000", z: "10", x: "907", y: "395" },
      { on: true, authed: true, fetcher, cache: null },
    );
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(calls.at(-1)).toBe("https://www.jma.go.jp/bosai/jmatile/data/nowc/20261106042000/none/20261106042000/surf/hrpns/10/907/395.png");
  });

  it("画面では色を変えず、層の透け具合だけ（0.65）", () => {
    expect(NOWCAST_OPACITY).toBe(0.65);
    const h = renderToStaticMarkup(createElement(NowcastLayer, { time: TIME, view: at(13), size: BASE_SIZE }));
    for (const m of h.matchAll(/<img [^>]*data-layer="nowcast"[^>]*>/g)) {
      expect(m[0]).toContain("opacity:0.65");
      expect(m[0]).not.toMatch(/filter|mix-blend|brightness|saturate|hue-rotate/);
    }
  });
});

describe("色の層は 1 度に 1 つ（雨雲と浸水・土砂・津波。lib/map/layer-pick.ts）", () => {
  const start: LayerPick = { on: new Set(["flood", "landslide"]), rainOn: false };
  const set = (p: LayerPick) => [...p.on].sort();

  it("雨雲を付けたら浸水・土砂・津波は描かない（付いていた層は覚えている）。外したら前の層に戻る", () => {
    expect([...shownHazards(start, true)].sort()).toEqual(["flood", "landslide"]);
    const rain = pickRain(start);
    expect(rainShown(rain, true)).toBe(true);
    expect(shownHazards(rain, true).size).toBe(0);
    const back = pickRain(rain);
    expect(rainShown(back, true)).toBe(false);
    expect([...shownHazards(back, true)].sort()).toEqual(["flood", "landslide"]);
  });

  it("雨雲を描いている間に浸水などを付けたら、雨雲を外し、前の層と押した層を描く", () => {
    const rain = pickRain({ on: new Set(["landslide"]), rainOn: false });
    const flood = pickHazard(rain, "flood", true);
    expect(flood.rainOn).toBe(false);
    expect(set(flood)).toEqual(["flood", "landslide"]);
  });

  it("雨雲を描いていないときは、層の付け外しだけ（付けたら雨雲は外したまま、外しても雨雲は付けない）", () => {
    const off = pickHazard(start, "landslide", true);
    expect(set(off)).toEqual(["flood"]);
    expect(off.rainOn).toBe(false);
    const add = pickHazard(off, "tsunami", true);
    expect(set(add)).toEqual(["flood", "tsunami"]);
    expect(add.rainOn).toBe(false);
  });

  it("描く雨が無い（旗が off・時刻が取れない・訓練の雨が無い）ときは雨雲を選んでいても層をそのまま描く", () => {
    const p: LayerPick = { on: new Set(["flood"]), rainOn: true };
    expect(rainShown(p, false)).toBe(false);
    expect([...shownHazards(p, false)]).toEqual(["flood"]);
    // 層を付け外しすると雨雲は外れる（あとで雨が届いても層が消えない）
    expect(pickHazard(p, "tsunami", false).rainOn).toBe(false);
  });

  it("地図の画面: 雨（訓練の雨）があれば最初は雨雲を描き、浸水・土砂の層のタイルは出さず、切替も押していない印。雨が無ければ層を描く", () => {
    const mapPins = [{ id: "p1", label: "山田", title: "山田", href: "/?open=p1", location: MATSUYAMA, tone: null, state: null, layer: 0 }];
    const withRain = renderToStaticMarkup(
      createElement(CaseMap, {
        pins: mapPins as never,
        layers: ["flood", "landslide"],
        demo: demoOverlay({ kind: "heavy_rain", level: 4, drill: { track: HEAVY_RAIN_TRACK, hour: 3, anchor: MATSUYAMA } }),
        unplaced: 0,
      }),
    );
    expect(withRain).toContain('data-demo="rain"');
    expect(withRain).not.toMatch(/data-layer="(flood|landslide|tsunami)"/);
    expect(withRain).toMatch(/aria-pressed="true"[^>]*data-toggle="rain"/);
    expect(withRain).toMatch(/aria-pressed="false"[^>]*data-toggle="flood"/);
    const noRain = renderToStaticMarkup(createElement(CaseMap, { pins: mapPins as never, layers: ["flood"], demo: null, unplaced: 0 }));
    expect(noRain).toContain('data-layer="flood"');
    expect(noRain).toMatch(/aria-pressed="true"[^>]*data-toggle="flood"/);
  });

  it("どの地図も同じ 1 か所を使う（担当一覧の右の面・全画面・訓練は CaseMap の層の切替。前の自前の付け外しは無い）", () => {
    const src = readFileSync(new URL("../../components/map/CaseMap.tsx", import.meta.url), "utf8");
    expect(src).toContain("pickHazard(cur, id, rainAvailable)");
    expect(src).toMatch(/pickRain/);
    expect(src).not.toContain("setRainOn");
    expect(src).not.toContain("setOn(");
  });
});
