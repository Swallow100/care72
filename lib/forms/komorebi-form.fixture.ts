// 架空の自治体（こもれび市。実在しない）の個別避難計画の白紙の様式（T86 のテスト用）。実在の人・自治体の情報は入れない。
// 1 つの並び（KOMOREBI_LAYOUT）から、Opus の返事の代わり（偽の client が返す JSON、komorebiReadResult）と、
// 白紙の様式の紙（印刷して PDF にし、頁の画像にする HTML、komorebiBlankHtml）の両方を作る。だから返事の場所と紙の欄の場所は同じ。
// 場所は A4 縦の頁の比（左上 0・右下 1）。欄の名前の枠（labelBox）と値を書く枠（box）を横に並べ、罫線で囲む。

import type { FieldBox, FieldShape, ReadResult, Typeface } from "./mapping.ts";

export type KomorebiField = {
  page: number;
  section: string;
  label: string;
  shape: FieldShape;
  options: string[];
  item: string | null;
  /** 欄の名前を刷る所 */
  labelBox: FieldBox;
  /** 値を書く所（AI が返す場所） */
  box: FieldBox;
  /** choice の選択肢ごとの □ の場所 */
  optionBoxes?: FieldBox[];
};

export const KOMOREBI_TITLE = "こもれび市 避難行動要支援者 個別避難計画";
export const KOMOREBI_ISSUER = "こもれび市（架空）";

/** 行の高さと横の並び（比）。1 行の欄は名前 0.08〜0.30、値 0.30〜0.92 */
const row = (y: number, h = 0.035) => ({ y, h });
const L = (y: number, h?: number): FieldBox => ({ x: 0.08, w: 0.22, ...row(y, h) });
const V = (y: number, h?: number): FieldBox => ({ x: 0.3, w: 0.62, ...row(y, h) });

/** 選択肢の □ の場所（値の枠の中に、左から 0.12 ずつ） */
const opts = (y: number, n: number): FieldBox[] => Array.from({ length: n }, (_, i) => ({ x: 0.31 + i * 0.12, y: y + 0.011, w: 0.018, h: 0.013 }));

export const KOMOREBI_LAYOUT: KomorebiField[] = [
  // ---- 1 頁 ----
  { page: 1, section: "", label: "作成日", shape: "date", options: [], item: "plan.date", labelBox: L(0.1), box: V(0.1) },
  { page: 1, section: "本人", label: "フリガナ", shape: "text", options: [], item: "person.kana", labelBox: L(0.16), box: V(0.16) },
  { page: 1, section: "本人", label: "氏名", shape: "text", options: [], item: "person.name", labelBox: L(0.195), box: V(0.195) },
  {
    page: 1,
    section: "本人",
    label: "性別",
    shape: "choice",
    options: ["男", "女"],
    item: "basic.sex",
    labelBox: L(0.23),
    box: V(0.23),
    optionBoxes: opts(0.23, 2),
  },
  { page: 1, section: "本人", label: "生年月日", shape: "date", options: [], item: "person.birth", labelBox: L(0.265), box: V(0.265) },
  { page: 1, section: "本人", label: "住所", shape: "text", options: [], item: "basic.address", labelBox: L(0.3), box: V(0.3) },
  { page: 1, section: "本人", label: "電話番号", shape: "phone", options: [], item: "self.phone", labelBox: L(0.335), box: V(0.335) },
  { page: 1, section: "本人", label: "要介護度", shape: "text", options: [], item: "care.careLevel", labelBox: L(0.37), box: V(0.37) },
  { page: 1, section: "緊急連絡先", label: "氏名", shape: "text", options: [], item: "emergency1.name", labelBox: L(0.44), box: V(0.44) },
  { page: 1, section: "緊急連絡先", label: "続柄", shape: "text", options: [], item: "emergency1.relation", labelBox: L(0.475), box: V(0.475) },
  { page: 1, section: "緊急連絡先", label: "電話", shape: "phone", options: [], item: "emergency1.phone", labelBox: L(0.51), box: V(0.51) },
  { page: 1, section: "避難支援者", label: "氏名", shape: "text", options: [], item: "supporter1.name", labelBox: L(0.58), box: V(0.58) },
  { page: 1, section: "避難支援者", label: "電話", shape: "phone", options: [], item: "supporter1.phone", labelBox: L(0.615), box: V(0.615) },
  {
    page: 1,
    section: "",
    label: "医療機器を使っている",
    shape: "check",
    options: [],
    item: "medical.devices",
    labelBox: { x: 0.08, y: 0.68, w: 0.4, h: 0.035 },
    box: { x: 0.5, y: 0.691, w: 0.018, h: 0.013 },
  },
  { page: 1, section: "", label: "本人署名", shape: "handwrite", options: [], item: null, labelBox: L(0.78, 0.05), box: V(0.78, 0.05) },
  // ---- 2 頁 ----
  { page: 2, section: "避難", label: "避難先", shape: "text", options: [], item: "evacuation.destination1", labelBox: L(0.1), box: V(0.1) },
  { page: 2, section: "避難", label: "避難経路", shape: "lines", options: [], item: "evacuation.route", labelBox: L(0.135, 0.07), box: V(0.135, 0.07) },
  { page: 2, section: "", label: "特記事項", shape: "lines", options: [], item: "notes.other", labelBox: L(0.25, 0.12), box: V(0.25, 0.12) },
  {
    page: 2,
    section: "同意",
    label: "名簿への登録",
    shape: "choice",
    options: ["同意する", "同意しない"],
    item: "consent.registry",
    labelBox: L(0.42),
    box: V(0.42),
    optionBoxes: [
      { x: 0.31, y: 0.431, w: 0.018, h: 0.013 },
      { x: 0.5, y: 0.431, w: 0.018, h: 0.013 },
    ],
  },
  { page: 2, section: "", label: "市受付印", shape: "handwrite", options: [], item: null, labelBox: L(0.8, 0.08), box: V(0.8, 0.08) },
];

