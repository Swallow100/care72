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
import { unpackInk, type InkBlob } from "./ink.ts";
import { bracketOwners, strayOther } from "./form-shape.ts";
import { freeRects, inkIn, readingOrder } from "./place.ts";
import type { MappedSheet } from "./mapped-sheet.ts";
import { PART_SHAPES, type FieldBox, type MappingField, type Typeface } from "./mapping.ts";
import type { MappedRow } from "./mapped-sheet.ts";
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
export const PAD_X_MM = 0.8;
export const PAD_Y_MM = 0.5;
/** 低い枠（括弧の中・区切りの空き）で字を下限まで縮めても入らないときだけ使う狭い空き（T133。components/forms/overlay-paper.css の .ov-tight） */
export const TIGHT_PAD_X_MM = 0.3;
export const TIGHT_PAD_Y_MM = 0.1;
/**
 * 狭い空きでも入らない 1 行の短い値の、最後の置き方（T160。components/forms/overlay-paper.css の .ov-snug）。行の高さを字の高さ（1.0）に、
 * 空きを 0.05mm に。評価の 6 回目で、吹田市の緊急連絡先のフリガナの行（高さ 2.3mm）と浜松市の「昭和　年　月　日生」の空き（幅 3.4mm）に
 * 下限の字でも入らず、全部の紙で置けなかった。字の幅は多めの見積もりのままなので、枠の中に収まる
 */
export const SNUG_PAD_X_MM = 0.05;
export const SNUG_PAD_Y_MM = 0.05;
export const SNUG_LINE_HEIGHT = 1;
/** 数だけの短い値（年・月・日・局番。4 字まで）の、最後の置き方の字の下限（pt）。手で書く狭い空きに数を書く形 */
export const DIGITS_MIN_PT = 5.5;
const SHORT_DIGITS = /^[0-9]{1,4}$/;

