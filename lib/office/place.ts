// 事業所の地域（docs/tasks/T68.md の 4）: 市と地図の中心。事業所の画面（/office）の「地域」で管理者が置く（app/office/place、フォームの POST）。
// - 市: 本人のページの住所の市の欄の既定（台帳に住所が無い人）と、様式の既定（lib/forms/plan-form.ts の defaultPlanForm。事業所を作るとき）
// - 中心: 本人のページの位置を置く地図（components/person/LocationPick.tsx）が、本人の位置が無いときに開く所
// 市を変えても、今の利用者の市（台帳の値）は変えない。事業所の経過には残さない（office_timeline_entries の kind の CHECK を広げるには
// 表の建て直しが要る〔0012 と同じ〕ので、この作業では足さない。docs/progress/t68.md）。
// 書けるのは事業所の管理者だけ（lib/office/scope.ts の officeActor.placeEdit）。審査員のケアマネの役はケアマネの管理はできるが（T79）、地域は見るだけ。
// T148: 地域を主な市＋周りの市（offices.region_cities）・広さ（region_km）・事業所の区域（hazards、0030）に広げた。形と効く所は lib/office/region.ts。
// 保存のフォームに region=1 の印があるときだけ、周りの市・広さ・区域も書く（印の無い前の形のフォームは市と中心だけ。前のテストと同じ）。
// T154: 市は全国の市区町村の表（lib/municipality）から選ぶ。フォームは団体コード（city_code・region_code）を送り、保存は団体コード
// （city_code・region_city_codes、migration 0038）と表の名前（city・region_cities）を一緒に書く。前の形の文字（city・region_city）は
// 表で当てて同じく書く（当たらない主な市は文字だけ・団体コードは NULL）。主な市を変えて中心を動かしていなければ、中心は新しい市の代表の点に。
// 決める所（気象庁の欄・地図・様式の一覧の初めの市）は lib/office/area.ts の officeAreaOf の 1 か所。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。画面の部品からは読まない（表を読むため。定数は http-paths.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { HAZARD_KINDS, type GeoPoint, type HazardKind } from "../db/types.ts";
import { loadOfficeTowns } from "../disaster/db.ts";
import type { OfficeZone } from "../drill/comms.ts";
import { uniqueCities } from "../jma/match.ts";
import type { MapRegion } from "../map/region.ts";
import { municipalityGeo } from "../municipality/geo.ts";
import { isMunicipalityCode, matchCity, municipalityByCode, type Municipality } from "../municipality/names.ts";
import { OFFICE_AREA_COLUMNS, officeAreaOf, type OfficeAreaRow } from "./area.ts";
import { OFFICE_PLACE_ANCHOR, PLACE_FORM_ERROR } from "./http-paths.ts";
import { FLOOD_DEPTHS, isRegionKm, OFFICE_ZONE_KINDS, REGION_CITY_MAX, zonesJson, type RegionKm } from "./region.ts";
import { officeActor } from "./scope.ts";

export { OFFICE_PLACE_ANCHOR, OFFICE_PLACE_PATH, PLACE_FORM_ERROR } from "./http-paths.ts";

/** 市の長さの上限（字） */
export const CITY_MAX = 20;

export type OfficePlace = {
  /** 主な市の名前（表の名前。当たらなければ前からの文字） */
  city: string;
  /** 地図の真ん中（事業所の中心。無ければ主な市の代表の点。lib/office/area.ts） */
  center: GeoPoint | null;
  /** 町名の候補（事業所の利用者の台帳にある町名。一覧から外した人は数えない。町名の順） */
  towns: string[];
  /** 地域の市（主な市が先、次に周りの市。T148） */
  cities: string[];
  /** 置いた広さ（km。null は自動。T148） */
  km: number | null;
  /** 地図の地域（中心と広さ。ピンが無い地図の初めの表示と「地域」の表示。T154） */
  map: MapRegion | null;
};

