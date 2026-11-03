// 録画 1 本を描く。録画は静止画の連番（public/footage/<番号>/00001.jpg …、30fps）。
// OffthreadVideo を使わないのは、Windows で "No frame found" が出て書き出しが止まることがあるため（README の「Windows の罠」）。
// 寄りが無い所も、場面の長さをかけて 2.5% だけゆっくり寄る（止まった絵に見せない）。画面の中身は描き直さない。
import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Assets } from "../assets";
import { useGround } from "../ground";
import { COLOR, FONT } from "../theme";
import { RECORDINGS, type Rect } from "../timeline";
import { EASE_IN_OUT } from "./motion";

const pad = (n: number) => String(n).padStart(5, "0");

const DRIFT: [Rect, Rect] = [
  { x: 0, y: 0, w: 1 },
  { x: 0.0125, y: 0.0125, w: 0.975 },
];

/** 今のコマの寄りの枠（録画の幅と高さに対する割合） */
export function zoomAt(frame: number, duration: number, zoom: [Rect, Rect] | undefined): Rect {
  const z = zoom ?? DRIFT;
  const t = interpolate(frame, [0, Math.max(1, duration - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  return { x: z[0].x + (z[1].x - z[0].x) * t, y: z[0].y + (z[1].y - z[0].y) * t, w: z[0].w + (z[1].w - z[0].w) * t };
}

/** 録画の中の秒（from 秒から rate の速さで） */
export function footageSeconds(frame: number, fps: number, from: number, rate: number): number {
  return from + (frame * rate) / fps;
}

export const Footage: React.FC<{
  id: string;
  assets: Assets;
  width: number;
  height: number;
  from?: number;
  rate?: number;
  zoom?: [Rect, Rect];
  /** 寄らない（ぼかした奥や、囲みの位置を録画のまま使う所） */
  still?: boolean;
  blur?: number;
  note?: string;
  /** 寄りの動きの長さ（コマ）。場面の長さを渡す */
  duration?: number;
}> = ({ id, assets, width, height, from = 0, rate = 1, zoom, still, blur, note, duration = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const count = assets.footage[id] ?? 0;
  // 録画が無いか、使う所（from 秒から）が撮れた長さより後ろなら仮の面。最後のコマで止めて別の場面に見せない
  if (!id || count === 0 || from * fps >= count) return <Placeholder id={id} width={width} height={height} note={note} />;

  const index = Math.min(count, Math.max(1, Math.round(footageSeconds(frame, fps, from, rate) * fps) + 1));
  const z = still ? { x: 0, y: 0, w: 1 } : zoomAt(frame, duration, zoom);
  const s = 1 / z.w;
  return (
    <div style={{ width, height, overflow: "hidden", position: "relative", background: COLOR.white }}>
      <Img
        src={staticFile(`footage/${id}/${pad(index)}.jpg`)}
        style={{
          width,
          height,
          objectFit: "contain",
          transformOrigin: "0 0",
          transform: `scale(${s}) translate(${-z.x * width}px, ${-z.y * height}px)`,
          filter: blur ? `blur(${blur}px)` : undefined,
        }}
      />
    </div>
  );
};

/**
 * 録画がまだ無い所の仮の面。「撮影待ち R07 訓練」と、何を撮るか（絵の説明）を出す。
 * 録画を置いて npm run scan を流すと、この面が録画に替わる
 */
export const Placeholder: React.FC<{ id: string; width: number; height: number; note?: string }> = ({ id, width, height, note }) => {
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
