// 白い帯（マーカー）。絵ごとに一番の言葉 1 つだけに、字の色の面が左から右へさっと引かれ、帯の上の字は地の色に変わる。
// 青地では白い帯に青い字、薄い青の地では青い帯に薄い字（どの場面でも同じ形）。角は 4px、光らせない・ぼかさない・行き過ぎない。
// 帯と、帯の上の字の写しは同じ箱（左右に 0.14em の余白）を同じ割合で切るので、帯の端と字の色の替わり目がそろう。
import React from "react";
import { useCurrentFrame } from "remotion";
import { usePalette } from "../ground";
import { progress } from "./motion";

/** 帯が引かれる長さ（コマ） */
export const MARKER_SWEEP = 10;

export const Marker: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const t = progress(frame, at, MARKER_SWEEP);
  const right = ((1 - t) * 100).toFixed(2);
  const pad = "0 0.14em";
  return (
    <span style={{ position: "relative", display: "inline-block", padding: pad, margin: "0 -0.14em", whiteSpace: "nowrap" }}>
      {/* 帯の高さは字の大きさから（行の高さが 1 でも 1.18 でも字を覆う）。上下は字の真ん中から 0.56em ずつ */}
      {t > 0 ? (
        <span style={{ position: "absolute", left: 0, right: 0, top: "calc(50% - 0.56em)", height: "1.12em", background: p.fg, borderRadius: 4, clipPath: `inset(0 ${right}% 0 0)` }} />
      ) : null}
      <span style={{ position: "relative" }}>{children}</span>
      {/* 帯の上の字の写し（地の色）。上下は切らない（帯が字を覆うので、写しが帯の外に出ることはない） */}
      {t > 0 ? (
        <span aria-hidden style={{ position: "absolute", inset: 0, padding: pad, color: p.bg, clipPath: `inset(-50% ${right}% -50% 0)`, whiteSpace: "nowrap" }}>
          {children}
        </span>
      ) : null}
    </span>
  );
};