/** 置いた字の空きと行の高さ（overlay-paper.css の .ov-text・.ov-tight・.ov-snug と同じ。見直し〔lib/forms/review.ts〕も同じ物で測る） */
export function textPads(it: { tight?: boolean; snug?: boolean }): { padX: number; padY: number; lineHeight: number } {
  if (it.snug) return { padX: SNUG_PAD_X_MM, padY: SNUG_PAD_Y_MM, lineHeight: SNUG_LINE_HEIGHT };
  if (it.tight) return { padX: TIGHT_PAD_X_MM, padY: TIGHT_PAD_Y_MM, lineHeight: LINE_HEIGHT };
  return { padX: PAD_X_MM, padY: PAD_Y_MM, lineHeight: LINE_HEIGHT };
}
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
export function fitText(
  logical: readonly string[],
  wMm: number,
  hMm: number,
  maxPt: number = FONT_MAX_PT,
  padX = PAD_X_MM,
  padY = PAD_Y_MM,
  opts: { lineHeight?: number; minPt?: number; oneLine?: boolean } = {},
): Fitted | null {
  const innerW = wMm - padX * 2;
  const innerH = hMm - padY * 2;
  if (innerW <= 0 || innerH <= 0) return null;
  const lineHeight = opts.lineHeight ?? LINE_HEIGHT;
  const minPt = opts.minPt ?? FONT_MIN_PT;
  // 上限から 0.25pt ずつ。上限が 0.25 の倍数でなくても（9.84pt など）最後は下限の 6pt を試す
  const sizes: number[] = [];
  for (let pt = maxPt; pt > minPt + 1e-9; pt -= FONT_STEP_PT) sizes.push(pt);
  sizes.push(minPt);
  for (const pt of sizes) {
    const fontMm = pt * PT_MM;
    if (fontMm * lineHeight > innerH + 1e-9) continue;
    const widthEm = innerW / fontMm;
    const lines = logical.flatMap((l) => wrapLine(l, widthEm));
    if (lines.some((l) => textEm(l) > widthEm + 1e-9)) continue;
    if (opts.oneLine && lines.length > 1) continue;
    if (lines.length * fontMm * lineHeight <= innerH + 1e-9) return { lines, fontPt: Math.round(pt * 100) / 100, top: innerH >= fontMm * lineHeight * 3 };
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

/** 住所の項目（本人・連絡先・支援者）。住所の無い人の近さ（市内・近所）だけの値は、住所の欄に書かない（T133） */
const ADDRESS_ITEM = /(^basic\.address|\.address)$/;

/**
 * 欄に書く字の行（T133）。cellLines と同じで、住所の欄で住所が無く近さの添え（「（市内）」）だけの値は書かない
 * （仮の言い方を住所の欄に刷らない。住所は台帳に無いので「未聴取」）
 */
export function fieldLines(field: Pick<MappingField, "shape" | "item">, cell: Cell): string[] {
  const lines = cellLines(cell, field.shape === "phone");
  if (field.item && ADDRESS_ITEM.test(field.item) && cell.kind === "value" && cell.lines.every((l) => l.every((x) => x.sub || x.unconfirmed || x.text.trim() === ""))) return [];
  return lines;
}

/**
 * 「なし」だけの値か（T111）。収まらなくても別紙に回さず、欄を空ける（別紙の頁と別紙の印を「なし」だけで作らない）。
 * 値のある別紙が 1 つも無いのに、市に出す紙が「別紙あり」になるのを防ぐ
 */
export const isNoneOnly = (lines: readonly string[]): boolean => lines.length > 0 && lines.every((l) => l === BLANK.none);

// ---------- 紙面 ----------

export type OverlayItem =
  | {
      kind: "text";
      fieldId: string;
      box: FieldBox;
      lines: string[];
      fontPt: number;
      top: boolean;
      /** 区切りの空きの何番目か（T120） */
      part?: number;
      /** 狭い空き（T133。TIGHT_PAD_*） */
      tight?: boolean;
      /** 狭い空きでも入らない 1 行の短い値（T160。SNUG_*、行の高さは字の高さ） */
      snug?: boolean;
      /** 欄の枠の中で、印刷の字を避けて空いた所へずらした（T133。数えるため） */
      shifted?: boolean;
      /** 紙の上に置いた文字の枠（T135、lib/forms/form-entries.ts）の id */
      free?: string;
    }
  /** 紙の上に置いた画像（T135。事業所の画像。src は同じ origin の URL） */
  | { kind: "picture"; fieldId: string; box: FieldBox; src: string; alt: string; free: string }
  /** □ の中のレ点（check）か、選択肢を丸で囲む（circle） */
  | { kind: "mark"; fieldId: string; box: FieldBox; mark: "check" | "circle" }
  /** 欄に置く画像（避難経路の地図。T101 の受け口、T106 がつなぐ）。svg は欄の箱の大きさで描いた SVG の文字列（欄の中にそのまま埋め込む） */
  | { kind: "image"; fieldId: string; box: FieldBox; slot: string; svg: string; alt: string };

/** 未記入の色付け（T101）で塗る所。欄の矩形の内側（罫線に掛からないよう縮めた物）と、その欄の id（帯の未確認と同じ欄） */
/**
 * kind（T133）: ask は台帳に無い（ケアマネが聞いて足す欄。帯の未確認と同じ）、fix は台帳に値があるのに置けなかった（アプリの直す所）。無ければ ask
 */
export type OverlayFill = { keys: string[]; box: FieldBox; kind?: "ask" | "fix" };

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

/**
 * 別紙の行。page は欄の頁（場所の分かる物。T141 で別紙の頁に出す）、mark は紙の上に「別紙」と書いた欄の id（収まらない値。同じ書く所の
 * 欄は先頭の欄に 1 つ。T141 で別紙の中身と紙の印がそろっているかを確かめる）
 */
export type AnnexRow = { fieldId: string; label: string; lines: string[]; reason: "overflow" | "unplaced"; page?: number; mark?: string };

/**
 * 別紙の中身と紙の「別紙」の印のずれ（T141）。noMark は紙に「別紙」の印の無い、収まらない値の行の欄、noRow は紙に「別紙」と書いたのに
 * 別紙の行の無い欄。どちらも空ならそろっている（見直しの「別紙相違」と評価の台が使う）
 */
export function annexGaps(sheet: Pick<OverlaySheet, "pages" | "annex">): { noMark: string[]; noRow: string[] } {
  const marked = new Set(
    sheet.pages.flatMap((p) => p.items.filter((it) => it.kind === "text" && it.lines.join("") === ANNEX_MARK).map((it) => it.fieldId)),
  );
  const overflow = sheet.annex.filter((r) => r.reason === "overflow");
  const marks = new Set(overflow.map((r) => r.mark ?? r.fieldId));
  return {
    noMark: [...new Set(overflow.filter((r) => !marked.has(r.mark ?? r.fieldId)).map((r) => r.fieldId))],
    noRow: [...marked].filter((id) => !marks.has(id)),
  };
}

/**
 * 置けなかった訳（T140）。option は値が様式の選択肢に無い（選択肢と台帳の値の表〔lib/forms/option-values.ts〕でも当たらない・候補が 2 つ以上）、
 * room は欄・部品・選択肢の所の空きに収まらない（下限の字でも、別紙の印も入らない）、box は選んだ選択肢の □ の場所が無い（□ が刷ってある欄）
 */
export const UNPLACED_REASONS = ["option", "room", "box"] as const;
export type UnplacedReason = (typeof UNPLACED_REASONS)[number];
/** 画面の言葉（2〜4 字）。帯の「未配置」の訳 */
export const UNPLACED_REASON_LABELS: Record<UnplacedReason, string> = { option: "選択肢外", room: "空き不足", box: "□位置無" };

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
  /** 台帳に値があるのに置けなかった欄（T133。欄の名前。紙に字を置かず、色付けの版で「未配置」の印） */
  unplaced?: string[];
  /** 同じ欄の id（T136 の見直しの取込漏れに渡す） */
  unplacedIds?: string[];
  /** 置けなかった訳（T140。欄の id → 訳） */
  unplacedWhy?: Record<string, UnplacedReason>;
  unmapped: string[];
  withheld: ConsentKind[];
  /** 一覧の形の様式（T131、差し込みの紙面の list のまま）。一括印刷で行ごとに 1 人を置く（lib/forms/list-sheet.ts） */
  list?: MappedSheet["list"];
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
 * 頁の画像の無い頁の欄は別紙へ。
 *
 * 置き方の決まり（T133）:
 * - 字・印はその欄の枠（区切りの空き・選択肢の □ はその部品の枠）の中にだけ置く。印刷の字（頁の印刷の字の位置 lib/forms/ink.ts）と重なれば、
 *   枠の中の空いた所へずらす（lib/forms/place.ts）。ほかの欄・ほかの行・枠の外へは出さない
 * - 枠の中で収まらなければ字を下限（6pt）まで小さくし、低い枠は狭い空きでも試す。それでも収まらない・どこに置くか確かでない時は置かず、
 *   「置けなかった」（unplaced。色付けの版で未配置の印）にする。前の「部品に分けられなければ欄全体に 1 本の文字列」「選択肢に合わない値を
 *   □ の行の上に書く」はしない
 * - 別紙（収まらない値を最後の頁に）は、長い自由記入の欄（複数行の欄・長い値）だけ。短い値は別紙にせず「置けなかった」
 * - 「別紙 あり・なし」の欄（medical.annex）は、この紙に別紙の頁が付くときだけ あり（付かなければ なし）
 */
export function buildOverlaySheet(mapped: MappedSheet, images: readonly PageImage[], typeface: Typeface = "gothic"): OverlaySheet {
  const pages: OverlayPage[] = images.map((img) => {
    const { landscape, ...image } = imageBoxOf(img);
    return { page: img.page, landscape, image, items: [], fills: [] };
  });
  const inks = new Map<number, InkBlob[] | null>(images.map((img) => [img.page, img.ink ? unpackInk(img.ink) : null]));
  // ほかの欄の枠（字を置くとき、印刷の字と同じく避ける。隣の欄に掛けない。T133）
  const boxesOf = new Map<number, Array<{ id: string; box: FieldBox; free: boolean; owner?: { id: string; option: number } }>>();
  const rowsAll = mapped.pages.flatMap((p) => p.sections.flatMap((s) => s.rows));
  // 選択肢の後ろの括弧の子の欄（T164）: 自分の値は空（mapped-sheet.ts の bracketCell）で、親の選ぶ欄の添え・その他の値の置き場
  const owners = bracketOwners(rowsAll.map((r) => r.field));
  for (const { field, cell } of rowsAll)
    if (!field.removed && field.box) {
      const own = owners.get(field.id);
      const child = own && own.option !== null && cell.kind === "empty" ? { id: own.owner.id, option: own.option } : undefined;
      // 前の並びと違う項目の「その他（　）」（空にした欄）も、項目なしの書く所と同じ
      const stray = cell.kind === "empty" && !own && strayOther(field, rowsAll.map((r) => r.field));
      const free = (field.item === null && (field.shape === "text" || field.shape === "lines")) || !!child || stray;
      boxesOf.set(field.page, [...(boxesOf.get(field.page) ?? []), { id: field.id, box: field.box, free, ...(child ? { owner: child } : {}) }]);
    }
  const ctxOf = (page: number): PlaceCtx | null => {
    const p = pages.find((x) => x.page === page);
    return p ? { page: p, ink: inks.get(page) ?? null, others: boxesOf.get(page) ?? [] } : null;
  };
  const annex: AnnexRow[] = [];
  /** 値があるのに置けなかった欄 */
  const unplaced = new Map<string, MappingField>();
  const why = new Map<string, UnplacedReason>();
  const miss = (field: MappingField, reason: UnplacedReason) => {
    unplaced.set(field.id, field);
    if (!why.has(field.id)) why.set(field.id, reason);
  };
  const all = mapped.pages.flatMap((p) => p.sections.flatMap((s) => s.rows));
  // 名前と電話の列（T131）: 名前の欄の値の電話を、同じ行の右の電話の列（項目なし）に分けて置く
  const tels = telColumns(all);
  /** 電話を分けて置いた電話の列（未記入の色付けをしない） */
  const telFilled = new Set<string>();
  /** 字を置く欄（同じ書く所に 2 つの欄があれば重ねて置くので、あとでまとめて置く） */
  const texts: Array<{ field: MappingField; page: OverlayPage; box: FieldBox; lines: string[] }> = [];
  /** 選ぶ欄の「その他（　）」などの値を書いた、中の項目なしの欄（未記入の色付けをしない） */
  const childFilled = new Set<string>();
  /** 別紙 あり・なし の欄（あとで、別紙の頁が付くかで印） */
  const annexChoices: Array<{ field: MappingField; pc: PlaceCtx }> = [];
  for (const p of mapped.pages) {
    for (const s of p.sections) {
      for (const { field, cell } of s.rows) {
        if (cell.kind === "handwrite" || cell.kind === "withheld" || field.shape === "handwrite") continue;
        const pc = ctxOf(field.page);
        const page = pc?.page;
        const box = field.box ?? null;
        if (field.item === "medical.annex" && pc && box) {
          annexChoices.push({ field, pc });
          continue;
        }
        const lines = westernDateLines(field, printedOff(field, fieldLines(field, cell)));
        // □ 1 つの欄: 当てはまればレ点（値の言葉は書かない）
        if (field.shape === "check") {
          const on = cell.kind === "choice" && cell.options.some((o) => o.on);
          if (!on) continue;
          if (page && box) page.items.push({ kind: "mark", fieldId: field.id, box, mark: markOf(box, page.image) });
          else annex.push({ fieldId: field.id, label: nameOf(field), lines: ["■"], reason: "unplaced", page: field.page });
          continue;
        }
        // 選ぶ欄: 選んだ選択肢の □ に印、選択肢に合わない値は「その他（　）」の空きへ、選択肢の添え（浸水の深さ）はその選択肢の所の空きへ
        if (field.shape === "choice" && cell.kind === "choice" && pc && box) {
          const r = placeChoice(field, cell, pc);
          pc.page.items.push(...r.items);
          for (const a of r.annex) annex.push({ fieldId: field.id, label: nameOf(field), lines: a.lines, reason: "overflow", page: field.page, mark: a.mark });
          for (const id of r.filled) childFilled.add(id);
          if (r.unplaced) miss(field, r.unplaced);
          continue;
        }
        if (lines.length === 0) continue;
        if (!page || !box || !pc) {
          annex.push({ fieldId: field.id, label: nameOf(field), lines, reason: "unplaced", page: field.page });
          continue;
        }
        // 区切りの空きに分けて置く（T120）。分けられる欄で、どれかの空きに置けなければ置かない（欄全体に 1 本で置かない。T133）
        const parts = partItems(field, lines, pc);
        if (parts === "fail") {
          miss(field, "room");
          continue;
        }
        // 刷ってある元号と値の元号が違う（T160）: 紙の上で直す（選択肢に無い値と同じ）
        if (parts === "era") {
          miss(field, "option");
          continue;
        }
        if (parts) {
          page.items.push(...parts);
          continue;
        }
        // 区切りの場所が無い日付の欄で、欄の中に「年 月 日」の 3 字だけが刷ってあれば、その字の前の空きに分けて置く（T133）
        const dated = inkDateParts(field, lines, pc);
        if (dated === "fail") {
          miss(field, "room");
          continue;
        }
        if (dated) {
          page.items.push(...dated);
          continue;
        }
        // 区切りの場所が無い電話の欄で、欄の中に「−」「（　）」が刷ってあれば、局番・市内・番号を空きに分けて置く（T140）
        const phoned = inkPhoneParts(field, lines, pc);
        if (phoned === "fail") {
          miss(field, "room");
          continue;
        }
        if (phoned) {
          page.items.push(...phoned);
          continue;
        }
        // 縦の罫線で 1 字ずつのマスに分けた欄（「西暦生年月日 8 桁」のマス。T160）に、数だけの値を 1 字ずつ
        const combed = combItems(field, lines, pc);
        if (combed === "fail") {
          miss(field, "room");
          continue;
        }
        if (combed) {
          page.items.push(...combed);
          continue;
        }
        // 名前と電話を別の列に分けて置く（T131）。どちらかが収まらなければ今までどおり欄全体に
        const tel = tels.get(field.id);
        const split = tel?.field.box ? splitTelItems(field, cell, tel.field, pc) : null;
        if (split && tel) {
          page.items.push(...split);
          telFilled.add(tel.field.id);
          continue;
        }
        texts.push({ field, page, box, lines });
      }
    }
  }
  for (const all of sharedBoxes(texts)) {
    const { page, box } = all[0];
    const pc = ctxOf(page.page)!;
    // 同じ書く所の欄が全部入らなければ、「なし」だけの欄を外して試す（T111 の「なし」を刷りすぎない）
    const valued = all.filter((g) => !isNoneOnly(g.lines));
    const together = placeText(all[0].field.id, all.flatMap((g) => g.lines), box, pc, { units: all.length === 1 });
    const group = together || valued.length === 0 ? all : valued;
    const lines = group.flatMap((g) => g.lines);
    const placed = group === all ? together : placeText(group[0].field.id, lines, box, pc);
    if (placed) {
      page.items.push(placed);
      continue;
    }
    // 「なし」だけの値は別紙に回さず欄を空ける（T111）
    if (isNoneOnly(lines)) continue;
    // 長い自由記入だけ別紙に（欄に「別紙」）。短い値は置かずに「置けなかった」（T133）。選ぶ欄の「その他（　）」の書き足しは placeChoice で別紙へ（T140）
    const long = group.some((g) => g.field.shape === "lines" || g.lines.length > 1 || textEm(g.lines.join("")) > ANNEX_LONG_EM);
    const mark = long ? placeText(group[0].field.id, [ANNEX_MARK], box, pc) : null;
    if (long && mark) {
      for (const g of group) annex.push({ fieldId: g.field.id, label: nameOf(g.field), lines: g.lines, reason: "overflow", page: g.field.page, mark: mark.fieldId });
      page.items.push(mark);
      continue;
    }
    for (const g of group) miss(g.field, "room");
  }
  // 別紙 あり・なし（T133）: この紙に別紙の頁が付くときだけ あり
  for (const { field, pc } of annexChoices) pc.page.items.push(...annexMarks(field, annex.length > 0, pc));
  // 未記入の色付け: 台帳に無い（ask、帯の未確認と同じ欄）と、置けなかった（fix）
  for (const { field, cell } of all) {
    if (field.removed || field.shape === "handwrite" || cell.kind === "handwrite" || cell.kind === "withheld" || telFilled.has(field.id) || childFilled.has(field.id) || field.item === "medical.annex") continue;
    const page = pages.find((x) => x.page === field.page);
    if (!page || !field.box) continue;
    const kind = unplaced.has(field.id) ? "fix" : isUnconfirmedCell(cell) ? "ask" : null;
    if (!kind) continue;
    const inner = insetBox(field.box, page.image);
    if (inner) page.fills.push({ keys: [field.id], box: inner, kind });
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
    ...(unplaced.size > 0 ? { unplaced: [...unplaced.values()].map(nameOf), unplacedIds: [...unplaced.keys()], unplacedWhy: Object.fromEntries(why) } : {}),
    unmapped: mapped.unmapped,
    withheld: mapped.withheld,
    ...(mapped.list ? { list: mapped.list } : {}),
  };
}

// ---------- 置き方（T133） ----------

/**
 * 置いた字の箱（頁の比）。置いた所（item.box）の内側の空きから、行の数 × 字の高さ、いちばん長い行の幅。
 * 1・2 行の欄は高さの真ん中、高い欄は上から（components/forms/overlay-paper.css の .ov-text と同じ）
 */
export function textExtent(it: Extract<OverlayItem, { kind: "text" }>, image: { w: number; h: number }): FieldBox {
  const fontMm = it.fontPt * PT_MM;
  const { padX, padY, lineHeight } = textPads(it);
  const wMm = Math.max(0, ...it.lines.map((l) => textEm(l))) * fontMm;
  const hMm = it.lines.length * fontMm * lineHeight;
  const boxW = it.box.w * image.w;
  const boxH = it.box.h * image.h;
  const x = it.box.x * image.w + padX;
  const y = it.top ? it.box.y * image.h + padY : it.box.y * image.h + (boxH - hMm) / 2;
  return { x: x / image.w, y: y / image.h, w: Math.min(wMm, Math.max(0, boxW - padX * 2)) / image.w, h: hMm / image.h };
}

/** 印刷の字と重なりと見なす割合（かたまりの面に対して） */
const INK_HIT_RATIO = 0.2;

/** 字の箱が印刷の字のかたまりと重なるか（かたまりの面の 2 割より多く） */
export function hitsInk(r: FieldBox, ink: readonly InkBlob[]): boolean {
  return ink.some((b) => {
    // ほかの欄の枠は少しでも掛かれば
    if (b.field) return Math.min(r.x + r.w, b.x + b.w) > Math.max(r.x, b.x) && Math.min(r.y + r.h, b.y + b.h) > Math.max(r.y, b.y);
    // 罫線は字の箱を横切るときだけ（字の箱の縁に触れるだけの線は数えない）
    if (b.line) {
      const horizontal = b.w >= b.h;
      const c = horizontal ? b.y + b.h / 2 : b.x + b.w / 2;
      const [lo, hi] = horizontal ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
      const along = horizontal ? Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x) : Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
      return c > lo + (hi - lo) * 0.15 && c < hi - (hi - lo) * 0.15 && along > 0;
    }
    const w = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x);
    const h = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
    return w > 0 && h > 0 && w * h > INK_HIT_RATIO * b.w * b.h;
  });
}

