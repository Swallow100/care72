// 全画面の地図（T46）の動かし方。拡大・縮小（ボタン・ホイール・ピンチ・キー）と移動（ドラッグ・指・キー）を、
// lib/map/geo.ts の View に対する純粋な計算にしてある（画面は components/map/CaseMap.tsx の FullMap が呼ぶだけ）。

import { BASE_LAYER } from "./layers.ts";
import { panBy, zoomAt, type Bounds, type Pt, type Size, type View, type ZoomRange } from "./geo.ts";

/**
 * 全画面のズームの範囲。
 * - 下: 9。淡色地図のズーム 5〜8 は別の出所の併記が要る（docs/progress/t14.md の利用の条件）ので、そこまで引かない
 * - 上: 淡色地図の上限 18。ハザードの層は 17 までなので、18 の段では層を出さない（切替に「範囲外」）
 */
export const FULL_ZOOM: ZoomRange = { minZ: 9, maxZ: BASE_LAYER.maxZ };

/** 中心を動かせる範囲（日本とその周り。淡色地図の範囲の外へ迷わないように） */
export const JAPAN_BOUNDS: Bounds = { south: 24, west: 122, north: 46, east: 154 };

/** キー 1 押しで動かす量（px） */
export const KEY_PAN = 96;

export type KeyAction = { type: "pan"; dx: number; dy: number } | { type: "zoom"; dz: 1 | -1 };

/**
 * キーの操作。矢印は地図を見る向きへ動かす（← で西が見える）、＋・＝で拡大、−で縮小。
 * Escape は <dialog> がそのまま閉じるのでここでは扱わない。ほかのキーは null（ボタン・リンクの操作を邪魔しない）
 */
export function keyAction(key: string): KeyAction | null {
  switch (key) {
    case "ArrowLeft":
      return { type: "pan", dx: KEY_PAN, dy: 0 };
    case "ArrowRight":
      return { type: "pan", dx: -KEY_PAN, dy: 0 };
    case "ArrowUp":
      return { type: "pan", dx: 0, dy: KEY_PAN };
    case "ArrowDown":
      return { type: "pan", dx: 0, dy: -KEY_PAN };
    case "+":
    case "=":
    case ";": // JIS 配列の ＋ のキー（Shift なし）
      return { type: "zoom", dz: 1 };
    case "-":
    case "_":
      return { type: "zoom", dz: -1 };
    default:
      return null;
  }
}

/** ボタンとキーの拡大・縮小: 今のズームを丸めて 1 段 */
export function stepZoom(z: number, dz: 1 | -1): number {
  return Math.round(z) + dz;
}

/** ホイールのズームの変化。下へ回すと縮小。行・頁の単位は px に直す。トラックパッドのピンチ（ctrlKey）は強めに。1 回で 1 段まで */
export function wheelZoom(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
  const dz = -px * (e.ctrlKey ? 0.01 : 0.002);
  return Math.max(-1, Math.min(1, dz));
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 2 本の指の動き（前の 2 点 → 今の 2 点）。指の間が 2 倍に開けば 1 段の拡大で、前の 2 点の真ん中を据え、
 * 真ん中が動いた分だけ地図も動かす。指が重なっている（間が 0）ときは動かすだけ
 */
export function pinchView(view: View, size: Size, prev: readonly [Pt, Pt], next: readonly [Pt, Pt]): View {
  const d0 = dist(prev[0], prev[1]);
  const d1 = dist(next[0], next[1]);
  const m0 = mid(prev[0], prev[1]);
  const m1 = mid(next[0], next[1]);
  const zoomed = d0 > 0 && d1 > 0 ? zoomAt(view, size, view.z + Math.log2(d1 / d0), m0) : view;
  return panBy(zoomed, m1.x - m0.x, m1.y - m0.y);
}

/** ドラッグと押したことを分ける動きの量（px）。これより動けばピンを押しても本人のページへ移らない */
export const DRAG_SLOP = 4;
