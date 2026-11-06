// 評価の台（T107）の正解の表（gold）: 様式の欄 → 台帳の項目（lib/forms/mapping.ts の LEDGER_ITEMS の key）。手で作った物。
//
// - 架空の様式 3 つ: こもれび市（T86 の lib/forms/komorebi-form.fixture.ts の並び）と、ここで足す あおぞら市（1 頁、□ の多い表）・
//   しおかぜ町（A4 横 2 頁、言い方の違う欄）。並び（欄の名前の枠・値の枠・□ の場所）から白紙の HTML も作る（T86 と同じ作り方）
// - 同梱の様式 3 つ: 松山市の計画書（lib/forms/matsuyama.ts の MATSUYAMA_FIELDS）、災害診療記録2018（lib/forms/medical-summary.ts の
//   MEDICAL_FIELDS）、様式 9（lib/forms/form9.ts の列）。欄の名前と順はコードの表から引き、原本の中身や絵は持たない。
//   場所は原本の枠の寸法（lib/forms/frame-*.ts の areas、mm）を頁の寸法で割った比。原本はリポジトリの外の置き場から読む
// - 項目の当て方は様式の読み取りの指示（lib/forms/form-read.ts の FORM_READ_SYSTEM）の決まりに合わせる:
//   手で書く欄・市が書く欄・同意と署名の欄は null（11）、2 つ目の電話は台帳に 2 番目の値が無ければ null（12）、意味の違う欄に名前の近い
//   項目を当てない（13）。決めきれない欄だけ accept に別の答えを足す（判定の記録に「別解」と残る）

import { MEDICAL_AUDIT } from "../../../lib/forms/form-audit.ts";
import { KIROKU_FRAME } from "../../../lib/forms/frame-kiroku.ts";
import { MATSUYAMA_FRAME } from "../../../lib/forms/frame-matsuyama.ts";
import type { Frame } from "../../../lib/forms/frame-sheet.ts";
import { FORM9_COL_CHARS, FORM9_MARGIN_MM, FORM9_PAGE_MM, FORM9_PRINT_SCALE, FORM9_ROWS_PER_PAGE, form9Cell } from "../../../lib/forms/frame-form9.ts";
import { digitEmOf } from "../../../lib/ooxml/fonts.ts";
import { KOMOREBI_ISSUER, KOMOREBI_LAYOUT, KOMOREBI_TITLE, komorebiBlankHtml, type KomorebiField } from "../../../lib/forms/komorebi-form.fixture.ts";
import { isLedgerItemKey, listShapeOf, type FieldBox, type FieldShape, type FormMapping, type LedgerItemKey, type ReadResult, type Typeface } from "../../../lib/forms/mapping.ts";
import { MATSUYAMA_FIELDS, MATSUYAMA_FORM_URL, type MatsuyamaKey } from "../../../lib/forms/matsuyama.ts";
import { MEDICAL_FIELDS, type MedicalKey } from "../../../lib/forms/medical-summary.ts";
import { ORIGINALS } from "../../../lib/forms/originals.ts";

export type GoldField = {
  page: number;
  section: string;
  label: string;
  shape: FieldShape;
  options: string[];
  /** 正しい台帳の項目。null は台帳に合う物が無い・人が書く欄 */
  item: LedgerItemKey | null;
  /** 別解（決めきれない欄だけ） */
  accept?: ReadonlyArray<LedgerItemKey | null>;
  /** 値を書く所（頁の比）。分からなければ無い */
  box?: FieldBox;
  optionBoxes?: FieldBox[];
};

/** 原本の取り方。generated は架空の様式（白紙の HTML を Chrome で PDF に）。corpus は置き場の原本と照らす */
export type GoldSource =
  | { kind: "generated"; html: () => string; landscape: boolean }
  | { kind: "corpus"; sha256?: string; url?: string; fileName?: RegExp };

export type GoldForm = {
  id: string;
  title: string;
  issuer: string;
  /** 置き場の市町村のフォルダの名前（corpus の物） */
  city: string | null;
  source: GoldSource;
  typeface: Typeface;
  /** 正解を数える頁（原本の頁が多いとき、正解を作った頁だけ） */
  pages: number[];
  fields: GoldField[];
  /** 一覧の表（T131。様式 9）。人を書く行の数と 1 行目・最後の行の帯 */
  list?: NonNullable<ReadResult["list"]>;
};

const key = (k: string | null): LedgerItemKey | null => {
  if (k === null) return null;
  if (!isLedgerItemKey(k)) throw new Error(`正解の表に台帳に無い項目: ${k}`);
  return k;
};

// ---------- 架空の様式（並びから正解と白紙） ----------

