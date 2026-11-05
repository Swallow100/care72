// 紙の上でその場で入れる（T135）の画面とサーバーで共有する形と、純な計算。ブラウザでも読む（サーバーの物を import しない）。
// サーバー（lib/forms/paper-slots.ts）が紙の欄ごとに「押す所・入れ方・行き先・今の値」を作り、画面（components/forms/PaperFill.tsx）が
// 紙の上に重ねて描く。字の大きさは紙に刷るときと同じ決まり（lib/forms/overlay-sheet.ts の fitText）で、画面と紙が同じ関数を使う。
// Claude は呼ばない。

import type { Question } from "../intake/ask.ts";
import type { IntakeChange } from "../intake/changes.ts";
import type { FormEntry, FormId } from "./form-entries.ts";
import type { FieldBox, Typeface } from "./mapping.ts";
import { fitText, FONT_MIN_PT } from "./overlay-sheet.ts";
import { draftKey, paperChanges, type PaperInput, type PaperTarget } from "./paper-edit.ts";
import { splitParts } from "./split-parts.ts";

/** 選ぶ欄の選択肢。value は台帳の値（台帳の欄）か選択肢の字（様式だけの欄）、box は紙の □ の所 */
export type SlotOption = { label: string; value: string; box: FieldBox | null };

/** 欄の入れ方 */
export type SlotInput =
  /** 字。parts は欄の中に刷ってある区切り（年・月・日、− −）ごとの空き（lib/forms/split-parts.ts） */
  | { kind: "text"; multiline: boolean; tel: boolean; max: number; unit?: string; parts?: Array<{ sep: string; box: FieldBox }> }
  /** 選択肢の □ を押して印 */
  | { kind: "choice"; multi: boolean; options: SlotOption[] }
  /** □ 1 つ。押して印 */
  | { kind: "check" }
  /** 元が台帳の何か所かにまたがる欄（薬・連絡先の人・同意など）。入力の窓（T117） */
  | { kind: "window" };

export type SlotValue = string | string[] | boolean;

/** 紙の欄 1 つ */
export type PaperSlot = {
  /** 欄の鍵（計画書は欄の鍵、添付の様式は対応表の欄の id） */
  key: string;
  /** 欄の名前（帯と同じ） */
  label: string;
  page: number;
  /** 字を書く矩形（頁の画像の上の比） */
  box: FieldBox;
  /** 押す所の外の矩形（欄の罫線の内側）。無ければ box */
  area?: FieldBox;
  /** box の大きさ（mm） */
  mm: { w: number; h: number };
  /** 字の上限（pt。様式の地の大きさ） */
  maxPt: number;
  /** 空いた欄（未記入の色付けで塗る欄） */
  empty: boolean;
  /** 行き先: 台帳（ほかの様式にも効く）か、この人のこの様式の手入れ */
  dest: "ledger" | "form";
  input: SlotInput;
  /** 今の値（字・選んだ値の配列・□ の真偽） */
  value: SlotValue;
  /** 台帳の欄: その場の入力が書く所 */
  ledger?: Exclude<PaperInput, { kind: "page" }>;
  /** 窓の欄: 窓の中身（T117） */
  target?: PaperTarget;
  /** 様式だけの欄: 手入れの id（まだ無ければ無し） */
  entryId?: string;
  /** 手で入れた印（誰がいつ） */
  hand?: { by: string | null; at: string };
  /** この欄を埋める問いの鍵（lib/intake/ask.ts の Question の key） */
  asks?: string[];
  /** 1 つの書く所に欄が 2 つ以上ある所（計画書のかかりつけ医・薬局と医薬品情報）の欄の鍵の全部。key は先頭 */
  keys?: string[];
};

