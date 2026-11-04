// 欄の場所を人が直す計算（T86。場所の確かめの画面 components/forms/mapping/PageBoxes.tsx）。純な計算だけで、ブラウザでもテストでも動く。
// 場所は頁の画像の比（0〜1）。動かす・大きさを変える・押した所へ移す・新しく置く。結果はいつも clampBox で頁の中に収める。

import { clampBox, type FieldBox, type MappingField } from "./mapping.ts";

/** 動かす・広げる 1 回の量（頁の 0.5%） */
export const BOX_STEP = 0.005;

/** 欄そのもの（-1）か、choice の何番目の選択肢か */
export type BoxTarget = number;
export const FIELD_TARGET: BoxTarget = -1;

/** 新しく置くときの大きさ（欄は横長の 1 行、□ と選択肢は小さな四角） */
export function defaultSize(field: MappingField, target: BoxTarget): { w: number; h: number } {
  if (target >= 0 || field.shape === "check") return { w: 0.025, h: 0.018 };
  if (field.shape === "lines") return { w: 0.4, h: 0.08 };
  return { w: 0.25, h: 0.025 };
}

/** 動かす（向きと量）。頁の外へは出さず、大きさは保つ */
export function moveBox(b: FieldBox, dx: number, dy: number): FieldBox {
  const x = Math.min(Math.max(0, b.x + dx), 1 - b.w);
  const y = Math.min(Math.max(0, b.y + dy), 1 - b.h);
  return clampBox({ ...b, x, y }) ?? b;
}

/** 大きさを変える（左上は動かさない）。小さすぎ・頁の外は切る */
export function resizeBox(b: FieldBox, dw: number, dh: number): FieldBox {
  return clampBox({ ...b, w: Math.max(0.005, b.w + dw), h: Math.max(0.005, b.h + dh) }) ?? b;
}

/** 押した所（比）を左上にして移す。場所が無ければ決まった大きさで置く */
export function placeAt(b: FieldBox | null, size: { w: number; h: number }, x: number, y: number): FieldBox | null {
  const w = b?.w ?? size.w;
  const h = b?.h ?? size.h;
  return clampBox({ x: Math.min(Math.max(0, x), 1 - w), y: Math.min(Math.max(0, y), 1 - h), w, h });
}

/** 数の欄（%）からの場所。読めない数は前のまま */
export function fromPercent(b: FieldBox, key: keyof FieldBox, percent: number): FieldBox {
  if (!Number.isFinite(percent)) return b;
  return clampBox({ ...b, [key]: percent / 100 }) ?? b;
}

/** 欄の場所か選択肢の場所 */
export function boxOf(f: MappingField, target: BoxTarget): FieldBox | null {
  return target < 0 ? (f.box ?? null) : (f.optionBoxes?.[target] ?? null);
}

/** 欄の場所か選択肢の場所を替えた欄。選択肢の場所が全部無くなれば optionBoxes を外す */
export function withBox(f: MappingField, target: BoxTarget, box: FieldBox | null): MappingField {
  if (target < 0) return { ...f, box };
  if (target >= f.options.length) return f;
  const boxes = f.options.map((_, i) => (i === target ? box : (f.optionBoxes?.[i] ?? null)));
  if (boxes.every((x) => x === null)) {
    const { optionBoxes: _drop, ...rest } = f;
    return rest;
  }
  return { ...f, optionBoxes: boxes };
}

/** 選択肢を書き直したとき、同じ名前の選択肢の場所を引き継ぐ（無くなった選択肢の場所は捨てる） */
export function realignOptionBoxes(f: MappingField, options: string[]): MappingField {
  const old = new Map(f.options.map((o, i) => [o, f.optionBoxes?.[i] ?? null] as const));
  const boxes = options.map((o) => old.get(o) ?? null);
  const { optionBoxes: _drop, ...rest } = f;
  return boxes.some((x) => x !== null) ? { ...rest, options, optionBoxes: boxes } : { ...rest, options };
}
