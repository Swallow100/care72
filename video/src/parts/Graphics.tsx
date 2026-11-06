// 編集で描く図と文字の画面（docs/video/MATERIALS.md の F1〜F3・G1〜G5）。
// 青と白のコントラスト: 字は地の逆の色。赤と緑は至急と無事の意味のときだけ。
// どの図も舞台（LAYOUT.stage）の中で真ん中にそろえ、出るときは下から上がる（motion.ts）。並ぶ物は 4 コマずつずらす。
// 話の段（青地）は文字が主役: 言葉を声に合わせて 1 つずつ出し、大きさの段で強弱を付ける。
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { usePalette } from "../ground";
import { COLOR, FONT, LAYOUT, STATE_LABEL, TYPE } from "../theme";
import { MODEL_ROWS, RULE_ROWS } from "../timeline";
import { LOGO_INK, Logo } from "./Logo";
import { Marker } from "./Marker";
import { EASE_OUT, STAGGER, progress, rise } from "./motion";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * 図どうしで揃える決まり（11/4）。面の角は 10px、塗りの端は 4px、線は 2px、表の行の区切りは 1px の薄い線。
 * 強調する行は「左の帯 6px ＋ 薄い地 ＋ 太字」（ルールの表と使い分けの表で同じ）。メーターは太い線の上に字の色の塗り
 */
const RADIUS = { panel: 10, mark: 4 } as const;
const LINE = 2;
const HAIRLINE = `1px solid ${COLOR.blueTint}`;

/** 舞台。中の物を上下左右の真ん中に置く */
export const Stage: React.FC<{ children: React.ReactNode; gap?: number; row?: boolean; align?: "center" | "stretch" }> = ({
  children,
  gap = 24,
  row,
  align = "center",
}) => {
  const p = usePalette();
  const S = LAYOUT.stage;
  return (
    <div
      style={{
        position: "absolute",
        left: S.left,
        top: S.top,
        width: S.width,
        height: S.height,
        display: "flex",
        flexDirection: row ? "row" : "column",
        justifyContent: "center",
        alignItems: align,
        gap,
        fontFamily: FONT.main,
        color: p.fg,
      }}
    >
      {children}
    </div>
  );
};

/** S2 の題名 */
export const Title: React.FC<{ title: string; sub?: string }> = ({ title, sub }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <Stage>
      <div style={{ fontSize: TYPE.display, fontWeight: 600, ...rise(frame, 0, 24, 18) }}>{title}</div>
      {sub ? <div style={{ fontSize: TYPE.h2, color: p.sub, ...rise(frame, 6) }}>{sub}</div> : null}
    </Stage>
  );
};

/**
 * 文字だけの画面。lines は 1 行ずつ声に合わせて出す（1 行目は大きく、2 行目から 1 段小さく）。
 * 行の中の「→」は矢印の線に置き換え、前の言葉から後の言葉へ線が伸びる。
 * sub は下の帯（S1 の「誰の・どの場面」）。「×」で分けた言葉を 1 つずつ面に並べる
 */
/**
 * 左下の名札（S3 の作者の紹介）。大きな字の画面にしない（11/4）。字幕の帯の上、舞台の左に 2 行。
 * 1 行目は名前の代わり（作者　医学部の学生）、2 行目は理由（家族にケアマネージャー）。左の帯は表の強調と同じ 6px
 */
