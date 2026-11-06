// 様式の形から、1 つの台帳の項目を当ててよい欄を決める（T140）。評価の 4 回目で、岐阜市の様式（同じ表が 3 頁に並ぶ写しの様式）の
// 紙 1 枚に決まりの見直しの「重複」が 40 前後出た（同じ項目を頁ごとに当てるのは読み取りの決まり 12 のとおりで、写しの頁に同じ値を書くのは正しい）。
//
// 1 つの項目を当ててよいのは、次の欄ごとに 1 つ:
// - 頁ごとに繰り返す欄（写しの頁・頁の頭に繰り返す氏名や作成日）: 別の頁で、同じ項目で、欄の真ん中の差が頁の 3% までか欄の名前が同じ欄は同じ所と見る
// - 電話と携帯: 連絡先の電話の項目は電話と携帯の 2 行を持つので、「携帯」の欄と電話の欄は別の所（lib/forms/mapped-sheet.ts の phoneRole）
// - 一覧の形の様式（T131）の行ごとの欄: 対応表は 1 行目の 1 欄だけを持ち、行は紙を作るときに増える（対応表の欄どうしで重ならない）
// これより多く同じ項目を当てた欄・同じ値が名前の違う 2 つの欄に入ったのが本当の重複（見直しの「重複」、lib/forms/review.ts）。
// 決めるのはコード（Claude を呼ばない）。ブラウザでも読む。

import type { FieldBox } from "./mapping.ts";

export type ShapeField = { id: string; page: number | null; box: FieldBox | null; source?: string | null; item?: string | null; label: string; shape?: string; options?: readonly string[] };

/** 頁ごとの同じ場所と見る、欄の真ん中の差（頁の比） */
const SLOT_NEAR = 0.03;

