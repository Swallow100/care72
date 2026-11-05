// 選ぶ欄の選択肢と台帳の値の表（T140）。様式の選択肢の言い方（「自力でできる」「鉄骨・鉄筋コンクリート」「3」）と、台帳の項目の値（列挙。
// 歩行の ok・some・hard、要介護度の care3 など）の言い方が違うと、値があるのに □ に印が付かず「置けなかった」になる（評価の 4 回目の 1。
// 置けなかった欄 602・台帳あり空欄 427 のうち選択肢に合わない値 268）。
//
// - 表は選択肢の 1 つずつ → 台帳の値（コード）の並び。人の値を含まない（様式の字と列挙の名前だけ）ので、対応表に入れて様式の版ごとに共有できる
//   （T134 の共有の対応表は対応表の JSON をそのまま持つ。migration は要らない）
// - 言い換えの決まった表（ITEM_CODES の words）で当たる物はコードで当てる（AI を使わない）。当たらない選択肢だけ、読み取りの時に AI に当てさせる
//   （lib/forms/option-ai.ts。渡すのは選択肢の字と列挙の値の名前だけ）。AI の当てた物は対応表の欄の optionValues に AI の印つきで残す
// - 特別なコード: NONE（「なし」の選択肢。台帳の値が空の並びのとき）、OTHER（「その他」の選択肢。ほかの選択肢に当たらない値のとき）
// - 紙（lib/forms/mapped-sheet.ts の shapeCell）は台帳の値のコードと表を照らす。当たる選択肢に印。1 つを選ぶ欄で 2 つ以上当たれば選ばない。
//   当たらず、選択肢が全部表で当たっていれば「範囲外」（要介護 1 の人の「要介護 3〜5」。空くのが答え。T133 の問い 1 の決め）、
//   当たらない選択肢があれば「選択肢に無い」（置けなかった欄。紙の上で選ぶ。T135）
// ここはブラウザでも読む（確かめの画面）ので、サーバーの物を import しない。

import type { LedgerItemKey, MappingField } from "./mapping.ts";

/** 「なし」の選択肢（台帳の値が空の並び〔機器なし・ハザードなし〕・連絡先なし） */
export const NONE_CODE = "*none";
/** 「その他」の選択肢（ほかの選択肢に当たらない値） */
export const OTHER_CODE = "*other";

/** not は含んでいても当てない言葉（「車」の言い換えに「自転車」「車いす」を当てない） */
export type CodeDef = { code: string; label: string; words: readonly string[]; not?: readonly string[] };

const ABILITY: readonly CodeDef[] = [
  { code: "ok", label: "問題なし", words: ["問題なし", "自力", "自立", "独歩", "ひとりで", "一人で", "介助なし", "介助不要", "支障なし"] },
  { code: "some", label: "一部", words: ["一部", "杖", "つえ", "歩行器", "見守り", "一部介助", "シルバーカー"] },
  { code: "hard", label: "困難", words: ["困難", "全介助", "介助が必要", "要介助", "寝たきり", "できない", "歩けない", "不可"] },
];

const TRANSPORT: readonly CodeDef[] = [
  { code: "foot", label: "徒歩", words: ["徒歩", "歩いて", "歩行で"] },
  { code: "wheelchair", label: "車いす", words: ["車いす", "車椅子", "車イス"] },
  { code: "family_car", label: "家族の車", words: ["車", "自動車", "自家用車", "家族の車", "乗用車"], not: ["自転車", "車いす", "車椅子", "車イス", "電車", "救急車", "福祉車両"] },
  { code: "pickup", label: "送迎", words: ["送迎", "迎え", "福祉車両", "介護タクシー", "タクシー"] },
  { code: "other", label: "その他", words: [] },
];

const YES_NO: readonly CodeDef[] = [
  { code: "yes", label: "あり", words: ["あり", "有", "有り", "はい", "該当"] },
  { code: "no", label: "なし", words: ["なし", "無", "無し", "いいえ", "非該当"] },
];

