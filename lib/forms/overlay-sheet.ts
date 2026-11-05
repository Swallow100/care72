// 元の様式の上に台帳の値を置く紙（T86、docs/DECISIONS.md「書類」）。
// 確かめた対応表の欄の場所（頁の画像の上の 0〜1 の矩形、lib/forms/mapping.ts の box）に、汎用の差し込み（lib/forms/mapped-sheet.ts）と
// 同じ値を置く。元の様式の頁の画像（lib/forms/page-images.ts）を下に敷くのは紙面の部品（components/forms/OverlaySheet.tsx）。
// サーバーの描画で、Claude は呼ばない（氏名・住所・電話が入る）。純な計算だけ（テストで字の大きさと別紙を確かめる）。
//
// 決まり:
// - 頁は元の様式の頁の画像の数と同じ。画像は A4（横長の画像は A4 横）の中に縦横の比を保って収める（余白は様式の画像の中にある）
// - 文字の欄は矩形に収まる大きさ（10.5pt から 6pt まで 0.25pt ずつ）に縮め、行を折る。6pt でも収まらなければ欄に「別紙」と書き、
//   値は最後の「別紙」の頁に欄の名前と並べる。場所の無い欄で値のある物も別紙に（値を落とさない）。
//   「なし」だけの値は、収まらなければ別紙に回さず欄を空ける（T111。別紙の頁を「なし」だけで作らない）。空き枠（empty）は刷らない
// - 字の幅は見積もり（全角 1 字・半角 0.8 字・M や W は 1 字。BIZ UDP の書体を測った値より少し広く）。描く側は見積もった行で折り、行の中で折らない
// - □ 1 つの欄は当てはまれば □ の中にレ点。選ぶ欄は選択肢の □ の場所があれば選んだ物の □ にレ点（□ でなく字の場所なら丸で囲む）、
//   無ければ選んだ言葉を欄に書く
// - 台帳に値の無い欄（未確認）・同意の無い欄（省略）・手書きの欄は空ける（市町村の紙に「未確認」を刷らない）。画面の上の帯にだけ出す
// - T120: 欄の中に「年 月 日」「− −」が刷ってあり、区切りの空きの場所（optionBoxes）がある日付・電話・文字の欄は、値を空きごとに分けて置く
//   （lib/forms/split-parts.ts）。分けられない・どこかの空きに収まらなければ、今までどおり欄全体に置く

import type { ConsentKind } from "../db/types.ts";
import type { MappedSheet } from "./mapped-sheet.ts";
import { PART_SHAPES, type FieldBox, type MappingField, type Typeface } from "./mapping.ts";
import { BLANK, type Cell, type Choice, type Piece } from "./matsuyama.ts";
import type { PageImage } from "./page-images.ts";
import { paperText } from "./paper-text.ts";
import { splitParts } from "./split-parts.ts";
import { isUnconfirmedCell } from "./unconfirmed.ts";

// ---------- 紙の寸法と字 ----------

export const A4_MM = { w: 210, h: 297 } as const;
const PT_MM = 25.4 / 72;
/** 字の大きさの上限と下限（pt）。上限は紙面の値と同じ 10.5pt、下限は刷って読める 6pt */
export const FONT_MAX_PT = 10.5;
export const FONT_MIN_PT = 6;
const FONT_STEP_PT = 0.25;
const LINE_HEIGHT = 1.15;
/** 矩形の内側の空き（mm）。罫線に字が掛からないように */
const PAD_X_MM = 0.8;
const PAD_Y_MM = 0.5;
/** 欄に書く「別紙」の字 */
export const ANNEX_MARK = "別紙";

/** 幅の広い半角（BIZ UDP の書体で 0.9 字を超える物） */
const WIDE_ASCII = new Set([..."MWmw%@"]);

/**
 * 1 字の幅（字の大きさを 1 とした比）。多めに見積もる（描いたときに矩形からはみ出さないように）。
 * BIZ UDP ゴシック・明朝を Chrome で測った値（数字 0.68〜0.76、英大文字 0.6〜0.72、M・W 0.98、空白 0.33、かな 0.88〜0.99、漢字 1）より少し広く
 */
