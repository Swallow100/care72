// 一覧の形の様式（T131）の何人かをまとめた紙。見出しの行の下に 1 人 1 行の空の行が並ぶ表（利用者の一覧・名簿・安否確認の表）は、
// 様式の読み取り（lib/forms/form-read.ts の決まり 17）で表の列を欄にし、欄の box を 1 行目の枠、行の数と行の間を対応表の list に持つ
// （lib/forms/mapping.ts の ListShape）。1 人ずつの紙（元の様式の上の紙、lib/forms/overlay-sheet.ts）は 1 行目に置く。
// ここは一括印刷（components/forms/PaperBatch.tsx）で、人ごとの紙を 1 枚の表にまとめる: k 人目は (k mod 行の数) 行目へ下げ、
// 行の数を超えたら同じ様式の頁をもう 1 枚。表の外の欄（事業所名・作成日など）は、その枚の最初の人の値を 1 回だけ置く。
// 純な計算だけで、Claude は呼ばない（氏名・住所・電話が入る）。
//
// 様式 9（厚労省の BCP のひな形）はケア72 の専用の紙（lib/forms/frame-form9.ts・components/forms/Form9Paper.tsx）を使う。
// 優先の順（lib/triage の並び）と、ケア72 が足した列（連絡順・緊急連絡先・安否確認の結果）は台帳の項目の差し込みでは出せないので、
// 様式 9 を読み取った対応表は専用の紙へ案内する（isForm9Like。docs/DECISIONS.md「書類」の案（T131））

import { FORM9_HEADS } from "./frame-form9.ts";
import type { FieldBox, FormMapping } from "./mapping.ts";
import type { OverlayItem, OverlayPage, OverlaySheet } from "./overlay-sheet.ts";

/** 様式 9 の専用の紙の画面（lib/forms/form9-href.ts の FORM9_PATH と同じ。確かめの画面〔ブラウザ〕で読むので form9 の部品は読まない） */
export const FORM9_PAPER_PATH = "/office/form9";

const shift = (b: FieldBox, dy: number): FieldBox => ({ ...b, y: Math.round((b.y + dy) * 10000) / 10000 });

function shiftItem(item: OverlayItem, dy: number): OverlayItem {
  return { ...item, box: shift(item.box, dy) };
}

/** 一覧の形の紙にまとめられるか（同じ対応表の一覧の形で、表の列の欄がある） */
export function isListSheet(s: OverlaySheet): s is OverlaySheet & { list: NonNullable<OverlaySheet["list"]> } {
  return s.list !== undefined && s.list.fieldIds.length > 0;
}

/**
 * 人ごとの紙（同じ対応表から作った物、渡した順）を、行ごとに 1 人の紙にまとめる。人が行の数より多ければ枚を足す。
 * 別紙は人の名前を欄の名前の前に付けて 1 つに。未確認・対応なし・省略の帯は全員の分を重ねずに
 */
export function mergeListSheets(sheets: ReadonlyArray<OverlaySheet>): OverlaySheet[] {
  if (sheets.length === 0) return [];
  const head = sheets[0];
  if (!isListSheet(head)) return [...sheets];
  const { rows, step, page: listPage, fieldIds } = head.list;
  const inList = new Set(fieldIds);
  const out: OverlaySheet[] = [];
  for (let start = 0; start < sheets.length; start += rows) {
    const chunk = sheets.slice(start, start + rows);
    const pages: OverlayPage[] = head.pages.map((p) => ({ ...p, items: [], fills: [], ...(p.targets ? { targets: [] } : {}) }));
    chunk.forEach((s, k) => {
      for (const sp of s.pages) {
        const page = pages.find((p) => p.page === sp.page);
        if (!page) continue;
        const listed = sp.page === listPage;
        const dy = step * k;
        for (const item of sp.items) {
          if (listed && inList.has(item.fieldId)) page.items.push(shiftItem(item, dy));
          else if (k === 0) page.items.push(item);
        }
        for (const fill of sp.fills) {
          if (listed && fill.keys.some((key) => inList.has(key))) page.fills.push({ ...fill, box: shift(fill.box, dy) });
          else if (k === 0) page.fills.push(fill);
        }
      }
    });
    const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];
    out.push({
      ...head,
      personId: `${head.personId}:list:${start / rows + 1}`,
      name: `${chunk.length} 人`,
      pages,
      annex: chunk.flatMap((s) => s.annex.map((a) => ({ ...a, label: `${s.name} ${a.label}` }))),
      unconfirmed: uniq(chunk.flatMap((s) => s.unconfirmed)),
      unmapped: uniq(chunk.flatMap((s) => s.unmapped)),
      withheld: uniq(chunk.flatMap((s) => s.withheld)),
    });
  }
  return out;
}

/** 欄の名前の照らし（空白・改行・括弧・※・：をそろえる。確かめの画面〔ブラウザ〕でも読むので mapped-sheet の normalizeWord は読まない） */
const norm = (s: string) => s.normalize("NFKC").replace(/[\s　()（）【】「」※:：]/g, "");

/**
 * 様式 9（厚労省 BCP のひな形の利用者一覧）を読み取った対応表か（T131）。題に「様式9」か「利用者一覧」があり、
 * ひな形の列の見出し（No・優先順位・地域区分・氏名（年齢）・住所・避難所・特記・担当ケアマネ・安否確認できた日…）の半分より多くが欄の名前にある。
 * 当たれば、確かめの画面から専用の紙へ案内する（差し込みの紙も作れるが、優先の順とケア72 の列は専用の紙にしか無い）
 */
export function isForm9Like(m: Pick<FormMapping, "title" | "fields">): boolean {
  // 一覧の表の形（list）は見ない（本物が行の帯を返さない・形が合わずに一覧にならなくても、題と見出しで様式 9 と分かれば案内する）
  const title = norm(m.title);
  if (!title.includes("様式9") && !title.includes("利用者一覧")) return false;
  const heads = FORM9_HEADS.map((h) => norm(h.text)).filter((h) => h !== "");
  const labels = new Set(m.fields.filter((f) => !f.removed).flatMap((f) => [norm(f.label), norm(f.section)]));
  const hit = heads.filter((h) => labels.has(h)).length;
  return hit * 2 > heads.length;
}
