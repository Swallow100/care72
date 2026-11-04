// 連絡先のフリガナ・住所・携帯（T117、contacts.kana・address・mobile、migration 0029）の値の形をそろえる。
// 問いの答え（lib/intake/answer.ts）・本人のページの面の編集（lib/intake/edit.ts）・紙に直接書く窓（components/forms/PaperEdit.tsx）が同じ物を使う。
// ブラウザでも読む。Claude は通らない（氏名と同じ扱い。docs/progress/t117.md の問い 5）。

import { CONTACT_PART_LABELS } from "../labels.ts";

export const CONTACT_PARTS = ["kana", "address", "mobile"] as const;
export type ContactPart = (typeof CONTACT_PARTS)[number];

/** 長さの上限（字）。lib/intake/save.ts の CONTACT_PART_MAX と同じ。住所は市町村と町名まで（番地は持たない） */
const MAX: Record<ContactPart, number> = { kana: 40, address: 60, mobile: 20 };

/** 電話番号の形（lib/intake/save.ts の連絡先の phone・mobile と同じ） */
const PHONE = /^[0-9+\-() ]{1,20}$/;

/** 全角の数字・ハイフン・括弧を半角に、ひらがなをカタカナに（フリガナ） */
const toHalf = (s: string) =>
  s.replace(/[０-９（）＋]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[－ー‐―−]/g, "-");
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** 入れた文字を保存の形に。空・形に合わないときは null */
export function contactPartValue(part: ContactPart, raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s === "") return null;
  if (part === "mobile") {
    const v = toHalf(s);
    return PHONE.test(v) ? v : null;
  }
  const v = part === "kana" ? toKatakana(s) : s;
  return v.slice(0, MAX[part]);
}

export const contactPartLabel = (part: ContactPart) => CONTACT_PART_LABELS[part];
