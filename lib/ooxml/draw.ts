// 頁の形（page.ts）を canvas の 2D の文脈に描く（T119）。ブラウザの canvas と、評価の台の @napi-rs/canvas の両方が同じ形の口を持つ。
// 地は白、線は元の色。字は元の書体の名前を先に置いた並び（fonts.ts の cssFamily）で描く。

import { cssFont, printable } from "./fonts.ts";
import type { OfficePage, PageItem, Stroke } from "./page.ts";

/** 使う所だけの 2D の文脈の形（CanvasRenderingContext2D と @napi-rs/canvas の SKRSContext2D の共通の所） */
export type Draw2d = {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  setLineDash(d: number[]): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  drawImage(img: never, x: number, y: number, w: number, h: number): void;
};

/** 描く前に開いた画像（image の項目ごと）。開けなかった画像は描かない */
export type DecodedImages = Map<PageItem, unknown>;

function applyStroke(ctx: Draw2d, s: Stroke, k: number) {
  ctx.strokeStyle = s.color;
  // 細すぎる線は 1 画素（刷ると消えるので）
  ctx.lineWidth = Math.max(1, s.width * k);
  ctx.setLineDash(s.dash ? s.dash.map((d) => Math.max(1, d * k)) : []);
}

function roundRect(ctx: Draw2d, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawItem(ctx: Draw2d, it: PageItem, k: number, images: DecodedImages | undefined) {
  switch (it.k) {
    case "rect": {
      ctx.beginPath();
      if (it.radius) roundRect(ctx, it.x * k, it.y * k, it.w * k, it.h * k, it.radius * k);
      else ctx.rect(it.x * k, it.y * k, it.w * k, it.h * k);
      if (it.fill) {
        ctx.fillStyle = it.fill;
        ctx.fill();
      }
      if (it.stroke) {
        applyStroke(ctx, it.stroke, k);
        ctx.stroke();
      }
      return;
    }
    case "line": {
      applyStroke(ctx, it.stroke, k);
      ctx.beginPath();
      ctx.moveTo(it.x1 * k, it.y1 * k);
      ctx.lineTo(it.x2 * k, it.y2 * k);
      ctx.stroke();
      return;
    }
    case "ellipse": {
      ctx.beginPath();
      ctx.ellipse(it.cx * k, it.cy * k, Math.max(0.5, it.rx * k), Math.max(0.5, it.ry * k), 0, 0, Math.PI * 2);
      if (it.fill) {
        ctx.fillStyle = it.fill;
        ctx.fill();
      }
      if (it.stroke) {
        applyStroke(ctx, it.stroke, k);
        ctx.stroke();
      }
      return;
    }
    case "path": {
      if (it.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(it.points[0][0] * k, it.points[0][1] * k);
      for (const [x, y] of it.points.slice(1)) ctx.lineTo(x * k, y * k);
      if (it.closed) ctx.closePath();
      if (it.fill) {
        ctx.fillStyle = it.fill;
        ctx.fill();
      }
      if (it.stroke) {
        applyStroke(ctx, it.stroke, k);
        ctx.stroke();
      }
      return;
    }
    case "check": {
      const s = it.size * k;
      const x = it.x * k;
      const y = it.y * k;
      ctx.setLineDash([]);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, 0.18 * k);
      ctx.beginPath();
      if (it.round) ctx.ellipse(x + s / 2, y + s / 2, s / 2, s / 2, 0, 0, Math.PI * 2);
      else ctx.rect(x, y, s, s);
      ctx.stroke();
      if (it.checked) {
        ctx.lineWidth = Math.max(1, 0.3 * k);
        ctx.beginPath();
        ctx.moveTo(x + s * 0.2, y + s * 0.5);
        ctx.lineTo(x + s * 0.42, y + s * 0.75);
        ctx.lineTo(x + s * 0.82, y + s * 0.22);
        ctx.stroke();
      }
      return;
    }
    case "image": {
      const img = images?.get(it);
      if (img) ctx.drawImage(img as never, it.x * k, it.y * k, it.w * k, it.h * k);
      return;
    }
    case "text": {
      if (!it.text) return;
      const text = printable(it.text);
      const px = it.font.size * k;
      if (px < 0.5) return;
      ctx.save();
      if (it.clip) {
        ctx.beginPath();
        ctx.rect(it.clip.x * k, it.clip.y * k, it.clip.w * k, it.clip.h * k);
        ctx.clip();
      }
      ctx.font = cssFont(it.font, px);
      ctx.fillStyle = it.color;
      if (it.vertical) {
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        let y = it.y * k;
        for (const ch of text) {
          ctx.fillText(ch, it.x * k, y);
          y += px;
        }
      } else if (it.chars) {
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        let i = 0;
        for (const ch of text) {
          const cx = it.chars[i++];
          if (cx === undefined) break;
          ctx.fillText(ch, cx * k, it.y * k);
        }
      } else {
        ctx.textAlign = it.align ?? "left";
        ctx.textBaseline = "alphabetic";
        if (it.maxWidth && it.maxWidth > 0) ctx.fillText(text, it.x * k, it.y * k, it.maxWidth * k);
        else ctx.fillText(text, it.x * k, it.y * k);
        if (it.underline) {
          const w = Math.min(ctx.measureText(text).width, it.maxWidth ? it.maxWidth * k : Number.POSITIVE_INFINITY);
          const x0 = it.align === "center" ? it.x * k - w / 2 : it.align === "right" ? it.x * k - w : it.x * k;
          ctx.strokeStyle = it.color;
          ctx.setLineDash([]);
          ctx.lineWidth = Math.max(1, px * 0.06);
          ctx.beginPath();
          ctx.moveTo(x0, it.y * k + px * 0.12);
          ctx.lineTo(x0 + w, it.y * k + px * 0.12);
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }
  }
}

/** 頁を描く。k は 1 mm の画素の数。地を白で塗ってから、項目を順に */
export function drawPage(ctx: Draw2d, page: OfficePage, k: number, images?: DecodedImages): void {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, page.w * k, page.h * k);
  ctx.lineCap = "butt";
  for (const it of page.items) drawItem(ctx, it, k, images);
  ctx.restore();
}

/** 頁の画像の画素の大きさ（長い辺を longSide に） */
export function pageSize(page: Pick<OfficePage, "w" | "h">, longSide: number): { w: number; h: number; k: number } {
  const k = longSide / Math.max(page.w, page.h);
  return { w: Math.round(page.w * k), h: Math.round(page.h * k), k };
}
