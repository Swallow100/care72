// T46 地図の全画面のテスト。ズームと中心の計算（タイルの番号と位置）、拡大・縮小・移動・キー・ピンチ、ピンのまとめ。

import { describe, expect, it } from "vitest";
import { SEED_LOCATIONS } from "../../seed/people.ts";
import { FULL_ZOOM, JAPAN_BOUNDS, KEY_PAN, keyAction, pinchView, stepZoom, wheelZoom } from "./camera.ts";
import { COUNT_W, groupPins, labelWidth, overlaps, type PlacedPin } from "./cluster.ts";
import {
  BASE_SIZE,
  clampView,
  fitView,
  inRange,
  panBy,
  place,
  project,
  tilesFor,
  tileZoom,
  TILE,
  unproject,
  zoomAt,
  type Size,
  type View,
} from "./geo.ts";
import { BASE_LAYER, HAZARD_LAYERS } from "./layers.ts";

const FULL: Size = { w: 1280, h: 800 };
const PHONE: Size = { w: 375, h: 600 };
const P1 = SEED_LOCATIONS["p-01"];

/** 枠の中の位置（px） */
const px = (v: View, p: { lat: number; lng: number }, size: Size) => {
  const at = place(v, p, size);
  return { x: (at.left / 100) * size.w, y: (at.top / 100) * size.h };
};

