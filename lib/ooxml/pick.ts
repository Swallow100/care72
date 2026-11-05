// Excel・Word の頁のうち、既定で送る頁（T119・T122）。黒塗りの画面（components/person/RedactSheet.tsx）と評価の台（tools/eval/forms）が同じ決まりを使う。
// 送れるのは 3 頁まで（PDF と同じ上限）。
//
// T119: 4 頁以上あれば、記入例・記載例のシートを外して頭から 3 頁。全部が記入例なら頭から 3 頁。
// T122: シートが 2 つ以上のブックは、様式の本体らしいシートを選ぶ（評価の 2 回目で、厚労省の BCP のひな形のブック〔23 シート・45 頁〕の
// 様式 9 のシートが最後にあり、頭の 3 頁〔表紙・目次〕を読んで様式 9 の欄が 0/12 だった。docs/progress/eval-r2-forms-findings.md の 1）:
// - シートの中の字に、個別避難計画・利用者の一覧の欄の言葉（氏名・住所・避難・支援・緊急・同意…）がいくつあるか（formWordCount）。
//   印刷範囲が決めてあるシートは 1 つ足す
// - 表紙・目次・本文・補足・説明・手引きなどの名前のシート（explanationSheet）と記入例のシートは後ろ（本体の候補にしない）
// - いちばん言葉の多いシートを選び、その前後に続くシートも本体らしければ（言葉が 3 つ以上で、いちばんの 4 分の 1 以上）足す
//   （表面・裏面、その１・その２ のように 1 つの様式が続くシートに分かれている物）。3 頁まで。送る順はブックの順
// - 本体らしいシートが無い（言葉が 3 つ未満）・シートが 1 つ・Word は、T119 のまま

import { PDF_PAGES_MAX } from "../intake/read-form.ts";
// 黒塗りの画面（components/person/RedactSheet.tsx）が初めから読み込むので、Excel・Word を描く部品（xlsx.ts・zip.ts・xml.ts）を import しない
import type { OfficePage } from "./page.ts";

/** 記入例・記載例・事例のシートか（既定で読まない候補） */
export const isExampleSheet = (name: string) => /記入例|記載例|事例|見本|サンプル|例\s*[)）】]|^例/.test(name);

/**
 * 様式の本体の欄に出る言葉（個別避難計画・名簿登録・利用者一覧の欄の名前）。シートの中の字にいくつあるかで、様式の本体らしさを見る。
 * 言葉はケア72 の台帳の項目と欄の名前から（原本の字は持たない）
 */
export const FORM_WORDS: readonly string[] = [
  "氏名",
  "フリガナ",
  "ふりがな",
  "住所",
  "電話",
  "生年月日",
  "性別",
  "年齢",
  "避難",
  "避難所",
  "避難場所",
  "支援",
  "緊急",
  "連絡先",
  "続柄",
  "家族",
  "世帯",
  "要介護",
  "介護",
  "障害",
  "医療",
  "同意",
  "署名",
  "安否",
  "担当",
  "ケアマネ",
  "自治会",
  "地区",
  "作成日",
  "優先",
];

/** 様式の本体でない、表紙・目次・説明のシートの名前 */
export const explanationSheet = (name: string) =>
  /表紙|目次|本文|補足|説明|手引|注意|留意|記入方法|記載方法|書き方|使い方|はじめに|凡例|参考|概要|目的|改訂|履歴|選択肢|マスタ|リスト/.test(name);

/** 字の中の様式の言葉の数（同じ言葉は 1 つ） */
export function formWordCount(text: string): number {
  return FORM_WORDS.filter((w) => text.includes(w)).length;
}

/** 頁の字を全部つなげた物（様式の言葉を数えるだけに使う。外へ出さない） */
export function pageText(page: Pick<OfficePage, "items">): string {
  return page.items.map((i) => (i.k === "text" ? i.text : "")).join(" ");
}

/** シートごとの様式の言葉の数（シートの全部の頁の字を合わせて数える）。Word は空 */
export function sheetWordCounts(pages: ReadonlyArray<Pick<OfficePage, "items" | "sheet">>): Map<string, number> {
  const texts = new Map<string, string[]>();
  for (const p of pages) if (p.sheet) texts.set(p.sheet, [...(texts.get(p.sheet) ?? []), pageText(p)]);
  return new Map([...texts].map(([name, t]) => [name, formWordCount(t.join(" "))]));
}

