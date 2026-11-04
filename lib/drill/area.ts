// 仮想モード（docs/tasks/T50.md）の事業所の地理（コードの種。Claude を呼ばない）。デモ事業所は架空の街（DEMO_AREA）、
// ほかの事業所は参加者の台帳の町名から作る（areaOf、T70）。
//
// - デモの町は種の 10 人の台帳の町名（seed/people.ts。全部架空）と、架空の町を 2 つ。実在の地名は使わない
// - 台帳から作る町は別名（甲地区…）と地形の一言（ハザードから）だけを部屋に見せ、町名は画面の言葉（restoreTowns）だけ
// - Claude（世界の部屋・1 回呼び）には町名を渡さない。台帳の町名は仮名化の門（lib/pseudonym）が「（町名）」に伏せる物なので、
//   部屋には町ごとの別名（甲地区・乙地区…）だけを見せる。別名 → 町名 → そこに住む本人の結び付きはコードだけが持つ
//   （部屋が知るのは「甲地区は川沿いで洪水 3 m の想定」のような地理の事実と、本人の仮名と弱点。誰がどの地区かは知らない）
// - 避難所・施設の名前も町名を含まない一般の言い方（「高台の小学校」）。台帳の避難先の名前は使わない
// - 道路は通る地区、施設は頼る時計の区分（透析施設 → 透析の時計の人）で人に当てる（lib/drill/world-apply.ts）

import { DEMO_OFFICE_ID } from "../auth/demo.ts";
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

/** 事業所の地理 1 つ（デモ事業所は架空の街、ほかの事業所は台帳の町名から作る。T70） */
export type Area = {
  /** 川（部屋に見せる架空の名前）。無ければ地理の文に川の行を書かない */
  river: string | null;
  towns: ReadonlyArray<AreaTown>;
  roads: ReadonlyArray<AreaRoad>;
  shelters: ReadonlyArray<AreaShelter>;
  facilities: ReadonlyArray<AreaFacility>;
};

/** デモ事業所の地理（T50 の架空の街。仮想の訓練のテストと種はこれ） */
export const DEMO_AREA: Area = {
  river: AREA_RIVER,
  towns: AREA_TOWNS,
  roads: AREA_ROADS,
  shelters: AREA_SHELTERS,
  facilities: AREA_FACILITIES,
};

/** 別名の地区（「甲地区」「甲」）→ 地理の町。知らなければ null */
function townByAlias(raw: string, area: Area): AreaTown | null {
  const v = raw.trim().replace(/[ 　]/g, "");
  if (!v) return null;
  return area.towns.find((t) => t.alias === v) ?? area.towns.find((t) => t.alias === `${v}地区`) ?? null;
}

/** 別名（「甲地区」「甲」）→ 台帳の町名。知らなければ null */
export function townOfAlias(raw: string, area: Area = DEMO_AREA): string | null {
  return townByAlias(raw, area)?.town ?? null;
}

/** 町名 → 別名。地理に無い町は null */
export function aliasOfTown(town: string | null | undefined, area: Area = DEMO_AREA): string | null {
  return areaTown(town, area)?.alias ?? null;
}

export function areaTown(town: string | null | undefined, area: Area = DEMO_AREA): AreaTown | null {
  const v = town?.trim();
  return v ? (area.towns.find((t) => t.town === v) ?? null) : null;
}

/** 道路の名前（「川沿いの市道」）か id → 道路。知らなければ null */
export function roadOf(raw: string, area: Area = DEMO_AREA): AreaRoad | null {
  const v = raw.trim();
  return area.roads.find((r) => r.name === v || r.id === v) ?? null;
}

export function shelterOf(raw: string, area: Area = DEMO_AREA): AreaShelter | null {
  const v = raw.trim();
  return area.shelters.find((s) => s.name === v || s.id === v) ?? null;
}

export function facilityOf(raw: string, area: Area = DEMO_AREA): AreaFacility | null {
  const v = raw.trim();
  return area.facilities.find((f) => f.name === v || f.id === v) ?? null;
}

/**
 * 本人の町（地理の町名）。デモの地理は台帳の町名が地理にあるときだけ、台帳から作った地理は町名の無い人を「町名なし」の町に。
 * 地理に無ければ null。コードだけが使う（部屋に渡さない）
 */
export function townOfLedger(ledger: Pick<Ledger, "basic">, area: Area = DEMO_AREA): string | null {
  const t = ledger.basic.address?.town?.trim() || NO_TOWN;
  return area.towns.some((x) => x.town === t) ? t : null;
}

