// Word（.docx・.docm）を、印刷したときの頁の形（page.ts）にする（T119）。ブラウザと Node の両方で動く。
//
// Word の組版は端末の書体と Word の版で変わり、ここで同じにはできない。様式で大事な枠（表）の位置と大きさを先に合わせる:
// - 用紙・余白・文書の行の格子（docGrid の linePitch。日本語の文書は 1 行 18pt が多い）、節（sectPr）ごとの用紙
// - 段落: 書式（標準のスタイル → 段落のスタイル → 直接の書式）、行間（倍数・固定・最小と格子に合わせる）、前後の空き（pt と行）、
//   インデント（字の数の指定も）、揃え（左・中央・右・両端・均等割付）、番号の付いた段落、タブ、改行・改ページ
// - 表: 列の格子（tblGrid）、行の高さ（固定・最小・自動）、セルの結合（gridSpan・vMerge）、罫線（表・セル・表のスタイル）、塗り、
//   セルの余白・縦の揃え・縦書き、入れ子の表、浮いた表（tblpPr）、行が頁に入らなければ次の頁へ
// - 図形（テキストボックス・四角・線・画像）: 頁・余白・段落からの位置（wp:anchor・VML）
// - ヘッダー・フッター（既定と 1 頁目）
// 近づけきれない所（字の幅と行の折り返しの違いで下の段がずれる、段組み、脚注、図形の細かい形、EMF の画像）は docs/progress/t119.md の限界に。
// マクロ（vbaProject.bin）・外部の参照は開かない。

import { DEFAULT_THEME, drawingColor, parseTheme, type Theme } from "./color.ts";
import { cssFamily, estimateWidth, isWide, lineEmOf } from "./fonts.ts";
import { EMU_MM, PT_MM, TWIP_MM, type Box, type FontSpec, type Measure, type OfficePage, type PageItem, type Stroke } from "./page.ts";
import { imageType, readRels, wrapLine } from "./xlsx.ts";
import type { ZipArchive } from "./zip.ts";
import { alternate, bool, kid, kids, num, parseXml, path, textOf, type XNode } from "./xml.ts";

// ---------------------------------------------------------------- 書式

type RunProps = {
  font: string;
  latin: string;
  /** pt */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  vanish: boolean;
  /** 字の幅の倍率（w:w、%） */
  scale: number;
  /** 字の間（pt） */
  spacing: number;
  /** この幅（mm）に収める（w:fitText） */
  fit: number | null;
  /** 文字の網かけ・蛍光ペン（背景） */
  shade: string | null;
};

type ParaProps = {
  jc: string;
  /** mm */
  left: number;
  right: number;
  /** 1 行目の字下げ（ぶら下げは負） mm */
  first: number;
  leftChars: number | null;
  rightChars: number | null;
  firstChars: number | null;
  /** pt */
  before: number;
  after: number;
  beforeLines: number | null;
  afterLines: number | null;
  /** 行間（twips）と規則 */
  line: number;
  lineRule: string;
  snap: boolean;
  pageBreakBefore: boolean;
  keepNext: boolean;
  numId: string | null;
  ilvl: number;
  tabs: Array<{ pos: number; val: string }>;
  shade: string | null;
  borders: { top: Side | null; bottom: Side | null; left: Side | null; right: Side | null };
  contextual: boolean;
  style: string | null;
};

type Side = { val: string; sz: number; color: string; space: number };

const DEFAULT_RUN: RunProps = { font: "ＭＳ 明朝", latin: "Century", size: 10.5, bold: false, italic: false, underline: false, color: "#000000", vanish: false, scale: 100, spacing: 0, fit: null, shade: null };
const DEFAULT_PARA: ParaProps = {
  jc: "left", left: 0, right: 0, first: 0, leftChars: null, rightChars: null, firstChars: null, before: 0, after: 0, beforeLines: null, afterLines: null,
  line: 240, lineRule: "auto", snap: true, pageBreakBefore: false, keepNext: false, numId: null, ilvl: 0, tabs: [], shade: null,
  borders: { top: null, bottom: null, left: null, right: null }, contextual: false, style: null,
};

type Ctx = {
  zip: ZipArchive;
  theme: Theme;
  styles: Map<string, XNode>;
  defaultPara: string | null;
  defaultTable: string | null;
  defaultChar: string | null;
  docRPr: XNode | null;
  docPPr: XNode | null;
  numbering: Numbering;
  rels: Map<string, { type: string; target: string; external: boolean }>;
  compat: number;
  defaultTab: number;
  measure: Measure;
  warnings: string[];
  images: Map<string, Uint8Array | null>;
};

const colorOf = (v: string | undefined, fallback: string): string => (v && /^[0-9A-Fa-f]{6}$/.test(v) ? `#${v.toUpperCase()}` : fallback);

function themeFont(ctx: Ctx, theme: string | undefined): string | null {
  if (!theme) return null;
  if (/EastAsia/i.test(theme)) return /major/i.test(theme) ? (ctx.theme.majorEa ?? ctx.theme.minorEa) : ctx.theme.minorEa;
  return ctx.theme.minorLatin;
}

function applyRPr(ctx: Ctx, base: RunProps, r: XNode | null): RunProps {
  if (!r) return base;
  const out = { ...base };
  const f = kid(r, "rFonts");
  if (f) {
    const ea = f.a.eastAsia ?? themeFont(ctx, f.a.eastAsiaTheme);
    if (ea) out.font = ea;
    const latin = f.a.ascii ?? themeFont(ctx, f.a.asciiTheme);
    if (latin) out.latin = latin;
  }
  const sz = kid(r, "sz");
  if (sz) out.size = num(sz, "val", base.size * 2) / 2;
  const b = kid(r, "b");
  if (b) out.bold = bool(b, "val", true);
  const i = kid(r, "i");
  if (i) out.italic = bool(i, "val", true);
  const u = kid(r, "u");
  if (u) out.underline = (u.a.val ?? "single") !== "none";
  const c = kid(r, "color");
  if (c) out.color = c.a.val === "auto" ? "#000000" : colorOf(c.a.val, out.color);
  const v = kid(r, "vanish");
  if (v) out.vanish = bool(v, "val", true);
  const w = kid(r, "w");
  if (w) out.scale = num(w, "val", 100);
  const sp = kid(r, "spacing");
  if (sp) out.spacing = num(sp, "val", 0) / 20;
  const fit = kid(r, "fitText");
  if (fit) out.fit = num(fit, "val", 0) * TWIP_MM;
  const shd = kid(r, "shd");
  const hl = kid(r, "highlight");
  if (shd?.a.fill && shd.a.fill !== "auto") out.shade = colorOf(shd.a.fill, "#FFFFFF");
  else if (hl?.a.val && hl.a.val !== "none") out.shade = HIGHLIGHT[hl.a.val] ?? null;
  return out;
}