const itemOf = (f: Pick<ShapeField, "source" | "item">) => f.source ?? f.item ?? null;
const center = (b: FieldBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const near = (a: FieldBox, b: FieldBox) => {
  const p = center(a);
  const q = center(b);
  return Math.abs(p.x - q.x) <= SLOT_NEAR && Math.abs(p.y - q.y) <= SLOT_NEAR;
};

/** 段を除いた欄の名前 */
const baseLabel = (l: string) => (l.split(/[\s　]+/).at(-1) ?? l).normalize("NFKC").replace(/^[*※]+/, "");

/**
 * 2 つの欄が、頁ごとに繰り返す欄か（別の頁で、同じ項目、ほぼ同じ場所か同じ欄の名前。写しの頁・頁の頭に繰り返す氏名や作成日）
 */
export function pageRepeat(a: ShapeField, b: ShapeField): boolean {
  if (a.page === null || b.page === null || a.page === b.page || !a.box || !b.box) return false;
  return itemOf(a) !== null && itemOf(a) === itemOf(b) && (near(a.box, b.box) || baseLabel(a.label) === baseLabel(b.label));
}

const MOBILE = /携帯/;
/** 電話と携帯の欄（同じ連絡先の電話の項目の 2 行） */
export function phonePair(a: ShapeField, b: ShapeField): boolean {
  return itemOf(a) === itemOf(b) && /\.phone$/.test(itemOf(a) ?? "") && MOBILE.test(a.label) !== MOBILE.test(b.label);
}

/** 名前の後ろの空の括弧（「アレルギー（　）」の アレルギー） */
const BRACKETED = /^(.+?)\(\)$/;
const plain = (l: string) => l.normalize("NFKC").replace(/[\s　]/g, "");

/**
 * □ と、その □ の中身を書く括弧の組（T161。「□アレルギー（　）」「要介護（　）」。読み取りの決まり 21 と読み取りの補いの括弧〔item-hints.ts の 1〕）。
 * 同じ頁・同じ項目で、片方の名前がもう片方の名前に空の括弧を付けた物。□ に印、括弧の中に中身なので、同じ項目を 2 か所に当ててよい
 */
export function bracketPair(a: ShapeField, b: ShapeField): boolean {
  if (a.page !== b.page || itemOf(a) === null || itemOf(a) !== itemOf(b)) return false;
  const name = (x: ShapeField) => plain(x.label);
  const m = (x: ShapeField) => name(x).match(BRACKETED)?.[1] ?? null;
  if ((m(a) !== null && m(a) === name(b)) || (m(b) !== null && m(b) === name(a))) return true;
  // 選択肢の後ろの括弧（T164。「□徒歩 □車 □その他（　）」の その他（　）、「□洪水（～）」）: 括弧の欄は選ぶ欄の子
  if ((bracketBase(a) !== null && optionIndexOf(b, bracketBase(a)!) >= 0) || (bracketBase(b) !== null && optionIndexOf(a, bracketBase(b)!) >= 0)) return true;
  // 選択肢の名前の字の欄（T175。「洪水浸水想定区域（浸水想定　m）」「洪水（河川の氾濫）」）: 同じく選ぶ欄の子
  return optionChildIndex(a, b) >= 0 || optionChildIndex(b, a) >= 0;
}

// ---------- 括弧の子の欄（T164） ----------

const OTHER_BASE = /^(その他|他|そのほか)$/;
//
// 評価の 7 回目で、読み取りの決まり 21（T161）のあと、AI が □・選択肢の後ろの括弧（「□抗血小板薬（　）」「□その他（　）」「□洪水（～）」）を、
// 親の □・選ぶ欄と同じ項目の字の欄として別に挙げるようになった。紙は括弧の欄に項目の値を丸ごと書き（抗血小板薬の括弧に常用薬の全部や「なし」、
// 手段の「その他（　）」に手段の値）、親の選ぶ欄の添え（その他の中身・浸水の深さ）は括弧の場所が塞がって置けなかった（置けなかった欄 room）。
// 括弧の欄は親の欄の子: 親が □ なら親の種類の値だけ、親が選ぶ欄ならその選択肢の添えの置き場にする（lib/forms/mapped-sheet.ts・overlay-sheet.ts）

/** 名前の後ろの空の括弧・「（～）」の括弧（「その他（　）」「洪水（～）」の その他・洪水）。中に字のある括弧（「在宅酸素療法（HOT）」）は違う */
const BRACKET_TAIL = /^(.+?)\((?:[~〜～ー\-・…]|\.{1,3})?\)$/u;
/** 選択肢の頭の番号（「4その他」の 4） */
const OPTION_NO = /^[0-9]+[.、)]?(?=[^0-9])/;
/** 括弧の欄の名前の元（括弧の前の字）。括弧の欄でなければ null */
export function bracketBase(f: Pick<BracketField, "label" | "shape">): string | null {
  if (f.shape !== undefined && f.shape !== "text" && f.shape !== "lines") return null;
  return plain(f.label).match(BRACKET_TAIL)?.[1] ?? null;
}
/** 選ぶ欄の選択肢のうち、名前が base の物の番号（無ければ -1） */
function optionIndexOf(f: BracketField, base: string): number {
  if (f.shape !== undefined && f.shape !== "choice") return -1;
  return (f.options ?? []).findIndex((o) => {
    const p = plain(o).replace(OPTION_NO, "");
    return p === base || p.match(BRACKET_TAIL)?.[1] === base;
  });
}

/**
 * 字の欄の名前が、同じ項目の選ぶ欄の選択肢の名前そのものか、選択肢の名前と括弧の説明（T175）。評価の 9 回目で、読み取りが「洪水浸水想定区域（浸水想定　m）」の
 * 深さの空き 4 つに親と同じ項目を当て（8 回目は項目なし）、紙は小さな枠に災害の種類を丸ごと書こうとして置けず、見直しの重複が同じ様式で 0 → 263 に増えた。
 * 川崎市の「洪水（河川の氾濫）」の行も同じ形。選択肢の添えの置き場で、項目の値を書く所ではない。親の無い欄・項目の違う欄は当たらない。
 * 選択肢の番号。当たらなければ -1
 */
function optionChildIndex(f: BracketField, g: BracketField): number {
  if ((f.shape !== undefined && f.shape !== "text" && f.shape !== "lines") || (g.shape !== undefined && g.shape !== "choice")) return -1;
  const name = plain(f.label);
  return (g.options ?? []).findIndex((o) => {
    const p = plain(o).replace(OPTION_NO, "");
    return p !== "" && (p === name || (name.startsWith(`${p}(`) && name.endsWith(")")));
  });
}

