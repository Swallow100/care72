// □ の右の空きに中身の欄を補う（T168）。様式の読み取りの補いの 1 つで、Claude を呼ばない（lib/forms/item-hints.ts と同じ考え。こちらは頁の印刷の字の位置を使う）。
//
// 評価の 8 回目で、災害診療記録の「□アレルギー」に印は付くのに、物の名前が紙に残らなかった（取りこぼし 18）。原本は括弧を刷らず、名前の右が行の端まで
// 空いているだけなので、読み取りの決まり 21（□ と括弧の 2 つの欄）に当たらず、AI は □ だけを挙げた。常用薬の括弧の欄（T164）と同じ形にするため、
// □ の右の空きを「X（　）」の字の欄として足す。値の出し方は括弧の子の欄（lib/forms/mapped-sheet.ts の bracketCell）のまま。
//
// - 足すのは、中身が言葉の並びで種類の □ を持たない項目（アレルギー・既往症・予防接種）の □ だけ。常用薬・機器は □ が種類を指す（透析の行に字を足さない）
// - 同じ頁に同じ項目の欄がほかにあれば足さない（外した欄も数える。人が外した欄を足し直さない）
// - 空きは、名前の字の右から、次の字・縦の罫線・ほかの欄の手前まで。同じ表の枠の中だけ。狭ければ足さない（違う欄に書くくらいなら空ける）
// - 足した欄は AI の読んだ物と同じく確かめの画面で人が見る（理由に「（補）」）
// ここは純な計算だけ。読み取りの受け口（lib/forms/read-post.ts）が対応表を保存する前に通す。

import type { InkBlob } from "./ink.ts";
import { LIMITS, nextFieldId, type FieldBox, type LedgerItemKey, type MappingField } from "./mapping.ts";

/** 中身の言葉の並びを持つ項目 */
const CONTENT_ITEMS: ReadonlySet<LedgerItemKey> = new Set<LedgerItemKey>(["medical.allergies", "medical.history", "medical.vaccinations"]);

/** □ の中身を書く所を持つべき項目か（台の数も同じ物を見る） */
export const isContentItem = (item: LedgerItemKey | null | undefined): boolean => !!item && CONTENT_ITEMS.has(item);

/** 名前の字のかたまりと見る、字の間の空き（mm）。これより広ければ名前の終わり */
const LABEL_GAP_MM = 5;
/** 空きの最小の幅（mm）。短い名前 1 つ分より狭い所には足さない */
const MIN_WIDTH_MM = 20;
/** 空きの最小の高さ（mm）。紙の字の下限 6pt の 1 行 */
const MIN_HEIGHT_MM = 2.6;
/** 欄の高さの目安（mm） */
const WANT_HEIGHT_MM = 4.4;
/** 名前の字・罫線からの空き（mm） */
const CLEAR_MM = 0.8;

export type TrailingPage = { ink: readonly InkBlob[] | null; image: { w: number; h: number } };

const yOverlap = (a: FieldBox, y0: number, y1: number) => Math.max(0, Math.min(a.y + a.h, y1) - Math.max(a.y, y0));
const holds = (o: FieldBox, x: number, y: number) => o.x <= x && x <= o.x + o.w && o.y <= y && y <= o.y + o.h;

