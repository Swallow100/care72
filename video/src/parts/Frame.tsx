// 録画の枠。パソコンの画面は「窓」（上に青い帯と画面の名前）、本人・家族のスマホは「スマホ」（青い縁）に入れる。
// 枠は録画の外側だけ。道具の URL の欄やボタンのような、アプリに無い物は描かない。
// 録画の上に置くのは、細い線の囲みと、押した所の輪だけ（囲みの名前は囲みに付けた小さな面）。
import React from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Assets } from "../assets";
import { usePalette } from "../ground";
import { COLOR, FONT, LAYOUT, TYPE } from "../theme";
import { type Box, type Callout, RECORDINGS, type Rect } from "../timeline";
import { Footage, footageSeconds, zoomAt } from "./Footage";
import { progress, rise } from "./motion";

/** スマホの縦長の録画（375×812）。R08 の着信はケアマネの訓練の画面なので窓 */
export const PHONES = new Set(["R11", "R12"]);
const PHONE_RATIO = 375 / 812;
const BEZEL = 14;
/** 録画に寄る動きの大きさ（絵の間に 1.5%。窓の外の帯・字幕には届かない） */
const PUSH = 0.015;

export type FramedProps = {
  id: string;
  assets: Assets;
  /** 枠を入れる箱（枠の帯・縁を含む大きさ） */
  maxWidth: number;
  maxHeight: number;
  from?: number;
  rate?: number;
  zoom?: [Rect, Rect];
  duration: number;
  note?: string;
  chip?: string;
  callouts?: Callout[];
  /** 出る動きを遅らせる（コマ） */
  delay?: number;
  /** 窓の帯に出す画面の名前。無ければ録画の名前（1 本の録画の中で画面が替わるとき） */
  screen?: string;
  /** 録画に寄る動き（既定は寄る。円柱の窓は円柱が動くので寄らない） */
  push?: boolean;
  /** 録画を流し始めるのを遅らせる（コマ）。窓が出始めるところ（delay と同じ）から from 秒を流す */
  hold?: number;
};

/** 枠の大きさ（箱に収まる一番大きい物） */
export function framedSize(id: string, maxWidth: number, maxHeight: number): { width: number; height: number; phone: boolean } {
  if (PHONES.has(id)) {
    const height = maxHeight;
    const width = Math.round((height - BEZEL * 2) * PHONE_RATIO + BEZEL * 2);
    return { width, height, phone: true };
  }
  const contentH = Math.min(maxHeight - LAYOUT.windowBar, (maxWidth * 9) / 16);
  return { width: Math.round((contentH * 16) / 9), height: Math.round(contentH + LAYOUT.windowBar), phone: false };
}

export const Framed: React.FC<FramedProps> = (props) => {
  const frame = useCurrentFrame();
  const { id, maxWidth, maxHeight, delay = 0 } = props;
  const size = framedSize(id, maxWidth, maxHeight);
  const t = progress(frame, delay, 16);
  // 寄る所を決めていない録画（zoom の無い絵）は、絵の間に窓ごと PUSH だけ一定の速さで寄る。zoom のある絵は中身が動くので窓は動かさない
  const push = props.zoom || props.push === false ? 1 : 1 + PUSH * Math.min(1, frame / Math.max(1, props.duration));
  const style: React.CSSProperties = {
    width: size.width,
    height: size.height,
    opacity: t,
    transform: `translateY(${(1 - t) * 14}px) scale(${((0.985 + 0.015 * t) * push).toFixed(4)})`,
    transformOrigin: "50% 60%",
  };
  return size.phone ? <PhoneFrame {...props} {...size} style={style} /> : <WindowFrame {...props} {...size} style={style} />;
};

type Sized = FramedProps & { width: number; height: number; style: React.CSSProperties };

/**
 * 録画の中身（録画と囲み）を hold コマ止めておき、窓が出始めるところで from 秒から流す
 * （段の頭の最初の録画は大きな名前の間は隠れているので、選んだ from の所を見せるため）
 */
const Held: React.FC<{ hold?: number; children: React.ReactNode }> = ({ hold, children }) =>
  hold && hold > 0 ? (
    <Sequence from={hold} layout="none">
      {children}
    </Sequence>
  ) : (
    <>{children}</>
  );

