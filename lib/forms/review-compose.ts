// AI の見直し（T136）に送る紙の頁の絵を、ブラウザで描く。サーバーが決めた描く物（lib/forms/review-ai.ts の ComposePlan）だけを描く:
// 元の様式の頁の画像を下に敷き、塗らない欄の字と印を紙と同じ大きさ・場所に置き、塗る所を黒くする。
// 塗る欄の字は描く物に入っていない（サーバーが入れない）ので、塗りに失敗しても字は出ない。塗りは取り込みの黒塗りと同じ paintRects（ピクセルを直に、端を広げて）。
// JPEG にして付け足し（EXIF など）を外す（サーバーは付いた物を断る）。
// 字の置き方は紙面（components/forms/OverlaySheet.tsx と overlay-paper.css）と同じ: 欄の矩形の内側の空き 0.8mm・0.5mm、左寄せ、行の高さ 1.15、
// 3 行より高い欄は上から（top）、ほかは高さの真ん中。矩形の外は切る（紙面の overflow: hidden と同じ）。

import { paintRects, PAINT_PAD } from "../redact/paint.ts";
import type { Rect } from "../redact/rects.ts";
import type { ComposeDraw, ComposePage } from "./review-ai.ts";

/** 送る絵の長い辺（px）。Claude が縮めずに読む大きさ（1568）に収める */
export const COMPOSE_MAX_SIDE = 1568;
const PT_MM = 25.4 / 72;
const PAD_X_MM = 0.8;
const PAD_Y_MM = 0.5;
const LINE_HEIGHT = 1.15;

export type TextOp = { clip: Rect; fontPx: number; x: number; lines: Array<{ text: string; y: number }> };
export type MarkOp = { box: Rect; mark: "check" | "circle" };
export type PageOps = { w: number; h: number; texts: TextOp[]; marks: MarkOp[]; paints: Rect[] };

/** 描く物を絵の px に（頁の画像の箱 page.image を w×h に）。純な計算（テストで確かめる） */
export function pageOps(page: Pick<ComposePage, "image" | "draws" | "paints">, maxSide = COMPOSE_MAX_SIDE): PageOps {
  const ratio = maxSide / Math.max(page.image.w, page.image.h);
  const w = Math.round(page.image.w * ratio);
  const h = Math.round(page.image.h * ratio);
  const pxPerMm = w / page.image.w;
  const rect = (b: { x: number; y: number; w: number; h: number }): Rect => ({ x: b.x * w, y: b.y * h, w: b.w * w, h: b.h * h });
  const texts: TextOp[] = [];
  const marks: MarkOp[] = [];
  for (const d of page.draws as ComposeDraw[]) {
    if (d.kind === "mark") {
      marks.push({ box: rect(d.box), mark: d.mark });
      continue;
    }
    const clip = rect(d.box);
    const fontPx = d.fontPt * PT_MM * pxPerMm;
    const lineH = fontPx * LINE_HEIGHT;
    const total = lineH * d.lines.length;
    const top = d.top ? clip.y + PAD_Y_MM * pxPerMm : clip.y + (clip.h - total) / 2;
    texts.push({
      clip,
      fontPx,
      x: clip.x + PAD_X_MM * pxPerMm,
      lines: d.lines.map((text, i) => ({ text, y: top + i * lineH + (lineH - fontPx) / 2 })),
    });
  }
  return { w, h, texts, marks, paints: page.paints.map(rect) };
}

/** 紙の書体（紙面の要素の書体を読む。無ければ BIZ UDP） */
export function paperFontFamily(typeface: "gothic" | "mincho"): string {
  const el = typeof document !== "undefined" ? document.querySelector<HTMLElement>(`[data-paper-root] .paper.overlay${typeface === "mincho" ? ".mincho" : ""}`) : null;
  const fam = el ? getComputedStyle(el).fontFamily : "";
  return fam || (typeface === "mincho" ? '"BIZ UDPMincho", serif' : '"BIZ UDPGothic", sans-serif');
}

async function imageOf(href: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = href;
  await img.decode();
  return img;
}

/** 頁 1 つを描いて塗り、JPEG（付け足しなし）に。paints は塗った四角の数（サーバーが描く物の数と照らす） */
export async function composePage(page: ComposePage, family: string): Promise<{ blob: Blob; paints: number }> {
  const { stripJpegMetadata } = await import("../redact/jpeg.ts");
  const ops = pageOps(page);
  const canvas = document.createElement("canvas");
  canvas.width = ops.w;
  canvas.height = ops.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ops.w, ops.h);
  ctx.drawImage(await imageOf(page.href), 0, 0, ops.w, ops.h);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";
  for (const t of ops.texts) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(t.clip.x, t.clip.y, t.clip.w, t.clip.h);
    ctx.clip();
    ctx.font = `${t.fontPx}px ${family}`;
    for (const l of t.lines) ctx.fillText(l.text, t.x, l.y);
    ctx.restore();
  }
  for (const m of ops.marks) {
    const b = m.box;
    ctx.lineWidth = Math.max(1, Math.min(b.w, b.h) * 0.11);
    ctx.beginPath();
    if (m.mark === "check") {
      const s = Math.min(b.w, b.h);
      const ox = b.x + (b.w - s) / 2;
      const oy = b.y + (b.h - s) / 2;
      ctx.moveTo(ox + s * 0.18, oy + s * 0.52);
      ctx.lineTo(ox + s * 0.42, oy + s * 0.79);
      ctx.lineTo(ox + s * 0.86, oy + s * 0.18);
    } else {
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w * 0.52, b.h * 0.56, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  // 塗る所はピクセルを直に黒く（取り込みの黒塗りと同じ）
  const data = ctx.getImageData(0, 0, ops.w, ops.h);
  paintRects(data.data, ops.w, ops.h, ops.paints, PAINT_PAD);
  ctx.putImageData(data, 0, 0);
  const raw = new Uint8Array(await (await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.88))).arrayBuffer());
  const clean = stripJpegMetadata(raw);
  return { blob: new Blob([clean as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), paints: ops.paints.length };
}
