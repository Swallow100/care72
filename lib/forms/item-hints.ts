// 読み取りの項目の当て方の補い（T133）。様式の読み取り（Opus）が項目なし（null）にした欄・1 つの書く所に名前が 2 つある欄で、
// 台帳に値があるのに紙が空く物を、欄の名前と並びの一般の決まりで補う。特定の自治体の様式の欄の名前に合わせた決め打ちはしない。
//
// 決まり（上から順に。どれも項目なしの欄だけで、同じ段に同じ項目の欄が既にあれば当てない）:
// 1. 括弧: 「要介護（　）」のように、名前の後ろに空の括弧がある欄は、すぐ前の □・選ぶ欄で名前が同じ欄の項目（□ に印、括弧の中に値の中身）。
//    「その他（　）」は前の欄の値と違う物を書く所なので当てない
// 2. フリガナ: 同じ段の氏名の欄の項目のフリガナ（本人・緊急連絡先・避難支援者）
// 3. 携帯: 同じ段の電話の欄の項目（連絡先の電話の項目は電話と携帯の 2 つを持つ。紙は欄の名前で携帯だけ・電話だけを出す。本人は携帯番号の項目）
// 4. 名前の言葉: 字の欄の名前が台帳の項目の別の言い方を含む（医薬品情報・服薬 → 常用薬、寝室、要介護度 など）。様式のどこにも無い項目だけ
// 5. 名前 2 つ: 項目を当てた欄の名前が、別の項目の言い方も含み（「かかりつけ医・薬局 医薬品情報」）、その項目の欄が様式のどこにも無ければ、
//    同じ書く所にその項目の欄を足す（紙は同じ書く所の欄を行に重ねて置く。lib/forms/overlay-sheet.ts の sharedBoxes）
// 補った欄は、AI の読んだ物（ai）の理由の後ろに「（補）」を付ける（確かめの画面で人が見る）。

import { isLedgerItemKey, nextFieldId, type LedgerItemKey, type MappingField } from "./mapping.ts";
import { settleRead } from "./read-settle.ts";

const norm = (s: string) => s.normalize("NFKC").replace(/[\s　・･]/g, "");

/** 項目の別の言い方（欄の名前に含まれていれば、その項目に当たる）。台帳の項目の名前（mapping.ts の LEDGER_ITEMS）と違う言い方だけ */
export const ITEM_WORDS: ReadonlyArray<{ item: LedgerItemKey; words: readonly string[] }> = [
  { item: "medical.medications", words: ["医薬品", "服薬", "お薬", "常用薬", "内服薬", "処方薬"] },
  { item: "medical.doctor", words: ["かかりつけ医", "主治医", "かかりつけ病院"] },
  { item: "basic.housing.bedroom", words: ["寝室"] },
  { item: "care.careLevel", words: ["要介護度", "介護度", "要介護状態区分"] },
  { item: "medical.allergies", words: ["アレルギー"] },
  { item: "plan.careManager", words: ["担当ケアマネ", "介護支援専門員", "ケアマネジャー"] },
];

/** 名前の後ろの空の括弧（後ろに単位の 1・2 字があってもよい。「要介護（　）級」） */
const BRACKET = /^(.+?)[（(][\s　]*[）)][\s　]*[^\s　（）()]{0,2}$/;
const OTHER = /^(その他|他|そのほか)$/;
const KANA = /フリガナ|ふりがな|カナ/;
const MOBILE = /携帯/;
const SECTION_SCOPE = 4;

/** 氏名の項目 → フリガナの項目 */
const KANA_OF: Partial<Record<string, LedgerItemKey>> = {
  "person.name": "person.kana",
  "emergency1.name": "emergency1.kana",
  "emergency2.name": "emergency2.kana",
  "supporter1.name": "supporter1.kana",
  "supporter2.name": "supporter2.kana",
};

/** 電話の項目 → 携帯の欄に当てる項目（連絡先は同じ電話の項目、本人は携帯番号の項目） */
const MOBILE_OF: Partial<Record<string, LedgerItemKey>> = {
  "self.phone": "self.mobile",
  "emergency1.phone": "emergency1.phone",
  "emergency2.phone": "emergency2.phone",
  "supporter1.phone": "supporter1.phone",
  "supporter2.phone": "supporter2.phone",
};

/** 欄の名前が含む別の言い方の項目 */
export function wordItemOf(label: string): LedgerItemKey | null {
  const l = norm(label);
  for (const w of ITEM_WORDS) if (w.words.some((x) => l.includes(norm(x)))) return w.item;
  return null;
}

export type ItemHint = { id: string; item: LedgerItemKey; rule: "bracket" | "kana" | "mobile" | "word" | "split" };

/**
 * 項目なしの欄に当てる項目の見込み（読み取りの補い・評価の台の「台帳あり空欄」の数え方が同じ物を使う）。
 * 欄は様式の順（頁・段・並び）。当てない欄は返さない
 */