/** a が b の中か（tol は頁の比で横・縦） */
export function inside(a: FieldBox, b: FieldBox, tolX = 0, tolY = 0): boolean {
  return a.x >= b.x - tolX && a.y >= b.y - tolY && a.x + a.w <= b.x + b.w + tolX && a.y + a.h <= b.y + b.h + tolY;
}

/** 欄を置く頁と、その頁の印刷の字の位置（無ければ null。印刷の字を避けずに置く＝前と同じ） */
export type PlaceCtx = {
  page: OverlayPage;
  ink: InkBlob[] | null;
  /** 頁の欄の枠（置く欄のほかの欄に掛けない）。free は項目なしの字の欄（選ぶ欄の「その他（　）」の中の書く所に使える） */
  others?: ReadonlyArray<{ id: string; box: FieldBox; free?: boolean; owner?: { id: string; option: number } }>;
};

/** 隣の欄と見なす重なり（mm。これより小さい掛かりは枠の線の上の揺れ） */
const NEIGHBOR_TOL_MM = 0.3;

/**
 * 置く所の中で避ける物: 印刷の字と、ほかの欄の枠（その欄を中に持つ欄〔外の段〕と同じ書く所の欄は除く。枠は線の揺れの分だけ縮める）
 */
function obstaclesOf(fieldId: string, area: FieldBox, own: FieldBox, pc: PlaceCtx): InkBlob[] {
  const image = pc.page.image;
  const out: InkBlob[] = pc.ink ? inkIn(area, pc.ink) : [];
  const dx = NEIGHBOR_TOL_MM / image.w;
  const dy = NEIGHBOR_TOL_MM / image.h;
  for (const o of pc.others ?? []) {
    if (o.id === fieldId || containsMost(o.box, own) || sameArea(own, o.box)) continue;
    const b = { x: o.box.x + dx, y: o.box.y + dy, w: o.box.w - dx * 2, h: o.box.h - dy * 2 };
    if (b.w <= 0 || b.h <= 0) continue;
    const w = Math.min(b.x + b.w, area.x + area.w) - Math.max(b.x, area.x);
    const h = Math.min(b.y + b.h, area.y + area.h) - Math.max(b.y, area.y);
    if (w > 0 && h > 0) out.push({ ...b, box: false, field: true });
  }
  return out;
}