/** 置ける画像（事業所の物） */
export type AssetInfo = { id: string; name: string; kind: AssetKind; src: string; width: number; height: number };
export const ASSET_KINDS = ["map", "photo", "figure"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** 紙の画面に渡す物（サーバーで作る。ケアマネの役で自分の事業所の人だけ） */
export type PaperFillData = {
  personId: string;
  /** 台帳の版（保存のたびに上がる。画面は読み直して受ける） */
  version: number;
  formId: FormId;
  typeface: Typeface;
  maxPt: number;
  /** 頁の画像の大きさ（mm） */
  pages: Array<{ page: number; w: number; h: number }>;
  slots: PaperSlot[];
  /** 置いた文字の枠と画像 */
  free: FormEntry[];
  /** 置いた画像の元（id → 名前と URL） */
  assets: Record<string, { name: string; src: string }>;
  /** 紙から聞く問い（この様式の空いた欄で、台帳に項目のある物だけ。問いの列の順） */
  questions: Question[];
};

/** 紙の上の言葉（2〜4 字） */
export const FILL_LABELS = {
  ledger: "台帳",
  form: "様式",
  textBox: "文字枠",
  image: "画像",
  undo: "取消",
  redo: "再実行",
  marks: "印",
  ask: "質問",
  annex: "別紙",
  place: "配置",
  remove: "削除",
  pick: "選択",
  upload: "取込",
  saved: "保存済",
  failed: "保存失敗",
  move: "移動",
  done: "完了",
  map: "地図",
  photo: "写真",
  figure: "図",
  name: "名前",
  noAsk: "質問なし",
} as const;

export const ASSET_KIND_LABELS: Record<AssetKind, string> = { map: FILL_LABELS.map, photo: FILL_LABELS.photo, figure: FILL_LABELS.figure };

// ---------- 字の大きさ（紙と同じ決まり） ----------

/**
 * その場の入力の字の大きさ。紙に刷るときと同じ fitText（欄の矩形に合わせて上限から 6pt まで）。
 * 下限でも入らなければ下限の大きさで overflow（刷ると欄に「別紙」、値は別紙の頁へ）
 */
export function liveFont(text: string, mm: { w: number; h: number }, maxPt: number): { fontPt: number; overflow: boolean; top: boolean } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { fontPt: maxPt, overflow: false, top: false };
  const fitted = fitText(lines, mm.w, mm.h, maxPt);
  return fitted ? { fontPt: fitted.fontPt, overflow: false, top: fitted.top } : { fontPt: FONT_MIN_PT, overflow: true, top: true };
}

/** 比の矩形の大きさ（mm）。頁の画像の大きさで */
export const boxMm = (b: FieldBox, page: { w: number; h: number }) => ({ w: b.w * page.w, h: b.h * page.h });

// ---------- 部品つきの欄 ----------

/** 欄の値を部品に分ける（分けられなければ先頭に全部） */
export function partsOf(value: string, seps: readonly string[]): string[] {
  const got = value.trim() ? splitParts(value, seps) : null;
  if (got && got.length === seps.length) return got;
  return seps.map((_, i) => (i === 0 ? value : ""));
}

/** 部品を欄の値に戻す（単位の区切りは部品の後ろに、電話・郵便番号は - でつなぐ）。全部空なら空 */
export function joinParts(parts: readonly string[], seps: readonly string[]): string {
  const kept = parts.map((p) => p.trim());
  if (kept.every((p) => p === "")) return "";
  const unit = seps.every((s) => /[年月日歳]$/.test(s.normalize("NFKC").trim()));
  if (unit) return kept.map((p, i) => `${p}${seps[i].normalize("NFKC").trim().slice(-1)}`).join("");
  return kept.join("-");
}

// ---------- 台帳に入れる変更 ----------

/**
 * その場の入力の値から、台帳の変更（/api/intake/save の edit と同じ形）。値が今と同じなら空、形が合わなければ bad。
 * 字の欄（数字の欄の単位は外す）・選ぶ欄（台帳の選択肢の値）・□（真偽）
 */
export function slotChanges(slot: PaperSlot, next: SlotValue): { changes: IntakeChange[]; bad: boolean } {
  const input = slot.ledger;
  if (!input) return { changes: [], bad: false };
  let raw: unknown = next;
  if (slot.input.kind === "text" && typeof next === "string") {
    raw = slot.input.unit ? next.replace(new RegExp(`\\s*${escapeRe(slot.input.unit)}\\s*$`), "").trim() : next;
  }
  if (slot.input.kind === "choice" && !slot.input.multi) raw = Array.isArray(next) ? (next[0] ?? null) : next;
  if (slot.input.kind === "choice" && slot.input.multi && Array.isArray(next) && next.length === 0) raw = null;
  // 選ぶ欄の真偽（あり・なし）は真偽に
  if (input.kind === "field" && (raw === "true" || raw === "false")) raw = raw === "true";
  const target: PaperTarget = { key: slot.key as PaperTarget["key"], label: slot.label, inputs: [input] };
  const { changes, bad } = paperChanges(target, { [draftKey(input)]: raw });
  return { changes, bad: bad.length > 0 };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 選ぶ欄の押した選択肢から、次の値（1 つ選ぶ欄は押した物だけ・押した物をもう一度で外す、複数は足す・外す） */
export function toggleOption(current: SlotValue, value: string, multi: boolean): string[] {
  const on = Array.isArray(current) ? current : typeof current === "string" && current !== "" ? [current] : [];
  if (on.includes(value)) return on.filter((v) => v !== value);
  return multi ? [...on, value] : [value];
}
