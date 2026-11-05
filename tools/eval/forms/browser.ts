// 評価の台（T107）のブラウザの段（黒塗りの画面 components/person/RedactSheet.tsx と lib/redact/browser.ts の代わり）。
// ブラウザと同じ決まりで、選んだ写真・PDF を送る頁の画像にする:
// - 形は中身の頭で決める（JPEG・PNG・PDF のほかは開けない＝HEIC はここで断られる）
// - PDF は頭から PDF_PAGES_MAX 頁まで（倍率は min(4, 2000 / 長い辺)）
// - 長い辺を OUTPUT_MAX_SIDE に縮め、伏せる所を paintRects で黒く塗り、JPEG の質を 86→75→60→45 と下げて上限（5 MB）に収め、付け足しを外す
// 描くのは @napi-rs/canvas（pdfjs-dist の任意の依存、MIT。tools/print/pdf-pages.ts と同じ）。無い端末では no_canvas。
// Excel・Word（T119）は lib/ooxml で印刷の頁に描き（字の幅は @napi-rs/canvas の measureText）、ブラウザと同じ決まり（lib/ooxml/pick.ts）で
// 記入例のシートを外した頭の 3 頁を送る（T122: シートが 2 つ以上のブックは様式の本体らしいシート）。古い形（.xls・.doc）は legacy で断る（画面は「旧形式・PDF 保存で取込」）。
// 送ったあとに塗った所が本当に黒いかを測る（redactOk）。塗れていない頁は送らない（Claude に人の値の写る絵を渡さない）。

import { grayOf, inkBlobs, packInk } from "../../../lib/forms/ink.ts";
import { FORM_FILE_MAX_BYTES } from "../../../lib/forms/mapping.ts";
import { PDF_PAGES_MAX, type ReadMeta, type ReadSource } from "../../../lib/intake/read-form.ts";
import { isHeic } from "../../../lib/forms/shrink-image.ts";
import { drawPage, pageSize, type Draw2d } from "../../../lib/ooxml/draw.ts";
import { cssFont } from "../../../lib/ooxml/fonts.ts";
import { OFFICE_PAGES_MAX, OfficeReadError, renderOffice } from "../../../lib/ooxml/index.ts";
import { defaultExcluded, pickPageOf, sheetWordCounts } from "../../../lib/ooxml/pick.ts";
import { stripJpegMetadata } from "../../../lib/redact/jpeg.ts";
import { OUTPUT_MAX_SIDE, outputSize, paintRects } from "../../../lib/redact/paint.ts";
import type { Ratio } from "./render.ts";

type Ctx2d = {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  putImageData(d: { data: Uint8ClampedArray }, x: number, y: number): void;
};
type NodeCanvas = { width: number; height: number; getContext(kind: "2d"): Ctx2d; encode(kind: "jpeg", quality: number): Promise<Uint8Array> };
type CanvasModule = { createCanvas(w: number, h: number): NodeCanvas; loadImage(src: Uint8Array): Promise<{ width: number; height: number }> };

let canvasMod: CanvasModule | null | undefined;
const CANVAS_MODULE = "@napi-rs/canvas";

export async function loadCanvas(): Promise<CanvasModule | null> {
  if (canvasMod !== undefined) return canvasMod;
  try {
    canvasMod = (await import(/* @vite-ignore */ CANVAS_MODULE)) as unknown as CanvasModule;
  } catch {
    canvasMod = null;
  }
  return canvasMod;
}

export type BrowserPage = {
  /** 送る画像（塗った後の JPEG、付け足しなし） */
  bytes: Uint8Array;
  meta: ReadMeta;
  /** 隠した所 0 で人が「送信」を選んだ印（白紙の様式） */
  bare: boolean;
  /** 塗った所が全部黒いか（塗る所が無ければ null） */
  redactOk: boolean | null;
  width: number;
  height: number;
  /** 何番目の質で収まったか（86・75・60・45） */
  quality: number;
  /** 頁の印刷の字の位置（T133。ブラウザの lib/forms/ink-browser.ts と同じく、送る JPEG を読み直して作る。様式の頁だけ） */
  ink?: number[];
  /** 元のファイルの頁の番号（選んで振り直す前。一覧の様式の共有の対応表の鍵、T134） */
  origin: number;
};

/** 送る JPEG を読み直して印刷の字の位置を作る（ブラウザの inkOfBlob と同じ） */
async function inkOf(mod: CanvasModule, bytes: Uint8Array, w: number, h: number): Promise<number[]> {
  const img = await mod.loadImage(bytes);
  const canvas = mod.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return packInk(inkBlobs(grayOf(ctx.getImageData(0, 0, w, h).data, w, h)));
}

