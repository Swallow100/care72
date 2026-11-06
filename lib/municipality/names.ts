// 全国の市区町村の表（T154）の名前の側: 団体コード（6 桁）・都道府県・市区町村名・よみ・政令指定都市の区の市。
// 画面（事業所の地域の選ぶ部品）でも読むので、緯度経度・気象庁のコードは持たない（サーバーだけの lib/municipality/geo.ts）。
// 表は tools/municipality/build.ts が公的な表から作る（names-data.ts。出典と条件は docs/sources/municipalities.md）。
//
// 文字の市の名前（T148 までの offices.city・region_cities と、台帳の basic.address.city）を表に当てる決まり（resolveCityName）:
// - 前後と中の空白を落とし、NFKC にそろえ、「ヶ・ケ・ヵ・カ」の小さい字と大きい字の違いを同じに見る（鎌ケ谷市と鎌ヶ谷市）
// - 頭に都道府県の名前があれば外してその県で探す。頭の「○○郡」は外す（上浮穴郡久万高原町 → 久万高原町）
// - 名前が全国で 1 つならそれ。2 つ以上（府中市・伊達市など）なら手がかりの都道府県で 1 つに決まるときだけ。決まらなければ当てない
// 似た名前への寄せ・町名からの推し量りはしない。

import { MUNICIPALITY_NAMES_TSV, MUNICIPALITY_SOURCE_DATE } from "./names-data.ts";

/** 都道府県（団体コードの頭 2 桁の順） */
export const PREFECTURE_NAMES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export { MUNICIPALITY_SOURCE_DATE };

export type Municipality = {
  /** 全国地方公共団体コード（6 桁、検査数字つき） */
  code: string;
  pref: string;
  name: string;
  /** よみ（ひらがな） */
  kana: string;
  /** 政令指定都市の区なら市の団体コード。ほかは null */
  parent: string | null;
};

let rows: Municipality[] | null = null;
let byCode: Map<string, Municipality> | null = null;

function load(): Municipality[] {
  if (rows) return rows;
  rows = MUNICIPALITY_NAMES_TSV.split("\n").map((line) => {
    const [code, name, kana, parent] = line.split("\t");
    return { code, pref: PREFECTURE_NAMES[Number(code.slice(0, 2)) - 1], name, kana, parent: parent ? parent : null };
  });
  byCode = new Map(rows.map((r) => [r.code, r]));
  return rows;
}

/** 表の全部（団体コードの順。政令指定都市の区は市のすぐ後） */
export function allMunicipalities(): readonly Municipality[] {
  return load();
}

/** 団体コードの行（無ければ null） */
export function municipalityByCode(code: string | null | undefined): Municipality | null {
  if (!code) return null;
  load();
  return byCode!.get(code) ?? null;
}

/** 表にある団体コードか */
export function isMunicipalityCode(v: unknown): v is string {
  return typeof v === "string" && /^\d{6}$/.test(v) && municipalityByCode(v) !== null;
}

/** 都道府県の中の市区町村（団体コードの順） */
export function municipalitiesIn(pref: string): Municipality[] {
  return load().filter((r) => r.pref === pref);
}

/** 画面の字（都道府県＋市区町村） */
export const fullName = (m: Pick<Municipality, "pref" | "name">) => `${m.pref}${m.name}`;

/** 同じ所か、片方がもう片方の区（広島市と広島市中区）か */
export function sameArea(a: Municipality, b: Municipality): boolean {
  return a.code === b.code || a.parent === b.code || b.parent === a.code;
}

/** 当てるための字（空白を落とし NFKC、小さいヶ・ヵを大きい字に） */
export function nameKey(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[ヶヵ]/g, (c) => (c === "ヶ" ? "ケ" : "カ"));
}

let byKey: Map<string, Municipality[]> | null = null;

function keyIndex(): Map<string, Municipality[]> {
  if (byKey) return byKey;
  byKey = new Map();
  for (const r of load()) {
    const k = nameKey(r.name);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  return byKey;
}

/** 頭の都道府県の名前（無ければ null）と残り */
export function splitPref(text: string): { pref: string | null; rest: string } {
  const t = nameKey(text);
  const pref = PREFECTURE_NAMES.find((p) => t.startsWith(p)) ?? null;
  return { pref, rest: pref ? t.slice(pref.length) : t };
}

export type CityMatch = { kind: "match"; municipality: Municipality } | { kind: "ambiguous"; candidates: Municipality[] } | { kind: "none" };

/**
 * 文字の市の名前を表に当てる（決まりはこのファイルの頭）。prefHint は名前が 2 つ以上あるときの手がかりの都道府県（事業所の主な市の県）。
 * 名前が頭に都道府県を持てば、その県が手がかりより先
 */
export function resolveCityName(text: string | null | undefined, prefHint?: string | null): CityMatch {
  if (!text) return { kind: "none" };
  const { pref, rest } = splitPref(text);
  const name = rest.replace(/^[^市区町村郡]+郡(?=.+[市区町村]$)/, "");
  if (!name) return { kind: "none" };
  const hits = keyIndex().get(name) ?? [];
  const inPref = pref ? hits.filter((h) => h.pref === pref) : hits;
  if (inPref.length === 1) return { kind: "match", municipality: inPref[0] };
  if (inPref.length === 0) return { kind: "none" };
  const hinted = prefHint ? inPref.filter((h) => h.pref === prefHint) : [];
  if (hinted.length === 1) return { kind: "match", municipality: hinted[0] };
  return { kind: "ambiguous", candidates: inPref };
}

/** 当たれば行、当たらなければ null（resolveCityName の短い形） */
export function matchCity(text: string | null | undefined, prefHint?: string | null): Municipality | null {
  const r = resolveCityName(text, prefHint);
  return r.kind === "match" ? r.municipality : null;
}

/**
 * 所在地の文字（「愛媛県松山市みずほし町」）の頭の市区町村。都道府県があればその県の中で、一番長く頭に当たる名前（区のある市は区まで）。
 * 都道府県が無ければ名前が全国で 1 つのときだけ。当たらなければ null
 */
export function municipalityOfAddress(text: string | null | undefined): Municipality | null {
  if (!text) return null;
  const { pref, rest } = splitPref(text);
  const body = rest.replace(/^[^市区町村郡]+郡/, "");
  let best: Municipality[] = [];
  let bestLen = 0;
  for (const [k, ms] of keyIndex()) {
    if (k.length < bestLen || !body.startsWith(k)) continue;
    const ok = pref ? ms.filter((m) => m.pref === pref) : ms;
    if (ok.length === 0) continue;
    if (k.length > bestLen) {
      best = ok;
      bestLen = k.length;
    } else best = [...best, ...ok];
  }
  return best.length === 1 ? best[0] : null;
}