/** 外の欄か: b が a の面の 8 割より多くを持つ（AI の読む枠は少しずれるので、ぴったり中でなくても外の段・種類の欄と見なす） */
export function containsMost(outer: FieldBox, a: FieldBox): boolean {
  return coverOf(a, outer) >= 0.8;
}

/** 長い自由記入と見なす字の幅（字の数）。これより短い値は別紙に回さない */
const ANNEX_LONG_EM = 24;

/** 枠（頁の比）に字を収める。下限まで縮め、それでも入らなければ狭い空きで試す */
function fitIn(lines: readonly string[], box: FieldBox, image: { w: number; h: number }, maxPt: number = FONT_MAX_PT): { fitted: Fitted; tight?: true; snug?: true } | null {
  const w = box.w * image.w;
  const h = box.h * image.h;
  if (maxPt >= FONT_MIN_PT - 1e-9) {
    const f = fitText(lines, w, h, maxPt);
    if (f && f.fontPt > FONT_MIN_PT + 1e-9) return { fitted: f };
    // 普通の空きで下限まで縮めた字は、狭い空きの方が大きければそちら（T175）。枠が 0.1% 低いだけで狭い空きの大きな字に変わり、枠の読み取りの
    // わずかな差で下限の字の数（見直しの下限）が同じ様式で 122 → 17 と揺れていた
    const t = fitText(lines, w, h, maxPt, TIGHT_PAD_X_MM, TIGHT_PAD_Y_MM);
    if (t && (!f || t.fontPt > f.fontPt + 1e-9)) return { fitted: t, tight: true };
    if (f) return { fitted: f };
  }
  // 最後: 1 行の短い値だけ、行の高さを字の高さに・空きを 0.05mm に（T160）。数だけの短い値は字の下限を 5.5pt に
  if (lines.length !== 1 || [...lines[0]].length > 24) return null;
  const minPt = SHORT_DIGITS.test(lines[0].normalize("NFKC").trim()) ? DIGITS_MIN_PT : FONT_MIN_PT;
  if (maxPt < minPt - 1e-9) return null;
  const s = fitText(lines, w, h, maxPt, SNUG_PAD_X_MM, SNUG_PAD_Y_MM, { lineHeight: SNUG_LINE_HEIGHT, minPt, oneLine: true });
  return s ? { fitted: s, snug: true } : null;
}

/**
 * 区切りの空き・マスに分けて置いた字の大きさをそろえる（T160）。いちばん小さい字に合わせて、同じ所に置き直す（置き直せなければ元のまま）。
 * 「昭和 15 年 2 月 9 日」の年だけ小さく月だけ大きい、のようにならないように
 */
function evenParts(items: OverlayItem[], fieldId: string, pc: PlaceCtx, own: FieldBox): OverlayItem[] {
  const texts = items.filter((x): x is TextItem => x.kind === "text");
  if (texts.length < 2) return items;
  const min = Math.min(...texts.map((t) => t.fontPt));
  return items.map((it) => {
    if (it.kind !== "text" || it.fontPt <= min + 1e-9) return it;
    const again = placeText(fieldId, it.lines, it.box, pc, { own, maxPt: min });
    return again ? { ...again, ...(it.part !== undefined ? { part: it.part } : {}), ...(it.shifted ? { shifted: true } : {}) } : it;
  });
}

type TextItem = Extract<OverlayItem, { kind: "text" }>;

/** 数と単位の値（「1 階」「84 歳」「3 m」）。単位が様式に刷ってある空き（すぐ右に印刷の字）では数だけを書く */
const NUM_UNIT = /^\s*([0-9０-９.．]+)\s*(階|歳|分|m|ｍ|人|回|年|才)\s*$/;

/**
 * 字を枠（欄の枠か部品の枠）の中に置く。印刷の字の位置があれば、置いた字の箱が印刷の字に掛からない所だけ。
 * 枠全体で掛からなければそのまま、掛かれば枠の中の空いた所（字の大きい順、同じなら広い順）。どこにも置けなければ null（枠の外へは出さない）
 */
export function placeText(fieldId: string, lines: readonly string[], area: FieldBox, pc: PlaceCtx, opts: { units?: boolean; own?: FieldBox; maxPt?: number } = {}): TextItem | null {
  const image = pc.page.image;
  const obstacles = obstaclesOf(fieldId, area, opts.own ?? area, pc);
  const whole = fitIn(lines, area, image, opts.maxPt);
  if (whole) {
    const item: TextItem = { kind: "text", fieldId, box: area, ...whole.fitted, ...(whole.tight ? { tight: true } : {}), ...(whole.snug ? { snug: true } : {}) };
    if (obstacles.length === 0 || !hitsInk(textExtent(item, image), obstacles)) return item;
  }
  if (obstacles.length === 0) return null;
  let best: TextItem | null = null;
  let bestArea = 0;
  let bestEnc = -1;
  for (const r of freeRects(area, obstacles, image)) {
    let use = lines;
    // 単位が刷ってある空き（すぐ右に印刷の字）は数だけ
    if (opts.units && lines.length === 1) {
      const m = lines[0].normalize("NFKC").match(NUM_UNIT);
      const fontGuess = 3.5 / image.w;
      if (m && obstacles.some((o) => o.x >= r.x + r.w - 1e-6 && o.x <= r.x + r.w + fontGuess && o.y < r.y + r.h && r.y < o.y + o.h)) use = [m[1]];
    }
    const f = fitIn(use, r, image, opts.maxPt);
    if (!f) continue;
    const item: TextItem = { kind: "text", fieldId, box: r, ...f.fitted, ...(f.tight ? { tight: true } : {}), ...(f.snug ? { snug: true } : {}), shifted: true };
    if (hitsInk(textExtent(item, image), obstacles)) continue;
    const a = r.w * r.h;
    // 同じ字の大きさなら、左右を印刷の字に挟まれた空き（括弧の中・区切りの字の間）を先に、次に広い所
    const enc = enclosed(r, obstacles, image);
    // 字・挟まれ方が同じで広さも 1 割の差までなら、読む順（上から、左から）に先の所（表の空いた行の 1 つ目）
    const sameFont = best !== null && Math.abs(item.fontPt - best.fontPt) < 1e-9;
    const nearArea = sameFont && enc === bestEnc && Math.abs(a - bestArea) <= 0.1 * Math.max(a, bestArea);
    if (!best || item.fontPt > best.fontPt + 1e-9 || (sameFont && (enc > bestEnc || (enc === bestEnc && (nearArea ? readingOrder(r, best.box) < 0 : a > bestArea))))) {
      best = item;
      bestArea = a;
      bestEnc = enc;
    }
  }
  return best;
}

/**
 * 空きの左右のすぐ外（1.5mm まで）に細い印刷の字（括弧・数字のように幅が高さの 6 割まで）があるか（両側 2・片側 1・無し 0）。
 * 「（　）」の中を、表の行で刷ってある言葉（「個別避難計画」）の続きの空きより先にする
 */
function enclosed(r: FieldBox, obstacles: readonly InkBlob[], image: { w: number; h: number }): number {
  const reach = 1.5 / image.w;
  const row = (o: InkBlob) => o.y < r.y + r.h && r.y < o.y + o.h && !o.line && !o.field && (o.w * image.w) / (o.h * image.h) <= 0.6;
  const left = obstacles.some((o) => row(o) && o.x + o.w <= r.x + 1e-6 && o.x + o.w >= r.x - reach);
  const right = obstacles.some((o) => row(o) && o.x >= r.x + r.w - 1e-6 && o.x <= r.x + r.w + reach);
  return Number(left) + Number(right);
}

/**
 * 欄の名前の空の括弧の前の字（「要介護（　）」の「要介護」）が値の頭にあれば外す（様式に刷ってある字を重ねて書かない）
 */
