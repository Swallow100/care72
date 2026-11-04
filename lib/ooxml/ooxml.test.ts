// T119: Excel・Word を印刷の頁の形にする所のテスト。架空の小さな xlsx・docx をここで作る（原本の様式は使わない）。

import { describe, expect, it } from "vitest";
import { buildFormReadForm, formReadPagesOf } from "../forms/read-upload.ts";
import { parseReadMeta, readTimelineHead } from "../intake/read-form.ts";
import { REDACT_LABELS } from "../labels.ts";
import { drawPage, pageSize, type Draw2d } from "./draw.ts";
import { estimateWidth, mdwOf } from "./fonts.ts";
import { OfficeReadError, renderOffice, sniffOffice } from "./index.ts";
import type { OfficePage, PageItem } from "./page.ts";
import { defaultExcluded } from "./pick.ts";
import { isLegacyOffice, isZip } from "./sniff.ts";
import { cellRef, rangeRef, wrapLine } from "./xlsx.ts";
import { makeZip, type Entry } from "./test-zip.ts";
import { readZip, ZipReadError } from "./zip.ts";

// ---------------------------------------------------------------- 架空の zip を作る

const CT_XLSX = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const CT_DOCX = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const NS_S = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const NS_W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`;

type SheetSpec = { name: string; xml: string; state?: string; rels?: string; extra?: Entry[] };

function xlsx(sheets: SheetSpec[], opts: { styles?: string; shared?: string[]; defined?: string } = {}): Uint8Array {
  const wb = `<workbook ${NS_S}><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.state ? ` state="${s.state}"` : ""}/>`).join("")}</sheets>${opts.defined ? `<definedNames>${opts.defined}</definedNames>` : ""}</workbook>`;
  const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("")}<Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const styles =
    opts.styles ??
    `<styleSheet ${NS_S}><fonts><font><sz val="11"/><name val="游ゴシック"/></font></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/></patternFill></fill></fills>` +
      `<borders><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>` +
      `<cellXfs><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="1"><alignment horizontal="distributed" vertical="center"/></xf></cellXfs></styleSheet>`;
  const shared = `<sst ${NS_S}>${(opts.shared ?? []).map((s) => `<si>${s}</si>`).join("")}</sst>`;
  return makeZip([
    { name: "[Content_Types].xml", data: CT_XLSX },
    { name: "xl/workbook.xml", data: wb },
    { name: "xl/_rels/workbook.xml.rels", data: rels },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/sharedStrings.xml", data: shared },
    ...sheets.flatMap((s, i) => [
      { name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml },
      ...(s.rels ? [{ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: s.rels }] : []),
      ...(s.extra ?? []),
    ]),
  ]);
}

