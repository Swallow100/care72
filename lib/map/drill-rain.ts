// 訓練の地図の想定の雨（docs/tasks/T103.md）。筋書きの雨の表（lib/drill/rain.ts）の種と時刻ごとの形から、雨の帯の輪を作る。
// - 線状に並ぶ雨の帯: 芯の線に沿って幅を変え、縁は種で決めた凹凸（いくつかの波の和）。凹凸は時刻で帯に沿って北東へ流れる
// - 強さの段は入れ子（弱が広く、強・猛は帯の南西寄りの芯）。段の大きさは表の power で育ち、縮む
// - 帯のまわりに弱い小さな雨を種から 3 つ（出て、育って、消える）
// - 時刻は小数でよい（連続の時計の分まで）。表の時刻の間は線で補う。最後の時刻のあとは雨なし
// - 位置は利用者の位置の範囲の真ん中から km で置き、緯度経度は 5 桁に丸める。時計も乱数も読まない（サーバーと手元で同じ絵）
// 雨は色と連絡順に使わない。地点ごとの雨量や危険度も作らない（絵だけ）。

import type { GeoPoint } from "../db/types.ts";
import type { RainKey, RainTrack } from "../drill/rain.ts";
import { DEFAULT_CENTER } from "./center.ts";
import { seeded } from "./seeded.ts";

/** 雨雲の輪 1 つ。strength は 1 弱・2 強・3 猛。main は帯の段（false は帯のまわりの小さな雨） */
export type RainBand = { ring: GeoPoint[]; strength: 1 | 2 | 3; main: boolean };

/** 見ている時刻の帯の形（表の時刻の間を線で補った物） */
export type RainFrame = Omit<RainKey, "hour">;

const KM_LAT = 111.32;
/** 段が出る強さの余り（power が段の下の値をこれだけ越えたら描く） */
const SHOW = 0.05;
/** 段ごとの帯の長さ・幅（弱に対する割合）と芯のずれ（帯の長さに対する割合。南西寄り） */
const TIER: Record<RainBand["strength"], { len: number; wid: number; shift: number }> = {
  1: { len: 1, wid: 1, shift: 0 },
  2: { len: 0.6, wid: 0.55, shift: -0.12 },
  3: { len: 0.3, wid: 0.3, shift: -0.16 },
};
/** 縁の凹凸の波（km の波長と、幅に対する振れ） */
const WAVES = [
  { length: 8.5, amp: 0.17 },
  { length: 4.7, amp: 0.11 },
  { length: 2.6, amp: 0.07 },
] as const;
/** 帯の片側の点の数（両端は尖らせて 1 つ） */
const SIDE_POINTS = 30;
/** 小さな雨の数と点の数 */
const CELLS = 3;
const CELL_POINTS = 16;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 見ている時刻の形。最初の時刻より前は最初の形、最後の時刻のあと・強さ 0 は null（雨なし） */
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
      power: lerp(a.power, b.power, t),
    };
  }
  return frame.power > SHOW ? frame : null;
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

/** 種から作る縁の波の位相と小さな雨の置き方（同じ種なら同じ） */
function shapeOf(seed: number) {
  const rand = seeded(seed);
  const phases = ([1, -1] as const).map(() => WAVES.map(() => rand() * Math.PI * 2));
  const cells = Array.from({ length: CELLS }, () => ({
    along: rand() * 0.8 - 0.4,
    across: (1.7 + rand() * 0.9) * (rand() < 0.5 ? -1 : 1),
    radius: 0.8 + rand() * 0.8,
    from: rand() * 8,
    life: 5 + rand() * 8,
    phase: rand() * Math.PI * 2,
  }));
  return { phases, cells };
}

/**
 * 見ている時刻の雨の輪（弱の帯 → 小さな雨 → 強 → 猛 の順）。strengths は描いてよい段（見ている時刻の警戒レベルまで。
 * lib/map/demo.ts の RAIN_STRENGTHS）。空なら雨なし
 */
export function drillRain(
  track: RainTrack,
  hour: number,
  strengths: ReadonlyArray<RainBand["strength"]>,
  anchor: GeoPoint,
): RainBand[] {
  const f = rainFrame(track, hour);
  if (!f || strengths.length === 0) return [];
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
  /** 帯の芯からの位置 p（km、北東が正）の縁の振れ。時刻で北東へ流れる */
  const wave = (side: 0 | 1, p: number) =>
    WAVES.reduce((s, w, j) => s + w.amp * Math.sin((2 * Math.PI * (p - track.flow * h)) / w.length + phases[side][j]), 0);

  const out: RainBand[] = [];
  for (const k of [1, 2, 3] as const) {
    if (!strengths.includes(k)) continue;
    const over = f.power - (k - 1);
    if (over <= SHOW) continue;
    const t = TIER[k];
    const scale = 0.55 + 0.45 * clamp01(over);
    const half = (f.length * t.len * scale) / 2;
    const width = f.width * t.wid * scale;
    const mid = t.shift * f.length;
    const point = (x: number, side: 0 | 1) => {
      const u = mid + x * half;
      const w = width * Math.pow(Math.max(0, 1 - x * x), 0.55) * (1 + wave(side, u)) * (side === 0 ? 1 : -1);
      return at(f.east + ax.e * u + nx.e * w, f.north + ax.n * u + nx.n * w);
    };
    const ring: GeoPoint[] = [];
    for (let i = 0; i <= SIDE_POINTS; i++) ring.push(point(-Math.cos((Math.PI * i) / SIDE_POINTS), 0));
    for (let i = SIDE_POINTS - 1; i >= 1; i--) ring.push(point(-Math.cos((Math.PI * i) / SIDE_POINTS), 1));
    out.push({ ring, strength: k, main: true });

    if (k === 1) {
      for (const c of cells) {
        const age = (h - c.from) / c.life;
        if (age <= 0 || age >= 1) continue;
        const r = c.radius * Math.sin(Math.PI * age) * scale;
        if (r < 0.25) continue;
        const u = c.along * f.length;
        const v = c.across * f.width;
        const ce = f.east + ax.e * u + nx.e * v;
        const cn = f.north + ax.n * u + nx.n * v;
        const cell: GeoPoint[] = [];
        for (let i = 0; i < CELL_POINTS; i++) {
          const a = (2 * Math.PI * i) / CELL_POINTS;
          const rr = r * (1 + 0.22 * Math.sin(2 * a + c.phase) + 0.1 * Math.sin(3 * a + 2 * c.phase));
          const along = Math.cos(a) * rr * 1.4;
          const across = Math.sin(a) * rr;
          cell.push(at(ce + ax.e * along + nx.e * across, cn + ax.n * along + nx.n * across));
        }
        out.push({ ring: cell, strength: 1, main: false });
      }
    }
  }
  return out;
}
