// 災害診療記録2018（一般診療版、厚労省の通知の別添４-１）の 1 頁目（基本情報）の原本の枠の寸法（T101）。
// 医療要約は原本の 1 頁目を下に敷き、ここの矩形に台帳の値を置く（lib/forms/frame-sheet.ts）。2〜4 頁目（医師の診療の記録）は敷かない。
//
// 値は作業者が原本から起こした物:
// - 原本: ORIGINALS.kiroku（lib/forms/originals.ts）の URL の PDF。リポジトリには入れない
// - 取り方: pdf.js の getOperatorList で罫線（太い枠 0.76mm、細い線 0.17mm）を頁の左上を原点の mm に。□ は字（U+25A1）で、
//   getTextContent の字の塊の位置と幅を字の数で割った位置から（□ は字の高さの 0.84 の正方形、下は字の基線から高さの 0.05 上）。
//   作業者の一時フォルダで原本の絵に矩形を重ねて見比べた
// - 医師が書く欄（初診日・初診医師氏名・傷病名・トリアージタグ）・保険証情報・職業・該当状況は台帳から入れない（枠も持たない）
// - 様式に置き場の無い値（住まい・関係先・機器・薬の用量と残り・持出品・特記・既往症・予防接種）は別紙へ

import type { MedicalKey } from "./medical-summary.ts";
import { mm, type Frame, type MmBox } from "./frame-sheet.ts";

/** 字の □（字の塊の左 x・基線 y・字の高さ h、塊の i 字目。each は 1 字の幅） */
const glyph = (x: number, baseline: number, h: number, i = 0, each = h): MmBox => {
  const left = x + i * each;
  return {
    x: Math.round((left + h * 0.08) * 100) / 100,
    y: Math.round((baseline - h * 0.84) * 100) / 100,
    w: Math.round(h * 0.84 * 100) / 100,
    h: Math.round(h * 0.84 * 100) / 100,
  };
};

/** メディカル ID の 16 の枠（西暦生年月日 8・性別 1・カナ 7）の左右の線（mm） */
const ID_EDGES = [58.0, 66.27, 74.69, 83.16, 91.58, 100.01, 108.48, 116.91, 125.37, 133.8, 142.22, 150.7, 159.12, 167.59, 176.01, 184.48, 192.91];

