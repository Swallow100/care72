// 雨雲・震度の「デモ」の表示（T14）。気象庁の情報は引かない（本物を引くのは本運用。docs/SPEC.md「範囲外」）。
// 災害の状態（T09 の災害の種類を lib/disaster/state.ts の DISASTER_SCENE で大雨か地震の場面に写した物と警戒レベル）か訓練の筋書き（docs/SPEC.md: 大雨は警戒レベル 3 → 4 → 浸水 3 m、
// 地震は南海トラフで震度 6 強・沿岸の津波・停電 2 日）から作った絵と数字で、画面には必ず「デモ」の印を付ける。
// 本物の警報と見間違えないように、雨雲は気象庁の色の段（青・黄・赤・紫）を使わず灰色の斜線で描き、
// 「警報」「注意報」「速報」の言葉を使わない。

import type { GeoPoint, HazardKind } from "../db/types.ts";

/**
 * デモの場面。T09 の災害の状態（DISASTER_SCENE で写す。その他・平時は場面なしで、ここへ来ない）か訓練の筋書きから作る。
 * 大雨で警戒レベルを入れていない（null）ときは、名前を「大雨」だけにし、雨雲は弱の帯だけ（入れていないレベルを出さない）
 */
export type DemoScene = { kind: "heavy_rain"; level: 3 | 4 | 5 | null } | { kind: "earthquake" };

/** 雨雲の帯 1 つ。strength は 1 弱・2 強・3 猛（斜線の詰み具合だけで描き分ける） */
export type RainBand = { ring: GeoPoint[]; strength: 1 | 2 | 3 };

/**
 * 雨雲の斜線の描き方（components/map/CaseMap.tsx の Rain）。強いほど詰めて濃く太く。気象庁の色の段は使わない。
 * T66: 淡色地図とハザードの層の上で弱かったので、濃さと太さを上げた（前は 弱 0.22・強 0.32・猛 0.42、太さ 1.3）
 */
export const RAIN_HATCH: Record<RainBand["strength"], { gap: number; opacity: number; width: number }> = {
  1: { gap: 6.5, opacity: 0.42, width: 1.5 },
  2: { gap: 4.5, opacity: 0.55, width: 1.7 },
  3: { gap: 3.2, opacity: 0.7, width: 1.8 },
};
/** 雨雲の帯の縁（破線）の濃さと太さ */
export const RAIN_EDGE = { opacity: 0.7, width: 1.4 } as const;
/**
 * 雨雲の線の色。下の地図（淡色地図）はダークの画面でも明るいままなので、本文色（ダークでは明るい）でなく、いつも濃い墨（ライトの本文色）。
 * 黒を混ぜてよい灰色・黒の内（CLAUDE.md「画面の決まり」）
 */
export const RAIN_INK = "#161b21";

export type DemoOverlay = {
  /** 場面の名前（大雨 レベル 4・地震 南海トラフ） */
  title: string;
  rain: RainBand[];
  /** 震度（筋書きの値）。大雨では null */
  quake: { intensity: string; area: string } | null;
  /** 既定で重ねるハザードの層 */
  layers: HazardKind[];
};

/** 筋書きの雨雲の帯の芯（南西の海から北東の山へ。松山の市街を斜めに横切る） */
const RAIN_AXIS: [GeoPoint, GeoPoint] = [
  { lat: 33.735, lng: 132.62 },
  { lat: 33.925, lng: 132.89 },
];

/** 帯の半分の幅（km）。強い帯ほど細い */
const RAIN_HALF_WIDTH_KM: Record<RainBand["strength"], number> = { 1: 3.4, 2: 1.9, 3: 0.9 };

/** 警戒レベルごとに描く帯（レベル 3 は弱だけ、4 は強まで、5 は猛まで） */
const RAIN_STRENGTHS: Record<3 | 4 | 5, RainBand["strength"][]> = { 3: [1], 4: [1, 2], 5: [1, 2, 3] };

/** 2 点を結ぶ線の両側に半幅 km の帯（4 隅）。度と km の換算は帯の真ん中の緯度で */
export function bandRing(a: GeoPoint, b: GeoPoint, halfWidthKm: number): GeoPoint[] {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const kmLat = 111.32;
  const kmLng = 111.32 * Math.cos(midLat);
  // km の平面で垂直の向きを出す
  const dx = (b.lng - a.lng) * kmLng;
  const dy = (b.lat - a.lat) * kmLat;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * halfWidthKm;
  const ny = (dx / len) * halfWidthKm;
  const off = (p: GeoPoint, s: 1 | -1): GeoPoint => ({ lat: p.lat + (s * ny) / kmLat, lng: p.lng + (s * nx) / kmLng });
  return [off(a, 1), off(b, 1), off(b, -1), off(a, -1)];
}

export function demoOverlay(scene: DemoScene): DemoOverlay {
  if (scene.kind === "heavy_rain") {
    return {
      title: scene.level !== null ? `大雨 レベル ${scene.level}` : "大雨",
      rain: RAIN_STRENGTHS[scene.level ?? 3].map((strength) => ({
        strength,
        ring: bandRing(RAIN_AXIS[0], RAIN_AXIS[1], RAIN_HALF_WIDTH_KM[strength]),
      })),
      quake: null,
      layers: ["flood", "landslide"],
    };
  }
  return {
    title: "地震 南海トラフ",
    rain: [],
    quake: { intensity: "6強", area: "松山市" },
    layers: ["tsunami", "landslide"],
  };
}