/** □ の右の空き（頁の比）。足せなければ null */
export function blankRightOf(mark: FieldBox, page: Required<TrailingPage>, others: ReadonlyArray<FieldBox>): FieldBox | null {
  const ink = page.ink;
  if (!ink) return null;
  const { w: W, h: H } = page.image;
  const y0 = mark.y;
  const y1 = mark.y + mark.h;
  const inRow = (b: FieldBox) => yOverlap(b, y0, y1) >= 0.5 * Math.min(b.h, y1 - y0);
  // 名前の字のかたまり（□ のすぐ右から、広い空きの手前まで）
  const glyphs = ink.filter((b) => !b.line && inRow(b) && b.x >= mark.x + mark.w * 0.5).sort((a, b) => a.x - b.x);
  let end = mark.x + mark.w;
  let top = y0;
  let bottom = y1;
  let next: InkBlob | null = null;
  for (const g of glyphs) {
    if (g.x + g.w <= end) continue;
    if ((g.x - end) * W > LABEL_GAP_MM) {
      next = g;
      break;
    }
    end = Math.max(end, g.x + g.w);
    top = Math.min(top, g.y);
    bottom = Math.max(bottom, g.y + g.h);
  }
  const x0 = end + CLEAR_MM / W;
  // 右の端: 次の字・縦の罫線・ほかの欄。何も無ければ頁の刷ってある物の右の端（紙の端まで広げない）
  const printedRight = Math.max(...ink.map((b) => b.x + b.w));
  let right = next ? next.x : printedRight;
  const rules = ink.filter((b) => b.line && b.h > b.w && yOverlap(b, y0, y1) > 0 && b.x >= x0);
  for (const r of rules) right = Math.min(right, r.x);
  const cx = mark.x + mark.w / 2;
  const cy = mark.y + mark.h / 2;
  // □ を中に持つ欄は外の段（段全体の手書きの欄）なので避けない
  const near = others.filter((o) => !holds(o, cx, cy));
  for (const o of near) {
    if (yOverlap(o, y0, y1) < 0.5 * Math.min(o.h, y1 - y0)) continue;
    // 名前の上に掛かる欄（□ の名前を字の欄に読んだ物）があれば、どこに書くか確かでない
    if (o.x < x0 && o.x + o.w > x0) return null;
    if (o.x >= x0) right = Math.min(right, o.x);
  }
  const x1 = right - CLEAR_MM / W;
  if ((x1 - x0) * W < MIN_WIDTH_MM) return null;
  // 高さ: 名前の字の高さの真ん中に、目安の高さ。上下の字・横の罫線・ほかの欄の手前まで
  const mid = (top + bottom) / 2;
  let up = mid - Math.max(WANT_HEIGHT_MM / H / 2, (bottom - top) / 2);
  let down = mid + Math.max(WANT_HEIGHT_MM / H / 2, (bottom - top) / 2);
  const wide = (b: FieldBox) => b.x < x1 && b.x + b.w > x0;
  for (const b of [...ink.filter(wide), ...near.filter(wide)]) {
    if (b.y + b.h <= mid) up = Math.max(up, b.y + b.h);
    else if (b.y >= mid) down = Math.min(down, b.y);
    else return null; // 真ん中の高さに掛かる物（行を横切る）がある
  }
  if ((down - up) * H < MIN_HEIGHT_MM) return null;
  return { x: x0, y: up, w: x1 - x0, h: down - up };
}

/** 名前の後ろの空の括弧を外す（「アレルギー（　）」も同じ字の欄の名前にする） */
const bareLabel = (label: string) => label.replace(/[（(][\s　]*[）)][\s　]*$/, "").trim();

/**
 * 対応表の □ の右の空きに、中身の字の欄を足す（足した欄は □ のすぐ後ろ）。pages は頁の番号（1 から）→ 頁。印刷の字の位置の無い頁は足さない。
 * only があればその頁だけ（読み直した頁）
 */
export function addTrailingFields(fields: readonly MappingField[], pages: ReadonlyMap<number, TrailingPage>, only?: ReadonlySet<number>): MappingField[] {
  const out: MappingField[] = [];
  let room = LIMITS.fields - fields.length;
  for (const f of fields) {
    out.push(f);
    if (room <= 0 || f.removed || f.shape !== "check" || !f.box || !isContentItem(f.item)) continue;
    if (only && !only.has(f.page)) continue;
    if (fields.some((g) => g !== f && g.page === f.page && g.item === f.item)) continue;
    const page = pages.get(f.page);
    if (!page?.ink) continue;
    const others = fields.filter((g) => g !== f && !g.removed && g.page === f.page && g.box).map((g) => g.box!);
    const box = blankRightOf(f.box, { ink: page.ink, image: page.image }, others);
    if (!box) continue;
    const item = f.item!;
    out.push({
      ...f,
      id: nextFieldId([...fields, ...out]),
      label: `${bareLabel(f.label)}（　）`,
      shape: "text",
      options: [],
      box,
      ai: f.ai ? { item, confidence: "medium", reason: "□ の右の空き（補）", box } : null,
    });
    room -= 1;
  }
  return out;
}
