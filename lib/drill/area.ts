// 仮想モード（docs/tasks/T50.md）の事業所の地理（コードの種。Claude を呼ばない）。人は架空のまま、地理は実の物（T170）。
//
// - デモ事業所は松山市の実の区画（lib/drill/area-demo.ts。川・標高・ハザードは地理院の注記と重ねるハザードマップで確かめた物）。
//   人は台帳の町名（種の架空の町名）でなくピンの位置で区画に入る（townOfLedger）。台帳の町名は変えない
// - ほかの事業所は参加者の台帳の町名から作る（areaOf、T70）。開始の時に読んだ公的なデータ（lib/drill/real-geo.ts）があれば実の川と避難所を足す
// - Claude（世界の部屋・1 回呼び）には町名も区画の実の言葉も渡さない。部屋には区画ごとの別名（甲地区・乙地区…）と地理の事実だけを見せ、
//   別名 → 区画 → そこに住む本人の結び付きはコードだけが持つ（部屋が知るのは「甲地区は標高 14〜18 m で洪水 3〜10 m の想定」のような地理の事実と、
//   本人の仮名と弱点。誰がどの地区かは知らない）。門は lib/pseudonym の places（placesOf）
// - 実の名前を渡すのは川・橋・指定避難所まで。透析先などの施設は種の架空の名前のまま
// - 道路は通る地区、施設は頼る時計の区分（透析施設 → 透析の時計の人）で人に当てる（lib/drill/world-apply.ts）

import { isSeedOfficeId } from "../auth/demo.ts";
import type { DependsOn, GeoPoint, Ledger } from "../db/types.ts";
import { DEMO_FACILITIES, DEMO_REGION, DEMO_RIVERS, DEMO_ROADS, DEMO_TOWNS, RETIRED_DEMO_NAMES } from "./area-demo.ts";
import { applyRealGeo, type RealGeo } from "./real-geo-apply.ts";

export { RETIRED_DEMO_NAMES };

/**
 * 区画 1 つ。town は区画の鍵で画面の言葉（デモは実の地名「市坪・井門付近」、ほかの事業所は台帳の町名）。alias は部屋に見せる別名。
 * Claude には alias だけ（town と homes は lib/pseudonym の places で別名に置き換わる）
 */
export type AreaTown = {
  town: string;
  alias: string;
  /** 地形の一言（部屋に見せる。確かめた事だけ） */
  terrain: string;
  /** 洪水の浸水の想定（m）。無ければ null */
  floodM: number | null;
  landslide: boolean;
  tsunami: boolean;
  /** ハザードの言い方（層で確かめた帯。部屋に見せる）。無ければ floodM などから作る */
  hazardWords?: string;
  /** この区画に落ちる台帳の町名（入力の伏せ字と停電の突き合わせ）。無ければ town と同じ */
  homes?: ReadonlyArray<string>;
  /** 区画の真ん中（地図の印。部屋に渡さない） */
  at?: GeoPoint;
};

export type AreaRoad = { id: string; name: string; towns: string[]; at?: GeoPoint };
export type AreaShelter = { id: string; name: string; town: string; welfare: boolean; at?: GeoPoint };
export type AreaFacility = { id: string; name: string; town: string; depends: DependsOn | null; kind: string };

/**
 * デモ事業所の区域（T125。offices.hazards が NULL のデモ事業所に訓練の開始の時に写す）。事業所の真ん中（33.84, 132.765）は重ねるハザードマップの
 * 洪水 0.5〜3 m の区域（T170 で確かめた）。種の行に列を足さない（migration 0030 の前の D1 に種を入れられなくなるため）のでコードに持つ。
 * 大雨の警戒レベル（避難指示）は事業所も対象、深い所（3 m 以上）の川の氾濫・津波・土砂は対象外。津波の区域ではないので職員の退避は起きない
 */
export const DEMO_OFFICE_ZONES: ReadonlyArray<{ kind: "flood"; depthM: number }> = [{ kind: "flood", depthM: 0.5 }];