const CONSENT: readonly CodeDef[] = [
  { code: "granted", label: "同意", words: ["同意", "同意する", "はい"] },
  { code: "refused", label: "不同意", words: ["不同意", "同意しない", "いいえ"] },
];

const RELATION: readonly CodeDef[] = [
  { code: "family", label: "家族", words: ["家族", "親族", "親戚"] },
  { code: "supporter", label: "知人", words: ["知人", "友人", "近所", "近隣", "隣人", "支援者"] },
];

/** 持ち出し品の言い換え（台帳の持出品は自由な言葉。選択肢と台帳の言葉を同じ物の名前にそろえて照らす） */
const CARRY: readonly CodeDef[] = [
  { code: "medicine", label: "薬", words: ["薬", "お薬", "常備薬", "内服薬", "処方薬", "インスリン"] },
  { code: "notebook", label: "お薬手帳", words: ["お薬手帳", "薬手帳"] },
  { code: "glasses", label: "眼鏡", words: ["メガネ", "眼鏡", "めがね"] },
  { code: "hearing_aid", label: "補聴器", words: ["補聴器"] },
  { code: "dentures", label: "入れ歯", words: ["入れ歯", "義歯"] },
  { code: "cane", label: "杖", words: ["杖", "つえ"] },
  { code: "phone", label: "携帯電話", words: ["携帯電話", "スマホ", "スマートフォン", "携帯"] },
  { code: "charger", label: "充電器", words: ["充電器", "充電ケーブル", "携帯電話充電器", "スマホ充電器", "携帯充電器"] },
  { code: "battery", label: "電池", words: ["乾電池", "電池", "バッテリー"] },
  { code: "cash", label: "現金", words: ["現金", "お金", "財布"] },
  { code: "bankbook", label: "通帳・印鑑", words: ["通帳", "印鑑"] },
  { code: "id_card", label: "保険証など", words: ["マイナンバーカード", "保険証", "免許証", "身分証", "介護保険証"] },
  { code: "light", label: "懐中電灯", words: ["懐中電灯", "ランタン", "ライト"] },
  { code: "water", label: "飲料水", words: ["飲料水", "水"] },
  { code: "food", label: "食料", words: ["食料", "非常食", "保存食", "食べ物"] },
  { code: "clothes", label: "衣類", words: ["衣類", "下着", "着替え"] },
  { code: "blanket", label: "毛布", words: ["毛布", "寝袋"] },
  { code: "towel", label: "タオル", words: ["タオル"] },
  { code: "mask", label: "マスク", words: ["マスク"] },
  { code: "tissue", label: "ティッシュ", words: ["ティッシュ", "ウエットティッシュ"] },
  { code: "toothbrush", label: "歯ブラシ", words: ["ハブラシ", "歯ブラシ"] },
  { code: "diaper", label: "おむつ", words: ["おむつ", "オムツ"] },
  { code: "thermometer", label: "体温計", words: ["体温計"] },
];

/**
 * 台帳の項目ごとの値（列挙）と言い換え。label は AI に渡す値の名前（lib/labels.ts の言葉と同じ）。
 * 要介護度は数だけの選択肢（「3」）・幅（「3〜5」）があるので careLevelCodes で読む（words は名前だけ）
 */