export function itemHints(fields: readonly MappingField[]): ItemHint[] {
  const out: ItemHint[] = [];
  const used = new Set<string>(fields.filter((f) => !f.removed && f.item).map((f) => f.item!));
  const sameSection = (f: MappingField, g: MappingField) => f.page === g.page && f.section === g.section && !g.removed;
  const sectionHas = (f: MappingField, item: string) => fields.some((g) => sameSection(f, g) && g.item === item) || out.some((h) => h.item === item && sameSection(f, fields.find((x) => x.id === h.id)!));
  fields.forEach((f, i) => {
    if (f.removed || f.item !== null || f.shape === "handwrite") return;
    const label = norm(f.label);
    // 1. 括弧
    const m = f.label.normalize("NFKC").match(BRACKET);
    if (m && (f.shape === "text" || f.shape === "lines")) {
      const name = norm(m[1]);
      if (!OTHER.test(name)) {
        const prev = fields.slice(Math.max(0, i - SECTION_SCOPE), i).reverse().find((g) => sameSection(f, g) && (g.shape === "check" || g.shape === "choice") && g.item !== null && norm(g.label) === name);
        if (prev?.item) {
          out.push({ id: f.id, item: prev.item, rule: "bracket" });
          return;
        }
      }
    }
    // 2. フリガナ
    if (KANA.test(label)) {
      const near = fields.slice(Math.max(0, i - SECTION_SCOPE), i + SECTION_SCOPE + 1).filter((g) => g !== f && sameSection(f, g) && g.item !== null && KANA_OF[g.item]);
      const kana = near.map((g) => KANA_OF[g.item!]!).find((k) => !sectionHas(f, k));
      if (kana) {
        out.push({ id: f.id, item: kana, rule: "kana" });
        return;
      }
    }
    // 3. 携帯
    if (MOBILE.test(label) && (f.shape === "phone" || f.shape === "text")) {
      const tel = fields.slice(Math.max(0, i - SECTION_SCOPE), i).reverse().find((g) => sameSection(f, g) && g.item !== null && MOBILE_OF[g.item] && !MOBILE.test(norm(g.label)));
      const item = tel ? MOBILE_OF[tel.item!]! : null;
      if (item && (item === tel!.item || !sectionHas(f, item))) {
        out.push({ id: f.id, item, rule: "mobile" });
        return;
      }
    }
    // 4. 名前の言葉（字の欄だけ。「ケアマネジャー 電話」のような電話・□ の欄に名前の項目を当てない）
    const word = f.shape === "text" || f.shape === "lines" ? wordItemOf(f.label) : null;
    if (word && !used.has(word) && !out.some((h) => h.item === word)) {
      out.push({ id: f.id, item: word, rule: "word" });
      used.add(word);
    }
  });
  return out;
}

/** 項目を当てた欄の名前に、様式のどこにも無い別の項目の言い方がある（名前 2 つの書く所）。足す項目 */
export function splitHints(fields: readonly MappingField[]): ItemHint[] {
  const used = new Set<string>(fields.filter((f) => !f.removed && f.item).map((f) => f.item!));
  const out: ItemHint[] = [];
  for (const f of fields) {
    if (f.removed || f.item === null || f.shape === "handwrite" || f.shape === "check" || f.shape === "choice" || !f.box) continue;
    const l = norm(f.label);
    for (const w of ITEM_WORDS) {
      if (w.item === f.item || used.has(w.item)) continue;
      if (!w.words.some((x) => l.includes(norm(x)))) continue;
      // 欄の名前に、当てた項目自身の言い方もあるときだけ（名前が 2 つ並ぶ書く所。「担当ケアマネ」の欄の計画作成者のように、1 つの名前の欄に足さない）
      const own = ITEM_WORDS.find((x) => x.item === f.item)?.words ?? [];
      if (!own.some((x) => l.includes(norm(x)))) continue;
      out.push({ id: f.id, item: w.item, rule: "split" });
      used.add(w.item);
    }
  }
  return out;
}

/** 読み取りの対応表に補いを当てる（checkReadResult の後）。足した欄はすぐ後ろに並べる */
export function refineItems(read: readonly MappingField[]): MappingField[] {
  // 読み方の揺れをそろえてから補う（T175、lib/forms/read-settle.ts）
  const fields = settleRead(read);
  const hints = new Map(itemHints(fields).map((h) => [h.id, h]));
  const splits = splitHints(fields);
  const out: MappingField[] = [];
  for (const f of fields) {
    const h = hints.get(f.id);
    // 補いは読み取りの一部（人の直しに数えない）。AI の読んだ物の項目も同じにし、理由に「（補）」
    out.push(h && isLedgerItemKey(h.item) ? { ...f, item: h.item, ai: f.ai ? { ...f.ai, item: h.item, reason: `${f.ai.reason}（補）` } : f.ai } : f);
    for (const s of splits.filter((x) => x.id === f.id)) {
      const word = ITEM_WORDS.find((w) => w.item === s.item)!.words.find((x) => norm(f.label).includes(norm(x)))!;
      out.push({
        ...f,
        id: nextFieldId([...fields, ...out]),
        label: word,
        item: s.item,
        options: [],
        optionBoxes: undefined,
        ai: f.ai ? { item: s.item, confidence: "medium", reason: "名前 2 つの書く所（補）", ...(f.ai.box !== undefined ? { box: f.ai.box } : {}) } : null,
      });
    }
  }
  return out.map((f) => (f.optionBoxes === undefined && "optionBoxes" in f ? (({ optionBoxes: _o, ...rest }) => rest)(f) : f));
}