export function charEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c === 0x20) return 0.36;
  if (WIDE_ASCII.has(ch)) return 1;
  if (c < 0x7f) return 0.8;
  if (c >= 0xff61 && c <= 0xff9f) return 0.55; // 半角カナ
  return 1;
}

export const textEm = (s: string) => [...s].reduce((n, ch) => n + charEm(ch), 0);

/** 行頭に来てはいけない字（句読点・閉じ括弧・長音）。来たら前の行の終わりに付ける */
const NO_LINE_START = new Set([..."、。，．・：；？！）」』】〕〉》ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ", ..."),.:;!?%"]);

/** 1 つの論理の行を、幅（字の大きさを 1 とした比）で折る。英数字の並び（電話・日付）は収まる限り割らない */
export function wrapLine(text: string, widthEm: number): string[] {
  const tokens = text.match(/[\x21-\x7e]+|\s+|[^\x00-\x7f]/gu) ?? [];
  const out: string[] = [];
  let cur = "";
  let curEm = 0;
  const push = () => {
    out.push(cur.trimEnd());
    cur = "";
    curEm = 0;
  };
  for (const tok of tokens) {
    const em = textEm(tok);
    if (/^\s+$/.test(tok)) {
      if (cur !== "" && curEm + em <= widthEm) {
        cur += " ";
        curEm += charEm(" ");
      }
      continue;
    }
    if (curEm + em <= widthEm) {
      cur += tok;
      curEm += em;
      continue;
    }
    // 行頭に来てはいけない字は前の行に付ける（少しはみ出すが、幅は多めに見積もっている）
    if (cur !== "" && tok.length === 1 && NO_LINE_START.has(tok)) {
      cur += tok;
      curEm += em;
      continue;
    }
    if (em <= widthEm) {
      if (cur !== "") push();
      cur = tok;
      curEm = em;
      continue;
    }
    // 1 行より長い英数字の並びは字ごとに
    for (const ch of tok) {
      const e = charEm(ch);
      if (cur !== "" && curEm + e > widthEm) push();
      cur += ch;
      curEm += e;
    }
  }
  if (cur !== "") push();
  return out.length > 0 ? out : [""];
}

/** top: 3 行より高い矩形（複数行の欄）は上から、ほかは高さの真ん中に置く */
export type Fitted = { lines: string[]; fontPt: number; top: boolean };

/**
 * 矩形（mm）に収まる大きさと行。上限から 0.25pt ずつ縮め、全部の行が高さに収まる最初の大きさ。下限でも収まらなければ null
 */
export function fitText(logical: readonly string[], wMm: number, hMm: number, maxPt: number = FONT_MAX_PT): Fitted | null {
  const innerW = wMm - PAD_X_MM * 2;
  const innerH = hMm - PAD_Y_MM * 2;
  if (innerW <= 0 || innerH <= 0) return null;
  // 上限から 0.25pt ずつ。上限が 0.25 の倍数でなくても（9.84pt など）最後は下限の 6pt を試す
  const sizes: number[] = [];
  for (let pt = maxPt; pt > FONT_MIN_PT + 1e-9; pt -= FONT_STEP_PT) sizes.push(pt);
  sizes.push(FONT_MIN_PT);
  for (const pt of sizes) {
    const fontMm = pt * PT_MM;
    if (fontMm * LINE_HEIGHT > innerH + 1e-9) continue;
    const widthEm = innerW / fontMm;
    const lines = logical.flatMap((l) => wrapLine(l, widthEm));
    if (lines.some((l) => textEm(l) > widthEm + 1e-9)) continue;
    if (lines.length * fontMm * LINE_HEIGHT <= innerH + 1e-9) return { lines, fontPt: Math.round(pt * 100) / 100, top: innerH >= fontMm * LINE_HEIGHT * 3 };
  }
  return null;
}

// ---------- 欄の値を字に ----------

const pieceText = (p: Piece) => (p.raw ? p.text : paperText(p.text));

