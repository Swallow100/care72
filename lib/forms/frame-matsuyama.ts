// 松山市の計画書（様式【2026.9.10】）の原本の枠の寸法（T101）。原本の頁を下に敷き、ここの矩形に台帳の値を置く（lib/forms/frame-sheet.ts）。
//
// 値は作業者が原本から起こした物（lib/forms/form-audit.ts と同じく人が原本から取った値）:
// - 原本: ORIGINALS.matsuyama（lib/forms/originals.ts）の URL の PDF（SHA-256 もそこ）。リポジトリには入れない
// - 取り方: pdf.js の getOperatorList で罫線（constructPath の線。太さ 0.3mm、細い点線 0.04mm）を、save/restore と transform を追って
//   頁の左上を原点の mm に。□ は画像（paintImageXObject、6.35×3.13mm などの「□ 」の絵）の位置から、□ の部分（画像の高さの 0.92 の正方形）。
//   刷ってある字（年・月・日・（ ）・TEL）は getTextContent の位置。作業者の一時フォルダで原本の絵に矩形を重ねて見比べた
// - area は欄の矩形（未記入の色付けで塗る所）。ruled の物は 4 辺が原本の罫線の中心（±0.3mm を手元のテストで確かめる）
// - text の box は値を書く所。欄の名前・（ ）・単位の字を避けた内側（fitText が内側にさらに 0.8・0.5mm 空ける）

import type { MatsuyamaKey } from "./matsuyama.ts";
import { checkBox, mm, type Frame } from "./frame-sheet.ts";

/** 地域の支援者の 5 行（民生・児童委員・みまもり員・事業所等・名前の無い 2 行）の上と下（mm） */
const LOCAL_ROWS: ReadonlyArray<[number, number]> = [
  [61.83, 66.3],
  [66.33, 70.91],
  [70.94, 75.52],
  [75.55, 80.13],
  [80.16, 84.6],
];
/** 地域の支援者の行の（ ）の中: 名前と TEL(携帯) */
const localRow = (key: MatsuyamaKey, row: number, line = 0) => {
  const [y0, y1] = LOCAL_ROWS[row];
  return [
    { kind: "text" as const, keys: [key], page: 1, box: mm(125.0, y0, 144.7, y1), take: { line, part: "name" as const } },
    { kind: "text" as const, keys: [key], page: 1, box: mm(163.0, y0, 190.0, y1), take: { line, part: "tel" as const } },
  ];
};

/** 避難支援等実施者 1・2（2 は 1 の 22.65mm 下） */
function supporter(n: 1 | 2) {
  const o = n === 1 ? 0 : 22.65;
  const k = (part: string) => `supporter${n}.${part}` as MatsuyamaKey;
  return {
    slots: [
      { kind: "text" as const, keys: [k("kana")], page: 1, box: mm(45.26, 193.84 + o, 120.0, 197.2 + o) },
      { kind: "text" as const, keys: [k("name")], page: 1, box: mm(45.26, 199.9 + o, 81.8, 206.96 + o), take: { part: "family" as const } },
      { kind: "text" as const, keys: [k("name")], page: 1, box: mm(82.1, 199.9 + o, 120.0, 206.96 + o), take: { part: "given" as const } },
      { kind: "text" as const, keys: [k("phone")], page: 1, box: mm(136.6, 193.84 + o, 175.63, 200.45 + o) },
      { kind: "text" as const, keys: [k("mobile")], page: 1, box: mm(136.6, 200.74 + o, 175.63, 206.96 + o) },
      { kind: "text" as const, keys: [k("address")], page: 1, box: mm(45.26, 207.26 + o, 120.0, 216.19 + o) },
      { kind: "text" as const, keys: [k("relation")], page: 1, box: mm(132.57, 207.26 + o, 175.63, 216.19 + o) },
      { kind: "mark" as const, key: k("consent"), page: 1, option: "同意", box: checkBox(183.08, 208.02 + o, 3.47) },
    ],
    areas: [
      { keys: [k("kana")], page: 1, box: mm(45.11, 193.69 + o, 120.15, 197.33 + o), ruled: true },
      { keys: [k("name")], page: 1, box: mm(45.11, 197.33 + o, 120.15, 207.11 + o), ruled: true },
      { keys: [k("phone")], page: 1, box: mm(136.5, 193.69 + o, 175.78, 200.59 + o), ruled: false },
      { keys: [k("mobile")], page: 1, box: mm(136.5, 200.59 + o, 175.78, 207.11 + o), ruled: false },
      { keys: [k("address")], page: 1, box: mm(45.11, 207.11 + o, 120.15, 216.34 + o), ruled: true },
      { keys: [k("relation")], page: 1, box: mm(132.42, 207.11 + o, 175.78, 216.34 + o), ruled: true },
      { keys: [k("consent")], page: 1, box: mm(175.78, 193.69 + o, 194.2, 216.34 + o), ruled: true },
    ],
  };
}