const WindowFrame: React.FC<Sized> = ({ id, assets, width, height, from, rate, zoom, duration, note, chip, callouts, style, screen, hold }) => {
  // 帯は地の上で目立つ面の色（薄い青の地では青、青地では白）。地と同じ色にすると枠が溶ける
  const p = usePalette();
  const contentW = width;
  const contentH = height - LAYOUT.windowBar;
  return (
    <div style={{ ...style, borderRadius: 10, overflow: "hidden", background: COLOR.white }}>
      <div
        style={{
          height: LAYOUT.windowBar,
          background: p.strong,
          color: p.onStrong,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 18px",
          fontFamily: FONT.main,
          fontSize: TYPE.caption,
          fontWeight: 600,
        }}
      >
        <span>{screen ?? RECORDINGS[id] ?? ""}</span>
        {chip ? <ChipInBar text={chip} inverse={p.strong === COLOR.white} /> : null}
      </div>
      <div style={{ position: "relative", width: contentW, height: contentH }}>
        <Held hold={hold}>
          <Footage id={id} assets={assets} width={contentW} height={contentH} from={from} rate={rate} zoom={zoom} duration={duration - (hold ?? 0)} note={note} />
          <Marks id={id} assets={assets} width={contentW} height={contentH} from={from} rate={rate} zoom={zoom} duration={duration - (hold ?? 0)} callouts={callouts} />
        </Held>
      </div>
    </div>
  );
};

const PhoneFrame: React.FC<Sized> = ({ id, assets, width, height, from, rate, duration, note, chip, callouts, style, hold }) => {
  const screenW = width - BEZEL * 2;
  const screenH = height - BEZEL * 2;
  const outside = (callouts ?? []).filter((c) => c.place === "left" || c.place === "right");
  const inside = (callouts ?? []).filter((c) => !(c.place === "left" || c.place === "right"));
  return (
    <div style={{ ...style, position: "relative" }}>
      <div style={{ width, height, borderRadius: 46, background: COLOR.blue, padding: BEZEL, boxSizing: "border-box" }}>
        <div style={{ position: "relative", width: screenW, height: screenH, borderRadius: 34, overflow: "hidden", background: COLOR.white }}>
          {/* スマホの録画は寄らない（1 画面 1 問の画面を丸ごと見せる） */}
          <Held hold={hold}>
            <Footage id={id} assets={assets} width={screenW} height={screenH} from={from} rate={rate} still duration={duration} note={note} />
            <Marks id={id} assets={assets} width={screenW} height={screenH} from={from} rate={rate} still duration={duration} callouts={inside} />
          </Held>
        </div>
      </div>
      <Held hold={hold}>
        <SideLabels callouts={outside} screenW={screenW} screenH={screenH} offset={BEZEL} phoneWidth={width} />
      </Held>
      {chip ? (
        <div style={{ position: "absolute", left: width + 28, top: BEZEL + 8, whiteSpace: "nowrap" }}>
          <ChipInBar text={chip} large />
        </div>
      ) : null}
    </div>
  );
};

