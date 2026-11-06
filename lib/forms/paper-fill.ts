// 紙の上でその場で入れる（T135）の画面とサーバーで共有する形と、純な計算。ブラウザでも読む（サーバーの物を import しない）。
// サーバー（lib/forms/paper-slots.ts）が紙の欄ごとに「押す所・入れ方・行き先・今の値」を作り、画面（components/forms/PaperFill.tsx）が
// 紙の上に重ねて描く。字の大きさは紙に刷るときと同じ決まり（lib/forms/overlay-sheet.ts の fitText）で、画面と紙が同じ関数を使う。
// Claude は呼ばない。

import type { Question } from "../intake/ask.ts";
import type { IntakeChange } from "../intake/changes.ts";
import type { FormEntry, FormId } from "./form-entries.ts";
import type { FieldBox, Typeface } from "./mapping.ts";
import type { InkBlob } from "./ink.ts";
import { fitText, FONT_MIN_PT, placeText, type OverlayPage } from "./overlay-sheet.ts";
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
  /**
   * 空いた訳（T133 の黄の塗り 2 つ。lib/forms/overlay-sheet.ts の OverlayFill の kind）。ask は台帳に無い（質問で埋める）、
   * fix は台帳に値があるのに紙に置けなかった（その場で、この様式の手入れとして入れる）。空いていなければ無し
   */
  gap?: "ask" | "fix";
  /**
   * 紙に置くときの避ける物（T133 の置き方 placeText に渡す物。この欄の枠の中の印刷の字と、枠に掛かるほかの欄の枠）。
   * 画面の入力の字の大きさと位置を、紙に刷るときと同じ関数で決める。無ければ（原本の枠の紙）欄の矩形に fitText
   */
  place?: { ink: InkBlob[]; others: Array<{ id: string; box: FieldBox; free?: boolean }> };
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
  /**
   * 台帳の 1 か所に書けない欄（氏名・住所・連絡先の人など、元が本人のページの面の入れ子の値。T147）。紙の上ではその場で打ち、
   * この人のこの様式の値（様式のみ）として残す。台帳を直す道は本人のページのその面（label・href）
   */
  pageLink?: { label: string; href: string };
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

/**
 * 紙の上の言葉（2〜4 字）。T147 で初めて見て分かる形に見直した:
 * - 手で入れた所の印の表示の切替「印」→「入力箇所」（押すと、紙の上で入れた欄・置いた枠に誰がいつの小さな印）
 * - 欄の行き先: 台帳に入る欄は「台帳保存」（ほかの様式にも効く）、この人のこの様式だけの値は「様式のみ」（台帳は変えない）
 * - 文字の枠・画像を置く操作は「文字追加」「画像追加」、置く所を選ぶ間は「位置選択」、画像の取り込みは「画像取込」
 * - 取消・再実行は黒塗りの画面と同じ「一手戻す」「一手進む」（窓の「取消」と取り違えない）
 */
