// S3 の「それがケア72。72 は、助けが届きにくい災害直後の 72 時間です。」（作者の頼み 11/5「72 時間の所でロゴを使いたい」）。
// アプリの印（72 時間を 1 周にして 24 時間ごとに 3 つの日に分けた輪）を、そのまま 72 時間の時計として動かす:
// 1. 印が 12 時から日ごとに描かれ、右に「ケア72」（声の「それがケア72」）
// 2. 声の「72 は」で、名前が消え、印が左へ寄りながら大きくなって時計に。「72」に白い帯、輪の外に 6 時間ごとの目盛り
// 3. 右に声の言葉（助けが届きにくい・災害直後の 72 時間）。輪は一度沈み、白い点が 0 時間から回って 1 日目・2 日目・3 日目を順に白く満たす
// 4. 終わりの 15 コマで、目盛りと言葉が消え、印が縮んで次の 3 本立ての見出しの印の所へ収まる（次の絵は重ねずに切り替える。Shot の cutIn）
// 跳ねる・行き過ぎて戻る動きは使わない（ease-in-out）。色は白の濃淡だけ
import React from "react";
import { useCurrentFrame } from "remotion";
import { usePalette } from "../ground";
import { FONT, LAYOUT, TYPE } from "../theme";
import { LogoMark, MARK_RING } from "./Logo";
import { EASE_IN_OUT, EASE_OUT, progress, rise } from "./motion";

/** 印の置き場所（舞台の中の px。x・y は左上） */
export type MarkBox = { x: number; y: number; size: number };

/** 1. 名前と並ぶ印 */
const LOCK: MarkBox = { x: 330, y: 270, size: 300 };
/** 2. 時計の印（左に寄せ、右に言葉） */
const DIAL: MarkBox = { x: 220, y: 120, size: 600 };
/** 名前の字の大きさ */
const WORD = 196;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpBox = (a: MarkBox, b: MarkBox, t: number): MarkBox => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), size: lerp(a.size, b.size, t) });