function sheetXml(body: { cols?: string; rows: string; merges?: string[]; setup?: string; after?: string; sheetPr?: string; fmt?: string }): string {
  return (
    `<worksheet ${NS_S}>${body.sheetPr ?? ""}<sheetFormatPr ${body.fmt ?? 'defaultRowHeight="18.75"'}/>${body.cols ? `<cols>${body.cols}</cols>` : ""}<sheetData>${body.rows}</sheetData>` +
    `${body.merges ? `<mergeCells count="${body.merges.length}">${body.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}` +
    `${body.setup ?? '<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait"/>'}${body.after ?? ""}</worksheet>`
  );
}

/** 3 列 × 3 行、全部に細い罫線。列幅 10 字、行 20pt（指定） */
const GRID_ROWS = [1, 2, 3].map((r) => `<row r="${r}" ht="20" customHeight="1">${["A", "B", "C"].map((c) => `<c r="${c}${r}" s="1"/>`).join("")}</row>`).join("");

const lines = (p: OfficePage) => p.items.filter((i): i is Extract<PageItem, { k: "line" }> => i.k === "line");
const vx = (p: OfficePage) => [...new Set(lines(p).filter((l) => Math.abs(l.x1 - l.x2) < 1e-6).map((l) => Math.round(l.x1 * 100) / 100))].sort((a, b) => a - b);
const hy = (p: OfficePage) => [...new Set(lines(p).filter((l) => Math.abs(l.y1 - l.y2) < 1e-6).map((l) => Math.round(l.y1 * 100) / 100))].sort((a, b) => a - b);
const texts = (p: OfficePage) => p.items.filter((i): i is Extract<PageItem, { k: "text" }> => i.k === "text").map((t) => t.text);

const PT = 25.4 / 72;

// ---------------------------------------------------------------- zip

describe("zip の展開（T119）", () => {
  it("無圧縮と deflate の部品を読み、無い部品は null", async () => {
    const zip = readZip(makeZip([{ name: "a.txt", data: "あいう", deflate: false }, { name: "b.xml", data: "<x>漢字</x>".repeat(50) }]));
    expect(zip.names()).toEqual(["a.txt", "b.xml"]);
    expect(await zip.text("a.txt")).toBe("あいう");
    expect(await zip.text("b.xml")).toBe("<x>漢字</x>".repeat(50));
    expect(await zip.bytes("none")).toBeNull();
  });

  it("暗号化の印のある部品・zip でない物を断る", async () => {
    const zip = readZip(makeZip([{ name: "a.txt", data: "x", flags: 1 }]));
    await expect(zip.bytes("a.txt")).rejects.toMatchObject({ code: "encrypted" });
    expect(() => readZip(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(ZipReadError);
  });

  it("展開すると上限を超える部品は止める（目録の大きさを偽っても）", async () => {
    const big = "0".repeat(30 * 1024 * 1024);
    const zipBytes = makeZip([{ name: "big.xml", data: big }]);
    // 目録の展開後の大きさを 10 に書き換える（偽りの小さな値）
    const view = new DataView(zipBytes.buffer);
    for (let i = zipBytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 10, true);
        break;
      }
    }
    await expect(readZip(zipBytes).bytes("big.xml")).rejects.toMatchObject({ code: "too_large" });
  });

  it("形の判定: zip・古い形（OLE）", () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(true);
    expect(isLegacyOffice(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(true);
    expect(isLegacyOffice(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0]))).toBe(false);
  });
});

describe("Excel・Word の見分け（T119）", () => {
  it("[Content_Types].xml の本体の形で決め、古い形は legacy、ほかの zip は null", async () => {
    expect(await sniffOffice(xlsx([{ name: "様式", xml: sheetXml({ rows: GRID_ROWS }) }]))).toEqual({ kind: "excel" });
    expect(await sniffOffice(makeZip([{ name: "[Content_Types].xml", data: CT_DOCX }]))).toEqual({ kind: "word" });
    expect(await sniffOffice(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toEqual({ kind: "legacy" });
    expect(await sniffOffice(makeZip([{ name: "x.txt", data: "x" }]))).toBeNull();
  });

  it("古い形・知らない zip は読まずに断る", async () => {
    await expect(renderOffice(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).rejects.toMatchObject({ code: "legacy" });
    await expect(renderOffice(makeZip([{ name: "x.txt", data: "x" }]))).rejects.toBeInstanceOf(OfficeReadError);
  });

  it("マクロの部品は開かない（vbaProject.bin が壊れていても読める）", async () => {
    const book = xlsx([{ name: "様式", xml: sheetXml({ rows: GRID_ROWS }) }]);
    const zip = readZip(book);
    const names = zip.names();
    const withMacro = makeZip([
      ...(await Promise.all(names.map(async (n) => ({ name: n, data: (await zip.bytes(n))! })))),
      { name: "xl/vbaProject.bin", data: new Uint8Array([1, 2, 3]), deflate: false, flags: 1 },
    ]);
    const r = await renderOffice(withMacro);
    expect(r.kind).toBe("excel");
    expect(r.pages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- Excel

describe("Excel の頁（T119）", () => {
  it("セルの番地と範囲", () => {
    expect(cellRef("AB12")).toEqual({ col: 28, row: 12 });
    expect(rangeRef("$A$1:$C$3")).toEqual({ c0: 1, c1: 3, r0: 1, r1: 3 });
  });

  it("列幅は 字数 × 既定の書体の数字の幅、行は指定の pt。余白と用紙のとおりに罫線を置く", async () => {
    const book = xlsx([{ name: "様式", xml: sheetXml({ cols: '<col min="1" max="3" width="10" customWidth="1"/>', rows: GRID_ROWS }) }]);
    const r = await renderOffice(book);
    const p = r.pages[0];
    expect(p.w).toBe(210);
    expect(p.h).toBe(297);
    const col = 10 * 0.5562 * 11 * PT;
    const x0 = 0.5 * 25.4;
    expect(vx(p)).toEqual([x0, x0 + col, x0 + 2 * col, x0 + 3 * col].map((v) => Math.round(v * 100) / 100));
    const row = 20 * PT;
    expect(hy(p)).toEqual([x0, x0 + row, x0 + 2 * row, x0 + 3 * row].map((v) => Math.round(v * 100) / 100));
  });

  it("結合したセルの中の罫線は描かない。字は結合の矩形に、均等割付は字ごとの位置", async () => {
    const rows = `<row r="1" ht="20" customHeight="1"><c r="A1" s="2" t="s"><v>0</v></c><c r="B1" s="2"/><c r="C1" s="1"/></row>` + GRID_ROWS.slice(GRID_ROWS.indexOf('<row r="2"'));
    const book = xlsx([{ name: "様式", xml: sheetXml({ cols: '<col min="1" max="3" width="10" customWidth="1"/>', rows, merges: ["A1:B1"] }) }], { shared: ["<t>氏名</t><rPh sb=\"0\" eb=\"2\"><t>シメイ</t></rPh>"] });
    const p = (await renderOffice(book)).pages[0];
    const col = 10 * 0.5562 * 11 * PT;
    const x0 = 0.5 * 25.4;
    const row1 = lines(p).filter((l) => Math.abs(l.x1 - l.x2) < 1e-6 && Math.abs(l.x1 - (x0 + col)) < 0.01);
    // A と B の間の縦線は 2 行目から下だけ
    expect(row1.every((l) => Math.min(l.y1, l.y2) >= x0 + 20 * PT - 0.01)).toBe(true);
    const t = p.items.find((i) => i.k === "text");
    expect(t && t.k === "text" && t.text).toBe("氏名");
    expect(t && t.k === "text" && t.chars?.length).toBe(2);
    // 塗り（灰）は結合の矩形
    const fill = p.items.find((i) => i.k === "rect" && i.fill === "#D9D9D9");
    expect(fill && fill.k === "rect" && Math.round(fill.w * 100)).toBe(Math.round(2 * col * 100));
  });

  it("隠したシートは描かず、記入例のシートに印。印刷範囲の外は描かない", async () => {
    const book = xlsx(
      [
        { name: "様式", xml: sheetXml({ cols: '<col min="1" max="3" width="10" customWidth="1"/>', rows: GRID_ROWS }) },
        { name: "隠し", state: "hidden", xml: sheetXml({ rows: GRID_ROWS }) },
        { name: "記入例", xml: sheetXml({ rows: GRID_ROWS }) },
      ],
      { defined: `<definedName name="_xlnm.Print_Area" localSheetId="0">様式!$A$1:$B$2</definedName>` },
    );
    const r = await renderOffice(book);
    expect(r.sheets.map((s) => [s.name, s.pages, s.example])).toEqual([
      ["様式", 1, false],
      ["隠し", 0, false],
      ["記入例", 1, true],
    ]);
    // 印刷範囲 A1:B2 の線だけ（縦 3 本・横 3 本）
    expect(vx(r.pages[0])).toHaveLength(3);
    expect(hy(r.pages[0])).toHaveLength(3);
  });

  it("手の改ページで頁を分け、頁に収まらない所は自動で分ける", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `<row r="${i + 1}" ht="20" customHeight="1"><c r="A${i + 1}" s="1"/></row>`).join("");
    const manual = xlsx([{ name: "様式", xml: sheetXml({ rows: many.split("</row>").slice(0, 10).join("</row>") + "</row>", after: '<rowBreaks count="1" manualBreakCount="1"><brk id="4" max="16383" man="1"/></rowBreaks>' }) }]);
    const m = await renderOffice(manual);
    expect(m.pages).toHaveLength(2);
    // 1 頁目は 1〜4 行（横線 5 本）
    expect(hy(m.pages[0])).toHaveLength(5);
    const auto = await renderOffice(xlsx([{ name: "様式", xml: sheetXml({ rows: many }) }]));
    // 60 行 × 20pt = 1200pt、頁の中は 297mm − 1in ≒ 770pt → 2 頁
    expect(auto.pages).toHaveLength(2);
  });

  it("次のページ数に合わせて印刷: 横 1 頁に縮める（保存した倍率は使わず計算する）", async () => {
    const wide = `<row r="1" ht="20" customHeight="1">${Array.from({ length: 30 }, (_, i) => `<c r="${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "" : ""}1" s="1"/>`).join("")}</row>`;
    const cols = '<col min="1" max="30" width="10" customWidth="1"/>';
    const fit = (scale: string) =>
      xlsx([
        {
          name: "様式",
          xml: sheetXml({ sheetPr: '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>', cols, rows: wide, setup: `<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0" footer="0"/><pageSetup paperSize="9" ${scale} fitToHeight="0" orientation="portrait"/>` }),
        },
      ]);
    const a = await renderOffice(fit(""));
    expect(a.pages).toHaveLength(1);
    const right = Math.max(...vx(a.pages[0]));
    expect(right).toBeLessThanOrEqual(210 - 12.7 + 0.01);
    const b = await renderOffice(fit('scale="20"'));
    expect(Math.max(...vx(b.pages[0]))).toBe(right);
  });

  it("フォームのチェックボックスは □ と字", async () => {
    const extra: Entry[] = [
      { name: "xl/ctrlProps/ctrlProp1.xml", data: '<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" objectType="CheckBox" checked="Checked"/>' },
      {
        name: "xl/drawings/vmlDrawing1.vml",
        data: '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="_x0000_s1025"><v:textbox><div><font face="ＭＳ Ｐゴシック" size="180">配偶者</font></div></v:textbox><x:ClientData ObjectType="Checkbox"><x:Anchor>1, 0, 1, 0, 3, 0, 2, 0</x:Anchor></x:ClientData></v:shape></xml>',
      },
    ];
    const controls = `<legacyDrawing r:id="rV"/><controls><control shapeId="1025" r:id="rC" name="Check Box 1"><controlPr><anchor><from><xdr:col xmlns:xdr="x">1</xdr:col><xdr:colOff xmlns:xdr="x">0</xdr:colOff><xdr:row xmlns:xdr="x">1</xdr:row><xdr:rowOff xmlns:xdr="x">0</xdr:rowOff></from><to><xdr:col xmlns:xdr="x">3</xdr:col><xdr:colOff xmlns:xdr="x">0</xdr:colOff><xdr:row xmlns:xdr="x">2</xdr:row><xdr:rowOff xmlns:xdr="x">0</xdr:rowOff></to></anchor></controlPr></control></controls>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rV" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/><Relationship Id="rC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/ctrlProp" Target="../ctrlProps/ctrlProp1.xml"/></Relationships>`;
    const book = xlsx([{ name: "様式", xml: sheetXml({ cols: '<col min="1" max="3" width="10" customWidth="1"/>', rows: GRID_ROWS, after: controls }), rels, extra }]);
    const p = (await renderOffice(book)).pages[0];
    const check = p.items.find((i) => i.k === "check");
    expect(check && check.k === "check" && check.checked).toBe(true);
    expect(texts(p)).toContain("配偶者");
  });
});