/**
 * 1 行の言葉を字に。未確認の言葉は落とす（紙に「未確認」を刷らない）。添えの言葉（sub）だけの行は括弧に入れる（「（同居）」）。
 * 未確認の言葉の前の添え（「用量」「残り」。未確認の所の名前）も落とし、前後と重なった区切りの「／」を詰める（T101）。ほかの「／」はそのまま
 */
export function lineText(pieces: readonly Piece[]): string {
  const SEP = "／";
  const named = pieces.filter((p, i) => !p.unconfirmed && p.text.trim() !== "" && !(p.sub && p.text !== SEP && pieces[i + 1]?.unconfirmed));
  const kept = named.filter((p, i) => p.text !== SEP || (i > 0 && i < named.length - 1 && named[i + 1].text !== SEP));
  if (kept.length === 0) return "";
  if (kept.every((p) => p.sub && p.text !== "／")) return `（${kept.map(pieceText).join("・")}）`;
  const joined = kept.map(pieceText).join(" ");
  // 数字と単位の間（「84 歳」）を詰める。本人の言葉（raw）の行は詰めない
  return kept.some((p) => p.raw) ? joined : paperText(joined);
}

const choiceText = (c: Choice): string => `${c.label}${c.detail ? `（${c.detail}）` : ""}`;

/** 電話の欄で書かない添え（欄の名前と同じ言葉）。携帯・固定の区別は残す */
const PHONE_NOISE = new Set(["電話"]);

/** 欄の値を、欄に書く字の行に。書く物が無ければ空の配列。phone は電話の欄（添えの「電話」を書かない） */
export function cellLines(cell: Cell, phone = false): string[] {
  switch (cell.kind) {
    case "value":
      return cell.lines
        .map((l) => lineText(phone ? l.filter((x) => !(x.sub && PHONE_NOISE.has(x.text))) : l))
        .filter((l) => l !== "");
    case "choice": {
      const on = cell.options.filter((o) => o.on && o.label !== "").map(choiceText);
      const after = cell.after ? lineText(cell.after) : "";
      const line = [...on, after].filter((x) => x !== "").join(" ");
      return line ? [line] : [];
    }
    case "none":
      return [BLANK.none];
    case "empty":
    case "unconfirmed":
    case "withheld":
    case "handwrite":
      return [];
  }
}

/**
 * 「なし」だけの値か（T111）。収まらなくても別紙に回さず、欄を空ける（別紙の頁と別紙の印を「なし」だけで作らない）。
 * 値のある別紙が 1 つも無いのに、市に出す紙が「別紙あり」になるのを防ぐ
 */
export const isNoneOnly = (lines: readonly string[]): boolean => lines.length > 0 && lines.every((l) => l === BLANK.none);

// ---------- 紙面 ----------

export type OverlayItem =
  | { kind: "text"; fieldId: string; box: FieldBox; lines: string[]; fontPt: number; top: boolean; /** 区切りの空きの何番目か（T120） */ part?: number }
  /** □ の中のレ点（check）か、選択肢を丸で囲む（circle） */
  | { kind: "mark"; fieldId: string; box: FieldBox; mark: "check" | "circle" }
  /** 欄に置く画像（避難経路の地図。T101 の受け口、T106 がつなぐ）。svg は欄の箱の大きさで描いた SVG の文字列（欄の中にそのまま埋め込む） */
  | { kind: "image"; fieldId: string; box: FieldBox; slot: string; svg: string; alt: string };

/** 未記入の色付け（T101）で塗る所。欄の矩形の内側（罫線に掛からないよう縮めた物）と、その欄の id（帯の未確認と同じ欄） */
export type OverlayFill = { keys: string[]; box: FieldBox };

