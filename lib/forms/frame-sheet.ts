// 原本の枠に値を置く紙（T101、docs/DECISIONS.md「書類」）。計画書（松山市）と医療要約（災害診療記録2018）の原本の頁を下に敷き、
// 原本から起こした欄の矩形（lib/forms/frame-matsuyama.ts・frame-kiroku.ts、mm）に台帳の値を置く。枠は原本の物で、1 本も動かさない。
// 値は前からの紙面と同じ欄の値（buildMatsuyamaSheet・buildMedicalSummary の cells）。紙面の部品は T86 の OverlaySheet をそのまま使う。
// サーバーの描画で、Claude は呼ばない（氏名・住所・電話が入る）。純な計算だけ。
//
// 決まり:
// - 字の欄は矩形に収まる大きさ（様式の地の字の大きさから 6pt まで）に縮める。6pt でも収まらなければ欄に「別紙」、値は最後の別紙の頁（T86 と同じ）
// - 選ぶ欄は選んだ選択肢の □ にレ点（□ の無い選択肢は字を丸で囲む）。選択肢の（ ）の中身は（ ）の矩形に
// - 様式に置き場の無い値（□ の無い選択肢の中身・書き足し・3 人目からの関係先）は、様式の書き込みの欄（松山市は特記事項）に名前を添えて足す。
//   書き込みの欄が無い様式・書き込みの欄に収まらないときは別紙へ（値を落とさない）
// - 未確認・同意の無い欄・手書きの欄は空ける（紙に「未確認」を刷らない。T86）。数と名前は画面の上の帯にだけ
// - 未記入の色付けの版（?fill=1）は、帯の未確認と同じ欄（isUnconfirmedCell）の矩形の内側を塗る（FILL_INSET_MM だけ罫線から離す）

import { BLANK, type Cell, type Choice, type Piece } from "./matsuyama.ts";
import type { FieldBox } from "./mapping.ts";
import type { OriginalId } from "./originals.ts";
import {
  ANNEX_MARK,
  cellLines,
  FILL_INSET_MM,
  fitText,
  FONT_MIN_PT,
  insetBox,
  lineText,
  type AnnexRow,
  type OverlayItem,
  type OverlayPage,
  type OverlaySheet,
} from "./overlay-sheet.ts";
import { isUnconfirmedCell } from "./unconfirmed.ts";
import type { ConsentKind } from "../db/types.ts";

/** 頁の左上を原点の mm の矩形 */
export type MmBox = { x: number; y: number; w: number; h: number };

/** 左上と右下（mm）から矩形 */
export const mm = (x0: number, y0: number, x1: number, y1: number): MmBox => ({
  x: x0,
  y: y0,
  w: Math.round((x1 - x0) * 100) / 100,
  h: Math.round((y1 - y0) * 100) / 100,
});

/**
 * 原本の □ の絵（「□ 」の画像。左上 ix・iy、高さ ih mm）から □ の部分。□ は画像の高さの 0.92 の正方形で、左上から高さの 0.04 の所
 * （松山市の PDF の □ の画像を 600dpi で描いて測った）
 */
export const checkBox = (ix: number, iy: number, ih: number): MmBox => ({
  x: Math.round((ix + ih * 0.04) * 100) / 100,
  y: Math.round((iy + ih * 0.04) * 100) / 100,
  w: Math.round(ih * 0.92 * 100) / 100,
  h: Math.round(ih * 0.92 * 100) / 100,
});

/**
 * 値のどこを取るか。family・given は氏名を最初の空白で分けた前と後（空白が無ければ全部が family）。
 * ey・y・m・d は「（元号）N 年 N 月 N 日」の元号つきの年・年・月・日（形が違えば y・ey に全部）。num は「N 階」の数（形が違えば全部）。
 * age は「N 歳」の数。after は選ぶ欄の書き足し。line と name・tel は関係先の何行目の名前と TEL の後（TEL の無い行は全部が name）。
 * char は空白を除いた字の index 字目（1 字ずつの枠）
 */
export type Take = {
  line?: number;
  part?: "family" | "given" | "ey" | "y" | "m" | "d" | "age" | "num" | "after" | "name" | "tel" | "char";
  /** char の何字目（0 から。メディカル ID の 1 字ずつの枠） */
  index?: number;
};

