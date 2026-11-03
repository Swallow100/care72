// 編集で描く図と文字の画面（docs/video/MATERIALS.md の F1〜F3・G1〜G5）。
// 青と白のコントラスト: 字は地の逆の色。赤と緑は至急と無事の意味のときだけ。
// どの図も舞台（LAYOUT.stage）の中で真ん中にそろえ、出るときは下から上がる（motion.ts）。並ぶ物は 4 コマずつずらす。
// 話の段（青地）は文字が主役: 言葉を声に合わせて 1 つずつ出し、大きさの段で強弱を付ける。
import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { usePalette } from "../ground";
import { COLOR, FONT, LAYOUT, STATE_LABEL, TYPE } from "../theme";
import { MODEL_ROWS, RULE_ROWS } from "../timeline";
import { EASE_OUT, STAGGER, progress, rise } from "./motion";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

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
                  borderRadius: 8,
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
 * G1 72 時間の輪。目盛りが時計回りに 1 つずつ埋まり、12 時間ごとの太い目盛りに時間を添える。
 * 題名（ケア72）は輪の中で、目盛りが半分まで埋まった所で上がって出る
 */
export const Ring72: React.FC<{ label: string; duration: number; sub?: string }> = ({ label, duration, sub }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const fill = interpolate(frame, [0, duration * 0.75], [0, 72], { ...clamp, easing: EASE_OUT });
  const r = 320;
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2 - Math.PI / 2;
    const major = i % 12 === 0;
    const on = Math.max(0, Math.min(1, fill - i));
    const inner = r - (major ? 46 : 30);
    return (
      <g key={i}>
        <line x1={Math.cos(a) * inner} y1={Math.sin(a) * inner} x2={Math.cos(a) * r} y2={Math.sin(a) * r} stroke={p.tint} strokeWidth={major ? 8 : 4} strokeLinecap="round" />
        <line
          x1={Math.cos(a) * inner}
          y1={Math.sin(a) * inner}
          x2={Math.cos(a) * (inner + (r - inner) * on)}
          y2={Math.sin(a) * (inner + (r - inner) * on)}
          stroke={p.fg}
          strokeWidth={major ? 8 : 4}
          strokeLinecap="round"
        />
        {major ? (
          <text
            x={Math.cos(a) * (r + 40)}
            y={Math.sin(a) * (r + 40) + 9}
            textAnchor="middle"
            fontFamily={FONT.main}
            fontSize={TYPE.caption}
            fill={on > 0 ? p.fg : p.sub}
          >
            {i}
          </text>
        ) : null}
      </g>
    );
  });
  const titleIn = progress(frame, Math.round(duration * 0.18), 18);
  return (
    <Stage gap={0}>
      <div style={{ position: "relative", width: 820, height: 820 }}>
        <svg width={820} height={820} viewBox="-410 -410 820 820" style={{ position: "absolute", inset: 0 }}>
          {ticks}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontSize: TYPE.display, fontWeight: 600, lineHeight: 1, opacity: titleIn, transform: `translateY(${(1 - titleIn) * 26}px)` }}>{label}</div>
          {sub ? <div style={{ fontSize: TYPE.body, color: p.sub, ...rise(frame, Math.round(duration * 0.35)) }}>{sub}</div> : null}
        </div>
      </div>
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
  const percent = m?.[2] === "%";
  return (
    <Stage gap={34}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, ...rise(frame, 0, 20, 14) }}>
        <span style={{ fontSize: 230, fontWeight: 600, lineHeight: 1 }}>{m ? count.toFixed(digits) : value}</span>
        {m ? <span style={{ fontSize: 120, fontWeight: 600, lineHeight: 1 }}>{m[2] + m[3]}</span> : null}
      </div>
      {percent ? <Dots share={count / 100} delay={8} /> : null}
      {sub ? <div style={{ fontSize: TYPE.h2, color: p.sub, maxWidth: 1500, textAlign: "center", ...rise(frame, 16) }}>{sub}</div> : null}
    </Stage>
  );
};

/** 100 個の点（10 × 10 でなく横 50 × 2 段）。share の割合だけ濃い色 */
const Dots: React.FC<{ share: number; delay: number }> = ({ share, delay }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const lit = Math.floor(share * 100 + 1e-6);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(50, 18px)", gap: 8, ...rise(frame, delay) }}>
      {Array.from({ length: 100 }, (_, i) => (
        <div key={i} style={{ width: 18, height: 18, borderRadius: 9, background: i < lit ? p.fg : p.tint }} />
      ))}
    </div>
  );
};

