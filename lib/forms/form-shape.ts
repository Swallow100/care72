// 様式の形から、1 つの台帳の項目を当ててよい欄を決める（T140）。評価の 4 回目で、岐阜市の様式（同じ表が 3 頁に並ぶ写しの様式）の
// 紙 1 枚に決まりの見直しの「重複」が 40 前後出た（同じ項目を頁ごとに当てるのは読み取りの決まり 12 のとおりで、写しの頁に同じ値を書くのは正しい）。
//
// 1 つの項目を当ててよいのは、次の欄ごとに 1 つ:
// - 頁ごとの同じ場所（写しの頁・頁の頭に繰り返す氏名や作成日）: 別の頁で、同じ項目、欄の真ん中の差が頁の 3% までの欄は同じ所と見る
// - 電話と携帯: 連絡先の電話の項目は電話と携帯の 2 行を持つので、「携帯」の欄と電話の欄は別の所（lib/forms/mapped-sheet.ts の phoneRole）
// - 一覧の形の様式（T131）の行ごとの欄: 対応表は 1 行目の 1 欄だけを持ち、行は紙を作るときに増える（対応表の欄どうしで重ならない）
// これより多く同じ項目を当てた欄・同じ値が名前の違う 2 つの欄に入ったのが本当の重複（見直しの「重複」、lib/forms/review.ts）。
// 決めるのはコード（Claude を呼ばない）。ブラウザでも読む。

import type { FieldBox } from "./mapping.ts";

export type ShapeField = { id: string; page: number | null; box: FieldBox | null; source?: string | null; item?: string | null; label: string };

/** 頁ごとの同じ場所と見る、欄の真ん中の差（頁の比） */
const SLOT_NEAR = 0.03;

const itemOf = (f: ShapeField) => f.source ?? f.item ?? null;
const center = (b: FieldBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const near = (a: FieldBox, b: FieldBox) => {
  const p = center(a);
  const q = center(b);
  return Math.abs(p.x - q.x) <= SLOT_NEAR && Math.abs(p.y - q.y) <= SLOT_NEAR;
};

/** 2 つの欄が、頁ごとの同じ場所の欄か（別の頁で、同じ項目、ほぼ同じ場所。写しの頁・頁の頭に繰り返す欄） */
export function pageRepeat(a: ShapeField, b: ShapeField): boolean {
  if (a.page === null || b.page === null || a.page === b.page || !a.box || !b.box) return false;
  return itemOf(a) !== null && itemOf(a) === itemOf(b) && near(a.box, b.box);
}

const MOBILE = /携帯/;
/** 電話と携帯の欄（同じ連絡先の電話の項目の 2 行） */
export function phonePair(a: ShapeField, b: ShapeField): boolean {
  return itemOf(a) === itemOf(b) && /\.phone$/.test(itemOf(a) ?? "") && MOBILE.test(a.label) !== MOBILE.test(b.label);
}

/** 同じ値・同じ項目でも重複と見ない組（頁ごとの同じ場所・電話と携帯） */
export const allowedTwice = (a: ShapeField, b: ShapeField) => pageRepeat(a, b) || phonePair(a, b);

/**
 * 項目を当ててよい数より多く当てた欄（様式の順に、前の欄のどれとも頁ごとの同じ場所・電話と携帯の組にならない 2 つ目からの欄）。
 * 欄の id → 先に当てた欄の id
 */
export function extraItemFields<T extends ShapeField>(fields: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  const bySource = new Map<string, T[]>();
  for (const f of fields) {
    const item = itemOf(f);
    if (!item) continue;
    const before = bySource.get(item) ?? [];
    bySource.set(item, [...before, f]);
    if (before.length > 0 && !before.some((g) => allowedTwice(g, f))) out.set(f.id, before[0]);
  }
  return out;
}