export const Plate: React.FC<{ lines: string[]; beats?: number[] }> = ({ lines, beats }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = usePalette();
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: LAYOUT.stage.left, bottom: 1080 - (LAYOUT.stage.top + LAYOUT.stage.height) + 24, display: "flex", gap: 22 }}>
        <div style={{ width: 6, background: p.fg, ...rise(frame, Math.round((beats?.[0] ?? 0.3) * fps)) }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={l} style={{ fontSize: i === 0 ? TYPE.h2 : TYPE.body, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? p.fg : p.sub, ...rise(frame, Math.round((beats?.[i] ?? i * 0.9) * fps)) }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const TextCard: React.FC<{ lines: string[]; sub?: string; beats?: number[] }> = ({ lines, sub, beats }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = usePalette();
  const starts = lines.map((_, i) => Math.round((beats?.[i] ?? i * 0.9) * fps));
  const words = sub ? sub.split("×").map((w) => w.trim()) : [];
  const subStart = Math.round((beats?.[lines.length] ?? lines.length * 0.9 + 0.3) * fps);
  return (
    <Stage gap={28}>
      {lines.map((l, i) => (
        <div key={l} style={{ fontSize: i === 0 ? TYPE.hero : TYPE.h1, fontWeight: 600, lineHeight: 1.2, ...rise(frame, starts[i], 22, 16) }}>
          {l}
        </div>
      ))}
      {words.length ? (
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 56 }}>
          {words.map((w, i) => (
            <React.Fragment key={w}>
              {i > 0 ? <span style={{ fontSize: TYPE.h2, color: p.sub, ...rise(frame, subStart + i * 6 - 3) }}>×</span> : null}
              <span
                style={{
                  background: p.surface,
                  color: p.onSurface,
                  fontSize: 38,
                  fontWeight: 600,
                  padding: "14px 26px",
                  borderRadius: RADIUS.panel,
                  whiteSpace: "nowrap",
                  ...rise(frame, subStart + i * 6),
                }}
              >
                {w}
              </span>
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </Stage>
  );
};

/**
 * G2 大きな数字。数だけの値（15.1% など）は 0 から数え上げる。
 * 下に 100 個の点を並べ、値の割合だけを白で塗る（15.1% なら 15 個）。sub は点の下に
 */
export const BigNumber: React.FC<{ value: string; sub?: string }> = ({ value, sub }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const m = /^(\d+(?:\.\d+)?)(%?)(.*)$/.exec(value);
  const count = m ? interpolate(frame, [4, 40], [0, Number(m[1])], { ...clamp, easing: EASE_OUT }) : 0;
  const digits = m ? (m[1].split(".")[1] ?? "").length : 0;
  return (
    <Stage gap={34}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, ...rise(frame, 0, 20, 14) }}>
        <span style={{ fontSize: 230, fontWeight: 600, lineHeight: 1 }}>{m ? count.toFixed(digits) : value}</span>
        {m ? <span style={{ fontSize: 120, fontWeight: 600, lineHeight: 1 }}>{m[2] + m[3]}</span> : null}
      </div>
      {sub ? <div style={{ fontSize: TYPE.h2, color: p.sub, maxWidth: 1500, textAlign: "center", ...rise(frame, 16) }}>{sub}</div> : null}
    </Stage>
  );
};

/**
 * 前と後の 2 つの数（S8 の「［X 時間］ → ［Y 分］」）。value を「→」で分け、前は薄い色で先に、後は大きく後から出す。
 * 間の矢印は線が伸びる。labels は各数の下の短い名前（ふだん・ケア72）。数が入る前の［ ］のままでも 1 行に収める
 */
export const Compare: React.FC<{ value: string; labels: [string, string]; sub?: string; lead?: SlotWord; marks?: number[] }> = ({ value, labels, sub, lead, marks }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const [before, after] = value.split("→").map((s) => s.trim());
  // 前の数と後の数は、声がそれを言う所（marks。無ければ 0 コマと 22 コマ）で出す。矢印は後の数の 10 コマ前から伸びる
  const at0 = marks?.[0] ?? 0;
  const at1 = Math.max(at0 + 12, marks?.[1] ?? 22);
  const arrow = progress(frame, at1 - 10, 14);
  // 2 段の格子: 上の段に数と矢印（下の線をそろえる）、下の段に名前（同じ高さに並べる）
  const amount = (text: string, delay: number, strong: boolean) => (
    <div style={{ fontSize: strong ? 168 : 120, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap", color: strong ? p.fg : p.sub, justifySelf: "center", ...rise(frame, delay, 22, 16) }}>
      {text}
    </div>
  );
  const label = (text: string, delay: number, strong: boolean) => (
    <div style={{ fontSize: TYPE.h2, fontWeight: 600, color: strong ? p.fg : p.sub, justifySelf: "center", ...rise(frame, delay + 4) }}>{text}</div>
  );
  return (
    <Stage gap={56}>
      {/* 声が数の前に言う言葉（「計画 1 件」）は上に、言う所で出す */}
      {lead ? <div style={{ fontSize: TYPE[lead.size], fontWeight: 600, marginBottom: -20, ...rise(frame, lead.frame) }}>{lead.text}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "auto 160px auto", alignItems: "end", columnGap: 56, rowGap: 22 }}>
        {amount(before ?? "", at0, false)}
        <svg width={160} height={60} viewBox="0 0 160 60" style={{ marginBottom: 30 }}>
          {/* 伸びる前は描かない（長さ 0 の線でも丸い端が点に見える） */}
          {arrow > 0 ? <line x1={4} y1={30} x2={4 + 148 * arrow} y2={30} stroke={p.fg} strokeWidth={6} strokeLinecap="round" /> : null}
          <path d="M 128 10 L 152 30 L 128 50" stroke={p.fg} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={arrow > 0.9 ? 1 : 0} />
        </svg>
        {amount(after ?? "", at1, true)}
        {label(labels[0], at0, false)}
        <div />
        {label(labels[1], at1, true)}
      </div>
      {sub ? <div style={{ fontSize: TYPE.body, color: p.sub, maxWidth: 1500, textAlign: "center", ...rise(frame, at1 + 12) }}>{sub}</div> : null}
    </Stage>
  );
};

/** 100 個の点（10 × 10 でなく横 50 × 2 段）。share の割合だけ濃い色 */
/**
 * 割合の図（S3 の 15.1% と、能登の死者のうちの関連死）。全体の中の一部なので、2 本の棒にせず 1 本のメーターに描く。
 * 上に声が言う数（数え上がって、声がその数を言う所で止まる。land はそのコマ）。メーターは全体の線（地の 1 段明るい青）の上に一部の塗り（字の色）。
 * 塗りは左を角にして右の端だけ 4px 丸める（棒の決まり。カプセル形にしない）。名前は塗りの下の左と、線の右の端に字の色で
 */
type SlotWord = { text: string; frame: number; size: keyof typeof TYPE };

export const Share: React.FC<{ hero: string; share: number; part: string; whole: string; land?: number; lead?: SlotWord; tail?: SlotWord; marker?: string; extra?: string }> = ({
  hero,
  share,
  part,
  whole,
  land = 40,
  lead,
  tail,
  marker,
  extra,
}) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(hero);
  // 出てすぐ数え始め、声がその数を言う所（land）で止まる
  const t = progress(frame, 4, Math.max(20, land - 4));
  const digits = m ? (m[1].split(".")[1] ?? "").length : 0;
  const shown = m ? (Number(m[1]) * t).toFixed(digits) : hero;
  const W = 1240;
  const H = 30;
  return (
    <Stage gap={0}>
      <div style={{ width: W, display: "flex", flexDirection: "column", gap: 40, ...rise(frame, 0, 20, 14) }}>
        {/* 声が数の前に言う言葉（「できているのは」）は数の上に、後ろの言葉（「だけ」）は数の後ろに、言う所で出す */}
        {lead ? <div style={{ fontSize: TYPE[lead.size], fontWeight: 600, lineHeight: 1, marginBottom: -12, ...rise(frame, lead.frame) }}>{lead.text}</div> : null}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, lineHeight: 1 }}>
          {/* 数そのものが白い帯の言葉なら、数え終えた所で帯を引く（「15.1%」「4 人」。作者の頼み 11/6） */}
          {marker === hero ? (
            // 帯の高さは字の大きさから決まるので、包む字の大きさを数にそろえる
            <span style={{ fontSize: m ? 200 : TYPE.hero, lineHeight: 1 }}>
            <Marker at={land}>
              <span style={{ fontSize: m ? 220 : TYPE.hero, fontWeight: 600 }}>{shown}</span>
              {m ? <span style={{ fontSize: 110, fontWeight: 600 }}>{m[2]}</span> : null}
            </Marker>
            </span>
          ) : (
            <>
              <span style={{ fontSize: m ? 220 : TYPE.hero, fontWeight: 600 }}>{shown}</span>
              {m ? <span style={{ fontSize: 110, fontWeight: 600 }}>{m[2]}</span> : null}
            </>
          )}
          {tail ? (
            <span style={{ fontSize: TYPE[tail.size], fontWeight: 600, marginLeft: 18, ...rise(frame, tail.frame, 16, 14) }}>
              {/* 白い帯の言葉なら、出てから帯を引く（「だけ」） */}
              {marker === tail.text ? <Marker at={tail.frame + 12}>{tail.text}</Marker> : tail.text}
            </span>
          ) : null}
        </div>
        <div style={{ position: "relative", width: W, height: H, background: p.tint, borderRadius: RADIUS.mark }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: H, width: W * share * t, background: p.fg, borderRadius: `0 ${RADIUS.mark}px ${RADIUS.mark}px 0` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: TYPE.body, marginTop: -16, ...rise(frame, 10) }}>
          {/* 名前が白い帯の言葉なら、数が止まった所で帯を引く（「書く時間が無い」） */}
          <span style={{ fontWeight: 600 }}>{marker === part ? <Marker at={land}>{part}</Marker> : part}</span>
          <span style={{ color: p.sub }}>{whole}</span>
        </div>
        {/* 2 つ目の数（問 6 の「事業所で見返す人は 0 人」。11/6）。数が止まったあとに出す */}
        {extra ? <div style={{ fontSize: TYPE.h2, fontWeight: 600, marginTop: -4, ...rise(frame, land + 10) }}>{extra}</div> : null}
      </div>
    </Stage>
  );
};

