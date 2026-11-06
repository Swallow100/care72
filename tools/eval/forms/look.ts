// 評価の台の紙の見た目の数（T133）。紙の当たり（正解に字のある欄で同じ字か）では見えない物を数える:
// - 重なり・はみ出し・隣の欄・ずらした所・置けなかった欄（lib/forms/overlay-check.ts）
// - 台帳あり空欄: 台帳に値があるのに、紙のその欄に何も置いていない欄。欄に当たる項目は、正解の表のある様式は正解の項目（AI の項目が
//   正解か別解ならそれ）、無い様式・正解と合わせていない欄は AI の項目、項目なしなら読み取りの補いの見込み（lib/forms/item-hints.ts）。
//   本人・連絡先・支援者の住所・電話・フリガナの欄も同じに数える
// - 伏字: 紙に「（氏名）」「（町名）」「（電話）」「（生年月日）」の伏字の跡や、住所の欄の「（市内）」「（近所）」のような仮の言い方が出た数
// 数は欄の名前と種類だけを記録に残す（値は書かない）。

import { itemHints } from "../../../lib/forms/item-hints.ts";
import { buildMappedSheet, type MappedSheet } from "../../../lib/forms/mapped-sheet.ts";
import type { FormMapping, LedgerItemKey, MappingField } from "../../../lib/forms/mapping.ts";
import { checkLook, type LookCheck } from "../../../lib/forms/overlay-check.ts";
import { annexGaps, fieldLines, isNoneOnly, type OverlaySheet } from "../../../lib/forms/overlay-sheet.ts";
import type { PageImage } from "../../../lib/forms/page-images.ts";
import type { Cell } from "../../../lib/forms/matsuyama.ts";
import type { PersonPageRows } from "../../../lib/person.ts";

/** blanksChoice は台帳あり空欄のうち、選ぶ欄で値が選択肢に合わず「その他」の空きも無い欄（要介護 1 の人の「要介護 3〜5」の □ のように、空くのが答えの欄も入る） */
/** unplacedOption・unplacedRoom・unplacedBox は置けなかった欄の訳（T140。lib/forms/overlay-sheet.ts の UnplacedReason） */
/** annexGap は別紙の中身と紙の「別紙」の印のずれ（T141。lib/forms/overlay-sheet.ts の annexGaps の印なし・行なしの合計） */
/**
 * 置けなかった欄の種類（T160）: unplacedDate は日付の欄、unplacedPicked は選ぶ欄で選択肢の表（言い換えの表・AI の当て）が台帳の値に当てたのに
 * 印を置けなかった欄（当たる選択肢が 2 つ以上・当たった選択肢の □ の場所が無い）、unplacedContact は緊急連絡先・支援者の欄
 */
export type LookScore = Omit<LookCheck, "issues"> & {
  blanks: number;
  blanksChoice: number;
  masks: number;
  unplacedOption: number;
  unplacedRoom: number;
  unplacedBox: number;
  annexGap?: number;
  unplacedDate?: number;
  unplacedPicked?: number;
  unplacedContact?: number;
};

export const emptyLookScore = (): LookScore => ({
  texts: 0,
  marks: 0,
  overlap: 0,
  outside: 0,
  neighbor: 0,
  shifted: 0,
  unplaced: 0,
  inkPages: 0,
  blanks: 0,
  blanksChoice: 0,
  masks: 0,
  unplacedOption: 0,
  unplacedRoom: 0,
  unplacedBox: 0,
  annexGap: 0,
  unplacedDate: 0,
  unplacedPicked: 0,
  unplacedContact: 0,
});

/** 日付の欄（T160。lib/forms/review.ts の日付の見直しと同じ見分け方に「記入日」） */
export const isDateField = (f: Pick<MappingField, "shape" | "label">) => f.shape === "date" || /生年月日|年月日|作成日|記入日|日付/.test(f.label);
/** 緊急連絡先・支援者の欄（T160） */
const CONTACT_ITEM = /^(emergency|supporter)\d\./;

/** 伏字の跡・仮の言い方（括弧の全角・半角どちらも） */
export const MASK_WORDS = /[（(]\s*(氏名|町名|電話|住所|郵便番号|メール|生年月日|市内|近所|同居|県外|遠方)\s*[）)]/;

const nameOf = (f: MappingField) => (f.section ? `${f.section} ${f.label}` : f.label);

/** 欄の値があるか（□ は印、選ぶ欄は印か添え、ほかは書く字。「なし」だけは値でない） */
export function hasValue(field: MappingField, cell: Cell): boolean {
  if (cell.kind === "choice") return cell.options.some((o) => o.on && (field.shape === "check" || field.shape === "choice")) || (field.shape === "choice" && (cell.after?.length ?? 0) > 0 && fieldLines(field, cell).length > 0);
  const lines = fieldLines(field, cell);
  return lines.length > 0 && !isNoneOnly(lines);
}

