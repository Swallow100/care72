// Excel・Word を黒塗りの画面（components/person/RedactSheet.tsx）の頁の画像にする所（T119。ブラウザだけ）。
// 選んだファイルはブラウザの中だけで読み、頁を canvas に描いて PNG にする（PDF の頁を pdf.js で描くのと同じ形）。
// 字の幅は canvas の measureText で測る（端末の書体。元の書体が無ければ近い書体）。外へは何も送らない。

import { cssFont } from "./fonts.ts";
import { drawPage, pageSize, type DecodedImages, type Draw2d } from "./draw.ts";
import { OFFICE_PAGES_MAX, renderOffice, type OfficeKind } from "./index.ts";
import type { FontSpec, OfficePage } from "./page.ts";
import { isExampleSheet } from "./xlsx.ts";

export type OfficeImage = {
  blob: Blob;
  w: number;
  h: number;
  /** シートの名前（Excel）。Word は null */
  sheet: string | null;
  /** 記入例・記載例のシート（既定で送らない候補） */
  example: boolean;
};

let measureCtx: CanvasRenderingContext2D | null = null;

/** canvas で字の幅を測る（mm）。100px で測って割り戻す */
export function canvasMeasure(text: string, font: FontSpec): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * font.size;
  measureCtx.font = cssFont(font, 100);
  return (measureCtx.measureText(text).width / 100) * font.size;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}

async function decodeImages(page: OfficePage): Promise<DecodedImages> {
  const out: DecodedImages = new Map();
  for (const it of page.items) {
    if (it.k !== "image") continue;
    try {
      out.set(it, await createImageBitmap(new Blob([it.data as Uint8Array<ArrayBuffer>], { type: it.type })));
    } catch {
      // 開けない画像は描かない
    }
  }
  return out;
}

/** Excel・Word を頁の画像に。longSide は長い辺の画素 */
export async function officeImages(file: File, longSide: number): Promise<{ kind: OfficeKind; pages: OfficeImage[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await renderOffice(bytes, { measure: canvasMeasure, maxPages: OFFICE_PAGES_MAX });
  const out: OfficeImage[] = [];
  for (const page of r.pages) {
    const { w, h, k } = pageSize(page, longSide);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      const images = await decodeImages(page);
      drawPage(ctx as unknown as Draw2d, page, k, images);
      for (const img of images.values()) (img as ImageBitmap).close?.();
      out.push({ blob: await toBlob(canvas), w, h, sheet: page.sheet, example: page.sheet ? isExampleSheet(page.sheet) : false });
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return { kind: r.kind, pages: out };
}
