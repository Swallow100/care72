// 地図の既定の真ん中（T68）。位置を置く小さな地図（components/person/LocationPick.tsx）が、本人の位置も事業所の中心も無いときに使う。
// 値は担当一覧の地図（components/map/CaseMap.tsx の FALLBACK）と同じ松山市の市街。CaseMap はこの作業で触らないので、
// 同じ値をここに 1 か所持ち、テスト（lib/office/place.test.ts）で CaseMap の値と同じかを見る。

import type { GeoPoint } from "../db/types.ts";
import { isGeoPoint } from "./geo.ts";

/** 位置も事業所の中心も無いときの真ん中（松山市の市街） */
export const DEFAULT_CENTER: GeoPoint = { lat: 33.84, lng: 132.765 };

/** 地図の真ん中: 本人の位置 → 事業所の中心 → 既定（松山市の市街）。読めない値は飛ばす */
export function pickCenter(person?: GeoPoint | null, office?: GeoPoint | null): GeoPoint {
  if (isGeoPoint(person)) return person;
  if (isGeoPoint(office)) return office;
  return DEFAULT_CENTER;
}

/** 緯度経度を 5 桁（約 1 m）に丸める。押した所の細かすぎる端数を残さない */
export function roundPoint(p: GeoPoint): GeoPoint {
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  return { lat: r(p.lat), lng: r(p.lng) };
}
