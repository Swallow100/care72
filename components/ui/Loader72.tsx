"use client";

// AI の待ちの印（T44）。ログインの印（components/login/Mark72.tsx）と同じ輪で、操作の色の弧が回り続ける。
// 輪の地は薄い本文色、弧は操作の色（状態の色は使わない。安否の意味ではないため）。3 つの切れ目は Mark72 と同じ 24 時間ごとの日。
// 動きは CSS に足さず Web Animations で付ける。動きを減らす設定と animate の無い環境では、輪を出さず文字だけ（止めて文字だけ）。
// role="status" で読み上げる。文字は呼ぶ側が渡す（lib/ui/labels.ts の WAIT_LABELS: 分けています・考えています・聞いています）。
// 本人のスマホではふりがなの付いた言葉を渡せるよう、文字は ReactNode。ボタンの待ち（SubmitButton の灰色）と並べて出す。

import { useEffect, useRef, useState, type ReactNode } from "react";

const R = 40;
const CIRC = 2 * Math.PI * R;
/** 回る弧の長さ（輪の 1/4） */
const ARC = CIRC / 4;
/** 日の切れ目（0・24・48 時間の所）。12 時から時計回りの角度 */
const DAYS = [0, 120, 240];
/** 1 周の時間（ms） */
export const LOADER_CYCLE_MS = 1200;

export type LoaderMotion = "spin" | "still";

/** 回すか止めるか。動きを減らす設定か、animate が無い環境では止める（輪を出さず文字だけ） */
export function loaderMotion(env: { reducedMotion: boolean; canAnimate: boolean }): LoaderMotion {
  return env.reducedMotion || !env.canAnimate ? "still" : "spin";
}

/** live は読み上げの欄（role="status"）にするか。呼ぶ側の欄がもう status なら false（入れ子にしない） */
export function Loader72({ label, size = 20, live = true, className = "" }: { label: ReactNode; size?: number; live?: boolean; className?: string }) {
  const arc = useRef<SVGGElement>(null);
  // サーバーの描画と最初の描画は輪を出す（設定は描いたあとに読む）
  const [motion, setMotion] = useState<LoaderMotion>("spin");

  useEffect(() => {
    const el = arc.current;
    const next = loaderMotion({
      reducedMotion: Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
      canAnimate: typeof el?.animate === "function",
    });
    setMotion(next);
    if (next === "still" || !el) return;
    const spin = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
      duration: LOADER_CYCLE_MS,
      iterations: Infinity,
      easing: "linear",
    });
    return () => spin.cancel();
  }, []);

  return (
    <span role={live ? "status" : undefined} aria-live={live ? "polite" : undefined} className={`inline-flex items-center gap-2 ${className}`.trim()} data-loader={motion}>
      {motion === "spin" && (
        <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="block shrink-0">
          {/* 輪の地（薄い本文色の灰色） */}
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--muted)" strokeOpacity=".3" strokeWidth="12" />
          {/* 回る弧（操作の色）。中心を軸に回す */}
          <g ref={arc} style={{ transformBox: "view-box", transformOrigin: "50px 50px" }}>
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="12"
              strokeDasharray={`${ARC} ${CIRC}`}
              transform="rotate(-90 50 50)"
            />
          </g>
          {/* 日の切れ目（面の色で輪を切る） */}
          {DAYS.map((deg) => (
            <line key={deg} x1="50" y1="2" x2="50" y2="18" stroke="var(--panel)" strokeWidth="4" transform={`rotate(${deg} 50 50)`} />
          ))}
        </svg>
      )}
      <span>{label}</span>
    </span>
  );
}