export const FILL_LABELS = {
  ledger: "台帳",
  form: "様式のみ",
  toLedger: "台帳保存",
  toForm: "様式のみ",
  textBox: "文字枠",
  addText: "文字追加",
  image: "画像",
  addImage: "画像追加",
  undo: "一手戻す",
  redo: "一手進む",
  marks: "入力箇所",
  ask: "質問",
  annex: "別紙",
  place: "位置選択",
  remove: "削除",
  pick: "選択",
  upload: "画像取込",
  save: "保存",
  saving: "保存中",
  saved: "保存済",
  unsaved: "未保存",
  failed: "保存失敗",
  leave: "未保存あり",
  leaveOk: "破棄移動",
  move: "移動",
  size: "大きさ",
  auto: "自動",
  page: "本人のページ",
  done: "閉じる",
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

/**
 * その場の入力の字の置き場（T133 の置き方 placeText。紙に刷るときと同じ関数・同じ避ける物）。area は欄の枠か部品の枠、
 * page は頁の画像の大きさ（mm）。置けなければ（どこにも入らない）欄の枠に下限の大きさで overflow（刷ると「未配置」か「別紙」）
 */
export function livePlace(
  slot: Pick<PaperSlot, "key" | "maxPt" | "place">,
  text: string,
  area: FieldBox,
  page: { w: number; h: number },
  own?: FieldBox,
): { box: FieldBox; fontPt: number; overflow: boolean; top: boolean } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const mm = boxMm(area, page);
  if (lines.length === 0) return { box: area, fontPt: slot.maxPt, overflow: false, top: false };
  if (!slot.place) {
    const f = liveFont(text, mm, slot.maxPt);
    return { box: area, ...f };
  }
  const pg: OverlayPage = { page: 0, landscape: false, image: { x: 0, y: 0, w: page.w, h: page.h }, items: [], fills: [] };
  const t = placeText(slot.key, lines, area, { page: pg, ink: slot.place.ink, others: slot.place.others }, own ? { own } : { units: true });
  return t ? { box: t.box, fontPt: t.fontPt, overflow: false, top: t.top } : { box: area, fontPt: FONT_MIN_PT, overflow: true, top: true };
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

// ---------- 見直しの一覧から送られた欄（T136） ----------

/**
 * 見直しの一覧（T136、lib/forms/review.ts の PAPER_FIELD_EVENT）の行から送られた欄に当たる紙の欄。
 * field は欄の id（対応表の欄の id・原本の枠の欄の key）、items は紙の上の物の data-field（「key:部品」「key1+key2」の形もある）。
 * 1 つの書く所に欄が 2 つの所（keys）も見る。当たらなければ null（別紙だけの欄など）
 */
export function slotForField(slots: readonly PaperSlot[], d: { field: string; items: readonly string[] }): PaperSlot | null {
  const has = (s: PaperSlot, k: string) => s.key === k || (s.keys ?? []).includes(k);
  const direct = slots.find((s) => has(s, d.field));
  if (direct) return direct;
  const ids = d.items.flatMap((i) => i.split(/[:+]/));
  return slots.find((s) => ids.some((k) => has(s, k))) ?? null;
}

// ---------- 文字の枠・画像を動かす・大きさを変える（T147） ----------

/** つまむ所: 枠の本体（移動）と 4 つの角・4 つの辺（大きさ） */
export const BOX_HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type BoxHandle = (typeof BOX_HANDLES)[number];
/** 画像は縦横の比を保つので角だけ */
export const IMAGE_HANDLES: readonly BoxHandle[] = ["ne", "se", "sw", "nw"];

/** 小さくできる下限（mm）。文字の枠は下限の字 1 行が入る高さ */
export const BOX_MIN_MM = { w: 8, h: 4 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** 枠を動かす（dx・dy は頁の比）。頁の外へ出さない */
export function moveBox(start: FieldBox, dx: number, dy: number): FieldBox {
  return { ...start, x: round4(clamp(start.x + dx, 0, 1 - start.w)), y: round4(clamp(start.y + dy, 0, 1 - start.h)) };
}

/**
 * 角・辺をつまんで大きさを変える（dx・dy は頁の比、page は頁の大きさ mm）。つまんだ辺だけが動き、反対の辺は留まる。
 * 頁の外へ出さず、下限（BOX_MIN_MM）より小さくしない。keepAspect（画像）は縦横の比を保つ（幅の変わりに合わせる）
 */
export function resizeBox(start: FieldBox, handle: BoxHandle, dx: number, dy: number, page: { w: number; h: number }, keepAspect = false): FieldBox {
  const minW = BOX_MIN_MM.w / page.w;
  const minH = BOX_MIN_MM.h / page.h;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = clamp(start.x + dx, 0, right - minW);
  if (handle.includes("e")) right = clamp(right + dx, left + minW, 1);
  if (handle.includes("n")) top = clamp(start.y + dy, 0, bottom - minH);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + minH, 1);
  if (keepAspect && start.w > 0) {
    const ratio = start.h / start.w;
    let w = right - left;
    let h = w * ratio;
    // 縦が頁に入らなければ、縦に合わせて幅を詰める
    const roomH = handle.includes("n") ? start.y + start.h : 1 - start.y;
    if (h > roomH) {
      h = roomH;
      w = h / ratio;
      if (handle.includes("w")) left = right - w;
      else right = left + w;
    }
    if (handle.includes("n")) top = bottom - h;
    else bottom = top + h;
  }
  return { x: round4(left), y: round4(top), w: round4(right - left), h: round4(bottom - top) };
}
