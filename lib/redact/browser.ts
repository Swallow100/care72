// 黒塗りの画面（T52）のブラウザだけの所: 選んだ写真・PDF を頁の画像にする、塗った後の JPEG を作る。
// サーバーでは読まない（document・canvas・pdf.js を使う）。元の写真・PDF はこの中だけで扱い、外へ送らない。
//
// - 写真（JPEG・PNG）: そのまま <img> で開く。向き（EXIF の回転）はブラウザが直した大きさで扱う（naturalWidth と drawImage は向きを直す）
// - PDF: pdf.js（pdfjs-dist、Apache-2.0）で頭から PDF_PAGES_MAX 頁までを画像（PNG）にする。pdf.js は PDF を選んだときだけ読み込む
// - 送る画像: canvas に描いて（長い辺を OUTPUT_MAX_SIDE に）、ピクセルを直に黒く塗り（paintRects）、JPEG にして、付け足しを外す。
//   canvas を通すので元の EXIF（位置・端末）は付かない。付いていても stripJpegMetadata で外す（サーバーは付いた物を断る）

import { FORM_FILE_MAX_BYTES } from "../forms/mapping.ts";
import { PDF_PAGES_MAX, type ReadMeta, type ReadSource } from "../intake/read-form.ts";
import { stripJpegMetadata } from "./jpeg.ts";
import { OUTPUT_MAX_SIDE, outputSize, paintRects, scaleRects } from "./paint.ts";
import type { Rect } from "./rects.ts";

/** 黒塗りの画面の 1 頁。url は画面に出す画像（ブラウザの中の blob:）、w・h は向きを直した画像の大きさ */
export type RedactPage = {
  id: string;
  fileName: string;
  source: ReadSource;
  /** 頁の番号（写真は 1） */
  page: number;
  /** このファイルから出した頁の数 */
  pages: number;
  /** PDF の全部の頁の数（写真は 1） */
  total: number;
  url: string;
  w: number;
  h: number;
};

export type LoadResult = { pages: RedactPage[]; failed: string[] };

/** 中身の頭で形を決める（ブラウザの言う形は信じない） */
async function kindOf(file: File): Promise<"image" | "pdf" | null> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const head = (sig: number[]) => sig.every((x, i) => b[i] === x);
  if (head([0xff, 0xd8, 0xff]) || head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image";
  if (head([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  return null;
}

async function imageOf(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), type, quality));
}

let seq = 0;
const pageId = () => `rp-${Date.now().toString(36)}-${++seq}`;

/** PDF を頁の画像に。pdf.js は使うときだけ読み込む */
async function pdfPages(file: File): Promise<RedactPage[]> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false });
  const doc = await task.promise;
  try {
    const total = doc.numPages;
    const count = Math.min(total, PDF_PAGES_MAX);
    const out: RedactPage[] = [];
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, OUTPUT_MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await canvasBlob(canvas, "image/png");
      out.push({
        id: pageId(),
        fileName: file.name,
        source: "pdf",
        page: i,
        pages: count,
        total,
        url: URL.createObjectURL(blob),
        w: canvas.width,
        h: canvas.height,
      });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return out;
  } finally {
    void task.destroy();
  }
}

/** 選んだ写真・PDF を頁にする。読めなかった物はファイル名で返す */
export async function loadPages(files: readonly File[]): Promise<LoadResult> {
  const pages: RedactPage[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      const kind = file.size > 0 ? await kindOf(file) : null;
      if (kind === "image") {
        const url = URL.createObjectURL(file);
        try {
          const img = await imageOf(url);
          pages.push({ id: pageId(), fileName: file.name, source: "photo", page: 1, pages: 1, total: 1, url, w: img.naturalWidth, h: img.naturalHeight });
        } catch (e) {
          URL.revokeObjectURL(url);
          throw e;
        }
      } else if (kind === "pdf") {
        pages.push(...(await pdfPages(file)));
      } else {
        failed.push(file.name);
      }
    } catch {
      failed.push(file.name);
    }
  }
  return { pages, failed };
}

/** 画面に出した画像を片付ける */
export function releasePages(pages: readonly RedactPage[]): void {
  for (const p of pages) URL.revokeObjectURL(p.url);
}

/** 送る形の印 */
export const metaOf = (page: RedactPage, rects: readonly Rect[]): ReadMeta => ({ source: page.source, page: page.page, redacted: rects.length });

/**
 * 塗った後の JPEG を作る。四角は画面の画像（w・h）の座標。上限の大きさに収まるまで質を下げる。
 * 白い地に描く（PNG の透けた所を黒にしない）
 */
export async function encodeRedacted(page: RedactPage, rects: readonly Rect[]): Promise<Blob> {
  const { w, h, ratio } = outputSize(page.w, page.h);
  const img = await imageOf(page.url);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    paintRects(data.data, w, h, scaleRects(rects, ratio));
    ctx.putImageData(data, 0, 0);
    for (const quality of [0.86, 0.75, 0.6, 0.45]) {
      const raw = new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", quality)).arrayBuffer());
      const clean = stripJpegMetadata(raw);
      if (clean.length <= FORM_FILE_MAX_BYTES) return new Blob([clean as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
    }
    throw new Error("too_large");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