export const ITEM_CODES: Partial<Record<LedgerItemKey, readonly CodeDef[]>> = {
  "basic.sex": [
    { code: "female", label: "女", words: ["女", "女性"] },
    { code: "male", label: "男", words: ["男", "男性"] },
    { code: "other", label: "その他", words: [] },
  ],
  "basic.household": [
    { code: "alone", label: "独居", words: ["独居", "ひとり暮らし", "一人暮らし", "1人暮らし", "単身"] },
    { code: "with_spouse", label: "夫婦", words: ["夫婦", "高齢者のみ", "高齢者世帯"] },
    { code: "with_child", label: "子と同居", words: ["子と同居"] },
    { code: "with_family", label: "家族と同居", words: ["家族と同居"] },
    { code: "facility", label: "施設", words: ["施設", "入所"] },
    { code: "other", label: "その他", words: [] },
  ],
  "care.careLevel": [
    { code: "support1", label: "要支援1", words: [] },
    { code: "support2", label: "要支援2", words: [] },
    { code: "care1", label: "要介護1", words: [] },
    { code: "care2", label: "要介護2", words: [] },
    { code: "care3", label: "要介護3", words: [] },
    { code: "care4", label: "要介護4", words: [] },
    { code: "care5", label: "要介護5", words: [] },
  ],
  "care.walking": ABILITY,
  "care.hearing": ABILITY,
  "care.vision": ABILITY,
  "care.understanding": ABILITY,
  "care.judgment": ABILITY,
  "care.orientation": ABILITY,
  "care.bedridden": YES_NO,
  "care.dementia": YES_NO,
  "medical.devices": [
    { code: "oxygen", label: "在宅酸素", words: ["在宅酸素", "酸素", "HOT", "酸素療法", "酸素吸入"] },
    { code: "ventilator", label: "人工呼吸器", words: ["人工呼吸器", "呼吸器", "人工呼吸"] },
    { code: "suction", label: "吸引", words: ["吸引", "喀痰吸引", "たん吸引", "痰吸引"] },
    { code: "tube_feeding", label: "経管栄養", words: ["経管栄養", "胃ろう", "胃瘻", "経鼻", "経管"] },
    { code: "dialysis", label: "透析", words: ["透析", "人工透析"] },
    { code: "other", label: "その他", words: [] },
  ],
  "evacuation.hazards": [
    // 浸水の区域の名前は洪水にも津波・高潮・雨水出水にも入るので、words で当てず hazardCodes で（mapped-sheet.ts の hazardMatches と同じ決まり）
    { code: "flood", label: "浸水", words: [] },
    { code: "landslide", label: "土砂", words: ["土砂", "土砂災害", "がけ崩れ", "崖崩れ", "急傾斜地"] },
    { code: "tsunami", label: "津波", words: ["津波"] },
    { code: "other", label: "その他", words: [] },
  ],
  "evacuation.transport": TRANSPORT,
  "evacuation.destination2Means": TRANSPORT,
  "evacuation.nearestMeans": TRANSPORT,
  "evacuation.support": [
    { code: "call", label: "声掛け", words: ["声掛け", "声かけ", "声がけ", "呼びかけ", "情報伝達", "伝達"] },
    { code: "guide", label: "誘導", words: ["誘導", "避難誘導", "付き添い", "付添", "同行"] },
    { code: "assist", label: "移動介助", words: ["移動介助", "介助", "搬送", "移送", "おんぶ"] },
    { code: "other", label: "その他", words: [] },
  ],
  "evacuation.carryItems": CARRY,
  "evacuation.myTimeline": [
    { code: "app", label: "あり（アプリ）", words: ["アプリ"] },
    { code: "paper", label: "あり（紙）", words: ["紙"] },
    { code: "none", label: "なし", words: ["なし", "未作成"] },
  ],
  "basic.housing.type": [
    { code: "detached", label: "戸建住宅", words: ["戸建", "戸建て", "一戸建", "一戸建て", "戸建住宅"] },
    { code: "apartment", label: "共同住宅", words: ["共同住宅", "集合住宅", "アパート", "マンション", "団地"] },
  ],
  "basic.housing.structure": [
    { code: "wood", label: "木造", words: ["木造"] },
    { code: "steel", label: "鉄骨", words: ["鉄骨", "鉄骨造", "軽量鉄骨"] },
    { code: "concrete", label: "鉄筋", words: ["鉄筋", "鉄筋コンクリート", "RC", "SRC", "コンクリート"] },
    { code: "other", label: "その他", words: [] },
  ],
  "consent.registry": CONSENT,
  "consent.plan_share": CONSENT,
  "consent.supporters": CONSENT,
  "consent.medical": CONSENT,
  "emergency1.relation": RELATION,
  "emergency2.relation": RELATION,
  "supporter1.relation": RELATION,
  "supporter2.relation": RELATION,
};

