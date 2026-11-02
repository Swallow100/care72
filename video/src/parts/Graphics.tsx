// 編集で描く図と文字の画面（docs/video/MATERIALS.md の F1〜F3・G1〜G5）。
// 青と白のコントラスト: 字は地の逆の色（白地に青、青地に白）。赤と緑は至急と無事の意味のときだけ。
import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { usePalette } from "../ground";
import { COLOR, FONT, STATE_LABEL } from "../theme";
import { MODEL_ROWS, RULE_ROWS } from "../timeline";

const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) } as const;

const Center: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 24 }) => {
  const p = usePalette();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap,
        fontFamily: FONT.main,
        color: p.fg,
        paddingBottom: 120,
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
  const y = interpolate(frame, [0, 18], [24, 0], ease);
  const opacity = interpolate(frame, [0, 12], [0, 1], ease);
  return (
    <Center>
      <div style={{ fontSize: 180, fontWeight: 600, transform: `translateY(${y}px)`, opacity }}>{title}</div>
      {sub ? <div style={{ fontSize: 44, color: p.sub, opacity }}>{sub}</div> : null}
    </Center>
  );
};

/** 文字だけの画面。sub は下の帯（S1 の「誰の・どの場面」）で、地の逆の色の面に置く */
export const TextCard: React.FC<{ lines: string[]; sub?: string }> = ({ lines, sub }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <>
      <Center gap={20}>
        {lines.map((l, i) => (
          <div
            key={l}
            style={{
              fontSize: i === 0 ? 88 : 72,
              fontWeight: 600,
              opacity: interpolate(frame, [i * 20, i * 20 + 12], [0, 1], ease),
            }}
          >
            {l}
          </div>
        ))}
      </Center>
      {sub ? (
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            bottom: 170,
            background: p.surface,
            color: p.onSurface,
            borderRadius: 6,
            padding: "18px 28px",
            fontFamily: FONT.main,
            fontSize: 40,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          {sub}
        </div>
      ) : null}
    </>
  );
};

/** G1 72 時間の輪。目盛りが 1 つずつ埋まる */
export const Ring72: React.FC<{ label: string; duration: number }> = ({ label, duration }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const filled = Math.round(interpolate(frame, [0, duration * 0.8], [0, 72], ease));
  const r = 300;
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2 - Math.PI / 2;
    return (
      <line
        key={i}
        x1={Math.cos(a) * (r - 34)}
        y1={Math.sin(a) * (r - 34)}
        x2={Math.cos(a) * r}
        y2={Math.sin(a) * r}
        stroke={i < filled ? p.fg : p.tint}
        strokeWidth={i % 12 === 0 ? 8 : 4}
        strokeLinecap="round"
      />
    );
  });
  return (
    <Center>
      <svg width={700} height={700} viewBox="-350 -350 700 700">
        {ticks}
        <text x={0} y={30} textAnchor="middle" fontFamily={FONT.main} fontWeight={600} fontSize={110} fill={p.fg}>
          {label}
        </text>
      </svg>
    </Center>
  );
};

/** G2 大きな数字。数だけの値（15.1% など）は 0 から数え上げる */
export const BigNumber: React.FC<{ value: string; sub?: string }> = ({ value, sub }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(value);
  let shown = value;
  if (m) {
    const target = Number(m[1]);
    const digits = (m[1].split(".")[1] ?? "").length;
    shown = interpolate(frame, [0, 36], [0, target], ease).toFixed(digits) + m[2];
  }
  return (
    <Center gap={16}>
      <div style={{ fontSize: 220, fontWeight: 600, lineHeight: 1 }}>{shown}</div>
      {sub ? <div style={{ fontSize: 40, color: p.sub, maxWidth: 1500, textAlign: "center" }}>{sub}</div> : null}
    </Center>
  );
};

/** G2 2 本の棒（能登の死者 755 人と、そのうち関連死 527 人） */
export const Bars: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const max = 1100;
  const rows = [
    { label: "死者", n: 755, color: p.tint },
    { label: "うち関連死", n: 527, color: p.fg },
  ];
  return (
    <Center gap={40}>
      {rows.map((row, i) => {
        const w = interpolate(frame, [i * 10, i * 10 + 30], [0, (row.n / 755) * max], ease);
        return (
          <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 28, width: 1600 }}>
            <div style={{ width: 300, fontSize: 48, textAlign: "right" }}>{row.label}</div>
            <div style={{ width: w, height: 72, background: row.color, borderRadius: 4 }} />
            <div style={{ fontSize: 64, fontWeight: 600 }}>{row.n} 人</div>
          </div>
        );
      })}
    </Center>
  );
};

/** G3 手書きのメモの線画。用量・用法の欄が空いている。「イメージ」と出す */
export const Memo: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const opacity = interpolate(frame, [0, 12], [0, 1], ease);
  const ink = p.onSurface;
  const stroke = { stroke: ink, strokeWidth: 5, strokeLinecap: "round" as const, fill: "none" };
  return (
    <Center>
      <div style={{ position: "relative", opacity }}>
        <svg width={760} height={560} viewBox="0 0 760 560">
          <rect x={20} y={20} width={720} height={520} rx={8} fill={p.surface} />
          <path d="M80 110 q 40 -14 80 0 t 80 0 t 80 -4" {...stroke} />
          <path d="M80 200 q 50 -10 100 2 t 100 -2" {...stroke} />
          <path d="M80 290 q 30 -12 60 0" {...stroke} />
          <text x={330} y={300} fontFamily={FONT.main} fontSize={40} fill={ink}>
            量
          </text>
          <line x1={390} y1={300} x2={640} y2={300} stroke={COLOR.blueLight} strokeWidth={4} strokeDasharray="14 12" />
          <path d="M80 380 q 50 -12 100 0 t 90 4" {...stroke} />
          <text x={330} y={390} fontFamily={FONT.main} fontSize={40} fill={ink}>
            用法
          </text>
          <line x1={420} y1={390} x2={640} y2={390} stroke={COLOR.blueLight} strokeWidth={4} strokeDasharray="14 12" />
        </svg>
        <div style={{ position: "absolute", right: 34, bottom: 34, fontSize: 24, color: ink }}>イメージ</div>
      </div>
    </Center>
  );
};

