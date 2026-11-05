// 欄の枠の中の空いた所を探す（T133）。元の様式の上に値を置く紙（lib/forms/overlay-sheet.ts）が、置く字を印刷の字と重ねないために使う。
// 決まり: 探すのはその欄の枠（または部品の枠）の中だけ。ほかの欄・枠の外へは出さない（overlay-sheet.ts の置き方の決まり）。
// 純な計算（頁の比の矩形と、頁の印刷の字のかたまり lib/forms/ink.ts）。

import type { InkBlob } from "./ink.ts";
import type { FieldBox } from "./mapping.ts";

/** 罫線を枠の中の線と見なす縁からの離れ（頁の比。0.8mm ほど） */
const LINE_EDGE = 0.003;

/**
 * 枠の中の印刷の字（かたまりの面の 3 割より多くが枠の中にある物）。罫線は、枠の縁から離れた所を横切る物だけ
 * （枠の縁の線は欄の枠そのもの。「〒」の行と住所の行の間のような枠の中の線だけを避ける）
 */
export function inkIn(box: FieldBox, ink: readonly InkBlob[]): InkBlob[] {
  return ink.filter((b) => {
    if (b.line) {
      const horizontal = b.w >= b.h;
      const c = horizontal ? b.y + b.h / 2 : b.x + b.w / 2;
      const [lo, hi] = horizontal ? [box.y, box.y + box.h] : [box.x, box.x + box.w];
      const along = horizontal ? Math.min(b.x + b.w, box.x + box.w) - Math.max(b.x, box.x) : Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y);
      return c > lo + LINE_EDGE && c < hi - LINE_EDGE && along > 0;
    }
    const w = Math.min(b.x + b.w, box.x + box.w) - Math.max(b.x, box.x);
    const h = Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y);
    return w > 0 && h > 0 && w * h > 0.3 * b.w * b.h;
  });
}

/** 矩形どうしが重なるか（margin は頁の比で、a を広げて見る） */
export function overlaps(a: FieldBox, b: FieldBox, mx = 0, my = 0): boolean {
  return a.x - mx < b.x + b.w && b.x < a.x + a.w + mx && a.y - my < b.y + b.h && b.y < a.y + a.h + my;
}

/**
 * 枠の中で印刷の字の無い矩形（極大の物）を、面の大きい順に。image は頁の画像の実寸（mm）。
 * 枠を 0.3mm ほどの目に切り、印刷の字（と 0.25mm の余白）の掛かる目を埋め、埋まっていない目の極大の長方形を数える（柱の高さの方法）
 */
export function freeRects(box: FieldBox, obstacles: readonly InkBlob[], image: { w: number; h: number }, limit = 80): FieldBox[] {
  const wMm = box.w * image.w;
  const hMm = box.h * image.h;
  if (wMm <= 0 || hMm <= 0) return [];
  const cell = Math.max(0.3, Math.sqrt((wMm * hMm) / 40000));
  const cols = Math.max(1, Math.round(wMm / cell));
  const rows = Math.max(1, Math.round(hMm / cell));
  const cw = box.w / cols;
  const ch = box.h / rows;
  const used = new Uint8Array(cols * rows);
  const mx = 0.25 / image.w;
  const my = 0.25 / image.h;
  for (const o of obstacles) {
    const c0 = Math.max(0, Math.floor((o.x - mx - box.x) / cw));
    const c1 = Math.min(cols - 1, Math.ceil((o.x + o.w + mx - box.x) / cw) - 1);
    const r0 = Math.max(0, Math.floor((o.y - my - box.y) / ch));
    const r1 = Math.min(rows - 1, Math.ceil((o.y + o.h + my - box.y) / ch) - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) used[r * cols + c] = 1;
  }
  const heights = new Int32Array(cols);
  const found = new Map<string, FieldBox & { area: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = used[r * cols + c] ? 0 : heights[c] + 1;
    // 柱の高さの並びの極大の長方形（左右に伸ばせる幅）
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const hgt = c < cols ? heights[c] : 0;
      while (stack.length > 0 && heights[stack[stack.length - 1]] >= hgt) {
        const top = stack.pop()!;
        const height = heights[top];
        if (height === 0) continue;
        const left = stack.length > 0 ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        const key = `${left},${r - height + 1},${width},${height}`;
        if (!found.has(key)) found.set(key, { x: box.x + left * cw, y: box.y + (r - height + 1) * ch, w: width * cw, h: height * ch, area: width * height });
      }
      stack.push(c);
    }
  }
  // 極大の物だけ（ほかの空きの中に入る物を落とす。落とさないと広い空きの切れ端ばかりが上に来て、括弧の中のような別の空きが漏れる）
  const kept: Array<FieldBox & { area: number }> = [];
  const eps = 1e-9;
  for (const r of [...found.values()].sort((a, b) => b.area - a.area)) {
    if (kept.some((k) => r.x >= k.x - eps && r.y >= k.y - eps && r.x + r.w <= k.x + k.w + eps && r.y + r.h <= k.y + k.h + eps)) continue;
    kept.push(r);
    if (kept.length >= limit) break;
  }
  return kept.map(({ area: _a, ...r }) => r);
}

/** 読む順（上から、左から） */
export const readingOrder = (a: FieldBox, b: FieldBox) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.5 ? a.y - b.y : a.x - b.x);