export function printedOff(field: Pick<MappingField, "label">, lines: readonly string[]): string[] {
  const m = field.label.normalize("NFKC").match(/^(.+?)[（(][\s　]*[）)][\s　]*$/);
  if (!m) return [...lines];
  const head = m[1].replace(/[\s　]/g, "");
  if (!head) return [...lines];
  return lines.map((l) => {
    const n = l.normalize("NFKC");
    return n.startsWith(head) && n.length > head.length ? n.slice(head.length).trim() : l;
  });
}

/** 選択肢の □ の場所（欄の枠の中にある物だけ。外の物は使わない） */
function optionBoxOf(field: MappingField, i: number, image: { w: number; h: number }): FieldBox | null {
  const b = field.optionBoxes?.[i] ?? null;
  if (!b || !field.box) return null;
  return inside(b, field.box, 0.6 / image.w, 0.6 / image.h) ? b : null;
}

const OTHER_OPTION = /^(その他|他|そのほか)/;

/** 選んだ選択肢の所の空き（その □ から、同じ行の右の選択肢の □ の手前か欄の右の端まで。縦は欄の枠） */
function optionArea(field: MappingField, i: number, image: { w: number; h: number }, rowOnly: boolean): FieldBox | null {
  const b = optionBoxOf(field, i, image);
  const box = field.box;
  if (!b || !box) return null;
  const sameRow = (o: FieldBox) => o.y < b.y + b.h && b.y < o.y + o.h;
  const right = (field.optionBoxes ?? []).filter((o): o is FieldBox => !!o && o !== b && o.x > b.x && sameRow(o)).sort((x, y) => x.x - y.x)[0];
  const x0 = b.x + b.w;
  const x1 = right ? right.x : box.x + box.w;
  const y0 = rowOnly ? Math.max(box.y, b.y - b.h * 0.8) : box.y;
  const y1 = rowOnly ? Math.min(box.y + box.h, b.y + b.h * 1.8) : box.y + box.h;
  return x1 - x0 > 0 && y1 - y0 > 0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * 選ぶ欄を置く（T133）。選んだ選択肢の □ に印。選択肢の添え（浸水の深さ）はその選択肢の所の空き、選択肢に合わない値は「その他」の □ に印を付けて
 * その後ろの空き（「その他（　）」の括弧の中）。置けない物は unplaced（□ の行の上に字を書かない）
 */
function placeChoice(
  field: MappingField,
  cell: Extract<Cell, { kind: "choice" }>,
  pc: PlaceCtx,
): { items: OverlayItem[]; unplaced: UnplacedReason | null; filled: string[]; annex: Array<{ lines: string[]; mark: string }> } {
  const image = pc.page.image;
  const items: OverlayItem[] = [];
  const filled: string[] = [];
  const annex: Array<{ lines: string[]; mark: string }> = [];
  let unplaced: UnplacedReason | null = null;
  const fail = (r: UnplacedReason) => {
    unplaced ??= r;
  };
  /**
   * 選択肢の所の空きに字を置く。空きの中に項目なしの字の欄（「その他（　）」の書く所を AI が別の欄に読んだ物）があれば、その欄の枠に置く
   */
  /** 選択肢の括弧の子の欄（T164）があればその枠、無ければ空きの中の項目なしの字の欄 */
  const childOf = (area: FieldBox, option: number) =>
    (pc.others ?? []).find((o) => o.owner?.id === field.id && o.owner.option === option) ??
    (pc.others ?? []).find((o) => o.free && !o.owner && o.id !== field.id && coverOf(o.box, area) >= 0.6);
  const putIn = (text: string, area: FieldBox, option: number): TextItem | null => {
    const child = childOf(area, option);
    if (child) {
      const t = placeText(child.id, [text], child.box, pc);
      if (t) filled.push(child.id);
      return t;
    }
    return placeText(field.id, [text], area, pc, { own: field.box! });
  };
  /** 選択肢の所の空きに収まらない字は、その空きに「別紙」と書いて別紙へ（T140）。「別紙」も入らなければ置けなかった */
  const putOrAnnex = (text: string, area: FieldBox | null, option: number) => {
    const t = area ? putIn(text, area, option) : null;
    if (t) return items.push(t);
    // 「別紙」の印は括弧の子の欄の枠の中（T164。括弧の外の □ の行の上に書かない）
    const child = area ? childOf(area, option) : undefined;
    const m = !area ? null : child ? placeText(child.id, [ANNEX_MARK], child.box, pc) : placeText(field.id, [ANNEX_MARK], area, pc, { own: field.box! });
    if (m) {
      items.push(m);
      if (child) filled.push(child.id);
      annex.push({ lines: [text], mark: m.fieldId });
    } else fail("room");
  };
  // 台帳の値に当たる選択肢が 2 つ以上（T140）: 選ばず、その他にも書かない
  if (cell.ambiguous) {
    fail("option");
    return { items, unplaced, filled, annex };
  }
  const box = field.box!;
  const hits = cell.options.flatMap((o, i) => (o.on && o.label !== "" ? [i] : []));
  const after = cell.after ? lineText(cell.after) : "";
  const hasBoxes = hits.length > 0 && hits.every((i) => optionBoxOf(field, i, image) !== null);
  const printedBoxes = pc.ink ? inkIn(box, pc.ink).some((b) => b.box) : false;
  if (hits.length > 0 && hasBoxes) {
    for (const i of hits) {
      const b = optionBoxOf(field, i, image)!;
      items.push({ kind: "mark", fieldId: field.id, box: b, mark: markOf(b, image) });
      const detail = cell.options[i].detail;
      if (!detail) continue;
      putOrAnnex(paperText(detail), optionArea(field, i, image, false), i);
    }
  } else if (hits.length > 0) {
    // 選んだ選択肢の □ の場所が無い: 欄に □ が刷ってなければ選んだ言葉を空いた所に、刷ってあれば置かない
    const words = hits.map((i) => cell.options[i]).map((o) => `${o.label}${o.detail ? `（${o.detail}）` : ""}`);
    const t = printedBoxes || (field.optionBoxes ?? []).some(Boolean) ? null : placeText(field.id, [words.join(" ")], box, pc);
    if (t) items.push(t);
    else fail(printedBoxes || (field.optionBoxes ?? []).some(Boolean) ? "box" : "room");
  }
  if (after) {
    const other = cell.options.findIndex((o) => OTHER_OPTION.test(o.label.normalize("NFKC").trim()));
    const ob = other >= 0 ? optionBoxOf(field, other, image) : null;
    if (ob) {
      if (!hits.includes(other)) items.push({ kind: "mark", fieldId: field.id, box: ob, mark: markOf(ob, image) });
      putOrAnnex(after, optionArea(field, other, image, true), other);
    } else if (!printedBoxes && !(field.optionBoxes ?? []).some(Boolean) && hits.length === 0) {
      const t = placeText(field.id, [after], box, pc);
      if (t) items.push(t);
      else fail("room");
    } else fail("option");
  }
  return { items, unplaced, filled, annex };
}

/** a の面のうち b に入る割合 */
function coverOf(a: FieldBox, b: FieldBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / (a.w * a.h) : 0;
}

/** 別紙 あり・なし の欄の印（T133）。選ぶ欄は あり か なし の □、□ 1 つの欄は別紙があるときだけ、字の欄は あり・なし を書く */
function annexMarks(field: MappingField, hasAnnex: boolean, pc: PlaceCtx): OverlayItem[] {
  const image = pc.page.image;
  if (field.shape === "check") return hasAnnex ? [{ kind: "mark", fieldId: field.id, box: field.box!, mark: markOf(field.box!, image) }] : [];
  if (field.shape === "choice") {
    const want = hasAnnex ? /^(あり|有|有り)/ : /^(なし|無|無し)/;
    const i = field.options.findIndex((o) => want.test(o.normalize("NFKC").trim()));
    const b = i >= 0 ? optionBoxOf(field, i, image) : null;
    return b ? [{ kind: "mark", fieldId: field.id, box: b, mark: markOf(b, image) }] : [];
  }
  const t = placeText(field.id, [hasAnnex ? "あり" : "なし"], field.box!, pc);
  return t ? [t] : [];
}

// ---------- 名前と電話の列・同じ書く所の欄（T131） ----------

/** 縦に重なる割合（低い方の高さに対して） */
function verticalOverlap(a: FieldBox, b: FieldBox): number {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, bottom - top) / Math.min(a.h, b.h);
}

