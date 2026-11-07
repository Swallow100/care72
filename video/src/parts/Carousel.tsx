// 3 本立て（計画・訓練・発災時）の円柱。3 つの録画の窓を、ゆるい円柱の外側の面に 38 度ずつ並べ、
// 声がそれぞれの名前を言う所で円柱を回して、その窓を正面に持ってくる（作者の頼み 11/5）。
// チープに見せないための決まり:
// - 閉じた三角柱（120 度ずつ）ではなく、半径 1300px のゆるい弧。正面の窓は平らに、両隣は舞台の端に少し見える
// - 遠近は 2600px（小さいと魚眼になる）。回す動きは ease-in-out の 16 コマで、行き過ぎて戻らない
// - 奥の窓は窓そのものの不透明度で下げる（録画の上に色を重ねない）。影・映り込み・光は付けない
// - 名前は回る面の外（上の 1 行）に置き、今の名前へ白い帯が移る（回る面の字はにじむので）
// - 名前の左に白いロゴの印（前の 72 時間の輪の印が縮んで収まる所。作者の頼み 11/5）。3 つの弧が円柱と同じ動きで回り、今の名前の弧だけ白い
// 最後は声が言い終わったあと、真ん中（訓練）へ戻りながら少し引いて 3 つを並べて見せる（時間が足りなければ出さない）
import React from "react";
import { useCurrentFrame } from "remotion";
import type { Assets } from "../assets";
import { usePalette } from "../ground";
import { FONT, LAYOUT, TYPE } from "../theme";
import { Framed } from "./Frame";
import { LogoMark } from "./Logo";
import type { MarkBox } from "./LogoClock";
import { Marker } from "./Marker";
import { EASE_IN_OUT, mix, progress, rise } from "./motion";

/** 窓どうしの角度（度）、円柱の半径・遠近（px）、回す長さ（コマ）、回り始めを声より何コマ前にするか */
const STEP = 38;
const RADIUS = 1300;
const PERSPECTIVE = 2600;
const TURN = 16;
const LEAD = 12;
/** 窓の大きさ（窓の帯を含む） */
const PANEL_W = 860;
const PANEL_H = 524;
/** 最後に引いて 3 つを見せる: 絵の終わりの何コマ前から、どこまで小さく */
const OVERVIEW_BEFORE = 42;
const OVERVIEW_SCALE = 0.8;
/** 見出しの印（白いロゴの印）の大きさ、印と名前の間、名前どうしの間（px） */
const HEAD_MARK = 76;
const HEAD_GAP = 36;
const NAME_GAP = 72;

/**
 * 見出し（白い印と名前の 1 行）の置き方（舞台の中の px）。印の場所は、前の絵（72 時間の輪、parts/LogoClock.tsx）の印が縮んで収まる所でもある。
 * 名前の幅は日本語の字 1 つで 1em として、印と名前のまとまりを真ん中にそろえる
 */
export function carouselHead(titles: string[]): { mark: MarkBox; namesLeft: number } {
  const S = LAYOUT.stage;
  const names = titles.reduce((a, t) => a + [...t].length * TYPE.h1, 0) + NAME_GAP * Math.max(0, titles.length - 1);
  const left = Math.round(S.width / 2 - (HEAD_MARK + HEAD_GAP + names) / 2);
  const lineH = TYPE.h1 * 1.18;
  return { mark: { x: left, y: 6 + (lineH - HEAD_MARK) / 2, size: HEAD_MARK }, namesLeft: left + HEAD_MARK + HEAD_GAP };
}

export type CarouselItem = { id: string; title: string; from?: number };

