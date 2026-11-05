// Excel・Word の様式を頁の形にする入口（T119）。形の判定と、xlsx・docx の振り分け。ブラウザと Node の両方で動く。
//
// 形は中身で決める（拡張子・ブラウザの言う形は信じない）:
// - zip で、[Content_Types].xml の本体の形がブック → excel、文書 → word（マクロ付き・ひな形も同じ。マクロの部品は開かない）
// - 古い形（.xls・.doc。OLE の複合文書 D0 CF 11 E0）→ legacy。読まずに断り、PDF に保存して取り込むよう勧める
// - ほかの zip・形の分からない物 → null

import { renderDocx } from "./docx.ts";
import type { Measure, OfficePage } from "./page.ts";
import { renderXlsx, type XlsxSheetInfo } from "./xlsx.ts";
import { isLegacyOffice } from "./sniff.ts";
import { isZip, readZip, ZipReadError, type ZipArchive } from "./zip.ts";
import { kids, parseXml } from "./xml.ts";

export type OfficeKind = "excel" | "word";

export { isLegacyOffice };

/** zip の中身の形（[Content_Types].xml の本体の部品の形） */
export async function officeKindOfZip(zip: ZipArchive): Promise<OfficeKind | null> {
  const ct = await zip.text("[Content_Types].xml");
  if (!ct) return null;
  let root;
  try {
    root = parseXml(ct);
  } catch {
    return null;
  }
  const types = kids(root, "Override").map((o) => o.a.ContentType ?? "");
  if (types.some((t) => /spreadsheetml\.(sheet|template)\.main\+xml$|ms-excel\.(sheet\.macroEnabled|template\.macroEnabled)\.main\+xml$/i.test(t))) return "excel";
  if (types.some((t) => /wordprocessingml\.(document|template)\.main\+xml$|ms-word\.(document|template)\.macroEnabledTemplate\.main\+xml$|ms-word\.document\.macroEnabled\.main\+xml$/i.test(t))) return "word";
  return null;
}

export type OfficeSniff = { kind: OfficeKind } | { kind: "legacy" } | null;

/** 中身で形を決める（zip を開いて目録と [Content_Types].xml だけ読む） */
export async function sniffOffice(bytes: Uint8Array): Promise<OfficeSniff> {
  if (isLegacyOffice(bytes.subarray(0, 8))) return { kind: "legacy" };
  if (!isZip(bytes)) return null;
  try {
    const kind = await officeKindOfZip(readZip(bytes));
    return kind ? { kind } : null;
  } catch {
    return null;
  }
}

/**
 * 様式で頁の形にする上限（シート・頁を選ぶ前。送るのは 10 頁まで、T146）。T122: 12 から 80 に。頁の形（線と字の並び）を作るのは軽く
 * （評価の置き場の 45 頁のブックで 0.3 秒）、画像に描くのは選んだ頁と見ている頁だけ（lib/ooxml/browser.ts）。
 * 12 のときは、様式 9 のシートが 45 頁のブックの最後にあり、頁の形にもならなかった（評価の 2 回目の 1）
 */
export const OFFICE_PAGES_MAX = 80;

export type OfficeRender = {
  kind: OfficeKind;
  pages: OfficePage[];
  /** Excel のシートの一覧（Word は空） */
  sheets: XlsxSheetInfo[];
  warnings: string[];
};

export type OfficeError = "legacy" | "unknown" | "broken" | "encrypted" | "too_large" | "empty";

export class OfficeReadError extends Error {
  readonly code: OfficeError;
  constructor(code: OfficeError) {
    super(`office: ${code}`);
    this.name = "OfficeReadError";
    this.code = code;
  }
}

/** Excel・Word を頁の形に。読めなければ OfficeReadError */
export async function renderOffice(bytes: Uint8Array, opts: { measure?: Measure; maxPages?: number } = {}): Promise<OfficeRender> {
  if (isLegacyOffice(bytes.subarray(0, 8))) throw new OfficeReadError("legacy");
  if (!isZip(bytes)) throw new OfficeReadError("unknown");
  const maxPages = opts.maxPages ?? OFFICE_PAGES_MAX;
  try {
    const zip = readZip(bytes);
    const kind = await officeKindOfZip(zip);
    if (!kind) throw new OfficeReadError("unknown");
    if (kind === "excel") {
      const r = await renderXlsx(zip, { measure: opts.measure, maxPages });
      if (r.pages.length === 0) throw new OfficeReadError("empty");
      return { kind, pages: r.pages, sheets: r.sheets, warnings: r.warnings };
    }
    const r = await renderDocx(zip, { measure: opts.measure, maxPages });
    if (r.pages.length === 0) throw new OfficeReadError("empty");
    return { kind, pages: r.pages, sheets: [], warnings: r.warnings };
  } catch (e) {
    if (e instanceof OfficeReadError) throw e;
    if (e instanceof ZipReadError) throw new OfficeReadError(e.code === "encrypted" ? "encrypted" : e.code === "too_large" ? "too_large" : "broken");
    throw new OfficeReadError("broken");
  }
}