/** F1 台帳 1 つから 3 つの紙面。children に 3 つの録画（か仮の面）を渡す */
export const Flow: React.FC<{ children: React.ReactNode[]; names: string[] }> = ({ children, names }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: FONT.main, color: p.fg }}>
      <div
        style={{
          position: "absolute",
          left: 760,
          top: 60,
          width: 400,
          padding: "18px 0",
          background: p.surface,
          color: p.onSurface,
          borderRadius: 6,
          textAlign: "center",
          fontSize: 48,
          fontWeight: 600,
        }}
      >
        台帳
      </div>
      {children.map((child, i) => {
        const opacity = interpolate(frame, [8 + i * 10, 20 + i * 10], [0, 1], ease);
        return (
          <div key={names[i]} style={{ position: "absolute", left: 120 + i * 570, top: 230, width: 540, opacity }}>
            <div style={{ fontSize: 34, fontWeight: 600, marginBottom: 12, textAlign: "center" }}>{names[i]}</div>
            {child}
          </div>
        );
      })}
    </div>
  );
};

/** F2 ルールの表の 1 枚。上から順に行が出て、強調する行（0 と 2）は太字。至急は赤、無事は緑、ほかは青の字 */
export const Rules: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const colorOf = { urgent: COLOR.urgent, ok: COLOR.ok, check: p.fg, unknown: p.fg } as const;
  return (
    <div style={{ position: "absolute", left: 160, top: 70, width: 1600, fontFamily: FONT.main, color: p.fg }}>
      <div style={{ fontSize: 44, fontWeight: 600, marginBottom: 20 }}>ルールの表</div>
      <div style={{ borderRadius: 6, overflow: "hidden" }}>
        {RULE_ROWS.map((row, i) => {
          const opacity = interpolate(frame, [i * 5, i * 5 + 8], [0, 1], ease);
          const strong = i === 0 || i === 2;
          const filled = row.state === "urgent" || row.state === "ok";
          return (
            <div
              key={row.input}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                padding: "14px 28px",
                fontSize: 32,
                fontWeight: strong ? 600 : 400,
                opacity,
                background: i % 2 === 0 ? COLOR.blueTint : COLOR.white,
              }}
            >
              <div style={{ width: 640 }}>{row.input}</div>
              <div style={{ width: 190, display: "flex", alignItems: "center", gap: 10 }}>
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
      <div style={{ fontSize: 24, color: p.sub, marginTop: 14 }}>全 13 行のうち 7 行。docs/TRIAGE.md（コードから作り、テストで一致を確かめる）</div>
    </div>
  );
};

/** F3 使い分けの図（左）と端末の録画（右、children） */
export const Models: React.FC<{ children: React.ReactNode; counters?: string[] }> = ({ children, counters }) => {
  const p = usePalette();
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: FONT.main, color: p.fg }}>
      <div style={{ position: "absolute", left: 120, top: 70, width: 760 }}>
        <div style={{ fontSize: 40, fontWeight: 600, marginBottom: 16 }}>道具の中の使い分け</div>
        <div style={{ borderRadius: 6, overflow: "hidden" }}>
          {MODEL_ROWS.map((m, i) => {
            const last = i === MODEL_ROWS.length - 1;
            return (
              <div
                key={m.what}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "16px 24px",
                  fontSize: 28,
                  background: last ? p.surface : i % 2 === 0 ? COLOR.blueTint : COLOR.white,
                  color: last ? p.onSurface : p.fg,
                }}
              >
                <span>{m.what}</span>
                <span style={{ fontWeight: 600 }}>{m.who}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 940, top: 70, width: 860 }}>{children}</div>
      {counters ? (
        <div style={{ position: "absolute", left: 120, top: 640, display: "flex", gap: 48, fontSize: 40, fontWeight: 600 }}>
          {counters.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

/** 協力ケアマネの一言（文字。顔は出さない） */
export const Quote: React.FC<{ text: string; sub?: string }> = ({ text, sub }) => {
  const p = usePalette();
  return (
    <Center gap={28}>
      <div style={{ fontSize: 60, fontWeight: 600, maxWidth: 1500, textAlign: "center", lineHeight: 1.4 }}>{text}</div>
      <div style={{ fontSize: 30, color: p.sub }}>協力してくれたケアマネ</div>
      {sub ? <div style={{ fontSize: 34, marginTop: 24 }}>{sub}</div> : null}
    </Center>
  );
};

/** G5 終わりの画面。審査員の ID とパスワードは出さない */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const opacity = interpolate(frame, [0, 12], [0, 1], ease);
  return (
    <Center gap={18}>
      <div style={{ fontSize: 150, fontWeight: 600, opacity }}>ケア72</div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 600,
          opacity,
          background: p.surface,
          color: p.onSurface,
          padding: "8px 36px",
          borderRadius: 6,
        }}
      >
        care72.app
      </div>
      <div style={{ fontSize: 34, color: p.sub, opacity }}>github.com/Swallow100/care72</div>
      <div style={{ fontSize: 24, color: p.sub, marginTop: 30, opacity }}>
        利用者は全員架空・医療の助言はしない・色と順位はルールの表 AI は決めない
      </div>
    </Center>
  );
};