/**
 * 訓練で Claude に渡す文の町名 → 別名（T88。lib/pseudonym の pseudonymize の places）。本人役・通話・監督・講評・世界のどの入力でも、
 * 町名は（町名）でなく地区の別名にする（本人自身の町名も）。デモの地理は架空の町を全部、台帳から作った地理は台帳にある町名だけ
 * （「町名なし」と架空の「高台」は町名でないので入れない。「高台の避難所」を別名にしない）
 */
export function placesOf(area: Area, ledgers: ReadonlyArray<Pick<Ledger, "basic">>): Array<{ town: string; alias: string }> {
  const own = new Set(ledgers.map((l) => l.basic.address?.town?.trim()).filter((t): t is string => !!t));
  return area.towns.filter((t) => t.town !== NO_TOWN && (area === DEMO_AREA || own.has(t.town))).map((t) => ({ town: t.town, alias: t.alias }));
}

/** 事業所の本人たちの台帳から、地理（areaOf）と町名 → 別名（placesOf） */
export function officePlaces(officeId: string, ledgers: ReadonlyArray<Pick<Ledger, "basic" | "evacuation">>): Array<{ town: string; alias: string }> {
  return placesOf(
    areaOf(
      officeId,
      ledgers.map((ledger) => ({ ledger })),
    ),
    ledgers,
  );
}

/** 部屋の文の別名（甲地区）を町名に戻す（画面の文。サーバーの中だけ）。長い別名から（甲2地区 を 甲地区 より先に） */
export function restoreTowns(text: string, area: Area = DEMO_AREA): string {
  let out = text;
  for (const t of [...area.towns].sort((a, b) => b.alias.length - a.alias.length)) out = out.split(t.alias).join(t.town);
  return out;
}

/** 部屋に見せる地理の文（別名だけ。町名・人と町の結び付きを書かない） */
export function geographyText(area: Area = DEMO_AREA): string {
  const hazards = (t: AreaTown) =>
    [
      t.floodM != null ? `洪水 ${t.floodM} m の想定` : null,
      t.landslide ? "土砂災害の警戒区域" : null,
      t.tsunami ? "津波の浸水の想定" : null,
    ].filter(Boolean);
  const aliasOf = (town: string) => area.towns.find((t) => t.town === town)?.alias ?? town;
  return [
    `地区（${area.towns.length}）${area.river ? `。${area.river}が街を東から海へ流れる` : ""}:`,
    ...area.towns.map((t) => `- ${t.alias}: ${t.terrain}。${hazards(t).join("・") || "ハザードの想定なし"}。送電 ${t.grid}`),
    "主な道:",
    ...area.roads.map((r) => `- ${r.name}（${r.towns.map(aliasOf).join("・")}）`),
    "避難所:",
    ...area.shelters.map((s) => `- ${s.name}（${aliasOf(s.town)}${s.welfare ? "、福祉避難所" : ""}）`),
    "施設（本人たちが頼る所）:",
    ...(area.facilities.length > 0 ? area.facilities.map((f) => `- ${f.name}（${aliasOf(f.town)}、${f.kind}）`) : ["- なし"]),
  ].join("\n");
}

// ---------- 台帳から作る地理（デモ事業所でない事業所、T70） ----------

/** 台帳に町名の無い人をまとめる町（画面の言葉。部屋には別名だけ） */
export const NO_TOWN = "町名なし";
/** 台帳に無い架空の町（避難所・福祉避難所・施設の置き場） */
export const HIGHLAND = "高台";

const ALIAS_HEADS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
const GRIDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

/** i 番目の別名（甲地区…癸地区、10 を超えたら 甲2地区…） */
export function aliasAt(i: number): string {
  const round = Math.floor(i / ALIAS_HEADS.length);
  return `${ALIAS_HEADS[i % ALIAS_HEADS.length]}${round > 0 ? round + 1 : ""}地区`;
}

/** 町 3 つずつの送電の区分（A 系統・B 系統…） */
function gridAt(i: number): string {
  return `${GRIDS[Math.floor(i / 3) % GRIDS.length]} 系統`;
}

/** 地理を作る本人 1 人（台帳と、頼り先の時計・訪問看護の有無） */
export type AreaPerson = {
  ledger: Pick<Ledger, "basic" | "evacuation">;
  depends?: ReadonlyArray<DependsOn>;
  nurse?: boolean;
};

