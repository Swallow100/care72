// 黒塗りの画面（T52）のブラウザだけの所: 選んだ写真・PDF を頁の画像にする、塗った後の JPEG を作る。
// サーバーでは読まない（document・canvas・pdf.js を使う）。元の写真・PDF はこの中だけで扱い、外へ送らない。
//
// - 写真（JPEG・PNG）: そのまま <img> で開く。向き（EXIF の回転）はブラウザが直した大きさで扱う（naturalWidth と drawImage は向きを直す）
// - PDF: pdf.js（pdfjs-dist、Apache-2.0）で頭から PDF_PAGES_MAX 頁までを画像（PNG）にする。pdf.js は PDF を選んだときだけ読み込む
// - Excel・Word（T119）: lib/ooxml で印刷の頁に描いて画像（PNG）にする（OFFICE_PAGES_MAX 頁まで。送るのは人が選んだ PDF_PAGES_MAX 頁まで）。
//   T122: 頁の形は全部作り、画像は見る頁と送る頁だけ描く（drawRedactPage）。
//   古い形（.xls・.doc）は読まずに legacy で返す（画面は「PDF 保存で取込」）。lib/ooxml は選んだときだけ読み込む
// - 送る画像: canvas に描いて（長い辺を OUTPUT_MAX_SIDE に）、ピクセルを直に黒く塗り（paintRects）、JPEG にして、付け足しを外す。
//   canvas を通すので元の EXIF（位置・端末）は付かない。付いていても stripJpegMetadata で外す（サーバーは付いた物を断る）

import { FORM_FILE_MAX_BYTES } from "../forms/mapping.ts";
import { PDF_PAGES_MAX, type ReadMeta, type ReadSource } from "../intake/read-form.ts";
import { stripJpegMetadata } from "./jpeg.ts";
import { OUTPUT_MAX_SIDE, outputSize, paintRects, scaleRects } from "./paint.ts";
import type { Rect } from "./rects.ts";
import type { PickPage } from "../ooxml/pick.ts";

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
  /** Excel のシートの名前（T119。ほかは null） */
  sheet: string | null;
  /** 記入例・記載例のシート（T119。既定で送らない候補） */
  example: boolean;
  /** 既定で送る頁を決める印（Excel・Word。lib/ooxml/pick.ts。T122） */
  pick?: Omit<PickPage, "id">;
  /** 画面に出す画像。Excel・Word の頁はまだ描いていなければ空（drawRedactPage で描く。T122） */
  url: string;
  w: number;
  h: number;
};

/** legacy は古い形（.xls・.doc）で読まなかったファイルの名前 */
export type LoadResult = { pages: RedactPage[]; failed: string[]; legacy: string[] };

/** 中身の頭で形を決める（ブラウザの言う形は信じない） */
async function kindOf(file: File): Promise<"image" | "pdf" | "zip" | "legacy" | null> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const head = (sig: number[]) => sig.every((x, i) => b[i] === x);
  if (head([0xff, 0xd8, 0xff]) || head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image";
  if (head([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (head([0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (head([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "legacy";
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
        sheet: null,
        example: false,
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

/** Excel・Word の頁の描き方（頁の id → 描く関数）。releasePages で消す（T122） */
const drawers = new Map<string, () => Promise<Blob>>();

/** Excel・Word を頁の形に（T119）。画像は見る頁と送る頁だけ描く（T122、drawRedactPage）。lib/ooxml は使うときだけ読み込む */
async function officePages(file: File): Promise<RedactPage[]> {
  const { officeImages } = await import("../ooxml/browser.ts");
  const r = await officeImages(file, OUTPUT_MAX_SIDE);
  return r.pages.map((p, i) => {
    const id = pageId();
    drawers.set(id, p.draw);
    return {
      id,
      fileName: file.name,
      source: r.kind,
      page: i + 1,
      pages: r.pages.length,
      total: r.pages.length,
      sheet: p.sheet,
      example: p.example,
      pick: p.pick,
      url: "",
      w: p.w,
      h: p.h,
    };
  });
}

/** 頁の画像がまだ無ければ描く（Excel・Word。T122）。描いた頁を返す（描いてあればそのまま） */
export async function drawRedactPage(page: RedactPage): Promise<RedactPage> {
  if (page.url) return page;
  const draw = drawers.get(page.id);
  if (!draw) throw new Error("draw");
  // 描き方は片付けるまで持つ（描いた画像を捨てたあと、もう一度描けるように）
  const blob = await draw();
  return { ...page, url: URL.createObjectURL(blob) };
}

/** 選んだ写真・PDF・Excel・Word を頁にする。読めなかった物はファイル名で返す */
export async function loadPages(files: readonly File[]): Promise<LoadResult> {
  const pages: RedactPage[] = [];
  const failed: string[] = [];
  const legacy: string[] = [];
  for (const file of files) {
    try {
      const kind = file.size > 0 ? await kindOf(file) : null;
      if (kind === "image") {
        const url = URL.createObjectURL(file);
        try {
          const img = await imageOf(url);
          pages.push({ id: pageId(), fileName: file.name, source: "photo", page: 1, pages: 1, total: 1, sheet: null, example: false, url, w: img.naturalWidth, h: img.naturalHeight });
        } catch (e) {
          URL.revokeObjectURL(url);
          throw e;
        }
      } else if (kind === "pdf") {
        pages.push(...(await pdfPages(file)));
      } else if (kind === "zip") {
        pages.push(...(await officePages(file)));
      } else if (kind === "legacy") {
        legacy.push(file.name);
      } else {
        failed.push(file.name);
      }
    } catch {
      failed.push(file.name);
    }
  }
  return { pages, failed, legacy };
}

/** 画面に出した画像を片付ける */
export function releasePages(pages: readonly RedactPage[]): void {
  for (const p of pages) {
    if (p.url) URL.revokeObjectURL(p.url);
    drawers.delete(p.id);
  }
}

/** 送る形の印 */
export const metaOf = (page: RedactPage, rects: readonly Rect[]): ReadMeta => ({ source: page.source, page: page.page, redacted: rects.length });

/**
 * 塗った後の JPEG を作る。四角は画面の画像（w・h）の座標。上限の大きさ（maxBytes、既定は 1 枚の上限）に収まるまで質を下げる。
 * 様式の読み取りは 1 要求に全部の頁を載せるので、頁の数で割った大きさを渡す（T146、lib/forms/read-upload.ts の formReadPageBytes）。
 * 白い地に描く（PNG の透けた所を黒にしない）
 */
export async function encodeRedacted(page: RedactPage, rects: readonly Rect[], maxBytes: number = FORM_FILE_MAX_BYTES): Promise<Blob> {
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
      if (clean.length <= Math.min(maxBytes, FORM_FILE_MAX_BYTES)) return new Blob([clean as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
    }
    throw new Error("too_large");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
