// 仮想モード（docs/tasks/T50.md）の事業所の地理。デモ事業所の範囲の架空の街（コードの種。Claude を呼ばない）。
//
// - 町は種の 10 人の台帳の町名（seed/people.ts。全部架空）と、架空の町を 2 つ。実在の地名は使わない
// - Claude（世界の部屋・1 回呼び）には町名を渡さない。台帳の町名は仮名化の門（lib/pseudonym）が「（町名）」に伏せる物なので、
//   部屋には町ごとの別名（甲地区・乙地区…）だけを見せる。別名 → 町名 → そこに住む本人の結び付きはコードだけが持つ
//   （部屋が知るのは「甲地区は川沿いで洪水 3 m の想定」のような地理の事実と、本人の仮名と弱点。誰がどの地区かは知らない）
// - 避難所・施設の名前も町名を含まない一般の言い方（「高台の小学校」）。台帳の避難先の名前は使わない
// - 道路は通る地区、施設は頼る時計の区分（透析施設 → 透析の時計の人）で人に当てる（lib/drill/world-apply.ts）

import type { DependsOn, Ledger } from "../db/types.ts";

/** 町 1 つ。town は台帳の町名（画面の言葉）、alias は部屋に見せる別名 */
export type AreaTown = {
  town: string;
  alias: string;
  /** 地形の一言（部屋に見せる） */
  terrain: string;
  /** 洪水の浸水の想定（m）。無ければ null */
  floodM: number | null;
  landslide: boolean;
  tsunami: boolean;
  /** 送電の区分（停電はこの単位で起きやすい） */
  grid: string;
};

export type AreaRoad = { id: string; name: string; towns: string[] };
export type AreaShelter = { id: string; name: string; town: string; welfare: boolean };
export type AreaFacility = { id: string; name: string; town: string; depends: DependsOn | null; kind: string };

/** 川（部屋に見せる架空の名前） */
export const AREA_RIVER = "白波川";

export const AREA_TOWNS: ReadonlyArray<AreaTown> = [
  { town: "かわなぎ町", alias: "甲地区", terrain: "白波川の堤防のすぐ内側の低い土地", floodM: 3, landslide: false, tsunami: false, grid: "東系統" },
  { town: "みずほし町", alias: "乙地区", terrain: "白波川から少し離れた平地", floodM: 0.5, landslide: false, tsunami: false, grid: "東系統" },
  { town: "あしなみ町", alias: "丙地区", terrain: "白波川の支流沿いの住宅地", floodM: 1, landslide: false, tsunami: false, grid: "東系統" },
  { town: "くぬぎ谷町", alias: "丁地区", terrain: "山すその谷。裏に急な斜面", floodM: null, landslide: true, tsunami: false, grid: "山手系統" },
  { town: "うみなり町", alias: "戊地区", terrain: "海に面した低い土地", floodM: null, landslide: false, tsunami: true, grid: "海側系統" },
  { town: "そらみ台", alias: "己地区", terrain: "高台の住宅地", floodM: null, landslide: false, tsunami: false, grid: "山手系統" },
  // 台帳に住む人のいない架空の町（施設と避難所がある）
  { town: "ほたる坂町", alias: "庚地区", terrain: "高台へ上る坂の途中", floodM: null, landslide: false, tsunami: false, grid: "山手系統" },
  { town: "しおかぜ町", alias: "辛地区", terrain: "白波川の河口近くの平地", floodM: 0.5, landslide: false, tsunami: true, grid: "海側系統" },
];

export const AREA_ROADS: ReadonlyArray<AreaRoad> = [
  { id: "riverside", name: "川沿いの市道", towns: ["かわなぎ町", "みずほし町", "あしなみ町"] },
  { id: "valley", name: "谷の県道", towns: ["くぬぎ谷町"] },
  { id: "coast", name: "海沿いの国道", towns: ["うみなり町", "しおかぜ町"] },
  { id: "slope", name: "高台への坂道", towns: ["そらみ台", "ほたる坂町"] },
  { id: "bridge", name: "白波川の橋", towns: ["かわなぎ町", "しおかぜ町"] },
];

