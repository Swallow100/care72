// T119: 評価の台のブラウザの段が Excel・Word を通す（架空の小さな xlsx をここで作る。@napi-rs/canvas の無い端末では飛ばす）。

import { describe, expect, it } from "vitest";
import { makeZip } from "../../../lib/ooxml/test-zip.ts";
import { browserStage, kindOf, loadCanvas } from "./browser.ts";

const CT = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

/** シートを n 枚（名前）持つ架空のブック。どのシートも 2 行の罫線と字 */
function book(names: string[]): Uint8Array {
  const sheet = `<worksheet ${NS}><sheetFormatPr defaultRowHeight="18.75"/><sheetData><row r="1" ht="20" customHeight="1"><c r="A1" s="1" t="inlineStr"><is><t>氏名</t></is></c><c r="B1" s="1"/></row><row r="2" ht="20" customHeight="1"><c r="A2" s="1"/><c r="B2" s="1"/></row></sheetData><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0" footer="0"/><pageSetup paperSize="9"/></worksheet>`;
  const styles = `<styleSheet ${NS}><fonts><font><sz val="11"/><name val="游ゴシック"/></font></fonts><fills><fill><patternFill patternType="none"/></fill></fills><borders><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellXfs><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="1"/></cellXfs></styleSheet>`;
  return makeZip([
    { name: "[Content_Types].xml", data: CT },
    { name: "xl/workbook.xml", data: `<workbook ${NS}><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: styles },
    ...names.map((_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheet })),
  ]);
}

const hasCanvas = !!(await loadCanvas());

describe("評価の台のブラウザの段の Excel・Word（T119）", () => {
  it("形の判定: zip は office、OLE は legacy", () => {
    expect(kindOf(book(["様式"]))).toBe("office");
    expect(kindOf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("legacy");
  });

  it("古い形（.xls・.doc）は描かずに legacy", async () => {
    const r = await browserStage(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), []);
    expect(r).toMatchObject({ ok: false, error: "legacy" });
  });

  it.skipIf(!hasCanvas)("Excel は頁の画像にして送る。記入例を外した頭から上限（T146 で 10）の頁、番号は 1 から", async () => {
    const r = await browserStage(book(["記入例", "様式1", "様式2", "様式3", "様式4"]), []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("excel");
    expect(r.totalPages).toBe(5);
    expect(r.pages.map((p) => p.meta)).toEqual([1, 2, 3, 4].map((page) => ({ source: "excel", page, redacted: 0 })));
    expect(r.pages.every((p) => p.bare && p.bytes[0] === 0xff && p.bytes[1] === 0xd8)).toBe(true);
  });
});