/** 私の避難場所の 3 行（事前避難場所・最寄りの避難場所・市指定避難所。行の高さ 9.23mm） */
function shelter(id: "pre" | "near" | "city", i: number) {
  const o = i * 9.23;
  const k = (part: string) => `shelter.${id}.${part}` as MatsuyamaKey;
  const place = id === "city" ? mm(57.54, 78.51, 126.13, 87.43) : mm(82.1, 60.04 + o, 126.13, 68.98 + o);
  const placeArea = id === "city" ? mm(57.39, 78.36, 126.28, 87.58) : mm(81.95, 59.89 + o, 126.28, 69.13 + o);
  return {
    slots: [
      { kind: "text" as const, keys: [k("place")], page: 2, box: place },
      { kind: "mark" as const, key: k("means"), page: 2, option: "徒歩", box: checkBox(140.06, 60.3 + o, 3.13) },
      { kind: "mark" as const, key: k("means"), page: 2, option: "その他", box: checkBox(158.7, 60.3 + o, 3.13) },
      { kind: "detail" as const, key: k("means"), page: 2, option: "その他", box: mm(175.1, 59.95 + o, 188.6, 63.75 + o) },
      { kind: "text" as const, keys: [k("minutes")], page: 2, box: mm(142.3, 64.6 + o, 157.9, 68.95 + o) },
    ],
    areas: [
      { keys: [k("place")], page: 2, box: placeArea, ruled: true },
      { keys: [k("means")], page: 2, box: mm(126.43, 59.89 + o, 194.05, 64.5 + o), ruled: false },
      { keys: [k("minutes")], page: 2, box: mm(126.43, 64.5 + o, 194.05, 69.13 + o), ruled: false },
    ],
  };
}

const s1 = supporter(1);
const s2 = supporter(2);
const sh = [shelter("pre", 0), shelter("near", 1), shelter("city", 2)];