/** 偽の client が返す Opus の返事（構造化出力の形）。頁の数・書体も */
export function komorebiReadResult(typeface: Typeface = "mincho"): Required<Pick<ReadResult, "typeface">> & ReadResult {
  return {
    title: KOMOREBI_TITLE,
    issuer: KOMOREBI_ISSUER,
    pages: 2,
    typeface,
    fields: KOMOREBI_LAYOUT.map((f) => ({
      page: f.page,
      section: f.section,
      label: f.label,
      position: `${f.page}頁 ${f.section || "表"}`,
      shape: f.shape,
      options: f.options,
      item: f.item,
      confidence: "high" as const,
      reason: "欄の名前と中身が合う",
      box: f.box,
      option_boxes: f.optionBoxes ?? [],
    })),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const at = (b: FieldBox) => `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`;

/**
 * 白紙の様式（A4 縦、2 頁）の HTML。印刷すると架空の様式の PDF になる（テストはこれを頁の画像にして読み取りに渡す代わりにする）。
 * 欄の名前の枠と値を書く枠を罫線で描き、選ぶ欄は □ と選択肢の字、□ 1 つの欄は □ だけを刷る。値は何も書かない
 */
export function komorebiBlankHtml(): string {
  const pages = [1, 2].map((page) => {
    const cells = KOMOREBI_LAYOUT.filter((f) => f.page === page).flatMap((f) => {
      const name = f.section && f.shape !== "check" ? `<span class="sec">${esc(f.section)}</span>${esc(f.label)}` : esc(f.label);
      const out = [`<div class="lbl" style="${at(f.labelBox)}">${name}</div>`];
      if (f.shape === "check") {
        out.push(`<div class="sq" style="${at(f.box)}"></div>`);
        return out;
      }
      out.push(`<div class="val" style="${at(f.box)}"></div>`);
      (f.optionBoxes ?? []).forEach((b, i) => {
        out.push(`<div class="sq" style="${at(b)}"></div>`);
        out.push(`<div class="opt" style="left:${(b.x + b.w + 0.004) * 100}%;top:${b.y * 100}%;height:${b.h * 100}%">${esc(f.options[i])}</div>`);
      });
      return out;
    });
    const head = page === 1 ? `<h1>${esc(KOMOREBI_TITLE)}</h1><p class="ver">様式第1号（架空）</p>` : `<p class="ver">（裏）</p>`;
    return `<section class="pg">${head}${cells.join("")}</section>`;
  });
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>白紙の様式</title><style>
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.pg { position: relative; width: 210mm; height: 297mm; overflow: hidden; break-after: page; font-family: "BIZ UDPMincho", "BIZ UDP明朝", serif; color: #000; }
.pg:last-child { break-after: auto; }
h1 { position: absolute; left: 8%; top: 4%; margin: 0; font-size: 15pt; font-weight: 400; }
.ver { position: absolute; right: 8%; top: 2.5%; margin: 0; font-size: 8pt; }
.lbl, .val, .sq, .opt { position: absolute; box-sizing: border-box; }
.lbl { border: 1px solid #000; background: #eee; font-size: 9pt; padding: 0 1.5mm; display: flex; align-items: center; gap: 1.5mm; }
.sec { font-size: 7pt; }
.val { border: 1px solid #000; border-left: none; }
.sq { border: 1px solid #000; }
.opt { font-size: 9pt; display: flex; align-items: center; }
</style></head><body>${pages.join("")}</body></html>`;
}