/** 事業所の市・中心・町名の候補。事業所が無ければ null */
export async function loadOfficePlace(db: D1Database, officeId: string): Promise<OfficePlace | null> {
  const [row, towns] = await Promise.all([
    db.prepare(`SELECT ${OFFICE_AREA_COLUMNS} FROM offices WHERE id = ?1`).bind(officeId).first<OfficeAreaRow>(),
    loadOfficeTowns(db, officeId),
  ]);
  if (!row) return null;
  const area = officeAreaOf(row);
  return {
    city: area.main?.name ?? area.mainText,
    center: area.center,
    towns: towns.flatMap((t) => (t.town ? [t.town] : [])),
    cities: area.cities,
    km: area.kmSet,
    map: area.map,
  };
}

/** 周りの市の欄の区切り（・、, ／ / と空白。全角の空白も） */
export const REGION_CITY_SEPARATORS = /[・、,，／/\s　]+/u;

/**
 * cityCode は主な市の団体コード（表に当たらない前の形の文字なら null）。
 * region は周りの市・広さ・区域（フォームに region=1 の印があるときだけ。無ければ書かない）。others は表の名前、otherCodes は団体コード
 * （前の形の文字で表に当たらない物は others にだけ残す）
 */
export type PlaceForm = {
  city: string;
  /** 無ければ city を表で当てる（前のテストと道具の形） */
  cityCode?: string | null;
  center: GeoPoint | null;
  region?: { others: string[]; otherCodes: string[]; km: RegionKm | null; zones: OfficeZone[] };
};

type FormLike = { get(name: string): unknown; getAll?(name: string): unknown[] } | null;

const num = (v: unknown): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : Number.NaN;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * フォームの中身を読む。主な市は city_code（表の団体コード）か、前の形の city（文字。表で当てる）。どちらも無い・コードが表に無いなら null。
 * 緯度は -90〜90・経度は -180〜180。両方ある か 両方ない（両方空は中心を外す）。読めなければ null
 */
export function parsePlaceForm(form: FormLike): PlaceForm | null {
  if (!form) return null;
  const code = str(form.get("city_code"));
  let city: string;
  let cityCode: string | null;
  let main: Municipality | null = null;
  if (code !== "") {
    if (!isMunicipalityCode(code)) return null;
    main = municipalityByCode(code)!;
    city = main.name;
    cityCode = code;
  } else {
    city = str(form.get("city"));
    if (city === "" || [...city].length > CITY_MAX) return null;
    main = matchCity(city);
    cityCode = main?.code ?? null;
    if (main) city = main.name;
  }
  const lat = num(form.get("center_lat"));
  const lng = num(form.get("center_lng"));
  let center: GeoPoint | null = null;
  if (lat !== null || lng !== null) {
    if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    center = { lat, lng };
  }
  if (form.get("region") !== "1") return { city, cityCode, center };
  const region = parseRegionPart(form, main, city);
  return region ? { city, cityCode, center, region } : null;
}

/**
 * 周りの市: region_code（団体コードを複数。表に無いコードは断る）と、前の形の region_city（1 つの欄に「東温市・砥部町」と区切って
 * 〔・、, ／ 空白〕も、欄を複数も。表で当て、当たらない物は文字のまま）。空は落とし、主な市と同じ・重なりは 1 つに。8 つまで、1 つ 20 字まで。
 * 広さ（region_km: 5・10・20・40 か auto・空〔自動〕）、区域（zone: flood・landslide・tsunami を複数、浸水の深さ flood_depth: 0.5・3・5・10 か none・空）。
 * 形が違えば null
 */