export type FrameSlot<K extends string> =
  /** 字を書く矩形。keys が 2 つ以上なら 1 つの欄に順に書く（labels で欄の名前を頭に）。id は書き込みの欄（extras）・避難経路の印 */
  | { kind: "text"; keys: readonly K[]; page: number; box: MmBox; take?: Take; labels?: true; id?: string; prefix?: string }
  /**
   * 選択肢の □（option は「高齢者/独居」のように中の選択肢を / でつなぐ）。値の欄は * で値があれば印、=N:X で N 字目が X なら印。
   * shape は印の形（既定は □ の形ならレ点、字の場所なら丸。markOf）
   */
  | { kind: "mark"; key: K; page: number; option: string; box: MmBox; shape?: "check" | "circle" }
  /** 選択肢の（ ）の中 */
  | { kind: "detail"; key: K; page: number; option: string; box: MmBox }
  /** 画像の受け口（避難経路の地図） */
  | { kind: "image"; key: K; page: number; slot: string; box: MmBox };

/** 欄の矩形（色付けで塗る所）。ruled は 4 辺が原本の罫線の中心（手元のテストが原本と照らす） */
export type FrameArea<K extends string> = { keys: readonly K[]; page: number; box: MmBox; ruled: boolean };

export type Frame<K extends string> = {
  original: OriginalId;
  /** 頁の大きさ（mm。原本の PDF の頁） */
  pages: ReadonlyArray<{ page: number; w: number; h: number }>;
  /** 値の字の上限（pt。様式の地の字の大きさ） */
  maxPt: number;
  /** 様式に置き場の無い値を書く欄（text の id）。無ければ別紙へ */
  extras?: string;
  slots: ReadonlyArray<FrameSlot<K>>;
  areas: ReadonlyArray<FrameArea<K>>;
};

/** 欄の定義のうち使う所（様式の順） */
export type FrameField<K extends string> = { key: K; label: string; handwrite?: boolean };

/** 避難経路の地図の画像（T102 が渡す。src は同じ origin の URL か data: の URL） */
export type SlotImage = { src: string; alt: string };

export type FrameSheetInput<K extends string> = {
  frame: Frame<K>;
  personId: string;
  name: string;
  title: string;
  issuer: string;
  /** 欄（様式の順）。label は別紙と書き込みの欄に添える名前 */
  fields: ReadonlyArray<FrameField<K>>;
  cells: Record<K, Cell>;
  /** 下に敷く頁（取り込んだ原本の頁） */
  pages: readonly number[];
  /** 画像の受け口（slot の名前 → 画像）。無ければ空ける */
  images?: Readonly<Record<string, SlotImage | null | undefined>>;
  /** 選ぶ欄の書き足しを書かない欄（同意の記録の日など、様式の値でないケア72 の添え） */
  dropAfter?: ReadonlySet<K>;
  /** 別紙があれば印を付ける選ぶ欄（松山市の特記事項の「別紙（あり・なし）」） */
  annexChoice?: { key: K; yes: string; no: string };
  unconfirmed: string[];
  unmapped?: string[];
  withheld: ConsentKind[];
};

const toRatio = (b: MmBox, page: { w: number; h: number }): FieldBox => ({ x: b.x / page.w, y: b.y / page.h, w: b.w / page.w, h: b.h / page.h });

const WS = /[\s　]+/;
const DATE = /(?:(大正|昭和|平成|令和)\s*)?(\d+|元)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/;

/** 選ぶ欄の選択肢を、中の選択肢まで「親/子」の名前で並べる */
function walk(options: readonly Choice[], parent = ""): Array<{ path: string; c: Choice }> {
  return options.flatMap((c) => {
    const path = parent ? `${parent}/${c.label}` : c.label;
    return [{ path, c }, ...(c.sub ? walk(c.sub, path) : [])];
  });
}

/** 選ぶ欄の書き足し（after）の字。「なし」だけなら空（□ が空いていることで分かる） */
function afterText(cell: Cell): string {
  if (cell.kind !== "choice" || !cell.after) return "";
  const s = lineText(cell.after);
  return s === BLANK.none ? "" : s;
}

/** 1 行の言葉を TEL の添えの前（名前）と後（番号）に分ける */
function splitTel(line: readonly Piece[]): { name: string; tel: string } {
  const at = line.findIndex((p) => p.sub && p.text === "TEL");
  if (at < 0) return { name: lineText(line), tel: "" };
  return { name: lineText(line.slice(0, at)), tel: lineText(line.slice(at + 1)) };
}

