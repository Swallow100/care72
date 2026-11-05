// 書類の紙を作ったあとの見直し（T136、docs/DECISIONS.md「書類」）。刷る前に、紙のおかしい所を一覧にしてケアマネが直せるようにする。
// ここは決まりの見直し（コード）で、Claude は呼ばない。紙の画面を開くたびに数える（AI の見直しは lib/forms/review-ai.ts）。
//
// 見る紙は、元の様式の上に値を置いた紙（T86、lib/forms/overlay-sheet.ts）と、原本の枠の紙（T101、lib/forms/frame-sheet.ts）。
// どちらも OverlaySheet の形なので、紙の欄の作り（対応表の欄・原本の枠の欄）を 1 つの形（ReviewField）にそろえてから見る。
// 紙の置き方・入れ方には触らない（置き方は T133、入れ方は T135）。印刷の字の位置（T133 が作る）は printed で受ける。
//
// 見る物（種類と言葉は REVIEW_LABELS）:
// - 未配置: 場所の無い欄の値（対応表の欄に場所が無い）。原本の枠の紙で様式に置き場の無い値は別紙送（参考）
// - 空欄: 台帳に値の無い欄（帯の未確認と同じ欄）
// - 重なり: 置いた字が、ほかの欄の字・印・選ぶ欄の □・印刷の字（printed）と重なる
// - 枠外: 置いた字が欄の矩形からはみ出す（紙では切れて刷れない）
// - 下限: 字の大きさが下限（6pt）
// - 別紙相違: 「別紙 あり・なし」の印と、別紙の頁の有無が合わない
// - 署名欄: 本人が書く欄（署名・自署・押印）に字や印が入った。本人記入: 本人が書く欄の残り（参考）
// - 重複: 同じ値が 2 つの欄に入った
// - 日付形式: 年・月・日の部品のある欄に 1 つの字で置いた、元号が欄の選択肢に無い、年月日の範囲の外
// - 伏字: 紙に（氏名）（町名）（電話）などの伏字・仮の言い方が出ている
// - 取込漏れ: 台帳に値があるのに紙で空いた欄（T133 の台帳あり空欄を受ける。carried）

import { MASK_MARKS } from "../pseudonym/index.ts";
import type { Frame, FrameField } from "./frame-sheet.ts";
import type { MappedSheet } from "./mapped-sheet.ts";
import type { FieldBox, FieldShape } from "./mapping.ts";
import { MATSUYAMA_FIELDS, type Cell, type MatsuyamaKey, type MatsuyamaSheet } from "./matsuyama.ts";
import { MEDICAL_FIELDS, type MedicalKey, type MedicalSummary } from "./medical-summary.ts";
import { ANNEX_MARK, cellLines, FONT_MIN_PT, textEm, type OverlayItem, type OverlaySheet } from "./overlay-sheet.ts";
import { matsuyamaFieldName } from "./unconfirmed.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import { KIROKU_FRAME } from "./frame-kiroku.ts";
import { allowedTwice, extraItemFields } from "./form-shape.ts";

// ---------- 形 ----------