export const Carousel: React.FC<{ items: CarouselItem[]; marks: number[]; duration: number; assets: Assets; note?: string; marker?: boolean }> = ({
  items,
  marks,
  duration,
  assets,
  note,
  marker = true,
}) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  // 名前を言う所（無ければ 1 秒ずつ）
  const at = items.map((_, i) => marks[i] ?? 6 + i * 30);
  // 回る角度: i 番目の名前の所で i × STEP へ
  let angle = 0;
  for (let i = 1; i < items.length; i++) angle += STEP * progress(frame, at[i] - LEAD, TURN, EASE_IN_OUT);
  // 最後に引く: 声の最後の名前のあと、時間が足りるときだけ
  const overviewStart = duration - OVERVIEW_BEFORE;
  const willOverview = overviewStart > at[at.length - 1] + 40;
  const overview = willOverview ? progress(frame, overviewStart, 22, EASE_IN_OUT) : 0;
  const middle = ((items.length - 1) / 2) * STEP;
  const shown = angle + (middle - angle) * overview;
  const scale = 1 - (1 - OVERVIEW_SCALE) * overview;
  const S = LAYOUT.stage;
  const head = carouselHead(items.map((it) => it.title));
  // 見出しの印: 3 つの弧を 3 本立てに当て、名前を言う所で円柱と同じ動きで -120 度ずつ回り、今の名前の弧だけ白く残す。
  // 最初の名前の前は 3 つとも白（前の絵の印のまま）。最後に引くときは 1 周して元の向きに戻り、3 つとも白
  const turned = items.map((_, i) => (i === 0 ? 0 : progress(frame, at[i] - LEAD, TURN, EASE_IN_OUT)));
  const first = progress(frame, at[0], 10);
  const lit = [0, 1, 2].map((j) => {
    const active = (j === 0 ? 1 : (turned[j] ?? 0)) - (turned[j + 1] ?? 0);
    return Math.max(overview, 1 - first * (1 - active));
  });
  const spin = -120 * (turned.reduce((a, x) => a + x, 0) + overview);
  return (
    <div style={{ position: "absolute", left: S.left, top: S.top, width: S.width, height: S.height, fontFamily: FONT.main, color: p.fg }}>
      <div style={{ position: "absolute", left: head.mark.x, top: head.mark.y }}>
        <LogoMark size={head.mark.size} lit={lit} spin={spin} fg={p.fg} bg={p.bg} />
      </div>
      {/* 上の 1 行: 名前は言う所で出て、今の名前に白い帯（次の名前へ移る） */}
      <div style={{ position: "absolute", left: head.namesLeft, top: 6, display: "flex", gap: NAME_GAP, fontSize: TYPE.h1, fontWeight: 600, lineHeight: 1.18, whiteSpace: "nowrap" }}>
        {items.map((it, i) => {
          // 次の名前が出たら小さな字の色へ。最後に引いて 3 つを並べるときは、3 つとも白に戻す
          const past = i < items.length - 1 && frame >= at[i + 1] - 4;
          const dim = past ? progress(frame, at[i + 1], 10) * (1 - overview) : 0;
          const color = dim > 0 ? mix(p.fg, p.sub, dim) : p.fg;
          return (
            <span key={it.title} style={{ color, ...rise(frame, at[i] - 4, 20, 14) }}>
              {marker ? (
                <Marker at={at[i] + 6} out={i < items.length - 1 ? at[i + 1] - 2 : willOverview ? overviewStart : undefined}>
                  {it.title}
                </Marker>
              ) : (
                it.title
              )}
            </span>
          );
        })}
      </div>
      {/* 円柱。遠近は円柱の親に、立体の並びは円柱にだけ（どちらも overflow で切らない） */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 110, bottom: 0, transform: `scale(${scale.toFixed(4)})`, transformOrigin: "50% 45%" }}>
        <div style={{ position: "absolute", inset: 0, perspective: PERSPECTIVE, perspectiveOrigin: "50% 45%" }}>
          <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: `translateZ(${-RADIUS}px) rotateY(${(-shown).toFixed(3)}deg)` }}>
            {items.map((it, i) => {
              const off = Math.abs(i * STEP - shown);
              // 正面から離れるほど薄く（38 度で 0.55）。録画の上に色は重ねない
              const opacity = Math.max(0, 1 - (off / STEP) * 0.45);
              return (
                <div
                  key={it.id + i}
                  style={{
                    position: "absolute",
                    left: `calc(50% - ${PANEL_W / 2}px)`,
                    top: `calc(45% - ${PANEL_H / 2}px)`,
                    width: PANEL_W,
                    height: PANEL_H,
                    transform: `rotateY(${i * STEP}deg) translateZ(${RADIUS}px)`,
                    backfaceVisibility: "hidden",
                    opacity,
                  }}
                >
                  {/* 2 つ目からは、回りきって正面に来てから from 秒を流す（回っている間は止めておく） */}
                  <Framed id={it.id} assets={assets} maxWidth={PANEL_W} maxHeight={PANEL_H} from={it.from} duration={duration} note={note} delay={0} push={false} hold={i === 0 ? 0 : Math.max(0, at[i] - LEAD + TURN)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