function layoutGold(layout: readonly KomorebiField[], accept: Record<string, ReadonlyArray<string | null>> = {}): GoldField[] {
  return layout.map((f) => {
    // 同意の欄は、読み取りの決まり 11（本人の意思の欄は項目なし、ケアマネが選ぶ）で項目なしも別解（T120。松山市の正解の表と同じ考え）。
    // 紙ではケアマネが選ぶまで空くので、紙の数え方は正解の項目のまま
    const alt = [...(accept[`${f.section}|${f.label}`] ?? []), ...(f.item?.startsWith("consent.") ? [null] : [])];
    return {
    page: f.page,
    section: f.section,
    label: f.label,
    shape: f.shape,
    options: [...f.options],
    item: key(f.item),
    ...(alt.length > 0 ? { accept: alt.map(key) } : {}),
    box: f.box,
    ...(f.optionBoxes ? { optionBoxes: f.optionBoxes } : {}),
    };
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const at = (b: FieldBox) => `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`;

/**
 * 白紙の様式の HTML（lib/forms/komorebi-form.fixture.ts の komorebiBlankHtml と同じ作り。向きと書体と頁の数を選べる）。
 * 欄の名前の枠と値を書く枠を罫線で描き、選ぶ欄は □ と選択肢の字、□ 1 つの欄は □ だけ。値は何も書かない
 */
export function layoutBlankHtml(o: {
  layout: readonly KomorebiField[];
  title: string;
  ver: string;
  landscape: boolean;
  typeface: Typeface;
}): string {
  const pageNos = [...new Set(o.layout.map((f) => f.page))].sort((a, b) => a - b);
  const pages = pageNos.map((page) => {
    const cells = o.layout
      .filter((f) => f.page === page)
      .flatMap((f) => {
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
    const head = page === pageNos[0] ? `<h1>${esc(o.title)}</h1><p class="ver">${esc(o.ver)}</p>` : `<p class="ver">（${page}）</p>`;
    return `<section class="pg">${head}${cells.join("")}</section>`;
  });
  const [w, h] = o.landscape ? [297, 210] : [210, 297];
  const font = o.typeface === "mincho" ? `"BIZ UDPMincho", "BIZ UDP明朝", serif` : `"BIZ UDPGothic", "BIZ UDPゴシック", sans-serif`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>白紙の様式</title><style>
@page { size: A4 ${o.landscape ? "landscape" : "portrait"}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.pg { position: relative; width: ${w}mm; height: ${h}mm; overflow: hidden; break-after: page; font-family: ${font}; color: #000; }
.pg:last-child { break-after: auto; }
h1 { position: absolute; left: 8%; top: 3.5%; margin: 0; font-size: 15pt; font-weight: 400; }
.ver { position: absolute; right: 8%; top: 2.5%; margin: 0; font-size: 8pt; }
.lbl, .val, .sq, .opt { position: absolute; box-sizing: border-box; }
.lbl { border: 1px solid #000; background: #eee; font-size: 8.5pt; padding: 0 1.2mm; display: flex; align-items: center; gap: 1.2mm; line-height: 1.15; }
.sec { font-size: 6.5pt; }
.val { border: 1px solid #000; border-left: none; }
.sq { border: 1px solid #000; }
.opt { font-size: 8.5pt; display: flex; align-items: center; white-space: nowrap; }
</style></head><body>${pages.join("")}</body></html>`;
}

/** 1 行の欄（名前 x0〜x1、値 x1〜x2） */
const row = (
  page: number,
  section: string,
  label: string,
  item: string | null,
  y: number,
  o: { shape?: FieldShape; h?: number; x?: [number, number, number]; options?: string[] } = {},
): KomorebiField => {
  const [x0, x1, x2] = o.x ?? [0.06, 0.26, 0.94];
  const h = o.h ?? 0.032;
  const options = o.options ?? [];
  const box = { x: x1, y, w: x2 - x1, h };
  return {
    page,
    section,
    label,
    shape: o.shape ?? "text",
    options,
    item,
    labelBox: { x: x0, y, w: x1 - x0, h },
    box,
    ...(options.length > 0
      ? { optionBoxes: options.map((_, i) => ({ x: x1 + 0.01 + i * ((x2 - x1 - 0.02) / options.length), y: y + h / 2 - 0.007, w: 0.016, h: 0.014 })) }
      : {}),
  };
};

/** □ 1 つの欄（名前の枠の右に □） */
const check = (page: number, section: string, label: string, item: string | null, x: number, y: number, w = 0.2): KomorebiField => ({
  page,
  section,
  label,
  shape: "check",
  options: [],
  item,
  labelBox: { x, y, w, h: 0.03 },
  box: { x: x + w + 0.008, y: y + 0.008, w: 0.016, h: 0.014 },
});

/** あおぞら市（架空）: 1 頁に詰めた表。言い方は「お名前」「ご住所」、心身の状況は □ の並び */
export const AOZORA_LAYOUT: KomorebiField[] = [
  row(1, "", "記入日", "plan.date", 0.085, { x: [0.56, 0.68, 0.94] }),
  row(1, "ご本人", "ふりがな", "person.kana", 0.13),
  row(1, "ご本人", "お名前", "person.name", 0.162),
  row(1, "ご本人", "性別", "basic.sex", 0.194, { shape: "choice", options: ["男", "女"], x: [0.06, 0.26, 0.5] }),
  row(1, "ご本人", "生年月日", "person.birth", 0.194, { shape: "date", x: [0.5, 0.62, 0.94] }),
  row(1, "ご本人", "ご住所", "basic.address", 0.226),
  row(1, "ご本人", "自宅電話", "self.phone", 0.258, { shape: "phone", x: [0.06, 0.26, 0.5] }),
  row(1, "ご本人", "携帯電話", "self.mobile", 0.258, { shape: "phone", x: [0.5, 0.62, 0.94] }),
  row(1, "ご本人", "世帯の状況", "basic.household", 0.29, { shape: "choice", options: ["ひとり暮らし", "高齢者のみ", "その他"] }),
  row(1, "ご本人", "要介護認定", "care.careLevel", 0.322, { x: [0.06, 0.26, 0.5] }),
  row(1, "ご本人", "障害者手帳", "care.handbook", 0.322, { x: [0.5, 0.62, 0.94] }),
  check(1, "心身の状況", "歩行が困難", "care.walking", 0.06, 0.37),
  check(1, "心身の状況", "耳が聞こえにくい", "care.hearing", 0.36, 0.37),
  check(1, "心身の状況", "目が見えにくい", "care.vision", 0.66, 0.37),
  check(1, "心身の状況", "認知症がある", "care.dementia", 0.06, 0.405),
  check(1, "心身の状況", "寝たきり", "care.bedridden", 0.36, 0.405),
  check(1, "心身の状況", "医療機器を使用", "medical.devices", 0.66, 0.405),
  row(1, "医療", "常用薬", "medical.medications", 0.45, { shape: "lines", h: 0.05 }),
  row(1, "医療", "かかりつけ医", "medical.doctor", 0.5),
  row(1, "家族等連絡先", "氏名", "emergency1.name", 0.55, { x: [0.06, 0.26, 0.5] }),
  row(1, "家族等連絡先", "続柄", "emergency1.relation", 0.55, { x: [0.5, 0.62, 0.94] }),
  row(1, "家族等連絡先", "電話", "emergency1.phone", 0.582, { shape: "phone" }),
  row(1, "避難支援者①", "氏名", "supporter1.name", 0.63, { x: [0.06, 0.26, 0.5] }),
  row(1, "避難支援者①", "電話", "supporter1.phone", 0.63, { shape: "phone", x: [0.5, 0.62, 0.94] }),
  row(1, "避難支援者②", "氏名", "supporter2.name", 0.662, { x: [0.06, 0.26, 0.5] }),
  row(1, "避難支援者②", "電話", "supporter2.phone", 0.662, { shape: "phone", x: [0.5, 0.62, 0.94] }),
  row(1, "避難", "避難場所", "evacuation.destination1", 0.71),
  row(1, "避難", "避難時の配慮事項", "care.issues", 0.742, { shape: "lines", h: 0.06 }),
  check(1, "", "情報の提供に同意する", null, 0.06, 0.82, 0.3),
  // 担当ケアマネの欄は担当ケアマネの項目（T140。T131 で足した項目。前の計画作成者〔事業所名と担当を 1 つに〕は別解）
  row(1, "", "担当ケアマネ", "plan.careManager", 0.86),
  row(1, "", "受付番号（市記入）", null, 0.91, { x: [0.56, 0.74, 0.94] }),
];

/** しおかぜ町（架空）: A4 横 2 頁。左右 2 列、言い方の違う欄（要配慮者氏名・浸水想定・医療的ケア） */
const L2: [number, number, number] = [0.05, 0.19, 0.48];
const R2: [number, number, number] = [0.52, 0.66, 0.95];
export const SHIOKAZE_LAYOUT: KomorebiField[] = [
  row(1, "要配慮者", "要配慮者氏名", "person.name", 0.15, { x: L2, h: 0.045 }),
  row(1, "要配慮者", "フリガナ", "person.kana", 0.195, { x: L2, h: 0.045 }),
  row(1, "要配慮者", "生年月日", "person.birth", 0.24, { shape: "date", x: L2, h: 0.045 }),
  row(1, "要配慮者", "年齢", "person.age", 0.285, { x: L2, h: 0.045 }),
  row(1, "要配慮者", "住所", "basic.address", 0.33, { x: L2, h: 0.045 }),
  row(1, "要配慮者", "連絡先電話", "self.phone", 0.375, { shape: "phone", x: L2, h: 0.045 }),
  row(1, "要配慮者", "要介護度", "care.careLevel", 0.42, { x: L2, h: 0.045 }),
  row(1, "要配慮者", "難病", "care.intractableDisease", 0.465, { x: L2, h: 0.045 }),
  row(1, "要配慮者", "住まいの構造", "basic.housing.structure", 0.51, { x: L2, h: 0.045 }),
  row(1, "要配慮者", "居室の階", "basic.housing.floor", 0.555, { x: L2, h: 0.045 }),
  row(1, "避難", "浸水想定", "evacuation.hazards", 0.15, { x: R2, h: 0.045 }),
  row(1, "避難", "避難先", "evacuation.destination1", 0.195, { x: R2, h: 0.045 }),
  row(1, "避難", "第二避難先", "evacuation.destination2", 0.24, { x: R2, h: 0.045 }),
  row(1, "避難", "移動手段", "evacuation.transport", 0.285, { x: R2, h: 0.045 }),
  row(1, "避難", "避難経路", "evacuation.route", 0.33, { shape: "lines", x: R2, h: 0.09 }),
  row(1, "避難", "持ち出す物", "evacuation.carryItems", 0.42, { shape: "lines", x: R2, h: 0.09 }),
  row(1, "避難", "ペット", "evacuation.pets", 0.51, { x: R2, h: 0.045 }),
  row(1, "", "町確認欄", null, 0.7, { shape: "handwrite", x: R2, h: 0.12 }),
  row(2, "医療的ケア", "医療機器", "medical.devices", 0.15, { shape: "lines", x: L2, h: 0.09 }),
  row(2, "医療的ケア", "服薬", "medical.medications", 0.24, { shape: "lines", x: L2, h: 0.12 }),
  row(2, "医療的ケア", "アレルギー", "medical.allergies", 0.36, { x: L2, h: 0.045 }),
  row(2, "医療的ケア", "既往歴", "medical.history", 0.405, { x: L2, h: 0.045 }),
  row(2, "支援者", "支援者1 氏名", "supporter1.name", 0.15, { x: R2, h: 0.045 }),
  row(2, "支援者", "支援者1 電話", "supporter1.phone", 0.195, { shape: "phone", x: R2, h: 0.045 }),
  row(2, "支援者", "支援者2 氏名", "supporter2.name", 0.24, { x: R2, h: 0.045 }),
  row(2, "支援者", "支援者2 電話", "supporter2.phone", 0.285, { shape: "phone", x: R2, h: 0.045 }),
  row(2, "支援者", "夜間の対応", "people.night", 0.33, { x: R2, h: 0.045 }),
  row(2, "支援者", "民生委員", "people.welfare", 0.375, { x: R2, h: 0.045 }),
  row(2, "", "本人の希望", "notes.words", 0.5, { shape: "lines", x: L2, h: 0.12 }),
  row(2, "", "特記事項", "notes.other", 0.5, { shape: "lines", x: R2, h: 0.12 }),
];

// ---------- 同梱の様式 ----------

/** 枠（mm）から欄の場所（頁の比）。areas に無ければ slots の矩形を合わせる */
function frameBox<K extends string>(frame: Frame<K>, k: K, page: number): FieldBox | undefined {
  const size = frame.pages.find((p) => p.page === page);
  if (!size) return undefined;
  let boxes = frame.areas.filter((a) => a.page === page && a.keys.includes(k)).map((a) => a.box);
  if (boxes.length === 0) boxes = frame.slots.filter((s) => s.page === page && ("keys" in s ? s.keys.includes(k) : s.key === k)).map((s) => s.box);
  if (boxes.length === 0) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(x0 / size.w), y: r(y0 / size.h), w: r((x1 - x0) / size.w), h: r((y1 - y0) / size.h) };
}

/**
 * 松山市の計画書の欄 → 項目。無い欄は正解に入れない（特記事項の中の段・様式に無い欄は下で 1 つにまとめる）。
 * T122: T117 で台帳に置き場ができた欄（近親者・実施者のフリガナ、実施組織、避難場所の時間、最寄りの避難場所、住居の種別）を
 * 対応なしから項目ありに（評価の 2 回目で、AI がこの項目を当てた欄を外れと数えていた。findings の 7）
 */
const MATSUYAMA_ITEMS: Partial<Record<MatsuyamaKey, string | null>> = {
  "head.number": null,
  "head.date": "plan.date",
  "target.kana": "person.kana",
  "target.name": "person.name",
  "target.sex": "basic.sex",
  "target.birth": "person.birth",
  "target.district": "basic.town",
  "target.address": "basic.address",
  "target.phone": "self.phone",
  "target.mobile": "self.mobile",
  "target.category": null,
  "local.welfare": "people.welfare",
  "local.watcher": "local.watcher",
  "local.office": "people.offices",
  "local.other": null,
  "target.household": "basic.household",
  "target.timeline": "evacuation.myTimeline",
  "consent.registry": null,
  "consent.planShare": null,
  "sign.self": null,
  "sign.proxy": null,
  "kin.kana": "emergency1.kana",
  "kin.name": "emergency1.name",
  "kin.relation": "emergency1.relation",
  "kin.phone": "emergency1.phone",
  "kin.mobile": "emergency1.phone",
  "kin.address": "emergency1.address",
  "supporter1.kana": "supporter1.kana",
  "supporter1.name": "supporter1.name",
  "supporter1.address": "supporter1.address",
  "supporter1.phone": "supporter1.phone",
  "supporter1.mobile": "supporter1.phone",
  "supporter1.relation": "supporter1.relation",
  "supporter1.consent": null,
  "supporter2.kana": "supporter2.kana",
  "supporter2.name": "supporter2.name",
  "supporter2.address": "supporter2.address",
  "supporter2.phone": "supporter2.phone",
  "supporter2.mobile": "supporter2.phone",
  "supporter2.relation": "supporter2.relation",
  "supporter2.consent": null,
  "org.name": "org.name",
  "org.phone": "org.phone",
  "org.consent": null,
  "plan.author": "plan.author",
  "medical.doctor": "medical.doctor",
  "medical.drugs": "medical.medications",
  "risk.home": "evacuation.hazards",
  "risk.timing": null,
  "risk.issues": "care.issues",
  "shelter.pre.place": "evacuation.destination2",
  "shelter.pre.means": "evacuation.destination2Means",
  "shelter.pre.minutes": "evacuation.destination2Minutes",
  "shelter.near.place": "evacuation.nearest",
  "shelter.near.means": "evacuation.nearestMeans",
  "shelter.near.minutes": "evacuation.nearestMinutes",
  "shelter.city.place": "evacuation.destination1",
  "shelter.city.means": "evacuation.transport",
  "shelter.city.minutes": "evacuation.destination1Minutes",
  "housing.type": "basic.housing.type",
  "housing.structure": "basic.housing.structure",
  "housing.floors": "basic.housing.floors",
  "housing.room": "basic.housing.floor",
  "housing.bedroom": "basic.housing.bedroom",
  "support.kinds": "evacuation.support",
  "notes.annex": "medical.annex",
  "route.text": "evacuation.route",
  "route.map": null,
  "city.stamp": null,
};
/** 決めきれない欄の別解 */
const MATSUYAMA_ACCEPT: Partial<Record<MatsuyamaKey, ReadonlyArray<string | null>>> = {
  "target.category": ["care.careLevel"],
  "local.other": ["people.offices"],
  "housing.room": ["basic.housing.bedroom"],
  "shelter.city.means": [null],
  // 携帯番号の欄（T133）: 連絡先の電話の項目は電話と携帯の 2 つを持ち、紙は欄の名前で携帯の行だけを出す（lib/forms/mapped-sheet.ts の phoneRole）。
  // 正解は同じ段の電話の項目（読み取りの補い lib/forms/item-hints.ts の携帯も同じ物を当てる）。前の決まり 12 の項目なしは別解
  "kin.mobile": [null],
  "supporter1.mobile": [null],
  "supporter2.mobile": [null],
  // 避難場所ごとの【手段】【時間】は T131 から台帳の項目が避難場所ごとにある（T117 の destination2Means・nearestMeans・nearestMinutes）。
  // T122 の「どの避難場所の欄に当てても別解」は外した（移動手段を別の避難場所の欄に置くと、紙で違う避難場所の手段になる。評価の 3 回目の 4）
};

function matsuyamaGold(): GoldField[] {
  const out: GoldField[] = [];
  for (const f of MATSUYAMA_FIELDS) {
    if (!(f.key in MATSUYAMA_ITEMS)) continue;
    const item = MATSUYAMA_ITEMS[f.key as MatsuyamaKey] ?? null;
    const box = frameBox(MATSUYAMA_FRAME, f.key as MatsuyamaKey, f.page);
    const shape: FieldShape = f.shape === "consent" ? "choice" : f.shape;
    out.push({
      page: f.page,
      section: f.block === "head" || f.block === "target" ? "" : blockName(f.block),
      label: f.label,
      shape,
      options: "options" in f && f.options ? [...f.options] : [],
      item: key(item),
      ...(MATSUYAMA_ACCEPT[f.key as MatsuyamaKey] ? { accept: MATSUYAMA_ACCEPT[f.key as MatsuyamaKey]!.map(key) } : {}),
      ...(box ? { box } : {}),
    });
    // 特記事項は様式では 1 つの書き込みの欄（中の段はケア72 の分け方）。別紙の あり・なし の前に 1 欄で置く
    if (f.key === "support.kinds") {
      const notes = frameBox(MATSUYAMA_FRAME, "notes.other", 2);
      out.push({
        page: 2,
        section: "",
        label: "特記事項",
        shape: "lines",
        options: [],
        item: "notes.other",
        accept: ["notes.words", "medical.notes"],
        ...(notes ? { box: notes } : {}),
      });
    }
  }
  return out;
}

const BLOCK_NAMES: Record<string, string> = {
  local: "地域の支援者",
  consent: "同意",
  sign: "署名",
  kin: "近親者及緊急時の連絡先",
  supporter1: "避難支援等実施者１",
  supporter2: "避難支援等実施者２",
  org: "避難支援等実施組織",
  plan: "",
  risk: "自宅のリスク",
  shelter: "私の避難場所",
  housing: "住居",
  support: "",
  notes: "特記事項",
  route: "",
  city: "",
};
const blockName = (b: string) => BLOCK_NAMES[b] ?? "";

/** 災害診療記録2018 の 1・2 頁の欄 → 項目（医師が書く欄・ケア72 が足した欄〔extra〕は様式の欄でないので入れない） */
const KIROKU_ITEMS: Partial<Record<MedicalKey, string | null>> = {
  "doctor.firstVisit": null,
  "doctor.physician": null,
  "patient.kana": "person.kana",
  "patient.name": "person.name",
  "patient.sex": "basic.sex",
  "patient.birth": "person.birth",
  "patient.phone": "self.mobile",
  "patient.address": "basic.address",
  "patient.house": null,
  "shelter.first": "evacuation.destination1",
  "shelter.second": "evacuation.destination2",
  // 連絡先の種類の □（家族・知人・その他・連絡先なし）は緊急連絡先 1 の関係（T140。台帳の連絡先の種類と照らして □ に印。
  // lib/forms/option-values.ts の関係の値の表。専用の紙 lib/forms/medical-summary.ts と同じ印）。前の正解は項目なし（紙は空）で、
  // AI の当てた関係の欄の印を「余分」と数えていた（評価の 4 回目の 3）
  "contact.kinds": "emergency1.relation",
  "contra.allergy": "medical.allergies",
  "contra.food": null,
  // 薬の区分の □（T131）: 専用の紙（lib/forms/medical-summary.ts）は区分の薬があれば印。読み取りの決まり 12 の例外（□ ごとに常用薬）と
  // 紙の種類ごとの印（lib/forms/mapped-sheet.ts の MEDICATION_KIND_WORDS）で同じ印になる。前の正解は項目なし（紙は空）で、
  // 区分の薬がある人の印を「余分」と数えていた（評価の 3 回目の 4）。項目なしは別解に残す（紙は空く）
  "drug.antiplatelet": "medical.medications",
  "drug.anticoagulant": "medical.medications",
  "drug.diabetes": "medical.medications",
  "drug.steroid": "medical.medications",
  "drug.antiepileptic": "medical.medications",
  "drug.other": "medical.medications",
  "drug.dialysis": "medical.dialysis",
  "drug.hot": "medical.devices",
  "care.vulnerable": null,
  "care.protect": null,
  "doctor.disease": null,
  "doctor.triage": null,
  "id.medical": null,
  "history.disease": "medical.history",
  "history.vaccination": "medical.vaccinations",
};
const KIROKU_ACCEPT: Partial<Record<MedicalKey, ReadonlyArray<string | null>>> = {
  "patient.birth": ["person.age"],
  "patient.phone": ["self.phone"],
  "contact.kinds": [null, "emergency1.name"],
  "drug.antiplatelet": [null],
  "drug.anticoagulant": [null],
  "drug.diabetes": [null],
  "drug.steroid": [null],
  "drug.antiepileptic": [null],
  "drug.other": [null],
  "drug.dialysis": ["medical.devices"],
  "care.vulnerable": ["care.careLevel"],
};
const KIROKU_SHAPES: Partial<Record<MedicalKey, FieldShape>> = {
  "patient.sex": "choice",
  "contact.kinds": "choice",
  "patient.birth": "date",
  "patient.phone": "phone",
  "drug.antiplatelet": "check",
  "drug.anticoagulant": "check",
  "drug.diabetes": "check",
  "drug.steroid": "check",
  "drug.antiepileptic": "check",
  "drug.other": "check",
  "drug.dialysis": "check",
  "drug.hot": "check",
  "doctor.firstVisit": "date",
  "doctor.physician": "handwrite",
  "doctor.disease": "handwrite",
  "doctor.triage": "handwrite",
  // 既往症・予防接種は □ の並び（T161）。様式の原本（lib/forms/form-audit.ts の MEDICAL_AUDIT）と読み取りの決まり 2（既往症・予防接種の
  // □ の並びは 1 欄の choice）に合わせる。前は字の欄（text）で、紙の正解を「台帳の言葉を・でつないだ字」にしていた（評価の 6 回目で
  // □ に印を付けた紙を「置き間違い」と数えた。4 回目までは種の台帳にこの値が無く、両方空いて当たりも外れも無かった）
  "history.disease": "choice",
  "history.vaccination": "choice",
};

/**
 * 選択肢を持たせる欄（T140）: 連絡先の種類の □。書く所は □ の並びと連絡先の人の書く所を合わせた行（様式の「連絡先」の行。AI もこの行を読む）
 */
const KIROKU_OPTIONS: Partial<Record<MedicalKey, { options: string[]; with?: MedicalKey }>> = {
  "contact.kinds": { options: ["家族", "知人", "その他", "連絡先なし"], with: "contact.people" },
  // T161: 既往症・予防接種の □ の選択肢は原本の照合の表から（様式の字と順）
  "history.disease": { options: auditOptions("history.disease") },
  "history.vaccination": { options: auditOptions("history.vaccination") },
};

/** 原本の照合の表（MEDICAL_AUDIT）の選ぶ欄の選択肢 */
function auditOptions(k: MedicalKey): string[] {
  const row = MEDICAL_AUDIT.rows.find((r) => r.keys.includes(k) && r.options);
  if (!row?.options) throw new Error(`原本の照合の表に ${k} の選択肢が無い`);
  return [...row.options];
}

/** 原本の枠の □ の場所（頁の比） */
function frameMarks<K extends string>(frame: Frame<K>, k: K, page: number, options: readonly string[]): FieldBox[] | undefined {
  const size = frame.pages.find((p) => p.page === page);
  if (!size) return undefined;
  const r = (n: number) => Math.round(n * 10000) / 10000;
  const out: FieldBox[] = [];
  for (const o of options) {
    const m = frame.slots.find((s) => s.page === page && s.kind === "mark" && s.key === k && s.option === o);
    if (!m) return undefined;
    out.push({ x: r(m.box.x / size.w), y: r(m.box.y / size.h), w: r(m.box.w / size.w), h: r(m.box.h / size.h) });
  }
  return out;
}

const unionBox = (a: FieldBox, b: FieldBox): FieldBox => {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(x0), y: r(y0), w: r(Math.max(a.x + a.w, b.x + b.w) - x0), h: r(Math.max(a.y + a.h, b.y + b.h) - y0) };
};

/** 原本の枠の 1 つの種類の矩形（頁の比）。mark なら □ 1 つの場所、text なら字を書く所 */
function frameSlotBox<K extends string>(frame: Frame<K>, k: K, page: number, kind: "mark" | "text"): FieldBox | undefined {
  const size = frame.pages.find((p) => p.page === page);
  const slot = frame.slots.find((s) => s.page === page && s.kind === kind && ("keys" in s ? s.keys.includes(k) : s.key === k));
  if (!size || !slot) return undefined;
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(slot.box.x / size.w), y: r(slot.box.y / size.h), w: r(slot.box.w / size.w), h: r(slot.box.h / size.h) };
}

/**
 * 常用薬の種類の □ と、その後ろの括弧（T164）: 原本は「□抗血小板薬（　）」「□抗凝固薬 □ワーファリン（　）」のように行ごとに □ と括弧があり、
 * 原本の枠（frame-kiroku.ts）も □ の印と括弧の書く所の 2 つ。専用の紙（lib/forms/medical-summary.ts）は括弧にその種類の薬の名前を書く。
 * 前の正解は行全体の 1 つの □ の欄で、AI が □ と括弧の 2 欄に読む（読み取りの決まり 21）と、行の場所が広い括弧の欄を □ と合わせていた
 * （評価の 7 回目の「正解は空の常用薬の欄に字」55・55・49・44）。括弧の欄の名前は「抗血小板薬（　）」（紙の括弧の子の欄と同じ形）。
 * 透析・在宅酸素の行は原本に括弧が刷っていないので □ だけ
 */
const KIROKU_DRUG_BRACKETS: readonly MedicalKey[] = ["drug.antiplatelet", "drug.anticoagulant", "drug.diabetes", "drug.steroid", "drug.antiepileptic", "drug.other"];

/**
 * □ の後ろに中身を書く括弧が続く欄（T161）: 「□アレルギー（　）」は □ の欄と括弧の中の字の欄の 2 つ（原本の枠 frame-kiroku.ts も □ の印と
 * 字の書く所の 2 つ。読み取りの決まり 21）。前の正解は □ と括弧を合わせた 1 つの字の欄で、AI が □ だけに読んだ紙（印だけで中身の無い紙）と
 * 字の欄を比べていた
 */
const KIROKU_MARK_AND_TEXT: ReadonlySet<MedicalKey> = new Set(["contra.allergy", ...KIROKU_DRUG_BRACKETS]);

function kirokuGold(): GoldField[] {
  return MEDICAL_FIELDS.filter((f) => f.key in KIROKU_ITEMS).flatMap((f): GoldField[] => {
    const k = f.key as MedicalKey;
    if (KIROKU_MARK_AND_TEXT.has(k)) {
      const item = key(KIROKU_ITEMS[k] ?? null);
      const mark = frameSlotBox(KIROKU_FRAME, k, f.page, "mark");
      const text = frameSlotBox(KIROKU_FRAME, k, f.page, "text");
      const accept = KIROKU_ACCEPT[k] ? { accept: KIROKU_ACCEPT[k]!.map(key) } : {};
      const drug = KIROKU_DRUG_BRACKETS.includes(k);
      return [
        { page: f.page, section: "", label: f.label, shape: "check", options: [], item, ...accept, ...(mark ? { box: mark } : {}) },
        { page: f.page, section: "", label: drug ? `${f.label}（　）` : f.label, shape: "text", options: [], item, ...accept, ...(text ? { box: text } : {}) },
      ];
    }
    const opt = KIROKU_OPTIONS[k];
    const own = frameBox(KIROKU_FRAME, k, f.page);
    const more = opt?.with ? frameBox(KIROKU_FRAME, opt.with, f.page) : undefined;
    const box = own && more ? unionBox(own, more) : own;
    const optionBoxes = opt ? frameMarks(KIROKU_FRAME, k, f.page, opt.options) : undefined;
    return [
      {
        page: f.page,
        section: "",
        label: f.label,
        shape: KIROKU_SHAPES[k] ?? "text",
        options: opt?.options ?? [],
        ...(optionBoxes ? { optionBoxes } : {}),
        item: key(KIROKU_ITEMS[k] ?? null),
        ...(KIROKU_ACCEPT[k] ? { accept: KIROKU_ACCEPT[k]!.map(key) } : {}),
        ...(box ? { box } : {}),
      },
    ];
  });
}

/**
 * 様式 9 の列 → 項目。一覧の表（T131 の決まり 17）なので、表の列の欄は 1 行目（7 行目）の枠で数える。
 * T131 で直した所（評価の 3 回目の 3・9）: 欄の名前と段をひな形の見出しの字（FORM9_HEADS。前は CSV の見出しから作り「想定される避難所」の
 * ような原本に無い名前だった）、場所を原本の枠（frame-form9.ts）から、表の外の「事業所名」「作成」の欄を足し、担当ケアマネは T131 の
 * plan.careManager（前の plan.author と項目なしは別解から外す。項目なしだと全部の紙で空く）
 */
type Form9Gold = { cell: string; section: string; label: string; item: string | null; accept?: ReadonlyArray<string | null>; shape?: FieldShape };
const FORM9_GOLD: readonly Form9Gold[] = [
  // 4 行目の「事業所名：」「作成：　年　月　日」。ブックを頁に描いた画像では、事業所名の書く所は C〜J、作成は K〜M（評価の 3 回目の本物の答えの場所）
  { cell: "C4:J4", section: "", label: "事業所名", item: "plan.office", accept: ["plan.author"] },
  { cell: "K4:M4", section: "", label: "作成", item: "plan.date", shape: "date" },
  { cell: "B7", section: "", label: "No", item: null },
  { cell: "C7", section: "優先順位", label: "医療・介護", item: null },
  { cell: "D7", section: "優先順位", label: "環境", item: null },
  { cell: "E7", section: "優先順位", label: "避難", item: null },
  { cell: "F7", section: "", label: "地域区分", item: "basic.town", accept: ["basic.address"] },
  { cell: "G7", section: "", label: "氏名（年齢）", item: "person.name", accept: ["person.age"] },
  { cell: "H7", section: "", label: "住所（自治会）", item: "basic.address" },
  { cell: "I7", section: "想定される避難場所", label: "避難所", item: "evacuation.destination1" },
  { cell: "J7", section: "想定される避難場所", label: "介護・医療機関", item: null, accept: ["evacuation.destination2"] },
  { cell: "K7", section: "", label: "特記", item: "notes.other", accept: ["medical.notes", "notes.words"] },
  { cell: "L7", section: "", label: "担当ケアマネ", item: "plan.careManager", accept: ["plan.author"] },
  { cell: "M7", section: "", label: "安否確認できた日", item: null, shape: "date" },
];

/**
 * 評価の台が AI に見せる様式 9 の頁は、ブックを lib/ooxml で描いた絵（tools/eval/forms/browser.ts）。その描き方の列の幅は
 * 「列幅の文字数 × 既定の書体〔Yu Gothic 11pt〕の数字の幅（pt、画素に丸めない）× 印刷の倍率」（lib/ooxml/xlsx.ts の makeGrid）で、
 * 原本の枠（frame-form9.ts。画面の画素の式）より 1 割ほど狭い。T140: 前の正解の表は原本の枠の列の場所で、描いた頁の右の列ほどずれ、
 * 担当ケアマネの列が 1 列右に数えられていた（評価の 4 回目の 3）。列の左右は描き方と同じ式から出す（行は同じ）
 */
const FORM9_DIGIT_MM = digitEmOf("Yu Gothic") * 11 * (25.4 / 72) * FORM9_PRINT_SCALE;
const FORM9_RENDER_X: readonly number[] = FORM9_COL_CHARS.reduce<number[]>((xs, c) => [...xs, xs[xs.length - 1] + c * FORM9_DIGIT_MM], [FORM9_MARGIN_MM.left]);
const FORM9_COLS = "ABCDEFGHIJKLMN";

/** セルの参照（"L7"・"C4:J4"）から頁の比の矩形。縦は原本の枠、横は描き方の列 */
function form9Box(ref: string): FieldBox {
  const c = form9Cell(ref);
  const [a, b = a] = ref.split(":");
  const x0 = FORM9_RENDER_X[FORM9_COLS.indexOf(a[0])];
  const x1 = FORM9_RENDER_X[FORM9_COLS.indexOf(b[0]) + 1];
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r(x0 / FORM9_PAGE_MM.w), y: r(c.y / FORM9_PAGE_MM.h), w: r((x1 - x0) / FORM9_PAGE_MM.w), h: r(c.h / FORM9_PAGE_MM.h) };
}

function form9Gold(): GoldField[] {
  return FORM9_GOLD.map((g) => ({
    page: 1,
    section: g.section,
    label: g.label,
    shape: g.shape ?? "text",
    options: [],
    item: key(g.item),
    ...(g.accept ? { accept: g.accept.map(key) } : {}),
    box: form9Box(g.cell),
  }));
}

/** 様式 9 の一覧の表の形（T131）: 人を書く 20 行（7〜26 行目）、1 行目の帯は B7:M7 */
export function form9GoldList(): NonNullable<ReadResult["list"]> {
  return { page: 1, rows: FORM9_ROWS_PER_PAGE, first: form9Box("B7:M7"), last: form9Box(`B${6 + FORM9_ROWS_PER_PAGE}:M${6 + FORM9_ROWS_PER_PAGE}`) };
}

// ---------- 一覧 ----------

export const GOLD_FORMS: readonly GoldForm[] = [
  {
    id: "komorebi",
    title: KOMOREBI_TITLE,
    issuer: KOMOREBI_ISSUER,
    city: null,
    source: { kind: "generated", html: komorebiBlankHtml, landscape: false },
    typeface: "mincho",
    pages: [1, 2],
    fields: layoutGold(KOMOREBI_LAYOUT),
  },
  {
    id: "aozora",
    title: "あおぞら市 避難行動要支援者 個別避難計画書",
    issuer: "あおぞら市（架空）",
    city: null,
    source: {
      kind: "generated",
      html: () => layoutBlankHtml({ layout: AOZORA_LAYOUT, title: "あおぞら市 避難行動要支援者 個別避難計画書", ver: "様式第2号（架空）", landscape: false, typeface: "gothic" }),
      landscape: false,
    },
    typeface: "gothic",
    pages: [1],
    fields: layoutGold(AOZORA_LAYOUT, { "避難|避難時の配慮事項": ["notes.other"], "|担当ケアマネ": ["plan.author"] }),
  },
  {
    id: "shiokaze",
    title: "しおかぜ町 災害時避難支援プラン（個別計画）",
    issuer: "しおかぜ町（架空）",
    city: null,
    source: {
      kind: "generated",
      html: () => layoutBlankHtml({ layout: SHIOKAZE_LAYOUT, title: "しおかぜ町 災害時避難支援プラン（個別計画）", ver: "町様式（架空）", landscape: true, typeface: "mincho" }),
      landscape: true,
    },
    typeface: "mincho",
    pages: [1, 2],
    fields: layoutGold(SHIOKAZE_LAYOUT, { "支援者|夜間の対応": ["supporter1.relation"] }),
  },
  {
    id: "matsuyama",
    title: ORIGINALS.matsuyama.title,
    issuer: "松山市",
    city: "松山市",
    source: { kind: "corpus", sha256: ORIGINALS.matsuyama.sha256, url: ORIGINALS.matsuyama.url, fileName: /keikaku/i },
    typeface: "gothic",
    pages: [1, 2],
    fields: matsuyamaGold(),
  },
  {
    id: "kiroku",
    title: ORIGINALS.kiroku.title,
    issuer: "厚生労働省",
    city: null,
    source: { kind: "corpus", sha256: ORIGINALS.kiroku.sha256, url: ORIGINALS.kiroku.url },
    typeface: "gothic",
    pages: [1, 2],
    fields: kirokuGold(),
  },
  {
    id: "form9",
    title: "様式9：災害時利用者一覧表 (安否確認優先順位)",
    issuer: "厚生労働省",
    city: null,
    source: { kind: "corpus", fileName: /様式9|yoshiki9|bcp/i },
    typeface: "gothic",
    pages: [1],
    fields: form9Gold(),
    list: form9GoldList(),
  },
];

export const MATSUYAMA_SOURCE_URL = MATSUYAMA_FORM_URL;

/** 正解どおりに読んだときの Opus の返事の形（偽の client の正解の答え） */
export function goldReading(form: GoldForm, pages: number): ReadResult {
  return {
    title: form.title,
    issuer: form.issuer,
    pages,
    typeface: form.typeface,
    fields: form.fields
      .filter((f) => f.page <= pages)
      .map((f) => ({
        page: f.page,
        section: f.section,
        label: f.label,
        position: `${f.page}頁 ${f.section || "表"}`,
        shape: f.shape,
        options: f.options,
        item: f.shape === "handwrite" ? null : f.item,
        confidence: "high" as const,
        reason: "正解の表",
        box: f.box ?? null,
        option_boxes: f.shape === "choice" ? (f.optionBoxes ?? []) : [],
      })),
    ...(form.list && form.list.page <= pages ? { list: form.list } : {}),
  };
}

/** 正解の対応表（紙の値の正解を作る）。頁は原本の頁の数の中だけ */
export function goldMapping(form: GoldForm, pages: number): FormMapping {
  return {
    title: form.title,
    issuer: form.issuer,
    pages,
    typeface: form.typeface,
    fields: form.fields
      .filter((f) => f.page <= pages)
      .map((f, i) => ({
        id: `g${i + 1}`,
        page: f.page,
        section: f.section,
        label: f.label,
        position: "",
        shape: f.shape,
        options: f.options,
        item: f.shape === "handwrite" ? null : f.item,
        removed: false,
        ai: null,
        box: f.box ?? null,
        ...(f.optionBoxes ? { optionBoxes: f.optionBoxes } : {}),
      })),
    ...((): Pick<FormMapping, "list"> => {
      const list = listShapeOf(form.list, pages);
      return list ? { list } : {};
    })(),
  };
}
