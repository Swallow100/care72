// 文字が主役の画面（話の段 S1〜S3・S8・S9）。声が言う言葉を、言う所で 1 つずつ出す。
// - 出方: 言葉は自分の行の下の端に隠れていて、そこからせり上がる（下の端で切る。透けて重ならない）。
//   大きな言葉（display・hero）は 1 字ずつ少しずつ遅らせてせり上がる（言葉全体で 8 コマ以内。数字と英字のまとまり「72」「15.1%」は 1 つで）。
//   1 字ずつ打つ動き（カーソル・打鍵）ではない
// - 新しい行が出ると、行のかたまりは上下の真ん中を保ったまま上へ滑る（行の高さが 0 から伸びるので、前の行が押し上がる）
// - 後ろの行が出ると、前の行は小さな字の色に下がる（声が今どこを言っているかを目で追える）。hold と白い帯の言葉は下げない
// - 絵ごとに一番の言葉 1 つ（marker）に白い帯（parts/Marker.tsx）。帯は言葉がせり上がり終わったところで引かれる
// - かたまりは絵の間ずっと 3% だけゆっくり寄る。絵の終わりには行が上から順に上へ抜ける（exit）
// - mark の行は左に 6px の帯（表の強調・名前の帯と同じ形）が上から伸びる
// 使わない物: 跳ねる・行き過ぎて戻る動き、斜体、字間、行ごとに書体を変えること、光・影。
import React from "react";
import { useCurrentFrame } from "remotion";
import { usePalette } from "../ground";
import { FONT, TYPE } from "../theme";
import { MARKER_SWEEP, Marker } from "./Marker";
import { EASE_IN_OUT, mix, progress } from "./motion";

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
/** 行が伸びる長さ、前の行が下がる長さ、1 字（1 つのまとまり）がせり上がる長さ（コマ） */
const GROW = 14;
const DIM = 10;
const RISE = 12;
/** 大きな言葉の 1 字ずつのずれ（コマ）。言葉全体で STAGGER_TOTAL を超えない */
const STAGGER = 1.6;
const STAGGER_TOTAL = 8;
/** 絵の終わりに行が抜ける長さと、行ごとのずれ（コマ） */
const EXIT = 10;
const EXIT_STAGGER = 2;
/** 絵の間に寄る割合 */
const DRIFT = 0.03;

/** 言葉をせり上がるまとまりに分ける。空白はそのまま、数字・英字・記号の続きは 1 つ、ほかは 1 字ずつ（each が false なら言葉全体で 1 つ） */
export function units(text: string, each: boolean): string[] {
  if (!each) return [text];
  const out: string[] = [];
  for (const m of text.matchAll(/\s+|[0-9A-Za-z.%:：/]+|./gu)) out.push(m[0]);
  return out;
}

/** 1 つのまとまり。下の端で切った箱の中を、下からせり上がる */
const Rise: React.FC<{ text: string; start: number }> = ({ text, start }) => {
  const frame = useCurrentFrame();
  if (/^\s+$/.test(text)) return <>{text}</>;
  const t = progress(frame, start, RISE);
  return (
    // 切るのは下の端だけ（上と左右は字がはみ出しても切らない）。overflow ではなく clip-path で切るので、行の文字の下の線（baseline）はずれない
    <span style={{ display: "inline-block", clipPath: "inset(-40% -12% 0 -12%)" }}>
      <span style={{ display: "inline-block", transform: `translateY(${((1 - t) * 104).toFixed(2)}%)` }}>{text}</span>
    </span>
  );
};

/** 言葉 1 つ。大きな言葉は 1 字ずつ */
const Word: React.FC<{ word: KineticWord; color: string; marker: boolean; first?: boolean; last?: boolean }> = ({ word, color, marker, first = true, last = true }) => {
  const big = word.size === "display" || word.size === "hero";
  const parts = units(word.text, big);
  const solid = parts.filter((u) => !/^\s+$/.test(u)).length;
  const step = solid > 1 ? Math.min(STAGGER, STAGGER_TOTAL / (solid - 1)) : 0;
  let k = 0;
  const body = parts.map((u, i) => {
    const start = word.frame + (/^\s+$/.test(u) ? 0 : k++ * step);
    return <Rise key={i} text={u} start={start} />;
  });
  // 帯は最後のまとまりがせり上がり終わるころに引く
  const markerAt = word.frame + Math.max(0, solid - 1) * step + RISE - 2;
  // 帯は字の左右に 0.14em はみ出すので、同じ行の隣の言葉と重ならないよう、隣がある側だけ空ける（行の頭の字の位置はほかの行とそろえたまま）
  const room = marker ? { marginLeft: first ? 0 : "0.16em", marginRight: last ? 0 : "0.16em" } : {};
  return (
    <span style={{ fontSize: TYPE[word.size], fontWeight: 600, color, whiteSpace: "nowrap", ...room }}>{marker ? <Marker at={markerAt}>{body}</Marker> : body}</span>
  );
};

/** 帯の言葉の帯が引き終わるコマ（ほかの部品が帯のあとに続けたいとき） */
export const markerEnd = (word: KineticWord) => {
  const solid = units(word.text, word.size === "display" || word.size === "hero").filter((u) => !/^\s+$/.test(u)).length;
  const step = solid > 1 ? Math.min(STAGGER, STAGGER_TOTAL / (solid - 1)) : 0;
  return word.frame + Math.max(0, solid - 1) * step + RISE - 2 + MARKER_SWEEP;
};

export const Kinetic: React.FC<{
  words: KineticWord[];
  align?: "left" | "center";
  width?: number;
  /** 白い帯を引く言葉（絵ごとに 1 つ） */
  marker?: string;
  /** 絵の長さ（コマ）。あれば絵の間ゆっくり寄り、exit なら終わりに行が上へ抜ける */
  duration?: number;
  exit?: boolean;
}> = ({ words, align = "left", width, marker, duration, exit }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const rows = [...new Set(words.map((w) => w.row))].sort((a, b) => a - b);
  const startOf = (row: number) => Math.min(...words.filter((w) => w.row === row).map((w) => w.frame));
  const drift = duration ? 1 + DRIFT * Math.min(1, Math.max(0, frame / duration)) : 1;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        width,
        fontFamily: FONT.main,
        transform: drift !== 1 ? `scale(${drift.toFixed(4)})` : undefined,
        transformOrigin: "50% 50%",
      }}
    >
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
        // 絵の終わり: 上の行から順に、上へ少し動きながら消える
        const out = exit && duration ? progress(frame, duration - EXIT + i * EXIT_STAGGER, EXIT, EASE_IN_OUT) : 0;
        return (
          // 行の箱の高さだけを伸ばし、字は箱からはみ出して見せる（字は流れの中に置くので、かたまりの幅は一番長い行になる）
          <div key={row} style={{ height, flex: "none", opacity: 1 - out, transform: out > 0 ? `translateY(${(-out * size * 0.35).toFixed(1)}px)` : undefined }}>
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
              {inRow.map((w, k) => {
                const isMarker = !!marker && w.text === marker;
                const down = dimAt !== null && !w.hold && !isMarker ? progress(frame, dimAt, DIM) : 0;
                return <Word key={k} word={w} color={down > 0 ? mix(p.fg, p.sub, down) : p.fg} marker={isMarker} first={k === 0} last={k === inRow.length - 1} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
