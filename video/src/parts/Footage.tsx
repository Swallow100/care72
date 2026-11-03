// 録画 1 本を枠に描く。録画は静止画の連番（public/footage/<番号>/00001.jpg …、30fps）。
// OffthreadVideo を使わないのは、Windows で "No frame found" が出て書き出しが止まることがあるため（README の「Windows の罠」）。
import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Assets } from "../assets";
import { useGround } from "../ground";
import { COLOR, FONT } from "../theme";
import { RECORDINGS, type Rect } from "../timeline";

const pad = (n: number) => String(n).padStart(5, "0");

export const Footage: React.FC<{
  id: string;
  assets: Assets;
  width: number;
  height: number;
  from?: number;
  rate?: number;
  zoom?: [Rect, Rect];
  blur?: number;
  note?: string;
  /** 寄りの動きの長さ（コマ）。場面の長さを渡す */
  duration?: number;
}> = ({ id, assets, width, height, from = 0, rate = 1, zoom, blur, note, duration = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationInFrames = duration;
  const count = assets.footage[id] ?? 0;
  // 録画が無いか、使う所（from 秒から）が撮れた長さより後ろなら仮の面。最後のコマで止めて別の場面に見せない
  if (!id || count === 0 || from * fps >= count) return <Placeholder id={id} width={width} height={height} note={note} />;

  const index = Math.min(count, Math.max(1, Math.round(from * fps + frame * rate) + 1));
  let transform: string | undefined;
  if (zoom) {
    const t = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
    const x = zoom[0].x + (zoom[1].x - zoom[0].x) * t;
    const y = zoom[0].y + (zoom[1].y - zoom[0].y) * t;
    const w = zoom[0].w + (zoom[1].w - zoom[0].w) * t;
    const s = 1 / w;
    transform = `scale(${s}) translate(${-x * width}px, ${-y * height}px)`;
  }
  return (
    <div style={{ width, height, overflow: "hidden", position: "relative", background: COLOR.white }}>
      <Img
        src={staticFile(`footage/${id}/${pad(index)}.jpg`)}
        style={{
          width,
          height,
          objectFit: "contain",
          transformOrigin: "0 0",
          transform,
          filter: blur ? `blur(${blur}px)` : undefined,
        }}
      />
    </div>
  );
};

/**
 * 録画がまだ無い所の仮の面。「撮影待ち R07 訓練」と、何を撮るか（絵の説明）を出す。
 * 白地では青の面に白の字、青地では地と溶けないよう白の面に青の字。録画を置いて npm run scan を流すと、この面が録画に替わる
 */
export const Placeholder: React.FC<{ id: string; width: number; height: number; note?: string }> = ({
  id,
  width,
  height,
  note,
}) => {
  const ground = useGround();
  const onBlue = ground === "blue";
  const name = RECORDINGS[id];
  return (
    <div
      style={{
        width,
        height,
        background: onBlue ? COLOR.white : COLOR.blue,
        color: onBlue ? COLOR.blue : COLOR.white,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: Math.min(18, width / 50),
        textAlign: "center",
        padding: 24,
        boxSizing: "border-box",
        borderRadius: 4,
        fontFamily: FONT.main,
      }}
    >
      <div style={{ fontSize: Math.min(64, width / 12), fontWeight: 600 }}>撮影待ち {id}</div>
      {name ? <div style={{ fontSize: Math.min(48, width / 16), fontWeight: 600 }}>{name}</div> : null}
      {note ? (
        <div style={{ fontSize: Math.min(28, width / 24), maxWidth: width * 0.85, color: onBlue ? COLOR.blueLight : COLOR.onBlueSub }}>{note}</div>
      ) : null}
    </div>
  );
};