export const KIROKU_FRAME: Frame<MedicalKey> = {
  original: "kiroku",
  pages: [{ page: 1, w: 210.02, h: 297.01 }],
  // 値の字の上限は欄の名前と □ の行の 11.04pt（T85）
  maxPt: 11.04,
  slots: [
    { kind: "text", keys: ["patient.kana"], page: 1, box: mm(60.6, 44.0, 192.6, 50.0) },
    { kind: "text", keys: ["patient.name"], page: 1, box: mm(60.6, 53.5, 156.8, 59.45) },
    { kind: "mark", key: "patient.sex", page: 1, option: "男", box: mm(169.9, 53.6, 174.6, 58.5), shape: "circle" },
    { kind: "mark", key: "patient.sex", page: 1, option: "女", box: mm(179.2, 53.6, 183.9, 58.5), shape: "circle" },
    { kind: "text", keys: ["patient.sex"], page: 1, box: mm(184.5, 53.5, 192.6, 59.45), take: { part: "after" } },
    // 生年月日: 西暦を丸で囲み、年・月・日・歳の前に数（和暦は別紙の値に残る）
    { kind: "mark", key: "patient.birth", page: 1, option: "*", box: mm(61.9, 63.7, 69.3, 68.1), shape: "circle" },
    { kind: "text", keys: ["patient.birth"], page: 1, box: mm(110.0, 63.2, 126.1, 68.65), take: { part: "y" } },
    { kind: "text", keys: ["patient.birth"], page: 1, box: mm(131.0, 63.2, 142.2, 68.65), take: { part: "m" } },
    { kind: "text", keys: ["patient.birth"], page: 1, box: mm(147.0, 63.2, 160.9, 68.65), take: { part: "d" } },
    { kind: "text", keys: ["patient.birth"], page: 1, box: mm(168.9, 63.2, 181.0, 68.65), take: { part: "age" } },
    { kind: "text", keys: ["patient.phone"], page: 1, box: mm(60.6, 78.15, 192.6, 86.98) },
    { kind: "text", keys: ["patient.address"], page: 1, box: mm(58.6, 87.3, 140.6, 96.17) },
    { kind: "mark", key: "patient.house", page: 1, option: "健存", box: glyph(150.4, 93.15, 3.73) },
    { kind: "mark", key: "patient.house", page: 1, option: "半壊", box: glyph(164.92, 93.15, 3.73) },
    { kind: "mark", key: "patient.house", page: 1, option: "全壊", box: glyph(179.74, 93.15, 3.73) },
    // 避難先は計画の値（発災後の居場所ではない）。□ に印は付けず、避難所名の（ ）に「計画」を添えて書く
    { kind: "text", keys: ["shelter.first"], page: 1, box: mm(84.4, 96.5, 126.1, 105.35), prefix: "計画 " },
    { kind: "text", keys: ["shelter.second"], page: 1, box: mm(84.4, 105.67, 126.1, 114.5), prefix: "計画 " },
    { kind: "mark", key: "contact.kinds", page: 1, option: "家族", box: glyph(62.25, 118.68, 3.89) },
    { kind: "mark", key: "contact.kinds", page: 1, option: "知人", box: glyph(74.1, 118.68, 3.89) },
    { kind: "mark", key: "contact.kinds", page: 1, option: "その他", box: glyph(85.91, 118.68, 3.89) },
    { kind: "mark", key: "contact.kinds", page: 1, option: "連絡先なし", box: glyph(100.64, 118.68, 3.89) },
    { kind: "text", keys: ["contact.people"], page: 1, box: mm(120.0, 114.82, 192.6, 123.68) },
    { kind: "mark", key: "contra.allergy", page: 1, option: "*", box: glyph(26.13, 142.68, 3.89) },
    { kind: "text", keys: ["contra.allergy"], page: 1, box: mm(48.5, 139.3, 192.6, 143.75) },
    { kind: "mark", key: "drug.antiplatelet", page: 1, option: "抗血小板薬", box: glyph(26.13, 157.97, 3.89) },
    { kind: "text", keys: ["drug.antiplatelet"], page: 1, box: mm(51.5, 154.6, 187.7, 159.0), take: { part: "after" } },
    { kind: "mark", key: "drug.anticoagulant", page: 1, option: "抗凝固薬", box: glyph(26.13, 163.01, 3.89) },
    { kind: "mark", key: "drug.anticoagulant", page: 1, option: "ワーファリン", box: glyph(50.72, 163.01, 3.89) },
    { kind: "text", keys: ["drug.anticoagulant"], page: 1, box: mm(76.3, 159.6, 187.7, 164.05), take: { part: "after" } },
    { kind: "mark", key: "drug.diabetes", page: 1, option: "糖尿病治療薬", box: glyph(26.13, 168.05, 3.89) },
    { kind: "mark", key: "drug.diabetes", page: 1, option: "インスリン", box: glyph(55.89, 168.05, 3.89) },
    { kind: "mark", key: "drug.diabetes", page: 1, option: "経口薬", box: glyph(78.67, 168.05, 3.89) },
    { kind: "text", keys: ["drug.diabetes"], page: 1, box: mm(98.3, 164.65, 187.7, 169.1), take: { part: "after" } },
    { kind: "mark", key: "drug.steroid", page: 1, option: "ステロイド", box: glyph(26.13, 173.08, 3.89) },
    { kind: "text", keys: ["drug.steroid"], page: 1, box: mm(48.3, 169.7, 187.7, 174.1), take: { part: "after" } },
    { kind: "mark", key: "drug.antiepileptic", page: 1, option: "抗てんかん薬", box: glyph(26.13, 178.08, 3.89) },
    { kind: "text", keys: ["drug.antiepileptic"], page: 1, box: mm(54.7, 174.7, 192.6, 179.1), take: { part: "after" } },
    { kind: "mark", key: "drug.other", page: 1, option: "その他", box: glyph(26.13, 188.15, 3.89) },
    { kind: "text", keys: ["drug.other"], page: 1, box: mm(43.4, 184.75, 187.7, 189.2), take: { part: "after" } },
    { kind: "mark", key: "drug.dialysis", page: 1, option: "透析", box: glyph(26.13, 193.19, 3.89) },
    { kind: "text", keys: ["drug.dialysis"], page: 1, box: mm(38.0, 189.8, 192.6, 194.2), take: { part: "after" } },
    { kind: "mark", key: "drug.hot", page: 1, option: "在宅酸素療法（HOT）", box: glyph(26.13, 198.23, 3.89) },
    { kind: "text", keys: ["drug.hot"], page: 1, box: mm(64.2, 194.85, 192.6, 199.25), take: { part: "after" } },
    { kind: "mark", key: "care.vulnerable", page: 1, option: "災害時要配慮者", box: glyph(26.13, 203.27, 3.89) },
    { kind: "mark", key: "care.vulnerable", page: 1, option: "高齢者", box: glyph(59.57, 203.27, 3.73) },
    { kind: "mark", key: "care.vulnerable", page: 1, option: "障害者", box: glyph(76.34, 203.27, 3.73) },
    { kind: "mark", key: "care.vulnerable", page: 1, option: "乳幼児", box: glyph(93.62, 203.27, 3.73) },
    { kind: "mark", key: "care.vulnerable", page: 1, option: "妊婦", box: glyph(110.85, 203.27, 3.73) },
    { kind: "mark", key: "care.vulnerable", page: 1, option: "日本語が不自由", box: glyph(124.44, 203.27, 3.73) },
    { kind: "mark", key: "care.vulnerable", page: 1, option: "その他", box: glyph(154.2, 203.27, 3.73) },
    { kind: "detail", key: "care.vulnerable", page: 1, option: "その他", box: mm(170.5, 199.85, 187.6, 204.3) },
    // 要配慮者の事実（要介護度・独居・認知症など）は □ の行の下の空き
    { kind: "text", keys: ["care.vulnerable"], page: 1, box: mm(26.0, 204.55, 192.6, 209.35), take: { part: "after" } },
    { kind: "mark", key: "care.protect", page: 1, option: "支援者のいない要配慮者等", box: glyph(41.1, 213.31, 3.73) },
    { kind: "text", keys: ["care.protect"], page: 1, box: mm(26.0, 214.4, 192.6, 219.35), take: { part: "after" } },
    // 性別の枠（9 字目）は M ⁄ F が刷ってあるので、当てはまる方を丸で囲む
    { kind: "mark", key: "id.medical", page: 1, option: "=8:M", box: mm(126.5, 281.55, 130.6, 285.4), shape: "circle" },
    { kind: "mark", key: "id.medical", page: 1, option: "=8:F", box: mm(128.6, 285.6, 132.6, 289.5), shape: "circle" },
    ...ID_EDGES.slice(0, -1).flatMap((x0, i) => (i === 8 ? [] : [{
      kind: "text" as const,
      keys: ["id.medical" as const],
      page: 1,
      box: mm(x0 + 0.2, 281.6, ID_EDGES[i + 1] - 0.2, 289.45),
      take: { part: "char" as const, index: i },
    }])),
  ],
  areas: [
    { keys: ["patient.kana"], page: 1, box: mm(60.37, 40.73, 192.91, 50.17), ruled: true },
    { keys: ["patient.name"], page: 1, box: mm(60.37, 50.17, 156.8, 59.61), ruled: false },
    { keys: ["patient.sex"], page: 1, box: mm(156.8, 53.5, 192.6, 59.45), ruled: false },
    { keys: ["patient.birth"], page: 1, box: mm(60.37, 59.61, 192.91, 68.8), ruled: true },
    { keys: ["patient.phone"], page: 1, box: mm(60.37, 77.99, 192.91, 87.14), ruled: true },
    { keys: ["patient.address"], page: 1, box: mm(40.35, 87.14, 140.6, 96.33), ruled: false },
    { keys: ["patient.house"], page: 1, box: mm(140.6, 87.14, 192.91, 96.33), ruled: false },
    { keys: ["shelter.first"], page: 1, box: mm(40.35, 96.33, 192.91, 105.51), ruled: true },
    { keys: ["shelter.second"], page: 1, box: mm(40.35, 105.51, 192.91, 114.66), ruled: true },
    { keys: ["contact.kinds"], page: 1, box: mm(60.37, 114.66, 119.6, 123.84), ruled: false },
    { keys: ["contact.people"], page: 1, box: mm(119.6, 114.66, 192.91, 123.84), ruled: false },
    { keys: ["contra.allergy"], page: 1, box: mm(25.6, 139.0, 192.6, 143.9), ruled: false },
    { keys: ["contra.food"], page: 1, box: mm(25.6, 144.05, 192.6, 148.8), ruled: false },
    { keys: ["drug.antiplatelet"], page: 1, box: mm(25.6, 154.3, 192.6, 159.15), ruled: false },
    { keys: ["drug.anticoagulant"], page: 1, box: mm(25.6, 159.35, 192.6, 164.2), ruled: false },
    { keys: ["drug.diabetes"], page: 1, box: mm(25.6, 164.4, 192.6, 169.25), ruled: false },
    { keys: ["drug.steroid"], page: 1, box: mm(25.6, 169.45, 192.6, 174.25), ruled: false },
    { keys: ["drug.antiepileptic"], page: 1, box: mm(25.6, 174.45, 192.6, 184.3), ruled: false },
    { keys: ["drug.other"], page: 1, box: mm(25.6, 184.5, 192.6, 189.35), ruled: false },
    { keys: ["drug.dialysis"], page: 1, box: mm(25.6, 189.55, 192.6, 194.4), ruled: false },
    { keys: ["drug.hot"], page: 1, box: mm(25.6, 194.6, 192.6, 199.4), ruled: false },
    { keys: ["care.vulnerable"], page: 1, box: mm(25.6, 199.6, 192.6, 209.35), ruled: false },
    { keys: ["care.protect"], page: 1, box: mm(20.46, 209.5, 192.83, 219.49), ruled: true },
    { keys: ["id.medical"], page: 1, box: mm(57.83, 280.97, 192.91, 290.03), ruled: true },
  ],
};
