// 動きの決まり。出るときは下から 18px 上がりながら 14 コマで濃くなる（ease-out）。並ぶ物は 4 コマずつずらす。
// 跳ねる動き・行き過ぎて戻る動き・回る動きは使わない。強調の囲みは 10 コマで線が濃くなるだけ。
import { Easing, interpolate } from "remotion";

export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_IN_OUT = Easing.inOut(Easing.cubic);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0〜1 の進み。frame が start から len コマで 0 → 1 */
export function progress(frame: number, start: number, len: number, easing = EASE_OUT): number {
  return interpolate(frame, [start, start + Math.max(1, len)], [0, 1], { ...clamp, easing });
}

/** 出る動き（下から上がって濃くなる）。delay はコマ */
export function rise(frame: number, delay = 0, distance = 18, len = 14): React.CSSProperties {
  const t = progress(frame, delay, len);
  return { opacity: t, transform: `translateY(${(1 - t) * distance}px)` };
}

/** 並ぶ物の i 番目のずれ（コマ） */
export const STAGGER = 4;

/** 切り替えの長さ（コマ）。前の絵が薄くなり、次の絵が濃くなる */
export const CROSS = 10;

/** 16 進の色を t で混ぜる（地の色の切り替え） */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}
