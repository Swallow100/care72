// 地図の地域の表示（docs/tasks/T148.md の 2）。事業所の地域（中心と広さ、lib/office/region.ts）から、地図の初めの表示と「地域」の表示を作る。
// ブラウザでも読む（components/map/CaseMap.tsx）ので、D1 も lib/office も読まない。
// - ピンがある地図の初めの表示はピンが全部入る表示のまま（前と同じ。デモ事業所の 10 人の地図を変えない）
// - ピンが無い地図の初めの表示と「地域」のボタンは、中心から km の四角が入る表示（regionView）
// - 雨雲（気象庁の降水ナウキャスト）はその表示のタイルを重ねるので、地域の広さで雨雲の範囲も決まる

import type { GeoPoint } from "../db/types.ts";
import { FULL_ZOOM } from "./camera.ts";
import { fitView, type Size, type View } from "./geo.ts";

/** 地図に渡す地域（中心と広さの km） */
export type MapRegion = { center: GeoPoint; km: number };

/** 地域の表示の一番引いた拡大（地図が引ける所まで。40 km は小さな地図の枠で 9）と一番寄った拡大 */
export const REGION_MIN_Z = FULL_ZOOM.minZ;
export const REGION_MAX_Z = 15;

const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** 中心から km の四角の 2 つの角（南西・北東） */
export function regionBox(center: GeoPoint, km: number): [GeoPoint, GeoPoint] {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return [
    { lat: center.lat - dLat, lng: center.lng - dLng },
    { lat: center.lat + dLat, lng: center.lng + dLng },
  ];
}

/** 地域の表示（中心から km の四角が入る一番寄った拡大） */
export function regionView(region: MapRegion, size?: Size): View {
  return fitView(regionBox(region.center, region.km), { minZ: REGION_MIN_Z, maxZ: REGION_MAX_Z, fallback: region.center, size, padding: NO_PADDING });
}

/**
 * 地図の初めの表示: ピンがあればピンが全部入る表示（pinFit、前と同じ）、ピンが無く地域があれば地域の表示、どちらも無ければ pinFit
 * （前からの既定の真ん中）
 */
export function initialView(pinCount: number, pinFit: View, region: MapRegion | null | undefined, size?: Size): View {
  return pinCount === 0 && region ? regionView(region, size) : pinFit;
}