/** 値の行が全部「名前 … TEL 番号」の形か（関係先の行。lib/forms/matsuyama.ts の contactLine） */
function telLines(cell: Cell): Array<{ name: Piece[]; tel: Piece[] }> | null {
  if (cell.kind !== "value" || cell.lines.length === 0) return null;
  const out: Array<{ name: Piece[]; tel: Piece[] }> = [];
  for (const line of cell.lines) {
    const at = line.findIndex((p) => p.sub && p.text === "TEL");
    if (at < 0) return null;
    // 電話の後ろの添え（備考）は名前の側に残す
    const tail = line.slice(at + 1);
    const telEnd = tail.findIndex((p) => p.sub);
    out.push({ name: [...line.slice(0, at), ...(telEnd >= 0 ? tail.slice(telEnd) : [])], tel: telEnd >= 0 ? tail.slice(0, telEnd) : tail });
  }
  return out;
}

/**
 * 名前の欄 → 同じ行の右の電話の列（T131）。様式の名前の列と電話の列が別にあり（民生委員・事業所等の「氏名」「TEL」）、電話の列に
 * 台帳の項目が無い（電話だけの項目が無い連絡先）とき。電話の列は 1 つの名前の欄にだけ使う（いちばん近い物）
 */
export function telColumns(rows: readonly MappedRow[]): Map<string, MappedRow> {
  const out = new Map<string, MappedRow>();
  const used = new Set<string>();
  for (const r of rows) {
    const b = r.field.box;
    if (!b || r.field.removed || r.field.item === null || (r.field.shape !== "text" && r.field.shape !== "lines") || !telLines(r.cell)) continue;
    const near = rows
      .filter((c) => {
        const cb = c.field.box;
        return (
          cb &&
          !used.has(c.field.id) &&
          !c.field.removed &&
          c.field.page === r.field.page &&
          c.field.shape === "phone" &&
          c.field.item === null &&
          cb.x >= b.x + b.w * 0.5 &&
          verticalOverlap(cb, b) >= 0.5
        );
      })
      .sort((x, y) => x.field.box!.x - y.field.box!.x)[0];
    if (near) {
      out.set(r.field.id, near);
      used.add(near.field.id);
    }
  }
  return out;
}

/** 名前を名前の欄に、電話を電話の列に置く字。どちらかが収まらなければ null（欄全体に置く） */
function splitTelItems(field: MappingField, cell: Cell, tel: MappingField, pc: PlaceCtx): OverlayItem[] | null {
  const parts = telLines(cell);
  if (!parts || !field.box || !tel.box) return null;
  const names = parts.map((p) => lineText(p.name)).filter((l) => l !== "");
  const tels = parts.map((p) => lineText(p.tel)).filter((l) => l !== "");
  const out: OverlayItem[] = [];
  for (const [f, lines] of [
    [field, names],
    [tel, tels],
  ] as const) {
    if (lines.length === 0) continue;
    const placed = placeText(f.id, lines, f.box!, pc);
    if (!placed) return null;
    out.push(placed);
  }
  return out;
}

/** 書く所がほぼ同じ（重なりが 9 割）か */
function sameArea(a: FieldBox, b: FieldBox): boolean {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter >= 0.9 * Math.max(a.w * a.h, b.w * b.h);
}

/**
 * 同じ書く所の欄をまとめる（T131）。1 つの書く所に欄の名前が 2 つ付く様式（「主治医」と「服薬の情報」の名前が 2 段で、書く所が 1 つ）は、
 * 欄ごとに別の項目を当て、box は同じ所になる。別々に置くと字が重なるので、欄の順に行を重ねて 1 つに置く
 */
function sharedBoxes<T extends { field: MappingField; page: OverlayPage; box: FieldBox }>(texts: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const t of texts) {
    const g = groups.find((x) => x[0].page === t.page && sameArea(x[0].box, t.box));
    if (g) g.push(t);
    else groups.push([t]);
  }
  return groups;
}

const ERA_NAMES = ["明治", "大正", "昭和", "平成", "令和"] as const;
const ERA_HEAD = /^(明治|大正|昭和|平成|令和)\s*/;
/** 元号の □ が並ぶ数と、その元号（古い順。様式の元号の □ は古い順に刷る） */
const ERA_ROWS: Record<number, readonly string[]> = { 5: ERA_NAMES, 4: ERA_NAMES.slice(1) };

/**
 * 区切りの空きごとの字（T120・T133）。日付・電話・文字の欄で、区切りの字（options）と全部の空きの場所（optionBoxes）があるとき。
 * - 空きの場所は欄の枠の中の物だけを使う（外の物があれば置かない）
 * - 元号: 値の年に元号があれば、元号の選択肢（options の 明治〜令和）か、欄の中に刷ってある元号の □（4 つか 5 つ。古い順）の、値の元号の □ に印を
 *   付けて年の空きには数だけ。元号の □ が無く値が今の元号（令和）なら数だけ（決め。docs/DECISIONS.md の案 T133）。
 *   ほかの元号で □ が無ければ元号ごと年の空きに置き、入らなければ置かない
 * - 区切りに合わせて分けられなければ null（欄全体に置く）。分けられたのに、どれかの空きに置けなければ "fail"（置かずに「置けなかった」）
 * - 区切りの字に元号が刷ってあり（「昭和　年」）、値の元号が違えば "era"（刷ってある元号の後ろにほかの元号の年を書かない。T160）
 */
export function partItems(field: MappingField, lines: readonly string[], pc: PlaceCtx): OverlayItem[] | null | "fail" | "era" {
  if (!PART_SHAPES.includes(field.shape) || field.options.length === 0 || !field.box) return null;
  const image = pc.page.image;
  const boxes = field.optionBoxes ?? [];
  if (boxes.length !== field.options.length || boxes.some((b) => !b)) return null;
  // 元号の選択肢と「西暦」の選択肢（T140。「□西暦 □明治 □大正…」のように西暦も □ で選ぶ様式）
  const eraIdx = field.options.flatMap((o, i) => ((ERA_NAMES as readonly string[]).includes(o.normalize("NFKC").trim()) || isWestern(o) ? [i] : []));
  const unitIdx = field.options.flatMap((_, i) => (eraIdx.includes(i) ? [] : [i]));
  if (unitIdx.length === 0) return null;
  const printedEra = unitIdx.map((i) => field.options[i].normalize("NFKC").trim().match(ERA_HEAD)?.[1]).find(Boolean);
  const valueEra = lines.join(" ").normalize("NFKC").trim().match(ERA_HEAD)?.[1];
  if (printedEra && valueEra && printedEra !== valueEra) return "era";
  const parts = splitParts(lines.join(" "), unitIdx.map((i) => field.options[i]));
  if (!parts || parts.length !== unitIdx.length) return null;
  const tolX = 0.6 / image.w;
  const tolY = 0.6 / image.h;
  if (boxes.some((b) => !inside(b!, field.box!, tolX, tolY))) return "fail";
  const out: OverlayItem[] = [];
  // 元号
  const era = parts[0].match(ERA_HEAD)?.[1];
  if (era) {
    let eraBox: FieldBox | null = null;
    const opt = eraIdx.find((i) => field.options[i].normalize("NFKC").trim() === era);
    const western = eraIdx.find((i) => isWestern(field.options[i]));
    if (opt !== undefined) eraBox = boxes[opt];
    else if (western !== undefined) {
      // 値の元号の □ が無く「西暦」の □ がある（令和の日付を元号が平成までの欄に）: 西暦の □ に印、年は西暦の数（T140）
      eraBox = boxes[western];
      parts[0] = westernYear(parts[0]) ?? parts[0];
    } else if (pc.ink) {
      const printed = inkIn(field.box, pc.ink)
        .filter((b) => b.box && !boxes.some((x) => x && inside(b, x)))
        .sort(readingOrder);
      const names = ERA_ROWS[printed.length];
      const k = names ? names.indexOf(era) : -1;
      if (k >= 0) eraBox = printed[k];
    }
    if (eraBox) {
      out.push({ kind: "mark", fieldId: field.id, box: eraBox, mark: markOf(eraBox, image) });
      parts[0] = parts[0].replace(ERA_HEAD, "");
    } else if (westernField(field)) parts[0] = westernYear(parts[0]) ?? parts[0];
    else if (era === "令和") parts[0] = parts[0].replace(ERA_HEAD, "");
    // ほかの元号で □ が無ければ、元号ごと年の空きに（入らなければ下で fail）
  }
  for (const [k, part] of parts.entries()) {
    const own = boxes[unitIdx[k]]!;
    const t = placeText(field.id, [part], own, pc, { own: field.box }) ?? placeText(field.id, [part], grownPart(own, field.box, boxes, pc), pc, { own: field.box });
    if (!t) return "fail";
    out.push({ ...t, part: unitIdx[k] });
  }
  return evenParts(out, field.id, pc, field.box);
}