/** legacy は古い形（.xls・.doc）、office は Excel・Word を描けなかった */
export type BrowserError = "type" | "heic" | "decode" | "too_large" | "no_canvas" | "legacy" | "office";
export type BrowserResult =
  | { ok: true; source: ReadSource; pages: BrowserPage[]; totalPages: number; rawBytes: number }
  | { ok: false; error: BrowserError; rawBytes: number };

export function kindOf(bytes: Uint8Array): "image" | "heic" | "pdf" | "office" | "legacy" | null {
  const head = (sig: number[]) => sig.every((x, i) => bytes[i] === x);
  if (head([0xff, 0xd8, 0xff]) || head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image";
  // HEIC（T120）: ブラウザ（lib/forms/shrink-image.ts）は描ければ JPEG に直す。台は描ける所までブラウザと同じに試す
  if (isHeic(bytes)) return "heic";
  if (head([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (head([0x50, 0x4b, 0x03, 0x04])) return "office";
  if (head([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "legacy";
  return null;
}

const QUALITIES = [86, 75, 60, 45];

/** 頁の絵（canvas）を送る画像に（ブラウザの encodeRedacted と同じ順） */
async function encodePage(mod: CanvasModule, src: { draw: (ctx: Ctx2d, w: number, h: number) => void; w: number; h: number }, secrets: readonly Ratio[]) {
  const { w, h } = outputSize(src.w, src.h);
  const canvas = mod.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  src.draw(ctx, w, h);
  const rects = secrets.map((s) => ({ x: s.x * w, y: s.y * h, w: s.w * w, h: s.h * h }));
  const data = ctx.getImageData(0, 0, w, h);
  paintRects(data.data, w, h, rects);
  ctx.putImageData(data, 0, 0);
  for (const q of QUALITIES) {
    const clean = stripJpegMetadata(new Uint8Array(await canvas.encode("jpeg", q)));
    if (clean.length <= FORM_FILE_MAX_BYTES) return { bytes: clean, w, h, quality: q, rects };
  }
  return null;
}

/** 塗った所が黒いか（JPEG を読み直し、矩形の内側 2px を除いた所の明るさの平均が 40 未満） */
async function redactedDark(mod: CanvasModule, bytes: Uint8Array, w: number, h: number, rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): Promise<boolean | null> {
  if (rects.length === 0) return null;
  const img = await mod.loadImage(bytes);
  const canvas = mod.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (const r of rects) {
    const x0 = Math.max(0, Math.ceil(r.x) + 2);
    const y0 = Math.max(0, Math.ceil(r.y) + 2);
    const x1 = Math.min(w, Math.floor(r.x + r.w) - 2);
    const y1 = Math.min(h, Math.floor(r.y + r.h) - 2);
    if (x1 <= x0 || y1 <= y0) continue;
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (y * w + x) * 4;
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        n++;
      }
    }
    if (n > 0 && sum / n >= 40) return false;
  }
  return true;
}

/** Excel・Word の頁（ブラウザの lib/ooxml/browser.ts と同じく、描いて頁の画像にしてから塗る） */
async function officeStage(mod: CanvasModule, bytes: Uint8Array, secrets: ReadonlyArray<readonly Ratio[]>, rawBytes: number, withInk: boolean): Promise<BrowserResult> {
  const mctx = mod.createCanvas(10, 10).getContext("2d") as unknown as { font: string; measureText(t: string): { width: number } };
  const measure = (t: string, f: Parameters<typeof cssFont>[0]) => {
    mctx.font = cssFont(f, 100);
    return (mctx.measureText(t).width / 100) * f.size;
  };
  let rendered: Awaited<ReturnType<typeof renderOffice>>;
  try {
    rendered = await renderOffice(bytes, { measure, maxPages: OFFICE_PAGES_MAX });
  } catch (e) {
    return { ok: false, error: e instanceof OfficeReadError && e.code === "legacy" ? "legacy" : "office", rawBytes };
  }
  // 既定で送る頁はブラウザと同じ（T122: シートが 2 つ以上のブックは様式の本体らしいシート）
  const words = sheetWordCounts(rendered.pages);
  const all = rendered.pages.map((p, i) => ({ ...pickPageOf(p, String(i), words), page: p }));
  const skip = defaultExcluded(all);
  const chosen = all.filter((p) => !skip.has(p.id));
  const pages: BrowserPage[] = [];
  for (const [i, c] of chosen.entries()) {
    const { w, h, k } = pageSize(c.page, OUTPUT_MAX_SIDE);
    const pageCanvas = mod.createCanvas(w, h);
    const pctx = pageCanvas.getContext("2d");
    const images = new Map<unknown, unknown>();
    for (const it of c.page.items) {
      if (it.k !== "image") continue;
      try {
        images.set(it, await mod.loadImage(it.data));
      } catch {
        // 開けない画像は描かない
      }
    }
    drawPage(pctx as unknown as Draw2d, c.page, k, images as Parameters<typeof drawPage>[3]);
    const enc = await encodePage(mod, { w, h, draw: (ctx, cw, ch) => ctx.drawImage(pageCanvas, 0, 0, cw, ch) }, secrets[i] ?? []);
    if (!enc) return { ok: false, error: "too_large", rawBytes };
    const redactOk = await redactedDark(mod, enc.bytes, enc.w, enc.h, enc.rects);
    const n = enc.rects.length;
    pages.push({ bytes: enc.bytes, meta: { source: rendered.kind, page: i + 1, redacted: n }, bare: n === 0, redactOk, width: enc.w, height: enc.h, quality: enc.quality, origin: Number(c.id) + 1, ...(withInk ? { ink: await inkOf(mod, enc.bytes, enc.w, enc.h) } : {}) });
  }
  return { ok: true, source: rendered.kind, pages, totalPages: rendered.pages.length, rawBytes };
}

/**
 * 選んだファイル 1 つを送る頁にする。secrets は頁ごとの伏せる所（頁の比）。様式の白紙は伏せる所が無く bare（人が「送信」を選んだ形）
 */
export async function browserStage(bytes: Uint8Array, secrets: ReadonlyArray<readonly Ratio[]>, opts: { ink?: boolean } = {}): Promise<BrowserResult> {
  const withInk = opts.ink === true;
  const rawBytes = bytes.length;
  const kind = bytes.length > 0 ? kindOf(bytes) : null;
  if (!kind) return { ok: false, error: "type", rawBytes };
  if (kind === "legacy") return { ok: false, error: "legacy", rawBytes };
  const mod = await loadCanvas();
  if (!mod) return { ok: false, error: "no_canvas", rawBytes };

  if (kind === "office") return officeStage(mod, bytes, secrets, rawBytes, withInk);

  if (kind === "image" || kind === "heic") {
    let img: { width: number; height: number };
    try {
      img = await mod.loadImage(bytes);
    } catch {
      // HEIC を描けない（Chrome と同じ）。画面は「HEIC 不可・JPEG で」
      return { ok: false, error: kind === "heic" ? "heic" : "decode", rawBytes };
    }
    const enc = await encodePage(mod, { w: img.width, h: img.height, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h) }, secrets[0] ?? []);
    if (!enc) return { ok: false, error: "too_large", rawBytes };
    const redactOk = await redactedDark(mod, enc.bytes, enc.w, enc.h, enc.rects);
    const n = enc.rects.length;
    return {
      ok: true,
      source: "photo",
      totalPages: 1,
      rawBytes,
      pages: [{ bytes: enc.bytes, meta: { source: "photo", page: 1, redacted: n }, bare: n === 0, redactOk, width: enc.w, height: enc.h, quality: enc.quality, origin: 1, ...(withInk ? { ink: await inkOf(mod, enc.bytes, enc.w, enc.h) } : {}) }],
    };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch {
    return { ok: false, error: "decode", rawBytes };
  }
  try {
    const total = doc.numPages;
    const pages: BrowserPage[] = [];
    for (let n = 1; n <= Math.min(total, PDF_PAGES_MAX); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, OUTPUT_MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const pw = Math.round(viewport.width);
      const ph = Math.round(viewport.height);
      const pageCanvas = mod.createCanvas(pw, ph);
      const pctx = pageCanvas.getContext("2d");
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(0, 0, pw, ph);
      await page.render({ canvasContext: pctx as unknown as CanvasRenderingContext2D, canvas: pageCanvas as unknown as HTMLCanvasElement, viewport }).promise;
      const enc = await encodePage(mod, { w: pw, h: ph, draw: (ctx, w, h) => ctx.drawImage(pageCanvas, 0, 0, w, h) }, secrets[n - 1] ?? []);
      page.cleanup();
      if (!enc) return { ok: false, error: "too_large", rawBytes };
      const redactOk = await redactedDark(mod, enc.bytes, enc.w, enc.h, enc.rects);
      const k = enc.rects.length;
      pages.push({ bytes: enc.bytes, meta: { source: "pdf", page: n, redacted: k }, bare: k === 0, redactOk, width: enc.w, height: enc.h, quality: enc.quality, origin: n, ...(withInk ? { ink: await inkOf(mod, enc.bytes, enc.w, enc.h) } : {}) });
    }
    return { ok: true, source: "pdf", pages, totalPages: total, rawBytes };
  } finally {
    await doc.cleanup();
    void task.destroy();
  }
}