describe("ズームと中心（タイルの番号と位置）", () => {
  it("整数のズームでは段はそのズームで、1 枚は 256 px。真ん中の地点を含むタイルの番号は世界座標 ÷ 256", () => {
    const v: View = { z: 14, center: project(P1, 14) };
    const tiles = tilesFor(v, FULL);
    expect(new Set(tiles.map((t) => t.z))).toEqual(new Set([14]));
    for (const t of tiles) {
      expect((t.width / 100) * FULL.w).toBeCloseTo(TILE, 6);
      expect((t.height / 100) * FULL.h).toBeCloseTo(TILE, 6);
    }
    const c = project(P1, 14);
    const hit = tiles.find((t) => t.x === Math.floor(c.x / TILE) && t.y === Math.floor(c.y / TILE));
    expect(hit).toBeDefined();
    // そのタイルの左上は、枠の真ん中から (中心 − タイルの左上) だけ左上
    expect((hit!.left / 100) * FULL.w).toBeCloseTo(FULL.w / 2 - (c.x - hit!.x * TILE), 6);
    expect((hit!.top / 100) * FULL.h).toBeCloseTo(FULL.h / 2 - (c.y - hit!.y * TILE), 6);
  });

  it("タイルは枠を隙間なく覆い、枚数は見える分だけ（1280×800 の 256 px で 6〜7 列 × 4〜5 行）", () => {
    const v: View = { z: 14, center: project(P1, 14) };
    const tiles = tilesFor(v, FULL);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.width))).toBeGreaterThanOrEqual(100);
    expect(Math.max(...tiles.map((t) => t.top + t.height))).toBeGreaterThanOrEqual(100);
    const cols = new Set(tiles.map((t) => t.x)).size;
    const rows = new Set(tiles.map((t) => t.y)).size;
    expect(cols).toBeGreaterThanOrEqual(6);
    expect(cols).toBeLessThanOrEqual(7);
    expect(rows).toBeGreaterThanOrEqual(4);
    expect(rows).toBeLessThanOrEqual(5);
    expect(tiles.length).toBe(cols * rows);
  });

  it("margin を付けると周りに 1 枚ずつ足す（動かしたときに端が空かない）", () => {
    const v: View = { z: 14, center: project(P1, 14) };
    const a = tilesFor(v, FULL);
    const b = tilesFor(v, FULL, { margin: 1 });
    const cols = new Set(a.map((t) => t.x)).size;
    const rows = new Set(a.map((t) => t.y)).size;
    expect(b.length).toBe((cols + 2) * (rows + 2));
  });

  it("小数のズームは四捨五入の段のタイルを拡大・縮小して並べる（13.4 → 段 13 を 1.32 倍、13.6 → 段 14 を 0.76 倍）", () => {
    expect(tileZoom(13.4)).toBe(13);
    expect(tileZoom(13.6)).toBe(14);
    const a = tilesFor({ z: 13.4, center: project(P1, 13.4) }, FULL);
    expect(a[0].z).toBe(13);
    expect((a[0].width / 100) * FULL.w).toBeCloseTo(TILE * 2 ** 0.4, 6);
    const b = tilesFor({ z: 13.6, center: project(P1, 13.6) }, FULL);
    expect(b[0].z).toBe(14);
    expect((b[0].width / 100) * FULL.w).toBeCloseTo(TILE * 2 ** -0.4, 6);
    // どちらも枠の真ん中に同じ地点（P1）を含むタイルがある
    for (const tiles of [a, b]) {
      const tz = tiles[0].z;
      const c = project(P1, tz);
      expect(tiles.some((t) => t.x === Math.floor(c.x / TILE) && t.y === Math.floor(c.y / TILE))).toBe(true);
    }
  });

  it("段は範囲に収める（淡色地図は 5〜18、ハザードの層は 2〜17。18 の段ではハザードの層を出さない）", () => {
    expect(tileZoom(18.4, BASE_LAYER)).toBe(18);
    expect(tileZoom(19, BASE_LAYER)).toBe(18);
    expect(tileZoom(3, BASE_LAYER)).toBe(5);
    for (const l of HAZARD_LAYERS) {
      expect(inRange(17, l)).toBe(true);
      expect(inRange(18, l)).toBe(false);
    }
    expect(inRange(18, BASE_LAYER)).toBe(true);
  });

  it("小さな地図の枠（基準の大きさ）は今までと同じ計算（既定の size）", () => {
    const pts = Object.values(SEED_LOCATIONS);
    const v = fitView(pts, { minZ: 11, maxZ: 15, fallback: pts[0] });
    expect(tilesFor(v)).toEqual(tilesFor(v, BASE_SIZE));
    expect(place(v, P1)).toEqual(place(v, P1, BASE_SIZE));
  });

  it("全画面の枠に合わせると、同じピンでも小さな地図より寄ったズームで全員が入る", () => {
    const pts = Object.values(SEED_LOCATIONS);
    const small = fitView(pts, { minZ: 11, maxZ: 15, fallback: pts[0] });
    const big = fitView(pts, { minZ: FULL_ZOOM.minZ, maxZ: 15, fallback: pts[0], size: FULL });
    expect(big.z).toBeGreaterThan(small.z);
    for (const p of pts) {
      const at = place(big, p, FULL);
      expect(at.left).toBeGreaterThanOrEqual(0);
      expect(at.left).toBeLessThanOrEqual(100);
      expect(at.top).toBeGreaterThanOrEqual(0);
      expect(at.top).toBeLessThanOrEqual(100);
    }
  });
});

