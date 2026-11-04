// Excel（.xlsx・.xlsm）のシートを、印刷したときの頁の形（page.ts）にする（T119）。ブラウザと Node の両方で動く。
//
// 元の印刷の見た目に近づける所（枠の位置と大きさ）:
// - 印刷範囲（_xlnm.Print_Area。無ければ値・罫線・塗り・図形のある範囲）、隠した行・列は幅 0
// - 列幅は既定の書体の数字の幅（fonts.ts の mdwOf）で画素にして pt に（ECMA-376 18.3.1.13 の式）、行の高さは pt のまま
// - 用紙（paperSize）・向き・余白（inch）・拡大縮小（scale）か「次のページ数に合わせて印刷」（fitToPage・fitToWidth・fitToHeight。0 は無制限）・
//   水平・垂直の中央・改ページ（手で入れた rowBreaks・colBreaks と、頁に収まらない所の自動）・頁の順（下へ → 右へ）
// - 結合したセル（外周の罫線だけ、字は結合の矩形に）、罫線の種類と太さ、塗り、字の揃え（均等割付・縦書き・折り返し・縮小）
// - 図形（四角・丸・線・括弧・吹き出しは近い形、図形の中の字）、画像（PNG・JPEG）、フォームのチェックボックス・オプションボタン
// - ヘッダー・フッターの字（&P・&N・&A）
// 近づけきれない所（EMF・WMF の画像、条件付き書式、グラフ、図形の細かい形、字の書体の違い）は docs/progress/t119.md の限界に。
// マクロ（vbaProject.bin）・外部の参照は開かない。

import { DEFAULT_THEME, drawingColor, excelColor, parseTheme, type Theme } from "./color.ts";
import { autoRowFactorOf, cssFamily, digitEmOf, estimateWidth, isMonospaceJa, mdwOf } from "./fonts.ts";
import { EMU_MM, INCH_MM, PT_MM, type Box, type FontSpec, type Measure, type OfficePage, type PageItem, type Stroke } from "./page.ts";
import type { ZipArchive } from "./zip.ts";
import { alternate, attr, bool, descendants, kid, kids, num, parseXml, path, textOf, type XNode } from "./xml.ts";

// ---------------------------------------------------------------- 部品を読む

