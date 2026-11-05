// 様式の頁の印刷の字の位置（T133）。頁の画像（黒塗りの画面を通した後の JPEG。Claude に渡した物・R2 に置く物と同じ）の暗い画素から、
// 罫線を外した「印刷の字・□ のかたまり」の箱の一覧を作る。元の様式の上に値を置く紙（lib/forms/overlay-sheet.ts）が、
// 置く字を印刷の字と重ねないために使う（欄の枠の中の空いた所を探す・□ の並びを見分ける）。
//
// - 絵から作るので、PDF・Excel・Word・写真のどれでも同じ道（PDF の文字の層を持たない形でも効く）。中身の字は読まない（箱と形だけ）
// - 頁の画像に写っている物だけで作る（塗った所は黒い 1 つの大きなかたまりになり、大きすぎる物として外す）。新しく人の値を持たない
// - Claude には渡さない（様式の読み取りの入力に混ぜない）
// - ブラウザ（components/forms/mapping/FormReadPanel.tsx の送る前）と評価の台（tools/eval/forms/browser.ts）が同じ関数で作り、
//   D1 の form_mappings.page_images の頁ごとに ink（数の並び）で持つ（migration なし。lib/forms/page-images.ts）
//
// 作り方: 暗い画素（明るさ 150 未満）→ 長い横・縦の線（罫線。8mm 以上の並び）を外す → つながった所（8 方向）ごとの箱 →
// 小さすぎる物（0.25mm 未満、汚れ）と大きすぎる物（25mm 超、図・塗り・残った線）を外す → 中の空いた四角（□。1.5〜7mm・縦横の比 0.7〜1.4・
// 内側がほぼ白）に印。外した罫線も線の箱として残す（欄の枠の中の線〔「〒」の行と住所の行の間など〕に字を掛けないため）。
// 箱は頁の比を 1/10000 にした整数で、[x, y, w, h, 種類] の 5 つずつ並べる（種類 0 字・1 □・2 罫線）

/** 1 つのかたまりの箱（頁の比 0〜1）。box は □（中の空いた四角） */
export type InkBlob = {
  x: number;
  y: number;
  w: number;
  h: number;
  box: boolean;
  /** 罫線（長い横・縦の線。種類 2） */
  line?: boolean;
  /** ほかの欄の枠（置くときに避ける物として足す。保存しない。lib/forms/overlay-sheet.ts） */
  field?: boolean;
};

/** 保存の形の単位（頁の比の 1/10000） */
const UNIT = 10000;
/** 1 頁のかたまりの上限（保存の大きさ。超えた分は捨てる） */
export const INK_MAX_BLOBS = 6000;

const DARK = 150;
/** 罫線と見なす長さ（mm） */
const LINE_MM = 8;
const MIN_MM = 0.25;
const MAX_MM = 25;

export type Gray = { width: number; height: number; data: Uint8Array };

/** RGBA の画素（canvas の getImageData）を明るさに */
export function grayOf(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { width, height, data };
}

/**
 * 頁の画像の明るさから、印刷の字・□ のかたまりの箱を作る。pageMm は頁の画像の長い辺の実寸（既定は A4 の 297mm。画像は A4 に収めて置く）
 */
