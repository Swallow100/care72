// 事業所の地域（docs/tasks/T68.md の 4）: 市と地図の中心。事業所の画面（/office）の「地域」で管理者が置く（app/office/place、フォームの POST）。
// - 市: 本人のページの住所の市の欄の既定（台帳に住所が無い人）と、様式の既定（lib/forms/plan-form.ts の defaultPlanForm。事業所を作るとき）
// - 中心: 本人のページの位置を置く地図（components/person/LocationPick.tsx）が、本人の位置が無いときに開く所
// 市を変えても、今の利用者の市（台帳の値）は変えない。事業所の経過には残さない（office_timeline_entries の kind の CHECK を広げるには
// 表の建て直しが要る〔0012 と同じ〕ので、この作業では足さない。docs/progress/t68.md）。
// 書けるのは事業所の管理者だけ（lib/office/scope.ts の officeActor.placeEdit）。審査員のケアマネの役はケアマネの管理はできるが（T79）、地域は見るだけ。
// T148: 地域を主な市＋周りの市（offices.region_cities）・広さ（region_km）・事業所の区域（hazards、0030）に広げた。形と効く所は lib/office/region.ts。
// 保存のフォームに region=1 の印があるときだけ、周りの市・広さ・区域も書く（印の無い前の形のフォームは市と中心だけ。前のテストと同じ）。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { HAZARD_KINDS, type GeoPoint, type HazardKind } from "../db/types.ts";
import { loadOfficeTowns } from "../disaster/db.ts";
import type { OfficeZone } from "../drill/comms.ts";
import { uniqueCities } from "../jma/match.ts";
import { FLOOD_DEPTHS, isRegionKm, OFFICE_ZONE_KINDS, parseRegionCities, REGION_CITY_MAX, zonesJson, type RegionKm } from "./region.ts";
import { officeActor } from "./scope.ts";

/** 事業所の画面の「地域」の保存の行き先と、区分の id（保存のあとに戻る所） */
export const OFFICE_PLACE_PATH = "/office/place";
export const OFFICE_PLACE_ANCHOR = "office-place";
/** 保存を断ったときに戻す印（/office?form_error=place。様式の選択の form_error=bad と分ける） */
export const PLACE_FORM_ERROR = "place";

/** 市の長さの上限（字） */
export const CITY_MAX = 20;

export type OfficePlace = {
  city: string;
  center: GeoPoint | null;
  /** 町名の候補（事業所の利用者の台帳にある町名。一覧から外した人は数えない。町名の順） */
  towns: string[];
  /** 地域の市（主な市が先、次に周りの市。T148） */
  cities: string[];
  /** 置いた広さ（km。null は自動。T148） */
  km: number | null;
};

/** 事業所の市・中心・町名の候補。事業所が無ければ null */
export async function loadOfficePlace(db: D1Database, officeId: string): Promise<OfficePlace | null> {
  const [row, towns] = await Promise.all([
    db
      .prepare("SELECT city, center_lat, center_lng, region_cities, region_km FROM offices WHERE id = ?1")
      .bind(officeId)
      .first<{ city: string; center_lat: number | null; center_lng: number | null; region_cities: string | null; region_km: number | null }>(),
    loadOfficeTowns(db, officeId),
  ]);
  if (!row) return null;
  return {
    city: row.city ?? "",
    center: row.center_lat != null && row.center_lng != null ? { lat: row.center_lat, lng: row.center_lng } : null,
    towns: towns.flatMap((t) => (t.town ? [t.town] : [])),
    cities: uniqueCities([row.city ?? "", ...parseRegionCities(row.region_cities, row.city ?? "")]),
    km: isRegionKm(row.region_km) ? row.region_km : null,
  };
}

/** region は周りの市・広さ・区域（フォームに region=1 の印があるときだけ。無ければ書かない） */
/** 周りの市の欄の区切り（・、, ／ / と空白。全角の空白も） */
export const REGION_CITY_SEPARATORS = /[・、,，／/\s　]+/u;

export type PlaceForm = { city: string; center: GeoPoint | null; region?: { others: string[]; km: RegionKm | null; zones: OfficeZone[] } };

type FormLike = { get(name: string): unknown; getAll?(name: string): unknown[] } | null;

const num = (v: unknown): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : Number.NaN;
};

/**
 * フォームの中身（city・center_lat・center_lng）を読む。市は空を断る（20 字まで）。
 * 緯度は -90〜90・経度は -180〜180。両方ある か 両方ない（両方空は中心を外す）。読めなければ null
 */
export function parsePlaceForm(form: FormLike): PlaceForm | null {
  if (!form) return null;
  const rawCity = form.get("city");
  const city = typeof rawCity === "string" ? rawCity.trim() : "";
  if (city === "" || [...city].length > CITY_MAX) return null;
  const lat = num(form.get("center_lat"));
  const lng = num(form.get("center_lng"));
  let center: GeoPoint | null = null;
  if (lat !== null || lng !== null) {
    if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    center = { lat, lng };
  }
  if (form.get("region") !== "1") return { city, center };
  const region = parseRegionPart(form, city);
  return region ? { city, center, region } : null;
}

/**
 * 周りの市（region_city。1 つの欄に「東温市・砥部町」と区切って〔・、, ／ 空白〕も、欄を複数も。空は落とし、主な市と同じ・重なりは 1 つに。
 * 8 つまで、1 つ 20 字まで）、
 * 広さ（region_km: 5・10・20・40 か auto・空〔自動〕）、区域（zone: flood・landslide・tsunami を複数、浸水の深さ flood_depth: 0.5・3・5・10 か none・空）。
 * 形が違えば null
 */