export const AREA_SHELTERS: ReadonlyArray<AreaShelter> = [
  { id: "hill-school", name: "高台の小学校", town: "そらみ台", welfare: false },
  { id: "valley-hall", name: "谷の集会所", town: "くぬぎ谷町", welfare: false },
  { id: "slope-hall", name: "坂の公民館", town: "ほたる坂町", welfare: false },
  { id: "welfare-home", name: "福祉避難所（特養）", town: "ほたる坂町", welfare: true },
];

export const AREA_FACILITIES: ReadonlyArray<AreaFacility> = [
  { id: "dialysis", name: "河口の透析クリニック", town: "しおかぜ町", depends: "dialysis_center", kind: "透析施設" },
  { id: "nurse", name: "訪問看護ステーション", town: "ほたる坂町", depends: null, kind: "訪問看護" },
  { id: "pharmacy", name: "薬局の配達", town: "みずほし町", depends: "delivery", kind: "配達" },
  { id: "hospital", name: "川沿いの病院", town: "かわなぎ町", depends: null, kind: "病院" },
];

const byAlias = new Map(AREA_TOWNS.map((t) => [t.alias, t]));
const byTown = new Map(AREA_TOWNS.map((t) => [t.town, t]));

/** 別名（「甲地区」「甲」）→ 台帳の町名。知らなければ null */
export function townOfAlias(raw: string): string | null {
  const v = raw.trim().replace(/[ 　]/g, "");
  if (!v) return null;
  const hit = byAlias.get(v) ?? byAlias.get(`${v}地区`) ?? null;
  return hit?.town ?? null;
}

/** 町名 → 別名。地理に無い町は null */
export function aliasOfTown(town: string | null | undefined): string | null {
  return town ? (byTown.get(town.trim())?.alias ?? null) : null;
}

export function areaTown(town: string | null | undefined): AreaTown | null {
  return town ? (byTown.get(town.trim()) ?? null) : null;
}

/** 道路の名前（「川沿いの市道」）か id → 道路。知らなければ null */
export function roadOf(raw: string): AreaRoad | null {
  const v = raw.trim();
  return AREA_ROADS.find((r) => r.name === v || r.id === v) ?? null;
}

export function shelterOf(raw: string): AreaShelter | null {
  const v = raw.trim();
  return AREA_SHELTERS.find((s) => s.name === v || s.id === v) ?? null;
}

export function facilityOf(raw: string): AreaFacility | null {
  const v = raw.trim();
  return AREA_FACILITIES.find((f) => f.name === v || f.id === v) ?? null;
}

/** 本人の町（台帳の住所の町名）。地理に無い町・空は null。コードだけが使う（部屋に渡さない） */
export function townOfLedger(ledger: Pick<Ledger, "basic">): string | null {
  const t = ledger.basic.address?.town?.trim();
  return t && byTown.has(t) ? t : null;
}

/** 部屋の文の別名（甲地区）を町名に戻す（画面の文。サーバーの中だけ） */
export function restoreTowns(text: string): string {
  let out = text;
  for (const t of AREA_TOWNS) out = out.split(t.alias).join(t.town);
  return out;
}

/** 部屋に見せる地理の文（別名だけ。町名・人と町の結び付きを書かない） */
export function geographyText(): string {
  const hazards = (t: AreaTown) =>
    [
      t.floodM != null ? `洪水 ${t.floodM} m の想定` : null,
      t.landslide ? "土砂災害の警戒区域" : null,
      t.tsunami ? "津波の浸水の想定" : null,
    ].filter(Boolean);
  const aliasOf = (town: string) => byTown.get(town)?.alias ?? town;
  return [
    `地区（${AREA_TOWNS.length}）。${AREA_RIVER}が街を東から海へ流れる:`,
    ...AREA_TOWNS.map((t) => `- ${t.alias}: ${t.terrain}。${hazards(t).join("・") || "ハザードの想定なし"}。送電 ${t.grid}`),
    "主な道:",
    ...AREA_ROADS.map((r) => `- ${r.name}（${r.towns.map(aliasOf).join("・")}）`),
    "避難所:",
    ...AREA_SHELTERS.map((s) => `- ${s.name}（${aliasOf(s.town)}${s.welfare ? "、福祉避難所" : ""}）`),
    "施設（本人たちが頼る所）:",
    ...AREA_FACILITIES.map((f) => `- ${f.name}（${aliasOf(f.town)}、${f.kind}）`),
  ].join("\n");
}