export const RULE_KINDS = ["unplaced", "blank", "overlap", "overflow", "small", "annex", "signature", "self", "duplicate", "date", "masked", "spill", "carried"] as const;
export const AI_KINDS = ["misplaced", "unreadable", "mismatch", "masked"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export type AiKind = (typeof AI_KINDS)[number];
export type ReviewKind = RuleKind | AiKind;

/** 画面の言葉（2〜4 字の漢語） */
export const REVIEW_LABELS: Record<ReviewKind, string> = {
  unplaced: "未配置",
  blank: "空欄",
  overlap: "重なり",
  overflow: "枠外",
  small: "下限",
  annex: "別紙相違",
  signature: "署名欄",
  self: "本人記入",
  duplicate: "重複",
  date: "日付形式",
  masked: "伏字",
  spill: "別紙送",
  carried: "取込漏れ",
  misplaced: "欄違い",
  unreadable: "判読難",
  mismatch: "不一致",
};

/** fix: 要修正（刷ると困る）・check: 要確認・note: 参考（数に入れない） */
export type ReviewLevel = "fix" | "check" | "note";
export const REVIEW_LEVEL_LABELS: Record<ReviewLevel, string> = { fix: "要修正", check: "要確認", note: "参考" };

const LEVEL: Record<RuleKind, ReviewLevel> = {
  unplaced: "check",
  blank: "note",
  overlap: "fix",
  overflow: "fix",
  small: "check",
  annex: "fix",
  signature: "fix",
  self: "note",
  duplicate: "check",
  date: "fix",
  masked: "fix",
  spill: "note",
  carried: "check",
};

/** 見直しの 1 件 */
export type ReviewFinding = {
  /** 同じ紙で同じ物を指す id（確認済の印と、前と後の見比べに使う） */
  id: string;
  by: "rule" | "ai";
  kind: ReviewKind;
  level: ReviewLevel;
  /** 欄（ReviewField の id） */
  field: string;
  /** 欄の名前 */
  label: string;
  page: number | null;
  /** 欄の矩形（頁の画像の比）。押すとここへ */
  box: FieldBox | null;
  /** 紙の上の物（OverlayItem の fieldId。紙の要素の data-field） */
  items: string[];
  /** どこが・なぜ（短い） */
  why: string;
  /** 再考（その欄だけの読み直し）で直せそうか。対応表の紙だけ */
  redo?: boolean;
};

/** 見直しの欄 1 つ。対応表の欄（T86）と原本の枠の欄（T101）を同じ形に */
export type ReviewField = {
  id: string;
  label: string;
  page: number | null;
  /** 欄の矩形（頁の画像の比）。無ければ null */
  box: FieldBox | null;
  shape: FieldShape;
  /** 選ぶ欄の選択肢、区切りの空きの字（年・月・日） */
  options: readonly string[];
  /** 選ぶ欄の □ の場所（刷ってある □） */
  optionBoxes?: ReadonlyArray<FieldBox | null>;
  /** 台帳の元（対応表の項目・原本の枠の欄の key）。台帳に無い欄は null */
  source: string | null;
  /** 欄の値の形（lib/forms/matsuyama.ts の Cell の kind） */
  state: Cell["kind"];
  /** 欄の値の字（紙に書く言葉。cellLines） */
  values: string[];
  /** 印の付いた選択肢 */
  marked: string[];
  /** 本人が書く欄（署名・自署・押印） */
  self: boolean;
};

/** 印刷の字の位置（T133 が原本の頁から取る。無ければ重なりは置いた物どうしと □ だけで見る） */
export type PrintedText = { page: number; box: FieldBox };

export type ReviewSubject = {
  sheet: OverlaySheet;
  fields: ReviewField[];
  /** 紙の上の物の fieldId から欄の id。分からなければ null */
  fieldOf: (itemFieldId: string) => string | null;
  printed?: readonly PrintedText[];
  /**
   * 台帳に値があるのに紙で空いた欄（T133 の「台帳あり空欄」。数え方は T133 が持つ）。渡されれば「取込漏れ」として挙げる
   */
  carried?: readonly string[];
  /** 対応表の紙（AI が読んだ欄の場所と項目。再考で読み直せる） */
  redoable: boolean;
};

// ---------- 欄の作り ----------

/** 本人が書く欄の名前 */
const SELF_LABEL = /署名|自署|記名|押印|捺印|サイン|受付印/;

/** 欄の値の字。印を付けた選択肢の名前 */
function valuesOf(cell: Cell): { values: string[]; marked: string[] } {
  return {
    values: cellLines(cell),
    marked: cell.kind === "choice" ? cell.options.filter((o) => o.on).map((o) => o.label) : [],
  };
}

/** 対応表の紙（T86）の欄。紙の上の物の fieldId は対応表の欄の id */
export function mappedSubject(mapped: MappedSheet, sheet: OverlaySheet, printed?: readonly PrintedText[]): ReviewSubject {
  const fields: ReviewField[] = mapped.pages.flatMap((p) =>
    p.sections.flatMap((s) =>
      s.rows.map(({ field, cell }) => {
        const label = field.section ? `${field.section} ${field.label}` : field.label;
        return {
          id: field.id,
          label,
          page: field.page,
          box: field.box ?? null,
          shape: field.shape,
          options: field.options,
          ...(field.optionBoxes ? { optionBoxes: field.optionBoxes } : {}),
          source: field.item,
          state: cell.kind,
          ...valuesOf(cell),
          self: field.shape === "handwrite" ? SELF_LABEL.test(label) : SELF_LABEL.test(field.label) && field.shape !== "check",
        };
      }),
    ),
  );
  const ids = new Set(fields.map((f) => f.id));
  // 置けなかった欄（T133 の台帳あり空欄。紙を作るときに分かる）は取込漏れに
  const carried = sheet.unplacedIds ?? [];
  return { sheet, fields, fieldOf: (id) => (ids.has(id) ? id : null), ...(printed ? { printed } : {}), ...(carried.length > 0 ? { carried } : {}), redoable: true };
}

const ratio = (b: { x: number; y: number; w: number; h: number }, page: { w: number; h: number }): FieldBox => ({ x: b.x / page.w, y: b.y / page.h, w: b.w / page.w, h: b.h / page.h });

/**
 * 原本の枠の紙（T101）の欄。欄は frame の fields（様式の順）、矩形は欄の区画（areas）か、無ければ字の矩形（slots）。
 * 紙の上の物の fieldId は「欄の key」「key:選択肢」「key1+key2:部品」「書き込みの欄の id」の形（lib/forms/frame-sheet.ts）
 */
export function frameSubject<K extends string>(input: {
  frame: Frame<K>;
  fields: ReadonlyArray<FrameField<K>>;
  cells: Record<K, Cell>;
  sheet: OverlaySheet;
  shapes?: Partial<Record<K, FieldShape>>;
  printed?: readonly PrintedText[];
}): ReviewSubject {
  const { frame } = input;
  const sizeOf = (n: number) => frame.pages.find((p) => p.page === n);
  const fields: ReviewField[] = input.fields.map((f) => {
    const cell = input.cells[f.key] ?? ({ kind: "empty" } as Cell);
    const area = frame.areas.find((a) => a.keys.includes(f.key));
    const slot = frame.slots.find((s) => (s.kind === "text" ? s.keys.includes(f.key) : s.key === f.key));
    const where = area ?? slot ?? null;
    const size = where ? sizeOf(where.page) : undefined;
    const marks = frame.slots.filter((s): s is Extract<(typeof frame.slots)[number], { kind: "mark" }> => s.kind === "mark" && s.key === f.key);
    const shape: FieldShape = f.handwrite ? "handwrite" : (input.shapes?.[f.key] ?? (marks.length > 0 ? "choice" : "text"));
    return {
      id: f.key,
      label: f.label,
      page: where?.page ?? null,
      box: where && size ? ratio(where.box, size) : null,
      shape,
      options: marks.map((m) => m.option),
      optionBoxes: marks.map((m) => {
        const s = sizeOf(m.page);
        return s ? ratio(m.box, s) : null;
      }),
      source: f.handwrite ? null : f.key,
      state: f.handwrite ? "handwrite" : cell.kind,
      ...valuesOf(cell),
      self: SELF_LABEL.test(f.label),
    };
  });
  const keys = new Set<string>(fields.map((f) => f.id));
  const slotKeys = new Map<string, string>();
  for (const s of frame.slots) if (s.kind === "text" && s.id) slotKeys.set(s.id, s.keys[0]);
  const fieldOf = (id: string): string | null => {
    if (keys.has(id)) return id;
    if (slotKeys.has(id)) return slotKeys.get(id) ?? null;
    const head = id.split(":")[0].split("+")[0];
    return keys.has(head) ? head : null;
  };
  return { sheet: input.sheet, fields, fieldOf, ...(input.printed ? { printed: input.printed } : {}), redoable: false };
}

/** 計画書（松山市）の原本の枠の紙の見直しの形 */
export function matsuyamaSubject(ms: MatsuyamaSheet, sheet: OverlaySheet, printed?: readonly PrintedText[]): ReviewSubject {
  const fields = MATSUYAMA_FIELDS.map((f) => ({ key: f.key as MatsuyamaKey, label: f.block === "notes" ? f.label : matsuyamaFieldName(f), handwrite: f.shape === "handwrite" }));
  const shapes = Object.fromEntries(MATSUYAMA_FIELDS.map((f) => [f.key, f.shape === "consent" ? "choice" : f.shape])) as Partial<Record<MatsuyamaKey, FieldShape>>;
  return frameSubject<MatsuyamaKey>({ frame: MATSUYAMA_FRAME, fields, cells: ms.cells, sheet, shapes, ...(printed ? { printed } : {}) });
}

/** 医療要約（災害診療記録2018）の原本の枠の紙の見直しの形。医師が書く欄・範囲の外の欄は手書き */
export function kirokuSubject(summary: MedicalSummary, sheet: OverlaySheet, printed?: readonly PrintedText[]): ReviewSubject {
  const hidden = new Set<MedicalKey>(summary.hidden ?? []);
  const fields = MEDICAL_FIELDS.map((f) => ({ key: f.key as MedicalKey, label: f.label, handwrite: ("doctor" in f && !!f.doctor) || hidden.has(f.key as MedicalKey) }));
  return frameSubject<MedicalKey>({ frame: KIROKU_FRAME, fields, cells: summary.cells, sheet, ...(printed ? { printed } : {}) });
}

// ---------- 字の箱 ----------

const PT_MM = 25.4 / 72;
const LINE_HEIGHT = 1.15;
/** 紙面の字の欄の内側の空き（mm。overlay-paper.css の .ov-text と同じ） */
const PAD_X_MM = 0.8;
const PAD_Y_MM = 0.5;
/** はみ出し・重なりと見る大きさ（mm）。見積もりの誤差より大きく */
const OVER_TOL_MM = 0.25;
const OVERLAP_MIN_MM = 0.6;

type Rect = { x: number; y: number; w: number; h: number };

const toMm = (b: FieldBox, image: { w: number; h: number }): Rect => ({ x: b.x * image.w, y: b.y * image.h, w: b.w * image.w, h: b.h * image.h });

/** 字の置いた所（mm、頁の画像の左上から）。紙面は欄の矩形の中で左寄せ、上か高さの真ん中 */
export function textExtent(it: Extract<OverlayItem, { kind: "text" }>, image: { w: number; h: number }): Rect {
  const box = toMm(it.box, image);
  const font = it.fontPt * PT_MM;
  const w = Math.max(0, ...it.lines.map((l) => textEm(l) * font));
  const h = it.lines.length * font * LINE_HEIGHT;
  const y = it.top ? box.y + PAD_Y_MM : box.y + (box.h - h) / 2;
  return { x: box.x + PAD_X_MM, y, w, h };
}

function inter(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 - x0 > 0 && y1 - y0 > 0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const overlaps = (a: Rect, b: Rect) => {
  const i = inter(a, b);
  return i !== null && i.w >= OVERLAP_MIN_MM && i.h >= OVERLAP_MIN_MM;
};

// ---------- 日付 ----------

const ERA_MAX: Record<string, number> = { 明治: 45, 大正: 15, 昭和: 64, 平成: 31, 令和: 99 };
const ERAS = Object.keys(ERA_MAX);
const DATE_RE = /(明治|大正|昭和|平成|令和)?\s*(\d{1,4}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
const ISO_RE = /\b(1[89]\d{2}|20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 日付の値の形の問題。無ければ null */
export function dateProblem(value: string, eraOptions: readonly string[]): string | null {
  const m = DATE_RE.exec(value);
  const iso = ISO_RE.exec(value);
  if (!m && !iso) return null;
  if (iso && !m) {
    if (eraOptions.length > 0 && !eraOptions.includes("西暦")) return "西暦・欄は元号";
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > DAYS[mo - 1]) return "月日の範囲外";
    return null;
  }
  const [, era, yRaw, moRaw, dRaw] = m!;
  const y = yRaw === "元" ? 1 : Number(yRaw);
  const mo = Number(moRaw);
  const d = Number(dRaw);
  // 「西暦」の □ がある欄は、ほかの元号の日付を西暦で書く（T140。lib/forms/overlay-sheet.ts の partItems）
  if (era && eraOptions.length > 0 && !eraOptions.includes(era) && !eraOptions.includes("西暦")) return `${era}・欄に無い元号`;
  if (era && (y < 1 || y > ERA_MAX[era])) return `${era}${y}年・範囲外`;
  if (!era && yRaw.length === 4 && eraOptions.length > 0 && !eraOptions.includes("西暦")) return "西暦・欄は元号";
  if (mo < 1 || mo > 12 || d < 1 || d > DAYS[mo - 1]) return "月日の範囲外";
  return null;
}

const isDateField = (f: ReviewField) => f.shape === "date" || /生年月日|年月日|作成日|日付/.test(f.label);
const PART_SEPS = new Set(["年", "月", "日"]);

// ---------- 見直し ----------

const norm = (s: string) => s.replace(/[\s　]+/g, "");
/** 段を除いた欄の名前（「近親者 氏名」→「氏名」） */
const baseLabel = (f: ReviewField) => f.label.split(/[\s　]+/).at(-1) ?? f.label;
/** 重複と見ない値（短い・印の言葉・「なし」） */
const TRIVIAL = /^(なし|あり|有|無|有り|無し|別紙|同上|不明|未定|―|－|-)$/;

const fid = (by: "rule" | "ai", kind: ReviewKind, field: string) => `${by}:${kind}:${field}`;

/**
 * 決まりの見直し。紙の順（頁・欄の順）に並べ、要修正 → 要確認 → 参考の順。数えるのは要修正と要確認（reviewCount）
 */
export function ruleReview(s: ReviewSubject): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const byId = new Map(s.fields.map((f) => [f.id, f]));
  const order = new Map(s.fields.map((f, i) => [f.id, i]));
  const itemsOf = new Map<string, Array<{ it: OverlayItem; page: OverlaySheet["pages"][number] }>>();
  for (const page of s.sheet.pages) {
    for (const it of page.items) {
      const f = s.fieldOf(it.fieldId);
      if (!f) continue;
      const list = itemsOf.get(f) ?? [];
      list.push({ it, page });
      itemsOf.set(f, list);
    }
  }
  const push = (kind: RuleKind, f: ReviewField, why: string, extra: Partial<ReviewFinding> = {}) => {
    const id = fid("rule", kind, f.id);
    if (out.some((x) => x.id === id)) return;
    out.push({
      id,
      by: "rule",
      kind,
      level: LEVEL[kind],
      field: f.id,
      label: f.label,
      page: f.page,
      box: f.box,
      items: (itemsOf.get(f.id) ?? []).map((x) => x.it.fieldId),
      why,
      ...(s.redoable && REDO_KINDS.has(kind) ? { redo: true } : {}),
      ...extra,
    });
  };

  // 別紙（場所が無い・収まらない）
  for (const r of s.sheet.annex) {
    const f = byId.get(s.fieldOf(r.fieldId) ?? "");
    if (!f) continue;
    if (r.reason === "unplaced" && s.redoable) push("unplaced", f, "場所なし・別紙");
    else push("spill", f, r.reason === "overflow" ? "収まらず別紙" : "置き場なし・別紙");
  }
  // 取込漏れ（T133 の台帳あり空欄）。紙の黄の塗りの「置けなかった」（fix）と同じ欄も（紙と同じ区別を読む。T135）
  const carried = new Set<string>();
  const fixed = s.sheet.pages.flatMap((p) => p.fills.filter((fl) => fl.kind === "fix").flatMap((fl) => fl.keys));
  for (const id of [...(s.carried ?? []), ...fixed]) {
    const f = byId.get(s.fieldOf(id) ?? "");
    if (!f || carried.has(f.id)) continue;
    carried.add(f.id);
    push("carried", f, "台帳に値あり・紙は空");
  }
  // 空欄（帯の未確認と同じ欄。色付けの黄の塗りの「台帳に無い」〔ask〕）。置けなかった欄は上の取込漏れで、空欄に重ねない
  for (const page of s.sheet.pages) {
    for (const fill of page.fills) {
      if (fill.kind === "fix") continue;
      for (const k of fill.keys) {
        const f = byId.get(s.fieldOf(k) ?? "");
        if (f && !carried.has(f.id)) push("blank", f, f.source ? "台帳に値なし" : "台帳に項目なし");
      }
    }
  }

  // 字の箱・重なり・枠外・下限
  type Placed = { field: string; rect: Rect; page: number; kind: OverlayItem["kind"] };
  const placed: Placed[] = [];
  for (const page of s.sheet.pages) {
    for (const it of page.items) {
      const f = s.fieldOf(it.fieldId);
      if (!f) continue;
      if (it.kind === "text") {
        const ext = textExtent(it, page.image);
        const box = toMm(it.box, page.image);
        const fld = byId.get(f)!;
        if (ext.x + ext.w > box.x + box.w + OVER_TOL_MM || ext.h > box.h + OVER_TOL_MM) push("overflow", fld, it.lines.length > 1 ? `${it.lines.length}行・枠外` : "1行・枠外");
        if (it.box.x < -0.001 || it.box.y < -0.001 || it.box.x + it.box.w > 1.001 || it.box.y + it.box.h > 1.001) push("overflow", fld, "頁の外");
        if (it.fontPt <= FONT_MIN_PT + 1e-9 && !(it.lines.length === 1 && it.lines[0] === ANNEX_MARK)) push("small", fld, `${it.fontPt}pt`);
        placed.push({ field: f, rect: { ...ext, w: Math.min(ext.w, box.x + box.w - ext.x) }, page: page.page, kind: "text" });
      } else {
        placed.push({ field: f, rect: toMm(it.box, page.image), page: page.page, kind: it.kind });
      }
    }
  }
  const texts = placed.filter((p) => p.kind === "text");
  for (const [i, a] of texts.entries()) {
    const fa = byId.get(a.field)!;
    const image = s.sheet.pages.find((p) => p.page === a.page)!.image;
    // ほかの欄の字・印
    for (const b of placed) {
      if (b === a || b.field === a.field || b.page !== a.page) continue;
      if (b.kind === "text" && texts.indexOf(b) < i) continue; // 字どうしは 1 回だけ
      if (overlaps(a.rect, b.rect)) {
        const fb = byId.get(b.field)!;
        push("overlap", fa, `${fb.label}と重なる`);
      }
    }
    // ほかの欄の刷ってある □
    for (const f of s.fields) {
      if (f.id === a.field || f.page !== a.page || f.shape !== "choice") continue;
      if ((f.optionBoxes ?? []).some((b) => b && overlaps(a.rect, toMm(b, image)))) push("overlap", fa, `${f.label}の□と重なる`);
    }
    // 印刷の字（T133 の位置）
    if ((s.printed ?? []).some((p) => p.page === a.page && overlaps(a.rect, toMm(p.box, image)))) push("overlap", fa, "印刷の字と重なる");
  }

  for (const f of s.fields) {
    const items = itemsOf.get(f.id) ?? [];
    const textItems = items.filter((x) => x.it.kind === "text") as Array<{ it: Extract<OverlayItem, { kind: "text" }>; page: OverlaySheet["pages"][number] }>;
    const onPaper = textItems.flatMap((x) => x.it.lines).join(" ");
    // 伏字
    if (MASK_MARKS.some((m) => onPaper.includes(m))) push("masked", f, MASK_MARKS.filter((m) => onPaper.includes(m)).join(""));
    // 本人が書く欄
    if (f.self) {
      if (items.length > 0) push("signature", f, "本人が書く欄に記入");
      else push("self", f, "本人が書く欄");
    }
    // 日付
    if (isDateField(f) && f.values.length > 0) {
      const eras = f.options.filter((o) => ERAS.includes(o) || o === "西暦");
      const p = dateProblem(f.values.join(" "), eras);
      if (p) push("date", f, p);
      // 年・月・日の空きのある欄に 1 つの字で置いた（印刷の「年 月 日」と重なる）
      const seps = f.options.filter((o) => PART_SEPS.has(o));
      const partBoxes = (f.optionBoxes ?? []).filter((b) => b !== null);
      if (seps.length >= 2 && partBoxes.length >= seps.length && textItems.length > 0 && textItems.every((x) => x.it.part === undefined && x.it.lines[0] !== ANNEX_MARK)) {
        push("date", f, "年月日の部品に分けず");
      }
    }
  }

  // 別紙の印と別紙の頁
  const hasAnnex = s.sheet.annex.length > 0;
  for (const f of s.fields) {
    if (!/別紙/.test(f.label) && !f.options.includes("あり")) continue;
    if (!/別紙/.test(f.label) && !f.id.includes("annex")) continue;
    const items = itemsOf.get(f.id) ?? [];
    const yesMarked = items.some((x) => x.it.kind === "mark" && (x.it.fieldId.endsWith(":あり") || markedOption(f, x.it) === "あり"));
    const anyMarked = items.some((x) => x.it.kind === "mark");
    // 台帳の「別紙 あり（医療要約）」は、別紙が医療要約（紙を添える）。参考に
    const medical = f.marked.includes("あり");
    if (yesMarked && !hasAnnex) push("annex", f, medical ? "医療要約を添付" : "あり・別紙頁なし", medical ? { level: "note" } : {});
    else if (hasAnnex && anyMarked && !yesMarked) push("annex", f, "別紙頁あり・印なし");
  }

  // 重複（同じ値が 2 つの欄に）。頁ごとの同じ場所の欄（同じ様式が何頁か並ぶ写し・頁の頭に繰り返す欄）と電話・携帯の欄は、同じ値でよい
  // （T140、lib/forms/form-shape.ts）
  const seen = new Map<string, ReviewField[]>();
  for (const f of s.fields) {
    const items = (itemsOf.get(f.id) ?? []).filter((x) => x.it.kind === "text" && x.it.part === undefined) as Array<{ it: Extract<OverlayItem, { kind: "text" }> }>;
    const v = norm(items.flatMap((x) => x.it.lines).join(""));
    if (v.length < 4 || TRIVIAL.test(v) || v === ANNEX_MARK || /^\d{1,4}$/.test(v)) continue;
    const before = seen.get(v) ?? [];
    seen.set(v, [...before, f]);
    if (before.length === 0 || before.some((g) => allowedTwice(g, f))) continue;
    const first = before[0];
    // 同じ名前の欄（近親者 氏名と実施者1 氏名）は、同じ人が 2 つの役のことがあるので見ない
    if (baseLabel(first) !== baseLabel(f)) push("duplicate", f, `${first.label}と同じ`);
  }
  // 同じ台帳の項目を、様式の形で当ててよい数より多くの欄に当てた（対応表の紙）。頁ごとの同じ場所・電話と携帯は数えない
  if (s.redoable) {
    const valued = s.fields.filter((f) => f.source && f.state !== "empty" && f.values.length > 0);
    for (const [id, first] of extraItemFields(valued)) push("duplicate", byId.get(id)!, `${first.label}と同じ項目`);
  }

  const levelRank: Record<ReviewLevel, number> = { fix: 0, check: 1, note: 2 };
  return out.sort(
    (a, b) => levelRank[a.level] - levelRank[b.level] || (a.page ?? 99) - (b.page ?? 99) || (order.get(a.field) ?? 0) - (order.get(b.field) ?? 0),
  );
}

/** 対応表の紙の選ぶ欄の印が、どの選択肢の □ か（印の矩形と □ の場所が同じ物） */
function markedOption(f: ReviewField, it: OverlayItem): string | null {
  if (it.kind !== "mark" || !f.optionBoxes) return null;
  const i = f.optionBoxes.findIndex((b) => b && Math.abs(b.x - it.box.x) < 1e-6 && Math.abs(b.y - it.box.y) < 1e-6);
  return i >= 0 ? (f.options[i] ?? null) : null;
}

/** 再考（その欄だけの読み直し）で直せそうな種類。対応表の紙の欄の場所と項目の読み違いから来る物 */
export const REDO_KINDS: ReadonlySet<ReviewKind> = new Set<ReviewKind>(["unplaced", "carried", "overlap", "overflow", "date", "signature", "misplaced", "mismatch", "unreadable"]);

/**
 * 紙の上の欄へ送る口（T135 の紙の上で入れる所が受ける窓の出来事）。見直しの一覧の行を押すと出す。
 * field は欄の id（対応表の欄の id・原本の枠の欄の key）、items は紙の上の物の data-field
 */
export const PAPER_FIELD_EVENT = "care72:paper-field";
export type PaperFieldDetail = { field: string; items: string[]; page: number | null; box: FieldBox | null };

/** 帯の「見直し N」の数（要修正と要確認） */
export const reviewCount = (fs: readonly ReviewFinding[]) => fs.filter((f) => f.level !== "note").length;

// ---------- 紙の版 ----------

/** 紙の中身の版（同じ紙なら同じ）。確認済の印と AI の見直しの結果を紙に結び付ける。SHA-256 の頭 16 字 */
export async function sheetHash(sheet: OverlaySheet): Promise<string> {
  const body = JSON.stringify({ pages: sheet.pages.map((p) => ({ page: p.page, items: p.items.map((it) => (it.kind === "image" ? { ...it, svg: it.svg.length } : it)) })), annex: sheet.annex });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