// ---------------------------------------------------------------- Word

function docx(body: string, opts: { settings?: string; styles?: string } = {}): Uint8Array {
  const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rY" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const settings = opts.settings ?? `<w:settings ${NS_W}><w:defaultTabStop w:val="840"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const styles = opts.styles ?? `<w:styles ${NS_W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="ＭＳ 明朝"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  return makeZip([
    { name: "[Content_Types].xml", data: CT_DOCX },
    { name: "_rels/.rels", data: rels },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/settings.xml", data: settings },
    { name: "word/styles.xml", data: styles },
    {
      name: "word/document.xml",
      data: `<w:document ${NS_W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:body></w:document>`,
    },
  ]);
}

const P_EXACT = (text: string) => `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const BORDERS = `<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>`;
const cell = (w: number, extra = "", text = "") => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${extra}</w:tcPr>${P_EXACT(text)}</w:tc>`;
const row = (cells: string, h = 600, rule = "exact") => `<w:tr><w:trPr><w:trHeight w:val="${h}" w:hRule="${rule}"/></w:trPr>${cells}</w:tr>`;
const table = (rows: string, grid = [2000, 3000, 4000]) => `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>${BORDERS}</w:tblPr><w:tblGrid>${grid.map((g) => `<w:gridCol w:w="${g}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`;