/** 欄に何か置いたか（字・印・地図、同じ書く所に重ねた字、別紙） */
function drawn(field: MappingField, sheet: OverlaySheet): boolean {
  if (sheet.annex.some((a) => a.fieldId === field.id)) return true;
  const page = sheet.pages.find((p) => p.page === field.page);
  if (!page) return false;
  return page.items.some((it) => {
    if (it.fieldId === field.id) return true;
    if (it.kind !== "text" || !field.box) return false;
    const b = it.box;
    const w = Math.min(b.x + b.w, field.box.x + field.box.w) - Math.max(b.x, field.box.x);
    const h = Math.min(b.y + b.h, field.box.y + field.box.h) - Math.max(b.y, field.box.y);
    return w > 0 && h > 0 && w * h >= 0.5 * b.w * b.h;
  });
}

export type LookResult = { score: LookScore; check: LookCheck; blanks: Array<{ field: string; label: string; item: string; choice: boolean }>; masks: Array<{ field: string; label: string }> };

/**
 * 1 枚の紙の見た目の数。goldItems は正解の表のある様式の、AI の欄の id → 正解の項目と別解（合わせた欄だけ）
 */
export function lookOfPaper(o: {
  rows: PersonPageRows;
  mapping: FormMapping;
  images: readonly PageImage[];
  overlay: OverlaySheet;
  today: string;
  goldItems?: ReadonlyMap<string, { item: LedgerItemKey | null; accept: ReadonlyArray<LedgerItemKey | null> }>;
}): LookResult {
  const check = checkLook(o.overlay, o.mapping.fields, o.images);
  // 欄に当たる項目
  const hints = new Map(itemHints(o.mapping.fields).map((h) => [h.id, h.item]));
  const expectedItem = (f: MappingField): LedgerItemKey | null => {
    const g = o.goldItems?.get(f.id);
    // AI の項目が正解か別解ならそれ（別解が項目なしなら、空くのも答え）
    if (g) return f.item === g.item || g.accept.includes(f.item) ? f.item : g.item;
    return f.item ?? hints.get(f.id) ?? null;
  };
  const hinted: FormMapping = { ...o.mapping, holdRisky: false, fields: o.mapping.fields.map((f) => ({ ...f, item: f.shape === "handwrite" ? null : expectedItem(f) })) };
  const sheet: MappedSheet = buildMappedSheet(o.rows, hinted, { today: o.today, officeName: "デモ事業所" });
  const blanks: LookResult["blanks"] = [];
  for (const p of sheet.pages)
    for (const s of p.sections)
      for (const { field, cell } of s.rows) {
        if (field.removed || field.shape === "handwrite" || !field.item) continue;
        if (!hasValue(field, cell)) continue;
        const actual = o.mapping.fields.find((f) => f.id === field.id)!;
        const choice = cell.kind === "choice" && field.shape === "choice" && !cell.options.some((x) => x.on);
        if (!drawn(actual, o.overlay)) blanks.push({ field: field.id, label: nameOf(field), item: field.item, choice });
      }
  const masks: LookResult["masks"] = [];
  for (const p of o.overlay.pages)
    for (const it of p.items)
      if (it.kind === "text" && it.lines.some((l) => MASK_WORDS.test(l))) {
        const f = o.mapping.fields.find((x) => x.id === it.fieldId);
        masks.push({ field: it.fieldId, label: f ? nameOf(f) : it.fieldId });
      }
  for (const a of o.overlay.annex) if (a.lines.some((l) => MASK_WORDS.test(l))) masks.push({ field: a.fieldId, label: a.label });
  // 置けなかった欄の種類（T160）。選ぶ欄は、実際の対応表で作った値（台帳の値に当たる選択肢があったか）で見る
  const unplacedIds = new Set(o.overlay.unplacedIds ?? []);
  const actualCells = new Map<string, Cell>();
  if (unplacedIds.size > 0) {
    const actualSheet = buildMappedSheet(o.rows, o.mapping, { today: o.today, officeName: "デモ事業所" });
    for (const p of actualSheet.pages) for (const s of p.sections) for (const { field, cell } of s.rows) if (unplacedIds.has(field.id)) actualCells.set(field.id, cell);
  }
  const unplacedFields = o.mapping.fields.filter((f) => unplacedIds.has(f.id));
  const picked = unplacedFields.filter((f) => {
    const c = actualCells.get(f.id);
    return f.shape === "choice" && c?.kind === "choice" && (c.ambiguous === true || c.options.some((x) => x.on));
  });
  const { issues: _i, ...rest } = check;
  const why = Object.values(o.overlay.unplacedWhy ?? {});
  const reason = (r: string) => why.filter((w) => w === r).length;
  return {
    score: {
      ...rest,
      blanks: blanks.length,
      blanksChoice: blanks.filter((b) => b.choice).length,
      masks: masks.length,
      unplacedOption: reason("option"),
      unplacedRoom: reason("room"),
      unplacedBox: reason("box"),
      annexGap: (() => {
        const g = annexGaps(o.overlay);
        return g.noMark.length + g.noRow.length;
      })(),
      unplacedDate: unplacedFields.filter(isDateField).length,
      unplacedPicked: picked.length,
      unplacedContact: unplacedFields.filter((f) => CONTACT_ITEM.test(f.item ?? "")).length,
    },
    check,
    blanks,
    masks,
  };
}

export function addLook(a: LookScore, b: LookScore): LookScore {
  const out = { ...a };
  for (const k of Object.keys(b) as Array<keyof LookScore>) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  return out;
}