export function inkBlobs(g: Gray, pageMm = 297): InkBlob[] {
  const { width: w, height: h, data } = g;
  const pxPerMm = Math.max(w, h) / pageMm;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) dark[i] = data[i] < DARK ? 1 : 0;
  // 罫線を外す（横と縦の長い並び）
  const line = Math.max(8, Math.round(LINE_MM * pxPerMm));
  const strip = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark[y * w + x] === 1;
      if (on) run++;
      else {
        if (run >= line) for (let k = x - run; k < x; k++) strip[y * w + k] = 1;
        run = 0;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      const on = y < h && dark[y * w + x] === 1;
      if (on) run++;
      else {
        if (run >= line) for (let k = y - run; k < y; k++) strip[k * w + x] = 1;
        run = 0;
      }
    }
  }
  for (let i = 0; i < dark.length; i++) if (strip[i]) dark[i] = 0;
  const lines = lineBoxes(strip, w, h, line);

  // つながった所（8 方向、行ごとの並びを union-find で）
  const parent: number[] = [];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  type Run = { x0: number; x1: number; y: number; id: number };
  let prev: Run[] = [];
  const runs: Run[] = [];
  for (let y = 0; y < h; y++) {
    const cur: Run[] = [];
    let x = 0;
    while (x < w) {
      if (dark[y * w + x] === 0) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < w && dark[y * w + x] === 1) x++;
      const r: Run = { x0, x1: x - 1, y, id: parent.length };
      parent.push(r.id);
      for (const p of prev) if (p.x0 <= r.x1 + 1 && p.x1 >= r.x0 - 1) union(r.id, p.id);
      cur.push(r);
      runs.push(r);
    }
    prev = cur;
  }
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number; n: number }>();
  for (const r of runs) {
    const k = find(r.id);
    const b = boxes.get(k);
    const n = r.x1 - r.x0 + 1;
    if (!b) boxes.set(k, { x0: r.x0, y0: r.y, x1: r.x1, y1: r.y, n });
    else {
      b.x0 = Math.min(b.x0, r.x0);
      b.x1 = Math.max(b.x1, r.x1);
      b.y1 = Math.max(b.y1, r.y);
      b.n += n;
    }
  }
  const min = MIN_MM * pxPerMm;
  const max = MAX_MM * pxPerMm;
  const out: InkBlob[] = [];
  for (const b of boxes.values()) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    if (Math.max(bw, bh) < min || Math.max(bw, bh) > max) continue;
    out.push({ x: b.x0 / w, y: b.y0 / h, w: bw / w, h: bh / h, box: isHollowBox(dark, w, b, pxPerMm) });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return [...out, ...lines].slice(0, INK_MAX_BLOBS);
}

/** 罫線の箱（横の線は行ごとの長い並びを縦につなぎ、縦の線は列ごと。太さ 1.2mm までの物だけ） */
function lineBoxes(strip: Uint8Array, w: number, h: number, minLen: number): InkBlob[] {
  const out: InkBlob[] = [];
  const thick = Math.max(2, Math.round((minLen / 8) * 1.2));
  type Seg = { a: number; b: number; s: number; e: number };
  const scan = (outer: number, inner: number, at: (o: number, i: number) => number, horizontal: boolean) => {
    let open: Seg[] = [];
    for (let o = 0; o <= outer; o++) {
      const runs: Array<[number, number]> = [];
      if (o < outer) {
        let run = 0;
        for (let i = 0; i <= inner; i++) {
          if (i < inner && strip[at(o, i)]) run++;
          else {
            if (run >= minLen) runs.push([i - run, i - 1]);
            run = 0;
          }
        }
      }
      const next: Seg[] = [];
      for (const [a, b] of runs) {
        const prev = open.find((g) => Math.min(g.b, b) - Math.max(g.a, a) >= 0.8 * Math.min(g.b - g.a, b - a));
        if (prev) {
          open = open.filter((g) => g !== prev);
          next.push({ a: Math.min(prev.a, a), b: Math.max(prev.b, b), s: prev.s, e: o });
        } else next.push({ a, b, s: o, e: o });
      }
      for (const g of open) {
        if (g.e - g.s + 1 > thick) continue;
        out.push(horizontal ? { x: g.a / w, y: g.s / h, w: (g.b - g.a + 1) / w, h: (g.e - g.s + 1) / h, box: false, line: true } : { x: g.s / w, y: g.a / h, w: (g.e - g.s + 1) / w, h: (g.b - g.a + 1) / h, box: false, line: true });
      }
      open = next;
    }
  };
  scan(h, w, (y, x) => y * w + x, true);
  // 縦の線（横の線と同じ並べ方で列ごと）
  scan(w, h, (x, y) => y * w + x, false);
  return out;
}