const TW = 25.4 / 1440;
const r2 = (v: number) => Math.round(v * 100) / 100;

describe("Word の頁（T119）", () => {
  it("表は格子の列幅と行の高さ（固定）のまま、本文の左の端から。前の段落は格子でなく固定の行間", async () => {
    const body = P_EXACT("見出し") + table(row(cell(2000, "", "氏名") + cell(3000) + cell(4000)) + row(cell(2000) + cell(3000) + cell(4000), 800));
    const r = await renderOffice(docx(body));
    expect(r.kind).toBe("word");
    const p = r.pages[0];
    const left = 1134 * TW;
    expect(vx(p)).toEqual([left, left + 2000 * TW, left + 5000 * TW, left + 9000 * TW].map(r2));
    const top = 1134 * TW + 18 * PT;
    expect(hy(p)).toEqual([top, top + 600 * TW, top + 1400 * TW].map(r2));
    expect(texts(p)).toEqual(expect.arrayContaining(["見出し", "氏名"]));
  });

  it("Word 2013 より前の互換の文書は、表の左の線をセルの左の余白（5.4pt）だけ外へ", async () => {
    const settings = `<w:settings ${NS_W}><w:compat/></w:settings>`;
    const p = (await renderOffice(docx(table(row(cell(2000) + cell(3000) + cell(4000))), { settings }))).pages[0];
    expect(vx(p)[0]).toBe(r2(1134 * TW - 108 * TW));
  });

  it("縦の結合の中は横線を描かない", async () => {
    const body = table(row(cell(2000, '<w:vMerge w:val="restart"/>') + cell(3000) + cell(4000)) + row(cell(2000, "<w:vMerge/>") + cell(3000) + cell(4000)));
    const p = (await renderOffice(docx(body))).pages[0];
    const left = 1134 * TW;
    const mid = 1134 * TW + 600 * TW;
    const inner = lines(p).filter((l) => Math.abs(l.y1 - l.y2) < 1e-6 && Math.abs(l.y1 - mid) < 0.01);
    // 真ん中の横線は 2 列目から右だけ
    expect(inner.every((l) => Math.min(l.x1, l.x2) >= left + 2000 * TW - 0.01)).toBe(true);
  });

  it("改ページで頁を分け、入らない行は次の頁へ", async () => {
    const brk = `<w:p><w:r><w:t>一</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>${P_EXACT("二")}`;
    expect((await renderOffice(docx(brk))).pages).toHaveLength(2);
    const tall = table(Array.from({ length: 12 }, () => row(cell(2000) + cell(3000) + cell(4000), 1400)).join(""));
    const pages = (await renderOffice(docx(tall))).pages;
    expect(pages).toHaveLength(2);
    // 1 頁目の表の下は本文の下（余白の上）を越えない
    expect(Math.max(...hy(pages[0]))).toBeLessThanOrEqual(297 - 1134 * TW + 0.01);
  });

  it("頁から位置を決めたテキストボックスは、その位置の枠と字", async () => {
    const box = `<w:p><w:r><w:drawing><wp:anchor behindDoc="0"><wp:positionH relativeFrom="page"><wp:posOffset>720000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>1440000</wp:posOffset></wp:positionV><wp:extent cx="1800000" cy="360000"/><a:graphic><a:graphicData><wps:wsp><wps:spPr><a:prstGeom prst="rect"/><a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr><wps:txbx><w:txbxContent>${P_EXACT("受付")}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
    const p = (await renderOffice(docx(box))).pages[0];
    const rect = p.items.find((i) => i.k === "rect" && i.stroke);
    expect(rect && rect.k === "rect" && [r2(rect.x), r2(rect.y), r2(rect.w), r2(rect.h)]).toEqual([20, 40, 50, 10]);
    expect(texts(p)).toContain("受付");
  });

  it("段落の途中の改ページは、その後の字から次の頁", async () => {
    const body = `<w:p><w:r><w:t>前</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>後</w:t></w:r></w:p>`;
    const pages = (await renderOffice(docx(body))).pages;
    expect(pages.map(texts)).toEqual([["前"], ["後"]]);
  });

  it("Word が保存した頁の切れ目（lastRenderedPageBreak）で頁を分け、少しの食み出しは同じ頁に残す", async () => {
    // 1 頁に入らない高さの表（13 行 × 20mm）。切れ目は 12 行目の頭（Word ではそこまで 1 頁）
    const r = (i: number) =>
      row(
        `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r>${i === 12 ? "<w:lastRenderedPageBreak/>" : ""}<w:t>${i}</w:t></w:r></w:p></w:tc>` + cell(3000) + cell(4000),
        1134,
      );
    const pages = (await renderOffice(docx(table(Array.from({ length: 13 }, (_, i) => r(i + 1)).join(""))))).pages;
    expect(pages).toHaveLength(2);
    // 1〜11 行目が 1 頁目（11 × 20mm ＝ 220mm は本文の高さ 257mm に入る）、12 行目から 2 頁目
    expect(texts(pages[0])).toContain("11");
    expect(texts(pages[1])[0]).toBe("12");
  });

  it("行の終わりの全角の空白では折り返さない（様式の「氏名　　　」で行が増えない）", async () => {
    const spaces = "　".repeat(40);
    const body = table(row(cell(2000, "", `氏名${spaces}`) + cell(3000) + cell(4000), 400, "atLeast"));
    const p = (await renderOffice(docx(body))).pages[0];
    const ys = hy(p);
    // 1 行（18pt の格子の行は固定の行間なので 18pt＋余白 0）
    expect(ys[1] - ys[0]).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------- 描く・字の幅

describe("描く所（T119）", () => {
  it("頁の大きさの画素と、線を倍率で描く", () => {
    const page: OfficePage = { w: 210, h: 297, sheet: null, page: 1, items: [{ k: "line", x1: 10, y1: 20, x2: 110, y2: 20, stroke: { color: "#000000", width: 0.2 } }] };
    const { w, h, k } = pageSize(page, 2000);
    expect(h).toBe(2000);
    expect(w).toBe(Math.round(210 * k));
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, name) => (name in t ? t[name as string] : (...a: unknown[]) => calls.push(`${String(name)}(${a.map((x) => (typeof x === "number" ? Math.round(x) : x)).join(",")})`)),
      set: (t, name, v) => {
        t[name as string] = v;
        return true;
      },
    });
    drawPage(ctx as unknown as Draw2d, page, k);
    expect(calls).toContain(`moveTo(${Math.round(10 * k)},${Math.round(20 * k)})`);
    expect(calls).toContain(`lineTo(${Math.round(110 * k)},${Math.round(20 * k)})`);
  });

  it("絵文字で描かれる四角は紙の記号で描く（⬜ → □）", () => {
    const page: OfficePage = { w: 100, h: 100, sheet: null, page: 1, items: [{ k: "text", text: "⬜障がい者手帳☑️", x: 1, y: 5, font: { family: "serif", size: 3 }, color: "#000000" }] };
    const drawn: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, name) => (name in t ? t[name as string] : name === "fillText" ? (s: string) => drawn.push(s) : () => ({ width: 0 })),
      set: (t, name, v) => {
        t[name as string] = v;
        return true;
      },
    });
    drawPage(ctx as unknown as Draw2d, page, 10);
    expect(drawn).toEqual(["□障がい者手帳☑"]);
  });

  it("字の幅の見積もり・折り返し・数字の幅", () => {
    const f = { family: "serif", size: 4 };
    expect(estimateWidth("あいう", f)).toBe(12);
    expect(wrapLine("あいうえおかきくけこ", 13, (t) => estimateWidth(t, f))).toEqual(["あいう", "えおか", "きくけ", "こ"]);
    expect(wrapLine("あいう、えお", 12, (t) => estimateWidth(t, f))[1].startsWith("、")).toBe(false);
    expect(mdwOf("Calibri", 11)).toBe(7);
  });
});

// ---------------------------------------------------------------- 送る形・画面

describe("送る形と頁の選び方（T119）", () => {
  it("Excel・Word の頁は PDF と同じく 3 頁まで、経過の頭は元の形の名前", () => {
    expect(parseReadMeta({ source: "excel", page: "3", redacted: "0", bare: "1" })).toEqual({ source: "excel", page: 3, redacted: 0 });
    expect(parseReadMeta({ source: "word", page: "4", redacted: "1", bare: null })).toBeNull();
    expect(parseReadMeta({ source: "photo", page: "2", redacted: "1", bare: null })).toBeNull();
    expect(readTimelineHead({ source: "excel", page: 2, redacted: 1 })).toBe("Excel を読んだ（2 頁目・隠した所 1 か所）");
    expect(readTimelineHead({ source: "word", page: 1, redacted: 0 })).toBe("Word を読んだ（1 頁目・隠した所 0 か所）");
  });

  it("様式の読取の受け口は Excel の頁の並びを受ける", () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    const form = buildFormReadForm([1, 2].map((page) => ({ blob, meta: { source: "excel" as const, page, redacted: 0 }, bare: true })));
    const got = formReadPagesOf(form);
    expect(got.ok && got.pages.map((p) => p.meta.source)).toEqual(["excel", "excel"]);
  });

  it("4 頁以上の既定: 記入例のシートを外して頭の 3 頁", () => {
    const pages = [
      { id: "a", example: true },
      { id: "b", example: true },
      { id: "c", example: false },
      { id: "d", example: false },
      { id: "e", example: false },
      { id: "f", example: false },
    ];
    expect([...defaultExcluded(pages)].sort()).toEqual(["a", "b", "f"]);
    expect([...defaultExcluded(pages.slice(0, 3))]).toEqual([]);
    expect([...defaultExcluded(pages.map((p) => ({ ...p, example: true })))].sort()).toEqual(["d", "e", "f"]);
  });

  it("画面の言葉は短い（PDF 保存で正確・旧形式）", () => {
    expect(REDACT_LABELS.officeHint).toContain("PDF 保存");
    expect(REDACT_LABELS.legacy).toContain("旧形式");
  });
});