/**
 * 区切りの空きの場所（AI が読んだ物）を、同じ行の印刷の字・ほかの空きに当たるまで左右に広げる（T133。欄の枠の中だけ）。
 * AI の読む空きは実際の空きより狭いことがある（「年」と「月」の間の 4mm に 3mm の空き）
 */
function grownPart(part: FieldBox, fieldBox: FieldBox, parts: ReadonlyArray<FieldBox | null>, pc: PlaceCtx): FieldBox {
  const cx = part.x + part.w / 2;
  const row = (b: FieldBox) => b.y < part.y + part.h && part.y < b.y + b.h;
  const stops = [...(pc.ink ? inkIn(fieldBox, pc.ink).filter((b) => !b.line) : []), ...parts.filter((b): b is FieldBox => !!b && b !== part)].filter(row);
  let left = fieldBox.x;
  let right = fieldBox.x + fieldBox.w;
  for (const b of stops) {
    if (b.x + b.w <= cx) left = Math.max(left, b.x + b.w);
    else if (b.x >= cx) right = Math.min(right, b.x);
  }
  left = Math.min(left, part.x);
  right = Math.max(right, part.x + part.w);
  return { x: left, y: part.y, w: right - left, h: part.h };
}

const DATE_VALUE = /\d+\s*年\s*\d+\s*月\s*\d+\s*日/;

/** 元号の初めの年（西暦）。和暦の年を西暦にする（T140） */
const ERA_START: Record<(typeof ERA_NAMES)[number], number> = { 明治: 1868, 大正: 1912, 昭和: 1926, 平成: 1989, 令和: 2019 };
/** 「西暦」の選択肢 */
const isWestern = (o: string) => /^西暦$/.test(o.normalize("NFKC").trim());
/** 西暦で書く欄（欄の名前・段に「西暦」。「生年月日（西暦）」） */
const westernField = (field: Pick<MappingField, "label" | "section">) => /西暦/.test(`${field.section} ${field.label}`);

/** 年の値（「昭和17」「令和8」「令和元」）を西暦の数に。元号が無ければ null */
export function westernYear(year: string): string | null {
  const m = year.normalize("NFKC").trim().match(/^(明治|大正|昭和|平成|令和)\s*(\d{1,2}|元)$/);
  if (!m) return null;
  const n = m[2] === "元" ? 1 : Number(m[2]);
  return String(ERA_START[m[1] as (typeof ERA_NAMES)[number]] + n - 1);
}

const WAREKI_DATE = /^(明治|大正|昭和|平成|令和)\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(.*)$/;
/** 「8 桁」「YYYYMMDD」: 数だけ 8 字で書く欄（災害診療記録のメディカル ID の西暦生年月日） */
const EIGHT_DIGITS = /8\s*桁|YYYYMMDD/i;

/**
 * 西暦で書く欄（欄の名前・段に「西暦」）で、区切りの選択肢の無い日付の欄の値を西暦に（T160）。区切りの選択肢のある欄は partItems が年だけ西暦にする。
 * 欄の名前に「8 桁」があれば数だけの 8 字（19420418）、無ければ「1942年4月18日」。和暦の日付でない値・ほかの欄はそのまま
 */
export function westernDateLines(field: Pick<MappingField, "label" | "section" | "shape" | "options">, lines: readonly string[]): string[] {
  if (!westernField(field) || field.options.length > 0 || lines.length !== 1) return [...lines];
  if (!(field.shape === "date" || /年月日|日付/.test(field.label))) return [...lines];
  const m = lines[0].normalize("NFKC").trim().match(WAREKI_DATE);
  if (!m) return [...lines];
  const y = westernYear(`${m[1]}${m[2]}`);
  if (!y) return [...lines];
  const rest = m[5].trim();
  const date = EIGHT_DIGITS.test(`${field.section} ${field.label}`) ? `${y}${m[3].padStart(2, "0")}${m[4].padStart(2, "0")}` : `${y}年${m[3]}月${m[4]}日`;
  return [rest ? `${date} ${rest}` : date];
}

/**
 * 区切りの場所の無い日付の欄（T133）: 欄の中の印刷の字が 1 行に 3 字（年・月・日）だけなら、それぞれの字の前の空きに年・月・日を置く。
 * 3 字でなければ null（ほかの置き方へ）。分けたのに入らなければ "fail"。元号の □ が無いので、今の元号（令和）は数だけ、ほかの元号は年の空きに元号ごと
 */
export function inkDateParts(field: MappingField, lines: readonly string[], pc: PlaceCtx): OverlayItem[] | null | "fail" {
  const box = field.box;
  const value = lines.join(" ");
  if (!box || !pc.ink || (field.optionBoxes ?? []).some(Boolean) || !(field.shape === "date" || DATE_VALUE.test(value.normalize("NFKC")))) return null;
  const parts = splitParts(value, ["年", "月", "日"]);
  if (!parts) return null;
  const image = pc.page.image;
  const glyphs = inkIn(box, pc.ink)
    .filter((b) => !b.line && !b.box)
    .sort((a, b) => a.x - b.x);
  // 字ごとにまとめる（横に 0.4mm より近いかたまりは 1 字）
  const gap = 0.4 / image.w;
  const chars: FieldBox[] = [];
  for (const g of glyphs) {
    const last = chars[chars.length - 1];
    if (last && g.x <= last.x + last.w + gap) {
      const x1 = Math.max(last.x + last.w, g.x + g.w);
      const y0 = Math.min(last.y, g.y);
      const y1 = Math.max(last.y + last.h, g.y + g.h);
      chars[chars.length - 1] = { x: last.x, y: y0, w: x1 - last.x, h: y1 - y0 };
    } else chars.push({ x: g.x, y: g.y, w: g.w, h: g.h });
  }
  // 1 行に並ぶこと（縦の真ん中が近い）
  const mid = chars.map((c) => c.y + c.h / 2);
  if (chars.length < 3 || Math.max(...mid) - Math.min(...mid) > Math.max(...chars.map((c) => c.h))) return null;
  // T140: 4 字のかたまり。頭が 2 字の幅（刷ってある元号「令和 年 月 日」「西暦 年 月 日」）なら、その後ろの 3 つが年・月・日。
  // 4 つ目が 1 字（「年 月 日 生」）なら頭の 3 つ。5 つ以上は分けない
  let unitChars = chars;
  let left = box.x;
  let printedEra = false;
  if (chars.length === 4) {
    const median = chars
      .slice(1)
      .map((c) => c.w)
      .sort((a, b) => a - b)[1];
    if (chars[0].w > 1.6 * median) {
      unitChars = chars.slice(1);
      left = chars[0].x + chars[0].w;
      printedEra = true;
    } else unitChars = chars.slice(0, 3);
  } else if (chars.length !== 3) return null;
  const era = parts[0].match(ERA_HEAD)?.[1];
  if (westernField(field)) parts[0] = westernYear(parts[0]) ?? parts[0];
  else if (era === "令和") parts[0] = parts[0].replace(ERA_HEAD, "");
  // 刷ってある元号の後ろの空きに、ほかの元号の年は書かない（刷ってある元号を読めないので、今の元号の日付だけ）
  else if (printedEra) return "fail";
  const out: OverlayItem[] = [];
  for (const [k, c] of unitChars.entries()) {
    const slot = { x: left, y: box.y, w: c.x - left, h: box.h };
    left = c.x + c.w;
    const t = slot.w > 0 ? placeText(field.id, [parts[k]], slot, pc, { own: box }) : null;
    if (!t) return "fail";
    out.push({ ...t, part: k, shifted: true });
  }
  return evenParts(out, field.id, pc, box);
}

/** 電話番号の値（局番・市内・番号。「（089）000-0001」も） */
const PHONE_VALUE = /^[（(]?\s*(\d{2,5})\s*[）)]?\s*[-‐－−ー―]?\s*(\d{1,4})\s*[-‐－−ー―]\s*(\d{3,4})$/;