export const LogoClock: React.FC<{
  /** 名前（「ケア72」） */
  name: string;
  duration: number;
  /** 声が名前を言う所（コマ） */
  nameAt: number;
  /** 声の「72 は」（コマ）。ここで時計に替わる */
  markAt: number;
  /** 白い点が 0 → 72 時間を回る間（コマ） */
  sweep: [number, number];
  /** 終わりに印が収まる所（次の絵の見出しの印。舞台の中の px）。無ければ動かさない */
  to?: MarkBox;
  /** 右に出す声の言葉（Kinetic） */
  children?: React.ReactNode;
  /** 時計にしない。ロゴと名前のまま弧だけが回る（作者の頼み 11/6「ロゴを出して円がくるくる」） */
  plain?: boolean;
}> = ({ name, duration, nameAt, markAt, sweep, to, children, plain = false }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const S = LAYOUT.stage;
  // 2. 時計へ（22 コマ）。名前は先に 10 コマで消える
  const toDial = plain ? 0 : progress(frame, markAt, 22, EASE_IN_OUT);
  const nameOut = plain ? progress(frame, duration - 15, 8) : progress(frame, markAt, 10, EASE_IN_OUT);
  // plain: 描き終えたあと、見出しへ動くまで弧が 2 周する
  const spin = plain ? progress(frame, 30, Math.max(1, duration - 45), EASE_IN_OUT) * 720 : 0;
  // 4. 見出しの印へ（最後の 15 コマ。最後のコマで次の絵の印と同じ所・大きさ）
  const toHead = to ? progress(frame, duration - 15, 14, EASE_IN_OUT) : 0;
  const fade = 1 - progress(frame, duration - 15, 8);
  const box = lerpBox(lerpBox(LOCK, DIAL, toDial), to ?? DIAL, toHead);
  // 1. 弧を日ごとに描く（アプリと同じ順。最後の日だけゆるめる）
  const drawn = [0, 1, 2].map((i) => progress(frame, 2 + i * 10, 10, i === 2 ? EASE_OUT : (x) => x));
  // 3. 白い点が回る（0 → 360 度）。輪は時計になると沈み、点が通った日から白に戻る。見出しへ動く間に全部白へ
  const turn = progress(frame, sweep[0], sweep[1] - sweep[0], EASE_IN_OUT);
  const angle = turn * 360;
  const sunk = plain ? 0 : progress(frame, markAt + 6, 14);
  const lit = [0, 1, 2].map((i) => Math.max(1 - sunk, Math.min(1, Math.max(0, (angle - i * 120) / 120)), toHead));
  // 点は 1 周で消える（12 時の切れ目の上で薄く残すと、にじんだ丸に見えるので 4 コマで）
  const dot = progress(frame, sweep[0] - 4, 6) * (1 - progress(frame, sweep[1], 4));
  // 「72」の白い帯: 声の「72 は」から 10 コマで伸び、見出しへ動く前に消える
  const mark = plain ? 0 : progress(frame, markAt + 4, 10);
  // 目盛り（6 時間ごと 12 本。24 時間ごとの日の切れ目は長く）: 時計になる間に 12 時から順に出る
  const ring = MARK_RING.r + MARK_RING.stroke / 2;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const t = plain ? 0 : progress(frame, markAt + 8 + i * 1.5, 8) * fade;
    const a = ((i * 30 - 90) * Math.PI) / 180;
    const major = i % 4 === 0;
    const r0 = ring + 2.5;
    const r1 = r0 + (major ? 5 : 2.6);
    return (
      <line
        key={i}
        x1={50 + Math.cos(a) * r0}
        y1={50 + Math.sin(a) * r0}
        x2={50 + Math.cos(a) * r1}
        y2={50 + Math.sin(a) * r1}
        stroke={p.fg}
        strokeOpacity={(major ? 1 : 0.55) * t}
        strokeWidth={major ? 1.1 : 0.7}
      />
    );
  });
  const dotA = ((angle - 90) * Math.PI) / 180;
  const named = rise(frame, nameAt, 22, 16);
  // 日の名前（1 日目〜3 日目）: 弧の真ん中の外。点がその日の半ばを過ぎたら白く上がる
  const days = [0, 1, 2].map((i) => {
    const mid = ((i * 120 + 60 - 90) * Math.PI) / 180;
    const r = 0.5 * box.size * 1.22;
    const cx = box.x + box.size / 2 + Math.cos(mid) * r;
    const cy = box.y + box.size / 2 + Math.sin(mid) * r;
    const on = plain ? 0 : progress(frame, sweep[0] + (sweep[1] - sweep[0]) * ((i * 120 + 50) / 360), 10);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          transform: `translate(-50%, -50%) translateY(${((1 - on) * 14).toFixed(1)}px)`,
          fontSize: TYPE.body,
          fontWeight: 600,
          color: p.fg,
          opacity: on * fade,
          whiteSpace: "nowrap",
        }}
      >
        {i + 1} 日目
      </div>
    );
  });
  return (
    <div style={{ position: "absolute", left: S.left, top: S.top, width: S.width, height: S.height, fontFamily: FONT.main, color: p.fg }}>
      <div style={{ position: "absolute", left: box.x, top: box.y }}>
        <LogoMark size={box.size} drawn={drawn} lit={lit} spin={spin} digits={progress(frame, 2, 12)} mark={mark} markOpacity={fade} fg={p.fg} bg={p.bg}>
          {ticks}
          {!plain && dot > 0 ? (
            <circle cx={50 + Math.cos(dotA) * MARK_RING.r} cy={50 + Math.sin(dotA) * MARK_RING.r} r={5.4} fill={p.fg} stroke={p.bg} strokeWidth={1.4} opacity={dot} />
          ) : null}
        </LogoMark>
      </div>
      {days}
      {/* 1. 名前（印の右）。声の「72 は」で上へ抜けて消える */}
      <div
        style={{
          position: "absolute",
          left: LOCK.x + LOCK.size + 44,
          top: LOCK.y + LOCK.size / 2,
          transform: `translateY(-50%) translateY(${(-40 * nameOut).toFixed(1)}px)`,
          fontSize: WORD,
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: "nowrap",
          opacity: (1 - nameOut) * Number(named.opacity),
        }}
      >
        <span style={{ display: "inline-block", transform: named.transform }}>{name}</span>
      </div>
      {/* 3. 右に声の言葉 */}
      {children ? (
        <div style={{ position: "absolute", left: 960, width: 700, top: 0, height: S.height, display: "flex", alignItems: "center", opacity: fade }}>{children}</div>
      ) : null}
    </div>
  );
};
