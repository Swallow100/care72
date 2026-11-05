// T122: 複数のシートのブックで、様式の本体らしいシートを既定で送る（評価の 2 回目で、BCP のひな形のブックの様式 9 のシートが最後にあり、
// 頭の 3 頁〔表紙・目次〕を読んで欄が 0/12 だった。docs/progress/eval-r2-forms-findings.md の 1）。架空の小さな xlsx をここで作る。

import { describe, expect, it } from "vitest";
import { OFFICE_PAGES_MAX, renderOffice } from "./index.ts";
import { defaultExcluded, explanationSheet, formSheets, formWordCount, pickPageOf, sheetWordCounts, type PickPage } from "./pick.ts";
import { makeZip } from "./test-zip.ts";

const CT = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

/** シートの名前と、A 列に並べる字（1 行 1 つ）。印刷範囲を決めたシートは print */
type Spec = { name: string; words: string[]; print?: boolean };

function book(specs: Spec[]): Uint8Array {
  const sheet = (words: string[]) =>
    `<worksheet ${NS}><sheetFormatPr defaultRowHeight="18.75"/><sheetData>${words
      .map((w, r) => `<row r="${r + 1}" ht="20" customHeight="1"><c r="A${r + 1}" s="1" t="inlineStr"><is><t>${w}</t></is></c><c r="B${r + 1}" s="1"/></row>`)
      .join("")}</sheetData><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0" footer="0"/><pageSetup paperSize="9"/></worksheet>`;
  const styles = `<styleSheet ${NS}><fonts><font><sz val="11"/><name val="游ゴシック"/></font></fonts><fills><fill><patternFill patternType="none"/></fill></fills><borders><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellXfs><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="1"/></cellXfs></styleSheet>`;
  const defined = specs
    .map((s, i) => (s.print ? `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${s.name}'!$A$1:$B$${Math.max(1, s.words.length)}</definedName>` : ""))
    .join("");
  return makeZip([
    { name: "[Content_Types].xml", data: CT },
    {
      name: "xl/workbook.xml",
      data: `<workbook ${NS}><sheets>${specs.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ""}</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: styles },
    ...specs.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheet(s.words) })),
  ]);
}

/** 頁の形から、既定で送るシートの名前（ブックの順） */
async function sentSheets(bytes: Uint8Array): Promise<string[]> {
  const r = await renderOffice(bytes);
  const words = sheetWordCounts(r.pages);
  const pages = r.pages.map((p, i) => pickPageOf(p, String(i), words));
  const skip = defaultExcluded(pages);
  return pages.filter((p) => !skip.has(p.id)).map((p) => p.sheet ?? "");
}

/** 利用者の一覧の様式の欄（架空の様式。ケア72 の様式 9 の列の名前から） */
const FORM9_WORDS = ["優先順位", "地域／区分", "氏名（年齢）", "住所（自治会）", "避難場所", "想定される避難所", "介護・医療機関", "担当ケアマネ", "安否確認できた日"];

describe("複数のシートのブックの既定のシート（T122）", () => {
  it("BCP のひな形の形: 表紙・目次・本文・補足が前に、様式の本体が最後。頁の上限に入り、既定は様式の本体のシートだけ", async () => {
    const specs: Spec[] = [
      { name: "表紙", words: ["事業継続計画", "法人名", "作成日"] },
      { name: "目次", words: ["目次", "避難", "安否確認", "緊急時の対応"] },
      ...Array.from({ length: 13 }, (_, i): Spec => ({ name: `補足${i + 1}`, words: ["補足の説明", "優先する業務"] })),
      { name: "様式1", words: ["推進体制", "担当"] },
      { name: "様式2", words: ["連絡リスト", "住所", "電話"] },
      { name: "様式9", words: FORM9_WORDS, print: true },
    ];
    const bytes = book(specs);
    const r = await renderOffice(bytes);
    // 前の上限（12 頁）では最後のシートが頁の形にならなかった
    expect(r.pages.length).toBe(specs.length);
    expect(r.pages.length).toBeGreaterThan(12);
    expect(r.pages.length).toBeLessThanOrEqual(OFFICE_PAGES_MAX);
    expect(await sentSheets(bytes)).toEqual(["様式9"]);
  });

  it("1 つの様式が続くシートに分かれている物（表面・裏面、その１・その２）は続けて送る。記入例は送らない", async () => {
    const front = ["氏名", "フリガナ", "生年月日", "住所", "電話", "性別", "避難先", "緊急連絡先", "要介護度", "同意", "作成日"];
    const back = ["避難のタイミング", "支援者", "連絡先", "家族の電話"];
    expect(await sentSheets(book([{ name: "表面", words: front }, { name: "裏面", words: back }]))).toEqual(["表面", "裏面"]);
    // いちばん言葉の多いシートが 2 つ目でも、前のシートを足してブックの順に
    expect(await sentSheets(book([{ name: "その１", words: front.slice(0, 8) }, { name: "その２", words: front }]))).toEqual(["その１", "その２"]);
    expect(await sentSheets(book([{ name: "個別避難計画", words: front }, { name: "記入例", words: [...front, "支援"] }]))).toEqual(["個別避難計画"]);
    // 続かない少ない言葉のシート（持ち物の一覧）は足さない
    expect(await sentSheets(book([{ name: "避難シート", words: front }, { name: "生活支援シート", words: front }, { name: "必要な物", words: ["避難", "持ち物"] }]))).toEqual([
      "避難シート",
      "生活支援シート",
    ]);
  });

  it("本体らしいシートが無いブック（言葉が少ない）は T119 のまま（記入例を外した頭から上限の頁。T146 で上限は 10）", () => {
    const pages: PickPage[] = ["記入例", "様式1", "様式2", "様式3", "様式4"].map((sheet, i) => ({ id: String(i), example: sheet === "記入例", sheet, words: 1 }));
    expect([...defaultExcluded(pages)].sort()).toEqual(["0"]);
    expect([...defaultExcluded(pages, 3)].sort()).toEqual(["0", "4"]);
    expect(formSheets(pages)).toBeNull();
  });

  it("シートが 1 つ・Word は今まで通り（上限までは全部、上限を超えた頁は外す）", () => {
    const one: PickPage[] = [1, 2, 3, 4].map((n) => ({ id: String(n), example: false, sheet: "様式", words: 12 }));
    expect([...defaultExcluded(one)]).toEqual([]);
    expect([...defaultExcluded(one, 3)]).toEqual(["4"]);
    const long: PickPage[] = Array.from({ length: 14 }, (_, i) => ({ id: String(i + 1), example: false, sheet: "様式", words: 12 }));
    expect([...defaultExcluded(long)].sort((a, b) => Number(a) - Number(b))).toEqual(["11", "12", "13", "14"]);
    const word: PickPage[] = [1, 2].map((n) => ({ id: String(n), example: false, sheet: null }));
    expect([...defaultExcluded(word)]).toEqual([]);
  });

  it("説明のシートの名前と、様式の言葉の数", () => {
    for (const n of ["表紙", "目次", "本文(自然災害BCP)", "補足5", "記入方法", "注意事項", "使い方"]) expect(explanationSheet(n), n).toBe(true);
    for (const n of ["様式9", "個別避難計画", "表面（個別避難計画）", "その１", "避難シート"]) expect(explanationSheet(n), n).toBe(false);
    expect(formWordCount(FORM9_WORDS.join(" "))).toBeGreaterThanOrEqual(8);
    expect(formWordCount("事業継続計画 法人名")).toBe(0);
  });
});