/** 刷ってある区切りの見分け（T168）。mm。字のまわりに空きが無い線は字のかけら、同じ高さに無い 2 つは区切りの組でない */
const SEP_CLEAR_MM = 0.6;
const SEP_NEAR_Y_MM = 1;
const SEP_MIN_W_MM = 0.8;
const SEP_SAME_ROW_MM = 1;
const PAREN_MIN_GAP_MM = 4;

/**
 * 字のかたまりから離れた印か（T168）。評価の 8 回目で、欄の左上に刷ってある小さな見出し（「住所・連絡先」）の字の横線 2 つを「　−　−　」の
 * 区切りと読み、狭い空きに番号が入らず連絡先が置けなかった。本当の区切りは左右・上下に字が接していない
 */
function loneGlyph(g: InkBlob, glyphs: readonly InkBlob[], image: { w: number; h: number }): boolean {
  const dx = SEP_CLEAR_MM / image.w;
  const dy = SEP_NEAR_Y_MM / image.h;
  return glyphs.every((o) => o === g || o.x > g.x + g.w + dx || o.x + o.w < g.x - dx || o.y > g.y + g.h + dy || o.y + o.h < g.y - dy);
}

/**
 * 区切りの場所の無い電話の欄（T140）: 欄の中に刷ってある区切り（「　−　−　」の 2 つの横棒、「（　）　−　」の括弧と横棒、「（　）」だけ）を
 * 頁の印刷の字の形から見分け、局番・市内・番号をそれぞれの空きに置く。区切りが見分けられない・値が 1 つの電話番号でなければ null（ほかの置き方へ）。
 * 分けたのにどれかの空きに入らなければ "fail"
 */
export function inkPhoneParts(field: MappingField, lines: readonly string[], pc: PlaceCtx): OverlayItem[] | null | "fail" {
  const box = field.box;
  if (!box || !pc.ink || field.shape !== "phone" || (field.optionBoxes ?? []).some(Boolean) || lines.length !== 1) return null;
  // 同じ書く所に別の欄（「住所・連絡先」の 1 つの枠）がある欄は、局番ごとの空きを持つ欄でない（行に重ねて置く。sharedBoxes）
  if ((pc.others ?? []).some((o) => o.id !== field.id && sameArea(o.box, box))) return null;
  // 行の終わりの添え（携帯・固定）は外して照らす（携帯だけの連絡先の行は「090-… 携帯」）
  const m = lines[0]
    .normalize("NFKC")
    .trim()
    .replace(/\s*(携帯|固定|自宅|電話)$/, "")
    .match(PHONE_VALUE);
  if (!m) return null;
  const image = pc.page.image;
  const glyphs = inkIn(box, pc.ink).filter((b) => !b.line && !b.box);
  const boxH = box.h * image.h;
  const hyphens = glyphs
    .filter((g) => g.w * image.w >= SEP_MIN_W_MM && g.w * image.w >= 1.5 * g.h * image.h && g.h * image.h <= 0.35 * boxH && loneGlyph(g, glyphs, image))
    .sort((a, b) => a.x - b.x);
  const parens = glyphs.filter((g) => g.h * image.h >= 1.8 * g.w * image.w && g.h * image.h >= 0.25 * boxH).sort((a, b) => a.x - b.x);
  const right = box.x + box.w;
  const midY = (g: InkBlob) => (g.y + g.h / 2) * image.h;
  /** 2 つの印の間に字が無いか（数を書く空き） */
  const emptyBetween = (a: InkBlob, b: InkBlob) => !glyphs.some((g) => g !== a && g !== b && g.x + g.w > a.x + a.w && g.x < b.x);
  let slots: FieldBox[] | null = null;
  let values: string[];
  if (parens.length === 2 && hyphens.length <= 1) {
    const [p1, p2] = parens;
    // 間に字のある縦の線・近すぎる線（字のかけら）は括弧の組でない
    if (Math.abs(midY(p1) - midY(p2)) > SEP_SAME_ROW_MM || (p2.x - (p1.x + p1.w)) * image.w < PAREN_MIN_GAP_MM || !emptyBetween(p1, p2)) return null;
    const h = hyphens.find((x) => x.x > p2.x);
    slots = h
      ? [
          { x: p1.x + p1.w, y: box.y, w: p2.x - (p1.x + p1.w), h: box.h },
          { x: p2.x + p2.w, y: box.y, w: h.x - (p2.x + p2.w), h: box.h },
          { x: h.x + h.w, y: box.y, w: right - (h.x + h.w), h: box.h },
        ]
      : [
          { x: p1.x + p1.w, y: box.y, w: p2.x - (p1.x + p1.w), h: box.h },
          { x: p2.x + p2.w, y: box.y, w: right - (p2.x + p2.w), h: box.h },
        ];
    values = h ? [m[1], m[2], m[3]] : [m[1], `${m[2]}-${m[3]}`];
  } else if (parens.length === 0 && hyphens.length === 2) {
    const [h1, h2] = hyphens;
    if (Math.abs(midY(h1) - midY(h2)) > SEP_SAME_ROW_MM || !emptyBetween(h1, h2)) return null;
    slots = [
      { x: box.x, y: box.y, w: h1.x - box.x, h: box.h },
      { x: h1.x + h1.w, y: box.y, w: h2.x - (h1.x + h1.w), h: box.h },
      { x: h2.x + h2.w, y: box.y, w: right - (h2.x + h2.w), h: box.h },
    ];
    values = [m[1], m[2], m[3]];
  } else return null;
  const out: OverlayItem[] = [];
  for (const [k, slot] of slots.entries()) {
    const t = slot.w > 0 ? placeText(field.id, [values[k]], slot, pc, { own: box }) : null;
    if (!t) return "fail";
    out.push({ ...t, part: k, shifted: true });
  }
  return evenParts(out, field.id, pc, box);
}

/**
 * 1 字ずつのマスの欄（T160）: 欄の中に、欄の高さの 7 割より高い縦の罫線が「字の数 − 1」本あり、欄を幅の近いマスに分けていれば、
 * 数だけの値（2〜16 字）を 1 字ずつマスに置く（災害診療記録のメディカル ID の「西暦生年月日 8 桁」）。形が合わなければ null。
 * 分けたのにどれかのマスに入らなければ "fail"
 */
export function combItems(field: MappingField, lines: readonly string[], pc: PlaceCtx): OverlayItem[] | null | "fail" {
  const box = field.box;
  if (!box || !pc.ink || (field.optionBoxes ?? []).some(Boolean) || lines.length !== 1) return null;
  const digits = lines[0].normalize("NFKC").trim();
  if (!/^[0-9]{2,16}$/.test(digits)) return null;
  const image = pc.page.image;
  const tall = inkIn(box, pc.ink)
    .filter((b) => b.line && b.h >= 0.7 * box.h && b.w * image.w <= 0.6 && b.x > box.x + 0.5 / image.w && b.x + b.w < box.x + box.w - 0.5 / image.w)
    .sort((a, b) => a.x - b.x);
  // 近い縦線（太い線の 2 つのかたまり）は 1 本に
  const rules: FieldBox[] = [];
  for (const b of tall) {
    const last = rules[rules.length - 1];
    if (last && b.x <= last.x + last.w + 0.5 / image.w) rules[rules.length - 1] = { ...last, w: Math.max(last.x + last.w, b.x + b.w) - last.x };
    else rules.push(b);
  }
  if (rules.length !== digits.length - 1) return null;
  const edges = [box.x, ...rules.flatMap((r) => [r.x, r.x + r.w]), box.x + box.w];
  const cells: FieldBox[] = [];
  for (let k = 0; k < digits.length; k++) cells.push({ x: edges[2 * k], y: box.y, w: edges[2 * k + 1] - edges[2 * k], h: box.h });
  const widths = cells.map((c) => c.w);
  if (Math.min(...widths) <= 0 || Math.max(...widths) > 1.6 * Math.min(...widths)) return null;
  const out: OverlayItem[] = [];
  for (const [k, cell] of cells.entries()) {
    const t = placeText(field.id, [digits[k]], cell, pc, { own: box });
    if (!t) return "fail";
    out.push({ ...t, part: k });
  }
  return evenParts(out, field.id, pc, box);
}

/** 元の様式の上に置く紙にできるか（頁の画像があり、場所のある欄が 1 つ以上）。できなければ前からの 2 列の紙 */
export function canOverlay(fields: readonly MappingField[], images: readonly PageImage[] | null): images is readonly PageImage[] {
  return images !== null && images.length > 0 && fields.some((f) => !f.removed && (f.box ?? null) !== null);
}
