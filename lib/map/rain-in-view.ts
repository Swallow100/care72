// 地図に見えている所に雨雲の雨があるか（T151b）。平時の地図の本物の雨雲（components/map/NowcastLayer.tsx）の凡例の横に「範囲内 雨なし」を出すため。
// 雨雲のタイルは Workers の route から同じ origin で読むので、ブラウザで画像の画素を読める。気象庁の画像は加工しない（読むだけ）。
// 気象庁の雨雲のタイル（hrpns）は色の表（パレット）の PNG で、番号 0・1 は透明（範囲外・雨なし）、2 から上が降水量の 8 段（lib/map/rain-scale.ts と同じ色）。
// だから見えている所の画素に不透明な物が 1 つでもあれば雨がある。地点ごとの雨量や危険度は作らない（あるか無いかの 1 つだけ）。色と連絡順には使わない。

import type { TileSpot } from "./geo.ts";

/** タイルの画素の大きさ */
export const TILE_PX = 256;

/** タイルの中の見えている画素の範囲（x1・y1 は含まない） */
export type PixelRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * タイルのうち地図の枠に見えている画素の範囲。TileSpot の left・top・width・height は枠に対する %（lib/map/geo.ts の tilesFor）。
 * 地図が段 10 より寄ってタイルを引き伸ばしているときは、見えているのはタイルの一部だけ。見えていなければ null
 */
export function visiblePixels(t: Pick<TileSpot, "left" | "top" | "width" | "height">, px = TILE_PX): PixelRect | null {
  if (!(t.width > 0 && t.height > 0)) return null;
  const clamp = (v: number) => Math.min(px, Math.max(0, v));
  const x0 = clamp(Math.floor(((0 - t.left) / t.width) * px));
  const x1 = clamp(Math.ceil(((100 - t.left) / t.width) * px));
  const y0 = clamp(Math.floor(((0 - t.top) / t.height) * px));
  const y1 = clamp(Math.ceil(((100 - t.top) / t.height) * px));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/** RGBA の画素（幅 width）の範囲 r に、透明でない画素があるか */
export function hasRain(data: ArrayLike<number>, width: number, r: PixelRect): boolean {
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) if (data[(y * width + x) * 4 + 3] > 0) return true;
  }
  return false;
}

/** 見えている所の雨: 読んでいる途中・ある・無い・読めないタイルがあって分からない */
export type RainInView = "checking" | "rain" | "none" | "unknown";

/** タイルごとの結果（true 雨あり・false 雨なし・null 読めない）をまとめる。1 枚でも雨があれば雨あり、読めないタイルがあれば分からない */
export function rainInView(results: ReadonlyArray<boolean | null>): RainInView {
  if (results.some((r) => r === true)) return "rain";
  if (results.length === 0 || results.some((r) => r === null)) return "unknown";
  return "none";
}