/** 括弧の子の欄を探す欄の形（対応表の欄も見直しの欄も） */
export type BracketField = Omit<ShapeField, "box"> & { box?: FieldBox | null; removed?: boolean };

export type BracketOwner<T> = {
  /** 親の欄（□ か選ぶ欄） */
  owner: T;
  /** 親が選ぶ欄なら、括弧が続く選択肢の番号。□ なら null */
  option: number | null;
  /** 親が □ のとき、同じ行で括弧より左の同じ項目の □（「□抗凝固薬 □ワーファリン（　）」の 2 つ）。括弧の中身はこの □ の種類の値 */
  row: T[];
  /**
   * 種類の □ の並びの終わりの「その他（　）」で、「その他」の □ が無い物（□ だけ読み落とした形）。親は前の □ で、括弧の中身は
   * 並びのどの種類にも入らない値（常用薬なら「その他」の区分の薬）
   */
  rest?: true;
};

/**
 * 括弧の子の欄の親（T164）。字の欄で、名前が「X（　）」「X（～）」、同じ頁・同じ項目の □ で名前が X の欄か、選択肢に X のある選ぶ欄があれば
 * その欄が親（いくつもあれば括弧に近い物）。項目なしの欄は親を持たない（前からの「その他（　）」の書く所の扱い、overlay-sheet.ts の free）
 */
export function bracketOwner<T extends BracketField>(field: T, fields: readonly T[]): BracketOwner<T> | null {
  const base = bracketBase(field);
  const item = itemOf(field);
  if (item === null) return null;
  const candidates = fields.filter((g) => g !== field && !g.removed && g.page === field.page && itemOf(g) === item);
  const owners: Array<BracketOwner<T>> = [];
  for (const g of candidates) {
    if (base !== null && g.shape === "check" && plain(g.label) === base) owners.push({ owner: g, option: null, row: [] });
    else {
      const i = base !== null ? optionIndexOf(g, base) : -1;
      const child = i >= 0 ? i : optionChildIndex(field, g);
      if (child >= 0) owners.push({ owner: g, option: child, row: [] });
    }
  }
  if (owners.length === 0) return base !== null && OTHER_BASE.test(base) ? restOwner(field, fields) : null;
  const dist = (g: T) => (g.box && field.box ? Math.hypot(g.box.x + g.box.w - field.box.x, center(g.box).y - center(field.box).y) : 0);
  const best = owners.sort((a, b) => dist(a.owner) - dist(b.owner))[0];
  if (best.option !== null) return best;
  // 同じ行の左の □（「□糖尿病治療薬 □インスリン □経口薬（　）」は 3 つの □ の中身を 1 つの括弧に書く）
  const fb = field.box;
  const ob = best.owner.box;
  const row =
    fb && ob
      ? candidates.filter((g) => g.shape === "check" && g.box && Math.abs(center(g.box).y - center(ob).y) <= Math.max(ob.h, g.box.h) && center(g.box).x <= center(ob).x && center(g.box).x < fb.x + fb.w)
      : [];
  return { ...best, row: row.includes(best.owner) ? row : [best.owner, ...row] };
}


/**
 * 並びの終わりの「その他（　）」に、前の □・選ぶ欄と違う項目を当てた欄（T164）。「その他（　）」は前の並び（常用薬の種類の □ など）に
 * 入らない物を書く所なので、違う項目の値（医療の特記）を書くと違う欄に書くことになる。紙は空ける（項目なしの「その他（　）」と同じく、
 * 前の選ぶ欄の「その他」の中身の置き場にはなる）。評価の 7 回目の災害診療記録で、常用薬の「その他（　）」に医療の特記が出た
 */