function parseRegionPart(form: NonNullable<FormLike>, city: string): NonNullable<PlaceForm["region"]> | null {
  const all = (k: string): string[] => (form.getAll ? form.getAll(k) : [form.get(k)]).flatMap((v) => (typeof v === "string" ? [v] : []));
  const raw = all("region_city")
    .flatMap((c) => c.normalize("NFC").split(REGION_CITY_SEPARATORS))
    .map((c) => c.trim())
    .filter((c) => c !== "");
  if (raw.some((c) => [...c].length > CITY_MAX)) return null;
  const others = uniqueCities([city, ...raw]).filter((c) => c !== city);
  if (others.length > REGION_CITY_MAX) return null;
  const kmRaw = form.get("region_km");
  const kmText = typeof kmRaw === "string" ? kmRaw.trim() : "";
  const km = kmText === "" || kmText === "auto" ? null : Number(kmText);
  if (km !== null && !isRegionKm(km)) return null;
  const kinds = all("zone");
  if (kinds.some((k) => !(OFFICE_ZONE_KINDS as readonly string[]).includes(k))) return null;
  const depthRaw = form.get("flood_depth");
  const depthText = typeof depthRaw === "string" ? depthRaw.trim() : "";
  const depth = depthText === "" || depthText === "none" ? null : Number(depthText);
  if (depth !== null && !(FLOOD_DEPTHS as readonly number[]).includes(depth)) return null;
  const zones: OfficeZone[] = HAZARD_KINDS.filter((k): k is HazardKind => kinds.includes(k)).map((kind) => ({
    kind,
    depthM: kind === "flood" ? depth : null,
  }));
  return { others, km: km as RegionKm | null, zones };
}

export type SavePlaceResult = { ok: true } | { ok: false; error: "forbidden" | "bad" };

/** 事業所の市と中心を書く。管理者だけ（審査員は管理者でない） */
export async function savePlace(db: D1Database, p: Principal | null, value: PlaceForm | null): Promise<SavePlaceResult> {
  const actor = officeActor(p);
  if (!actor?.placeEdit) return { ok: false, error: "forbidden" };
  if (!value) return { ok: false, error: "bad" };
  if (!value.region) {
    await db
      .prepare("UPDATE offices SET city = ?1, center_lat = ?2, center_lng = ?3 WHERE id = ?4")
      .bind(value.city, value.center?.lat ?? null, value.center?.lng ?? null, actor.officeId)
      .run();
    return { ok: true };
  }
  // 周りの市・広さ・区域も（T148）。周りの市が無ければ NULL、区域は選んだ物（無ければ "[]" = 区域なし）
  await db
    .prepare("UPDATE offices SET city = ?1, center_lat = ?2, center_lng = ?3, region_cities = ?4, region_km = ?5, hazards = ?6 WHERE id = ?7")
    .bind(
      value.city,
      value.center?.lat ?? null,
      value.center?.lng ?? null,
      value.region.others.length > 0 ? JSON.stringify(value.region.others) : null,
      value.region.km,
      zonesJson(value.region.zones),
      actor.officeId,
    )
    .run();
  return { ok: true };
}

/**
 * 地域に追加（T148）: 利用者の住所の市で地域に入っていない市を、周りの市の後ろに 1 つ足す。管理者だけ。
 * 主な市・周りの市にもうあれば何もしない（ok）。20 字を超える・空・周りの市が 8 つを超えるなら bad
 */
export async function addRegionCity(db: D1Database, p: Principal | null, raw: unknown): Promise<SavePlaceResult> {
  const actor = officeActor(p);
  if (!actor?.placeEdit) return { ok: false, error: "forbidden" };
  const city = typeof raw === "string" ? raw.trim() : "";
  if (city === "" || [...city].length > CITY_MAX) return { ok: false, error: "bad" };
  const row = await db
    .prepare("SELECT city, region_cities FROM offices WHERE id = ?1")
    .bind(actor.officeId)
    .first<{ city: string; region_cities: string | null }>();
  if (!row) return { ok: false, error: "bad" };
  const others = parseRegionCities(row.region_cities, row.city);
  if (uniqueCities([row.city, ...others]).includes(city)) return { ok: true };
  if (others.length >= REGION_CITY_MAX) return { ok: false, error: "bad" };
  // 読んだあとに周りの市が変わっていれば書かない（同時の保存を上書きしない。もう一度押せば足りる）
  await db
    .prepare("UPDATE offices SET region_cities = ?1 WHERE id = ?2 AND region_cities IS ?3")
    .bind(JSON.stringify([...others, city]), actor.officeId, row.region_cities)
    .run();
  return { ok: true };
}

export type PlacePostOutcome = { status: 401 } | { status: 403 } | { status: 303; location: string };

/** 「地域」の保存（フォームの POST）。ログイン → 管理者 → 形 の順に断る。戻り先は事業所の画面の区分 */
export async function placePost(db: D1Database, p: Principal | null, form: FormLike): Promise<PlacePostOutcome> {
  if (!p) return { status: 401 };
  if (!officeActor(p)?.placeEdit) return { status: 403 };
  // 地域に追加（add_city）は周りの市に 1 つ足すだけ。ほかは区分の保存
  const add = form?.get("add_city");
  const r = typeof add === "string" ? await addRegionCity(db, p, add) : await savePlace(db, p, parsePlaceForm(form));
  if (!r.ok && r.error === "forbidden") return { status: 403 };
  return { status: 303, location: r.ok ? `/office#${OFFICE_PLACE_ANCHOR}` : `/office?form_error=${PLACE_FORM_ERROR}#${OFFICE_PLACE_ANCHOR}` };
}
