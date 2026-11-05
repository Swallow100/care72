// 作品の印（ロゴ）。アプリの components/login/Mark72.tsx と同じ形と色（ライトの --mark-d1〜d3 と --ink）。ロゴを替えたらここも替える。
// 発災からの 72 時間を 1 周の輪にし、3 つの切れ目で 24 時間ごとの日に分け、日ごとに同じ青の濃淡（1 日目がいちばん濃い）。
// 12 時から時計回りに、1 日目から順に弧が描かれて満ちる（アプリで開いたときと同じ動き。動画では少しゆっくり）。「72」は最初から出ている。
import React from "react";
import { useCurrentFrame } from "remotion";
import { EASE_OUT, progress } from "./motion";

const R = 40;
const STROKE = 9;
/** 日の切れ目の幅（度） */
const GAP = 7;
/** 1 日分の弧の長さ */
const DAY_LEN = (2 * Math.PI * R * (120 - GAP)) / 360;

function arcPath(a0: number, a1: number): string {
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const p = (a: number) => `${(50 + R * Math.cos(rad(a))).toFixed(2)} ${(50 + R * Math.sin(rad(a))).toFixed(2)}`;
  return `M${p(a0)} A${R} ${R} 0 0 1 ${p(a1)}`;
}

const DAYS = [0, 120, 240].map((s) => arcPath(s + GAP / 2, s + 120 - GAP / 2));

/** 「72」の輪郭（Inter 800。アプリの MARK_DIGITS と同じ） */
const DIGITS =
  "M37.92 63.67L31.53 63.67L42.12 42.67L42.12 42.51L29.73 42.51L29.73 37.48L48.58 37.48L48.58 42.56L37.92 63.67Z" +
  "M70.27 63.67L50.97 63.67L50.97 59.22L60.49 50.80Q61.58 49.82 62.35 48.98Q63.11 48.15 63.52 47.32Q63.92 46.50 63.92 45.50" +
  "L63.92 45.50Q63.92 44.41 63.44 43.62Q62.96 42.84 62.12 42.42Q61.29 42.00 60.20 42.00L60.20 42.00Q59.09 42.00 58.26 42.44" +
  "Q57.44 42.88 56.98 43.72Q56.52 44.56 56.52 45.76L56.52 45.76L50.62 45.76Q50.62 43.11 51.82 41.17Q53.02 39.24 55.19 38.18" +
  "Q57.35 37.13 60.21 37.13L60.21 37.13Q63.17 37.13 65.35 38.12Q67.54 39.11 68.74 40.90Q69.93 42.68 69.93 45.02L69.93 45.02" +
  "Q69.93 46.52 69.35 47.97Q68.76 49.42 67.22 51.21Q65.68 53.00 62.83 55.46L62.83 55.46L59.58 58.49L59.58 58.66L70.27 58.66L70.27 63.67Z";

/** アプリのライトの色（app/globals.css の --mark-d1〜d3 と --ink） */
const DAY_COLORS = ["#0b4ea6", "#116bdf", "#6fa6ee"];
export const LOGO_INK = "#161b21";

/**
 * 青地に置く白い印（S3 の 72 時間の輪と、3 本立ての見出し）。形はロゴのまま、色だけ白にする（ロゴの青は青地で沈むため）。
 * drawn は日ごとの弧の描けた割合、lit は日ごとの明るさ（1 で白、0 で地に沈む薄い白）、spin は弧だけを回す角度（「72」は回さない）。
 * mark は「72」に白い帯（parts/Marker.tsx と同じ形: 白い面が左から伸び、帯の上の字は地の色）。children は同じ 100 の升の上に描く物（目盛りなど）
 */
export const LogoMark: React.FC<{
  size: number;
  drawn?: number[];
  lit?: number[];
  spin?: number;
  digits?: number;
  mark?: number;
  /** 帯を消すときの濃さ（帯の長さは mark のまま。長さで縮めると左に細い線が残る） */
  markOpacity?: number;
  fg: string;
  bg: string;
  children?: React.ReactNode;
}> = ({ size, drawn = [1, 1, 1], lit = [1, 1, 1], spin = 0, digits = 1, mark = 0, markOpacity = 1, fg, bg, children }) => {
  const id = `m${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // 帯は「72」の外に 3 の余白。左から伸びる
  const box = { x: 26.5, y: 34, w: 47, h: 33 };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", overflow: "visible" }}>
      <g transform={`rotate(${spin.toFixed(3)} 50 50)`}>
        {DAYS.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={fg}
            strokeOpacity={0.3 + 0.7 * Math.max(0, Math.min(1, lit[i] ?? 1))}
            strokeWidth={STROKE}
            strokeDasharray={DAY_LEN}
            strokeDashoffset={DAY_LEN * (1 - Math.max(0, Math.min(1, drawn[i] ?? 1)))}
          />
        ))}
      </g>
      {children}
      <path d={DIGITS} fill={fg} opacity={digits} />
      {mark > 0 && markOpacity > 0 ? (
        <>
          <clipPath id={id}>
            <rect x={box.x} y={box.y} width={box.w * mark} height={box.h} />
          </clipPath>
          <g clipPath={`url(#${id})`} opacity={markOpacity}>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={2} fill={fg} />
            <path d={DIGITS} fill={bg} />
          </g>
        </>
      ) : null}
    </svg>
  );
};

/** 印の 100 の升の中の輪の半径と太さ（目盛りを輪にそろえて描くため） */
export const MARK_RING = { r: R, stroke: STROKE, gap: GAP } as const;

/** start のコマから len コマで 3 つの日の弧を順に描く。最後の日だけゆるめて止める（アプリと同じ） */
export const Logo: React.FC<{ size: number; start: number; len: number }> = ({ size, start, len }) => {
  const frame = useCurrentFrame();
  const each = len / DAYS.length;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }}>
      {DAYS.map((d, i) => {
        const t = progress(frame, start + i * each, each, i === DAYS.length - 1 ? EASE_OUT : (x) => x);
        return <path key={i} d={d} fill="none" stroke={DAY_COLORS[i]} strokeWidth={STROKE} strokeDasharray={DAY_LEN} strokeDashoffset={DAY_LEN * (1 - t)} />;
      })}
      <path d={DIGITS} fill={LOGO_INK} />
    </svg>
  );
};
