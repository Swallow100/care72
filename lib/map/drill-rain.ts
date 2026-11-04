// 訓練の地図の想定の雨（docs/tasks/T103.md、降水量の段の色は T116）。筋書きの雨の表（lib/drill/rain.ts）の種と時刻ごとの形から、
// 降水量の段（lib/map/rain-scale.ts の 8 段）ごとの雨の輪を作る。
// - 線状に並ぶ雨の帯: 芯の線に沿って幅を変え、縁は種で決めた凹凸（いくつかの波の和）。凹凸は時刻で帯に沿って北東へ流れる
// - 降水量は帯の芯で表の peak（mm/h）、帯の縁で RAIN_EDGE_MM。間は対数で下がる（芯の近くほど急に強くなる）。段の境の値の所に輪を引く
//   ので、段は入れ子（弱い段が広く、強い段は帯の南西寄りの細長い芯）。段の輪の大きさは peak で育ち、縮む
// - 帯のまわりに弱い小さな雨を種から 3 つ（出て、育って、消える。10 mm/h 未満）
// - 時刻は小数でよい（連続の時計の分まで）。表の時刻の間は線で補う。最後の時刻のあとは雨なし
// - 位置は利用者の位置の範囲の真ん中から km で置き、緯度経度は 5 桁に丸める。時計も乱数も読まない（サーバーと手元で同じ絵）
// 雨は色と連絡順に使わない。地点ごとの雨量や危険度も作らない（絵と凡例だけ）。

import type { GeoPoint } from "../db/types.ts";
import type { RainKey, RainTrack } from "../drill/rain.ts";
import { DEFAULT_CENTER } from "./center.ts";
import { RAIN_STEPS, type RainMin } from "./rain-scale.ts";
import { seeded } from "./seeded.ts";

/** 雨の輪 1 つ。min は降水量の段（下の境 mm/h）。main は帯の段（false は帯のまわりの小さな雨） */
export type RainBand = { ring: GeoPoint[]; min: RainMin; main: boolean };

/** 見ている時刻の帯の形（表の時刻の間を線で補った物） */
export type RainFrame = Omit<RainKey, "hour">;

const KM_LAT = 111.32;
/** 帯の縁の降水量（mm/h）。芯の peak がこれ以下なら雨なし */
export const RAIN_EDGE_MM = 0.4;
/** 段の輪の大きさの曲がり（1 なら対数のまま。小さいほど強い段の輪が広い） */
const REACH_POW = 0.8;
/** 帯の長さの縮み方（幅より緩く縮める。強い段ほど細長い芯になる） */
const LEN_POW = 0.5;
/** 強い段の芯のずれ（帯の長さに対する割合。南西寄り） */
const CORE_SHIFT = -0.16;
/** これより小さい輪は描かない（帯の大きさに対する割合） */
const MIN_REACH = 0.04;
/** 縁の凹凸の波（km の波長と、幅に対する振れ） */
const WAVES = [
  { length: 7, amp: 0.17 },
  { length: 3.9, amp: 0.11 },
  { length: 2.2, amp: 0.07 },
] as const;
/** 帯の片側の点の数（両端は尖らせて 1 つ） */
const SIDE_POINTS = 30;
/** 小さな雨の数と点の数、芯の降水量（mm/h。大きい雨ほど強い） */
const CELLS = 3;
const CELL_POINTS = 16;
const CELL_PEAK = { min: 3, max: 8 } as const;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 見ている時刻の形。最初の時刻より前は最初の形、最後の時刻のあと・芯の降水量が縁以下は null（雨なし） */
export function rainFrame(track: RainTrack, hour: number): RainFrame | null {
  const keys = track.keys;
  if (keys.length === 0 || !Number.isFinite(hour)) return null;
  const h = Math.max(hour, keys[0].hour);
  let frame: RainFrame;
  if (h >= keys[keys.length - 1].hour) {
    const { hour: _h, ...last } = keys[keys.length - 1];
    frame = last;
  } else {
    const i = keys.findIndex((k, j) => j + 1 < keys.length && k.hour <= h && h < keys[j + 1].hour);
    const a = keys[i];
    const b = keys[i + 1];
    const t = (h - a.hour) / (b.hour - a.hour);
    frame = {
      east: lerp(a.east, b.east, t),
      north: lerp(a.north, b.north, t),
      length: lerp(a.length, b.length, t),
      width: lerp(a.width, b.width, t),
      peak: lerp(a.peak, b.peak, t),
    };
  }
  return frame.peak > RAIN_EDGE_MM ? frame : null;
}

/**
 * 段の輪の大きさ（帯の大きさに対する割合、0〜1）。芯が peak、縁が RAIN_EDGE_MM で、間は対数で下がる降水量の、境 min の所。
 * 1 未満の段（min 0）は帯の縁そのもの。peak が min 以下なら 0（その段は無い）
 */
export function rainReach(peak: number, min: number): number {
  if (!(peak > RAIN_EDGE_MM)) return 0;
  if (min <= 0) return 1;
  if (peak <= min) return 0;
  return Math.pow(Math.log(peak / min) / Math.log(peak / RAIN_EDGE_MM), REACH_POW);
}

/** 帯を置く真ん中: 利用者の位置の範囲（南北・東西の端）の真ん中。位置が無ければ松山市の市街（lib/map/center.ts） */
export function rainAnchor(points: ReadonlyArray<GeoPoint>): GeoPoint {
  if (points.length === 0) return DEFAULT_CENTER;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    lat: round5((Math.min(...lats) + Math.max(...lats)) / 2),
    lng: round5((Math.min(...lngs) + Math.max(...lngs)) / 2),
  };
}

