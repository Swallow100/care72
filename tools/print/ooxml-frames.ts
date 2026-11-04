// Excel・Word を描いた頁の枠の位置を、同じ様式の PDF 版（市が配る印刷用の PDF）の罫線と数で比べる道具（T119。手元の確かめだけ）。
//
//   node tools/print/ooxml-frames.ts <Excel・Word の道> <PDF の道> [頁の対応 1,2,0,…]
//
// - 描く所は lib/ooxml（ブラウザと同じ）。字の幅は @napi-rs/canvas があれば measureText、無ければ見積もり
// - PDF の罫線は tools/print/pdf-lines.ts（線と細い塗りの矩形）。同じ位置の細切れはつなぐ
// - PDF の線（長さ 2mm 以上）ごとに、同じ向きで 5 割以上重なる描いた線のうち最も近い物までの距離（mm）を取る
// - 出すのは数だけ（頁ごとの線の数・1mm 以内と 2mm 以内の割合・2mm 以内の中央値と 90%・PDF の線から見た横と縦の差の中央値）。
//   原本の字・絵は出さない（リポジトリに入れない）

import { readFileSync } from "node:fs";
import { cssFont } from "../../lib/ooxml/fonts.ts";
import { renderOffice } from "../../lib/ooxml/index.ts";
import type { FontSpec, Measure, OfficePage } from "../../lib/ooxml/page.ts";
import { pdfLines, type HLine, type VLine } from "./pdf-lines.ts";

type Seg = { at: number; s: number; e: number };

/** 描いた頁の水平・垂直の線（線と四角の辺） */
export function pageSegments(p: OfficePage): { H: Seg[]; V: Seg[] } {
  const H: Seg[] = [];
  const V: Seg[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(y1 - y2) < 0.05 && Math.abs(x1 - x2) > 0.3) H.push({ at: (y1 + y2) / 2, s: Math.min(x1, x2), e: Math.max(x1, x2) });
    else if (Math.abs(x1 - x2) < 0.05 && Math.abs(y1 - y2) > 0.3) V.push({ at: (x1 + x2) / 2, s: Math.min(y1, y2), e: Math.max(y1, y2) });
  };
  for (const it of p.items) {
    if (it.k === "line") add(it.x1, it.y1, it.x2, it.y2);
    else if (it.k === "rect" && it.stroke) {
      add(it.x, it.y, it.x + it.w, it.y);
      add(it.x, it.y + it.h, it.x + it.w, it.y + it.h);
      add(it.x, it.y, it.x, it.y + it.h);
      add(it.x + it.w, it.y, it.x + it.w, it.y + it.h);
    }
  }
  return { H: joinSegs(H), V: joinSegs(V) };
}

/** 同じ位置（0.1mm）の細切れの線をつなぐ */
export function joinSegs(list: readonly Seg[]): Seg[] {
  const groups = new Map<number, Seg[]>();
  for (const l of list) {
    const k = Math.round(l.at * 10);
    const g = groups.get(k) ?? [];
    g.push(l);
    groups.set(k, g);
  }
  const out: Seg[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.s - b.s);
    let cur: Seg | null = null;
    for (const l of g) {
      if (cur && l.s <= cur.e + 0.3) cur.e = Math.max(cur.e, l.e);
      else {
        if (cur) out.push(cur);
        cur = { ...l };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

const overlap = (a: Seg, b: Seg) => Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s));

/** src の線（2mm 以上）ごとに、dst の 5 割以上重なる線までの最も近い距離（符号つき: dst − src） */
export function nearest(src: readonly Seg[], dst: readonly Seg[]): Array<{ d: number; signed: number }> {
  const out: Array<{ d: number; signed: number }> = [];
  for (const s of src) {
    const len = s.e - s.s;
    if (len < 2) continue;
    let best = Number.POSITIVE_INFINITY;
    let signed = 0;
    for (const t of dst) {
      if (overlap(s, t) < 0.5 * len) continue;
      const dd = t.at - s.at;
      if (Math.abs(dd) < best) {
        best = Math.abs(dd);
        signed = dd;
      }
    }
    out.push({ d: best, signed });
  }
  return out;
}

const quantile = (a: number[], p: number) => {
  if (a.length === 0) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};

export type FrameStats = { page: number; lines: number; within1: number; within2: number; median: number; p90: number; dx: number; dy: number };

export function frameStats(page: number, model: OfficePage, pdf: { H: HLine[]; V: VLine[] }): FrameStats {
  const m = pageSegments(model);
  const PH = joinSegs(pdf.H.map((l) => ({ at: l.y, s: l.x0, e: l.x1 })));
  const PV = joinSegs(pdf.V.map((l) => ({ at: l.x, s: l.y0, e: l.y1 })));
  const h = nearest(PH, m.H);
  const v = nearest(PV, m.V);
  const all = [...h, ...v];
  const near = all.filter((x) => x.d <= 2).map((x) => x.d);
  const pct = (n: number) => (all.length === 0 ? Number.NaN : Math.round((n / all.length) * 100));
  return {
    page,
    lines: all.length,
    within1: pct(all.filter((x) => x.d <= 1).length),
    within2: pct(near.length),
    median: quantile(near, 0.5),
    p90: quantile(near, 0.9),
    dx: quantile(v.filter((x) => x.d <= 2).map((x) => x.signed), 0.5),
    dy: quantile(h.filter((x) => x.d <= 2).map((x) => x.signed), 0.5),
  };
}

async function canvasMeasure(): Promise<Measure | undefined> {
  try {
    const mod = (await import(/* @vite-ignore */ "@napi-rs/canvas")) as unknown as { createCanvas(w: number, h: number): { getContext(k: "2d"): { font: string; measureText(t: string): { width: number } } } };
    const ctx = mod.createCanvas(10, 10).getContext("2d");
    return (t: string, f: FontSpec) => {
      ctx.font = cssFont(f, 100);
      return (ctx.measureText(t).width / 100) * f.size;
    };
  } catch {
    return undefined;
  }
}

{
  const [office, pdf, map] = process.argv.slice(2);
  if (!office || !pdf) {
    console.error("node tools/print/ooxml-frames.ts <Excel・Word> <PDF> [頁の対応 1,2,0,…]");
    process.exit(2);
  }
  const r = await renderOffice(new Uint8Array(readFileSync(office)), { measure: await canvasMeasure(), maxPages: 50 });
  const lines = await pdfLines(new Uint8Array(readFileSync(pdf)));
  const pairs = map ? map.split(",").map(Number) : r.pages.map((_, i) => i + 1);
  const rows: FrameStats[] = [];
  r.pages.forEach((p, i) => {
    const q = pairs[i] ? lines[pairs[i] - 1] : undefined;
    if (q) rows.push(frameStats(pairs[i], p, q));
  });
  const f = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "-");
  console.log(JSON.stringify({ kind: r.kind, pages: r.pages.length, pdfPages: lines.length }));
  for (const s of rows) console.log(`頁 ${s.page}: 線 ${s.lines}・1mm 内 ${s.within1}%・2mm 内 ${s.within2}%・中央値 ${f(s.median)}・90% ${f(s.p90)}・横の差 ${f(s.dx)}・縦の差 ${f(s.dy)}`);
}