/** 頁の形から、既定で送る頁を決めるための印（id は呼ぶ側の頁の id） */
export function pickPageOf(page: Pick<OfficePage, "sheet" | "printArea">, id: string, words: ReadonlyMap<string, number>): PickPage {
  return { id, example: page.sheet ? isExampleSheet(page.sheet) : false, sheet: page.sheet, words: page.sheet ? (words.get(page.sheet) ?? 0) : 0, printArea: page.printArea === true };
}

/** 既定で送る頁を決めるための頁の印 */
export type PickPage = {
  id: string;
  /** 記入例・記載例のシート */
  example: boolean;
  /** Excel のシートの名前（Word・PDF は null か無し） */
  sheet?: string | null;
  /** 頁の中の様式の言葉の数（formWordCount） */
  words?: number;
  /** シートに印刷範囲が決めてある */
  printArea?: boolean;
};

/** 本体らしいシートの言葉の下限と、続くシートを足す割合 */
const FORM_MIN = 3;
const NEIGHBOR_SHARE = 0.25;

type SheetGroup = { name: string; pages: PickPage[]; example: boolean; explain: boolean; score: number };

/** シートごとにまとめる（ブックの順）。点はシートの言葉の数（sheetWordCounts）と印刷範囲の 1 */
function sheetGroups(pages: ReadonlyArray<PickPage>): SheetGroup[] {
  const out: SheetGroup[] = [];
  for (const p of pages) {
    const name = p.sheet ?? "";
    let g = out.find((x) => x.name === name);
    if (!g) {
      g = { name, pages: [], example: p.example, explain: explanationSheet(name), score: 0 };
      out.push(g);
    }
    g.pages.push(p);
    g.score = Math.max(g.score, (p.words ?? 0) + (p.printArea ? 1 : 0));
  }
  return out;
}

/** 本体らしいシートを選ぶ（T122）。選べなければ null */
export function formSheets(pages: ReadonlyArray<PickPage>, max = PDF_PAGES_MAX): string[] | null {
  if (!pages.some((p) => p.sheet)) return null;
  const groups = sheetGroups(pages);
  if (groups.length < 2) return null;
  const isCand = (g: SheetGroup) => !g.example && !g.explain;
  let best = -1;
  groups.forEach((g, i) => {
    if (isCand(g) && (best < 0 || g.score > groups[best].score)) best = i;
  });
  if (best < 0 || groups[best].score < FORM_MIN) return null;
  const floor = Math.max(FORM_MIN, groups[best].score * NEIGHBOR_SHARE);
  const ok = (i: number) => i >= 0 && i < groups.length && isCand(groups[i]) && groups[i].score >= floor;
  let lo = best;
  let hi = best;
  let used = groups[best].pages.length;
  while (used < max) {
    const before = ok(lo - 1) ? groups[lo - 1] : null;
    const after = ok(hi + 1) ? groups[hi + 1] : null;
    if (!before && !after) break;
    // 言葉の多い方から（同じなら後ろ。表面 → 裏面）
    if (after && (!before || after.score >= before.score)) {
      hi += 1;
      used += after.pages.length;
    } else {
      lo -= 1;
      used += before!.pages.length;
    }
  }
  return groups.slice(lo, hi + 1).map((g) => g.name);
}

/** 既定で送らない頁の id */
export function defaultExcluded(pages: ReadonlyArray<PickPage>, max = PDF_PAGES_MAX): Set<string> {
  const sheets = formSheets(pages, max);
  if (sheets) {
    // 選んだシートの頁をブックの順に、頭から 3 頁まで
    const keep = new Set(
      pages
        .filter((p) => sheets.includes(p.sheet ?? ""))
        .slice(0, max)
        .map((p) => p.id),
    );
    return new Set(pages.filter((p) => !keep.has(p.id)).map((p) => p.id));
  }
  if (pages.length <= max) return new Set();
  const plain = pages.filter((p) => !p.example);
  const keep = new Set((plain.length > 0 ? plain : pages).slice(0, max).map((p) => p.id));
  return new Set(pages.filter((p) => !keep.has(p.id)).map((p) => p.id));
}
