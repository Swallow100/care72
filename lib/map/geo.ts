// 地図の計算（T14、T46）。地図の部品は外の道具に頼らず、タイルを並べて描く。
// Leaflet（BSD-2-Clause）と MapLibre GL（BSD-3-Clause）は依存の決まり（MIT・Apache-2.0・OFL）に入らないため。
// ウェブメルカトルの式で、表示の範囲とタイルとピンの位置を出す。
// - 右の面の小さな地図: 枠は基準の大きさ（VIEW_W × VIEW_H）で、ピンが全部入るズーム（fitView）に固定。拡大・移動はしない
// - 全画面（T46）: 枠は画面の大きさ（size）で、ズーム（小数も可）と中心を zoomAt・panBy で変える。
//   タイルはズームを丸めた段（tileZoom）の物を拡大・縮小して並べ、段の範囲（層ごとの minZ〜maxZ）の外は出さない
// 位置は枠に対する % で返し、画面では枠の幅に合わせて伸び縮みする。

import type { GeoPoint } from "../db/types.ts";

/** タイル 1 枚の大きさ（px） */
export const TILE = 256;

/** 表示の枠の基準の大きさ（px）。画面では aspect-ratio を保って伸び縮みする */
export const VIEW_W = 352;
export const VIEW_H = 300;

/** 枠の大きさ（px） */
export type Size = { w: number; h: number };
/** 右の面の小さな地図の枠 */
export const BASE_SIZE: Size = { w: VIEW_W, h: VIEW_H };

/** ズームの範囲（両端を含む） */
export type ZoomRange = { minZ: number; maxZ: number };

/** 世界座標（ズーム z のピクセル）。x は東へ、y は南へ増える */
export type WorldPoint = { x: number; y: number };

