// 録画 1 本を枠に描く。録画は静止画の連番（public/footage/<番号>/00001.jpg …、30fps）。
// OffthreadVideo を使わないのは、Windows で "No frame found" が出て書き出しが止まることがあるため（README の「Windows の罠」）。
import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Assets } from "../assets";
import { useGround } from "../ground";
import { COLOR } from "../theme";
import type { Rect } from "../timeline";

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
  if (!id || count === 0) return <Placeholder id={id} width={width} height={height} note={note} />;

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

/** 素材が無い間の仮の面。何を撮って置くかを書く。白地では薄い青の面、青地では白の面に青の字 */
export const Placeholder: React.FC<{ id: string; width: number; height: number; note?: string }> = ({
  id,
  width,
  height,
  note,
}) => {
  const ground = useGround();
  return (
    <div
      style={{
        width,
        height,
        background: ground === "blue" ? COLOR.white : COLOR.blueTint,
        color: COLOR.blue,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
        padding: 24,
        boxSizing: "border-box",
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: Math.min(64, width / 10), fontWeight: 600 }}>{id || "文字"}</div>
      {note ? <div style={{ fontSize: Math.min(30, width / 22), maxWidth: width * 0.85 }}>{note}</div> : null}
      {id ? <div style={{ fontSize: Math.min(22, width / 30), color: COLOR.blueLight }}>素材なし public/footage/{id}/</div> : null}
    </div>
  );
};