/** 事業所の地理 1 つ（デモ事業所は実の区画、ほかの事業所は台帳の町名から作る。T70・T170） */
export type Area = {
  /** 地域の名前（市。部屋に見せる）。無ければ地域の行を書かない */
  region?: string;
  /** 実の川の名前（部屋に見せる）。無ければ川の行を書かない */
  rivers: ReadonlyArray<string>;
  towns: ReadonlyArray<AreaTown>;
  roads: ReadonlyArray<AreaRoad>;
  shelters: ReadonlyArray<AreaShelter>;
  facilities: ReadonlyArray<AreaFacility>;
  /** 人をピンの位置で区画に入れる（デモ事業所。台帳の町名が架空なので）。無ければ台帳の町名で */
  byPin?: true;
  /** 実の避難所の名前を使っている（画面の出典を出す） */
  realShelters?: true;
};

/** デモ事業所の地理（松山市の実の区画。避難所は一般の言い方。開始の時に読めれば実の名前に。T170） */
export const DEMO_AREA: Area = {
  region: DEMO_REGION,
  rivers: DEMO_RIVERS,
  towns: DEMO_TOWNS,
  roads: DEMO_ROADS,
  shelters: [
    ...DEMO_TOWNS.map((t, i): AreaShelter => ({ id: `district-${i + 1}`, name: `${t.alias}の避難所`, town: t.town, welfare: false, ...(t.at ? { at: t.at } : {}) })),
    { id: "welfare-home", name: "福祉避難所", town: DEMO_TOWNS[DEMO_TOWNS.length - 1].town, welfare: true },
  ],
  facilities: DEMO_FACILITIES,
  byPin: true,
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

/** 区画の言葉か台帳の町名 → 区画。無ければ null */
export function areaTown(town: string | null | undefined, area: Area = DEMO_AREA): AreaTown | null {
  const v = town?.trim();
  return v ? (area.towns.find((t) => t.town === v) ?? area.towns.find((t) => t.homes?.includes(v)) ?? null) : null;
}

/** ピンがこの長さ（km）より遠ければ、どの区画にも入れない（台帳の町名で引く） */
export const DISTRICT_MAX_KM = 8;

/** 2 点の長さ（km。区画の広さの目安なので平面で） */
export function kmBetween(a: GeoPoint, b: GeoPoint): number {
  const x = (b.lng - a.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  const y = (b.lat - a.lat) * 111.32;
  return Math.hypot(x, y);
}

/** ピンの位置 → いちばん近い区画（真ん中のある区画だけ）。遠すぎれば null */
export function townOfPin(at: GeoPoint, area: Area): AreaTown | null {
  let best: AreaTown | null = null;
  let bestKm = DISTRICT_MAX_KM;
  for (const t of area.towns) {
    if (!t.at) continue;
    const km = kmBetween(at, t.at);
    if (km <= bestKm) {
      best = t;
      bestKm = km;
    }
  }
  return best;
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
 * 本人の区画（区画の鍵）。デモの地理はピンの位置で（ピンが無い・遠すぎる人は台帳の町名で）、台帳から作った地理は台帳の町名で、町名の無い人は
 * 「町名なし」の町に。地理に無ければ null。コードだけが使う（部屋に渡さない）
 */
export function townOfLedger(ledger: Pick<Ledger, "basic">, area: Area = DEMO_AREA): string | null {
  const at = ledger.basic.location;
  if (area.byPin && at) {
    const near = townOfPin(at, area);
    if (near) return near.town;
  }
  const t = ledger.basic.address?.town?.trim() || NO_TOWN;
  return areaTown(t, area)?.town ?? null;
}

/**
 * 訓練で Claude に渡す文の町名 → 別名（T88。lib/pseudonym の pseudonymize の places）。本人役・通話・監督・講評・世界のどの入力でも、
 * 町名は（町名）でなく地区の別名にする（本人自身の町名も）。デモの地理は区画の実の言葉と種の町名を全部（別名は画面で実の言葉に戻す。T170）、
 * 台帳から作った地理は台帳にある町名だけ（「町名なし」と「高台」は町名でないので入れない。「高台の避難所」を別名にしない）
 */
export function placesOf(area: Area, ledgers: ReadonlyArray<Pick<Ledger, "basic">>): Array<{ town: string; alias: string; shown?: string }> {
  const own = new Set(ledgers.map((l) => l.basic.address?.town?.trim()).filter((t): t is string => !!t));
  return area.towns.flatMap((t) => {
    if (t.town === NO_TOWN) return [];
    if (!area.byPin) return own.has(t.town) ? [{ town: t.town, alias: t.alias }] : [];
    return [t.town, ...(t.homes ?? [])].map((town) => ({ town, alias: t.alias, shown: t.town }));
  });
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

/** 部屋の文の別名（甲地区）を区画の言葉に戻す（画面の文。サーバーの中だけ）。長い別名から（甲2地区 を 甲地区 より先に） */
export function restoreTowns(text: string, area: Area = DEMO_AREA): string {
  let out = text;
  for (const t of [...area.towns].sort((a, b) => b.alias.length - a.alias.length)) out = out.split(t.alias).join(t.town);
  return out;
}

/** 部屋に見せる地理の文（別名だけ。町名・区画の実の言葉・人と区画の結び付きを書かない） */
export function geographyText(area: Area = DEMO_AREA): string {
  const hazards = (t: AreaTown) =>
    t.hazardWords ??
    ([t.floodM != null ? `洪水 ${t.floodM} m の想定` : null, t.landslide ? "土砂災害の警戒区域" : null, t.tsunami ? "津波の浸水の想定" : null].filter(Boolean).join("・") ||
      "ハザードの想定なし");
  const aliasOf = (town: string) => area.towns.find((t) => t.town === town)?.alias ?? town;
  return [
    ...(area.region ? [`地域: ${area.region}（実在の地域。川・橋・避難所の名前は実物で、出来事は訓練の想定）`] : []),
    ...(area.rivers.length > 0 ? [`地域の川: ${area.rivers.join("・")}`] : []),
    `地区（${area.towns.length}）:`,
    ...area.towns.map((t) => `- ${t.alias}: ${t.terrain}。${hazards(t)}`),
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
/** 台帳に無い一般の町（避難所・福祉避難所・施設の置き場。実の避難所が読めれば避難所は実の名前に） */
export const HIGHLAND = "高台";

const ALIAS_HEADS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;

/** i 番目の別名（甲地区…癸地区、10 を超えたら 甲2地区…） */
export function aliasAt(i: number): string {
  const round = Math.floor(i / ALIAS_HEADS.length);
  return `${ALIAS_HEADS[i % ALIAS_HEADS.length]}${round > 0 ? round + 1 : ""}地区`;
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
 * 事業所の地理。デモ事業所と確認用の事業所（種の事業所、T144）は松山市の実の区画（DEMO_AREA）。
 * ほかの事業所は参加者の台帳の町名ごとに町を作る（町名の無い人は「町名なし」の 1 町）: 別名は町名の順に 甲地区・乙地区…、
 * 地形はその町の人のハザード（浸水の最大の深さ・土砂・津波）の一言。一般の町「高台」を 1 つ足し、
 * 避難所・福祉避難所・施設を置く。道は町ごとに 1 本（「甲地区の道」）と高台への坂道。施設は頼る人がいる物だけ
 * （透析先・冷蔵・配達の時計、訪問看護の連絡先）。部屋に見せるのは別名と地理の一言だけ（町名と本人の結び付きはコードだけが持つ）。
 * geo（開始の時に読んだ公的なデータ。drills.world の写し）があれば、実の川と避難所の名前を足す（T170）
 */
export function areaOf(officeId: string, people: ReadonlyArray<AreaPerson>, geo?: RealGeo | null): Area {
  if (isSeedOfficeId(officeId)) return applyRealGeo(DEMO_AREA, geo, []);
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
    // 町の真ん中（地図の印と、実の川・避難所を近い町に当てる。ピンのある人だけで。部屋に渡さない）
    const pins = byTown.get(town)!.flatMap((p) => (p.ledger.basic.location ? [p.ledger.basic.location] : []));
    const at = pins.length > 0 ? { lat: pins.reduce((n, x) => n + x.lat, 0) / pins.length, lng: pins.reduce((n, x) => n + x.lng, 0) / pins.length } : null;
    return { town, alias: aliasAt(i), terrain: terrainOf(floodM, flood, landslide, tsunami), floodM, landslide, tsunami, ...(at ? { at } : {}) };
  });
  towns.push({
    town: highland,
    alias: aliasAt(names.length),
    terrain: "高台の住宅地",
    floodM: null,
    landslide: false,
    tsunami: false,
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
  const own = names.filter((n) => n !== NO_TOWN);
  return applyRealGeo({ rivers: [], towns, roads, shelters, facilities }, geo, own);
}