/** G2 2 本の棒（能登の死者 755 人と、そのうち関連死 527 人）。棒の長さは 755 を舞台の幅に合わせる */
export const Bars: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const max = 980;
  const rows = [
    { label: "死者", n: 755, color: p.tint, strong: false },
    { label: "うち関連死", n: 527, color: p.fg, strong: true },
  ];
  return (
    <Stage gap={44} align="center">
      {rows.map((row, i) => {
        const t = progress(frame, 4 + i * 12, 30);
        return (
          <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 32, width: 1560, ...rise(frame, i * STAGGER * 2) }}>
            <div style={{ width: 260, fontSize: TYPE.h2, textAlign: "right", fontWeight: row.strong ? 600 : 400, whiteSpace: "nowrap" }}>{row.label}</div>
            <div style={{ width: max + 220, height: 84, position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: 84, width: (row.n / 755) * max * t, background: row.color, borderRadius: 6 }} />
              <div
                style={{
                  position: "absolute",
                  left: (row.n / 755) * max * t + 28,
                  top: 0,
                  height: 84,
                  display: "flex",
                  alignItems: "center",
                  fontSize: TYPE.h1,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {Math.round(row.n * t)} 人
              </div>
            </div>
          </div>
        );
      })}
    </Stage>
  );
};

/** G3 手書きのメモの線画。字の線が書かれていき、用量・用法の欄は点線のまま空いて残る。「イメージ」は注記の隅に（Video.tsx） */
export const Memo: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const ink = COLOR.blue;
  const draw = (start: number, len = 400) => ({
    strokeDasharray: len,
    strokeDashoffset: len * (1 - progress(frame, start, 14)),
  });
  const stroke = { stroke: ink, strokeWidth: 6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const blank = progress(frame, 44, 12);
  return (
    <Stage>
      <div style={{ ...rise(frame, 0, 20, 14) }}>
        <svg width={820} height={600} viewBox="0 0 820 600">
          <rect x={0} y={0} width={820} height={600} rx={12} fill={COLOR.white} />
          {[120, 220, 320, 420, 520].map((y) => (
            <line key={y} x1={60} y1={y} x2={760} y2={y} stroke={p.bg === COLOR.blue ? "#dbe6fa" : COLOR.blueTint} strokeWidth={2} />
          ))}
          <path d="M80 104 q 40 -18 80 0 t 80 0 t 80 -6 t 70 4" {...stroke} style={draw(4)} />
          <path d="M80 204 q 50 -14 100 2 t 100 -2 t 60 6" {...stroke} style={draw(12)} />
          <path d="M80 304 q 30 -14 60 0 t 50 2" {...stroke} style={draw(20, 200)} />
          <text x={330} y={316} fontFamily={FONT.main} fontSize={TYPE.h2} fill={ink} opacity={progress(frame, 28, 8)}>
            用量
          </text>
          <line x1={440} y1={312} x2={720} y2={312} stroke={COLOR.urgent} strokeWidth={4} strokeDasharray="14 12" opacity={blank} />
          <path d="M80 404 q 50 -14 100 0 t 90 6" {...stroke} style={draw(32, 300)} />
          <text x={330} y={416} fontFamily={FONT.main} fontSize={TYPE.h2} fill={ink} opacity={progress(frame, 38, 8)}>
            用法
          </text>
          <line x1={440} y1={412} x2={720} y2={412} stroke={COLOR.urgent} strokeWidth={4} strokeDasharray="14 12" opacity={blank} />
          <text x={736} y={330} fontFamily={FONT.main} fontSize={TYPE.body} fontWeight={600} fill={COLOR.urgent} opacity={blank} textAnchor="end" dy={-40}>
            空欄
          </text>
        </svg>
      </div>
    </Stage>
  );
};

