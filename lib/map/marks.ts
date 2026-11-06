// 地図に重ねる場所の印（T170。仮想の訓練の世界の出来事）。人のピンと別の物で、人の状態の色を使わない。
// 出来事は訓練の想定なので、地図の上に「デモ」の帯を出す（components/map/WorldMarks.tsx）。

import type { GeoPoint } from "../db/types.ts";

export type MapMark = {
  id: string;
  at: GeoPoint;
  /** 全画面の言葉（場所と出来事） */
  label: string;
  /** 小さな地図の言葉（出来事だけ） */
  short: string;
  title: string;
};

/** 地図の上の帯の言葉 */
export const MARK_BAND = { head: "デモ", title: "出来事", tail: "訓練の想定", more: "他" } as const;

/** 印の高さ（px）と 1 字の幅（px。11px の字）。ピンの名前の印は点の上に出る（高さ LABEL_UP、点の下 LABEL_DOWN） */
const MARK_H = 18;
const CHAR_W = 11;
const MARK_PAD = 18;
const LABEL_UP = 26;
const LABEL_DOWN = 6;
/** 下へ送る回数の上限（送りすぎて元の所が分からなくならないように） */
const DROP_MAX = 6;

type Box = { x0: number; x1: number; y0: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * 印を元の点の下に置き、ピンの名前の印やほかの印に重なれば下へ送る。印の id → 下へ送る長さ（px）。
 * 点と幅は枠の px。幅は字の数からの見積り（描く前に測らない）。
 * maxDrop（小さな地図）を超えて送る印と枠の下にはみ出す印は null（描かない。全画面と場所別の一覧に全部ある）
 */
export function layoutMarks(
  marks: ReadonlyArray<{ id: string; x: number; y: number; text: string }>,
  pins: ReadonlyArray<{ x: number; y: number; w: number }>,
  fit: { maxDrop?: number; height?: number } = {},
): Record<string, number | null> {
  const taken: Box[] = pins.map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y - LABEL_UP, y1: p.y + LABEL_DOWN }));
  const out: Record<string, number | null> = {};
  for (const m of [...marks].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const w = m.text.length * CHAR_W + MARK_PAD;
    const boxAt = (drop: number): Box => ({ x0: m.x - w / 2, x1: m.x + w / 2, y0: m.y + drop, y1: m.y + drop + MARK_H });
    let drop = 0;
    for (let i = 0; i < DROP_MAX && taken.some((b) => hit(b, boxAt(drop))); i++) drop += MARK_H;
    if ((fit.maxDrop !== undefined && drop > fit.maxDrop) || (fit.height !== undefined && m.y + drop + MARK_H > fit.height)) {
      out[m.id] = null;
      continue;
    }
    taken.push(boxAt(drop));
    out[m.id] = drop;
  }
  return out;
}