describe("拡大・縮小・移動", () => {
  const v: View = { z: 13, center: project(P1, 13) };

  it("ボタンの拡大は真ん中の地点を据えて 1 段（縮小も）", () => {
    const up = zoomAt(v, FULL, stepZoom(v.z, 1));
    expect(up.z).toBe(14);
    const c = unproject(up.center, up.z);
    expect(c.lat).toBeCloseTo(P1.lat, 9);
    expect(c.lng).toBeCloseTo(P1.lng, 9);
    expect(zoomAt(v, FULL, stepZoom(v.z, -1)).z).toBe(12);
    // 小数のズームからは丸めて 1 段
    expect(stepZoom(13.4, 1)).toBe(14);
    expect(stepZoom(13.6, -1)).toBe(13);
  });

  it("ホイール・ピンチの拡大は、指やカーソルの下の地点が同じ所に残る", () => {
    const target = SEED_LOCATIONS["p-05"];
    const before = px(v, target, FULL);
    for (const z2 of [12.3, 13.7, 15, 16.5]) {
      const after = px(zoomAt(v, FULL, z2, before), target, FULL);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it("右へ引けば地図は右へ動き（ピンが右へ）、真ん中は西へ寄る", () => {
    const moved = panBy(v, 100, -40);
    const a = px(v, P1, FULL);
    const b = px(moved, P1, FULL);
    expect(b.x - a.x).toBeCloseTo(100, 6);
    expect(b.y - a.y).toBeCloseTo(-40, 6);
    expect(unproject(moved.center, moved.z).lng).toBeLessThan(P1.lng);
  });

  it("ズームは 9〜18（淡色地図のズーム 5〜8 は出典の併記が要るので引かない）に収め、真ん中は日本の周りに収める", () => {
    expect(FULL_ZOOM).toEqual({ minZ: 9, maxZ: 18 });
    expect(clampView({ ...v, z: 20 }, FULL, { range: FULL_ZOOM }).z).toBe(18);
    expect(clampView(zoomAt(v, FULL, 6), FULL, { range: FULL_ZOOM }).z).toBe(9);
    // 収めたときも真ん中の地点は同じ
    const c = unproject(clampView(zoomAt(v, FULL, 6), FULL, { range: FULL_ZOOM }).center, 9);
    expect(c.lat).toBeCloseTo(P1.lat, 6);
    // 太平洋の真ん中まで引っぱっても、真ん中は東経 154 度で止まる
    const far = clampView(panBy(v, -1e7, 0), FULL, { range: FULL_ZOOM, bounds: JAPAN_BOUNDS });
    expect(unproject(far.center, far.z).lng).toBeCloseTo(JAPAN_BOUNDS.east, 6);
    // 中の地点はそのまま
    expect(clampView(v, FULL, { range: FULL_ZOOM, bounds: JAPAN_BOUNDS })).toEqual(v);
  });

  it("キー: 矢印で見る向きへ動かし、＋・＝・；で拡大、−で縮小。ほかのキー（Enter・Tab・Escape・文字）は扱わない", () => {
    expect(keyAction("ArrowLeft")).toEqual({ type: "pan", dx: KEY_PAN, dy: 0 });
    expect(keyAction("ArrowRight")).toEqual({ type: "pan", dx: -KEY_PAN, dy: 0 });
    expect(keyAction("ArrowUp")).toEqual({ type: "pan", dx: 0, dy: KEY_PAN });
    expect(keyAction("ArrowDown")).toEqual({ type: "pan", dx: 0, dy: -KEY_PAN });
    for (const k of ["+", "=", ";"]) expect(keyAction(k)).toEqual({ type: "zoom", dz: 1 });
    for (const k of ["-", "_"]) expect(keyAction(k)).toEqual({ type: "zoom", dz: -1 });
    for (const k of ["Enter", "Tab", "Escape", " ", "a"]) expect(keyAction(k)).toBeNull();
    // ← を押すと西が見える（真ん中の経度が下がる）
    const a = keyAction("ArrowLeft")!;
    if (a.type !== "pan") throw new Error("pan でない");
    expect(unproject(panBy(v, a.dx, a.dy).center, v.z).lng).toBeLessThan(P1.lng);
  });

  it("ホイール: 下へ回すと縮小、上へ回すと拡大。1 回で 1 段まで。行の単位も px に直す", () => {
    expect(wheelZoom({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(-0.2, 6);
    expect(wheelZoom({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(0.2, 6);
    expect(wheelZoom({ deltaY: 3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(-0.24, 6);
    expect(wheelZoom({ deltaY: -5000, deltaMode: 0, ctrlKey: false })).toBe(1);
    expect(wheelZoom({ deltaY: -10, deltaMode: 0, ctrlKey: true })).toBeCloseTo(0.1, 6);
  });

  it("ピンチ: 指の間が 2 倍で 1 段の拡大、指の真ん中の地点が残り、真ん中が動けば地図も動く", () => {
    const target = SEED_LOCATIONS["p-05"];
    const m = px(v, target, PHONE);
    const prev = [
      { x: m.x - 40, y: m.y },
      { x: m.x + 40, y: m.y },
    ] as const;
    const spread = [
      { x: m.x - 80, y: m.y },
      { x: m.x + 80, y: m.y },
    ] as const;
    const z = pinchView(v, PHONE, prev, spread);
    expect(z.z).toBeCloseTo(v.z + 1, 9);
    const after = px(z, target, PHONE);
    expect(after.x).toBeCloseTo(m.x, 6);
    expect(after.y).toBeCloseTo(m.y, 6);
    // 指を開かずに 2 本で 30px 下へ: ズームは同じで地図が 30px 下へ
    const slid = pinchView(v, PHONE, prev, [
      { x: prev[0].x, y: prev[0].y + 30 },
      { x: prev[1].x, y: prev[1].y + 30 },
    ]);
    expect(slid.z).toBe(v.z);
    expect(px(slid, target, PHONE).y - m.y).toBeCloseTo(30, 6);
  });
});

describe("ピンのまとめ", () => {
  const pin = (id: string, x: number, y: number, layer: number, w = 40): PlacedPin => ({ id, x, y, layer, w });

  it("名前の印の横幅の見積もりは字数から（状態の言葉があれば別の印の分も）", () => {
    expect(labelWidth({ label: "山田", state: null })).toBe(2 * 11 + 8);
    expect(labelWidth({ label: "山田", state: "至急" })).toBe(4 * 11 + 16);
  });

  it("離れた印はまとめない", () => {
    const g = groupPins([pin("a", 0, 0, 1), pin("b", 100, 0, 2), pin("c", 0, 40, 3)]);
    expect(g.map((x) => x.ids)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("横に重なる印はまとめ、顔は描く順が後ろの人（発災時は連絡の順が先 = 至急の人）で、位置は顔の人の位置", () => {
    const g = groupPins([pin("a", 0, 0, 1), pin("b", 20, 5, 3), pin("c", 300, 0, 2)]);
    expect(g).toHaveLength(2);
    const both = g.find((x) => x.ids.length === 2)!;
    expect(both.head).toBe("b");
    expect(both.ids).toEqual(["b", "a"]);
    expect({ x: both.x, y: both.y }).toEqual({ x: 20, y: 5 });
    // 返す並びは描く順（後ろほど上）
    expect(g.map((x) => x.layer)).toEqual([2, 3]);
  });

  it("縦は印の高さ（18px）と隙間 2px より離れていればまとめない", () => {
    expect(overlaps(pin("a", 0, 0, 1), pin("b", 0, 19, 2))).toBe(true);
    expect(overlaps(pin("a", 0, 0, 1), pin("b", 0, 21, 2))).toBe(false);
  });

  it("「他 N 人」で広がった印がとなりの印に重なれば、それもまとめる", () => {
    // a と b がまとまると、a の印は COUNT_W だけ広がり、c に届く
    const gap = (40 + 40) / 2 + 2; // まとめる前は重ならない距離のぎりぎり
    const g = groupPins([pin("a", 0, 0, 3), pin("b", 5, 0, 1), pin("c", gap + COUNT_W / 4, 0, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0].head).toBe("a");
    expect(g[0].ids).toEqual(["a", "c", "b"]);
  });

  it("種の 10 人は、全画面の最初のズームでは 1 人ずつ（まとめない）、ズーム 10 まで引くとまとまる", () => {
    const pts = Object.entries(SEED_LOCATIONS);
    const v = fitView(
      pts.map(([, p]) => p),
      { minZ: FULL_ZOOM.minZ, maxZ: 15, fallback: P1, size: FULL },
    );
    const placed = (view: View) =>
      pts.map(([id, p], i) => ({ id, ...px(view, p, FULL), layer: i, w: labelWidth({ label: "山田", state: "至急" }) }));
    expect(groupPins(placed(v)).every((g) => g.ids.length === 1)).toBe(true);
    const far = zoomAt(v, FULL, 10);
    const g = groupPins(placed(far));
    expect(g.length).toBeLessThan(pts.length);
    expect(g.reduce((s, x) => s + x.ids.length, 0)).toBe(pts.length);
  });
});
