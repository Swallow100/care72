"use client";
// 作品の印: 72 時間の輪（11/4 に作者が B1 を選んだ。DECISIONS 11/4 13:1x）。発災からの 72 時間を 1 周の輪にし、
// 3 つの切れ目で 24 時間ごとの日に分け、日ごとに同じ青の濃淡（1 日目がいちばん濃い）で塗る。状態の色は使わない（安否の意味ではないため）。
// 「72」は Inter（OFL）の 800 の字形を輪郭に起こした図形で、墨の外形の中心を輪の中心に置く（文字で置くと書体の作りで中心がずれる）。
// 開いたときに 1 日目から順に一度だけ満ちる（12 時から時計回り、合わせて 1.1 秒）。常時は動かさない。
// 動きを減らす設定と animate が無い環境、still を付けたとき（ヘッダーの左上。T66）は満ちた形で止める。
// 画面からは components/brand/BrandMark を通して読む。色は globals.css の --mark-d1〜d3（ダークで沈まないように明るくする）。

import { useEffect, useRef } from "react";

const R = 40;
const STROKE = 9;
/** 日の切れ目の幅（度） */
const GAP = 7;
/** 1 日分の弧の長さ */
const DAY_LEN = ((2 * Math.PI * R) * (120 - GAP)) / 360;

function arcPath(a0: number, a1: number): string {
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const p = (a: number) => `${(50 + R * Math.cos(rad(a))).toFixed(2)} ${(50 + R * Math.sin(rad(a))).toFixed(2)}`;
  return `M${p(a0)} A${R} ${R} 0 0 1 ${p(a1)}`;
}

/** 3 つの日の弧（12 時から時計回り） */
export const MARK_DAYS = [0, 120, 240].map((s) => arcPath(s + GAP / 2, s + 120 - GAP / 2));

/** 「72」の輪郭（Inter 800、viewBox 0 0 100 100 の中心に置いた物。scratchpad の logo/tool/make.cjs で作った） */
export const MARK_DIGITS =
  "M37.92 63.67L31.53 63.67L42.12 42.67L42.12 42.51L29.73 42.51L29.73 37.48L48.58 37.48L48.58 42.56L37.92 63.67Z" +
  "M70.27 63.67L50.97 63.67L50.97 59.22L60.49 50.80Q61.58 49.82 62.35 48.98Q63.11 48.15 63.52 47.32Q63.92 46.50 63.92 45.50" +
  "L63.92 45.50Q63.92 44.41 63.44 43.62Q62.96 42.84 62.12 42.42Q61.29 42.00 60.20 42.00L60.20 42.00Q59.09 42.00 58.26 42.44" +
  "Q57.44 42.88 56.98 43.72Q56.52 44.56 56.52 45.76L56.52 45.76L50.62 45.76Q50.62 43.11 51.82 41.17Q53.02 39.24 55.19 38.18" +
  "Q57.35 37.13 60.21 37.13L60.21 37.13Q63.17 37.13 65.35 38.12Q67.54 39.11 68.74 40.90Q69.93 42.68 69.93 45.02L69.93 45.02" +
  "Q69.93 46.52 69.35 47.97Q68.76 49.42 67.22 51.21Q65.68 53.00 62.83 55.46L62.83 55.46L59.58 58.49L59.58 58.66L70.27 58.66L70.27 63.67Z";

const DAY_COLORS = ["var(--mark-d1)", "var(--mark-d2)", "var(--mark-d3)"];

export function Mark72({ size = 56, still = false, className = "" }: { size?: number; still?: boolean; className?: string }) {
  const arcs = useRef<(SVGPathElement | null)[]>([]);
  useEffect(() => {
    const els = arcs.current.filter((e): e is SVGPathElement => e !== null);
    if (still || els.length === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || els.some((e) => typeof e.animate !== "function")) {
      for (const e of els) e.style.strokeDashoffset = "0";
      return;
    }
    const each = 1100 / els.length;
    const runs = els.map((e, i) =>
      e.animate([{ strokeDashoffset: DAY_LEN }, { strokeDashoffset: 0 }], {
        duration: each,
        delay: 120 + i * each,
        easing: i === els.length - 1 ? "cubic-bezier(.2,.7,.2,1)" : "linear",
        fill: "both",
      }),
    );
    return () => runs.forEach((r) => r.cancel());
  }, [still]);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      {MARK_DAYS.map((d, i) => (
        <path
          key={i}
          ref={(el) => {
            arcs.current[i] = el;
          }}
          d={d}
          fill="none"
          stroke={DAY_COLORS[i]}
          strokeWidth={STROKE}
          strokeDasharray={DAY_LEN}
          strokeDashoffset={still ? 0 : DAY_LEN}
        />
      ))}
      <path d={MARK_DIGITS} fill="var(--ink)" />
    </svg>
  );
}
