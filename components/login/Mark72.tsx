"use client";
// ログインと役選択の印: 72 時間の輪。発災からの 72 時間を 1 周の輪にし、3 つの切れ目が 24 時間ごとの日。
// 開いたときに操作の色の輪が一度だけ回って満ちる（12 時から時計回り、1.1 秒）。常時は動かさない。
// 動きを減らす設定と animate が無い環境では、満ちた形で止める。動画の図「72 時間の輪」と同じ考え（docs/video/MATERIALS.md）。
// 色は本文色（数字）・薄い本文色（輪の地）・操作の色（満ちる輪）の 3 つだけ。状態の色は使わない（安否の意味ではないため）。
// still を付けると最初から満ちた形で動かさない（ヘッダーの左上。T66）。画面からは components/brand/BrandMark を通して読む。

import { useEffect, useRef } from "react";

const R = 40;
const CIRC = 2 * Math.PI * R;
/** 日の切れ目（0・24・48 時間の所）。12 時から時計回りの角度 */
const DAYS = [0, 120, 240];

export function Mark72({ size = 56, still = false, className = "" }: { size?: number; still?: boolean; className?: string }) {
  const arc = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const el = arc.current;
    if (!el || still) return;
    if (typeof el.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.strokeDashoffset = "0";
      return;
    }
    const fill = el.animate([{ strokeDashoffset: CIRC }, { strokeDashoffset: 0 }], {
      duration: 1100,
      delay: 120,
      easing: "cubic-bezier(.2,.7,.2,1)",
      fill: "both",
    });
    return () => fill.cancel();
  }, [still]);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      {/* 輪の地（薄い本文色の灰色） */}
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--muted)" strokeOpacity=".3" strokeWidth="9" />
      {/* 満ちる輪（操作の色）。最初は空で、開いたときに一度だけ満ちる */}
      <circle
        ref={arc}
        cx="50"
        cy="50"
        r={R}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="9"
        strokeDasharray={CIRC}
        strokeDashoffset={still ? 0 : CIRC}
        transform="rotate(-90 50 50)"
      />
      {/* 日の切れ目（面の色で輪を切る） */}
      {DAYS.map((deg) => (
        <line key={deg} x1="50" y1="4" x2="50" y2="16" stroke="var(--panel)" strokeWidth="3" transform={`rotate(${deg} 50 50)`} />
      ))}
      <text
        x="50"
        y="51"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="36"
        fontWeight="700"
        fill="var(--ink)"
        style={{ fontFamily: "inherit" }}
      >
        72
      </text>
    </svg>
  );
}
