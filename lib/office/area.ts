// 事業所の地域を全国の市区町村の表（lib/municipality）で決める 1 つの関数（docs/tasks/T154.md の 3）。サーバーだけ（表の位置と様式の一覧を読む）。
//
// 入れる物: offices の行（主な市の団体コード city_code・周りの市の団体コード region_city_codes〔migration 0038〕、前からの文字 city・
// region_cities〔T68・T148〕、中心 center_lat・center_lng、広さ region_km、所在地 address）。
// 出す物（どれもここから。ほかの所で市の名前から別々に決めない）:
// - 気象庁の欄・上の帯の警報・cron の写す所: 市町村等のコード（jmaCodes。主な市 → 周りの市の順）。lib/jma/alerts.ts・store.ts
// - 地図の中心と広さ（map）: 中心は事業所の中心、無ければ主な市の代表の点。広さは置いた km、無ければ地域の市の範囲が入る km（5 km 刻み）。
//   ピンが無い地図の初めの表示と「地域」の表示、その上の雨雲（lib/map/region.ts）
// - 様式の一覧の「地域から選ぶ」の初めの市（formsCityId。都道府県と名前で一覧の市に当てる）
// - 利用者の住所の市の内外（peopleCities: 地域に追加の候補と、表に当たらない住所）
// 文字の値の写し: 団体コードがあればそれ。無ければ文字を表で当てる（主な市は所在地の都道府県、周りの市は主な市の都道府県を手がかりに。
// lib/municipality/names.ts の resolveCityName）。当たらない文字は unmatched に残し、画面は「未選択」「未照合」で選び直しを促す。
// 気象庁の情報は見せるだけで、色と連絡順（lib/triage）と災害モードには使わない。

import type { D1Database } from "@cloudflare/workers-types";
import type { GeoPoint } from "../db/types.ts";
import type { OfficeZone } from "../drill/comms.ts";
import { MUNICIPAL_CITIES } from "../forms/municipal-forms-data.ts";
import { uniqueCities } from "../jma/match.ts";
import type { MapRegion } from "../map/region.ts";
import { municipalityGeo, type MunicipalityGeo } from "../municipality/geo.ts";
import { matchCity, municipalityByCode, municipalityOfAddress, sameArea, splitPref, type Municipality } from "../municipality/names.ts";
import { isRegionKm, OFFICE_ZONE_KINDS, officeZonesFrom, parseRegionCities, REGION_KM_AUTO, type RegionKm } from "./region.ts";

/** 自動の広さの刻みと上限（km） */
export const AREA_KM_STEP = 5;
export const AREA_KM_MAX = 60;

export type OfficeAreaRow = {
  city: string | null;
  city_code?: string | null;
  region_cities: string | null;
  region_city_codes?: string | null;
  center_lat: number | null;
  center_lng: number | null;
  region_km: number | null;
  address?: string | null;
};

export type AreaCity = Municipality & { geo: MunicipalityGeo | null };

export type OfficeArea = {
  /** 主な市（表の行）。当たらなければ null（未選択） */
  main: AreaCity | null;
  /** 主な市の団体コードが保存されているか（false は文字から当てた・未選択） */
  mainSaved: boolean;
  /** 主な市の前からの文字（当たらないときの表示） */
  mainText: string;
  /** 周りの市（表の行。主な市と同じ物・重なりは外す） */
  others: AreaCity[];
  /** 表に当たらない周りの市の文字（未照合） */
  unmatched: string[];
  /** 地域の市の名前（主な市 → 周りの市。当たった物は表の名前、当たらない物は文字のまま） */
  cities: string[];
  /** 気象庁の市町村等のコード（主な市 → 周りの市の順、重ねない） */
  jmaCodes: string[];
  /** 主な市の都道府県（ほかの文字を当てる手がかり） */
  pref: string | null;
  center: GeoPoint | null;
  /** 置いた広さ（null は自動） */
  kmSet: RegionKm | null;
  /** 地図に使う広さ（自動を当てた物） */
  km: number;
  /** 地図の地域（中心が無ければ null） */
  map: MapRegion | null;
  /** 様式の一覧の「地域から選ぶ」の初めの市（一覧の市の id。無ければ null） */
  formsCityId: string | null;
};

const withGeo = (m: Municipality): AreaCity => ({ ...m, geo: municipalityGeo(m.code) });

function parseCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/** 地域の市の範囲がみな入る広さ（中心から。5 km 刻み、60 km まで）。範囲が無ければ null */
export function kmCovering(center: GeoPoint, cities: readonly AreaCity[]): number | null {
  const boxes = cities.flatMap((c) => (c.geo ? [c.geo.box] : []));
  if (boxes.length === 0) return null;
  const s = Math.min(...boxes.map((b) => b.s));
  const n = Math.max(...boxes.map((b) => b.n));
  const w = Math.min(...boxes.map((b) => b.w));
  const e = Math.max(...boxes.map((b) => b.e));
  const kmLat = 111.32;
  const kmLng = 111.32 * Math.cos((center.lat * Math.PI) / 180);
  const need = Math.max((n - center.lat) * kmLat, (center.lat - s) * kmLat, (e - center.lng) * kmLng, (center.lng - w) * kmLng, 0);
  return Math.min(AREA_KM_MAX, Math.max(AREA_KM_STEP, Math.ceil(need / AREA_KM_STEP) * AREA_KM_STEP));
}

/** 様式の一覧の市（都道府県と名前が同じ市。区の行は市でも探す） */
function formsCityOf(cities: readonly Municipality[]): string | null {
  for (const m of cities) {
    const names = [m.name, ...(m.parent ? [municipalityByCode(m.parent)?.name ?? ""] : [])];
    for (const n of names) {
      const hit = MUNICIPAL_CITIES.find((c) => c.pref === m.pref && c.name === n && c.forms.length > 0);
      if (hit) return hit.id;
    }
  }
  return null;
}

/** 事業所の地域（このファイルの頭の決まり） */
export function officeAreaOf(row: OfficeAreaRow): OfficeArea {
  const mainText = (row.city ?? "").trim();
  const saved = municipalityByCode(row.city_code);
  const addrPref = row.address ? splitPref(row.address).pref : null;
  const mainM = saved ?? matchCity(mainText, addrPref ?? municipalityOfAddress(row.address)?.pref ?? null);
  const pref = mainM?.pref ?? addrPref;

  const others: Municipality[] = [];
  const unmatched: string[] = [];
  const codes = parseCodes(row.region_city_codes);
  if (row.region_city_codes != null) {
    for (const c of codes) {
      const m = municipalityByCode(c);
      if (m) others.push(m);
    }
    // 団体コードの無い文字（表に当たらなかった前の形の文字）は未照合のまま残す
    for (const t of parseRegionCities(row.region_cities, mainText)) if (!others.some((m) => m.name === t)) unmatched.push(t);
  } else {
    for (const t of parseRegionCities(row.region_cities, mainText)) {
      const m = matchCity(t, pref);
      if (m) others.push(m);
      else unmatched.push(t);
    }
  }
  const uniq: Municipality[] = [];
  for (const m of [...(mainM ? [mainM] : []), ...others]) if (!uniq.some((u) => u.code === m.code)) uniq.push(m);
  const main = mainM ? withGeo(mainM) : null;
  const rest = uniq.filter((m) => m.code !== mainM?.code).map(withGeo);
  const all = [...(main ? [main] : []), ...rest];

  const center =
    row.center_lat != null && row.center_lng != null ? { lat: row.center_lat, lng: row.center_lng } : (main?.geo?.point ?? null);
  const kmSet = isRegionKm(row.region_km) ? row.region_km : null;
  const cities = uniqueCities([main ? main.name : mainText, ...rest.map((m) => m.name), ...unmatched]);
  const auto = center ? kmCovering(center, all) : null;
  const km = kmSet ?? auto ?? (cities.length > 1 ? REGION_KM_AUTO.many : REGION_KM_AUTO.single);
  return {
    main,
    mainSaved: saved !== null,
    mainText,
    others: rest,
    unmatched,
    cities,
    jmaCodes: [...new Set(all.flatMap((c) => c.geo?.jmaCodes ?? []))],
    pref,
    center,
    kmSet,
    km,
    map: center ? { center, km } : null,
    formsCityId: formsCityOf(all),
  };
}

export type CityCount = { city: string; count: number };
export type PeopleCity = CityCount & { municipality: Municipality | null };

/** 利用者の住所の市を表で当てる（手がかりは事業所の主な市の都道府県）。当たった物は同じ団体で 1 つにまとめる */
export function peopleCitiesOf(area: Pick<OfficeArea, "pref">, people: readonly CityCount[]): PeopleCity[] {
  const out = new Map<string, PeopleCity>();
  for (const p of people) {
    const city = p.city.trim();
    if (!city) continue;
    const m = matchCity(city, area.pref);
    const key = m ? m.code : `text:${city}`;
    const cur = out.get(key);
    if (cur) cur.count += p.count;
    else out.set(key, { city: m ? m.name : city, count: p.count, municipality: m });
  }
  return [...out.values()];
}

export type AreaSuggestion = { code: string; city: string; label: string; count: number };

/**
 * 利用者の住所の市で地域の外の物（地域に追加の候補。人数の多い順 → 団体コードの順）と、表に当たらない住所（未照合。人数の多い順 → 名前の順）。
 * 区と市は同じ地域に数える（広島市を選べば広島市中区の人は中）
 */