/** 項目に値の表があるか */
export const hasCodes = (item: LedgerItemKey | null | undefined): item is LedgerItemKey => !!item && ITEM_CODES[item] !== undefined;

/** 項目の値のコードの全部（AI の答えを照らす。NONE・OTHER も） */
export function codesOf(item: LedgerItemKey): string[] {
  return [...(ITEM_CODES[item] ?? []).map((c) => c.code), NONE_CODE, OTHER_CODE];
}

/** 照らすための形（全角を半角に、空白・括弧を外す。mapped-sheet.ts の normalizeWord と同じ） */
export const norm = (s: string) => s.normalize("NFKC").replace(/[\s　]/g, "").replace(/[（）()【】「」]/g, "");

const NONE_OPTION = /^(なし|無|無し|ない|該当なし|特になし|連絡先なし)$/;
const OTHER_OPTION = /^(その他|他|そのほか)/;
/** 年齢・年数などの条件の付いた選択肢（「75歳以上一人暮らし」）。言い換えの表では当てない（条件は台帳の値だけでは決まらない） */
const CONDITION = /[0-9０-９]+\s*(歳|才|年|か月|ヶ月|m|ｍ|cm)/;
/** 不明・わからない（台帳の値の無い選択肢） */
const UNKNOWN_OPTION = /^(不明|わからない|分からない|未定)$/;

/** 選択肢の頭の番号（「1 自力でできる」「4その他」の 1・4）。後ろが数・区切りでない時だけ外す（要介護度の「3」「3〜5」は外さない） */
const LEAD_NO = /^[0-9０-９]+[.．、)）\s]*(?=[^0-9０-９.．~～〜\-ー－・,、\s歳才年階月日ヶか分人回mｍ%％])/;

/** 選択肢を「・」「／」で分けた言葉（「鉄骨・鉄筋コンクリート」→ 鉄骨・鉄筋コンクリート） */
function partsOf(option: string): string[] {
  return option
    .normalize("NFKC")
    .replace(LEAD_NO, "")
    .split(/[・／/、,，]/)
    .map(norm)
    .filter((p) => p !== "");
}

/** 1 つの言葉に当たるコード（同じ言葉か、含む言葉のうちいちばん長い物。同じ長さなら全部） */
function codesOfPart(part: string, defs: readonly CodeDef[]): string[] {
  let best = 0;
  let out: string[] = [];
  for (const d of defs) {
    if (d.not?.some((x) => part.includes(norm(x)))) continue;
    for (const w of d.words) {
      const n = norm(w);
      if (n === "" || !part.includes(n)) continue;
      const len = part === n ? 1000 : n.length;
      if (len > best) {
        best = len;
        out = [d.code];
      } else if (len === best && !out.includes(d.code)) out.push(d.code);
    }
  }
  return out;
}

const DIGIT = (s: string) => Number(s.normalize("NFKC"));

/** 要介護度の選択肢（「要介護3」「3」「要介護3～5」「要支援」「要支援1・2」） */
function careLevelCodes(option: string, field: Pick<MappingField, "label" | "section">): string[] | null {
  const o = option.normalize("NFKC").replace(/[\s　]/g, "");
  const ctxSupport = /要支援|支援/.test(field.label) && !/要介護|介護度|介護認定/.test(field.label);
  const range = o.match(/(要支援|要介護|介護|支援)?([1-5])[~～〜\-ー－]([1-5])/);
  if (range) {
    const kind = range[1]?.includes("支援") ? "support" : range[1] ? "care" : ctxSupport ? "support" : "care";
    const out: string[] = [];
    for (let n = DIGIT(range[2]); n <= DIGIT(range[3]); n++) out.push(`${kind}${n}`);
    return out;
  }
  const list = o.match(/^(要支援|要介護)([1-5](?:[・,、][1-5])*)$/);
  if (list) return list[2].split(/[・,、]/).map((n) => `${list[1] === "要支援" ? "support" : "care"}${n}`);
  if (/^(要支援|支援)$/.test(o)) return ["support1", "support2"];
  if (/^(要介護|介護)$/.test(o)) return ["care1", "care2", "care3", "care4", "care5"];
  const one = o.match(/^(要支援|要介護|介護|支援)?([1-5])$/);
  if (one) return [`${one[1]?.includes("支援") ? "support" : one[1] ? "care" : ctxSupport ? "support" : "care"}${one[2]}`];
  if (NONE_OPTION.test(o) || /^(非該当|未申請|自立)$/.test(o)) return [NONE_CODE];
  return null;
}

