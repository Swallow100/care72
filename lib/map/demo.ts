// 雨雲・震度の「デモ」の表示（T14）。気象庁の情報は引かない（本物を引くのは本運用。docs/SPEC.md「範囲外」）。
// 災害の状態（T09 の災害の種類を lib/disaster/state.ts の DISASTER_SCENE で大雨か地震の場面に写した物と警戒レベル）か訓練の筋書き（docs/SPEC.md: 大雨は警戒レベル 3 → 4 → 浸水 3 m、
// 地震は南海トラフで震度 6 強・沿岸の津波・停電 2 日）から作った絵と数字で、画面には必ず「デモ」の印を付ける。
// 本物の警報と見間違えないように、雨雲は気象庁の色の段（青・黄・赤・紫）を使わず、淡い青灰の面と短い雨の筋の 1 色で描き、
// 「警報」「注意報」「速報」の言葉を使わない。

import type { GeoPoint, HazardKind } from "../db/types.ts";

/**
 * デモの場面。T09 の災害の状態（DISASTER_SCENE で写す。その他・平時は場面なしで、ここへ来ない）か訓練の筋書きから作る。
 * 大雨で警戒レベルを入れていない（null）ときは、名前を「大雨」だけにし、雨雲は弱の帯だけ（入れていないレベルを出さない）
 */
export type DemoScene = { kind: "heavy_rain"; level: 3 | 4 | 5 | null } | { kind: "earthquake" };

/** 雨雲の帯 1 つ。strength は 1 弱・2 強・3 猛（筋の密度と面の濃さで描き分ける） */
export type RainBand = { ring: GeoPoint[]; strength: 1 | 2 | 3 };

/**
 * 雨雲の描き方（components/map/CaseMap.tsx の Rain）。淡い青灰の面に、細く短い雨の筋を斜めに不規則な間で置く。
 * 帯は入れ子（弱が広く猛が細い）なので、面は重なるほど濃くなり、筋は 3 つの帯の分が足される。強いほど筋を詰めて長く。
 * tile はくり返しの 1 枚の大きさ（px）、streaks はその中の筋の本数、length は筋の長さの幅（px）、fill は面の濃さ。
 * T66 は濃い墨の長い斜線を等間隔に並べた（雨雲に見えなかった）。T96 で面と短い筋に替えた。
 */
export const RAIN_STYLE: Record<
  RainBand["strength"],
  { tile: number; streaks: number; length: readonly [number, number]; width: number; fill: number }
> = {
  1: { tile: 46, streaks: 9, length: [4, 6], width: 1.1, fill: 0.26 },
  2: { tile: 42, streaks: 13, length: [5, 7], width: 1.2, fill: 0.22 },
  3: { tile: 38, streaks: 17, length: [6, 8.5], width: 1.3, fill: 0.22 },
};
/** 筋の傾き（縦から左へ、度）。風に流れる雨の向き */
export const RAIN_SLANT_DEG = 18;
/**
 * 雨雲の面の色（淡い青灰。oklch 0.72 0.05 245）と筋の色（oklch 0.50 0.10 252。黒を混ぜない、澄んだ青の明るさを下げた色）。
 * 気象庁の雨雲の色の段（水色・青・紺・黄・橙・赤・紫）と重ならない。下の地図（淡色地図）はダークの画面でも明るいままなので、
 * ライトとダークで同じ値（本文色や CSS 変数にしない）
 */
export const RAIN_FILL = "#8ba9c2";
export const RAIN_STREAK = "#35669a";

/** 雨の筋 1 本（タイルの中の px） */
export type RainStreak = { x1: number; y1: number; x2: number; y2: number };

/** 決まった種から同じ並びを出す乱数（mulberry32）。描くたびに変わるとサーバーと手元の描画が食い違う */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * タイル 1 枚の雨の筋（RAIN_STYLE の streaks 本）。タイルを升に分けて 1 升に 1 本、升の中の位置と長さを種からずらす
 * （間が不規則で、偏りも無い）。筋は上の端から左下へ落ちる向き。タイルの端をまたぐ筋は、反対の端にも同じ筋を写して
 * くり返しの境で切れないようにする（写しは 1 本に数えない: 戻り値は 1 本ごとの組）。強さごとに種を変える
 */
export function rainStreaks(strength: RainBand["strength"]): RainStreak[][] {
  const s = RAIN_STYLE[strength];
  const rand = seeded(9600 + strength * 131);
  const sin = Math.sin((RAIN_SLANT_DEG * Math.PI) / 180);
  const cos = Math.cos((RAIN_SLANT_DEG * Math.PI) / 180);
  const cols = Math.ceil(Math.sqrt(s.streaks));
  const rows = Math.ceil(s.streaks / cols);
  const cellW = s.tile / cols;
  const cellH = s.tile / rows;
  const out: RainStreak[][] = [];
  for (let i = 0; i < s.streaks; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const len = s.length[0] + rand() * (s.length[1] - s.length[0]);
    const x1 = (c + rand()) * cellW;
    const y1 = (r + rand()) * cellH;
    const x2 = x1 - len * sin;
    const y2 = y1 + len * cos;
    const shiftsX = x2 < 0 ? [0, s.tile] : [0];
    const shiftsY = y2 > s.tile ? [0, -s.tile] : [0];
    out.push(
      shiftsX.flatMap((ox) =>
        shiftsY.map((oy) => ({ x1: round1(x1 + ox), y1: round1(y1 + oy), x2: round1(x2 + ox), y2: round1(y2 + oy) })),
      ),
    );
  }
  return out;
}

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