/** rels（部品どうしのつながり）を読む。Target は部品の名前（xl/worksheets/sheet1.xml）に直す */
export async function readRels(zip: ZipArchive, partName: string): Promise<Map<string, { type: string; target: string; external: boolean }>> {
  const dir = partName.includes("/") ? partName.slice(0, partName.lastIndexOf("/")) : "";
  const relsName = `${dir ? `${dir}/` : ""}_rels/${partName.slice(partName.lastIndexOf("/") + 1)}.rels`;
  const out = new Map<string, { type: string; target: string; external: boolean }>();
  const text = await zip.text(relsName);
  if (!text) return out;
  const root = parseXml(text);
  for (const r of kids(root, "Relationship")) {
    const id = r.a.Id;
    const target = r.a.Target ?? "";
    const external = r.a.TargetMode === "External";
    if (!id) continue;
    out.set(id, { type: (r.a.Type ?? "").replace(/^.*\//, ""), target: external ? target : resolvePart(dir, target), external });
  }
  return out;
}

/** 部品の相対の道を、zip の中の名前に */
export function resolvePart(dir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${dir ? `${dir}/` : ""}${target}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

const XML_PART_MAX = 16 * 1024 * 1024;

async function xmlPart(zip: ZipArchive, name: string): Promise<XNode | null> {
  const t = await zip.text(name);
  if (t === null || t.length > XML_PART_MAX) return null;
  return parseXml(t);
}

/** 「A1」→ 列（1 から）・行（1 から） */
export function cellRef(ref: string): { col: number; row: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export type Range = { c0: number; r0: number; c1: number; r1: number };

/** 「A1:C5」「$A$1:$C$5」「A:C」「1:3」を範囲に（列・行は 1 から） */
export function rangeRef(ref: string): Range | null {
  const [a, b = a] = ref.split(":");
  const colOnly = /^\$?([A-Z]{1,3})$/;
  const rowOnly = /^\$?(\d{1,7})$/;
  if (colOnly.test(a) && colOnly.test(b)) {
    const ca = cellRef(`${a.replace("$", "")}1`);
    const cb = cellRef(`${b.replace("$", "")}1`);
    return ca && cb ? { c0: Math.min(ca.col, cb.col), c1: Math.max(ca.col, cb.col), r0: 1, r1: 1048576 } : null;
  }
  if (rowOnly.test(a) && rowOnly.test(b)) {
    const ra = Number(a.replace("$", ""));
    const rb = Number(b.replace("$", ""));
    return { c0: 1, c1: 16384, r0: Math.min(ra, rb), r1: Math.max(ra, rb) };
  }
  const p = cellRef(a);
  const q = cellRef(b);
  if (!p || !q) return null;
  return { c0: Math.min(p.col, q.col), c1: Math.max(p.col, q.col), r0: Math.min(p.row, q.row), r1: Math.max(p.row, q.row) };
}

// ---------------------------------------------------------------- 書式

type BorderSide = { style: string; color: string } | null;
type Border = { left: BorderSide; right: BorderSide; top: BorderSide; bottom: BorderSide; diagUp: BorderSide; diagDown: BorderSide };
type Font = { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string };
type Align = {
  h: string;
  v: string;
  wrap: boolean;
  shrink: boolean;
  rotation: number;
  indent: number;
};
type Xf = { font: Font; fill: string | null; border: Border; align: Align; numFmt: string };

type Styles = { xfs: Xf[]; defaultFont: Font };

const BUILTIN_NUMFMT: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 14: "yyyy/m/d", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy",
  18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "yyyy/m/d h:mm", 49: "@",
  27: "[$-411]ge.m.d", 28: "[$-411]ggge\"年\"m\"月\"d\"日\"", 29: "[$-411]ggge\"年\"m\"月\"d\"日\"", 30: "m/d/yy", 31: "yyyy\"年\"m\"月\"d\"日\"",
  32: "h\"時\"mm\"分\"", 33: "h\"時\"mm\"分\"ss\"秒\"", 34: "yyyy\"年\"m\"月\"", 35: "m\"月\"d\"日\"", 36: "[$-411]ge.m.d",
  55: "yyyy\"年\"m\"月\"", 56: "m\"月\"d\"日\"", 57: "[$-411]ge.m.d", 58: "[$-411]ggge\"年\"m\"月\"d\"日\"",
};

function readFont(x: XNode | null, theme: Theme, fallback?: Font): Font {
  const name = kid(x, "name")?.a.val ?? kid(x, "rFont")?.a.val ?? fallback?.name ?? "ＭＳ Ｐゴシック";
  const scheme = kid(x, "scheme")?.a.val;
  const themed = scheme === "minor" && theme.minorEa && /[^\x00-\x7f]/.test(name) ? theme.minorEa : name;
  const b = kid(x, "b");
  const i = kid(x, "i");
  const u = kid(x, "u");
  return {
    name: themed,
    size: num(kid(x, "sz"), "val") ?? fallback?.size ?? 11,
    bold: b ? bool(b, "val", true) : (fallback?.bold ?? false),
    italic: i ? bool(i, "val", true) : (fallback?.italic ?? false),
    underline: u ? u.a.val !== "none" : (fallback?.underline ?? false),
    color: excelColor(kid(x, "color"), theme, null) ?? fallback?.color ?? "#000000",
  };
}

function readSide(x: XNode | null, theme: Theme): BorderSide {
  const style = x?.a.style;
  if (!x || !style || style === "none") return null;
  return { style, color: excelColor(kid(x, "color"), theme, "#000000") ?? "#000000" };
}

function readFill(x: XNode | null, theme: Theme): string | null {
  const p = kid(x, "patternFill");
  if (p) {
    const type = p.a.patternType ?? (kid(p, "fgColor") ? "solid" : "none");
    if (type === "none") return null;
    const fg = excelColor(kid(p, "fgColor"), theme, null);
    const bg = excelColor(kid(p, "bgColor"), theme, null);
    if (type === "solid") return fg ?? bg;
    // 模様の塗りは、地と模様の色を混ぜた 1 色に（gray125 などは薄い灰）
    const share: Record<string, number> = { gray125: 0.125, gray0625: 0.0625, lightGray: 0.25, mediumGray: 0.5, darkGray: 0.75 };
    const f = share[type] ?? 0.3;
    return mix(fg ?? "#000000", bg ?? "#FFFFFF", f);
  }
  const g = kid(x, "gradientFill");
  if (g) return excelColor(kid(kids(g, "stop")[0], "color"), theme, null);
  return null;
}

function mix(a: string, b: string, f: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) * f + p(b, i) * (1 - f)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function readStyles(root: XNode | null, theme: Theme): Styles {
  const fonts = kids(kid(root, "fonts"), "font").map((f) => readFont(f, theme));
  const defaultFont = fonts[0] ?? { name: "ＭＳ Ｐゴシック", size: 11, bold: false, italic: false, underline: false, color: "#000000" };
  const fills = kids(kid(root, "fills"), "fill").map((f) => readFill(f, theme));
  const borders = kids(kid(root, "borders"), "border").map(
    (b): Border => ({
      left: readSide(kid(b, "left") ?? kid(b, "start"), theme),
      right: readSide(kid(b, "right") ?? kid(b, "end"), theme),
      top: readSide(kid(b, "top"), theme),
      bottom: readSide(kid(b, "bottom"), theme),
      diagUp: bool(b, "diagonalUp", false) ? readSide(kid(b, "diagonal"), theme) : null,
      diagDown: bool(b, "diagonalDown", false) ? readSide(kid(b, "diagonal"), theme) : null,
    }),
  );
  const numFmts = new Map<number, string>();
  for (const n of kids(kid(root, "numFmts"), "numFmt")) numFmts.set(Number(n.a.numFmtId), n.a.formatCode ?? "General");
  const noBorder: Border = { left: null, right: null, top: null, bottom: null, diagUp: null, diagDown: null };
  const xfs = kids(kid(root, "cellXfs"), "xf").map((x): Xf => {
    const al = kid(x, "alignment");
    const id = num(x, "numFmtId", 0);
    return {
      font: fonts[num(x, "fontId", 0)] ?? defaultFont,
      fill: fills[num(x, "fillId", 0)] ?? null,
      border: borders[num(x, "borderId", 0)] ?? noBorder,
      align: {
        h: al?.a.horizontal ?? "general",
        v: al?.a.vertical ?? "bottom",
        wrap: bool(al, "wrapText", false),
        shrink: bool(al, "shrinkToFit", false),
        rotation: num(al, "textRotation", 0),
        indent: num(al, "indent", 0),
      },
      numFmt: numFmts.get(id) ?? BUILTIN_NUMFMT[id] ?? "General",
    };
  });
  if (xfs.length === 0) xfs.push({ font: defaultFont, fill: null, border: noBorder, align: { h: "general", v: "bottom", wrap: false, shrink: false, rotation: 0, indent: 0 }, numFmt: "General" });
  return { xfs, defaultFont };
}

/** 共有の字（ふりがな rPh は除く。Excel の _x000D_ などの書き方を戻す） */
function readSharedStrings(root: XNode | null): string[] {
  return kids(root, "si").map(siText);
}

function siText(si: XNode): string {
  let s = "";
  for (const k of kids(si)) {
    if (k.n === "t") s += textOf(k);
    else if (k.n === "r") s += textOf(kid(k, "t"));
  }
  return unescapeX(s);
}

const unescapeX = (s: string) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\r\n?/g, "\n");

// ---------------------------------------------------------------- 値の見せ方

function excelDate(serial: number): Date {
  // 1900 年の誤り（1900/2/29）を含む Excel の日の番号
  const days = serial > 59 ? serial - 1 : serial;
  return new Date(Date.UTC(1899, 11, 31) + days * 86400000);
}

const ERAS: Array<[number, string, string]> = [
  [Date.UTC(2019, 4, 1), "令和", "R"],
  [Date.UTC(1989, 0, 8), "平成", "H"],
  [Date.UTC(1926, 11, 25), "昭和", "S"],
  [Date.UTC(1912, 6, 30), "大正", "T"],
];

function formatValue(raw: string, fmt: string): string {
  const v = Number(raw);
  if (!Number.isFinite(v)) return raw;
  const code = fmt.replace(/"[^"]*"/g, (m) => m).trim();
  if (code === "General" || code === "@" || code === "") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  if (/[ymdhsge]/i.test(bare) && !/[#0]/.test(bare)) {
    const d = excelDate(v);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (/g/.test(bare)) {
      const era = ERAS.find(([t]) => d.getTime() >= t);
      if (era) {
        const ey = y - new Date(era[0]).getUTCFullYear() + 1;
        return `${era[1]}${ey === 1 ? "元" : ey}年${m}月${day}日`;
      }
    }
    if (/年/.test(code)) return /d/.test(bare) ? `${y}年${m}月${day}日` : `${y}年${m}月`;
    return `${y}/${m}/${day}`;
  }
  if (/%/.test(bare)) return `${Math.round(v * 100 * 100) / 100}%`;
  const decimals = (/\.(0+)/.exec(bare)?.[1].length ?? 0) as number;
  const fixed = v.toFixed(decimals);
  if (/#,##/.test(bare)) {
    const [i, f] = fixed.split(".");
    return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f ? `.${f}` : ""}`;
  }
  return fixed;
}

// ---------------------------------------------------------------- シート

type Cell = { xf: number; text: string; kind: "s" | "n" | "b" | "e" | "none" };

type SheetData = {
  name: string;
  cells: Map<number, Map<number, Cell>>;
  colW: Map<number, { width: number; hidden: boolean; style: number | null }>;
  rowH: Map<number, { ht: number | null; custom: boolean; hidden: boolean; style: number | null }>;
  customDefaultRow: boolean;
  defaultColWidth: number | null;
  baseColWidth: number;
  defaultRowHeight: number;
  merges: Range[];
  printAreas: Range[];
  page: {
    paper: number;
    landscape: boolean;
    scale: number;
    fit: boolean;
    fitW: number;
    fitH: number;
    margins: { l: number; r: number; t: number; b: number; header: number; footer: number };
    hCenter: boolean;
    vCenter: boolean;
    overThenDown: boolean;
    rowBreaks: number[];
    colBreaks: number[];
    header: string | null;
    footer: string | null;
    firstHeader: string | null;
    firstFooter: string | null;
    scaleWithDoc: boolean;
    firstPageNumber: number | null;
  };
  drawingRoot: XNode | null;
  drawingRels: Map<string, { type: string; target: string; external: boolean }>;
  vmlRoot: XNode | null;
  controls: Array<{ shapeId: string; from: Anchor; to: Anchor; type: string; checked: boolean }>;
};

type Anchor = { col: number; colOff: number; row: number; rowOff: number };

/** 紙の大きさ（mm、縦向き）。paperSize の番号（ECMA-376 18.3.1.63） */
export const PAPER_MM: Record<number, [number, number]> = {
  1: [215.9, 279.4],
  5: [215.9, 355.6],
  8: [297, 420],
  9: [210, 297],
  11: [148, 210],
  12: [257, 364],
  13: [182, 257],
  66: [420, 594],
  70: [105, 148],
};

function anchorOf(x: XNode | null): Anchor | null {
  if (!x) return null;
  const n = (name: string) => Number(textOf(kid(x, name)).trim() || "0");
  return { col: n("col"), colOff: n("colOff"), row: n("row"), rowOff: n("rowOff") };
}

/** ヘッダー・フッターの文の 1 つ（&L &C &R の 3 つに分けて、&P などを開く） */
function headerParts(src: string, ctx: { page: number; pages: number; sheet: string }): { l: string; c: string; r: string; size: number | null; bold: boolean } {
  const out = { l: "", c: "", r: "" } as Record<"l" | "c" | "r", string>;
  let cur: "l" | "c" | "r" = "c";
  let size: number | null = null;
  let bold = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== "&") {
      out[cur] += ch;
      continue;
    }
    const nx = src[i + 1];
    if (nx === undefined) break;
    i++;
    if (nx === "L") cur = "l";
    else if (nx === "C") cur = "c";
    else if (nx === "R") cur = "r";
    else if (nx === "P") out[cur] += String(ctx.page);
    else if (nx === "N") out[cur] += String(ctx.pages);
    else if (nx === "A") out[cur] += ctx.sheet;
    else if (nx === "&") out[cur] += "&";
    else if (nx === "B") bold = !bold;
    else if (nx === '"') {
      const end = src.indexOf('"', i + 1);
      const spec = end > i ? src.slice(i + 1, end) : "";
      if (/太字|bold/i.test(spec)) bold = true;
      i = end > i ? end : src.length;
    } else if (/\d/.test(nx)) {
      let d = nx;
      while (/\d/.test(src[i + 1] ?? "")) d += src[++i];
      size = Number(d);
    } else if (nx === "K") i += 6;
    // &D &T &F &Z &G &S &X &Y &U &E &I などは描かない（日付・道・画像）
  }
  return { ...out, size, bold };
}

async function readSheet(
  zip: ZipArchive,
  part: string,
  name: string,
  index: number,
  defined: Array<{ name: string; local: number | null; text: string }>,
  theme: Theme,
  shared: readonly string[],
): Promise<SheetData | null> {
  const root = await xmlPart(zip, part);
  if (!root) return null;
  const rels = await readRels(zip, part);
  const cells = new Map<number, Map<number, Cell>>();
  const rowH = new Map<number, { ht: number | null; custom: boolean; hidden: boolean; style: number | null }>();
  for (const row of kids(kid(root, "sheetData"), "row")) {
    const r = num(row, "r");
    if (!r) continue;
    rowH.set(r, {
      ht: num(row, "ht") ?? null,
      custom: bool(row, "customHeight", false),
      hidden: bool(row, "hidden", false),
      style: bool(row, "customFormat", false) ? num(row, "s", 0) : null,
    });
    let prevCol = 0;
    for (const c of kids(row, "c")) {
      const ref = c.a.r ? cellRef(c.a.r) : { col: prevCol + 1, row: r };
      if (!ref) continue;
      prevCol = ref.col;
      const t = c.a.t ?? "n";
      const v = kid(c, "v");
      let text = "";
      let kind: Cell["kind"] = "none";
      if (t === "s" && v) {
        text = shared[Number(textOf(v))] ?? "";
        kind = "s";
      } else if (t === "inlineStr") {
        text = siText(kid(c, "is") ?? { n: "is", a: {}, c: [] });
        kind = "s";
      } else if (t === "str" && v) {
        text = unescapeX(textOf(v));
        kind = "s";
      } else if (t === "b" && v) {
        text = textOf(v) === "1" ? "TRUE" : "FALSE";
        kind = "b";
      } else if (t === "e" && v) {
        text = textOf(v);
        kind = "e";
      } else if (v) {
        text = textOf(v);
        kind = "n";
      }
      let line = cells.get(r);
      if (!line) cells.set(r, (line = new Map()));
      line.set(ref.col, { xf: num(c, "s", 0), text, kind });
    }
  }
  const colW = new Map<number, { width: number; hidden: boolean; style: number | null }>();
  for (const col of kids(kid(root, "cols"), "col")) {
    const min = num(col, "min", 0);
    const max = Math.min(num(col, "max", min), 16384);
    for (let c = min; c <= max && c - min < 16384; c++)
      colW.set(c, { width: num(col, "width", Number.NaN), hidden: bool(col, "hidden", false), style: col.a.style !== undefined ? num(col, "style", 0) : null });
  }
  const fmt = kid(root, "sheetFormatPr");
  const merges: Range[] = [];
  for (const m of kids(kid(root, "mergeCells"), "mergeCell")) {
    const rg = m.a.ref ? rangeRef(m.a.ref) : null;
    if (rg) merges.push(rg);
  }
  const printAreas: Range[] = [];
  const pa = defined.find((d) => d.name === "_xlnm.Print_Area" && d.local === index);
  if (pa) {
    for (const piece of pa.text.split(",")) {
      const ref = piece.includes("!") ? piece.slice(piece.lastIndexOf("!") + 1) : piece;
      const rg = rangeRef(ref.replace(/'/g, ""));
      if (rg) printAreas.push(rg);
    }
  }
  const setup = kid(root, "pageSetup");
  const sheetPr = kid(root, "sheetPr");
  const margins = kid(root, "pageMargins");
  const opts = kid(root, "printOptions");
  const hf = kid(root, "headerFooter");
  const brk = (x: XNode | null) => kids(x, "brk").map((b) => num(b, "id", 0)).filter((n) => n > 0);
  let drawingRoot: XNode | null = null;
  let drawingRels = new Map<string, { type: string; target: string; external: boolean }>();
  const drawingId = attr(kid(root, "drawing"), "id");
  if (drawingId && rels.get(drawingId) && !rels.get(drawingId)!.external) {
    const dpart = rels.get(drawingId)!.target;
    drawingRoot = await xmlPart(zip, dpart);
    drawingRels = await readRels(zip, dpart);
  }
  let vmlRoot: XNode | null = null;
  const vmlId = attr(kid(root, "legacyDrawing"), "id");
  if (vmlId && rels.get(vmlId) && !rels.get(vmlId)!.external) {
    const t = await zip.text(rels.get(vmlId)!.target);
    if (t) {
      try {
        vmlRoot = parseXml(fixVml(t));
      } catch {
        vmlRoot = null;
      }
    }
  }
  const controls: SheetData["controls"] = [];
  const controlNodes: XNode[] = [];
  for (const k of kids(kid(root, "controls"))) {
    if (k.n === "control") controlNodes.push(k);
    else if (k.n === "AlternateContent") for (const a of alternate(k)) if (a.n === "control") controlNodes.push(a);
  }
  for (const ctl of controlNodes) {
    const pr = kid(ctl, "controlPr");
    const anchor = kid(pr, "anchor");
    const from = anchorOf(kid(anchor, "from"));
    const to = anchorOf(kid(anchor, "to"));
    const rid = ctl.a.id;
    let type = "";
    let checked = false;
    if (rid && rels.get(rid) && !rels.get(rid)!.external) {
      const cp = await xmlPart(zip, rels.get(rid)!.target);
      type = cp?.a.objectType ?? "";
      checked = (cp?.a.checked ?? "").toLowerCase() === "checked";
    }
    if (from && to && ctl.a.shapeId) controls.push({ shapeId: ctl.a.shapeId, from, to, type, checked });
  }
  return {
    name,
    cells,
    colW,
    rowH,
    defaultColWidth: num(fmt, "defaultColWidth") ?? null,
    baseColWidth: num(fmt, "baseColWidth", 8),
    defaultRowHeight: num(fmt, "defaultRowHeight", 15),
    customDefaultRow: bool(fmt, "customHeight", false),
    merges,
    printAreas,
    page: {
      paper: num(setup, "paperSize", 9),
      landscape: setup?.a.orientation === "landscape",
      scale: num(setup, "scale", 100),
      fit: bool(kid(sheetPr, "pageSetUpPr"), "fitToPage", false),
      fitW: num(setup, "fitToWidth", 1),
      fitH: num(setup, "fitToHeight", 1),
      margins: {
        l: num(margins, "left", 0.7),
        r: num(margins, "right", 0.7),
        t: num(margins, "top", 0.75),
        b: num(margins, "bottom", 0.75),
        header: num(margins, "header", 0.3),
        footer: num(margins, "footer", 0.3),
      },
      hCenter: bool(opts, "horizontalCentered", false),
      vCenter: bool(opts, "verticalCentered", false),
      overThenDown: setup?.a.pageOrder === "overThenDown",
      rowBreaks: brk(kid(root, "rowBreaks")),
      colBreaks: brk(kid(root, "colBreaks")),
      header: textOf(kid(hf, "oddHeader")) || null,
      footer: textOf(kid(hf, "oddFooter")) || null,
      firstHeader: bool(hf, "differentFirst", false) ? textOf(kid(hf, "firstHeader")) || "" : null,
      firstFooter: bool(hf, "differentFirst", false) ? textOf(kid(hf, "firstFooter")) || "" : null,
      scaleWithDoc: bool(hf, "scaleWithDoc", true),
      firstPageNumber: bool(setup, "useFirstPageNumber", false) ? num(setup, "firstPageNumber", 1) : null,
    },
    drawingRoot,
    drawingRels,
    vmlRoot,
    controls,
  };
}

/** Excel の VML は XML として崩れた所（閉じない <br>）を持つことがある */
function fixVml(t: string): string {
  return t.replace(/<br>/gi, "<br/>").replace(/<o:p><\/o:p>/g, "");
}

// ---------------------------------------------------------------- 寸法

type Grid = {
  /** 列 c（1 から）の左の x（pt、シートの左上から） */
  colX(c: number): number;
  colWpt(c: number): number;
  rowY(r: number): number;
  rowHpt(r: number): number;
  mdw: number;
};

function makeGrid(sheet: SheetData, defaultFont: Font): Grid {
  const mdw = mdwOf(defaultFont.name, defaultFont.size);
  // 印刷の列幅: 列幅の文字数（余白込みの保存値）× 既定の書体の数字の幅（pt。画素に丸めない）。
  // 画面の画素の式（ECMA-376 18.3.1.13）は 96 dpi の画素に丸めるので、印刷（PDF）とは数 % ずれる（双子の PDF で確かめた）
  const digit = digitEmOf(defaultFont.name) * defaultFont.size;
  const defaultChars = sheet.defaultColWidth ?? sheet.baseColWidth + 5 / mdw;
  const colPt = (c: number) => {
    const d = sheet.colW.get(c);
    if (d?.hidden) return 0;
    const w = d && Number.isFinite(d.width) ? d.width : defaultChars;
    return Math.max(0, w) * digit;
  };
  // 高さを指定していない行（自動の高さ）は、印刷では書体の高さで測り直される（游ゴシックは画面の 18.75pt に対して約 18.07pt）
  const autoRow = autoRowFactorOf(defaultFont.name);
  const rowPt = (r: number) => {
    const d = sheet.rowH.get(r);
    if (d?.hidden) return 0;
    if (d?.custom || sheet.customDefaultRow) return d?.ht ?? sheet.defaultRowHeight;
    return (d?.ht ?? sheet.defaultRowHeight) * autoRow;
  };
  const colCache: number[] = [0, 0];
  const rowCache: number[] = [0, 0];
  const colX = (c: number) => {
    for (let i = colCache.length; i <= c; i++) colCache[i] = colCache[i - 1] + colPt(i - 1);
    return colCache[c];
  };
  const rowY = (r: number) => {
    for (let i = rowCache.length; i <= r; i++) rowCache[i] = rowCache[i - 1] + rowPt(i - 1);
    return rowCache[r];
  };
  return { colX, colWpt: colPt, rowY, rowHpt: rowPt, mdw };
}

// ---------------------------------------------------------------- 罫線

const BORDER_WEIGHT: Record<string, number> = {
  hair: 1, dotted: 2, dashDotDot: 3, dashDot: 4, dashed: 5, thin: 6, mediumDashDotDot: 7, slantDashDot: 8, mediumDashDot: 9, mediumDashed: 10, medium: 11, thick: 12, double: 13,
};

/** 罫線の種類 → 太さ（pt）と破線（pt） */
function strokeOfStyle(style: string, color: string): { width: number; dash?: number[]; double?: boolean } {
  switch (style) {
    case "hair":
      return { width: 0.25 };
    case "dotted":
      return { width: 0.5, dash: [0.75, 0.75] };
    case "dashed":
      return { width: 0.5, dash: [2.25, 0.75] };
    case "dashDot":
      return { width: 0.5, dash: [2.25, 0.75, 0.75, 0.75] };
    case "dashDotDot":
      return { width: 0.5, dash: [2.25, 0.75, 0.75, 0.75, 0.75, 0.75] };
    case "medium":
      return { width: 1.0 };
    case "mediumDashed":
      return { width: 1.0, dash: [4.5, 1.5] };
    case "mediumDashDot":
    case "slantDashDot":
      return { width: 1.0, dash: [4.5, 1.5, 1.5, 1.5] };
    case "mediumDashDotDot":
      return { width: 1.0, dash: [4.5, 1.5, 1.5, 1.5, 1.5, 1.5] };
    case "thick":
      return { width: 1.5 };
    case "double":
      return { width: 0.5, double: true };
    default:
      void color;
      return { width: 0.5 };
  }
}

type Edge = { style: string; color: string };

// ---------------------------------------------------------------- レイアウト

export type XlsxSheetInfo = { index: number; name: string; hidden: boolean; pages: number; example: boolean };

export type XlsxResult = { pages: OfficePage[]; sheets: XlsxSheetInfo[]; warnings: string[] };

/** 記入例・記載例・事例のシートか（既定で読まない候補） */
export const isExampleSheet = (name: string) => /記入例|記載例|事例|見本|サンプル|例\s*[)）】]|^例/.test(name);

export type XlsxOptions = { measure?: Measure; maxPages?: number };

export async function renderXlsx(zip: ZipArchive, opts: XlsxOptions = {}): Promise<XlsxResult> {
  const warnings: string[] = [];
  const wbPart = "xl/workbook.xml";
  const wb = await xmlPart(zip, wbPart);
  if (!wb) throw new Error("workbook");
  const wbRels = await readRels(zip, wbPart);
  const themeRel = [...wbRels.values()].find((r) => r.type === "theme");
  const theme = themeRel ? parseTheme(await xmlPart(zip, themeRel.target)) : DEFAULT_THEME;
  const stylesRel = [...wbRels.values()].find((r) => r.type === "styles");
  const styles = readStyles(stylesRel ? await xmlPart(zip, stylesRel.target) : null, theme);
  const ssRel = [...wbRels.values()].find((r) => r.type === "sharedStrings");
  const shared = readSharedStrings(ssRel ? await xmlPart(zip, ssRel.target) : null);
  const defined = kids(kid(wb, "definedNames"), "definedName").map((d) => ({
    name: d.a.name ?? "",
    local: d.a.localSheetId !== undefined ? Number(d.a.localSheetId) : null,
    text: textOf(d).trim(),
  }));
  const measure: Measure = opts.measure ?? estimateMeasure;
  const pages: OfficePage[] = [];
  const sheets: XlsxSheetInfo[] = [];
  const list = kids(kid(wb, "sheets"), "sheet");
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const name = s.a.name ?? `Sheet${i + 1}`;
    const hidden = s.a.state === "hidden" || s.a.state === "veryHidden";
    const rel = s.a.id ? wbRels.get(s.a.id) : undefined;
    // 表のシートだけ（グラフのシート・ダイアログのシート・マクロのシートは読まない）
    if (!rel || rel.external || rel.type !== "worksheet") {
      sheets.push({ index: i, name, hidden, pages: 0, example: isExampleSheet(name) });
      continue;
    }
    if (hidden) {
      sheets.push({ index: i, name, hidden, pages: 0, example: isExampleSheet(name) });
      continue;
    }
    const sheet = await readSheet(zip, rel.target, name, i, defined, theme, shared);
    if (!sheet) {
      warnings.push(`sheet:${name}`);
      sheets.push({ index: i, name, hidden, pages: 0, example: isExampleSheet(name) });
      continue;
    }
    const sp = layoutSheet(sheet, styles, theme, measure, warnings);
    sheets.push({ index: i, name, hidden, pages: sp.length, example: isExampleSheet(name) });
    pages.push(...sp);
    if (opts.maxPages && pages.length >= opts.maxPages) break;
  }
  const kept = opts.maxPages ? pages.slice(0, opts.maxPages) : pages;
  await loadImages(zip, kept, warnings);
  return { pages: kept, sheets, warnings };
}

/** 図形の画像の中身を読む（PNG・JPEG・GIF だけ。EMF・WMF は描けないので外す） */
export async function loadImages(zip: ZipArchive, pages: OfficePage[], warnings: string[]): Promise<void> {
  for (const page of pages) {
    const keep: PageItem[] = [];
    for (const it of page.items) {
      if (it.k !== "image" || it.data.length > 0) {
        keep.push(it);
        continue;
      }
      const part = IMAGE_PART.get(it);
      const bytes = part ? await zip.bytes(part).catch(() => null) : null;
      const type = bytes ? imageType(bytes) : null;
      if (!bytes || !type) {
        warnings.push(`image:${(part ?? "").split(".").pop() ?? ""}`);
        continue;
      }
      keep.push({ ...it, data: bytes, type });
    }
    page.items = keep;
  }
}

export function imageType(b: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

function usedRange(sheet: SheetData, styles: Styles, grid: Grid, shapes: ShapeBox[]): Range | null {
  let c0 = Infinity;
  let r0 = Infinity;
  let c1 = 0;
  let r1 = 0;
  const take = (c: number, r: number) => {
    c0 = Math.min(c0, c);
    r0 = Math.min(r0, r);
    c1 = Math.max(c1, c);
    r1 = Math.max(r1, r);
  };
  for (const [r, line] of sheet.cells) {
    for (const [c, cell] of line) {
      const xf = styles.xfs[cell.xf] ?? styles.xfs[0];
      const b = xf.border;
      if (cell.text !== "" || xf.fill || b.left || b.right || b.top || b.bottom || b.diagDown || b.diagUp) take(c, r);
    }
  }
  for (const m of sheet.merges) {
    if (m.c0 >= c0 && m.r0 >= r0 && m.c0 <= c1 && m.r0 <= r1) take(m.c1, m.r1);
  }
  // 図形の右下の所まで（図形だけの様式もある）
  for (const s of shapes) {
    const cr = locate(grid, s.box.x + s.box.w, s.box.y + s.box.h);
    const cl = locate(grid, s.box.x, s.box.y);
    take(cl.col, cl.row);
    take(cr.col, cr.row);
  }
  return c1 > 0 ? { c0, r0, c1, r1 } : null;
}

/** シートの座標（pt）が入るセル */
function locate(grid: Grid, x: number, y: number): { col: number; row: number } {
  let col = 1;
  while (col < 16384 && grid.colX(col + 1) <= x) col++;
  let row = 1;
  while (row < 1048576 && grid.rowY(row + 1) <= y) row++;
  return { col, row };
}

/** 帯（頁に入る列・行のまとまり）に分ける。手の改ページ（id の手前で切る）と頁の大きさ */
function bands(start: number, end: number, size: (i: number) => number, avail: number, manual: number[], useManual: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const breaks = useManual ? manual.filter((b) => b >= start && b < end).sort((a, b) => a - b) : [];
  let s = start;
  let acc = 0;
  for (let i = start; i <= end; i++) {
    const w = size(i);
    const manualBreak = i > s && breaks.includes(i - 1);
    // 手の改ページまでの塊が頁を少し（MANUAL_SLACK）超えるだけなら、自動の改ページを入れない（Excel の印刷は書体の測り方で数 % 縮むことがあり、作った人は手の改ページで頁を決めている）
    const next = breaks.find((b) => b >= i - 1);
    let limit = avail;
    if (next !== undefined) {
      let block = acc;
      for (let j = i; j <= next; j++) block += size(j);
      if (block <= avail * (1 + MANUAL_SLACK)) limit = avail * (1 + MANUAL_SLACK);
    }
    if (i > s && (manualBreak || acc + w > limit + 1e-6)) {
      out.push([s, i - 1]);
      s = i;
      acc = 0;
    }
    acc += w;
  }
  out.push([s, end]);
  return out;
}

/** 見積もりの測り方（等幅の和文書体は半角を 0.5 字に） */
const estimateMeasure: Measure = (t, f) => estimateWidth(t, f);

/** 画像の項目 → zip の中の部品の名前（描いたあとで中身を読む） */
export const IMAGE_PART = new WeakMap<PageItem, string>();

/** 手の改ページの塊が頁を超えてよい割合 */
const MANUAL_SLACK = 0.03;

type ShapeBox = { box: Box; node: XNode; kind: "shape" | "control"; control?: SheetData["controls"][number] };

function layoutSheet(sheet: SheetData, styles: Styles, theme: Theme, measure: Measure, warnings: string[]): OfficePage[] {
  const grid = makeGrid(sheet, styles.defaultFont);
  const anchorPt = (a: Anchor) => ({
    x: grid.colX(a.col + 1) + Math.min(a.colOff / 12700, grid.colWpt(a.col + 1)),
    y: grid.rowY(a.row + 1) + Math.min(a.rowOff / 12700, grid.rowHpt(a.row + 1)),
  });
  // 図形の矩形（pt、シートの左上から）
  const shapes: ShapeBox[] = [];
  for (const anc of drawingAnchors(sheet.drawingRoot)) {
    let box: Box | null = null;
    if (anc.n === "twoCellAnchor") {
      const f = anchorOf(kid(anc, "from"));
      const t = anchorOf(kid(anc, "to"));
      if (f && t) {
        const p = anchorPt(f);
        const q = anchorPt(t);
        box = { x: p.x, y: p.y, w: Math.max(0, q.x - p.x), h: Math.max(0, q.y - p.y) };
      }
    } else if (anc.n === "oneCellAnchor") {
      const f = anchorOf(kid(anc, "from"));
      const ext = kid(anc, "ext");
      if (f && ext) {
        const p = anchorPt(f);
        box = { x: p.x, y: p.y, w: num(ext, "cx", 0) / 12700, h: num(ext, "cy", 0) / 12700 };
      }
    } else if (anc.n === "absoluteAnchor") {
      const pos = kid(anc, "pos");
      const ext = kid(anc, "ext");
      if (pos && ext) box = { x: num(pos, "x", 0) / 12700, y: num(pos, "y", 0) / 12700, w: num(ext, "cx", 0) / 12700, h: num(ext, "cy", 0) / 12700 };
    }
    if (!box) continue;
    const content = kids(anc).find((k) => ["sp", "cxnSp", "grpSp", "pic", "graphicFrame"].includes(k.n));
    if (!content) continue;
    if (isHidden(content)) continue;
    shapes.push({ box, node: content, kind: "shape" });
  }
  for (const ctl of sheet.controls) {
    const p = anchorPt(ctl.from);
    const q = anchorPt(ctl.to);
    shapes.push({ box: { x: p.x, y: p.y, w: Math.max(0, q.x - p.x), h: Math.max(0, q.y - p.y) }, node: { n: "control", a: {}, c: [] }, kind: "control", control: ctl });
  }
  // <controls> の無い古い形は VML の x:Anchor から
  if (sheet.controls.length === 0 && sheet.vmlRoot) {
    for (const sh of descendants(sheet.vmlRoot, "shape")) {
      const cd = kid(sh, "ClientData");
      const type = cd?.a.ObjectType ?? "";
      if (!["Checkbox", "Radio", "GBox", "Label", "Button", "Drop"].includes(type)) continue;
      const nums = textOf(kid(cd, "Anchor")).split(",").map((s) => Number(s.trim()));
      if (nums.length !== 8 || nums.some((n) => !Number.isFinite(n))) continue;
      const [lc, lo, tr, to, rc, ro, br, bo] = nums;
      const x0 = grid.colX(lc + 1) + lo * 0.75;
      const y0 = grid.rowY(tr + 1) + to * 0.75;
      const x1 = grid.colX(rc + 1) + ro * 0.75;
      const y1 = grid.rowY(br + 1) + bo * 0.75;
      const checked = textOf(kid(cd, "Checked")).trim() === "1";
      const id = (sh.a.id ?? "").replace(/^_x0000_s/, "");
      shapes.push({
        box: { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) },
        node: { n: "control", a: {}, c: [] },
        kind: "control",
        control: { shapeId: id, from: { col: lc, colOff: 0, row: tr, rowOff: 0 }, to: { col: rc, colOff: 0, row: br, rowOff: 0 }, type: type === "Checkbox" ? "CheckBox" : type === "Radio" ? "Radio" : type, checked },
      });
    }
  }
  const vmlText = new Map<string, { text: string; size: number | null }>();
  for (const sh of descendants(sheet.vmlRoot, "shape")) {
    const id = (sh.a.id ?? "").replace(/^_x0000_s/, "");
    const tb = kid(sh, "textbox");
    if (!id || !tb) continue;
    const fontNode = descendants(tb, "font")[0];
    const size = fontNode?.a.size ? Number(fontNode.a.size) / 20 : null;
    vmlText.set(id, { text: textOf(tb).replace(/\s+/g, " ").trim(), size });
  }

  const areas = sheet.printAreas.length > 0 ? sheet.printAreas : [usedRange(sheet, styles, grid, shapes)].filter((x): x is Range => x !== null);
  if (areas.length === 0) return [];
  const pg = sheet.page;
  const [pw0, ph0] = PAPER_MM[pg.paper] ?? PAPER_MM[9];
  const pageW = pg.landscape ? ph0 : pw0;
  const pageH = pg.landscape ? pw0 : ph0;
  const m = pg.margins;
  const availWmm = pageW - (m.l + m.r) * INCH_MM;
  const availHmm = pageH - (m.t + m.b) * INCH_MM;
  const out: OfficePage[] = [];

  for (const area0 of areas) {
    const area = { ...area0, c1: Math.min(area0.c1, 16384), r1: Math.min(area0.r1, 1048576) };
    // 列全体・行全体の印刷範囲は使った所まで
    if (area.r1 - area.r0 > 5000 || area.c1 - area.c0 > 500) {
      const used = usedRange(sheet, styles, grid, shapes);
      if (used) {
        area.r1 = Math.min(area.r1, used.r1);
        area.c1 = Math.min(area.c1, used.c1);
      }
    }
    const totalW = grid.colX(area.c1 + 1) - grid.colX(area.c0);
    const totalH = grid.rowY(area.r1 + 1) - grid.rowY(area.r0);
    let scale = Math.max(10, Math.min(400, pg.scale || 100)) / 100;
    let useColBreaks = true;
    let useRowBreaks = true;
    if (pg.fit) {
      const sx = pg.fitW > 0 && totalW > 0 ? (availWmm * pg.fitW) / (totalW * PT_MM) : Infinity;
      const sy = pg.fitH > 0 && totalH > 0 ? (availHmm * pg.fitH) / (totalH * PT_MM) : Infinity;
      const fit = Math.min(1, sx, sy);
      // Excel の合わせた倍率は整数の %（切り捨て）
      scale = Math.max(0.1, Math.floor(fit * 100 + 1e-6) / 100);
      // Excel は合わせた倍率を scale に書き残す。保存した端末の印刷の範囲（プリンターの余白）で合わせた値なので、計算より小さければそちらを使う
      if (pg.scale > 0 && pg.scale / 100 < scale) scale = Math.max(0.1, pg.scale / 100);
      useColBreaks = pg.fitW === 0;
      useRowBreaks = pg.fitH === 0;
    }
    const availW = availWmm / PT_MM / scale;
    const availH = availHmm / PT_MM / scale;
    const colBands = bands(area.c0, area.c1, (c) => grid.colWpt(c), availW, pg.colBreaks, useColBreaks);
    const rowBands = bands(area.r0, area.r1, (r) => grid.rowHpt(r), availH, pg.rowBreaks, useRowBreaks);
    const order: Array<[[number, number], [number, number]]> = [];
    if (pg.overThenDown) for (const rb of rowBands) for (const cb of colBands) order.push([cb, rb]);
    else for (const cb of colBands) for (const rb of rowBands) order.push([cb, rb]);
    const sheetPages = order.length;
    order.forEach(([cb, rb], n) => {
      const bw = (grid.colX(cb[1] + 1) - grid.colX(cb[0])) * scale * PT_MM;
      const bh = (grid.rowY(rb[1] + 1) - grid.rowY(rb[0])) * scale * PT_MM;
      const ox = m.l * INCH_MM + (pg.hCenter ? Math.max(0, (availWmm - bw) / 2) : 0);
      const oy = m.t * INCH_MM + (pg.vCenter ? Math.max(0, (availHmm - bh) / 2) : 0);
      const sx0 = grid.colX(cb[0]);
      const sy0 = grid.rowY(rb[0]);
      const k = scale * PT_MM;
      const X = (x: number) => ox + (x - sx0) * k;
      const Y = (y: number) => oy + (y - sy0) * k;
      const band = { c0: cb[0], c1: cb[1], r0: rb[0], r1: rb[1] };
      const items: PageItem[] = [];
      drawCells(items, sheet, styles, grid, band, X, Y, k, measure);
      drawShapes(items, shapes, sheet, theme, styles, grid, band, X, Y, k, measure, vmlText, warnings);
      const pageNo = (pg.firstPageNumber ?? 1) + n;
      const first = n === 0;
      const header = first && pg.firstHeader !== null ? pg.firstHeader : pg.header;
      const footer = first && pg.firstFooter !== null ? pg.firstFooter : pg.footer;
      const hfScale = pg.scaleWithDoc ? scale : 1;
      for (const [src, top] of [
        [header, true],
        [footer, false],
      ] as const) {
        if (!src) continue;
        const parts = headerParts(src, { page: pageNo, pages: sheetPages, sheet: sheet.name });
        const size = (parts.size ?? styles.defaultFont.size) * hfScale * PT_MM;
        const font: FontSpec = { family: cssFamily(styles.defaultFont.name), size, bold: parts.bold };
        const y = top ? m.header * INCH_MM + size * 0.88 : pageH - m.footer * INCH_MM - size * 0.2;
        const xl = m.l * INCH_MM;
        const xr = pageW - m.r * INCH_MM;
        if (parts.l) items.push({ k: "text", text: parts.l, x: xl, y, font, color: "#000000", align: "left" });
        if (parts.c) items.push({ k: "text", text: parts.c, x: pageW / 2, y, font, color: "#000000", align: "center" });
        if (parts.r) items.push({ k: "text", text: parts.r, x: xr, y, font, color: "#000000", align: "right" });
      }
      out.push({ w: pageW, h: pageH, items, sheet: sheet.name, page: n + 1 });
    });
  }
  return out;
}

function isHidden(x: XNode): boolean {
  const nv = kids(x).find((k) => k.n.startsWith("nv"));
  const c = nv ? kids(nv).find((k) => k.n === "cNvPr") : null;
  return c?.a.hidden === "1" || c?.a.hidden === "true";
}

function drawingAnchors(root: XNode | null): XNode[] {
  const out: XNode[] = [];
  for (const k of kids(root)) {
    if (k.n === "AlternateContent") {
      for (const a of alternate(k)) if (/Anchor$/.test(a.n)) out.push(a);
    } else if (/Anchor$/.test(k.n)) out.push(k);
  }
  return out;
}

type Band = Range;

/** セルの塗り・罫線・字を描く */
function drawCells(items: PageItem[], sheet: SheetData, styles: Styles, grid: Grid, band: Band, X: (x: number) => number, Y: (y: number) => number, k: number, measure: Measure) {
  // 結合の索引: 左上 → 範囲、ほかのセル → 範囲
  const mergeOf = new Map<string, Range>();
  for (const mg of sheet.merges) {
    if (mg.c1 < band.c0 || mg.c0 > band.c1 || mg.r1 < band.r0 || mg.r0 > band.r1) continue;
    for (let r = mg.r0; r <= mg.r1; r++) for (let c = mg.c0; c <= mg.c1; c++) mergeOf.set(`${r}:${c}`, mg);
  }
  const xfAt = (r: number, c: number): Xf => {
    const cell = sheet.cells.get(r)?.get(c);
    if (cell) return styles.xfs[cell.xf] ?? styles.xfs[0];
    const rs = sheet.rowH.get(r)?.style;
    if (rs !== null && rs !== undefined) return styles.xfs[rs] ?? styles.xfs[0];
    const cs = sheet.colW.get(c)?.style;
    if (cs !== null && cs !== undefined) return styles.xfs[cs] ?? styles.xfs[0];
    return styles.xfs[0];
  };

  // 塗り
  const filled = new Set<string>();
  for (let r = band.r0; r <= band.r1; r++) {
    if (grid.rowHpt(r) === 0) continue;
    for (let c = band.c0; c <= band.c1; c++) {
      if (grid.colWpt(c) === 0) continue;
      const mg = mergeOf.get(`${r}:${c}`);
      const top = mg ? { r: mg.r0, c: mg.c0 } : { r, c };
      const key = `${top.r}:${top.c}`;
      if (filled.has(key)) continue;
      const xf = xfAt(top.r, top.c);
      if (!xf.fill || /^#FFFFFF$/i.test(xf.fill)) continue;
      filled.add(key);
      const rg = clipRange(mg ?? { c0: c, c1: c, r0: r, r1: r }, band);
      const x0 = X(grid.colX(rg.c0));
      const y0 = Y(grid.rowY(rg.r0));
      items.push({ k: "rect", x: x0, y: y0, w: X(grid.colX(rg.c1 + 1)) - x0, h: Y(grid.rowY(rg.r1 + 1)) - y0, fill: xf.fill });
    }
  }

  // 罫線: 横の辺（行 r の上の辺）と縦の辺（列 c の左の辺）ごとに、重い方の種類を残す
  const hEdges = new Map<string, Edge>();
  const vEdges = new Map<string, Edge>();
  const put = (map: Map<string, Edge>, key: string, side: BorderSide) => {
    if (!side) return;
    const cur = map.get(key);
    if (!cur || (BORDER_WEIGHT[side.style] ?? 6) > (BORDER_WEIGHT[cur.style] ?? 6)) map.set(key, side);
  };
  const diag: Array<{ rg: Range; up: BorderSide; down: BorderSide }> = [];
  const seenDiag = new Set<string>();
  for (let r = band.r0; r <= band.r1; r++) {
    for (let c = band.c0; c <= band.c1; c++) {
      const xf = xfAt(r, c);
      const b = xf.border;
      const mg = mergeOf.get(`${r}:${c}`);
      // 結合の中の辺は描かない（外周だけ）
      if (!mg || r === mg.r0) put(hEdges, `${r}:${c}`, b.top);
      if (!mg || r === mg.r1) put(hEdges, `${r + 1}:${c}`, b.bottom);
      if (!mg || c === mg.c0) put(vEdges, `${r}:${c}`, b.left);
      if (!mg || c === mg.c1) put(vEdges, `${r}:${c + 1}`, b.right);
      if (b.diagUp || b.diagDown) {
        const rg = mg ?? { c0: c, c1: c, r0: r, r1: r };
        const key = `${rg.r0}:${rg.c0}`;
        if (!seenDiag.has(key)) {
          seenDiag.add(key);
          diag.push({ rg, up: b.diagUp, down: b.diagDown });
        }
      }
    }
  }
  // 結合のセルの辺は、結合の左上のセルの罫線でも補う（左上にだけ罫線を書いた様式）
  for (const mg of new Set(mergeOf.values())) {
    const b = xfAt(mg.r0, mg.c0).border;
    for (let c = Math.max(mg.c0, band.c0); c <= Math.min(mg.c1, band.c1); c++) {
      if (b.top && !hEdges.has(`${mg.r0}:${c}`)) put(hEdges, `${mg.r0}:${c}`, b.top);
      if (b.bottom && !hEdges.has(`${mg.r1 + 1}:${c}`)) put(hEdges, `${mg.r1 + 1}:${c}`, b.bottom);
    }
    for (let r = Math.max(mg.r0, band.r0); r <= Math.min(mg.r1, band.r1); r++) {
      if (b.left && !vEdges.has(`${r}:${mg.c0}`)) put(vEdges, `${r}:${mg.c0}`, b.left);
      if (b.right && !vEdges.has(`${r}:${mg.c1 + 1}`)) put(vEdges, `${r}:${mg.c1 + 1}`, b.right);
    }
  }
  const lineOf = (e: Edge, x1: number, y1: number, x2: number, y2: number) => {
    const s = strokeOfStyle(e.style, e.color);
    const stroke: Stroke = { color: e.color, width: Math.max(0.1, s.width * PT_MM), dash: s.dash?.map((d) => d * PT_MM) };
    if (s.double) {
      const off = 0.75 * PT_MM;
      const horiz = y1 === y2;
      items.push({ k: "line", x1: x1 - (horiz ? 0 : off), y1: y1 - (horiz ? off : 0), x2: x2 - (horiz ? 0 : off), y2: y2 - (horiz ? off : 0), stroke });
      items.push({ k: "line", x1: x1 + (horiz ? 0 : off), y1: y1 + (horiz ? off : 0), x2: x2 + (horiz ? 0 : off), y2: y2 + (horiz ? off : 0), stroke });
    } else items.push({ k: "line", x1, y1, x2, y2, stroke });
  };
  // 横の辺: 行ごとに、同じ種類の続く所を 1 本に
  for (let r = band.r0; r <= band.r1 + 1; r++) {
    let run: { e: Edge; c0: number; c1: number } | null = null;
    const flush = () => {
      if (!run) return;
      const y = Y(grid.rowY(r));
      lineOf(run.e, X(grid.colX(run.c0)), y, X(grid.colX(run.c1 + 1)), y);
      run = null;
    };
    for (let c = band.c0; c <= band.c1; c++) {
      const e = grid.colWpt(c) === 0 ? null : (hEdges.get(`${r}:${c}`) ?? null);
      if (e && run && run.e.style === e.style && run.e.color === e.color && run.c1 === c - 1) run.c1 = c;
      else {
        flush();
        if (e) run = { e, c0: c, c1: c };
      }
    }
    flush();
  }
  for (let c = band.c0; c <= band.c1 + 1; c++) {
    let run: { e: Edge; r0: number; r1: number } | null = null;
    const flush = () => {
      if (!run) return;
      const x = X(grid.colX(c));
      lineOf(run.e, x, Y(grid.rowY(run.r0)), x, Y(grid.rowY(run.r1 + 1)));
      run = null;
    };
    for (let r = band.r0; r <= band.r1; r++) {
      const e = grid.rowHpt(r) === 0 ? null : (vEdges.get(`${r}:${c}`) ?? null);
      if (e && run && run.e.style === e.style && run.e.color === e.color && run.r1 === r - 1) run.r1 = r;
      else {
        flush();
        if (e) run = { e, r0: r, r1: r };
      }
    }
    flush();
  }
  for (const d of diag) {
    const rg = clipRange(d.rg, band);
    const x0 = X(grid.colX(rg.c0));
    const y0 = Y(grid.rowY(rg.r0));
    const x1 = X(grid.colX(rg.c1 + 1));
    const y1 = Y(grid.rowY(rg.r1 + 1));
    if (d.down) lineOf(d.down, x0, y0, x1, y1);
    if (d.up) lineOf(d.up, x0, y1, x1, y0);
  }

  // 字
  const isEmpty = (r: number, c: number) => {
    const cell = sheet.cells.get(r)?.get(c);
    return (!cell || cell.text === "") && !mergeOf.has(`${r}:${c}`);
  };
  for (let r = band.r0; r <= band.r1; r++) {
    const line = sheet.cells.get(r);
    if (!line) continue;
    for (const [c, cell] of line) {
      if (c < band.c0 || c > band.c1 || cell.text === "") continue;
      const mg = mergeOf.get(`${r}:${c}`);
      if (mg && (mg.r0 !== r || mg.c0 !== c)) continue;
      const rg = mg ?? { c0: c, c1: c, r0: r, r1: r };
      const xf = styles.xfs[cell.xf] ?? styles.xfs[0];
      const text = cell.kind === "n" ? formatValue(cell.text, xf.numFmt) : cell.text;
      cellText(items, { text, kind: cell.kind, xf, rg, band, grid, X, Y, k, measure, isEmpty, row: r });
    }
  }
}

const clipRange = (rg: Range, band: Band): Range => ({ c0: Math.max(rg.c0, band.c0), c1: Math.min(rg.c1, band.c1), r0: Math.max(rg.r0, band.r0), r1: Math.min(rg.r1, band.r1) });

/** Excel の 1 行の高さ（字の大きさに掛ける）。ＭＳ の書体は 11pt で 13.5pt、游ゴシック・メイリオは 18.75pt */
function excelLineEm(name: string): number {
  if (/^(游|Yu)|メイリオ|Meiryo/i.test(name)) return 1.7;
  if (/^BIZ\s*UD/i.test(name)) return 1.3;
  return 1.23;
}

function cellText(
  items: PageItem[],
  o: {
    text: string;
    kind: Cell["kind"];
    xf: Xf;
    rg: Range;
    band: Band;
    grid: Grid;
    X: (x: number) => number;
    Y: (y: number) => number;
    k: number;
    measure: Measure;
    isEmpty: (r: number, c: number) => boolean;
    row: number;
  },
) {
  const { xf, grid, X, Y, k } = o;
  const rg = clipRange(o.rg, o.band);
  const x0 = X(grid.colX(rg.c0));
  const x1 = X(grid.colX(rg.c1 + 1));
  const y0 = Y(grid.rowY(rg.r0));
  const y1 = Y(grid.rowY(rg.r1 + 1));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return;
  const f = xf.font;
  let size = f.size * k;
  const font: FontSpec = { family: cssFamily(f.name), size, bold: f.bold, italic: f.italic };
  const mono = isMonospaceJa(f.name);
  const meas = (t: string, fs: FontSpec) => (o.measure === estimateMeasure ? estimateWidth(t, fs, mono) : o.measure(t, fs));
  const pad = 1.5 * k;
  const indent = xf.align.indent * 3 * (o.grid.mdw * 0.75) * k;
  let h = xf.align.h;
  if (h === "general") h = o.kind === "n" ? "right" : o.kind === "b" || o.kind === "e" ? "center" : "left";
  if (h === "centerContinuous") h = "center";
  if (h === "fill") h = "left";
  const v = xf.align.v;
  const boxW = x1 - x0 - pad * 2 - indent;
  const vertical = xf.align.rotation === 255;

  if (vertical) {
    const chars = [...o.text.replace(/\n/g, "")];
    const total = chars.length * size;
    const top = v === "top" ? y0 + pad : v === "center" || v === "distributed" || v === "justify" ? y0 + (y1 - y0 - total) / 2 : y1 - pad - total;
    items.push({ k: "text", text: chars.join(""), x: (x0 + x1) / 2, y: Math.max(y0, top), font, color: f.color, vertical: true, clip: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
    return;
  }

  const wrap = xf.align.wrap || h === "justify" || h === "distributed" || v === "justify" || v === "distributed";
  let lines = o.text.split("\n");
  if (xf.align.shrink && !wrap) {
    const w = Math.max(...lines.map((l) => meas(l, font)));
    if (w > boxW && w > 0) {
      size = Math.max(size * 0.3, (size * boxW) / w);
      font.size = size;
    }
  }
  if (wrap && boxW > 0) lines = lines.flatMap((l) => wrapLine(l, boxW, (t) => meas(t, font)));
  const lineH = size * excelLineEm(f.name);
  const totalH = lines.length * lineH;
  let top: number;
  if (v === "top") top = y0 + 0.5 * k;
  else if (v === "center" || v === "justify" || v === "distributed") top = y0 + (y1 - y0 - totalH) / 2;
  else top = y1 - totalH - 0.5 * k;
  // 枠に収まらない字は枠の中で切る。折り返さない字は、隣の空のセルへはみ出してよい（Excel と同じ）
  let clipX0 = x0;
  let clipX1 = x1;
  if (!wrap && o.rg.r0 === o.rg.r1) {
    const w = Math.max(...lines.map((l) => meas(l, font)));
    if (w > boxW) {
      if (h === "left" || h === "center") {
        let c = o.rg.c1 + 1;
        while (c <= o.band.c1 && o.isEmpty(o.row, c) && X(grid.colX(c)) - x0 < w + pad * 2) c++;
        clipX1 = X(grid.colX(Math.min(c, o.band.c1 + 1)));
      }
      if (h === "right" || h === "center") {
        let c = o.rg.c0 - 1;
        while (c >= o.band.c0 && o.isEmpty(o.row, c) && x1 - X(grid.colX(c + 1)) < w + pad * 2) c--;
        clipX0 = X(grid.colX(Math.max(c + 1, o.band.c0)));
      }
    }
  }
  const clip: Box = { x: clipX0, y: y0, w: clipX1 - clipX0, h: y1 - y0 };
  lines.forEach((line, i) => {
    if (line === "") return;
    const base = top + i * lineH + (lineH - size) / 2 + size * 0.88;
    if (h === "distributed" && [...line].length > 1) {
      const chars = [...line];
      const w = meas(line, font);
      const left = x0 + pad + indent;
      const gap = Math.max(0, (boxW - w) / (chars.length - 1));
      const xs: number[] = [];
      let x = left;
      for (const ch of chars) {
        xs.push(x);
        x += meas(ch, font) + gap;
      }
      items.push({ k: "text", text: line, x: left, y: base, font: { ...font }, color: f.color, chars: xs, clip });
      return;
    }
    const x = h === "right" ? x1 - pad - indent : h === "center" ? (x0 + x1) / 2 : x0 + pad + indent;
    items.push({ k: "text", text: line, x, y: base, font: { ...font }, color: f.color, align: h === "right" ? "right" : h === "center" ? "center" : "left", clip, underline: f.underline || undefined });
  });
}

/** 幅に収まるように 1 行を折る（日本語は字ごと、英数字の並びは語で。行頭の句読点は前の行へ） */
/** 行頭に置かない字（前の行の終わりにぶら下げる） */
const HANG = /^[、。，．）」』】〕・ー！？,.)]$/;

export function wrapLine(line: string, width: number, meas: (t: string) => number): string[] {
  if (line === "" || meas(line) <= width) return [line];
  const tokens = line.match(/[A-Za-z0-9.,'’\-_/:%@#$&+=]+|./gu) ?? [line];
  const out: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    const next = cur + tok;
    if (cur !== "" && meas(next) > width && !HANG.test(tok)) {
      out.push(cur);
      cur = tok.trimStart();
    } else cur = next;
    // 1 つの語が幅より長ければ字で切る（行の終わりにぶら下げた句読点 1 字は幅の外でよい）
    while (meas(cur) > width && [...cur].length > 1 && !(HANG.test([...cur].pop() ?? "") && meas([...cur].slice(0, -1).join("")) <= width)) {
      const chars = [...cur];
      let n = chars.length - 1;
      while (n > 1 && meas(chars.slice(0, n).join("")) > width) n--;
      out.push(chars.slice(0, n).join(""));
      cur = chars.slice(n).join("");
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

// ---------------------------------------------------------------- 図形

function lineStrokeOf(spPr: XNode | null, style: XNode | null, theme: Theme): Stroke | null {
  const ln = kid(spPr, "ln");
  if (ln && kid(ln, "noFill")) return null;
  let color: string | null = ln ? drawingColor(kid(ln, "solidFill"), theme) : null;
  let width = ln?.a.w !== undefined ? Number(ln.a.w) * EMU_MM : null;
  if (!color || width === null) {
    const ref = kid(style, "lnRef");
    const idx = num(ref, "idx", 0);
    if (!ln && (!ref || idx === 0)) return null;
    if (!color) color = drawingColor(ref, theme) ?? (ln ? "#000000" : null);
    if (width === null) width = (idx === 0 ? 1 : idx === 1 ? 0.5 : idx === 2 ? 1 : 1.5) * PT_MM;
  }
  if (!color) return null;
  const dashName = kid(ln, "prstDash")?.a.val;
  const w = Math.max(0.1, width);
  const dash =
    dashName === "dash" || dashName === "lgDash" || dashName === "sysDash"
      ? [w * 4, w * 3]
      : dashName === "dot" || dashName === "sysDot"
        ? [w, w * 2]
        : dashName === "dashDot" || dashName === "sysDashDot" || dashName === "lgDashDot"
          ? [w * 4, w * 2, w, w * 2]
          : undefined;
  return { color, width: w, dash };
}

function fillOf(spPr: XNode | null, style: XNode | null, theme: Theme): string | null {
  if (!spPr) return null;
  if (kid(spPr, "noFill")) return null;
  const solid = kid(spPr, "solidFill");
  if (solid) return drawingColor(solid, theme);
  const grad = kid(spPr, "gradFill");
  if (grad) return drawingColor(kids(kid(grad, "gsLst"), "gs")[0], theme);
  const ref = kid(style, "fillRef");
  if (ref && num(ref, "idx", 0) > 0) return drawingColor(ref, theme);
  return null;
}

type Xform = (x: number, y: number) => [number, number];

function drawShapes(
  items: PageItem[],
  shapes: ShapeBox[],
  sheet: SheetData,
  theme: Theme,
  styles: Styles,
  grid: Grid,
  band: Band,
  X: (x: number) => number,
  Y: (y: number) => number,
  k: number,
  measure: Measure,
  vmlText: Map<string, { text: string; size: number | null }>,
  warnings: string[],
) {
  const bx0 = grid.colX(band.c0);
  const bx1 = grid.colX(band.c1 + 1);
  const by0 = grid.rowY(band.r0);
  const by1 = grid.rowY(band.r1 + 1);
  for (const s of shapes) {
    const cx = s.box.x + s.box.w / 2;
    const cy = s.box.y + s.box.h / 2;
    if (cx < bx0 || cx >= bx1 || cy < by0 || cy >= by1) continue;
    const box: Box = { x: X(s.box.x), y: Y(s.box.y), w: s.box.w * k, h: s.box.h * k };
    if (s.kind === "control" && s.control) {
      drawControl(items, s.control, box, vmlText.get(s.control.shapeId), styles, k, measure);
      continue;
    }
    drawNode(items, s.node, box, sheet, theme, k, measure, warnings);
  }
}

function drawControl(
  items: PageItem[],
  ctl: SheetData["controls"][number],
  box: Box,
  label: { text: string; size: number | null } | undefined,
  styles: Styles,
  k: number,
  measure: Measure,
) {
  const type = ctl.type.toLowerCase();
  const fontSize = (label?.size ?? 9) * k;
  const font: FontSpec = { family: cssFamily(styles.defaultFont.name), size: fontSize };
  const text = (label?.text ?? "").replace(/^[:：]\s*/, "");
  if (type === "checkbox" || type === "radio") {
    // Excel のフォームの □ は 13 画素（9.75pt）。枠の高さの真ん中、左の端から 1 画素
    const size = Math.min(9.75 * k * 0.85, box.h);
    const x = box.x + 0.75 * k;
    const y = box.y + (box.h - size) / 2;
    items.push({ k: "check", x, y, size, checked: ctl.checked, round: type === "radio" });
    if (text) items.push({ k: "text", text, x: x + size + 3 * k, y: box.y + box.h / 2 + fontSize * 0.35, font, color: "#000000", clip: { x: box.x, y: box.y, w: box.w, h: box.h } });
  } else if (type === "gbox") {
    items.push({ k: "rect", x: box.x, y: box.y + fontSize / 2, w: box.w, h: box.h - fontSize / 2, stroke: { color: "#000000", width: 0.15 } });
    if (text) items.push({ k: "text", text, x: box.x + 4 * k, y: box.y + fontSize * 0.9, font, color: "#000000" });
  } else if (type === "label" || type === "button") {
    if (type === "button") items.push({ k: "rect", x: box.x, y: box.y, w: box.w, h: box.h, stroke: { color: "#000000", width: 0.15 }, fill: "#EEEEEE" });
    if (text) items.push({ k: "text", text, x: type === "button" ? box.x + box.w / 2 : box.x, y: box.y + box.h / 2 + fontSize * 0.35, font, color: "#000000", align: type === "button" ? "center" : "left", maxWidth: box.w });
  } else if (type === "drop" || type === "list") {
    items.push({ k: "rect", x: box.x, y: box.y, w: box.w, h: box.h, stroke: { color: "#808080", width: 0.15 } });
  }
  void measure;
}

/** 図形 1 つ（グループは中の図形をグループの座標に写して描く） */
function drawNode(items: PageItem[], node: XNode, box: Box, sheet: SheetData, theme: Theme, k: number, measure: Measure, warnings: string[]) {
  if (node.n === "grpSp") {
    const xfrm = path(node, "grpSpPr/xfrm");
    const chOff = kid(xfrm, "chOff");
    const chExt = kid(xfrm, "chExt");
    const ox = num(chOff, "x", 0);
    const oy = num(chOff, "y", 0);
    const ew = num(chExt, "cx", 0) || 1;
    const eh = num(chExt, "cy", 0) || 1;
    const map: Xform = (x, y) => [box.x + ((x - ox) / ew) * box.w, box.y + ((y - oy) / eh) * box.h];
    for (const ch of kids(node)) {
      const nodes = ch.n === "AlternateContent" ? alternate(ch) : [ch];
      for (const c of nodes) {
        if (!["sp", "cxnSp", "grpSp", "pic"].includes(c.n) || isHidden(c)) continue;
        const pr = kid(c, c.n === "grpSp" ? "grpSpPr" : "spPr");
        const xf = kid(pr, "xfrm");
        const off = kid(xf, "off");
        const ext = kid(xf, "ext");
        if (!off || !ext) continue;
        const [x0, y0] = map(num(off, "x", 0), num(off, "y", 0));
        const [x1, y1] = map(num(off, "x", 0) + num(ext, "cx", 0), num(off, "y", 0) + num(ext, "cy", 0));
        drawNode(items, c, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, sheet, theme, k, measure, warnings);
      }
    }
    return;
  }
  if (node.n === "pic") {
    const embed = descendants(node, "blip")[0]?.a.embed;
    const rel = embed ? sheet.drawingRels.get(embed) : undefined;
    if (rel && !rel.external) {
      const item: PageItem = { k: "image", x: box.x, y: box.y, w: box.w, h: box.h, data: new Uint8Array(0), type: "image/png" };
      IMAGE_PART.set(item, rel.target);
      items.push(item);
    }
    return;
  }
  if (node.n === "graphicFrame") {
    warnings.push("chart");
    return;
  }
  const spPr = kid(node, "spPr");
  const style = kid(node, "style");
  const geom = kid(spPr, "prstGeom")?.a.prst ?? (kid(spPr, "custGeom") ? "custom" : "rect");
  const xfrm = kid(spPr, "xfrm");
  const flipH = bool(xfrm, "flipH", false);
  const flipV = bool(xfrm, "flipV", false);
  const stroke = lineStrokeOf(spPr, style, theme);
  const fill = fillOf(spPr, style, theme);
  const { x, y, w, h } = box;
  if (node.n === "cxnSp" || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(geom)) {
    if (stroke) {
      const xa = flipH ? x + w : x;
      const xb = flipH ? x : x + w;
      const ya = flipV ? y + h : y;
      const yb = flipV ? y : y + h;
      items.push({ k: "line", x1: xa, y1: ya, x2: xb, y2: yb, stroke });
    }
  } else if (geom === "ellipse" || geom === "flowChartConnector" || /^wedgeEllipseCallout$/.test(geom)) {
    items.push({ k: "ellipse", cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: fill ?? undefined, stroke: stroke ?? undefined });
  } else if (geom === "bracketPair" || geom === "bracePair" || geom === "leftBracket" || geom === "rightBracket") {
    if (stroke) {
      const r = Math.min(w, h) * 0.1667;
      const left: Array<[number, number]> = [
        [x + r, y],
        [x + r * 0.3, y + r * 0.3],
        [x, y + r],
        [x, y + h - r],
        [x + r * 0.3, y + h - r * 0.3],
        [x + r, y + h],
      ];
      const right: Array<[number, number]> = left.map(([px, py]) => [x + w - (px - x), py]);
      if (geom !== "rightBracket") items.push({ k: "path", points: geom === "leftBracket" ? left.map(([px, py]) => [px + w - r, py]) : left, closed: false, stroke });
      if (geom !== "leftBracket") items.push({ k: "path", points: geom === "rightBracket" ? right.map(([px, py]) => [px - w + r, py]) : right, closed: false, stroke });
    }
  } else if (geom === "triangle" || geom === "rtTriangle") {
    const pts: Array<[number, number]> = geom === "triangle" ? [[x + w / 2, y], [x + w, y + h], [x, y + h]] : [[x, y], [x + w, y + h], [x, y + h]];
    items.push({ k: "path", points: pts, closed: true, fill: fill ?? undefined, stroke: stroke ?? undefined });
  } else if (/Arrow$/.test(geom) && geom !== "rect") {
    items.push({ k: "rect", x, y, w, h, fill: fill ?? undefined, stroke: stroke ?? undefined });
  } else if (fill || stroke) {
    const rounded = /^(roundRect|flowChartAlternateProcess|wedgeRoundRectCallout|snip|round)/.test(geom);
    items.push({ k: "rect", x, y, w, h, fill: fill ?? undefined, stroke: stroke ?? undefined, radius: rounded ? Math.min(w, h) * 0.1667 : undefined });
  }
  const tx = kid(node, "txBody");
  if (tx) shapeText(items, tx, box, theme, k, measure);
}

/** 図形の中の字（DrawingML の txBody） */
export function shapeText(items: PageItem[], tx: XNode, box: Box, theme: Theme, k: number, measure: Measure) {
  const bodyPr = kid(tx, "bodyPr");
  const l = num(bodyPr, "lIns", 91440) * EMU_MM;
  const r = num(bodyPr, "rIns", 91440) * EMU_MM;
  const t = num(bodyPr, "tIns", 45720) * EMU_MM;
  const b = num(bodyPr, "bIns", 45720) * EMU_MM;
  const anchor = bodyPr?.a.anchor ?? "t";
  const vert = bodyPr?.a.vert ?? "horz";
  const wrapNone = bodyPr?.a.wrap === "none";
  // 縮めた倍率（PowerPoint・Excel の自動調整で、字を縮めて保存した物）
  const fontScale = num(kid(bodyPr, "normAutofit"), "fontScale", 100000) / 100000;
  const innerW = Math.max(0, box.w - l - r);
  const innerH = Math.max(0, box.h - t - b);
  type Line = { text: string; font: FontSpec; color: string; align: string; width: number; lineH: number };
  const lines: Line[] = [];
  for (const p of kids(tx, "p")) {
    const pPr = kid(p, "pPr");
    const align = pPr?.a.algn ?? "l";
    let text = "";
    let sizePt = 11;
    let bold = false;
    let color = "#000000";
    let face: string | null = null;
    let first = true;
    for (const run of kids(p)) {
      if (run.n === "r" || run.n === "fld") {
        const rPr = kid(run, "rPr");
        if (first) {
          sizePt = num(rPr, "sz", num(kid(p, "endParaRPr"), "sz", 1100)) / 100;
          bold = bool(rPr, "b", false);
          color = drawingColor(kid(rPr, "solidFill"), theme) ?? "#000000";
          face = kid(rPr, "ea")?.a.typeface ?? kid(rPr, "latin")?.a.typeface ?? null;
          first = false;
        }
        text += textOf(kid(run, "t"));
      } else if (run.n === "br") text += "\n";
    }
    if (first) sizePt = num(kid(p, "endParaRPr"), "sz", 1100) / 100;
    if (face?.startsWith("+")) face = theme.minorEa;
    const font: FontSpec = { family: cssFamily(face ?? theme.minorEa ?? "游ゴシック"), size: sizePt * fontScale * k, bold };
    const lineH = font.size * 1.2;
    for (const seg of text.split("\n")) {
      const wrapped = wrapNone || vert !== "horz" ? [seg] : wrapLine(seg, innerW, (s) => measure(s, font));
      for (const wl of wrapped) lines.push({ text: wl, font, color, align, width: measure(wl, font), lineH });
    }
  }
  if (lines.length === 0) return;
  const clip: Box = { x: box.x, y: box.y, w: box.w, h: box.h };
  if (vert === "eaVert" || vert === "wordArtVertRtl" || vert === "vert") {
    // 縦書き: 右の列から左へ
    let x = box.x + box.w - r;
    for (const ln of lines) {
      x -= ln.lineH;
      if (ln.text) items.push({ k: "text", text: ln.text, x: x + ln.lineH / 2, y: box.y + t, font: ln.font, color: ln.color, vertical: true, clip });
    }
    return;
  }
  const total = lines.reduce((s, ln) => s + ln.lineH, 0);
  let y = anchor === "ctr" ? box.y + t + (innerH - total) / 2 : anchor === "b" ? box.y + box.h - b - total : box.y + t;
  for (const ln of lines) {
    const base = y + (ln.lineH - ln.font.size) / 2 + ln.font.size * 0.88;
    if (ln.text) {
      const align = ln.align === "ctr" ? "center" : ln.align === "r" ? "right" : "left";
      const x = align === "center" ? box.x + l + innerW / 2 : align === "right" ? box.x + box.w - r : box.x + l;
      items.push({ k: "text", text: ln.text, x, y: base, font: ln.font, color: ln.color, align, clip });
    }
    y += ln.lineH;
  }
}