/** モデルの名前。窓の帯の中で、帯と逆の色の小さな面 */
const ChipInBar: React.FC<{ text: string; large?: boolean; inverse?: boolean }> = ({ text, large, inverse }) => (
  <span
    style={{
      background: inverse ? COLOR.blue : COLOR.white,
      color: inverse ? COLOR.white : COLOR.blue,
      fontFamily: FONT.main,
      fontWeight: 600,
      fontSize: large ? 28 : TYPE.caption,
      padding: large ? "8px 16px" : "3px 10px",
      borderRadius: 4,
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </span>
);

/** 囲みが今のコマで出ているか（at・end は絵の頭からの秒） */
function shown(c: Callout, seconds: number): boolean {
  return seconds >= (c.at ?? 0) && seconds < (c.end ?? Infinity);
}

/** 録画の上の囲みと押した所の輪。寄りに合わせて位置を動かす */
const Marks: React.FC<{
  id: string;
  assets: Assets;
  width: number;
  height: number;
  from?: number;
  rate?: number;
  zoom?: [Rect, Rect];
  still?: boolean;
  duration: number;
  callouts?: Callout[];
}> = ({ id, assets, width, height, from = 0, rate = 1, zoom, still, duration, callouts }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = still ? { x: 0, y: 0, w: 1 } : zoomAt(frame, duration, zoom);
  const place = (b: Box) => ({
    left: ((b.x - z.x) / z.w) * width,
    top: ((b.y - z.y) / z.w) * height,
    width: (b.w / z.w) * width,
    height: (b.h / z.w) * height,
  });
  const sec = frame / fps;
  const recSec = footageSeconds(frame, fps, from, rate);
  const taps = assets.marks?.[id]?.taps ?? [];
  return (
    <>
      {(callouts ?? []).filter((c) => shown(c, sec)).map((c) => {
        const r = place(c.box);
        const start = Math.round((c.at ?? 0) * fps);
        const t = progress(frame, start, 10);
        const color = c.tone === "urgent" ? COLOR.urgent : COLOR.blue;
        const below = c.place === "below";
        return (
          <div key={`${c.label}-${c.at ?? 0}`} style={{ position: "absolute", ...r, opacity: t }}>
            <div style={{ position: "absolute", inset: -6, border: `4px solid ${color}`, borderRadius: 6 }} />
            <div
              style={{
                position: "absolute",
                left: -6,
                [below ? "top" : "bottom"]: "100%",
                [below ? "marginTop" : "marginBottom"]: 6,
                background: color,
                color: COLOR.white,
                fontFamily: FONT.main,
                fontWeight: 600,
                fontSize: 24,
                padding: "4px 12px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                ...rise(frame, start + 3, 8, 10),
              }}
            >
              {c.label}
            </div>
          </div>
        );
      })}
      {taps
        .filter((p) => recSec >= p.at - 0.05 && recSec < p.at + 0.7)
        .map((p) => {
          const r = place({ x: p.x, y: p.y, w: 0, h: 0 });
          const k = Math.min(1, Math.max(0, (recSec - p.at) / 0.6));
          const size = 28 + 52 * k;
          return (
            <div
              key={`tap-${p.at}`}
              style={{
                position: "absolute",
                left: r.left - size / 2,
                top: r.top - size / 2,
                width: size,
                height: size,
                borderRadius: "50%",
                border: `4px solid ${COLOR.blue}`,
                opacity: 1 - k,
                boxSizing: "border-box",
              }}
            />
          );
        })}
    </>
  );
};

/** スマホの横に置く囲みの名前。囲みの高さから横へ線を引く */
const SideLabels: React.FC<{ callouts: Callout[]; screenW: number; screenH: number; offset: number; phoneWidth: number }> = ({
  callouts,
  screenW,
  screenH,
  offset,
  phoneWidth,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  return (
    <>
      {callouts.filter((c) => shown(c, sec)).map((c) => {
        const start = Math.round((c.at ?? 0) * fps);
        const t = progress(frame, start, 12);
        const y = offset + (c.box.y + c.box.h / 2) * screenH;
        const color = c.tone === "urgent" ? COLOR.urgent : COLOR.blue;
        const left = c.place === "left";
        const lineLen = 64 * t;
        return (
          <React.Fragment key={`${c.label}-${c.at ?? 0}`}>
            <div
              style={{
                position: "absolute",
                top: y - 2,
                height: 4,
                width: lineLen,
                background: color,
                ...(left ? { right: phoneWidth + 8 } : { left: phoneWidth + 8 }),
              }}
            />
            <div
              style={{
                position: "absolute",
                top: y - 30,
                ...(left ? { right: phoneWidth + 84 } : { left: phoneWidth + 84 }),
                background: color,
                color: COLOR.white,
                fontFamily: FONT.main,
                fontWeight: 600,
                fontSize: TYPE.body,
                padding: "8px 18px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                opacity: t,
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                position: "absolute",
                left: offset + c.box.x * screenW - 6,
                top: offset + c.box.y * screenH - 6,
                width: c.box.w * screenW + 12,
                height: c.box.h * screenH + 12,
                border: `4px solid ${color}`,
                borderRadius: 8,
                boxSizing: "border-box",
                opacity: t,
              }}
            />
          </React.Fragment>
        );
      })}
    </>
  );
};
