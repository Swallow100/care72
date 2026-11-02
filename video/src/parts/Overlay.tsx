// 録画の上に重ねる物: 字幕、モデルの名前、出典、「利用者は架空」、上の 72 時間の線、強調の囲み。
// どれもアプリの枠の外か、アプリの画面と見分けが付く形（青か白の面）にする。
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { usePalette } from "../ground";
import { COLOR, FONT, LAYOUT } from "../theme";
import type { Ground, Line } from "../timeline";

/**
 * 字幕。日本語を大きく、英語をその下に小さく。出入りは 4 コマで薄く。
 * 青地では帯を敷かず白い字。白地（録画の上）では濃い青の帯に白い字（半透明にしない）。
 */
export const Subtitle: React.FC<{ line: Line; duration: number; showEn: boolean; ground: Ground }> = ({
  line,
  duration,
  showEn,
  ground,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 4, duration - 4, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const onBlue = ground === "blue";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: LAYOUT.subtitle.bottom,
        display: "flex",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          maxWidth: LAYOUT.subtitle.maxWidth,
          background: onBlue ? "transparent" : COLOR.blue,
          borderRadius: 6,
          padding: "10px 28px 12px",
          textAlign: "center",
        }}
      >
        <div style={{ fontFamily: FONT.main, fontWeight: 600, fontSize: 40, lineHeight: 1.35, color: COLOR.white }}>{line.ja}</div>
        {showEn ? (
          <div style={{ fontFamily: FONT.main, fontSize: 24, lineHeight: 1.35, color: COLOR.onBlueSub, marginTop: 4 }}>{line.en}</div>
        ) : null}
      </div>
    </div>
  );
};

/** 右上のモデルの名前。白い面に青の字と青の線（角は小さく） */
export const Chip: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: "absolute",
      top: LAYOUT.footage.top + 20,
      right: 1920 - LAYOUT.footage.left - LAYOUT.footage.width + 20,
      background: COLOR.white,
      color: COLOR.blue,
      fontFamily: FONT.main,
      fontWeight: 600,
      fontSize: 28,
      padding: "8px 16px",
      borderRadius: 6,
      border: `3px solid ${COLOR.blue}`,
    }}
  >
    {text}
  </div>
);

/** 左下の出典 */
export const Source: React.FC<{ text: string }> = ({ text }) => {
  const p = usePalette();
  return (
    <div
      style={{
        position: "absolute",
        left: LAYOUT.footage.left + 20,
        bottom: 150,
        color: p.sub,
        fontFamily: FONT.main,
        fontSize: 24,
      }}
    >
      出典 {text}
    </div>
  );
};

/** 右上の隅の「利用者は架空」 */
export const Fictional: React.FC = () => {
  const p = usePalette();
  return (
    <div
      style={{
        position: "absolute",
        top: 6,
        right: 1920 - LAYOUT.footage.left - LAYOUT.footage.width,
        color: p.sub,
        fontFamily: FONT.main,
        fontSize: 20,
      }}
    >
      利用者は架空
    </div>
  );
};

/** 上の細い 72 時間の線（G4）。progress は 0〜1。アプリの 72 時間の棒と取り違えないよう、枠の外の一番上に置く */
export const TopLine: React.FC<{ progress: number; label: string }> = ({ progress, label }) => {
  const p = usePalette();
  // 右の端は「利用者は架空」の文字に空ける
  const width = LAYOUT.footage.width - 420;
  return (
    <div style={{ position: "absolute", left: LAYOUT.footage.left, top: LAYOUT.topLine.top, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width, height: LAYOUT.topLine.height, background: p.tint, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: width * Math.max(0, Math.min(1, progress)), height: LAYOUT.topLine.height, background: p.fg }} />
      </div>
      <div style={{ fontFamily: FONT.main, fontSize: 18, color: p.sub, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
};

/** 強調の所の囲み（青の細い線、光らせない） */
export const Emphasis: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: LAYOUT.footage.left - 6,
      top: LAYOUT.footage.top - 6,
      width: LAYOUT.footage.width + 12,
      height: LAYOUT.footage.height + 12,
      border: `5px solid ${COLOR.blue}`,
      borderRadius: 4,
      boxSizing: "border-box",
    }}
  />
);
