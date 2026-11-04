// 事業所の地域（docs/tasks/T68.md の 4）: 市と地図の中心。事業所の画面（/office）の「地域」で管理者が置く（app/office/place、フォームの POST）。
// - 市: 本人のページの住所の市の欄の既定（台帳に住所が無い人）と、様式の既定（lib/forms/plan-form.ts の defaultPlanForm。事業所を作るとき）
// - 中心: 本人のページの位置を置く地図（components/person/LocationPick.tsx）が、本人の位置が無いときに開く所
// 市を変えても、今の利用者の市（台帳の値）は変えない。事業所の経過には残さない（office_timeline_entries の kind の CHECK を広げるには
// 表の建て直しが要る〔0012 と同じ〕ので、この作業では足さない。docs/progress/t68.md）。
// 書けるのは事業所の管理者だけ（lib/office/scope.ts の officeActor.placeEdit）。審査員のケアマネの役はケアマネの管理はできるが（T79）、地域は見るだけ。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { GeoPoint } from "../db/types.ts";
import { loadOfficeTowns } from "../disaster/db.ts";
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
};

/** 事業所の市・中心・町名の候補。事業所が無ければ null */
export async function loadOfficePlace(db: D1Database, officeId: string): Promise<OfficePlace | null> {
  const [row, towns] = await Promise.all([
    db
      .prepare("SELECT city, center_lat, center_lng FROM offices WHERE id = ?1")
      .bind(officeId)
      .first<{ city: string; center_lat: number | null; center_lng: number | null }>(),
    loadOfficeTowns(db, officeId),
  ]);
  if (!row) return null;
  return {
    city: row.city ?? "",
    center: row.center_lat != null && row.center_lng != null ? { lat: row.center_lat, lng: row.center_lng } : null,
    towns: towns.flatMap((t) => (t.town ? [t.town] : [])),
  };
}

export type PlaceForm = { city: string; center: GeoPoint | null };

type FormLike = { get(name: string): unknown } | null;

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
  if (lat === null && lng === null) return { city, center: null };
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { city, center: { lat, lng } };
}

export type SavePlaceResult = { ok: true } | { ok: false; error: "forbidden" | "bad" };

/** 事業所の市と中心を書く。管理者だけ（審査員は管理者でない） */
export async function savePlace(db: D1Database, p: Principal | null, value: PlaceForm | null): Promise<SavePlaceResult> {
  const actor = officeActor(p);
  if (!actor?.placeEdit) return { ok: false, error: "forbidden" };
  if (!value) return { ok: false, error: "bad" };
  await db
    .prepare("UPDATE offices SET city = ?1, center_lat = ?2, center_lng = ?3 WHERE id = ?4")
    .bind(value.city, value.center?.lat ?? null, value.center?.lng ?? null, actor.officeId)
    .run();
  return { ok: true };
}

export type PlacePostOutcome = { status: 401 } | { status: 403 } | { status: 303; location: string };

/** 「地域」の保存（フォームの POST）。ログイン → 管理者 → 形 の順に断る。戻り先は事業所の画面の区分 */
export async function placePost(db: D1Database, p: Principal | null, form: FormLike): Promise<PlacePostOutcome> {
  if (!p) return { status: 401 };
  if (!officeActor(p)?.placeEdit) return { status: 403 };
  const r = await savePlace(db, p, parsePlaceForm(form));
  if (!r.ok && r.error === "forbidden") return { status: 403 };
  return { status: 303, location: r.ok ? `/office#${OFFICE_PLACE_ANCHOR}` : `/office?form_error=${PLACE_FORM_ERROR}#${OFFICE_PLACE_ANCHOR}` };
}