export const MATSUYAMA_FRAME: Frame<MatsuyamaKey> = {
  original: "matsuyama",
  pages: [
    { page: 1, w: 209.97, h: 296.93 },
    { page: 2, w: 209.97, h: 296.93 },
  ],
  // 値の字の上限は欄の名前（地）の 9.84pt（T85。値は欄の名前と同じ大きさ）
  maxPt: 9.84,
  // 様式に置き場の無い値（選ぶ欄の書き足し・2 人目からの関係先など）を書く所。様式の特記事項（前からの紙面と同じ。lib/forms/matsuyama.ts）
  extras: "notes",
  slots: [
    // ---- 1 頁 ----
    { kind: "text", keys: ["head.date"], page: 1, box: mm(146.0, 26.9, 159.2, 31.2), take: { part: "ey" } },
    { kind: "text", keys: ["head.date"], page: 1, box: mm(162.9, 26.9, 171.5, 31.2), take: { part: "m" } },
    { kind: "text", keys: ["head.date"], page: 1, box: mm(175.2, 26.9, 183.0, 31.2), take: { part: "d" } },
    { kind: "text", keys: ["target.kana"], page: 1, box: mm(45.26, 31.84, 107.33, 36.6) },
    { kind: "text", keys: ["target.name"], page: 1, box: mm(45.26, 39.4, 75.7, 49.5), take: { part: "family" } },
    { kind: "text", keys: ["target.name"], page: 1, box: mm(75.95, 39.4, 107.33, 49.5), take: { part: "given" } },
    { kind: "mark", key: "target.sex", page: 1, option: "男", box: checkBox(108.82, 37.81, 3.13) },
    { kind: "mark", key: "target.sex", page: 1, option: "女", box: checkBox(108.82, 44.29, 3.13) },
    { kind: "text", keys: ["target.sex"], page: 1, box: mm(107.63, 31.84, 120.0, 37.6), take: { part: "after" } },
    { kind: "mark", key: "target.birth", page: 1, option: "大正", box: checkBox(133.76, 32.31, 3.13) },
    { kind: "mark", key: "target.birth", page: 1, option: "昭和", box: checkBox(152.56, 32.31, 3.13) },
    { kind: "mark", key: "target.birth", page: 1, option: "平成", box: checkBox(133.76, 37.81, 3.13) },
    { kind: "mark", key: "target.birth", page: 1, option: "令和", box: checkBox(152.56, 37.81, 3.13) },
    { kind: "text", keys: ["target.birth"], page: 1, box: mm(132.6, 43.7, 139.1, 48.4), take: { part: "y" } },
    { kind: "text", keys: ["target.birth"], page: 1, box: mm(142.7, 43.7, 151.7, 48.4), take: { part: "m" } },
    { kind: "text", keys: ["target.birth"], page: 1, box: mm(155.4, 43.7, 164.0, 48.4), take: { part: "d" } },
    { kind: "text", keys: ["target.district"], page: 1, box: mm(175.93, 31.84, 194.05, 49.49) },
    { kind: "text", keys: ["target.address"], page: 1, box: mm(45.26, 49.79, 126.13, 61.53) },
    { kind: "text", keys: ["target.phone"], page: 1, box: mm(145.23, 49.79, 194.05, 55.5) },
    { kind: "text", keys: ["target.mobile"], page: 1, box: mm(145.23, 55.8, 194.05, 61.53) },
    // 区分（高齢者・障がい者は □ が無く、中の選択肢に □。高齢者・障がい者は字を丸で囲む）
    { kind: "mark", key: "target.category", page: 1, option: "高齢者", box: mm(21.0, 62.0, 36.2, 65.6) },
    { kind: "mark", key: "target.category", page: 1, option: "高齢者/独居", box: checkBox(40.31, 62.08, 3.13) },
    { kind: "mark", key: "target.category", page: 1, option: "高齢者/要介護", box: checkBox(58.72, 62.08, 3.13) },
    { kind: "detail", key: "target.category", page: 1, option: "高齢者/要介護", box: mm(75.1, 61.84, 88.6, 65.5) },
    { kind: "mark", key: "target.category", page: 1, option: "障がい者", box: mm(21.0, 66.6, 38.0, 70.2) },
    { kind: "mark", key: "target.category", page: 1, option: "障がい者/身体", box: checkBox(40.31, 66.69, 3.13) },
    { kind: "mark", key: "target.category", page: 1, option: "障がい者/知的", box: checkBox(58.72, 66.69, 3.13) },
    { kind: "mark", key: "target.category", page: 1, option: "障がい者/精神", box: checkBox(77.15, 66.69, 3.13) },
    { kind: "mark", key: "target.category", page: 1, option: "難病患者", box: checkBox(21.89, 71.31, 3.13) },
    { kind: "mark", key: "target.category", page: 1, option: "小児慢性特定疾病児童", box: checkBox(46.45, 71.31, 3.13) },
    { kind: "mark", key: "target.category", page: 1, option: "その他", box: checkBox(21.89, 75.92, 3.13) },
    { kind: "detail", key: "target.category", page: 1, option: "その他", box: mm(30.9, 80.3, 88.6, 84.6) },
    ...localRow("local.welfare", 0),
    ...localRow("local.watcher", 1),
    ...localRow("local.office", 2),
    ...localRow("local.other", 3, 0),
    ...localRow("local.other", 4, 1),
    { kind: "mark", key: "target.household", page: 1, option: "ひとり暮らし", box: checkBox(34.17, 85.15, 3.13) },
    { kind: "mark", key: "target.household", page: 1, option: "日中ひとり", box: checkBox(64.86, 85.15, 3.13) },
    { kind: "mark", key: "target.household", page: 1, option: "高齢者のみ", box: checkBox(96.03, 85.15, 3.13) },
    { kind: "mark", key: "target.household", page: 1, option: "障がい者等のみ", box: checkBox(127.62, 85.15, 3.13) },
    { kind: "mark", key: "target.household", page: 1, option: "その他", box: checkBox(34.17, 89.76, 3.13) },
    { kind: "detail", key: "target.household", page: 1, option: "その他", box: mm(55.4, 89.5, 176.3, 93.83) },
    { kind: "mark", key: "target.timeline", page: 1, option: "あり", box: mm(94.4, 94.6, 103.0, 99.1) },
    { kind: "mark", key: "target.timeline", page: 1, option: "あり/アプリ", box: checkBox(114.83, 94.84, 3.77) },
    { kind: "mark", key: "target.timeline", page: 1, option: "あり/紙", box: checkBox(139.77, 94.84, 3.77) },
    { kind: "mark", key: "target.timeline", page: 1, option: "なし", box: checkBox(164.5, 94.84, 3.77) },
    { kind: "mark", key: "consent.registry", page: 1, option: "同意する", box: checkBox(161.45, 105.13, 3.77) },
    { kind: "mark", key: "consent.registry", page: 1, option: "同意しない", box: checkBox(161.45, 114.36, 3.77) },
    { kind: "mark", key: "consent.planShare", page: 1, option: "同意する", box: checkBox(161.45, 123.6, 3.77) },
    { kind: "mark", key: "consent.planShare", page: 1, option: "同意しない", box: checkBox(161.45, 132.82, 3.77) },
    { kind: "text", keys: ["kin.kana"], page: 1, box: mm(39.12, 162.42, 101.19, 165.8) },
    { kind: "text", keys: ["kin.name"], page: 1, box: mm(39.12, 168.4, 69.55, 175.54), take: { part: "family" } },
    { kind: "text", keys: ["kin.name"], page: 1, box: mm(69.8, 168.4, 101.19, 175.54), take: { part: "given" } },
    { kind: "text", keys: ["kin.relation"], page: 1, box: mm(113.78, 162.42, 132.27, 175.54) },
    { kind: "text", keys: ["kin.phone"], page: 1, box: mm(149.2, 162.42, 194.05, 169.02) },
    { kind: "text", keys: ["kin.mobile"], page: 1, box: mm(149.2, 169.32, 194.05, 175.54) },
    { kind: "text", keys: ["kin.address"], page: 1, box: mm(39.12, 175.84, 194.05, 184.78) },
    ...s1.slots,
    ...s2.slots,
    { kind: "text", keys: ["org.name"], page: 1, box: mm(51.4, 245.32, 120.0, 254.25) },
    { kind: "text", keys: ["org.phone"], page: 1, box: mm(136.6, 245.32, 175.63, 254.25) },
    { kind: "mark", key: "org.consent", page: 1, option: "同意", box: checkBox(183.08, 250.02, 3.47) },

    // ---- 2 頁 ----
    { kind: "text", keys: ["plan.author"], page: 2, box: mm(57.54, 16.52, 194.05, 22.4) },
    // かかりつけ医・薬局と医薬品情報は様式で 1 つの欄
    { kind: "text", keys: ["medical.doctor", "medical.drugs"], page: 2, box: mm(57.54, 22.7, 194.05, 31.63) },
    { kind: "mark", key: "risk.home", page: 2, option: "土砂災害", box: checkBox(58.72, 32.31, 3.13) },
    { kind: "mark", key: "risk.home", page: 2, option: "洪水", box: checkBox(83.29, 32.31, 3.13) },
    { kind: "detail", key: "risk.home", page: 2, option: "洪水", box: mm(86.1, 36.6, 96.1, 41.07) },
    { kind: "mark", key: "risk.home", page: 2, option: "高潮", box: checkBox(115.13, 32.31, 3.13) },
    { kind: "mark", key: "risk.home", page: 2, option: "津波", box: checkBox(140.06, 32.31, 3.13) },
    { kind: "detail", key: "risk.home", page: 2, option: "津波", box: mm(142.7, 36.6, 151.8, 41.07) },
    { kind: "mark", key: "risk.home", page: 2, option: "地震", box: checkBox(170.98, 32.31, 3.13) },
    { kind: "text", keys: ["risk.home"], page: 2, box: mm(169.79, 36.2, 194.05, 41.07), take: { part: "after" } },
    { kind: "mark", key: "risk.timing", page: 2, option: "自主避難", box: checkBox(58.55, 42.26, 3.47) },
    { kind: "mark", key: "risk.timing", page: 2, option: "レベル３高齢者等避難", box: checkBox(89.26, 42.26, 3.47) },
    { kind: "text", keys: ["risk.issues"], page: 2, box: mm(57.54, 47.55, 194.05, 56.48) },
    ...sh.flatMap((x) => x.slots),
    { kind: "mark", key: "housing.type", page: 2, option: "戸建住宅", box: checkBox(52.42, 91.88, 3.47) },
    { kind: "mark", key: "housing.type", page: 2, option: "共同住宅", box: checkBox(83.12, 91.88, 3.47) },
    { kind: "mark", key: "housing.structure", page: 2, option: "木造", box: checkBox(114.96, 91.88, 3.47) },
    { kind: "mark", key: "housing.structure", page: 2, option: "その他", box: checkBox(139.89, 91.88, 3.47) },
    { kind: "detail", key: "housing.structure", page: 2, option: "その他", box: mm(161.5, 91.4, 188.6, 96.2) },
    { kind: "mark", key: "housing.floors", page: 2, option: "平屋", box: checkBox(52.42, 98.06, 3.47) },
    { kind: "mark", key: "housing.floors", page: 2, option: "２階建", box: checkBox(76.98, 98.06, 3.47) },
    { kind: "mark", key: "housing.floors", page: 2, option: "３階建以上", box: checkBox(102.51, 98.06, 3.47) },
    { kind: "text", keys: ["housing.room"], page: 2, box: mm(67.7, 103.5, 82.5, 109.24), take: { part: "num" } },
    { kind: "text", keys: ["housing.bedroom"], page: 2, box: mm(130.4, 103.5, 145.6, 109.24), take: { part: "num" } },
    { kind: "mark", key: "support.kinds", page: 2, option: "避難の声掛け", box: checkBox(70.84, 113.68, 3.47) },
    { kind: "mark", key: "support.kinds", page: 2, option: "避難の誘導", box: checkBox(102.51, 113.68, 3.47) },
    { kind: "mark", key: "support.kinds", page: 2, option: "移動介助", box: checkBox(133.59, 113.68, 3.47) },
    { kind: "mark", key: "support.kinds", page: 2, option: "その他", box: checkBox(164.67, 113.68, 3.47) },
    // 特記事項（様式で 1 つの書き込みの欄）。医療・本人の言葉・夜間支援・その他の順で、段の名前を添える
    {
      kind: "text",
      keys: ["notes.medical", "notes.words", "supporter.night", "notes.other"],
      page: 2,
      box: mm(20.8, 123.0, 194.05, 146.37),
      labels: true,
      id: "notes",
    },
    { kind: "mark", key: "notes.annex", page: 2, option: "あり", box: checkBox(146.41, 146.92, 3.13) },
    { kind: "mark", key: "notes.annex", page: 2, option: "なし", box: checkBox(170.98, 146.92, 3.13) },
    // 避難経路: 地図の画像（T102 が渡す）があれば欄の上に文、残りに地図
    { kind: "text", keys: ["route.text"], page: 2, box: mm(20.8, 160.8, 194.05, 234.26), id: "route" },
    { kind: "image", key: "route.text", page: 2, slot: "route-map", box: mm(20.8, 160.8, 194.05, 234.26) },
    { kind: "mark", key: "route.map", page: 2, option: "あり", box: checkBox(146.41, 234.82, 3.13) },
    { kind: "mark", key: "route.map", page: 2, option: "なし", box: checkBox(170.98, 234.82, 3.13) },
  ],
  areas: [
    { keys: ["target.kana"], page: 1, box: mm(45.11, 31.69, 107.48, 36.69), ruled: true },
    { keys: ["target.name"], page: 1, box: mm(45.11, 36.69, 107.48, 49.64), ruled: true },
    { keys: ["target.sex"], page: 1, box: mm(107.48, 31.69, 120.15, 49.64), ruled: true },
    { keys: ["target.birth"], page: 1, box: mm(132.42, 31.69, 169.64, 49.64), ruled: true },
    { keys: ["target.district"], page: 1, box: mm(175.78, 31.69, 194.2, 49.64), ruled: true },
    { keys: ["target.address"], page: 1, box: mm(45.11, 49.64, 126.28, 61.68), ruled: true },
    { keys: ["target.phone"], page: 1, box: mm(145.08, 49.64, 194.2, 55.65), ruled: true },
    { keys: ["target.mobile"], page: 1, box: mm(145.08, 55.65, 194.2, 61.68), ruled: true },
    { keys: ["target.category"], page: 1, box: mm(20.55, 61.68, 94.23, 84.75), ruled: true },
    ...LOCAL_ROWS.map(([y0, y1], i) => ({
      keys: [(["local.welfare", "local.watcher", "local.office", "local.other", "local.other"] as const)[i]],
      page: 1,
      box: mm(120.9, y0, 194.05, y1),
      ruled: false,
    })),
    { keys: ["target.household"], page: 1, box: mm(32.84, 84.75, 194.2, 93.98), ruled: true },
    { keys: ["target.timeline"], page: 1, box: mm(69.68, 93.98, 194.2, 100.16), ruled: true },
    { keys: ["consent.registry"], page: 1, box: mm(157.37, 102.74, 194.2, 121.2), ruled: true },
    { keys: ["consent.planShare"], page: 1, box: mm(157.37, 121.2, 194.2, 139.66), ruled: true },
    { keys: ["kin.kana"], page: 1, box: mm(38.97, 162.27, 101.34, 165.91), ruled: true },
    { keys: ["kin.name"], page: 1, box: mm(38.97, 165.91, 101.34, 175.69), ruled: true },
    { keys: ["kin.relation"], page: 1, box: mm(113.63, 162.27, 132.42, 175.69), ruled: true },
    { keys: ["kin.phone"], page: 1, box: mm(148.9, 162.27, 194.2, 169.17), ruled: false },
    { keys: ["kin.mobile"], page: 1, box: mm(148.9, 169.17, 194.2, 175.69), ruled: false },
    { keys: ["kin.address"], page: 1, box: mm(38.97, 175.69, 194.2, 184.93), ruled: true },
    ...s1.areas,
    ...s2.areas,
    { keys: ["org.name"], page: 1, box: mm(51.25, 245.17, 120.15, 254.4), ruled: true },
    { keys: ["org.phone"], page: 1, box: mm(136.5, 245.17, 175.78, 254.4), ruled: false },
    { keys: ["org.consent"], page: 1, box: mm(175.78, 245.17, 194.2, 254.4), ruled: true },
    { keys: ["plan.author"], page: 2, box: mm(57.39, 16.37, 194.2, 22.55), ruled: true },
    { keys: ["medical.doctor", "medical.drugs"], page: 2, box: mm(57.39, 22.55, 194.2, 31.78), ruled: true },
    { keys: ["risk.home"], page: 2, box: mm(57.39, 31.78, 194.2, 41.22), ruled: true },
    { keys: ["risk.timing"], page: 2, box: mm(57.39, 41.22, 194.2, 47.4), ruled: true },
    { keys: ["risk.issues"], page: 2, box: mm(57.39, 47.4, 194.2, 56.63), ruled: true },
    ...sh.flatMap((x) => x.areas),
    { keys: ["housing.type"], page: 2, box: mm(51.4, 90.99, 113.0, 97.0), ruled: false },
    { keys: ["housing.structure"], page: 2, box: mm(113.0, 90.99, 194.05, 97.0), ruled: false },
    { keys: ["housing.floors"], page: 2, box: mm(51.4, 97.0, 194.05, 103.06), ruled: false },
    { keys: ["housing.room"], page: 2, box: mm(63.53, 103.21, 113.63, 109.39), ruled: true },
    { keys: ["housing.bedroom"], page: 2, box: mm(126.28, 103.21, 194.2, 109.39), ruled: true },
    { keys: ["support.kinds"], page: 2, box: mm(69.68, 112.65, 194.2, 118.83), ruled: true },
    { keys: ["notes.medical", "notes.words", "supporter.night", "notes.other"], page: 2, box: mm(20.55, 118.83, 194.2, 146.52), ruled: true },
    { keys: ["notes.annex"], page: 2, box: mm(20.55, 146.52, 194.2, 151.13), ruled: true },
    { keys: ["route.text"], page: 2, box: mm(20.55, 160.57, 194.2, 234.41), ruled: true },
    { keys: ["route.map"], page: 2, box: mm(20.55, 234.41, 194.2, 239.04), ruled: true },
  ],
};