/** 頼り先の時計 → 施設（頼る人がいる物だけ置く） */
const DEPEND_FACILITIES: ReadonlyArray<{ depends: DependsOn; id: string; name: string; kind: string }> = [
  { depends: "dialysis_center", id: "dialysis", name: "透析施設", kind: "透析施設" },
  { depends: "refrigeration", id: "pharmacy", name: "冷蔵の薬の薬局", kind: "薬局" },
  { depends: "delivery", id: "delivery", name: "配達の拠点", kind: "配達" },
];

/** 町の人のハザードから地形の一言（部屋に見せる） */
function terrainOf(floodM: number | null, flood: boolean, landslide: boolean, tsunami: boolean): string {
  const parts = [
    floodM != null ? `浸水 ${floodM} m の想定の低い土地` : flood ? "浸水の想定のある土地" : null,
    landslide ? "裏に急な斜面" : null,
    tsunami ? "海に近い" : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join("。") : "想定なし";
}

/**
 * 事業所の地理。デモ事業所（DEMO_OFFICE_ID）は T50 の架空の街のまま（DEMO_AREA）。
 * ほかの事業所は参加者の台帳の町名ごとに町を作る（町名の無い人は「町名なし」の 1 町）: 別名は町名の順に 甲地区・乙地区…、
 * 地形はその町の人のハザード（浸水の最大の深さ・土砂・津波）の一言、送電は 3 町ずつ。架空の町「高台」を 1 つ足し、
 * 避難所・福祉避難所・施設を置く。道は町ごとに 1 本（「甲地区の道」）と高台への坂道。施設は頼る人がいる物だけ
 * （透析先・冷蔵・配達の時計、訪問看護の連絡先）。部屋に見せるのは別名と地理の一言だけ（町名と本人の結び付きはコードだけが持つ）
 */
export function areaOf(officeId: string, people: ReadonlyArray<AreaPerson>): Area {
  if (officeId === DEMO_OFFICE_ID) return DEMO_AREA;
  const byTown = new Map<string, AreaPerson[]>();
  for (const p of people) {
    const t = p.ledger.basic.address?.town?.trim() || NO_TOWN;
    byTown.set(t, [...(byTown.get(t) ?? []), p]);
  }
  const names = [...byTown.keys()].sort((a, b) => (a === NO_TOWN ? 1 : b === NO_TOWN ? -1 : a.localeCompare(b, "ja")));
  // 架空の町は台帳の町名と重ならない名前に
  let highland: string = HIGHLAND;
  while (byTown.has(highland)) highland = `${highland}の町`;
  const towns: AreaTown[] = names.map((town, i) => {
    const hz = byTown.get(town)!.flatMap((p) => p.ledger.evacuation.hazards);
    const depths = hz.filter((h) => h.kind === "flood" && h.depthM != null).map((h) => h.depthM!);
    const floodM = depths.length > 0 ? Math.max(...depths) : null;
    const flood = hz.some((h) => h.kind === "flood");
    const landslide = hz.some((h) => h.kind === "landslide");
    const tsunami = hz.some((h) => h.kind === "tsunami");
    return { town, alias: aliasAt(i), terrain: terrainOf(floodM, flood, landslide, tsunami), floodM, landslide, tsunami, grid: gridAt(i) };
  });
  towns.push({
    town: highland,
    alias: aliasAt(names.length),
    terrain: "高台の住宅地",
    floodM: null,
    landslide: false,
    tsunami: false,
    grid: gridAt(names.length),
  });
  const roads: AreaRoad[] = [
    ...towns.slice(0, -1).map((t, i) => ({ id: `town-${i + 1}`, name: `${t.alias}の道`, towns: [t.town] })),
    { id: "slope", name: "高台への坂道", towns: [highland] },
  ];
  const shelters: AreaShelter[] = [
    { id: "hill-shelter", name: "高台の避難所", town: highland, welfare: false },
    { id: "welfare-home", name: "福祉避難所", town: highland, welfare: true },
  ];
  const depends = new Set(people.flatMap((p) => p.depends ?? []));
  const facilities: AreaFacility[] = [
    ...DEPEND_FACILITIES.filter((f) => depends.has(f.depends)).map((f) => ({ id: f.id, name: f.name, town: highland, depends: f.depends, kind: f.kind })),
    ...(people.some((p) => p.nurse) ? [{ id: "nurse", name: "訪問看護ステーション", town: highland, depends: null, kind: "訪問看護" }] : []),
  ];
  return { river: null, towns, roads, shelters, facilities };
}