/** 欄の値から、take で決めた所の字の行 */
export function takeLines(cell: Cell, take: Take | undefined): string[] {
  if (cell.kind === "handwrite" || cell.kind === "withheld" || cell.kind === "unconfirmed") return [];
  if (!take || (take.part === undefined && take.line === undefined)) return cellLines(cell);
  if (take.part === "after") {
    const s = afterText(cell);
    return s ? [s] : [];
  }
  if (take.part === "name" || take.part === "tel") {
    if (cell.kind !== "value") return take.part === "name" && (take.line ?? 0) === 0 ? cellLines(cell) : [];
    const line = cell.lines[take.line ?? 0];
    if (!line) return [];
    const s = splitTel(line)[take.part];
    return s ? [s] : [];
  }
  // 日付・氏名・階は、選ぶ欄なら書き足し（生年月日の「15 年 3 月 2 日」）、値の欄なら全部を 1 行に
  const text = cell.kind === "choice" ? afterText(cell) : cellLines(cell).join(" ");
  if (!text) return [];
  switch (take.part) {
    case "family":
    case "given": {
      const [head, ...rest] = text.trim().split(WS);
      const s = take.part === "family" ? (rest.length > 0 ? head : text.trim()) : rest.join(" ");
      return s ? [s] : [];
    }
    case "ey":
    case "y":
    case "m":
    case "d": {
      const m = DATE.exec(text);
      if (!m) return take.part === "y" || take.part === "ey" ? [text] : [];
      const s = take.part === "ey" ? `${m[1] ?? ""}${m[2]}` : take.part === "y" ? m[2] : take.part === "m" ? m[3] : m[4];
      return [s];
    }
    case "age": {
      const m = /(\d+)\s*歳/.exec(text);
      return m ? [m[1]] : [];
    }
    case "char": {
      const ch = [...text.replace(/[\s　]/gu, "")][take.index ?? 0];
      return ch ? [ch] : [];
    }
    case "num": {
      const m = /^\s*(\d+)\s*階\s*$/.exec(text);
      return [m ? m[1] : text];
    }
    default:
      return cellLines(cell);
  }
}

/** 値の欄で、line を指定した字の矩形に載らない行（3 人目からの関係先など） */
function leftoverLines(cell: Cell, used: ReadonlySet<number>): string[] {
  if (cell.kind !== "value") return [];
  return cell.lines.flatMap((l, i) => (used.has(i) ? [] : [lineText(l)])).filter((s) => s !== "");
}

/**
 * 原本の枠に値を置いた紙を作る。紙面の部品は T86 の OverlaySheet（頁の画像の箱は頁いっぱい、矩形は頁の比）
 */
