// 黒塗り（T52）の塗り。canvas の getImageData の中身（RGBA の並び）を、四角の所だけ黒にする。
// canvas の fillRect は小数の座標の端を半分の濃さで描く（文字の端が透けうる）ので、ピクセルを直に、端を広げて塗る。
// 塗ったあとは JPEG にする（lib/redact/encode.ts）。元の画像はブラウザの外へ出さない。

import type { Rect } from "./rects.ts";

/** 四角の外へ広げて塗る幅（px）。縮めたときと JPEG の端のにじみの分 */
export const PAINT_PAD = 2;
/** 送る画像の長い辺の上限（px）。書類の字が読めて、JPEG が上限（5 MB）に収まる大きさ */
export const OUTPUT_MAX_SIDE = 2000;

/** data（幅 w・高さ h の RGBA）の四角の所を不透明な黒に。四角は data と同じ座標。外へはみ出た所は切る */
export function paintRects(data: Uint8ClampedArray, w: number, h: number, rects: readonly Rect[], pad = PAINT_PAD): void {
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x) - pad);
    const y0 = Math.max(0, Math.floor(r.y) - pad);
    const x1 = Math.min(w, Math.ceil(r.x + r.w) + pad);
    const y1 = Math.min(h, Math.ceil(r.y + r.h) + pad);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }
}

/** 送る大きさ。長い辺を上限に縮める（拡げない）。ratio は元の 1 px が送る画像の何 px か */
export function outputSize(w: number, h: number, max = OUTPUT_MAX_SIDE): { w: number; h: number; ratio: number } {
  const ratio = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)), ratio };
}

/** 四角を送る大きさへ縮める */
export function scaleRects(rects: readonly Rect[], ratio: number): Rect[] {
  return rects.map((r) => ({ x: r.x * ratio, y: r.y * ratio, w: r.w * ratio, h: r.h * ratio }));
}