/** 中の空いた四角（□）か: 1.5〜7mm、縦横の比 0.7〜1.4、内側（25% 入った所）の暗い画素が 8% 未満、縁の帯は半分以上が暗い */
function isHollowBox(dark: Uint8Array, w: number, b: { x0: number; y0: number; x1: number; y1: number }, pxPerMm: number): boolean {
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const ratio = bw / bh;
  if (ratio < 0.7 || ratio > 1.4) return false;
  if (Math.min(bw, bh) < 1.5 * pxPerMm || Math.max(bw, bh) > 7 * pxPerMm) return false;
  const ix = Math.round(bw * 0.25);
  const iy = Math.round(bh * 0.25);
  let inner = 0;
  let innerN = 0;
  for (let y = b.y0 + iy; y <= b.y1 - iy; y++) {
    for (let x = b.x0 + ix; x <= b.x1 - ix; x++) {
      innerN++;
      inner += dark[y * w + x];
    }
  }
  if (innerN === 0 || inner / innerN >= 0.08) return false;
  // 縁: 4 辺の帯（太さ 12%）の列・行ごとに 1 つでも暗い画素があるか
  const band = Math.max(1, Math.round(Math.min(bw, bh) * 0.12));
  const edgeHit = (xs: number, xe: number, ys: number, ye: number, alongX: boolean) => {
    let hit = 0;
    let n = 0;
    if (alongX) {
      for (let x = xs; x <= xe; x++) {
        n++;
        for (let y = ys; y <= ye; y++)
          if (dark[y * w + x]) {
            hit++;
            break;
          }
      }
    } else {
      for (let y = ys; y <= ye; y++) {
        n++;
        for (let x = xs; x <= xe; x++)
          if (dark[y * w + x]) {
            hit++;
            break;
          }
      }
    }
    return n === 0 ? 0 : hit / n;
  };
  const top = edgeHit(b.x0, b.x1, b.y0, b.y0 + band, true);
  const bottom = edgeHit(b.x0, b.x1, b.y1 - band, b.y1, true);
  const left = edgeHit(b.x0, b.x0 + band, b.y0, b.y1, false);
  const right = edgeHit(b.x1 - band, b.x1, b.y0, b.y1, false);
  return Math.min(top, bottom, left, right) >= 0.6;
}

// ---------- 保存の形 ----------

/** 保存の形（[x, y, w, h, 種類] を 1/10000 の整数で並べる） */
export function packInk(blobs: readonly InkBlob[]): number[] {
  const out: number[] = [];
  for (const b of blobs.slice(0, INK_MAX_BLOBS)) {
    out.push(Math.round(b.x * UNIT), Math.round(b.y * UNIT), Math.max(1, Math.round(b.w * UNIT)), Math.max(1, Math.round(b.h * UNIT)), b.line ? 2 : b.box ? 1 : 0);
  }
  return out;
}

const okInt = (n: unknown, max: number) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;

/** 保存の形を読む。形が違えば null（印刷の字の位置なしで置く。今までと同じ） */
export function unpackInk(v: unknown): InkBlob[] | null {
  if (!Array.isArray(v) || v.length % 5 !== 0 || v.length / 5 > INK_MAX_BLOBS) return null;
  const out: InkBlob[] = [];
  for (let i = 0; i < v.length; i += 5) {
    const [x, y, w, h, k] = v.slice(i, i + 5);
    if (!okInt(x, UNIT) || !okInt(y, UNIT) || !okInt(w, UNIT) || !okInt(h, UNIT) || (k !== 0 && k !== 1 && k !== 2) || (w as number) < 1 || (h as number) < 1) return null;
    out.push({ x: (x as number) / UNIT, y: (y as number) / UNIT, w: (w as number) / UNIT, h: (h as number) / UNIT, box: k === 1, ...(k === 2 ? { line: true } : {}) });
  }
  return out;
}

/** 受けた数の並び（ブラウザから）を確かめて、保存の形のまま返す。形が違えば null */
export function checkPackedInk(v: unknown): number[] | null {
  return unpackInk(v) ? (v as number[]) : null;
}