export function isGeoPoint(v: unknown): v is GeoPoint {
  if (typeof v !== "object" || v === null) return false;
  const { lat, lng } = v as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -85 &&
    lat <= 85 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** 緯度経度 → ズーム z の世界座標（ウェブメルカトル） */
export function project(p: GeoPoint, z: number): WorldPoint {
  const size = TILE * 2 ** z;
  const lat = (p.lat * Math.PI) / 180;
  return {
    x: ((p.lng + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}

/** 世界座標 → 緯度経度（project の逆） */
export function unproject(w: WorldPoint, z: number): GeoPoint {
  const size = TILE * 2 ** z;
  const lng = (w.x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * w.y) / size;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

/** 表示: ズーム（全画面では小数もある）と枠の中心（そのズームの世界座標） */
export type View = { z: number; center: WorldPoint };

/** ピンの名前の印が枠の外に出ないための余白（基準の px）。印は点の上に出るので上を広く取る */
export type Padding = { top: number; right: number; bottom: number; left: number };
export const PIN_PADDING: Padding = { top: 30, right: 36, bottom: 12, left: 36 };

/**
 * 点が全部入るいちばん大きいズーム（minZ〜maxZ）と、その中心。
 * 点が 1 つなら maxZ、点が無ければ fallback を中心に minZ
 */
export function fitView(
  points: ReadonlyArray<GeoPoint>,
  opts: { minZ: number; maxZ: number; fallback: GeoPoint; padding?: Padding; size?: Size },
): View {
  const pad = opts.padding ?? PIN_PADDING;
  const size = opts.size ?? BASE_SIZE;
  if (points.length === 0) return { z: opts.minZ, center: project(opts.fallback, opts.minZ) };
  for (let z = opts.maxZ; z >= opts.minZ; z--) {
    const ws = points.map((p) => project(p, z));
    const minX = Math.min(...ws.map((w) => w.x));
    const maxX = Math.max(...ws.map((w) => w.x));
    const minY = Math.min(...ws.map((w) => w.y));
    const maxY = Math.max(...ws.map((w) => w.y));
    const fits = maxX - minX <= size.w - pad.left - pad.right && maxY - minY <= size.h - pad.top - pad.bottom;
    if (fits || z === opts.minZ) {
      // 余白の左右・上下の差の分だけ中心をずらす（印が上に出る分、点の塊を下へ）
      return {
        z,
        center: {
          x: (minX + maxX) / 2 + (pad.right - pad.left) / 2,
          y: (minY + maxY) / 2 + (pad.bottom - pad.top) / 2,
        },
      };
    }
  }
  return { z: opts.minZ, center: project(opts.fallback, opts.minZ) };
}

/** 枠の中の位置（%）。left・top は枠の左上から */
export type Placed = { left: number; top: number };

/** 緯度経度 → 枠の中の位置（%）。枠の外は 0〜100 の外になる */
export function place(view: View, p: GeoPoint, size: Size = BASE_SIZE): Placed {
  const w = project(p, view.z);
  return {
    left: ((w.x - (view.center.x - size.w / 2)) / size.w) * 100,
    top: ((w.y - (view.center.y - size.h / 2)) / size.h) * 100,
  };
}

/** 枠の中にあるか（端を含む） */
export function inView(placed: Placed): boolean {
  return placed.left >= 0 && placed.left <= 100 && placed.top >= 0 && placed.top <= 100;
}

/** 並べるタイル 1 枚。z はタイルの段（ズームを丸めた物）。位置と大きさは枠に対する % */
export type TileSpot = { z: number; x: number; y: number; left: number; top: number; width: number; height: number };

/**
 * タイルの段: ズームを四捨五入して範囲に収めた整数。タイルは段の物を 2^(z − 段) 倍して並べる（0.71〜1.41 倍）。
 * 範囲を渡さなければ丸めるだけ
 */
export function tileZoom(z: number, range?: ZoomRange): number {
  const r = Math.round(z);
  return range ? Math.min(range.maxZ, Math.max(range.minZ, r)) : r;
}

/**
 * 枠を覆うタイル（左上から行ごと）。段は tileZoom(view.z, range)。
 * margin は枠の外に足すタイルの枚数（全画面で動かしたときに端が空かないように。小さな地図は 0）
 */
export function tilesFor(view: View, size: Size = BASE_SIZE, opts: { range?: ZoomRange; margin?: number } = {}): TileSpot[] {
  const tz = tileZoom(view.z, opts.range);
  const margin = opts.margin ?? 0;
  // 段 tz のタイル 1 枚が、ズーム z の世界で何 px か
  const span = TILE * 2 ** (view.z - tz);
  const x0 = view.center.x - size.w / 2;
  const y0 = view.center.y - size.h / 2;
  const max = 2 ** tz - 1;
  const out: TileSpot[] = [];
  for (let ty = Math.floor(y0 / span) - margin; ty <= Math.floor((y0 + size.h) / span) + margin; ty++) {
    for (let tx = Math.floor(x0 / span) - margin; tx <= Math.floor((x0 + size.w) / span) + margin; tx++) {
      if (ty < 0 || ty > max || tx < 0 || tx > max) continue;
      out.push({
        z: tz,
        x: tx,
        y: ty,
        left: ((tx * span - x0) / size.w) * 100,
        top: ((ty * span - y0) / size.h) * 100,
        width: (span / size.w) * 100,
        height: (span / size.h) * 100,
      });
    }
  }
  return out;
}

/** 層がその段で出せるか（範囲の外の段では層を出さない） */
export function inRange(tz: number, range: ZoomRange): boolean {
  return tz >= range.minZ && tz <= range.maxZ;
}

// ---------- 全画面の拡大・縮小・移動（T46） ----------

/** 枠の中の点（px。枠の左上から） */
export type Pt = { x: number; y: number };

/** 中心を動かせる範囲（緯度・経度） */
export type Bounds = { south: number; west: number; north: number; east: number };

/**
 * ズームを z2 に変える。anchor（枠の中の点、既定は真ん中）の下の地点は同じ所に残る
 * （ホイール・ピンチはその点を、ボタンは真ん中を据えて拡大する）
 */
export function zoomAt(view: View, size: Size, z2: number, anchor?: Pt): View {
  const ax = (anchor?.x ?? size.w / 2) - size.w / 2;
  const ay = (anchor?.y ?? size.h / 2) - size.h / 2;
  const k = 2 ** (z2 - view.z);
  return { z: z2, center: { x: (view.center.x + ax) * k - ax, y: (view.center.y + ay) * k - ay } };
}

/** 地図を dx・dy（px）だけ動かす。右へ引けば地図が右へ動き、中心は西へ */
export function panBy(view: View, dx: number, dy: number): View {
  return { z: view.z, center: { x: view.center.x - dx, y: view.center.y - dy } };
}

/** ズームを範囲に、中心を bounds に収める。ズームを変えたときは真ん中を据える */
export function clampView(view: View, size: Size, limits: { range: ZoomRange; bounds?: Bounds }): View {
  const z = Math.min(limits.range.maxZ, Math.max(limits.range.minZ, view.z));
  let v = z === view.z ? view : zoomAt(view, size, z);
  if (limits.bounds) {
    const b = limits.bounds;
    const c = unproject(v.center, v.z);
    const lat = Math.min(b.north, Math.max(b.south, c.lat));
    const lng = Math.min(b.east, Math.max(b.west, c.lng));
    if (lat !== c.lat || lng !== c.lng) v = { z: v.z, center: project({ lat, lng }, v.z) };
  }
  return v;
}

/** タイルの URL（{z}/{x}/{y} を埋める） */
export function tileUrl(template: string, t: Pick<TileSpot, "z" | "x" | "y">): string {
  return template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
}
