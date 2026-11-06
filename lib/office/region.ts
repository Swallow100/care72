// 事業所の地域（docs/tasks/T148.md の 2）。T68 の「市 1 つ＋中心」を、主な市＋周りの市・中心・広さ・事業所の区域にした。
// 主な市は offices.city、周りの市は offices.region_cities（JSON の配列、migration 0036）、広さは offices.region_km、
// 区域は offices.hazards（0030）。置くのは事業所の画面の「地域」の区分（components/office/OfficePlace.tsx、保存は lib/office/place.ts）。
//
// その地域が次にそろって効く（どれもここの関数を通す）:
// - 気象庁の警報・注意報の欄（lib/jma/alerts.ts の loadJmaAlerts。主な市 → 周りの市 → 利用者の住所の市の順）
// - 上の帯の警報の数（lib/jma/alerts.ts の loadRegionWarnings、components/AppHeader.tsx）
// - 地図の中心と広さ（mapRegionOf → lib/map/region.ts の regionView。ピンが無いときの初めの表示と「地域」の表示。雨雲はその表示の上に重なる）
// - 事業所の区域（offices.hazards。訓練の区域の出来事、lib/drill/db.ts の officeZonesOf）
// - 様式の一覧の「地域から選ぶ」の初めの市（lib/forms/municipal-forms.ts の cityForRegion に regionCitiesOf を渡す）
// - 利用者の住所の市で地域に入っていない市の「地域に追加」（citySuggestions）
// 気象庁の情報は見せるだけで、色と連絡順（lib/triage）と災害モードには使わない。
// ブラウザからも読まれうる（lib/office/setup.ts → place.ts → ここ）ので、重い物（lib/drill/db.ts・様式の一覧のデータ）は読まない。
// 事業所の区域の読み方は訓練の lib/drill/db.ts の officeZonesOf と同じ（テストで照らす）。

import { isSeedOfficeId } from "../auth/demo.ts";
import { HAZARD_KINDS, type GeoPoint, type HazardKind } from "../db/types.ts";
import { DEMO_OFFICE_ZONES } from "../drill/area.ts";
import type { OfficeZone } from "../drill/comms.ts";
import { sameCity, uniqueCities } from "../jma/match.ts";
import type { MapRegion } from "../map/region.ts";

/** 地図の広さ（中心からの km）の選択肢 */
export const REGION_KMS = [5, 10, 20, 40] as const;
export type RegionKm = (typeof REGION_KMS)[number];
/** 広さが自動のとき: 周りの市が無ければ 10 km、あれば 20 km */
export const REGION_KM_AUTO = { single: 10, many: 20 } as const;
/** 周りの市の数の上限 */
export const REGION_CITY_MAX = 8;
/** 市の名前の長さの上限（字。lib/office/place.ts の CITY_MAX と同じ） */
export const REGION_CITY_NAME_MAX = 20;

/** 事業所の区域で選べる種類（その他は事業所の区域に使わない） */
export const OFFICE_ZONE_KINDS = ["flood", "landslide", "tsunami"] as const satisfies readonly HazardKind[];
/** 浸水の深さの選択肢（m。ハザードマップの段の下の端） */
export const FLOOD_DEPTHS = [0.5, 3, 5, 10] as const;

export const isRegionKm = (v: unknown): v is RegionKm => typeof v === "number" && (REGION_KMS as readonly number[]).includes(v);

/** 周りの市の JSON を読む（空・重なり・主な市と同じ物は落とす）。読めなければ空 */
export function parseRegionCities(text: string | null | undefined, main = ""): string[] {
  if (!text) return [];
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return uniqueCities([main, ...v.filter((c): c is string => typeof c === "string")]).filter((c) => c !== main.trim());
}

/** 地域の市の並び（主な市が先、次に周りの市）。主な市が空なら周りの市だけ */
export function regionCitiesOf(o: { city: string | null | undefined; region_cities: string | null | undefined }): string[] {
  return uniqueCities([o.city ?? "", ...parseRegionCities(o.region_cities, o.city ?? "")]);
}

/** 広さ（km）。置いていなければ自動（周りの市が無ければ 10、あれば 20） */
export function regionKmOf(km: number | null | undefined, cityCount: number): number {
  if (isRegionKm(km)) return km;
  return cityCount > 1 ? REGION_KM_AUTO.many : REGION_KM_AUTO.single;
}

/** 地図に渡す地域（中心と広さ）。中心が無ければ null（地図は前からの既定の真ん中） */
export function mapRegionOf(o: { center: GeoPoint | null; cities: readonly string[]; km: number | null }): MapRegion | null {
  return o.center ? { center: o.center, km: regionKmOf(o.km, o.cities.length) } : null;
}

/** 2 つの市の名前が同じ市か（区のある市は「○○市○○区」も同じ市。気象庁の欄の突き合わせ lib/jma/match.ts と同じ決まり） */
function sameRegionCity(a: string, b: string): boolean {
  return sameCity(a, b) || sameCity(b, a);
}

export type CityCount = { city: string; count: number };

/** 利用者の住所の市で、地域（主な市・周りの市）に入っていない市（人数の多い順 → 名前の順） */
export function citySuggestions(region: readonly string[], people: readonly CityCount[]): CityCount[] {
  const out = new Map<string, number>();
  for (const p of people) {
    const c = p.city.trim();
    if (!c || region.some((r) => sameRegionCity(r, c))) continue;
    out.set(c, (out.get(c) ?? 0) + p.count);
  }
  return [...out.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "ja"));
}

/**
 * 事業所の区域（offices.hazards の JSON）を読む。訓練の lib/drill/db.ts の officeZonesOf と同じ読み方（種類の分かる物だけ・種類ごとに 1 つ・
 * 深さは数のときだけ。種の事業所〔デモ事業所と確認用の事業所、T144〕の NULL はコードの区域 DEMO_OFFICE_ZONES、ほかの NULL・読めない物は区域なし）
 */
export function officeZonesFrom(text: string | null | undefined, officeId?: string): OfficeZone[] {
  if (!text) return isSeedOfficeId(officeId) ? DEMO_OFFICE_ZONES.map((z) => ({ ...z })) : [];
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const known = (k: unknown): k is HazardKind => (HAZARD_KINDS as readonly unknown[]).includes(k);
  const out = new Map<HazardKind, OfficeZone>();
  for (const h of v) {
    if (typeof h === "string" && known(h)) out.set(h, { kind: h, depthM: null });
    else if (h && typeof h === "object" && known((h as { kind?: unknown }).kind)) {
      const z = h as { kind: HazardKind; depthM?: unknown };
      if (!out.has(z.kind)) out.set(z.kind, { kind: z.kind, depthM: typeof z.depthM === "number" && Number.isFinite(z.depthM) ? z.depthM : null });
    }
  }
  return [...out.values()];
}

/** 事業所の区域の JSON（offices.hazards）。区域なしは "[]"（NULL の「まだ無い」と分ける。デモ事業所の NULL は架空の街の区域） */
export function zonesJson(zones: readonly OfficeZone[]): string {
  return JSON.stringify(zones.map((z) => (z.kind === "flood" && z.depthM != null ? { kind: z.kind, depthM: z.depthM } : { kind: z.kind })));
}

// 事業所の地域の読み込み（loadOfficeRegion）は T154 で lib/office/area.ts へ移した（全国の市区町村の表で当てるため。ここは画面からも読まれるので表を読まない）。