export function strayOther<T extends BracketField & { section?: string; shape?: string }>(field: T, fields: readonly T[]): boolean {
  const base = bracketBase(field);
  const item = itemOf(field);
  if (base === null || !OTHER_BASE.test(base) || item === null || bracketOwner(field, fields)) return false;
  const prev = previousMark(field, fields);
  const gi = prev ? itemOf(prev) : null;
  return gi !== null && gi !== item;
}

/** 並びの終わりの「その他（　）」の親（同じ段のすぐ前の □・選ぶ欄が同じ項目の □ ならそれ）。無ければ null */
function restOwner<T extends BracketField>(field: T, fields: readonly T[]): BracketOwner<T> | null {
  const prev = previousMark(field, fields);
  return prev && prev.shape === "check" && itemOf(prev) === itemOf(field) ? { owner: prev, option: null, row: [], rest: true } : null;
}

/** 同じ頁・同じ段で、欄の並びのすぐ前の □・選ぶ欄（間の字の欄は飛ばす。段が変われば無い） */
function previousMark<T extends BracketField>(field: T, fields: readonly T[]): T | null {
  const at = fields.indexOf(field);
  const section = (f: T) => (f as { section?: string }).section;
  for (let i = at - 1; i >= 0; i--) {
    const g = fields[i];
    if (g.removed || g.page !== field.page) continue;
    if (section(g) !== section(field)) return null;
    if (g.shape === "check" || g.shape === "choice") return g;
  }
  return null;
}

/** 欄の並びの、括弧の子の欄 → 親（id ごと） */
export function bracketOwners<T extends BracketField>(fields: readonly T[]): Map<string, BracketOwner<T>> {
  const out = new Map<string, BracketOwner<T>>();
  for (const f of fields) {
    if (f.removed) continue;
    const o = bracketOwner(f, fields);
    if (o) out.set(f.id, o);
  }
  return out;
}

/**
 * 印だけの欄の組（T175）: 種類ごとの □ 同士（読み取りの決まり 12。人工呼吸器・吸引の □ に同じ項目で、紙は合う □ だけに印）と、別の頁の選ぶ欄・□ 同士
 * （1 頁の性別と 2 頁の性別の区分）。印は値を 2 回書かないので重複でない
 */
export function markPair(a: ShapeField, b: ShapeField): boolean {
  if (itemOf(a) === null || itemOf(a) !== itemOf(b)) return false;
  const mark = (f: ShapeField) => f.shape === "check" || f.shape === "choice";
  return (a.shape === "check" && b.shape === "check") || (a.page !== b.page && mark(a) && mark(b));
}

/** 同じ値・同じ項目でも重複と見ない組（頁ごとの同じ場所・電話と携帯・□ と括弧・印だけの欄） */
export const allowedTwice = (a: ShapeField, b: ShapeField) => pageRepeat(a, b) || phonePair(a, b) || bracketPair(a, b) || markPair(a, b);

/**
 * 前の欄（同じ値・同じ項目の物）があっても f を重複と見ないか: 同じ頁の前の欄が電話と携帯の組・□ と括弧の組だけで、ほかの頁の前の欄があれば
 * そのどれかと頁ごとに繰り返す欄の組（同じ頁の 2 か所目は、ほかの頁の欄と名前が同じでも重複）
 */
export function repeatOk(before: readonly ShapeField[], f: ShapeField): boolean {
  const same = before.filter((g) => g.page === f.page);
  if (same.some((g) => !phonePair(g, f) && !bracketPair(g, f) && !markPair(g, f))) return false;
  const other = before.filter((g) => g.page !== f.page);
  return other.length === 0 || other.some((g) => allowedTwice(g, f));
}

/**
 * 項目を当ててよい数より多く当てた欄（様式の順に、前の欄のどれとも頁ごとの同じ場所・電話と携帯の組にならない 2 つ目からの欄）。
 * 欄の id → 先に当てた欄の id
 */
export function extraItemFields<T extends ShapeField>(fields: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  const bySource = new Map<string, T[]>();
  for (const f of fields) {
    const item = itemOf(f);
    if (!item) continue;
    const before = bySource.get(item) ?? [];
    bySource.set(item, [...before, f]);
    if (before.length > 0 && !repeatOk(before, f)) out.set(f.id, before[0]);
  }
  return out;
}
