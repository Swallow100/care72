// PDF の頁を JPEG にする道具（テストと手元の確かめだけ。配信のコードからは使わない）。T86。
// ブラウザの黒塗りの画面（lib/redact/browser.ts）が pdf.js で頁を画像にするのと同じ形を、Node の pdf.js と @napi-rs/canvas
// （pdfjs-dist の任意の依存。MIT）で作る。@napi-rs/canvas が入っていない端末では null（テストは飛ばす）。
// 長い辺 2000 px（送る大きさと同じ）。JPEG の付け足し（@napi-rs/canvas は ICC の APP2 を付ける）は、ブラウザと同じく外す。

import { stripJpegMetadata } from "../../lib/redact/jpeg.ts";

/** @napi-rs/canvas のうち使う所（任意の依存なので型を引かない。無い端末でも型の検査が通るように） */
type NodeCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
  encode(kind: "jpeg", quality: number): Promise<Uint8Array>;
};
type CanvasModule = { createCanvas(w: number, h: number): NodeCanvas };

const CANVAS_MODULE = "@napi-rs/canvas";

export async function pdfToJpegPages(pdf: Uint8Array, longSide = 2000): Promise<Uint8Array[] | null> {
  let canvasMod: CanvasModule;
  try {
    canvasMod = (await import(/* @vite-ignore */ CANVAS_MODULE)) as CanvasModule;
  } catch {
    return null;
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: pdf.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const out: Uint8Array[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = longSide / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = canvasMod.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js の型は DOM の canvas。@napi-rs/canvas は同じ形の 2D の文脈を持つ
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    out.push(stripJpegMetadata(new Uint8Array(await canvas.encode("jpeg", 86))));
  }
  await doc.cleanup();
  return out;
}
