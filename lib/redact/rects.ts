// 黒塗りの四角（T52）。四角は画像の座標（ピクセル）で持ち、頁ごとに並べる。後に描いた物が上。
// 手（足す・外す・全解除）は 1 つずつ前の形を覚え、「一手戻す」で頁ごと前の形に戻す。

import { viewToImage, type Pt, type Size, type View } from "./view.ts";

export type Rect = { x: number; y: number; w: number; h: number };

/** これより小さい四角（画像の px）は作らない。押しただけ・指の揺れ */
export const MIN_RECT_PX = 4;

/** 枠の中の 2 点（引き始めと今）から、画像の座標の四角。画像の外は切る。小さすぎれば null */
export function rectFromDrag(v: View, image: Size, a: Pt, b: Pt): Rect | null {
  const p = viewToImage(v, a);
  const q = viewToImage(v, b);
  const x0 = Math.max(0, Math.min(p.x, q.x));
  const y0 = Math.max(0, Math.min(p.y, q.y));
  const x1 = Math.min(image.w, Math.max(p.x, q.x));
  const y1 = Math.min(image.h, Math.max(p.y, q.y));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < MIN_RECT_PX || h < MIN_RECT_PX) return null;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h) };
}

/** 画像の点を含む四角の番号（上に描いた物から）。無ければ -1 */
export function hitRect(rects: readonly Rect[], p: Pt): number {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i;
  }
  return -1;
}

// ---------- 手と一手戻す ----------

export type RedactState = {
  /** 頁の id → 四角 */
  rects: Record<string, Rect[]>;
  /** 戻すための前の形（新しい物が後ろ） */
  past: Array<{ page: string; rects: Rect[] }>;
  /** 最後に変わった頁（一手戻したら、その頁を出す） */
  lastPage: string | null;
};

export type RedactAction =
  | { type: "add"; page: string; rect: Rect }
  | { type: "remove"; page: string; index: number }
  | { type: "clear"; page: string }
  | { type: "undo" };

export function initialRedact(pages: readonly string[]): RedactState {
  return { rects: Object.fromEntries(pages.map((p) => [p, []])), past: [], lastPage: null };
}

function change(s: RedactState, page: string, next: Rect[]): RedactState {
  const before = s.rects[page] ?? [];
  return { rects: { ...s.rects, [page]: next }, past: [...s.past, { page, rects: before }], lastPage: page };
}

export function redactReducer(s: RedactState, a: RedactAction): RedactState {
  switch (a.type) {
    case "add":
      return change(s, a.page, [...(s.rects[a.page] ?? []), a.rect]);
    case "remove": {
      const now = s.rects[a.page] ?? [];
      if (a.index < 0 || a.index >= now.length) return s;
      return change(s, a.page, now.filter((_, i) => i !== a.index));
    }
    case "clear":
      return (s.rects[a.page] ?? []).length === 0 ? s : change(s, a.page, []);
    case "undo": {
      const last = s.past.at(-1);
      if (!last) return s;
      return { rects: { ...s.rects, [last.page]: last.rects }, past: s.past.slice(0, -1), lastPage: last.page };
    }
  }
}

/** 隠した所の数（全部の頁） */
export function totalHidden(s: RedactState): number {
  return Object.values(s.rects).reduce((n, r) => n + r.length, 0);
}

/** 塗った所の無い頁（並びは pages の順。まだ手の無い頁も数える） */
export function unpainted(s: RedactState, pages: readonly string[]): string[] {
  return pages.filter((p) => (s.rects[p] ?? []).length === 0);
}