function parseRegionPart(form: NonNullable<FormLike>, main: Municipality | null, city: string): NonNullable<PlaceForm["region"]> | null {
  const all = (k: string): string[] => (form.getAll ? form.getAll(k) : [form.get(k)]).flatMap((v) => (typeof v === "string" ? [v] : []));
  const codes = all("region_code")
    .map((c) => c.trim())
    .filter((c) => c !== "");
  if (codes.some((c) => !isMunicipalityCode(c))) return null;
  const raw = all("region_city")
    .flatMap((c) => c.normalize("NFC").split(REGION_CITY_SEPARATORS))
    .map((c) => c.trim())
    .filter((c) => c !== "");
  if (raw.some((c) => [...c].length > CITY_MAX)) return null;
  const picked: Municipality[] = [];
  const texts: string[] = [];
  for (const c of codes) picked.push(municipalityByCode(c)!);
  for (const t of raw) {
    const m = matchCity(t, main?.pref ?? null);
    if (m) picked.push(m);
    else texts.push(t);
  }
  const otherCodes = [...new Set(picked.map((m) => m.code))].filter((c) => c !== main?.code);
  const others = uniqueCities([city, ...otherCodes.map((c) => municipalityByCode(c)!.name), ...texts]).filter((c) => c !== city);
  if (others.length > REGION_CITY_MAX) return null;
  const kmText = str(form.get("region_km"));
  const km = kmText === "" || kmText === "auto" ? null : Number(kmText);
  if (km !== null && !isRegionKm(km)) return null;
  const kinds = all("zone");
  if (kinds.some((k) => !(OFFICE_ZONE_KINDS as readonly string[]).includes(k))) return null;
  const depthText = str(form.get("flood_depth"));
  const depth = depthText === "" || depthText === "none" ? null : Number(depthText);
  if (depth !== null && !(FLOOD_DEPTHS as readonly number[]).includes(depth)) return null;
  const zones: OfficeZone[] = HAZARD_KINDS.filter((k): k is HazardKind => kinds.includes(k)).map((kind) => ({
    kind,
    depthM: kind === "flood" ? depth : null,
  }));
  return { others, otherCodes, km: km as RegionKm | null, zones };
}

export type SavePlaceResult = { ok: true } | { ok: false; error: "forbidden" | "bad" };

const sameCenter = (a: GeoPoint | null, b: GeoPoint | null) => (a === null || b === null ? a === b : Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6);

/**
 * 事業所の市と中心を書く。管理者だけ（審査員は管理者でない）。
 * 主な市が変わり、中心が保存してある中心のまま（動かしていない）なら、中心を新しい市の代表の点にする（地図が前の市に残らない）
 */
export async function savePlace(db: D1Database, p: Principal | null, value: PlaceForm | null): Promise<SavePlaceResult> {
  const actor = officeActor(p);
  if (!actor?.placeEdit) return { ok: false, error: "forbidden" };
  if (!value) return { ok: false, error: "bad" };
  const prev = await db.prepare(`SELECT ${OFFICE_AREA_COLUMNS} FROM offices WHERE id = ?1`).bind(actor.officeId).first<OfficeAreaRow>();
  if (!prev) return { ok: false, error: "bad" };
  const prevCode = officeAreaOf(prev).main?.code ?? null;
  const cityCode = value.cityCode === undefined ? (matchCity(value.city)?.code ?? null) : value.cityCode;
  const prevCenter = prev.center_lat != null && prev.center_lng != null ? { lat: prev.center_lat, lng: prev.center_lng } : null;
  let center = value.center;
  if (cityCode && cityCode !== prevCode && prevCenter && sameCenter(center, prevCenter)) {
    center = municipalityGeo(cityCode)?.point ?? center;
  }
  if (!value.region) {
    await db
      .prepare("UPDATE offices SET city = ?1, city_code = ?2, center_lat = ?3, center_lng = ?4 WHERE id = ?5")
      .bind(value.city, cityCode, center?.lat ?? null, center?.lng ?? null, actor.officeId)
      .run();
    return { ok: true };
  }
  // 周りの市・広さ・区域も（T148）。周りの市が無ければ NULL、区域は選んだ物（無ければ "[]" = 区域なし）。
  // 団体コードの周りの市は、表に当たる物だけ（当たらない前の形の文字は region_cities にだけ残る。T154）
  await db
    .prepare(
      "UPDATE offices SET city = ?1, city_code = ?2, center_lat = ?3, center_lng = ?4, region_cities = ?5, region_city_codes = ?6, region_km = ?7, hazards = ?8 WHERE id = ?9",
    )
    .bind(
      value.city,
      cityCode,
      center?.lat ?? null,
      center?.lng ?? null,
      value.region.others.length > 0 ? JSON.stringify(value.region.others) : null,
      value.region.others.length > 0 ? JSON.stringify(value.region.otherCodes) : null,
      value.region.km,
      zonesJson(value.region.zones),
      actor.officeId,
    )
    .run();
  return { ok: true };
}