export function areaSuggestions(area: Pick<OfficeArea, "main" | "others" | "pref">, people: readonly CityCount[]): { add: AreaSuggestion[]; unmatched: CityCount[] } {
  const inside = [...(area.main ? [area.main] : []), ...area.others];
  const add: AreaSuggestion[] = [];
  const unmatched: CityCount[] = [];
  for (const p of peopleCitiesOf(area, people)) {
    if (!p.municipality) unmatched.push({ city: p.city, count: p.count });
    else if (!inside.some((m) => sameArea(m, p.municipality!))) {
      add.push({ code: p.municipality.code, city: p.municipality.name, label: `${p.municipality.pref}${p.municipality.name}`, count: p.count });
    }
  }
  add.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  unmatched.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "ja"));
  return { add, unmatched };
}

/** 利用者の住所の市の気象庁の市町村等のコード（当たった物だけ）と、当たらない市の名前（名前で突き合わせる） */
export function peopleJmaOf(area: Pick<OfficeArea, "pref">, people: readonly CityCount[]): { codes: string[]; names: string[] } {
  const ps = peopleCitiesOf(area, people);
  return {
    codes: [...new Set(ps.flatMap((p) => (p.municipality ? (municipalityGeo(p.municipality.code)?.jmaCodes ?? []) : [])))],
    names: ps.filter((p) => !p.municipality).map((p) => p.city),
  };
}

/** offices の地域の列（読む SQL の列の並び） */
export const OFFICE_AREA_COLUMNS = "city, city_code, region_cities, region_city_codes, center_lat, center_lng, region_km, address";

export type OfficeRegion = {
  /** 主な市の名前（表の名前。当たらなければ前からの文字） */
  city: string;
  /** 主な市の団体コード（表に当たらなければ null = 未選択） */
  cityCode: string | null;
  /** 主な市の団体コードが保存済みか（false は文字から当てた・未選択。保存で写す） */
  citySaved: boolean;
  /** 主な市の都道府県 */
  pref: string | null;
  /** 周りの市の名前と団体コード（主な市は入れない） */
  others: string[];
  otherCodes: string[];
  /** 表に当たらない周りの市の文字（未照合） */
  unmatched: string[];
  /** 地域の市の並び（主な市が先） */
  cities: string[];
  /** 地図の中心（事業所の中心。無ければ主な市の代表の点） */
  center: GeoPoint | null;
  /** 置いた広さ（null は自動） */
  km: RegionKm | null;
  /** 地図に使う広さ（自動を当てた物） */
  kmUsed: number;
  /** 事業所の区域（デモ事業所の NULL はコードの区域 DEMO_OFFICE_ZONES） */
  zones: OfficeZone[];
  /** 利用者の住所の市で、地域に入っていない市（地域に追加の候補） */
  suggestions: AreaSuggestion[];
  /** 利用者の住所の市で表に当たらない物（未照合） */
  unmatchedPeople: CityCount[];
};

/** 事業所の地域（区分の表示と保存の既定。T148 の形に T154 の団体コードを足した）。事業所が無ければ null */
export async function loadOfficeRegion(db: D1Database, officeId: string): Promise<OfficeRegion | null> {
  const [office, people] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${OFFICE_AREA_COLUMNS}, hazards FROM offices WHERE id = ?1`).bind(officeId),
    db
      .prepare(
        "SELECT json_extract(ledger, '$.basic.address.city') AS city, count(*) AS n FROM people WHERE office_id = ?1 AND unlisted_at IS NULL GROUP BY 1",
      )
      .bind(officeId),
  ]);
  const row = office.results[0] as (OfficeAreaRow & { hazards: string | null }) | undefined;
  if (!row) return null;
  const area = officeAreaOf(row);
  const s = areaSuggestions(area, peopleCounts(people.results));
  return {
    city: area.main?.name ?? area.mainText,
    cityCode: area.main?.code ?? null,
    citySaved: area.mainSaved,
    pref: area.pref,
    others: [...area.others.map((o) => o.name), ...area.unmatched],
    otherCodes: area.others.map((o) => o.code),
    unmatched: area.unmatched,
    cities: area.cities,
    center: area.center,
    km: area.kmSet,
    kmUsed: area.km,
    zones: officeZonesFrom(row.hazards, officeId).filter((z) => (OFFICE_ZONE_KINDS as readonly string[]).includes(z.kind)),
    suggestions: s.add,
    unmatchedPeople: s.unmatched,
  };
}

/** 利用者の住所の市ごとの人数の行（SQL の city・n）を読む */
export function peopleCounts(rows: ReadonlyArray<Record<string, unknown>>): CityCount[] {
  return rows.map((r) => ({ city: typeof r.city === "string" ? r.city : "", count: Number(r.n ?? 0) }));
}