/** F1 台帳 1 つから 3 つの紙面。上の「台帳」から 3 本の線が伸び、紙面が左から 1 つずつ出る。children に 3 つの録画（か仮の面）を渡す。紙面の名前は窓の帯に出るので、names は描かない（key だけ） */
export const Flow: React.FC<{ children: React.ReactNode[]; names: string[]; cardWidth: number }> = ({ children, names, cardWidth }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const gap = 48;
  const total = cardWidth * 3 + gap * 2;
  const grow = progress(frame, 6, 14);
  return (
    <Stage gap={0}>
      <div style={{ background: p.strong, color: p.onStrong, borderRadius: 8, padding: "16px 64px", fontSize: TYPE.h2, fontWeight: 600, ...rise(frame, 0) }}>台帳</div>
      <svg width={total} height={70} style={{ display: "block" }}>
        {[0, 1, 2].map((i) => {
          const x = cardWidth / 2 + i * (cardWidth + gap);
          return (
            <path
              key={i}
              d={`M ${total / 2} 0 L ${total / 2} 26 L ${x} 26 L ${x} 70`}
              stroke={p.fg}
              strokeWidth={4}
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
          <span style={{ background: p.strong, color: p.onStrong, fontSize: 28, fontWeight: 600, padding: "6px 16px", borderRadius: 4 }}>AI を使わない</span>
        </div>
        <div style={{ background: COLOR.white, borderRadius: 10, overflow: "hidden", padding: "6px 0" }}>
          <div style={{ display: "flex", gap: 24, padding: "10px 32px", fontSize: TYPE.caption, color: COLOR.blueLight, ...rise(frame, 4) }}>
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
        <div style={{ background: COLOR.white, borderRadius: 10, overflow: "hidden" }}>
          {MODEL_ROWS.map((m, i) => {
            const last = i === MODEL_ROWS.length - 1;
            return (
              <div
                key={m.what}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "18px 26px",
                  fontSize: 28,
                  background: last ? p.strong : i % 2 === 0 ? COLOR.white : COLOR.blueTint,
                  color: last ? p.onStrong : COLOR.blue,
                  ...rise(frame, 6 + i * STAGGER, 12),
                }}
              >
                <span>{m.what}</span>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{m.who}</span>
              </div>
            );
          })}
        </div>
        {counters ? (
          <div style={{ display: "flex", gap: 40, fontSize: TYPE.body, fontWeight: 600, marginTop: 28 }}>
            {counters.map((c, i) => (
              <span key={c} style={rise(frame, 30 + i * STAGGER)}>
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ width: 860 }}>{children}</div>
    </Stage>
  );
};

/** 協力ケアマネの一言（文字。顔は出さない） */
export const Quote: React.FC<{ text: string; sub?: string }> = ({ text, sub }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <Stage gap={28}>
      <div style={{ fontSize: TYPE.h1, fontWeight: 600, maxWidth: 1400, textAlign: "center", lineHeight: 1.4, ...rise(frame, 0, 22, 16) }}>{text}</div>
      <div style={{ fontSize: TYPE.body, color: p.sub, ...rise(frame, 8) }}>協力してくれたケアマネ</div>
      {sub ? <div style={{ fontSize: TYPE.body, marginTop: 24, ...rise(frame, 16) }}>{sub}</div> : null}
    </Stage>
  );
};

/** G5 終わりの画面。72 時間の輪を小さく題名の横に。審査員の ID とパスワードは出さない */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2 - Math.PI / 2;
    const major = i % 12 === 0;
    const r = 84;
    const inner = r - (major ? 16 : 10);
    return <line key={i} x1={Math.cos(a) * inner} y1={Math.sin(a) * inner} x2={Math.cos(a) * r} y2={Math.sin(a) * r} stroke={p.fg} strokeWidth={major ? 4 : 2} strokeLinecap="round" />;
  });
  return (
    <Stage gap={26}>
      <div style={{ display: "flex", alignItems: "center", gap: 40, ...rise(frame, 0, 20, 16) }}>
        <svg width={180} height={180} viewBox="-90 -90 180 180">
          {ticks}
        </svg>
        <div style={{ fontSize: 150, fontWeight: 600, lineHeight: 1 }}>ケア72</div>
      </div>
      <div style={{ background: p.strong, color: p.onStrong, fontSize: TYPE.h1, fontWeight: 600, padding: "10px 40px", borderRadius: 8, ...rise(frame, 8) }}>
        care72.app
      </div>
      <div style={{ fontSize: TYPE.body, color: p.sub, ...rise(frame, 12) }}>github.com/Swallow100/care72</div>
      <div style={{ display: "flex", gap: 28, fontSize: TYPE.caption, color: p.sub, marginTop: 34, ...rise(frame, 18) }}>
        <span>利用者は全員架空</span>
        <span>医療の助言はしない</span>
        <span>色と順位はルールの表 AI は決めない</span>
      </div>
    </Stage>
  );
};
