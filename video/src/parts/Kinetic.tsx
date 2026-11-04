// 文字が主役の画面（話の段 S1〜S3・S9）。声が言う言葉を、言う所で 1 つずつ出す。
// 強弱は字の大きさの段（TYPE）と行の置き方で付け、動きは今の決まり（motion.ts の rise。下から上がって濃くなる）だけ。
// - 新しい行が出ると、行のかたまりは舞台の上下の真ん中を保ったまま上へ滑る（行の高さが 0 から伸びるので、前の行が押し上がる）
// - 後ろの行が出ると、前の行は小さな字の色に下がる（声が今どこを言っているかを目で追える）。hold の言葉は下げない
// - mark の行は左に 6px の帯（表の強調・名札と同じ形）が上から伸びる
// 使わない物: 1 字ずつ打つ動き、跳ねる・大きくなって戻る動き、斜体、字間、行ごとに書体を変えること。
import React from "react";
import { useCurrentFrame } from "remotion";
import { usePalette } from "../ground";
import { FONT, TYPE } from "../theme";
import { mix, progress, rise } from "./motion";

export type KineticWord = {
  text: string;
  /** 出るコマ（絵の頭から） */
  frame: number;
  size: "display" | "hero" | "h1" | "h2";
  row: number;
  hold?: boolean;
  mark?: boolean;
};

/** 行の高さ（字の大きさ × 行の高さの割合）と行の間 */
const LINE_HEIGHT = 1.18;
const ROW_GAP = 14;
/** 行が伸びる長さと、前の行が下がる長さ（コマ） */
const GROW = 14;
const DIM = 10;

export const Kinetic: React.FC<{ words: KineticWord[]; align?: "left" | "center"; width?: number }> = ({ words, align = "left", width }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const rows = [...new Set(words.map((w) => w.row))].sort((a, b) => a - b);
  const startOf = (row: number) => Math.min(...words.filter((w) => w.row === row).map((w) => w.frame));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", width, fontFamily: FONT.main }}>
      {rows.map((row, i) => {
        const inRow = words.filter((w) => w.row === row);
        const start = startOf(row);
        const size = Math.max(...inRow.map((w) => TYPE[w.size]));
        const grow = progress(frame, start, GROW);
        const height = (size * LINE_HEIGHT + (i > 0 ? ROW_GAP : 0)) * grow;
        // 後ろの行のうち一番早く出る物が出たら下がる
        const next = rows.slice(i + 1).map(startOf);
        const dimAt = next.length ? Math.min(...next) : null;
        const marked = inRow.find((w) => w.mark);
        return (
          // 行の箱の高さだけを伸ばし、字は箱からはみ出して見せる（字は流れの中に置くので、かたまりの幅は一番長い行になる）
          <div key={row} style={{ height, flex: "none" }}>
            <div
              style={{
                position: "relative",
                paddingTop: i > 0 ? ROW_GAP : 0,
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                whiteSpace: "nowrap",
                lineHeight: LINE_HEIGHT,
              }}
            >
              {marked ? (
                <div
                  style={{
                    position: "absolute",
                    left: -30,
                    top: (i > 0 ? ROW_GAP : 0) + size * 0.12,
                    width: 6,
                    height: size * LINE_HEIGHT * 0.8,
                    background: p.fg,
                    transformOrigin: "top",
                    transform: `scaleY(${progress(frame, marked.frame + 4, 12)})`,
                  }}
                />
              ) : null}
              {inRow.map((w) => {
                const down = dimAt !== null && !w.hold ? progress(frame, dimAt, DIM) : 0;
                return (
                  <span key={w.text} style={{ fontSize: TYPE[w.size], fontWeight: 600, color: down > 0 ? mix(p.fg, p.sub, down) : p.fg, ...rise(frame, w.frame, Math.round(TYPE[w.size] * 0.22), 16) }}>
                    {w.text}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