/**
 * 地域に追加（T148、T154 で団体コードに）: 利用者の住所の市で地域に入っていない市を、周りの市の後ろに 1 つ足す。管理者だけ。
 * raw は団体コード（add_code）か前の形の市の名前（add_city。表で当てる）。表に当たらなければ bad。
 * 主な市・周りの市にもうあれば何もしない（ok）。周りの市が 8 つを超えるなら bad
 */
export async function addRegionCity(db: D1Database, p: Principal | null, raw: unknown): Promise<SavePlaceResult> {
  const actor = officeActor(p);
  if (!actor?.placeEdit) return { ok: false, error: "forbidden" };
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "" || [...text].length > CITY_MAX) return { ok: false, error: "bad" };
  const row = await db
    .prepare(`SELECT ${OFFICE_AREA_COLUMNS} FROM offices WHERE id = ?1`)
    .bind(actor.officeId)
    .first<OfficeAreaRow>();
  if (!row) return { ok: false, error: "bad" };
  const area = officeAreaOf(row);
  const m = /^\d{6}$/.test(text) ? municipalityByCode(text) : matchCity(text, area.pref);
  if (!m) return { ok: false, error: "bad" };
  if ([...(area.main ? [area.main] : []), ...area.others].some((o) => o.code === m.code)) return { ok: true };
  const others = [...area.others.map((o) => o.name), ...area.unmatched, m.name];
  if (others.length > REGION_CITY_MAX) return { ok: false, error: "bad" };
  const codes = [...area.others.map((o) => o.code), m.code];
  // 主な市が文字から当たっていれば、団体コードも一緒に書く（写し）。
  // 読んだあとに周りの市が変わっていれば書かない（同時の保存を上書きしない。もう一度押せば足りる）
  await db
    .prepare(
      "UPDATE offices SET region_cities = ?1, region_city_codes = ?2, city_code = COALESCE(city_code, ?3) WHERE id = ?4 AND region_cities IS ?5 AND region_city_codes IS ?6",
    )
    .bind(JSON.stringify(others), JSON.stringify(codes), area.main?.code ?? null, actor.officeId, row.region_cities, row.region_city_codes ?? null)
    .run();
  return { ok: true };
}

export type PlacePostOutcome = { status: 401 } | { status: 403 } | { status: 303; location: string };

/** 「地域」の保存（フォームの POST）。ログイン → 管理者 → 形 の順に断る。戻り先は事業所の画面の区分 */
export async function placePost(db: D1Database, p: Principal | null, form: FormLike): Promise<PlacePostOutcome> {
  if (!p) return { status: 401 };
  if (!officeActor(p)?.placeEdit) return { status: 403 };
  // 地域に追加（add_code・前の形の add_city）は周りの市に 1 つ足すだけ。ほかは区分の保存
  const add = form?.get("add_code") ?? form?.get("add_city");
  const r = typeof add === "string" ? await addRegionCity(db, p, add) : await savePlace(db, p, parsePlaceForm(form));
  if (!r.ok && r.error === "forbidden") return { status: 403 };
  return { status: 303, location: r.ok ? `/office#${OFFICE_PLACE_ANCHOR}` : `/office?form_error=${PLACE_FORM_ERROR}#${OFFICE_PLACE_ANCHOR}` };
}
