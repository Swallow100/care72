// 地図の動かし方（全画面 T46、右の面の小さな地図 T66）。拡大・縮小（ボタン・ホイール・ピンチ・キー）と移動（ドラッグ・指・キー）を、
// lib/map/geo.ts の View に対する純粋な計算にしてある（画面は components/map/CaseMap.tsx の CaseMap と FullMap が呼ぶだけ）。
// 小さな地図は画面の送りの途中にあるので、ホイールは Ctrl（⌘）を押しているときか、地図を押したあと（その上にいる間）だけ地図に効かせ、
// それ以外は画面の送りに渡す（sideWheelTakes）。指は 2 本（ピンチ）だけ地図に効かせ、1 本は画面の送り。

import { BASE_LAYER } from "./layers.ts";
import { BASE_SIZE, panBy, zoomAt, type Bounds, type Pt, type Size, type View, type ZoomRange } from "./geo.ts";

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

/** ボタンとキーの拡大・縮小: 次の整数の段へ（13.6 の拡大は 14、縮小は 13。整数のときは 1 段） */
export function stepZoom(z: number, dz: 1 | -1): number {
  const eps = 1e-6;
  return dz > 0 ? Math.floor(z + eps) + 1 : Math.ceil(z - eps) - 1;
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

/** 地図のズームと中心の制限（全画面と小さな地図で同じ。ズーム 9〜18、中心は日本の周り） */
export const MAP_LIMITS = { range: FULL_ZOOM, bounds: JAPAN_BOUNDS } as const;

/**
 * 画面の上の点（clientX・clientY）→ 地図の枠の中の点（枠の大きさ size の座標）。
 * 小さな地図は基準の大きさ（BASE_SIZE、352×300）で計算し、画面では幅に合わせて伸び縮みするので、測った枠の幅との比で直す。
 * 全画面は枠の大きさそのもの（比は 1）
 */
export function toFrame(client: Pt, rect: { left: number; top: number; width: number; height: number }, size: Size = BASE_SIZE): Pt {
  const sx = rect.width > 0 ? size.w / rect.width : 1;
  const sy = rect.height > 0 ? size.h / rect.height : 1;
  return { x: (client.x - rect.left) * sx, y: (client.y - rect.top) * sy };
}

/**
 * 小さな地図のホイールを地図の拡大・縮小に使うか。Ctrl・⌘ を押している（トラックパッドのピンチも ctrlKey で来る）か、
 * 地図を押したあと（armed。地図の外へ出れば外れる）だけ。ほかは画面の送りに渡す（地図の上で画面が止まらないように）
 */
export function sideWheelTakes(e: { ctrlKey: boolean; metaKey: boolean }, armed: boolean): boolean {
  return armed || e.ctrlKey || e.metaKey;
}

/** 表示が同じか（「全体」を押せるか。ズームと中心がほぼ同じなら同じ） */
export function sameView(a: View, b: View): boolean {
  return Math.abs(a.z - b.z) < 1e-6 && Math.abs(a.center.x - b.center.x) < 0.5 && Math.abs(a.center.y - b.center.y) < 0.5;
}