/**
 * G3 避難所の手書きの薬のメモ（イメージ）。ちぎったメモ用紙に、薬・量・いつ の表を手で書いていき、量の欄だけ空いている。
 * 書き終わったあと、声の「用量」（mark のコマ）で量の欄を赤の線で囲み（線が一周する）、下に「用量 空欄」。「イメージ」は注記の隅に（Video.tsx）。
 * 字は教科書体（Windows の UD デジタル 教科書体。手で書いた字に近い端末の書体。Web の日本語書体は使わない）。
 * 薬は中断に注意する例（血圧・ワルファリン・インスリン）。量は書かない（医療の助言にしない。空いていることが話の中身）
 */
const MEMO_ROWS = [
  { name: "血圧の薬　白い粒", when: "朝", amount: "" },
  { name: "ワルファリン", when: "夕", amount: "" },
  { name: "インスリン 注射", when: "食前", amount: "？" },
] as const;

/** 手で引いた線（両端の間に小さな揺れ）。seed で揺れ方を変える */
function wobble(x1: number, y1: number, x2: number, y2: number, seed: number): string {
  const j = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 2.6;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1 + j(1)} Q ${(x1 + mx) / 2 + j(2)} ${(y1 + my) / 2 + j(3)} ${mx} ${my + j(4)} T ${x2} ${y2 + j(5)}`;
}

/** ちぎった上の縁。歯の高さを少しずつ変える */
function tornPaper(left: number, top: number, right: number, bottom: number): string {
  const teeth: string[] = [];
  for (let x = left, i = 0; x <= right; x += 18, i++) teeth.push(`L ${Math.min(x, right)} ${top + (i % 2 ? 7 : 0) + Math.sin(i * 1.7) * 3}`);
  return `M ${left} ${top} ${teeth.join(" ")} L ${right} ${bottom} L ${left} ${bottom} Z`;
}

export const Memo: React.FC<{ mark?: number }> = ({ mark = 64 }) => {
  const frame = useCurrentFrame();
  const ink = COLOR.blue;
  const hand = { fontFamily: FONT.hand, fill: ink } as const;
  // 書く動き: 左から右へ字が現れる（ペンの速さは一定なので直線）
  const write = (start: number, len: number) => progress(frame, start, len, (t) => t);
  const line = (start: number, len = 10) => {
    const t = write(start, len);
    return { strokeDasharray: 1000, strokeDashoffset: 1000 * (1 - t) };
  };
  const stroke = { stroke: ink, strokeWidth: 3, strokeLinecap: "round" as const, fill: "none" };
  // 表の置き場所（viewBox の中）。列は 薬 | 量 | いつ
  const L = 90;
  const R = 910;
  const C1 = 520;
  const C2 = 690;
  const ROW_TOP = 216;
  const ROW_H = 92;
  const rowsBottom = ROW_TOP + ROW_H * MEMO_ROWS.length;
  const clips: { id: string; x: number; y: number; w: number; h: number; t: number }[] = [];
  const text = (key: string, x: number, y: number, w: number, size: number, start: number, len: number, body: string, anchor: "start" | "middle" | "end" = "start") => {
    const id = `memo-${key}`;
    const left = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
    clips.push({ id, x: left - 6, y: y - size - 6, w: w + 12, h: size * 1.6, t: write(start, len) });
    return (
      <text key={key} x={x} y={y} fontSize={size} textAnchor={anchor} clipPath={`url(#${id})`} {...hand}>
        {body}
      </text>
    );
  };
  const words = [
    text("title", 100, 118, 260, 58, 4, 10, "おくすり"),
    text("who", 900, 116, 300, 36, 10, 8, "3班　80代 女性", "end"),
    text("h-name", L + 20, 194, 200, 38, 16, 5, "くすり"),
    text("h-amount", (C1 + C2) / 2, 194, 60, 38, 19, 3, "量", "middle"),
    text("h-when", (C2 + R) / 2, 194, 120, 38, 21, 4, "いつ", "middle"),
    ...MEMO_ROWS.flatMap((row, i) => {
      const y = ROW_TOP + ROW_H * i + 62;
      const at = 25 + i * 10;
      return [
        text(`n${i}`, L + 20, y, C1 - L - 30, 44, at, 7, row.name),
        text(`w${i}`, (C2 + R) / 2, y, 160, 44, at + 7, 3, row.when, "middle"),
        ...(row.amount ? [text(`a${i}`, (C1 + C2) / 2, y, 50, 44, at + 9, 2, row.amount, "middle")] : []),
      ];
    }),
    text("note", 100, 590, 360, 40, 56, 7, "お薬手帳 なし"),
  ];
  // 声の「用量」で量の欄を赤の線で囲む（線が一周する）
  const ring = progress(frame, mark, 12);
  const box = { x: C1 + 10, y: ROW_TOP + 8, w: C2 - C1 - 20, h: rowsBottom - ROW_TOP - 16 };
  const perimeter = 2 * (box.w + box.h);
  return (
    <Stage>
      <div style={{ ...rise(frame, 0, 20, 14), transform: `${rise(frame, 0, 20, 14).transform} rotate(-1.2deg)` }}>
        <svg width={1000} height={660} viewBox="0 0 1000 660">
          <defs>
            {clips.map((c) => (
              <clipPath key={c.id} id={c.id}>
                <rect x={c.x} y={c.y} width={c.w * c.t} height={c.h} />
              </clipPath>
            ))}
          </defs>
          <path d={tornPaper(40, 34, 960, 640)} fill={COLOR.white} />
          {/* メモ用紙の罫線。表の行の線と同じ高さ（手で罫線の上に表を引いた形。ずらすと線が二重に見える） */}
          {[150, ROW_TOP, ROW_TOP + ROW_H, ROW_TOP + ROW_H * 2, rowsBottom, 604].map((y) => (
            <line key={y} x1={60} y1={y} x2={940} y2={y} stroke="#dbe6fa" strokeWidth={2} />
          ))}
          {/* 題の下線と、手で引いた表の線 */}
          <path d={wobble(96, 134, 330, 132, 1)} {...stroke} strokeWidth={4} style={line(12, 6)} />
          {[ROW_TOP, ROW_TOP + ROW_H, ROW_TOP + ROW_H * 2].map((y, i) => (
            <path key={y} d={wobble(L, y, R, y + 2, 2 + i)} {...stroke} style={line(14 + i * 2)} />
          ))}
          {[C1, C2].map((x, i) => (
            <path key={x} d={wobble(x, 156, x + 2, rowsBottom - 6, 7 + i)} {...stroke} style={line(15 + i * 2)} />
          ))}
          {words}
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx={10}
            fill="none"
            stroke={COLOR.urgent}
            strokeWidth={5}
            strokeDasharray={`${perimeter * ring} ${perimeter}`}
          />
          <text
            x={(C1 + C2) / 2}
            y={rowsBottom + 50}
            textAnchor="middle"
            fontFamily={FONT.main}
            fontSize={TYPE.body}
            fontWeight={600}
            fill={COLOR.urgent}
            opacity={progress(frame, mark + 6, 8)}
          >
            用量 空欄
          </text>
        </svg>
      </div>
    </Stage>
  );
};

