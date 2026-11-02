// 地図の計算（T14）。地図の部品は外の道具に頼らず、タイルを並べて描く。
// Leaflet（BSD-2-Clause）と MapLibre GL（BSD-3-Clause）は依存の決まり（MIT・Apache-2.0・OFL）に入らないため。
// 右の面は動かさない地図（拡大・移動なし）で足りるので、ウェブメルカトルの式で表示の範囲とタイルとピンの位置を出すだけにした。
// 位置は表示の枠（幅 VIEW_W × 高さ VIEW_H の基準の大きさ）に対する % で返し、画面では枠の幅に合わせて伸び縮みする。

import type { GeoPoint } from "../db/types.ts";

/** タイル 1 枚の大きさ（px） */
export const TILE = 256;

/** 表示の枠の基準の大きさ（px）。画面では aspect-ratio を保って伸び縮みする */
export const VIEW_W = 352;
export const VIEW_H = 300;

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

/** 表示: ズームと枠の中心（世界座標） */
export type View = { z: number; center: WorldPoint };

/** ピンの札が枠の外に出ないための余白（基準の px）。札は点の上に出るので上を広く取る */
export type Padding = { top: number; right: number; bottom: number; left: number };
export const PIN_PADDING: Padding = { top: 30, right: 36, bottom: 12, left: 36 };

/**
 * 点が全部入るいちばん大きいズーム（minZ〜maxZ）と、その中心。
 * 点が 1 つなら maxZ、点が無ければ fallback を中心に minZ
 */
export function fitView(
  points: ReadonlyArray<GeoPoint>,
  opts: { minZ: number; maxZ: number; fallback: GeoPoint; padding?: Padding },
): View {
  const pad = opts.padding ?? PIN_PADDING;
  if (points.length === 0) return { z: opts.minZ, center: project(opts.fallback, opts.minZ) };
  for (let z = opts.maxZ; z >= opts.minZ; z--) {
    const ws = points.map((p) => project(p, z));
    const minX = Math.min(...ws.map((w) => w.x));
    const maxX = Math.max(...ws.map((w) => w.x));
    const minY = Math.min(...ws.map((w) => w.y));
    const maxY = Math.max(...ws.map((w) => w.y));
    const fits = maxX - minX <= VIEW_W - pad.left - pad.right && maxY - minY <= VIEW_H - pad.top - pad.bottom;
    if (fits || z === opts.minZ) {
      // 余白の左右・上下の差の分だけ中心をずらす（札が上に出る分、点の塊を下へ）
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
export function place(view: View, p: GeoPoint): Placed {
  const w = project(p, view.z);
  return {
    left: ((w.x - (view.center.x - VIEW_W / 2)) / VIEW_W) * 100,
    top: ((w.y - (view.center.y - VIEW_H / 2)) / VIEW_H) * 100,
  };
}

/** 枠の中にあるか（端を含む） */
export function inView(placed: Placed): boolean {
  return placed.left >= 0 && placed.left <= 100 && placed.top >= 0 && placed.top <= 100;
}

/** 並べるタイル 1 枚。位置と大きさは枠に対する % */
export type TileSpot = { z: number; x: number; y: number; left: number; top: number; width: number; height: number };

/** 枠を覆うタイル（左上から行ごと） */
export function tilesFor(view: View): TileSpot[] {
  const x0 = view.center.x - VIEW_W / 2;
  const y0 = view.center.y - VIEW_H / 2;
  const max = 2 ** view.z - 1;
  const out: TileSpot[] = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + VIEW_H) / TILE); ty++) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + VIEW_W) / TILE); tx++) {
      if (ty < 0 || ty > max || tx < 0 || tx > max) continue;
      out.push({
        z: view.z,
        x: tx,
        y: ty,
        left: ((tx * TILE - x0) / VIEW_W) * 100,
        top: ((ty * TILE - y0) / VIEW_H) * 100,
        width: (TILE / VIEW_W) * 100,
        height: (TILE / VIEW_H) * 100,
      });
    }
  }
  return out;
}

/** タイルの URL（{z}/{x}/{y} を埋める） */
export function tileUrl(template: string, t: Pick<TileSpot, "z" | "x" | "y">): string {
  return template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
}