/** 洪水の区域の名前か（浸水の字でも津波・高潮・雨水出水・ため池の区域は洪水にしない。mapped-sheet.ts の hazardMatches と同じ） */
const OTHER_WATER = /津波|高潮|土砂|がけ|崖|雨水|内水|出水|ため池/;
const isFlood = (n: string) => !OTHER_WATER.test(n) && /洪水|水害|河川|氾濫|浸水/.test(n);

/**
 * 選択肢 1 つのコード（言い換えの決まった表だけ）。当たらなければ null（AI か人が当てる）。
 * 「なし」は NONE、「その他」は OTHER、不明・わからないは空の並び（どの値にも当てない）
 */
export function codeOfOption(item: LedgerItemKey, option: string, field: Pick<MappingField, "label" | "section">): string[] | null {
  const defs = ITEM_CODES[item];
  if (!defs) return null;
  if (item === "care.careLevel") return careLevelCodes(option.replace(LEAD_NO, ""), field);
  const bare = option.replace(LEAD_NO, "");
  const whole = norm(bare);
  if (whole === "") return null;
  if (UNKNOWN_OPTION.test(whole)) return [];
  if (CONDITION.test(option.normalize("NFKC"))) return null;
  if (OTHER_OPTION.test(whole)) return [OTHER_CODE];
  if (NONE_OPTION.test(whole)) return [NONE_CODE];
  const out = new Set<string>();
  for (const part of partsOf(option)) {
    if (OTHER_OPTION.test(part)) {
      out.add(OTHER_CODE);
      continue;
    }
    if (UNKNOWN_OPTION.test(part)) continue;
    const codes = item === "evacuation.hazards" && isFlood(part) ? ["flood", ...codesOfPart(part, defs)] : codesOfPart(part, defs);
    if (codes.length === 0) return null;
    for (const c of codes) out.add(c);
  }
  return out.size > 0 ? [...out] : null;
}

/** 欄に残す AI の当て（読み取りの時。項目が変わったら使わない） */
export type OptionValues = {
  /** 当てた時の項目 */
  item: LedgerItemKey;
  /** 選択肢ごとのコード（options と同じ順）。null は当たらない */
  values: Array<string[] | null>;
  /** AI が当てた選択肢の番号（AI の印） */
  ai: number[];
};

/**
 * 欄の選択肢と台帳の値の表。対応表に残した当て（AI が当てた物・人が直した物。項目と選択肢の数が同じときだけ）が先、無い選択肢は言い換えの表
 * （表を直せば前の対応表にも効く）。値の表の無い項目・選ぶ欄でない欄は null
 */
export function optionTable(field: Pick<MappingField, "shape" | "item" | "options" | "label" | "section" | "optionValues">): Array<string[] | null> | null {
  if (field.shape !== "choice" || !hasCodes(field.item) || field.options.length === 0) return null;
  const stored = field.optionValues && field.optionValues.item === field.item && field.optionValues.values.length === field.options.length ? field.optionValues.values : null;
  // 残した当て（AI が当てた物・人が確かめの画面で直した物）があればそれ、無ければ言い換えの表
  return field.options.map((o, i) => stored?.[i] ?? codeOfOption(field.item!, o, field));
}