export function buildFrameSheet<K extends string>(input: FrameSheetInput<K>): OverlaySheet {
  const { frame, cells, fields } = input;
  const nameOf = new Map(fields.map((f) => [f.key, f.label]));
  const handwrite = new Set(fields.filter((f) => f.handwrite).map((f) => f.key));
  const order = new Map(fields.map((f, i) => [f.key, i]));

  const pages: OverlayPage[] = frame.pages
    .filter((p) => input.pages.includes(p.page))
    .map((p) => ({ page: p.page, landscape: false, image: { x: 0, y: 0, w: p.w, h: p.h }, items: [], fills: [] }));
  const pageOf = (n: number) => pages.find((p) => p.page === n) ?? null;
  const sizeOf = (n: number) => frame.pages.find((p) => p.page === n)!;

  const annex: AnnexRow[] = [];
  /** 様式に置き場の無い値（名前つきの 1 行）。様式の順に並べ直して書き込みの欄へ */
  const extras: Array<{ key: K; text: string }> = [];
  const addExtra = (key: K, text: string) => {
    if (text) extras.push({ key, text });
  };

  // ---- 選ぶ欄: □ と（ ）----
  const markSlots = frame.slots.filter((s): s is Extract<FrameSlot<K>, { kind: "mark" }> => s.kind === "mark");
  const detailSlots = frame.slots.filter((s): s is Extract<FrameSlot<K>, { kind: "detail" }> => s.kind === "detail");
  const textSlots = frame.slots.filter((s): s is Extract<FrameSlot<K>, { kind: "text" }> => s.kind === "text");
  const choiceKeys = new Set<K>([...markSlots.map((s) => s.key), ...detailSlots.map((s) => s.key)]);
  const annexChoice = input.annexChoice;
  // 値の欄の □（アレルギーなど）: 値があれば印
  for (const slot of markSlots) {
    const cell = cells[slot.key];
    const page = pageOf(slot.page);
    if (!cell || !page || handwrite.has(slot.key) || cell.kind !== "value" || !(slot.option === "*" || slot.option.startsWith("="))) continue;
    const lines = cellLines(cell);
    const eq = /^=(\d+):(.+)$/.exec(slot.option);
    const on = eq ? takeLines(cell, { part: "char", index: Number(eq[1]) })[0] === eq[2] : lines.length > 0;
    if (on) page.items.push({ kind: "mark", fieldId: `${slot.key}:${slot.option}`, box: toRatio(slot.box, sizeOf(slot.page)), mark: slot.shape ?? markOf(slot.box) });
  }
  for (const key of choiceKeys) {
    if (annexChoice && key === annexChoice.key) continue; // 別紙の印は最後に（別紙があるかが決まってから）
    const cell = cells[key];
    if (!cell || cell.kind !== "choice" || handwrite.has(key)) continue;
    for (const { path, c } of walk(cell.options)) {
      if (!c.on) continue;
      const mark = markSlots.find((s) => s.key === key && s.option === path);
      const page = mark ? pageOf(mark.page) : null;
      if (mark && page) {
        const box = toRatio(mark.box, sizeOf(mark.page));
        page.items.push({ kind: "mark", fieldId: `${key}:${path}`, box, mark: mark.shape ?? markOf(mark.box) });
      } else if (!c.sub?.some((x) => x.on)) {
        // □ の無い選択肢（中の選択肢を選んだ物は中の □ で分かる）
        addExtra(key, c.label);
      }
      if (c.detail) {
        const slot = detailSlots.find((s) => s.key === key && s.option === path);
        if (slot && pageOf(slot.page)) placeText(slot.page, slot.box, [c.detail], `${key}:${path}:detail`, `${nameOf.get(key) ?? key} ${c.label}`);
        else addExtra(key, `${c.label}（${c.detail}）`);
      }
    }
    // 書き足し: 同じ欄の字の矩形（生年月日の年月日・性別の書き足し）が無ければ書き込みの欄へ
    const after = afterText(cell);
    if (after && !input.dropAfter?.has(key) && !textSlots.some((s) => s.keys.includes(key))) addExtra(key, after);
  }

  // ---- 字の欄 ----
  const routeImage = frame.slots.find((s): s is Extract<FrameSlot<K>, { kind: "image" }> => s.kind === "image");
  const routePic = routeImage ? input.images?.[routeImage.slot] : null;
  const usedLines = new Map<K, Set<number>>();
  const deferred: Array<{ slot: Extract<FrameSlot<K>, { kind: "text" }>; lines: string[] }> = [];
  for (const slot of textSlots) {
    const lines: string[] = [];
    for (const key of slot.keys) {
      const cell = cells[key];
      if (!cell || handwrite.has(key)) continue;
      if (slot.take?.line !== undefined) {
        const set = usedLines.get(key) ?? new Set<number>();
        set.add(slot.take.line);
        usedLines.set(key, set);
      }
      const got = takeLines(cell, slot.take);
      if (got.length === 0) continue;
      if (slot.labels) lines.push(`${nameOf.get(key) ?? key} ${got[0]}`, ...got.slice(1));
      else if (slot.prefix) lines.push(`${slot.prefix}${got[0]}`, ...got.slice(1));
      else lines.push(...got);
    }
    if (slot.id && slot.id === frame.extras) {
      deferred.push({ slot, lines });
      continue;
    }
    if (lines.length === 0) continue;
    let box = slot.box;
    // 避難経路: 地図があれば欄の上に文（最大 12mm）、残りに地図
    if (routeImage && routePic && slot.id === "route") box = { ...box, h: Math.min(box.h, 12) };
    placeText(slot.page, box, lines, slot.keys.join("+") + (slot.take ? `:${slot.take.part ?? ""}${slot.take.line ?? ""}${slot.take.index ?? ""}` : ""), slot.keys.map((k) => nameOf.get(k) ?? k).join("・"));
  }
  // 様式に置き場の無い欄（矩形も □ も無い欄。医療要約の住まい・薬の用量など）は全部を書き込みの欄か別紙へ
  const placedKeys = new Set<K>(frame.slots.flatMap((s) => (s.kind === "text" ? [...s.keys] : [s.key])));
  for (const f of fields) {
    if (placedKeys.has(f.key) || handwrite.has(f.key) || !cells[f.key]) continue;
    for (const s of takeLines(cells[f.key], undefined)) addExtra(f.key, s);
  }
  // 値の欄の、矩形に載らない行（3 人目からの関係先）
  for (const [key, used] of usedLines) {
    for (const s of leftoverLines(cells[key], used)) addExtra(key, s);
  }

  // ---- 避難経路の地図（T102 の受け口）----
  if (routeImage && routePic) {
    const page = pageOf(routeImage.page);
    const hasText = cells[routeImage.key] && takeLines(cells[routeImage.key], undefined).length > 0;
    const top = hasText ? 12.2 : 0;
    const b = routeImage.box;
    if (page) {
      page.items.push({
        kind: "image",
        fieldId: `${routeImage.key}:${routeImage.slot}`,
        box: toRatio({ x: b.x, y: b.y + top, w: b.w, h: b.h - top }, sizeOf(routeImage.page)),
        slot: routeImage.slot,
        src: routePic.src,
        alt: routePic.alt,
      });
    }
  }

  // ---- 書き込みの欄（様式に置き場の無い値を足す）----
  extras.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  for (const { slot, lines } of deferred) {
    const all = [...lines, ...extras.map((e) => `${nameOf.get(e.key) ?? e.key} ${e.text}`)];
    if (all.length > 0) placeText(slot.page, slot.box, all, slot.id!, slot.keys.map((k) => nameOf.get(k) ?? k).join("・"));
  }
  if (deferred.length === 0) {
    // 同じ欄の行は 1 つの行に
    for (const e of extras) {
      const row = annex.find((r) => r.fieldId === `${e.key}:extra`);
      if (row) row.lines.push(e.text);
      else annex.push({ fieldId: `${e.key}:extra`, label: nameOf.get(e.key) ?? e.key, lines: [e.text], reason: "unplaced" });
    }
  }

  // ---- 別紙の印（別紙の頁があれば あり）----
  if (annexChoice) {
    const cell = cells[annexChoice.key];
    const yes = annex.length > 0 || (cell?.kind === "choice" && cell.options.some((o) => o.label === annexChoice.yes && o.on));
    const option = yes ? annexChoice.yes : annexChoice.no;
    const slot = markSlots.find((s) => s.key === annexChoice.key && s.option === option);
    const page = slot ? pageOf(slot.page) : null;
    if (slot && page) page.items.push({ kind: "mark", fieldId: `${annexChoice.key}:${option}`, box: toRatio(slot.box, sizeOf(slot.page)), mark: markOf(slot.box) });
  }

  // ---- 未記入の色付け（帯の未確認と同じ欄）----
  for (const area of frame.areas) {
    const page = pageOf(area.page);
    if (!page) continue;
    const keys = area.keys.filter((k) => !handwrite.has(k) && cells[k] && isUnconfirmedCell(cells[k]));
    if (keys.length === 0) continue;
    const inner = insetBox(toRatio(area.box, sizeOf(area.page)), sizeOf(area.page), FILL_INSET_MM);
    if (inner) page.fills.push({ keys: [...keys], box: inner });
  }

  // 別紙は様式の順
  annex.sort((a, b) => (order.get(a.fieldId.split(/[:+]/)[0] as K) ?? 0) - (order.get(b.fieldId.split(/[:+]/)[0] as K) ?? 0));

  return {
    personId: input.personId,
    name: input.name,
    title: input.title,
    issuer: input.issuer,
    typeface: "gothic",
    pages,
    annex,
    unconfirmed: input.unconfirmed,
    unmapped: input.unmapped ?? [],
    withheld: input.withheld,
  };

  /** 矩形に字を置く。収まらなければ欄に「別紙」と書き、値を別紙へ */
  function placeText(pageNo: number, box: MmBox, lines: string[], fieldId: string, label: string) {
    const page = pageOf(pageNo);
    if (!page) {
      annex.push({ fieldId, label, lines, reason: "unplaced" });
      return;
    }
    const ratio = toRatio(box, sizeOf(pageNo));
    const fitted = fitText(lines, box.w, box.h, frame.maxPt);
    if (fitted) {
      page.items.push({ kind: "text", fieldId, box: ratio, ...fitted } satisfies OverlayItem);
      return;
    }
    annex.push({ fieldId, label, lines, reason: "overflow" });
    const mark = fitText([ANNEX_MARK], box.w, box.h, frame.maxPt);
    page.items.push({ kind: "text", fieldId, box: ratio, lines: [ANNEX_MARK], fontPt: mark?.fontPt ?? FONT_MIN_PT, top: mark?.top ?? false });
  }
}

/** □ に近い形（縦横の比が 0.6〜1.6、8mm 以下）ならレ点、字の場所なら丸で囲む（T86 の markOf と同じ決まりを mm で） */
function markOf(b: MmBox): "check" | "circle" {
  return b.w / b.h >= 0.6 && b.w / b.h <= 1.6 && Math.max(b.w, b.h) <= 8 ? "check" : "circle";
}