export type OverlayPage = {
  page: number;
  /** A4 の向き */
  landscape: boolean;
  /** 頁の画像の箱（mm。A4 の中で縦横の比を保って真ん中） */
  image: { x: number; y: number; w: number; h: number };
  items: OverlayItem[];
  /** 未記入の色付けの版で塗る所（既定の版では描かない） */
  fills: OverlayFill[];
  /**
   * 紙に直接書く窓の押す所（T117。原本の枠の紙の欄の矩形。値の無い欄も押せるように）。画面だけで、紙には刷らない。
   * 原本の枠の紙（lib/forms/frame-sheet.ts）だけが作る
   */
  targets?: OverlayFill[];
};

/** 色付けの塗りを罫線から離す幅（mm。罫線の太さの半分 0.15 と 0.3 の空き） */
export const FILL_INSET_MM = 0.45;

/** 比の矩形を、頁の画像の大きさ（mm）で内側へ縮める。縮めすぎて無くなれば null */
export function insetBox(b: FieldBox, image: { w: number; h: number }, mmInset = FILL_INSET_MM): FieldBox | null {
  const dx = mmInset / image.w;
  const dy = mmInset / image.h;
  if (b.w <= dx * 2 || b.h <= dy * 2) return null;
  return { x: b.x + dx, y: b.y + dy, w: b.w - dx * 2, h: b.h - dy * 2 };
}

export type AnnexRow = { fieldId: string; label: string; lines: string[]; reason: "overflow" | "unplaced" };

export type OverlaySheet = {
  personId: string;
  name: string;
  title: string;
  issuer: string;
  typeface: Typeface;
  pages: OverlayPage[];
  /** 別紙に書く欄（収まらない・場所が無い） */
  annex: AnnexRow[];
  /** 未確認・対応なし・省略（画面の上の帯。紙には刷らない） */
  unconfirmed: string[];
  unmapped: string[];
  withheld: ConsentKind[];
};

