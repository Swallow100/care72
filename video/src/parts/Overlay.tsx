// 舞台の外に置く物: 字幕、上の見出しの帯（段の名前と 72 時間の線）、出典、「利用者は架空」、「イメージ（AI 生成）」。
// どれも置き場所を 1 つに決め、場面ごとに動かさない。字は地の逆の色（青地に白、薄い青の地に青）。
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { usePalette } from "../ground";
import { FONT, LAYOUT, TYPE } from "../theme";
import type { Line } from "../timeline";
import { progress } from "./motion";

/**
 * 字幕。舞台の下の帯に、帯の面を敷かずに地の逆の色の字で。文の中の「／」で改行し、無ければ行の長さをそろえて折る（1 字だけの行を作らない）。
 * 出入りは 5 コマで薄く。
 */
export const Subtitle: React.FC<{ line: Line; duration: number; showEn: boolean }> = ({ line, duration, showEn }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const opacity = interpolate(frame, [0, 5, duration - 5, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rows = splitLine(line.ja);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: LAYOUT.subtitle.top,
        height: LAYOUT.subtitle.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          maxWidth: LAYOUT.subtitle.maxWidth,
          textAlign: "center",
          fontFamily: FONT.main,
          fontWeight: 600,
          fontSize: 42,
          lineHeight: 1.38,
          color: p.fg,
          whiteSpace: "nowrap",
        } as React.CSSProperties}
      >
        {rows.map((r, i) => (
          <div key={i}>{r}</div>
        ))}
      </div>
      {showEn ? (
        <div style={{ fontFamily: FONT.main, fontSize: 24, lineHeight: 1.35, color: p.sub, marginTop: 4, maxWidth: LAYOUT.subtitle.maxWidth, textAlign: "center" }}>
          {line.en}
        </div>
      ) : null}
    </div>
  );
};

/**
 * 字幕の行の分け方。「／」があればそこで。無ければ 28 字を超える文だけ、真ん中に一番近い「。」か「、」の後で 2 行に分ける
 * （日本語は言葉の切れ目が分からないので、ブラウザに任せると「計／画」のように語の途中で折れる）
 */
export function splitLine(text: string): string[] {
  if (text.includes("／")) return text.split("／");
  if (text.length <= 28) return [text];
  const mid = text.length / 2;
  let best = -1;
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i];
    if (c !== "。" && c !== "、") continue;
    const score = Math.abs(i + 1 - mid) - (c === "。" ? 4 : 0);
    if (best < 0 || score < Math.abs(best + 1 - mid) - (text[best] === "。" ? 4 : 0)) best = i;
  }
  return best < 0 ? [text] : [text.slice(0, best + 1), text.slice(best + 1)];
}

/**
 * 小さな注記（出典・イメージ・利用者は架空）。置き場所は 4 つの隅のどれか。
 * 話の段（見出しの帯の無い青地）の出典は左上（下の隅は 2 行の字幕と重なる）
 */
export const Caption: React.FC<{ text: string; corner: "bottomLeft" | "bottomRight" | "topRight" | "topLeft" }> = ({ text, corner }) => {
  const p = usePalette();
  const S = LAYOUT.stage;
  const pos: React.CSSProperties =
    corner === "bottomLeft"
      ? { left: S.left, top: S.top + S.height + 6 }
      : corner === "bottomRight"
        ? { right: 1920 - S.left - S.width, top: S.top + S.height + 6 }
        : corner === "topLeft"
          ? { left: LAYOUT.header.left, top: LAYOUT.header.top + 8 }
          : { right: LAYOUT.header.right, top: LAYOUT.header.top + 8 };
  return (
    <div style={{ position: "absolute", ...pos, color: p.sub, fontFamily: FONT.main, fontSize: TYPE.caption, whiteSpace: "nowrap" }}>{text}</div>
  );
};

/** 上の見出しの帯の 72 時間の線の目盛り（時間） */
const TICKS = [0, 6, 12, 24, 36, 48, 60, 72];

/**
 * 上の見出しの帯（道具の段 S4〜S7）。左に段の名前、真ん中に 72 時間の線（G4）。
 * progress は 0〜1（72 時間のうちどこか）。null なら線を出さない。アプリの 72 時間の棒と取り違えないよう、舞台の外の一番上に置く
 */
export const Header: React.FC<{ title: string; hours: number | null; state: string }> = ({ title, hours, state }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const H = LAYOUT.header;
  const lineLeft = H.left + 260;
  const lineWidth = 1920 - lineLeft - H.right - 220;
  const enter = progress(frame, 0, 14);
  const x = hours === null ? 0 : (Math.max(0, Math.min(72, hours)) / 72) * lineWidth;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: H.top + H.height, fontFamily: FONT.main, opacity: enter }}>
      <div style={{ position: "absolute", left: H.left, top: H.top, height: H.height, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 30, fontWeight: 600, color: p.fg }}>{title}</span>
        <span style={{ fontSize: TYPE.caption, color: p.sub }}>{state}</span>
      </div>
      {hours === null ? null : (
        <div style={{ position: "absolute", left: lineLeft, top: H.top + 12, width: lineWidth, height: 26 }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: lineWidth, height: 4, background: p.tint, borderRadius: 2 }} />
          <div style={{ position: "absolute", left: 0, top: 0, width: x, height: 4, background: p.fg, borderRadius: 2 }} />
          {TICKS.map((h) => {
            const tx = (h / 72) * lineWidth;
            const passed = tx <= x + 0.5;
            return (
              <React.Fragment key={h}>
                <div style={{ position: "absolute", left: tx - 1, top: -3, width: 2, height: 10, background: passed ? p.fg : p.tint }} />
                <div
                  style={{
                    position: "absolute",
                    left: tx,
                    top: 10,
                    transform: "translateX(-50%)",
                    fontSize: 16,
                    color: passed ? p.fg : p.sub,
                    whiteSpace: "nowrap",
                  }}
                >
                  {h === 72 ? "72 時間" : h}
                </div>
              </React.Fragment>
            );
          })}
          <div
            style={{
              position: "absolute",
              left: x - 7,
              top: -5,
              width: 14,
              height: 14,
              borderRadius: 7,
              background: p.fg,
            }}
          />
        </div>
      )}
    </div>
  );
};