const HIGHLIGHT: Record<string, string> = { yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF", lightGray: "#C0C0C0", darkGray: "#808080", red: "#FF0000" };

function sideOf(x: XNode | null): Side | null {
  if (!x) return null;
  const val = x.a.val ?? "single";
  if (val === "nil" || val === "none") return { val: "none", sz: 0, color: "#000000", space: 0 };
  return { val, sz: num(x, "sz", 4) / 8, color: x.a.color && x.a.color !== "auto" ? colorOf(x.a.color, "#000000") : "#000000", space: num(x, "space", 0) };
}

function applyPPr(base: ParaProps, p: XNode | null): ParaProps {
  if (!p) return base;
  const out = { ...base, borders: { ...base.borders } };
  const jc = kid(p, "jc");
  if (jc?.a.val) out.jc = jc.a.val;
  const ind = kid(p, "ind");
  if (ind) {
    const l = ind.a.left ?? ind.a.start;
    if (l !== undefined) out.left = Number(l) * TWIP_MM;
    const r = ind.a.right ?? ind.a.end;
    if (r !== undefined) out.right = Number(r) * TWIP_MM;
    if (ind.a.firstLine !== undefined) out.first = Number(ind.a.firstLine) * TWIP_MM;
    if (ind.a.hanging !== undefined) out.first = -Number(ind.a.hanging) * TWIP_MM;
    if (ind.a.leftChars !== undefined || ind.a.startChars !== undefined) out.leftChars = Number(ind.a.leftChars ?? ind.a.startChars);
    if (ind.a.rightChars !== undefined || ind.a.endChars !== undefined) out.rightChars = Number(ind.a.rightChars ?? ind.a.endChars);
    if (ind.a.firstLineChars !== undefined) out.firstChars = Number(ind.a.firstLineChars);
    if (ind.a.hangingChars !== undefined) out.firstChars = -Number(ind.a.hangingChars);
  }
  const sp = kid(p, "spacing");
  if (sp) {
    if (sp.a.before !== undefined) out.before = Number(sp.a.before) / 20;
    if (sp.a.after !== undefined) out.after = Number(sp.a.after) / 20;
    if (sp.a.beforeLines !== undefined) out.beforeLines = Number(sp.a.beforeLines);
    if (sp.a.afterLines !== undefined) out.afterLines = Number(sp.a.afterLines);
    if (sp.a.line !== undefined) out.line = Number(sp.a.line);
    if (sp.a.lineRule !== undefined) out.lineRule = sp.a.lineRule;
    else if (sp.a.line !== undefined) out.lineRule = "auto";
  }
  const snap = kid(p, "snapToGrid");
  if (snap) out.snap = bool(snap, "val", true);
  const pb = kid(p, "pageBreakBefore");
  if (pb) out.pageBreakBefore = bool(pb, "val", true);
  const kn = kid(p, "keepNext");
  if (kn) out.keepNext = bool(kn, "val", true);
  const np = kid(p, "numPr");
  if (np) {
    const id = kid(np, "numId")?.a.val;
    if (id !== undefined) out.numId = id === "0" ? null : id;
    const lv = kid(np, "ilvl")?.a.val;
    if (lv !== undefined) out.ilvl = Number(lv);
  }
  const tabs = kid(p, "tabs");
  if (tabs) {
    const list = [...out.tabs];
    for (const t of kids(tabs, "tab")) {
      const pos = num(t, "pos", 0) * TWIP_MM;
      const i = list.findIndex((x) => Math.abs(x.pos - pos) < 0.01);
      if (t.a.val === "clear") {
        if (i >= 0) list.splice(i, 1);
      } else if (i >= 0) list[i] = { pos, val: t.a.val ?? "left" };
      else list.push({ pos, val: t.a.val ?? "left" });
    }
    out.tabs = list.sort((a, b) => a.pos - b.pos);
  }
  const shd = kid(p, "shd");
  if (shd?.a.fill && shd.a.fill !== "auto") out.shade = colorOf(shd.a.fill, "#FFFFFF");
  const bdr = kid(p, "pBdr");
  if (bdr) for (const s of ["top", "bottom", "left", "right"] as const) if (kid(bdr, s)) out.borders[s] = sideOf(kid(bdr, s));
  const cs = kid(p, "contextualSpacing");
  if (cs) out.contextual = bool(cs, "val", true);
  const ps = kid(p, "pStyle");
  if (ps?.a.val) out.style = ps.a.val;
  return out;
}

/** スタイルの継承の並び（親から子へ） */
function styleChain(ctx: Ctx, id: string | null): XNode[] {
  const out: XNode[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const s = ctx.styles.get(cur);
    if (!s) break;
    out.unshift(s);
    cur = kid(s, "basedOn")?.a.val ?? null;
  }
  return out;
}

type TableStyle = { rPr: XNode[]; pPr: XNode[]; tblPr: XNode[]; tcPr: XNode[] };

function tableStyleOf(ctx: Ctx, id: string | null): TableStyle {
  const chain = styleChain(ctx, id ?? ctx.defaultTable);
  return {
    rPr: chain.map((s) => kid(s, "rPr")).filter((x): x is XNode => !!x),
    pPr: chain.map((s) => kid(s, "pPr")).filter((x): x is XNode => !!x),
    tblPr: chain.map((s) => kid(s, "tblPr")).filter((x): x is XNode => !!x),
    tcPr: chain.map((s) => kid(s, "tcPr")).filter((x): x is XNode => !!x),
  };
}

function paraProps(ctx: Ctx, p: XNode, table: TableStyle | null): { para: ParaProps; run: RunProps } {
  let para = applyPPr(DEFAULT_PARA, ctx.docPPr);
  let run = applyRPr(ctx, DEFAULT_RUN, ctx.docRPr);
  if (table) {
    for (const x of table.pPr) para = applyPPr(para, x);
    for (const x of table.rPr) run = applyRPr(ctx, run, x);
  }
  const pPr = kid(p, "pPr");
  const styleId = kid(pPr, "pStyle")?.a.val ?? ctx.defaultPara;
  for (const s of styleChain(ctx, styleId)) {
    para = applyPPr(para, kid(s, "pPr"));
    run = applyRPr(ctx, run, kid(s, "rPr"));
  }
  para = applyPPr(para, pPr);
  para.style = styleId;
  return { para, run };
}

function runProps(ctx: Ctx, base: RunProps, r: XNode): RunProps {
  const rPr = kid(r, "rPr");
  let out = base;
  const cs = kid(rPr, "rStyle")?.a.val;
  for (const s of styleChain(ctx, cs ?? null)) out = applyRPr(ctx, out, kid(s, "rPr"));
  return applyRPr(ctx, out, rPr);
}

// ---------------------------------------------------------------- 番号

type Numbering = { nums: Map<string, { abs: XNode | null; overrides: Map<number, XNode> }>; counters: Map<string, number[]> };

function readNumbering(root: XNode | null): Numbering {
  const abs = new Map<string, XNode>();
  for (const a of kids(root, "abstractNum")) if (a.a.abstractNumId !== undefined) abs.set(a.a.abstractNumId, a);
  const nums = new Map<string, { abs: XNode | null; overrides: Map<number, XNode> }>();
  for (const n of kids(root, "num")) {
    const id = n.a.numId;
    if (id === undefined) continue;
    const overrides = new Map<number, XNode>();
    for (const o of kids(n, "lvlOverride")) {
      const lvl = kid(o, "lvl");
      if (lvl) overrides.set(num(o, "ilvl", 0), lvl);
    }
    nums.set(id, { abs: abs.get(kid(n, "abstractNumId")?.a.val ?? "") ?? null, overrides });
  }
  return { nums, counters: new Map() };
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const AIUEO = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const IROHA = "イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス";
const KANJI = "〇一二三四五六七八九十";
const KOU = "甲乙丙丁戊己庚辛壬癸";

function formatNumber(n: number, fmt: string): string {
  const full = (s: string) => s.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  const roman = (v: number) => {
    const t: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let s = "";
    for (const [k, r] of t) while (v >= k) {
      s += r;
      v -= k;
    }
    return s;
  };
  switch (fmt) {
    case "decimalFullWidth":
    case "decimalFullWidth2":
      return full(String(n));
    case "decimalEnclosedCircle":
    case "decimalEnclosedCircleChinese":
      return CIRCLED[n - 1] ?? String(n);
    case "upperLetter":
      return String.fromCharCode(64 + (((n - 1) % 26) + 1));
    case "lowerLetter":
      return String.fromCharCode(96 + (((n - 1) % 26) + 1));
    case "upperRoman":
      return roman(n);
    case "lowerRoman":
      return roman(n).toLowerCase();
    case "aiueoFullWidth":
    case "aiueo":
      return AIUEO[n - 1] ?? String(n);
    case "irohaFullWidth":
    case "iroha":
      return IROHA[n - 1] ?? String(n);
    case "japaneseCounting":
    case "japaneseDigitalTenThousand":
      return n <= 10 ? KANJI[n] : n < 20 ? `十${KANJI[n - 10]}` : String(n);
    case "ideographTraditional":
      return KOU[n - 1] ?? String(n);
    case "none":
      return "";
    default:
      return String(n);
  }
}

function numberText(ctx: Ctx, numId: string, ilvl: number): { text: string; lvl: XNode | null } {
  const def = ctx.numbering.nums.get(numId);
  if (!def) return { text: "", lvl: null };
  const lvlOf = (i: number) => def.overrides.get(i) ?? kids(def.abs, "lvl").find((l) => num(l, "ilvl", 0) === i) ?? null;
  const lvl = lvlOf(ilvl);
  if (!lvl) return { text: "", lvl: null };
  const key = def.abs?.a.abstractNumId ?? numId;
  const counters = ctx.numbering.counters.get(key) ?? [];
  for (let i = 0; i <= ilvl; i++) if (counters[i] === undefined) counters[i] = num(kid(lvlOf(i), "start"), "val", 1) - 1;
  counters[ilvl] += 1;
  for (let i = ilvl + 1; i < 9; i++) counters[i] = undefined as unknown as number;
  ctx.numbering.counters.set(key, counters);
  const fmt = kid(lvl, "numFmt")?.a.val ?? "decimal";
  let text = kid(lvl, "lvlText")?.a.val ?? "";
  if (fmt === "bullet") return { text: text || "・", lvl };
  text = text.replace(/%(\d)/g, (_, d: string) => {
    const i = Number(d) - 1;
    const l = lvlOf(i);
    return formatNumber(counters[i] ?? 1, i === ilvl ? fmt : (kid(l, "numFmt")?.a.val ?? "decimal"));
  });
  return { text, lvl };
}

// ---------------------------------------------------------------- 節

type Section = {
  w: number;
  h: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
  /** 行の格子（mm）。無ければ null */
  pitch: number | null;
  titlePg: boolean;
  headers: Map<string, string>;
  footers: Map<string, string>;
};

function sectionOf(x: XNode | null, ctx: Ctx): Section {
  const sz = kid(x, "pgSz");
  const mar = kid(x, "pgMar");
  let w = num(sz, "w", 11906) * TWIP_MM;
  let h = num(sz, "h", 16838) * TWIP_MM;
  if (sz?.a.orient === "landscape" && w < h) [w, h] = [h, w];
  const grid = kid(x, "docGrid");
  const type = grid?.a.type ?? "default";
  const headers = new Map<string, string>();
  const footers = new Map<string, string>();
  for (const r of kids(x, "headerReference")) if (r.a.id && ctx.rels.get(r.a.id)) headers.set(r.a.type ?? "default", ctx.rels.get(r.a.id)!.target);
  for (const r of kids(x, "footerReference")) if (r.a.id && ctx.rels.get(r.a.id)) footers.set(r.a.type ?? "default", ctx.rels.get(r.a.id)!.target);
  return {
    w,
    h,
    top: Math.abs(num(mar, "top", 1985)) * TWIP_MM,
    bottom: Math.abs(num(mar, "bottom", 1701)) * TWIP_MM,
    left: num(mar, "left", 1701) * TWIP_MM,
    right: num(mar, "right", 1701) * TWIP_MM,
    header: num(mar, "header", 851) * TWIP_MM,
    footer: num(mar, "footer", 992) * TWIP_MM,
    pitch: type === "lines" || type === "linesAndChars" || type === "snapToChars" ? num(grid, "linePitch", 360) * TWIP_MM : null,
    titlePg: bool(kid(x, "titlePg"), "val", !!kid(x, "titlePg")),
    headers,
    footers,
  };
}

// ---------------------------------------------------------------- 組版の中身

/** 行に置く物 1 つ（字の塊・タブ・画像・図形の箱） */
type Piece =
  | { k: "text"; text: string; props: RunProps; width: number }
  | { k: "tab" }
  /** 改ページ（hard: w:br の改ページ、ほか: Word が前に保存したときの頁の切れ目 lastRenderedPageBreak） */
  | { k: "brk"; hard: boolean }
  | { k: "box"; w: number; h: number; draw: (x: number, y: number) => PageItem[] };

type Line = { pieces: Array<{ piece: Piece; x: number; w: number }>; width: number; ascent: number; height: number; natural: number; last: boolean; breakBefore: boolean };

type Flow = {
  ctx: Ctx;
  sec: Section;
  /** 今の頁の項目 */
  items: PageItem[];
  pages: OfficePage[];
  y: number;
  /** 本文の上と下（mm） */
  top: number;
  bottom: number;
  /** 段落の前の空きを、頁の頭で落とすか */
  pageTop: boolean;
  /** 前の段落の後の空き（次の段落の前の空きと大きい方だけ。Word は足す。合わせて足す） */
  floats: PageItem[];
  maxPages: number;
  /** 頁の下を越えてよい長さ（mm）。Word が保存した頁の切れ目がある文書は、切れ目を正にして少しの食み出しは次の頁に送らない */
  slack: number;
};

function fontSpec(p: RunProps, sizeMul = 1): FontSpec {
  return { family: cssFamily(p.font), size: p.size * PT_MM * sizeMul, bold: p.bold, italic: p.italic };
}

function measureText(ctx: Ctx, text: string, p: RunProps): number {
  const f = fontSpec(p);
  let w = 0;
  // 和文と欧文で書体を分けて測る
  let cur = "";
  let wide: boolean | null = null;
  const flush = () => {
    if (!cur) return;
    w += ctx.measure(cur, wide ? f : { ...f, family: cssFamily(p.latin) });
    cur = "";
  };
  for (const ch of text) {
    const isW = isWide(ch.codePointAt(0)!);
    if (wide !== null && isW !== wide) flush();
    wide = isW;
    cur += ch;
  }
  flush();
  return (w * p.scale) / 100 + [...text].length * p.spacing * PT_MM;
}

/** 段落の中身を、置く物の並びに */
function collectPieces(ctx: Ctx, p: XNode, base: RunProps, anchors: XNode[], out: Piece[], inField = { skip: false }): void {
  for (const k of kids(p)) {
    switch (k.n) {
      case "r": {
        const props = runProps(ctx, base, k);
        for (const c of kids(k)) {
          if (c.n === "fldChar") {
            const t = c.a.fldCharType;
            if (t === "begin") inField.skip = true;
            else if (t === "separate" || t === "end") inField.skip = false;
            continue;
          }
          if (inField.skip || props.vanish) continue;
          if (c.n === "t") out.push({ k: "text", text: textOf(c), props, width: 0 });
          else if (c.n === "tab" || c.n === "ptab") out.push({ k: "tab" });
          else if (c.n === "br" || c.n === "cr") {
            if (c.a.type === "page") out.push({ k: "brk", hard: true });
            else out.push({ k: "text", text: "\n", props, width: 0 });
          } else if (c.n === "sym") {
            const code = parseInt(c.a.char ?? "", 16);
            if (Number.isFinite(code)) out.push({ k: "text", text: symbolChar(code, c.a.font ?? ""), props, width: 0 });
          } else if (c.n === "lastRenderedPageBreak") out.push({ k: "brk", hard: false });
          else if (c.n === "noBreakHyphen") out.push({ k: "text", text: "-", props, width: 0 });
          else if (c.n === "drawing") {
            for (const d of kids(c)) {
              if (d.n === "anchor") anchors.push(d);
              else if (d.n === "inline") out.push(inlineBox(ctx, d));
            }
          } else if (c.n === "pict" || c.n === "object") {
            for (const v of kids(c)) if (isVmlShape(v)) anchors.push(v);
          } else if (c.n === "AlternateContent") {
            for (const a of alternate(c)) {
              if (a.n === "drawing") for (const d of kids(a)) d.n === "anchor" ? anchors.push(d) : d.n === "inline" ? out.push(inlineBox(ctx, d)) : null;
              else if (a.n === "pict") for (const v of kids(a)) if (isVmlShape(v)) anchors.push(v);
            }
          } else if (c.n === "ruby") {
            const baseText = textOf(path(c, "rubyBase"));
            if (baseText) out.push({ k: "text", text: baseText, props, width: 0 });
          }
        }
        break;
      }
      case "fldSimple":
      case "hyperlink":
      case "smartTag":
      case "customXml":
      case "ins":
      case "moveTo":
        collectPieces(ctx, k, base, anchors, out, inField);
        break;
      case "sdt":
        collectPieces(ctx, kid(k, "sdtContent") ?? k, base, anchors, out, inField);
        break;
      case "AlternateContent":
        for (const a of alternate(k)) collectPieces(ctx, { n: "p", a: {}, c: [a] }, base, anchors, out, inField);
        break;
      default:
        break;
    }
  }
}

/** Wingdings などの記号（よく使う □・○・レ点だけ） */
function symbolChar(code: number, font: string): string {
  const c = code >= 0xf000 ? code - 0xf000 : code;
  if (/wingdings/i.test(font)) {
    const map: Record<number, string> = { 0x6f: "□", 0xa8: "□", 0x6e: "■", 0xfe: "☑", 0xfd: "☒", 0x6c: "●", 0xa1: "○", 0x9f: "・", 0xfc: "✓" };
    return map[c] ?? "□";
  }
  return String.fromCodePoint(c);
}

const isVmlShape = (v: XNode) => ["rect", "roundrect", "line", "oval", "shape", "group", "polyline"].includes(v.n);

function inlineBox(ctx: Ctx, d: XNode): Piece {
  const ext = kid(d, "extent");
  const w = num(ext, "cx", 0) * EMU_MM;
  const h = num(ext, "cy", 0) * EMU_MM;
  return {
    k: "box",
    w,
    h,
    draw: (x, y) => graphicItems(ctx, d, { x, y, w, h }),
  };
}

/** 段落を行に分ける */
function breakLines(ctx: Ctx, pieces: Piece[], firstWidth: number, width: number, para: ParaProps, base: RunProps, left0: number): Line[] {
  const lines: Line[] = [];
  let cur: Line = { pieces: [], width: 0, ascent: 0, height: 0, natural: 0, last: false, breakBefore: false };
  let avail = firstWidth;
  const lineMetrics = (p: RunProps) => {
    const em = lineEmOf(p.font);
    return { h: p.size * PT_MM * em, a: p.size * PT_MM * (0.88 + (em - 1.0) / 2) };
  };
  const push = (piece: Piece, w: number) => {
    cur.pieces.push({ piece, x: cur.width, w });
    cur.width += w;
    if (piece.k === "text") {
      const m = lineMetrics(piece.props);
      cur.natural = Math.max(cur.natural, m.h);
      cur.ascent = Math.max(cur.ascent, m.a);
    } else if (piece.k === "box") {
      cur.natural = Math.max(cur.natural, piece.h);
      cur.ascent = Math.max(cur.ascent, piece.h);
    }
  };
  const newLine = () => {
    if (cur.natural === 0) {
      const m = lineMetrics(base);
      cur.natural = m.h;
      cur.ascent = m.a;
    }
    lines.push(cur);
    cur = { pieces: [], width: 0, ascent: 0, height: 0, natural: 0, last: false, breakBefore: false };
    avail = width;
  };
  for (const piece of pieces) {
    if (piece.k === "brk") {
      // 改ページ: 字の途中なら行を終え、次の行の前で頁を変える
      if (cur.pieces.length > 0) newLine();
      cur.breakBefore = true;
      continue;
    }
    if (piece.k === "tab") {
      // 次のタブ位置（段落の左の端から）。既定のタブは defaultTab の倍数
      const at = cur.width + (lines.length === 0 ? left0 : 0);
      const stop = para.tabs.find((t) => t.pos > at + 0.1 && t.val !== "clear");
      const next = stop ? stop.pos : (Math.floor(at / ctx.defaultTab) + 1) * ctx.defaultTab;
      const w = Math.max(0, next - at);
      if (cur.width + w > avail + 0.1 && cur.pieces.length > 0) newLine();
      else push(piece, w);
      continue;
    }
    if (piece.k === "box") {
      if (cur.width + piece.w > avail + 0.1 && cur.pieces.length > 0) newLine();
      push(piece, piece.w);
      continue;
    }
    const props = piece.props;
    const parts = piece.text.split(/(\n)/);
    for (const part of parts) {
      if (part === "\n") {
        newLine();
        continue;
      }
      if (!part) continue;
      if (props.fit && props.fit > 0) {
        // 字の幅を指定の幅に（均等割付の 1 つ）
        if (cur.width + props.fit > avail + 0.1 && cur.pieces.length > 0) newLine();
        push({ k: "text", text: part, props, width: props.fit }, props.fit);
        continue;
      }
      let rest = part;
      while (rest) {
        const room = avail - cur.width;
        const w = measureText(ctx, rest, props);
        if (w <= room + 0.05) {
          push({ k: "text", text: rest, props, width: w }, w);
          break;
        }
        // 行の終わりの空白（全角の空白も）は折り返さずにはみ出させる（Word と同じ。様式の「氏名　　　　」で行が増えない）
        const trimmed = rest.replace(/[\s　]+$/u, "");
        if (trimmed.length < rest.length && measureText(ctx, trimmed, props) <= room + 0.05) {
          const tw = measureText(ctx, trimmed, props);
          push({ k: "text", text: rest, props, width: Math.max(tw, Math.min(w, room)) }, Math.max(tw, Math.min(w, room)));
          break;
        }
        // 入る所まで（行頭の句読点は前の行へ）
        const wrapped = wrapLine(rest, Math.max(0.1, room), (t) => measureText(ctx, t, props));
        let head = wrapped[0];
        if (measureText(ctx, head, props) > room + 0.05) {
          if (cur.pieces.length > 0) {
            newLine();
            continue;
          }
          // 1 字も入らない幅: 1 字ずつ
          head = [...rest][0];
        }
        const hw = measureText(ctx, head, props);
        push({ k: "text", text: head, props, width: hw }, hw);
        rest = rest.slice(head.length);
        if (rest) newLine();
      }
    }
  }
  if (cur.natural === 0) {
    const m = lineMetrics(base);
    cur.natural = m.h;
    cur.ascent = m.a;
  }
  cur.last = true;
  // 段落の終わりの改ページ（次の段落・表から次の頁）: 空の行を足さずに印だけ残す
  if (cur.pieces.length === 0 && cur.breakBefore && lines.length > 0) {
    lines[lines.length - 1].last = true;
    (lines as Line[] & { trailingBreak?: boolean }).trailingBreak = true;
    return lines;
  }
  lines.push(cur);
  return lines;
}

/** 行の高さ（mm）。倍数は格子に合わせる */
function lineHeight(line: Line, para: ParaProps, pitch: number | null): number {
  const rule = para.lineRule;
  if (rule === "exact") return Math.abs(para.line) * TWIP_MM;
  if (rule === "atLeast") return Math.max(line.natural, para.line * TWIP_MM);
  const mul = para.line / 240;
  if (pitch && para.snap) {
    // 格子: 1 行の高さが格子の何本分かで決まり、倍数を掛ける
    const n = Math.max(1, Math.ceil(line.natural / pitch - 0.02));
    return n * pitch * mul;
  }
  return line.natural * mul;
}

function charUnit(run: RunProps): number {
  return run.size * PT_MM;
}

/** 段落の前後の空き（mm） */
function spaceOf(para: ParaProps, which: "before" | "after", pitch: number | null): number {
  const lines = which === "before" ? para.beforeLines : para.afterLines;
  if (lines !== null) return (lines / 100) * (pitch ?? 15.6 * PT_MM);
  return (which === "before" ? para.before : para.after) * PT_MM;
}

// ---------------------------------------------------------------- 段落・表・頁

type Area = { x: number; w: number };

function newPage(f: Flow) {
  finishPage(f);
  f.y = f.top;
  f.pageTop = true;
}

function finishPage(f: Flow) {
  if (f.pages.length >= f.maxPages) return;
  f.pages.push({ w: f.sec.w, h: f.sec.h, items: [...f.floats.filter((x) => (x as PageItem & { behind?: boolean }).behind), ...f.items, ...f.floats.filter((x) => !(x as PageItem & { behind?: boolean }).behind)], sheet: null, page: f.pages.length + 1 });
  f.items = [];
  f.floats = [];
}

/** 段落を置く。mode が "measure" なら置かずに高さだけ返す（表のセルの高さを測る） */
function layoutParagraph(f: Flow, p: XNode, area: Area, table: TableStyle | null, opts: { measure?: boolean; inCell?: boolean; prevAfter?: number; first?: boolean } = {}): { height: number; after: number } {
  const ctx = f.ctx;
  const { para, run } = paraProps(ctx, p, table);
  const pitch = f.sec.pitch;
  const cu = charUnit(run);
  const left = para.leftChars !== null ? (para.leftChars / 100) * cu : para.left;
  const right = para.rightChars !== null ? (para.rightChars / 100) * cu : para.right;
  let first = para.firstChars !== null ? (para.firstChars / 100) * cu : para.first;
  const anchors: XNode[] = [];
  const pieces: Piece[] = [];
  // 番号
  if (para.numId) {
    const nt = numberText(ctx, para.numId, para.ilvl);
    if (nt.text) {
      const lvlPPr = kid(nt.lvl, "pPr");
      const lp = applyPPr(para, lvlPPr);
      if (kid(lvlPPr, "ind")) first = lp.first;
      const numRun = applyRPr(ctx, run, kid(nt.lvl, "rPr"));
      pieces.push({ k: "text", text: nt.text, props: numRun, width: 0 });
      const suff = kid(nt.lvl, "suff")?.a.val ?? "tab";
      if (suff === "tab") pieces.push({ k: "tab" });
      else if (suff === "space") pieces.push({ k: "text", text: " ", props: numRun, width: 0 });
    }
  }
  collectPieces(ctx, p, run, anchors, pieces);
  const sectBreak = !!kid(kid(p, "pPr"), "sectPr");
  if (!opts.measure && para.pageBreakBefore && !f.pageTop) newPage(f);

  const width = Math.max(1, area.w - left - right);
  const lines = breakLines(ctx, pieces, Math.max(1, width - first), width, para, run, left + first);
  let before = spaceOf(para, "before", pitch);
  const after = spaceOf(para, "after", pitch);
  // 頁の頭とセルの頭では前の空きを落とさない（Word は頁の頭の空きを落とすのは改ページの後だけ）。前の段落の後の空きと重ねる
  if (opts.prevAfter !== undefined && para.contextual) before = 0;
  let height = before;
  const heights = lines.map((ln) => lineHeight(ln, para, opts.inCell ? pitch : pitch));
  height += heights.reduce((s, h) => s + h, 0);
  if (opts.measure) return { height: height + after, after };

  // 置く（1 行目の前の改ページは前の空きより先に）
  if (lines[0]?.breakBefore && !f.pageTop && !opts.inCell) newPage(f);
  if (lines[0]) lines[0].breakBefore = false;
  f.y += before;
  const paraTop = f.y;
  lines.forEach((ln, i) => {
    const h = heights[i];
    if (!opts.inCell && !f.pageTop && (ln.breakBefore || f.y + h > f.bottom + f.slack + 0.01)) newPage(f);
    const x0 = area.x + left + (i === 0 ? first : 0);
    const avail = width - (i === 0 ? first : 0);
    const free = avail - ln.width;
    let dx = 0;
    let gap = 0;
    const textPieces = ln.pieces.filter((x) => x.piece.k === "text");
    const chars = textPieces.reduce((s, x) => s + [...(x.piece as { text: string }).text].length, 0);
    if (para.jc === "center") dx = free / 2;
    else if (para.jc === "right" || para.jc === "end") dx = free;
    else if ((para.jc === "distribute" || (para.jc === "both" && !ln.last)) && chars > 1 && free > 0 && !ln.pieces.some((x) => x.piece.k === "tab")) gap = free / (chars - 1);
    // 行の中の字の基準線: 行の高さの中で字を下に寄せる（Word は格子の行で字を真ん中より少し下に置く）
    const base = f.y + (h - ln.natural) / 2 + ln.ascent;
    let shift = 0;
    for (const pc of ln.pieces) {
      const x = x0 + dx + pc.x + shift;
      if (pc.piece.k === "text") {
        const t = pc.piece.text;
        const props = pc.piece.props;
        if (props.shade) f.items.push({ k: "rect", x, y: f.y + (h - ln.natural) / 2, w: pc.w + gap * [...t].length, h: ln.natural, fill: props.shade });
        const font = fontSpec(props);
        if (gap > 0 || props.fit || props.spacing || props.scale !== 100) {
          const cs = [...t];
          const per = props.fit ? 0 : 0;
          const natural = measureText(ctx, t, { ...props, spacing: 0, scale: 100 });
          const extra = props.fit && cs.length > 1 ? (props.fit - natural) / (cs.length - 1) : 0;
          const xs: number[] = [];
          let cx = x;
          for (const ch of cs) {
            xs.push(cx);
            cx += measureText(ctx, ch, props) + gap + extra + per;
          }
          f.items.push({ k: "text", text: t, x, y: base, font, color: props.color, chars: xs });
          shift += gap * cs.length;
        } else f.items.push({ k: "text", text: t, x, y: base, font, color: props.color, underline: props.underline || undefined });
      } else if (pc.piece.k === "box") {
        f.items.push(...pc.piece.draw(x, base - pc.piece.h));
      }
    }
    f.y += h;
    f.pageTop = false;
  });
  // 段落の枠と網かけ（枠の中の字の上下の空きは space の pt）
  const b = para.borders;
  if (b.top || b.bottom || b.left || b.right || para.shade) {
    const x0 = area.x + left;
    const x1 = area.x + area.w - right;
    if (para.shade) f.items.unshift({ k: "rect", x: x0, y: paraTop, w: x1 - x0, h: f.y - paraTop, fill: para.shade });
    const line = (s: Side | null, x1_: number, y1: number, x2: number, y2: number) => {
      if (s && s.val !== "none") f.items.push({ k: "line", x1: x1_, y1, x2, y2, stroke: strokeOf(s) });
    };
    line(b.top, x0, paraTop - (b.top?.space ?? 0) * PT_MM, x1, paraTop - (b.top?.space ?? 0) * PT_MM);
    line(b.bottom, x0, f.y + (b.bottom?.space ?? 0) * PT_MM, x1, f.y + (b.bottom?.space ?? 0) * PT_MM);
    line(b.left, x0 - (b.left?.space ?? 0) * PT_MM, paraTop, x0 - (b.left?.space ?? 0) * PT_MM, f.y);
    line(b.right, x1 + (b.right?.space ?? 0) * PT_MM, paraTop, x1 + (b.right?.space ?? 0) * PT_MM, f.y);
  }
  // 浮いた図形（段落の位置から）
  for (const a of anchors) placeAnchor(f, a, paraTop, area);
  f.y += after;
  if ((lines as Line[] & { trailingBreak?: boolean }).trailingBreak && !opts.inCell) newPage(f);
  void sectBreak;
  return { height: f.y - paraTop + before, after };
}

function strokeOf(s: Side): Stroke {
  const w = Math.max(0.1, s.sz * PT_MM);
  const dash =
    s.val === "dotted"
      ? [w, w * 1.5]
      : s.val === "dashed" || s.val === "dashSmallGap"
        ? [w * 4, w * 2]
        : s.val === "dotDash"
          ? [w * 4, w * 2, w, w * 2]
          : s.val === "dotDotDash"
            ? [w * 4, w * 2, w, w * 2, w, w * 2]
            : undefined;
  return { color: s.color, width: s.val === "double" ? w : w, dash };
}

// ---- 表

type CellLayout = {
  node: XNode;
  col: number;
  span: number;
  /** 縦の結合: start（始め）・cont（続き）・none */
  vm: "start" | "cont" | "none";
  rowSpan: number;
  tcPr: XNode | null;
  height: number;
};

type TableBorders = { top: Side | null; bottom: Side | null; left: Side | null; right: Side | null; insideH: Side | null; insideV: Side | null };

function bordersOf(x: XNode | null, base: TableBorders): TableBorders {
  if (!x) return base;
  const out = { ...base };
  for (const s of ["top", "bottom", "left", "right", "insideH", "insideV"] as const) {
    const n = kid(x, s) ?? (s === "left" ? kid(x, "start") : s === "right" ? kid(x, "end") : null);
    if (n) out[s] = sideOf(n);
  }
  return out;
}

function marginsOf(x: XNode | null, base: { t: number; b: number; l: number; r: number }) {
  if (!x) return base;
  const v = (n: XNode | null, d: number) => (n && (n.a.type ?? "dxa") === "dxa" ? num(n, "w", d / TWIP_MM) * TWIP_MM : d);
  return { t: v(kid(x, "top"), base.t), b: v(kid(x, "bottom"), base.b), l: v(kid(x, "left") ?? kid(x, "start"), base.l), r: v(kid(x, "right") ?? kid(x, "end"), base.r) };
}

function layoutTable(f: Flow, tbl: XNode, area: Area, opts: { measure?: boolean; inCell?: boolean } = {}): number {
  const ctx = f.ctx;
  const tblPr = kid(tbl, "tblPr");
  const style = tableStyleOf(ctx, kid(tblPr, "tblStyle")?.a.val ?? null);
  let borders: TableBorders = { top: null, bottom: null, left: null, right: null, insideH: null, insideV: null };
  for (const s of style.tblPr) borders = bordersOf(kid(s, "tblBorders"), borders);
  borders = bordersOf(kid(tblPr, "tblBorders"), borders);
  let mar = { t: 0, b: 0, l: 108 * TWIP_MM, r: 108 * TWIP_MM };
  for (const s of style.tblPr) mar = marginsOf(kid(s, "tblCellMar"), mar);
  mar = marginsOf(kid(tblPr, "tblCellMar"), mar);
  const grid = kids(kid(tbl, "tblGrid"), "gridCol").map((g) => num(g, "w", 0) * TWIP_MM);
  const rows = kids(tbl, "tr");
  if (grid.length === 0) {
    // 格子の無い表: 1 行目のセルの幅から
    for (const tc of kids(rows[0], "tc")) grid.push(num(kid(kid(tc, "tcPr"), "tcW"), "w", 1000) * TWIP_MM);
  }
  const tableW = grid.reduce((s, w) => s + w, 0);
  const jc = kid(tblPr, "jc")?.a.val ?? kid(style.tblPr[style.tblPr.length - 1] ?? null, "jc")?.a.val;
  const ind = num(kid(tblPr, "tblInd"), "w", 0) * TWIP_MM;
  let x = area.x + ind;
  // Word 2013 より前の互換の文書は、表の左の線をセルの左の余白の分だけ外へ（字が本文の端にそろう）
  if (ctx.compat < 15) x -= mar.l;
  if (jc === "center") x = area.x + (area.w - tableW) / 2;
  else if (jc === "right" || jc === "end") x = area.x + area.w - tableW;
  const tblp = kid(tblPr, "tblpPr");
  let yOffset = 0;
  if (tblp) {
    const hAnchor = tblp.a.horzAnchor ?? "text";
    const px = num(tblp, "tblpX", 0) * TWIP_MM;
    const base = hAnchor === "page" ? 0 : area.x;
    x = base + px;
    if (tblp.a.tblpXSpec === "center") x = (hAnchor === "page" ? (f.sec.w - tableW) / 2 : area.x + (area.w - tableW) / 2);
    yOffset = (tblp.a.vertAnchor ?? "margin") === "text" ? num(tblp, "tblpY", 0) * TWIP_MM : 0;
  }
  const colX: number[] = [0];
  for (const w of grid) colX.push(colX[colX.length - 1] + w);

  // セルの並び（結合）
  const rowCells: CellLayout[][] = [];
  for (const tr of rows) {
    const trPr = kid(tr, "trPr");
    let col = num(kid(trPr, "gridBefore"), "val", 0);
    const cells: CellLayout[] = [];
    for (const tcRaw of kids(tr)) {
      const tcs = tcRaw.n === "tc" ? [tcRaw] : tcRaw.n === "sdt" ? kids(kid(tcRaw, "sdtContent"), "tc") : tcRaw.n === "customXml" ? kids(tcRaw, "tc") : [];
      for (const tc of tcs) {
        const tcPr = kid(tc, "tcPr");
        const span = num(kid(tcPr, "gridSpan"), "val", 1);
        const vmNode = kid(tcPr, "vMerge");
        const vm = vmNode ? (vmNode.a.val === "restart" ? "start" : "cont") : "none";
        cells.push({ node: tc, col, span, vm, rowSpan: 1, tcPr, height: 0 });
        col += span;
      }
    }
    rowCells.push(cells);
  }
  for (let r = 0; r < rowCells.length; r++) {
    for (const c of rowCells[r]) {
      if (c.vm !== "start") continue;
      let n = 1;
      while (r + n < rowCells.length && rowCells[r + n].some((d) => d.col === c.col && d.vm === "cont")) n++;
      c.rowSpan = n;
    }
  }
  // セルの中身の高さ
  const cellArea = (c: CellLayout) => {
    const m = marginsOf(kid(c.tcPr, "tcMar"), mar);
    const x0 = colX[Math.min(c.col, grid.length)];
    const x1 = colX[Math.min(c.col + c.span, grid.length)];
    return { m, x0, x1 };
  };
  const contentHeight = (c: CellLayout): number => {
    const { m, x0, x1 } = cellArea(c);
    const vertical = /^(tbRl|tbRlV|btLr|tbLrV)$/.test(kid(c.tcPr, "textDirection")?.a.val ?? "");
    if (vertical) {
      // 縦書きのセルは字の数 × 字の大きさ
      const t = textOf(c.node).replace(/\s+/g, "");
      const { run } = paraProps(ctx, kids(c.node, "p")[0] ?? c.node, style);
      return m.t + m.b + [...t].length * run.size * PT_MM;
    }
    const sub: Flow = { ...f, items: [], floats: [], pages: [], y: 0, pageTop: false };
    let h = 0;
    for (const b of kids(c.node)) {
      if (b.n === "p") h += layoutParagraph(sub, b, { x: 0, w: x1 - x0 - m.l - m.r }, style, { measure: true, inCell: true }).height;
      else if (b.n === "tbl") h += layoutTable(sub, b, { x: 0, w: x1 - x0 - m.l - m.r }, { measure: true, inCell: true });
    }
    return h + m.t + m.b;
  };
  const rowH: number[] = [];
  rows.forEach((tr, r) => {
    const trH = kid(kid(tr, "trPr"), "trHeight");
    const val = num(trH, "val", 0) * TWIP_MM;
    const rule = trH?.a.hRule ?? (trH ? "atLeast" : "auto");
    let h = 0;
    for (const c of rowCells[r]) {
      if (c.vm === "cont") continue;
      c.height = contentHeight(c);
      if (c.rowSpan === 1) h = Math.max(h, c.height);
    }
    rowH.push(rule === "exact" ? val : Math.max(val, h, 0.5));
  });
  // 縦の結合のセルが入らなければ最後の行を伸ばす（固定の高さの行は伸ばさない）
  rows.forEach((_, r) => {
    for (const c of rowCells[r]) {
      if (c.vm !== "start" || c.rowSpan < 2) continue;
      const total = rowH.slice(r, r + c.rowSpan).reduce((s, h) => s + h, 0);
      if (c.height > total + 0.01) {
        const last = r + c.rowSpan - 1;
        const rule = kid(kid(kid(rows[last], "trPr"), "trHeight"), "hRule")?.a.val;
        if (kid(kid(rows[last], "trPr"), "trHeight")?.a.hRule !== "exact" && rule !== "exact") rowH[last] += c.height - total;
      }
    }
  });
  const total = rowH.reduce((s, h) => s + h, 0);
  if (opts.measure) return total;

  // 置く（行が頁に入らなければ次の頁へ。見出しの行は繰り返す）
  f.y += yOffset;
  const header = rows.map((tr) => bool(kid(kid(tr, "trPr"), "tblHeader"), "val", !!kid(kid(tr, "trPr"), "tblHeader")));
  const rowY: number[] = [];
  const rowPage: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    const cachedBreak = rowCells[r].some((c) => c.vm !== "cont" && startsWithBreak(kids(c.node, "p")[0]));
    if (!opts.inCell && !f.pageTop && (cachedBreak || f.y + rowH[r] > f.bottom + f.slack + 0.01)) {
      newPage(f);
      // 見出しの行を繰り返す
      for (let hr = 0; hr < r && header[hr]; hr++) {
        drawRow(f, rowCells[hr], hr, f.y, rowH, x, colX, grid, borders, mar, style, rows.length, true);
        f.y += rowH[hr];
      }
    }
    rowY[r] = f.y;
    rowPage[r] = f.pages.length;
    drawRow(f, rowCells[r], r, f.y, rowH, x, colX, grid, borders, mar, style, rows.length, false, rowPage);
    f.y += rowH[r];
    f.pageTop = false;
  }
  return total;
}

/** 段落の頭に Word の頁の切れ目（lastRenderedPageBreak）があるか */
function startsWithBreak(p: XNode | undefined): boolean {
  if (!p) return false;
  for (const r of kids(p, "r")) {
    for (const c of kids(r)) {
      if (c.n === "lastRenderedPageBreak") return true;
      if (c.n === "t" && textOf(c) !== "") return false;
    }
  }
  return false;
}

function drawRow(
  f: Flow,
  cells: CellLayout[],
  r: number,
  y: number,
  rowH: number[],
  tx: number,
  colX: number[],
  grid: number[],
  tb: TableBorders,
  mar: { t: number; b: number; l: number; r: number },
  style: TableStyle,
  nRows: number,
  repeat: boolean,
  rowPage?: number[],
) {
  void repeat;
  void rowPage;
  const ctx = f.ctx;
  for (const c of cells) {
    if (c.vm === "cont") continue;
    const x0 = tx + colX[Math.min(c.col, grid.length)];
    const x1 = tx + colX[Math.min(c.col + c.span, grid.length)];
    const span = Math.max(1, c.rowSpan);
    const h = rowH.slice(r, r + span).reduce((s, v) => s + v, 0);
    const lastRow = r + span - 1;
    // 塗り
    const shd = kid(c.tcPr, "shd");
    let fill: string | null = null;
    if (shd?.a.fill && shd.a.fill !== "auto") fill = colorOf(shd.a.fill, "#FFFFFF");
    else if (shd?.a.val && /^pct(\d+)$/.test(shd.a.val)) {
      const pct = Number(/^pct(\d+)$/.exec(shd.a.val)![1]);
      const g = Math.round(255 * (1 - pct / 100));
      fill = `#${g.toString(16).padStart(2, "0").repeat(3)}`.toUpperCase();
    }
    if (shd?.a.themeFill) {
      const themed = drawingColor({ n: "x", a: {}, c: [{ n: "schemeClr", a: { val: shd.a.themeFill.replace("background", "bg").replace("text", "tx") }, c: shd.a.themeFillShade ? [{ n: "lumMod", a: { val: String(Math.round((parseInt(shd.a.themeFillShade, 16) / 255) * 100000)) }, c: [] }] : [] }] }, ctx.theme);
      if (themed && !fill) fill = themed;
    }
    if (fill && !/^#FFFFFF$/i.test(fill)) f.items.push({ k: "rect", x: x0, y, w: x1 - x0, h, fill });
    // 罫線（セル → 表の外周・内側）
    const cb = kid(c.tcPr, "tcBorders");
    const edge = (name: "top" | "bottom" | "left" | "right", outer: boolean): Side | null => {
      const own = kid(cb, name) ?? (name === "left" ? kid(cb, "start") : name === "right" ? kid(cb, "end") : null);
      if (own) return sideOf(own);
      if (name === "top") return outer ? tb.top : tb.insideH;
      if (name === "bottom") return outer ? tb.bottom : tb.insideH;
      if (name === "left") return outer ? tb.left : tb.insideV;
      return outer ? tb.right : tb.insideV;
    };
    const top = edge("top", r === 0);
    const bottom = edge("bottom", lastRow === nRows - 1);
    const left = edge("left", c.col === 0);
    const right = edge("right", c.col + c.span >= grid.length);
    const line = (s: Side | null, ax: number, ay: number, bx: number, by: number) => {
      if (s && s.val !== "none") {
        f.items.push({ k: "line", x1: ax, y1: ay, x2: bx, y2: by, stroke: strokeOf(s) });
        if (s.val === "double" || s.val === "thinThickSmallGap" || s.val === "thickThinSmallGap") {
          const off = Math.max(0.3, s.sz * PT_MM * 1.5);
          const horiz = ay === by;
          f.items.push({ k: "line", x1: ax + (horiz ? 0 : off), y1: ay + (horiz ? off : 0), x2: bx + (horiz ? 0 : off), y2: by + (horiz ? off : 0), stroke: strokeOf(s) });
        }
      }
    };
    line(top, x0, y, x1, y);
    line(bottom, x0, y + h, x1, y + h);
    line(left, x0, y, x0, y + h);
    line(right, x1, y, x1, y + h);
    for (const d of ["tl2br", "tr2bl"] as const) {
      const s = kid(cb, d);
      if (s) line(sideOf(s), d === "tl2br" ? x0 : x1, y, d === "tl2br" ? x1 : x0, y + h);
    }
    // 中身
    const m = marginsOf(kid(c.tcPr, "tcMar"), mar);
    const vAlign = kid(c.tcPr, "vAlign")?.a.val ?? "top";
    const dir = kid(c.tcPr, "textDirection")?.a.val ?? "";
    const innerW = x1 - x0 - m.l - m.r;
    if (/^(tbRl|tbRlV|tbLrV)$/.test(dir)) {
      const text = kids(c.node, "p").map((p) => textOf(p)).join("");
      const p0 = kids(c.node, "p")[0];
      const { run } = paraProps(ctx, p0 ?? c.node, style);
      const size = run.size * PT_MM;
      const len = [...text.replace(/\s+/g, "")].length * size;
      const ty = vAlign === "center" ? y + (h - len) / 2 : vAlign === "bottom" ? y + h - m.b - len : y + m.t;
      // 縦書きの揃え（jc）は横の位置
      if (text.trim()) f.items.push({ k: "text", text: text.replace(/\s+/g, ""), x: (x0 + x1) / 2, y: Math.max(y, ty), font: fontSpec(run), color: run.color, vertical: true, clip: { x: x0, y, w: x1 - x0, h } });
      continue;
    }
    const sub: Flow = { ...f, items: [], floats: [], y: 0, pageTop: false };
    const content = c.height - m.t - m.b;
    let cy = y + m.t;
    if (vAlign === "center") cy = y + m.t + Math.max(0, (h - m.t - m.b - content) / 2);
    else if (vAlign === "bottom") cy = y + h - m.b - content;
    sub.y = cy;
    sub.top = y;
    sub.bottom = y + h;
    for (const b of kids(c.node)) {
      if (b.n === "p") layoutParagraph(sub, b, { x: x0 + m.l, w: innerW }, style, { inCell: true });
      else if (b.n === "tbl") layoutTable(sub, b, { x: x0 + m.l, w: innerW }, { inCell: true });
    }
    const clip: Box = { x: x0, y, w: x1 - x0, h };
    for (const it of sub.items) {
      if (it.k === "text" && !it.clip) it.clip = clip;
      f.items.push(it);
    }
    f.floats.push(...sub.floats);
  }
}

// ---- 図形

function anchorBase(f: Flow, rel: string, horizontal: boolean, paraTop: number, area: Area): { start: number; size: number } {
  const s = f.sec;
  if (horizontal) {
    if (rel === "page") return { start: 0, size: s.w };
    if (rel === "margin" || rel === "column" || rel === "insideMargin") return { start: s.left, size: s.w - s.left - s.right };
    if (rel === "leftMargin") return { start: 0, size: s.left };
    if (rel === "rightMargin") return { start: s.w - s.right, size: s.right };
    return { start: area.x, size: area.w };
  }
  if (rel === "page") return { start: 0, size: s.h };
  if (rel === "margin") return { start: s.top, size: s.h - s.top - s.bottom };
  if (rel === "topMargin") return { start: 0, size: s.top };
  if (rel === "bottomMargin") return { start: s.h - s.bottom, size: s.bottom };
  return { start: paraTop, size: 0 };
}

function placeAnchor(f: Flow, a: XNode, paraTop: number, area: Area) {
  if (a.n !== "anchor") {
    placeVml(f, a, paraTop, area);
    return;
  }
  const ext = kid(a, "extent");
  const w = num(ext, "cx", 0) * EMU_MM;
  const h = num(ext, "cy", 0) * EMU_MM;
  const pos = (node: XNode | null, horizontal: boolean, size: number) => {
    const rel = node?.a.relativeFrom ?? (horizontal ? "column" : "paragraph");
    const base = anchorBase(f, rel, horizontal, paraTop, area);
    const off = kid(node, "posOffset");
    if (off) return base.start + Number(textOf(off).trim() || "0") * EMU_MM;
    const al = textOf(kid(node, "align")).trim();
    if (al === "center") return base.start + (base.size - size) / 2;
    if (al === "right" || al === "bottom" || al === "outside") return base.start + base.size - size;
    return base.start;
  };
  const x = pos(kid(a, "positionH"), true, w);
  const y = pos(kid(a, "positionV"), false, h);
  const items = graphicItems(f.ctx, a, { x, y, w, h });
  if (bool(a, "behindDoc", false)) for (const it of items) (it as PageItem & { behind?: boolean }).behind = true;
  f.floats.push(...items);
}

/** wp:anchor・wp:inline の中の図形（テキストボックス・図形・画像・グループ） */
function graphicItems(ctx: Ctx, holder: XNode, box: Box): PageItem[] {
  const data = path(holder, "graphic/graphicData");
  const out: PageItem[] = [];
  for (const g of kids(data)) drawGraphic(ctx, g, box, out);
  return out;
}

function drawGraphic(ctx: Ctx, g: XNode, box: Box, out: PageItem[]) {
  if (g.n === "wsp") {
    const spPr = kid(g, "spPr");
    const style = kid(g, "style");
    shapeItems(ctx, spPr, style, box, out);
    const tb = kid(g, "txbx");
    const body = kid(tb, "txbxContent");
    if (body) {
      const bodyPr = kid(g, "bodyPr");
      textBox(ctx, body, box, {
        l: num(bodyPr, "lIns", 91440) * EMU_MM,
        r: num(bodyPr, "rIns", 91440) * EMU_MM,
        t: num(bodyPr, "tIns", 45720) * EMU_MM,
        b: num(bodyPr, "bIns", 45720) * EMU_MM,
        anchor: bodyPr?.a.anchor ?? "t",
        vertical: /vert/i.test(bodyPr?.a.vert ?? ""),
      }, out);
    }
  } else if (g.n === "wgp" || g.n === "grpSp") {
    const xfrm = path(g, "grpSpPr/xfrm");
    const chOff = kid(xfrm, "chOff");
    const chExt = kid(xfrm, "chExt");
    const ox = num(chOff, "x", 0);
    const oy = num(chOff, "y", 0);
    const ew = num(chExt, "cx", 0) || 1;
    const eh = num(chExt, "cy", 0) || 1;
    for (const c of kids(g)) {
      const pr = kid(c, c.n === "grpSp" ? "grpSpPr" : "spPr");
      const xf = kid(pr, "xfrm");
      const off = kid(xf, "off");
      const e = kid(xf, "ext");
      if (!off || !e) continue;
      const cb: Box = {
        x: box.x + ((num(off, "x", 0) - ox) / ew) * box.w,
        y: box.y + ((num(off, "y", 0) - oy) / eh) * box.h,
        w: (num(e, "cx", 0) / ew) * box.w,
        h: (num(e, "cy", 0) / eh) * box.h,
      };
      drawGraphic(ctx, c.n === "grpSp" ? { ...c, n: "wgp" } : c, cb, out);
    }
  } else if (g.n === "pic") {
    const embed = path(g, "blipFill/blip")?.a.embed;
    const rel = embed ? ctx.rels.get(embed) : undefined;
    const bytes = rel && !rel.external ? ctx.images.get(rel.target) : null;
    const type = bytes ? imageType(bytes) : null;
    if (bytes && type) out.push({ k: "image", x: box.x, y: box.y, w: box.w, h: box.h, data: bytes, type });
    else if (rel) ctx.warnings.push(`image:${rel.target.split(".").pop() ?? ""}`);
  }
}

function shapeItems(ctx: Ctx, spPr: XNode | null, style: XNode | null, box: Box, out: PageItem[]) {
  const geom = kid(spPr, "prstGeom")?.a.prst ?? "rect";
  const ln = kid(spPr, "ln");
  let stroke: Stroke | null = null;
  if (!(ln && kid(ln, "noFill"))) {
    const color = drawingColor(kid(ln, "solidFill"), ctx.theme) ?? (kid(style, "lnRef") && num(kid(style, "lnRef"), "idx", 0) > 0 ? drawingColor(kid(style, "lnRef"), ctx.theme) : null);
    if (color) stroke = { color, width: Math.max(0.1, num(ln, "w", 9525) * EMU_MM), dash: kid(ln, "prstDash") && kid(ln, "prstDash")!.a.val !== "solid" ? [0.8, 0.5] : undefined };
  }
  let fill: string | null = null;
  if (kid(spPr, "solidFill")) fill = drawingColor(kid(spPr, "solidFill"), ctx.theme);
  else if (!kid(spPr, "noFill") && kid(style, "fillRef") && num(kid(style, "fillRef"), "idx", 0) > 0) fill = drawingColor(kid(style, "fillRef"), ctx.theme);
  const xf = kid(spPr, "xfrm");
  const { x, y, w, h } = box;
  if (/^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(geom)) {
    if (stroke) {
      const fh = bool(xf, "flipH", false);
      const fv = bool(xf, "flipV", false);
      out.push({ k: "line", x1: fh ? x + w : x, y1: fv ? y + h : y, x2: fh ? x : x + w, y2: fv ? y : y + h, stroke });
    }
  } else if (geom === "ellipse") out.push({ k: "ellipse", cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: fill ?? undefined, stroke: stroke ?? undefined });
  else if (geom === "bracketPair" || geom === "bracePair") {
    if (stroke) {
      const r = Math.min(w, h) * 0.1667;
      const left: Array<[number, number]> = [[x + r, y], [x + r * 0.3, y + r * 0.3], [x, y + r], [x, y + h - r], [x + r * 0.3, y + h - r * 0.3], [x + r, y + h]];
      out.push({ k: "path", points: left, closed: false, stroke });
      out.push({ k: "path", points: left.map(([px, py]) => [x + w - (px - x), py]), closed: false, stroke });
    }
  } else if (fill || stroke) out.push({ k: "rect", x, y, w, h, fill: fill ?? undefined, stroke: stroke ?? undefined, radius: /round/i.test(geom) ? Math.min(w, h) * 0.1667 : undefined });
}

function textBox(ctx: Ctx, body: XNode, box: Box, ins: { l: number; r: number; t: number; b: number; anchor: string; vertical: boolean }, out: PageItem[]) {
  const sec: Section = { w: box.w, h: box.h, top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0, pitch: null, titlePg: false, headers: new Map(), footers: new Map() };
  const sub: Flow = { ctx, sec, items: [], pages: [], floats: [], y: 0, top: 0, bottom: Number.POSITIVE_INFINITY, pageTop: false, maxPages: 0, slack: 0 };
  const area = { x: box.x + ins.l, w: Math.max(1, box.w - ins.l - ins.r) };
  let h = 0;
  for (const b of kids(body)) {
    if (b.n === "p") h += layoutParagraph(sub, b, area, null, { measure: true, inCell: true }).height;
    else if (b.n === "tbl") h += layoutTable(sub, b, area, { measure: true, inCell: true });
  }
  sub.y = ins.anchor === "ctr" ? box.y + ins.t + (box.h - ins.t - ins.b - h) / 2 : ins.anchor === "b" ? box.y + box.h - ins.b - h : box.y + ins.t;
  for (const b of kids(body)) {
    if (b.n === "p") layoutParagraph(sub, b, area, null, { inCell: true });
    else if (b.n === "tbl") layoutTable(sub, b, area, { inCell: true });
  }
  const clip: Box = { x: box.x, y: box.y, w: box.w, h: box.h };
  for (const it of sub.items) {
    if (it.k === "text" && !it.clip) it.clip = clip;
    out.push(it);
  }
  out.push(...sub.floats);
}

/** VML（w:pict の v:rect など。古い Word の図形）の style の値（pt） */
function vmlStyle(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function vmlLen(v: string | undefined): number {
  if (!v) return 0;
  const m = /^(-?[\d.]+)(pt|in|mm|cm|px|emu)?$/.exec(v.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  switch (m[2]) {
    case "in":
      return n * 25.4;
    case "mm":
      return n;
    case "cm":
      return n * 10;
    case "px":
      return (n * 25.4) / 96;
    case "emu":
      return n * EMU_MM;
    default:
      return n * PT_MM;
  }
}

function placeVml(f: Flow, v: XNode, paraTop: number, area: Area) {
  const st = vmlStyle(v.a.style ?? "");
  const w = vmlLen(st.width);
  const h = vmlLen(st.height);
  const hb = anchorBase(f, st["mso-position-horizontal-relative"] ?? "text", true, paraTop, area);
  const vb = anchorBase(f, st["mso-position-vertical-relative"] ?? "text", false, paraTop, area);
  const x = hb.start + vmlLen(st["margin-left"] ?? st.left);
  const y = vb.start + vmlLen(st["margin-top"] ?? st.top);
  const out: PageItem[] = [];
  const strokeColor = colorOf((v.a.strokecolor ?? "").replace("#", ""), "#000000");
  const stroked = v.a.stroked !== "f" && v.a.stroked !== "false";
  const filled = v.a.filled !== "f" && v.a.filled !== "false" && !!v.a.fillcolor;
  const stroke: Stroke | undefined = stroked ? { color: strokeColor, width: Math.max(0.1, vmlLen(v.a.strokeweight ?? "0.75pt")) } : undefined;
  const fill = filled ? colorOf((v.a.fillcolor ?? "").replace("#", "").replace(/\s.*$/, ""), "#FFFFFF") : undefined;
  if (v.n === "line") {
    const [x1, y1] = (v.a.from ?? "0,0").split(",").map(vmlLen);
    const [x2, y2] = (v.a.to ?? "0,0").split(",").map(vmlLen);
    if (stroke) out.push({ k: "line", x1: hb.start + x1, y1: vb.start + y1, x2: hb.start + x2, y2: vb.start + y2, stroke });
  } else if (v.n === "oval") out.push({ k: "ellipse", cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, stroke, fill });
  else if (v.n === "rect" || v.n === "roundrect" || v.n === "shape") {
    if (stroke || fill) out.push({ k: "rect", x, y, w, h, stroke, fill, radius: v.n === "roundrect" ? Math.min(w, h) * 0.1 : undefined });
  }
  const tb = kid(v, "textbox");
  const body = kid(tb, "txbxContent");
  if (body) textBox(f.ctx, body, { x, y, w, h }, { l: 2.5, r: 2.5, t: 1.3, b: 1.3, anchor: "t", vertical: false }, out);
  f.floats.push(...out);
}

/** Word の頁の切れ目がある文書で、頁の下を越えてよい割合（本文の高さに掛ける） */
const CACHED_SLACK = 0.04;

// ---------------------------------------------------------------- 本体

export type DocxResult = { pages: OfficePage[]; warnings: string[] };

export type DocxOptions = { measure?: Measure; maxPages?: number };

export async function renderDocx(zip: ZipArchive, opts: DocxOptions = {}): Promise<DocxResult> {
  const warnings: string[] = [];
  const docPart = await mainDocumentPart(zip);
  const docText = await zip.text(docPart);
  if (!docText) throw new Error("document");
  const doc = parseXml(docText);
  const rels = await readRels(zip, docPart);
  const relOf = (type: string) => [...rels.values()].find((r) => r.type === type && !r.external)?.target ?? null;
  const themePart = relOf("theme");
  const theme = themePart ? parseTheme(await partXml(zip, themePart)) : DEFAULT_THEME;
  const stylesRoot = relOf("styles") ? await partXml(zip, relOf("styles")!) : null;
  const styles = new Map<string, XNode>();
  let defaultPara: string | null = null;
  let defaultTable: string | null = null;
  let defaultChar: string | null = null;
  for (const s of kids(stylesRoot, "style")) {
    const id = s.a.styleId;
    if (!id) continue;
    styles.set(id, s);
    if (bool(s, "default", false)) {
      if (s.a.type === "paragraph") defaultPara = id;
      else if (s.a.type === "table") defaultTable = id;
      else if (s.a.type === "character") defaultChar = id;
    }
  }
  const defaults = kid(stylesRoot, "docDefaults");
  const settings = relOf("settings") ? await partXml(zip, relOf("settings")!) : null;
  const compatSetting = kids(kid(settings, "compat"), "compatSetting").find((c) => c.a.name === "compatibilityMode");
  const numberingPart = relOf("numbering");
  const images = new Map<string, Uint8Array | null>();
  for (const r of rels.values()) if (r.type === "image" && !r.external) images.set(r.target, await zip.bytes(r.target).catch(() => null));
  const ctx: Ctx = {
    zip,
    theme,
    styles,
    defaultPara,
    defaultTable,
    defaultChar,
    docRPr: path(defaults, "rPrDefault/rPr"),
    docPPr: path(defaults, "pPrDefault/pPr"),
    numbering: readNumbering(numberingPart ? await partXml(zip, numberingPart) : null),
    rels,
    compat: compatSetting ? num(compatSetting, "val", 12) : 12,
    defaultTab: num(kid(settings, "defaultTabStop"), "val", 840) * TWIP_MM,
    measure: opts.measure ?? ((t, f) => estimateWidth(t, f)),
    warnings,
    images,
  };
  const body = kid(doc, "body");
  // Word が保存したときの頁の切れ目があれば、それを頁の切れ目の正にする（字の幅の違いで少し食み出しても次の頁に送らない）
  const cached = docText.includes("lastRenderedPageBreak");
  // 節ごとに分ける（段落の pPr の sectPr が節の終わり、最後は body の sectPr）
  const blocks = kids(body).filter((b) => b.n !== "sectPr");
  const sections: Array<{ sec: XNode | null; blocks: XNode[] }> = [];
  let cur: XNode[] = [];
  for (const b of blocks) {
    const flat = b.n === "sdt" ? kids(kid(b, "sdtContent")) : [b];
    for (const x of flat) {
      cur.push(x);
      const sp = x.n === "p" ? kid(kid(x, "pPr"), "sectPr") : null;
      if (sp) {
        sections.push({ sec: sp, blocks: cur });
        cur = [];
      }
    }
  }
  sections.push({ sec: kid(body, "sectPr"), blocks: cur });
  const maxPages = opts.maxPages ?? 50;
  const pages: OfficePage[] = [];
  for (const s of sections) {
    if (s.blocks.length === 0 && pages.length > 0) continue;
    const sec = sectionOf(s.sec, ctx);
    const f: Flow = { ctx, sec, items: [], pages: [], floats: [], y: sec.top, top: sec.top, bottom: sec.h - sec.bottom, pageTop: true, maxPages: maxPages - pages.length, slack: cached ? CACHED_SLACK * (sec.h - sec.top - sec.bottom) : 0 };
    const area = { x: sec.left, w: sec.w - sec.left - sec.right };
    for (const b of s.blocks) {
      if (f.pages.length >= f.maxPages) break;
      if (b.n === "p") layoutParagraph(f, b, area, null);
      else if (b.n === "tbl") layoutTable(f, b, area);
    }
    if (f.items.length > 0 || f.floats.length > 0 || f.pages.length === 0) finishPage(f);
    // ヘッダー・フッター
    for (let i = 0; i < f.pages.length; i++) {
      const page = f.pages[i];
      const firstOfSection = i === 0;
      for (const [map, top] of [
        [sec.headers, true],
        [sec.footers, false],
      ] as const) {
        const part = (firstOfSection && sec.titlePg ? map.get("first") : map.get("default")) ?? null;
        if (!part) continue;
        const root = await partXml(zip, part);
        if (!root) continue;
        const hfRels = await readRels(zip, part);
        const hctx: Ctx = { ...ctx, rels: hfRels };
        for (const r of hfRels.values()) if (r.type === "image" && !r.external && !ctx.images.has(r.target)) ctx.images.set(r.target, await zip.bytes(r.target).catch(() => null));
        const sub: Flow = { ctx: hctx, sec, items: [], pages: [], floats: [], y: 0, top: 0, bottom: Number.POSITIVE_INFINITY, pageTop: false, maxPages: 0, slack: 0 };
        let h = 0;
        for (const b of kids(root)) {
          if (b.n === "p") h += layoutParagraph(sub, b, area, null, { measure: true, inCell: true }).height;
          else if (b.n === "tbl") h += layoutTable(sub, b, area, { measure: true, inCell: true });
        }
        sub.y = top ? sec.header : sec.h - sec.footer - h;
        for (const b of kids(root)) {
          if (b.n === "p") layoutParagraph(sub, b, area, null, { inCell: true });
          else if (b.n === "tbl") layoutTable(sub, b, area, { inCell: true });
        }
        page.items.unshift(...sub.floats.filter((x) => (x as PageItem & { behind?: boolean }).behind));
        page.items.push(...sub.items, ...sub.floats.filter((x) => !(x as PageItem & { behind?: boolean }).behind));
      }
    }
    pages.push(...f.pages);
    if (pages.length >= maxPages) break;
  }
  pages.forEach((p, i) => (p.page = i + 1));
  return { pages: pages.slice(0, maxPages), warnings };
}

async function partXml(zip: ZipArchive, name: string): Promise<XNode | null> {
  const t = await zip.text(name);
  if (t === null || t.length > 16 * 1024 * 1024) return null;
  return parseXml(t);
}

/** 本文の部品の名前（_rels/.rels の officeDocument。無ければ word/document.xml） */
async function mainDocumentPart(zip: ZipArchive): Promise<string> {
  const rels = await readRels(zip, "");
  const main = [...rels.values()].find((r) => r.type === "officeDocument" && !r.external);
  return main?.target ?? "word/document.xml";
}
