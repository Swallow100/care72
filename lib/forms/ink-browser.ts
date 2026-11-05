// ブラウザで、送る頁の画像（塗った後の JPEG）から頁の印刷の字の位置を作る（T133、lib/forms/ink.ts）。
// 様式の読取（components/forms/mapping/FormReadPanel.tsx）が送る前に呼ぶ。作れなければ null（位置なしで置く。読み取りは止めない）。

import { grayOf, inkBlobs, packInk } from "./ink.ts";

export async function inkOfBlob(blob: Blob): Promise<number[] | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = ctx.getImageData(0, 0, width, height).data;
    return packInk(inkBlobs(grayOf(data, width, height)));
  } catch {
    return null;
  }
}