/** 種から作る縁の波の位相と小さな雨の置き方（同じ種なら同じ。T103 と同じ乱数の順） */
function shapeOf(seed: number) {
  const rand = seeded(seed);
  const phases = ([1, -1] as const).map(() => WAVES.map(() => rand() * Math.PI * 2));
  const cells = Array.from({ length: CELLS }, () => ({
    along: rand() * 0.8 - 0.4,
    across: (1.7 + rand() * 0.9) * (rand() < 0.5 ? -1 : 1),
    radius: 0.6 + rand() * 0.6,
    from: rand() * 8,
    life: 5 + rand() * 8,
    phase: rand() * Math.PI * 2,
  }));
  return { phases, cells };
}

/**
 * 見ている時刻の雨の輪（弱い段から強い段の順。同じ段では帯 → 小さな雨）。maxMm は描いてよい降水量の上限（見ている時刻の
 * 警戒レベルの上限。lib/map/demo.ts の RAIN_CAP_MM）で、段の下の境がこれ以上の段は描かない。0 なら雨なし
 */
export function drillRain(track: RainTrack, hour: number, maxMm: number, anchor: GeoPoint): RainBand[] {
  const f = rainFrame(track, hour);
  if (!f || !(maxMm > 0)) return [];
  const h = Math.max(hour, track.keys[0]?.hour ?? 0);
  const { phases, cells } = shapeOf(track.seed);
  const th = (track.axisDeg * Math.PI) / 180;
  const ax = { e: Math.cos(th), n: Math.sin(th) };
  const nx = { e: -Math.sin(th), n: Math.cos(th) };
  const kmLng = KM_LAT * Math.cos((anchor.lat * Math.PI) / 180);
  const at = (east: number, north: number): GeoPoint => ({
    lat: round5(anchor.lat + north / KM_LAT),
    lng: round5(anchor.lng + east / kmLng),
  });
  /** 帯の芯からの位置 p（km、北東が正）の縁の振れ。時刻で北東へ流れる。段の輪で同じ値なので入れ子が崩れない */
  const wave = (side: 0 | 1, p: number) =>
    WAVES.reduce((s, w, j) => s + w.amp * Math.sin((2 * Math.PI * (p - track.flow * h)) / w.length + phases[side][j]), 0);

  /** 帯の段の輪（reach は帯の大きさに対する割合） */
  const bandRing = (reach: number): GeoPoint[] => {
    const lenScale = Math.pow(reach, LEN_POW);
    const half = (f.length * lenScale) / 2;
    const width = f.width * reach;
    const mid = CORE_SHIFT * (1 - lenScale) * f.length;
    const point = (x: number, side: 0 | 1) => {
      const u = mid + x * half;
      const w = width * Math.pow(Math.max(0, 1 - x * x), 0.55) * (1 + wave(side, u)) * (side === 0 ? 1 : -1);
      return at(f.east + ax.e * u + nx.e * w, f.north + ax.n * u + nx.n * w);
    };
    const ring: GeoPoint[] = [];
    for (let i = 0; i <= SIDE_POINTS; i++) ring.push(point(-Math.cos((Math.PI * i) / SIDE_POINTS), 0));
    for (let i = SIDE_POINTS - 1; i >= 1; i--) ring.push(point(-Math.cos((Math.PI * i) / SIDE_POINTS), 1));
    return ring;
  };

  /** 小さな雨の今の大きさ（km）と芯の降水量。出ていなければ null */
  const live = cells.flatMap((c) => {
    const age = (h - c.from) / c.life;
    if (age <= 0 || age >= 1) return [];
    const grow = Math.sin(Math.PI * age);
    const r = c.radius * grow;
    if (r < 0.25) return [];
    const base = CELL_PEAK.min + ((CELL_PEAK.max - CELL_PEAK.min) * (c.radius - 0.6)) / 0.6;
    const peak = Math.min(base * grow, f.peak);
    const u = c.along * f.length;
    const v = c.across * f.width;
    return [{ c, r, peak, ce: f.east + ax.e * u + nx.e * v, cn: f.north + ax.n * u + nx.n * v }];
  });
  const cellRing = (x: (typeof live)[number], reach: number): GeoPoint[] => {
    const ring: GeoPoint[] = [];
    for (let i = 0; i < CELL_POINTS; i++) {
      const a = (2 * Math.PI * i) / CELL_POINTS;
      const rr = x.r * reach * (1 + 0.22 * Math.sin(2 * a + x.c.phase) + 0.1 * Math.sin(3 * a + 2 * x.c.phase));
      const along = Math.cos(a) * rr * 1.4;
      const across = Math.sin(a) * rr;
      ring.push(at(x.ce + ax.e * along + nx.e * across, x.cn + ax.n * along + nx.n * across));
    }
    return ring;
  };

  const out: RainBand[] = [];
  for (const step of RAIN_STEPS) {
    if (step.min >= maxMm) break;
    const reach = rainReach(f.peak, step.min);
    if (reach >= MIN_REACH) out.push({ ring: bandRing(reach), min: step.min, main: true });
    for (const x of live) {
      const cr = rainReach(x.peak, step.min);
      if (cr >= MIN_REACH * 4) out.push({ ring: cellRing(x, cr), min: step.min, main: false });
    }
  }
  return out;
}