/** 頁の画像を A4 に収める箱（mm） */
export function imageBoxOf(img: Pick<PageImage, "width" | "height">): OverlayPage["image"] & { landscape: boolean } {
  const landscape = img.width > img.height;
  const pw = landscape ? A4_MM.h : A4_MM.w;
  const ph = landscape ? A4_MM.w : A4_MM.h;
  const scale = Math.min(pw / img.width, ph / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  return { landscape, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

/** □ に近い形（縦横の比が 0.6〜1.6、紙で 8mm 以下）ならレ点、字の場所なら丸で囲む */
function markOf(box: FieldBox, image: { w: number; h: number }): "check" | "circle" {
  const w = box.w * image.w;
  const h = box.h * image.h;
  return w / h >= 0.6 && w / h <= 1.6 && Math.max(w, h) <= 8 ? "check" : "circle";
}

const nameOf = (f: MappingField) => (f.section ? `${f.section} ${f.label}` : f.label);

/**
 * 差し込みの紙面（buildMappedSheet の結果。値・同意の範囲・未確認は同じ）と頁の画像から、元の様式の上に置く紙を作る。
 * 頁の画像の無い頁の欄は別紙へ
 */
export function buildOverlaySheet(mapped: MappedSheet, images: readonly PageImage[], typeface: Typeface = "gothic"): OverlaySheet {
  const pages: OverlayPage[] = images.map((img) => {
    const { landscape, ...image } = imageBoxOf(img);
    return { page: img.page, landscape, image, items: [], fills: [] };
  });
  const annex: AnnexRow[] = [];
  for (const p of mapped.pages) {
    for (const s of p.sections) {
      for (const { field, cell } of s.rows) {
        if (cell.kind === "handwrite" || cell.kind === "withheld" || field.shape === "handwrite") continue;
        // 未記入の色付け（T101）: 帯の未確認（lib/forms/unconfirmed.ts の mappedUnconfirmed）と同じ欄の矩形の内側
        const fillPage = pages.find((x) => x.page === field.page);
        if (fillPage && field.box && isUnconfirmedCell(cell)) {
          const inner = insetBox(field.box, fillPage.image);
          if (inner) fillPage.fills.push({ keys: [field.id], box: inner });
        }
        const page = pages.find((x) => x.page === field.page);
        const box = field.box ?? null;
        const lines = cellLines(cell, field.shape === "phone");
        // □ 1 つの欄: 当てはまればレ点（値の言葉は書かない）
        if (field.shape === "check") {
          const on = cell.kind === "choice" && cell.options.some((o) => o.on);
          if (!on) continue;
          if (page && box) page.items.push({ kind: "mark", fieldId: field.id, box, mark: markOf(box, page.image) });
          else annex.push({ fieldId: field.id, label: nameOf(field), lines: ["■"], reason: "unplaced" });
          continue;
        }
        // 選ぶ欄: 選んだ選択肢の □ の場所があれば印
        // 複数選択の欄（T122）は選んだ選択肢の全部に印。どれかの □ の場所が無ければ、字で書く（下へ）
        if (field.shape === "choice" && cell.kind === "choice" && page) {
          const hits = cell.options.flatMap((o, i) => (o.on ? [i] : []));
          const optBoxes = hits.map((i) => field.optionBoxes?.[i] ?? null);
          if (hits.length > 0 && optBoxes.every((b): b is FieldBox => b !== null)) {
            for (const optBox of optBoxes) page.items.push({ kind: "mark", fieldId: field.id, box: optBox, mark: markOf(optBox, page.image) });
            continue;
          }
        }
        if (lines.length === 0) continue;
        if (!page || !box) {
          annex.push({ fieldId: field.id, label: nameOf(field), lines, reason: "unplaced" });
          continue;
        }
        // 区切りの空きに分けて置く（T120）
        const parts = partItems(field, lines, page.image);
        if (parts) {
          page.items.push(...parts);
          continue;
        }
        const wMm = box.w * page.image.w;
        const hMm = box.h * page.image.h;
        const fitted = fitText(lines, wMm, hMm);
        if (fitted) {
          page.items.push({ kind: "text", fieldId: field.id, box, ...fitted });
          continue;
        }
        // 「なし」だけの値は別紙に回さず欄を空ける（T111）
        if (isNoneOnly(lines)) continue;
        annex.push({ fieldId: field.id, label: nameOf(field), lines, reason: "overflow" });
        const mark = fitText([ANNEX_MARK], wMm, hMm);
        page.items.push({ kind: "text", fieldId: field.id, box, lines: [ANNEX_MARK], fontPt: mark?.fontPt ?? FONT_MIN_PT, top: mark?.top ?? false });
      }
    }
  }
  return {
    personId: mapped.personId,
    name: mapped.name,
    title: mapped.title,
    issuer: mapped.issuer,
    typeface,
    pages,
    annex,
    unconfirmed: mapped.unconfirmed,
    unmapped: mapped.unmapped,
    withheld: mapped.withheld,
  };
}

/**
 * 区切りの空きごとの字（T120）。日付・電話・文字の欄で、区切りの字（options）と全部の空きの場所（optionBoxes）があり、
 * 値が区切りに合わせて分けられ、どの空きにも収まるときだけ。ほかは null（欄全体に置く）
 */
export function partItems(field: MappingField, lines: readonly string[], image: { w: number; h: number }): OverlayItem[] | null {
  if (!PART_SHAPES.includes(field.shape) || field.options.length === 0) return null;
  const boxes = field.optionBoxes ?? [];
  if (boxes.length !== field.options.length || boxes.some((b) => !b)) return null;
  const parts = splitParts(lines.join(" "), field.options);
  if (!parts || parts.length !== boxes.length) return null;
  const out: OverlayItem[] = [];
  for (const [i, part] of parts.entries()) {
    const b = boxes[i]!;
    const fitted = fitText([part], b.w * image.w, b.h * image.h);
    if (!fitted) return null;
    out.push({ kind: "text", fieldId: field.id, box: b, ...fitted, part: i });
  }
  return out;
}

/** 元の様式の上に置く紙にできるか（頁の画像があり、場所のある欄が 1 つ以上）。できなければ前からの 2 列の紙 */
export function canOverlay(fields: readonly MappingField[], images: readonly PageImage[] | null): images is readonly PageImage[] {
  return images !== null && images.length > 0 && fields.some((f) => !f.removed && (f.box ?? null) !== null);
}