/** F1 記録 1 つから 3 つの紙面。上の「記録」から 3 本の線が伸び、紙面が左から 1 つずつ出る。children に 3 つの録画（か仮の面）を渡す。紙面の名前は窓の帯に出るので、names は描かない（key だけ） */
export const Flow: React.FC<{ children: React.ReactNode[]; names: string[]; cardWidth: number }> = ({ children, names, cardWidth }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const gap = 48;
  const total = cardWidth * 3 + gap * 2;
  const grow = progress(frame, 6, 14);
  return (
    <Stage gap={0}>
      <div style={{ background: p.strong, color: p.onStrong, borderRadius: RADIUS.panel, padding: "16px 64px", fontSize: TYPE.h2, fontWeight: 600, ...rise(frame, 0) }}>記録</div>
      <svg width={total} height={70} style={{ display: "block" }}>
        {[0, 1, 2].map((i) => {
          const x = cardWidth / 2 + i * (cardWidth + gap);
          return (
            <path
              key={i}
              d={`M ${total / 2} 0 L ${total / 2} 26 L ${x} 26 L ${x} 70`}
              stroke={p.fg}
              strokeWidth={LINE}
              fill="none"
              strokeDasharray={1200}
              strokeDashoffset={1200 * (1 - grow)}
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", gap }}>
        {children.map((child, i) => (
          <div key={names[i]} style={{ width: cardWidth, ...rise(frame, 14 + i * 8) }}>
            {child}
          </div>
        ))}
      </div>
    </Stage>
  );
};

/**
 * F2 ルールの表の 1 枚。行が上から 4 コマずつ出て、強調する行（0 と 2）に太字と左の色の帯。至急は赤、無事は緑、ほかは青の字。
 * 表の右上に「AI を使わない」を置く（N23 の言葉を図でも）
 */
export const Rules: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const colorOf = { urgent: COLOR.urgent, ok: COLOR.ok, check: COLOR.blue, unknown: COLOR.blue } as const;
  return (
    <Stage>
      <div style={{ width: 1500 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, ...rise(frame, 0) }}>
          <span style={{ fontSize: TYPE.h2, fontWeight: 600 }}>ルールの表</span>
          <span style={{ background: p.strong, color: p.onStrong, fontSize: 28, fontWeight: 600, padding: "6px 16px", borderRadius: RADIUS.mark }}>AI を使わない</span>
        </div>
        <div style={{ background: COLOR.white, borderRadius: RADIUS.panel, overflow: "hidden", padding: "6px 0" }}>
          <div style={{ display: "flex", gap: 24, padding: "10px 32px", fontSize: TYPE.caption, color: COLOR.blueMid, ...rise(frame, 4) }}>
            <div style={{ width: 600 }}>入ってきた事実</div>
            <div style={{ width: 180 }}>色</div>
            <div>理由の 1 行</div>
          </div>
          {RULE_ROWS.map((row, i) => {
            const strong = i === 0 || i === 2;
            const filled = row.state === "urgent" || row.state === "ok";
            return (
              <div
                key={row.input}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  padding: "15px 32px",
                  fontSize: 32,
                  color: COLOR.blue,
                  fontWeight: strong ? 600 : 400,
                  background: strong ? COLOR.blueTint : COLOR.white,
                  borderTop: i === 0 ? undefined : HAIRLINE,
                  ...rise(frame, 8 + i * STAGGER, 12),
                }}
              >
                {strong ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: colorOf[row.state] }} /> : null}
                <div style={{ width: 600 }}>{row.input}</div>
                <div style={{ width: 180, display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      boxSizing: "border-box",
                      background: filled ? colorOf[row.state] : "transparent",
                      border: `3px solid ${colorOf[row.state]}`,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: colorOf[row.state], fontWeight: 600 }}>{STATE_LABEL[row.state]}</span>
                </div>
                <div>{row.reason}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: TYPE.caption, color: p.sub, marginTop: 14, ...rise(frame, 40) }}>
          全 13 行のうち 7 行。docs/TRIAGE.md はコードから作り、テストで一致を確かめる
        </div>
      </div>
    </Stage>
  );
};

/** F3 使い分けの図（左）と端末の録画（右、children） */
export const Models: React.FC<{ children: React.ReactNode; counters?: string[] }> = ({ children, counters }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <Stage row gap={48}>
      <div style={{ width: 760 }}>
        <div style={{ fontSize: TYPE.h2, fontWeight: 600, marginBottom: 16, ...rise(frame, 0) }}>道具の中の使い分け</div>
        <div style={{ background: COLOR.white, borderRadius: RADIUS.panel, overflow: "hidden" }}>
          {MODEL_ROWS.map((m, i) => {
            // 最後の行（ルールの表、AI を使わない）を強調。強調の形はルールの表と同じ（左の帯・薄い地・太字）
            const last = i === MODEL_ROWS.length - 1;
            return (
              <div
                key={m.what}
                style={{
                  position: "relative",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "18px 26px",
                  fontSize: 28,
                  background: last ? COLOR.blueTint : COLOR.white,
                  color: COLOR.blue,
                  fontWeight: last ? 600 : 400,
                  borderTop: i === 0 ? undefined : HAIRLINE,
                  ...rise(frame, 6 + i * STAGGER, 12),
                }}
              >
                {last ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: COLOR.blue }} /> : null}
                <span>{m.what}</span>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{m.who}</span>
              </div>
            );
          })}
        </div>
        {counters ? (
          // 「commit ［N］」を名前と数に分け、名前を上に小さく・数を下に大きく。3 つを同じ幅に並べる
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${counters.length}, 1fr)`, gap: 16, marginTop: 28 }}>
            {counters.map((c, i) => {
              const at = c.search(/[［\d]/);
              const name = at > 0 ? c.slice(0, at).trim() : c;
              const count = at > 0 ? c.slice(at).trim() : "";
              return (
                <div key={c} style={{ background: COLOR.white, color: COLOR.blue, borderRadius: RADIUS.panel, padding: "16px 22px", ...rise(frame, 30 + i * STAGGER) }}>
                  <div style={{ fontSize: TYPE.caption, fontWeight: 600, whiteSpace: "nowrap", color: COLOR.blueMid }}>{name}</div>
                  <div style={{ fontSize: TYPE.h2, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{count}</div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <div style={{ width: 860 }}>{children}</div>
    </Stage>
  );
};

/** 協力ケアマネの一言（文字。顔は出さない） */
export const Quote: React.FC<{ text: string; sub?: string; by?: string; children?: React.ReactNode }> = ({ text, sub, by = "協力してくれたケアマネージャー", children }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <Stage gap={28}>
      {/* 一言は声に合わせた言葉（children）があればそれ、無ければ 1 つの文で */}
      {children ?? <div style={{ fontSize: TYPE.h1, fontWeight: 600, maxWidth: 1400, textAlign: "center", lineHeight: 1.4, ...rise(frame, 0, 22, 16) }}>{text}</div>}
      <div style={{ fontSize: TYPE.body, color: p.sub, ...rise(frame, 8) }}>{by}</div>
      {sub ? <div style={{ fontSize: TYPE.body, marginTop: 24, ...rise(frame, 16) }}>{sub}</div> : null}
    </Stage>
  );
};

/**
 * G5 終わりの画面。アプリのロゴ（印と名前。白い面の上に置く。ロゴの青は青い地では沈むため）が、12 時から順に描かれて満ちる。下に GitHub だけ。
 * デモの URL と審査員の ID・パスワードは出さない（提出書類の欄に書く物で、どの画面もログインが要るため）。「利用者は架空」は録画が映る間の隅に出ていて、ここでは出さない
 */
export const EndCard: React.FC<{ repo: string; duration?: number }> = ({ repo, duration = 120 }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  // 短いとき（締めの言葉のあとの 1.7 秒）は描く動きを詰める。描き終えてから 0.5 秒以上は止めて見せる
  const short = duration < 70;
  const logoStart = short ? 3 : 10;
  const logoLen = short ? 30 : 48;
  const repoAt = short ? 18 : 40;
  return (
    <Stage gap={44}>
      <div style={{ background: COLOR.white, borderRadius: RADIUS.panel, padding: "40px 76px 40px 52px", display: "flex", alignItems: "center", gap: 34, ...rise(frame, 0, 20, 16) }}>
        <Logo size={210} start={logoStart} len={logoLen} />
        <div style={{ fontSize: 150, fontWeight: 600, lineHeight: 1, color: LOGO_INK }}>ケア72</div>
      </div>
      <div style={{ fontSize: TYPE.h2, color: p.fg, ...rise(frame, repoAt) }}>{repo}</div>
    </Stage>
  );
};