/** 欄の選択肢のうち、言い換えの表で当たらない物の番号（読み取りの時に AI に当てさせる） */
export function unmatchedOptions(field: Pick<MappingField, "shape" | "item" | "options" | "label" | "section">): number[] {
  if (field.shape !== "choice" || !hasCodes(field.item)) return [];
  return field.options.flatMap((o, i) => (codeOfOption(field.item!, o, field) === null ? [i] : []));
}

export type CodePick = { hits: number[]; range: boolean; ambiguous: boolean };

/**
 * 台帳の値のコードと選択肢の表を照らす。codes は人の値（空の並びは「無い」と分かっている値〔機器なし〕）。
 * multi は種類が並ぶ項目（全部の当たりに印）。1 つを選ぶ欄で 2 つ以上当たれば選ばない（ambiguous）。
 * 当たらず、表が全部埋まり、人の値が全部表の値（列挙）なら range（範囲外。空くのが答え）
 */
export function pickByCodes(table: ReadonlyArray<readonly string[] | null>, codes: readonly string[], multi: boolean, known: readonly string[]): CodePick {
  const named = new Set(table.flatMap((t) => (t ?? []).filter((c) => c !== OTHER_CODE && c !== NONE_CODE)));
  // 「その他」は、ほかの選択肢が全部表で当たっているときだけ（当たらない選択肢の値を「その他」に取らない）
  const otherOk = table.every((t) => t !== null);
  const hits: number[] = [];
  table.forEach((t, i) => {
    if (!t) return;
    const hit = codes.length === 0 ? t.includes(NONE_CODE) : t.some((c) => codes.includes(c)) || (otherOk && t.includes(OTHER_CODE) && codes.some((c) => !named.has(c)));
    if (hit) hits.push(i);
  });
  if (!multi && hits.length > 1) {
    // 「その他」と名前の当たる選択肢が両方なら、名前の方
    const named1 = hits.filter((i) => !table[i]!.includes(OTHER_CODE));
    if (named1.length === 1) return { hits: named1, range: false, ambiguous: false };
    return { hits: [], range: false, ambiguous: true };
  }
  const full = table.every((t) => t !== null);
  const range = hits.length === 0 && full && codes.length > 0 && codes.every((c) => known.includes(c));
  return { hits, range, ambiguous: false };
}

/** 持ち出し品などの自由な言葉を値のコードに（当たらない言葉は「text:言葉」。その他の選択肢にだけ当たる） */
export function freeCodes(item: LedgerItemKey, words: readonly string[]): string[] {
  const defs = ITEM_CODES[item] ?? [];
  return words.flatMap((w) => {
    const codes = codesOfPart(norm(w), defs);
    return codes.length > 0 ? codes : [`text:${norm(w)}`];
  });
}

/**
 * 確かめの画面で人が選択肢の当てを直す（T140）。codes は当てる値（null は未定、空の並びはどの値にも当てない）。
 * 直した選択肢は AI の印を外す。言い換えの表と同じに戻したら残さない
 */
export function editOptionValue(field: Pick<MappingField, "item" | "options" | "label" | "section" | "optionValues">, i: number, codes: string[] | null): OptionValues | undefined {
  if (!hasCodes(field.item)) return field.optionValues;
  const base = field.optionValues && field.optionValues.item === field.item && field.optionValues.values.length === field.options.length ? field.optionValues : null;
  const values = field.options.map((_, k) => base?.values[k] ?? null);
  const table = codeOfOption(field.item, field.options[i], field);
  values[i] = codes !== null && JSON.stringify(codes) === JSON.stringify(table) ? null : codes;
  const ai = (base?.ai ?? []).filter((k) => k !== i);
  return values.some((v) => v !== null) ? { item: field.item, values, ai } : undefined;
}

/** 確かめの画面・AI に出す値の名前 */
export function codeLabel(item: LedgerItemKey, code: string): string {
  if (code === NONE_CODE) return "なし";
  if (code === OTHER_CODE) return "その他";
  return ITEM_CODES[item]?.find((c) => c.code === code)?.label ?? code;
}
