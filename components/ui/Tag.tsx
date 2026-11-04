// 状態の印と、色の文字。色は意味にだけ（app/globals.css の --state-*）。印には必ず文字を添える。
// 印は澄んだ色の塗りの小さな四角（角 2px）。ピル型にしない。薄い下地（色を面に混ぜた物）は使わない（ダークで濁る）。
// 1 行に印を並べすぎない: 安否の状態・災害の状態のように一番大事な物だけを塗りの印にし、
// 避難計画・未確認の数のような 2 番目の状態は色の文字（StateText）にする。
// 黄（要確認）だけは文字の色に使わない（白の上で読めない）。黄の文字の所は本文色の文字と、前に黄の細い帯
// （app/globals.css の tone-check）。黄の塗りの印（StateTag）の文字は濃い色。

/** 状態の 4 色の名前（lib/person の StateTone と同じ） */
export type Tone = "ok" | "urgent" | "check" | "unknown";

/** 状態の文字の色。要確認は本文色の文字＋前に黄の細い帯（tone-check） */
export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-state-ok",
  urgent: "text-state-urgent",
  check: "tone-check",
  unknown: "text-state-unknown",
};

/** 状態の印の塗りと、その上の文字 */
export const TONE_FILL: Record<Tone, string> = {
  ok: "bg-state-ok-fill text-on-state-ok",
  urgent: "bg-state-urgent-fill text-on-state-urgent",
  check: "bg-state-check-fill text-on-state-check",
  unknown: "bg-state-unknown-fill text-on-state-unknown",
};

/**
 * 塗りの印の箱（大きさ）。人数の 0 の灰の印（CountLabel）も同じ箱にして、0 と 1 で並びが動かないようにする。
 * fit は 640px 未満で sm、それより広いと md（表の残りの列。375 で表が画面の幅を超えないように。T66）
 */
const TAG_BOX = {
  sm: "px-1 text-xs leading-[1.125rem]",
  md: "px-1.5 py-px text-sm leading-5",
  fit: "px-1 text-xs leading-[1.125rem] sm:px-1.5 sm:py-px sm:text-sm sm:leading-5",
} as const;

/** 色の付いた印（塗り）。文字（至急・未確認・同意など）を必ず持つ */
export function StateTag({ tone, size = "sm", children }: { tone: Tone; size?: keyof typeof TAG_BOX; children: React.ReactNode }) {
  const box = TAG_BOX[size];
  return (
    <span className={`inline-block rounded-sm font-bold whitespace-nowrap ${box} ${TONE_FILL[tone]}`} data-tone={tone}>
      {children}
    </span>
  );
}

/** 状態の色の文字（太字）。印ほど目立たせない 2 番目の状態に。要確認は本文色＋黄の細い帯 */
export function StateText({ tone, className = "", children }: { tone: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={`font-bold ${TONE_TEXT[tone]} ${className}`.trim()} data-tone={tone}>
      {children}
    </span>
  );
}

/**
 * 色の無い地の印（医療の印・区分の名前）。面の上では面の中の灰色の地、面の中の上では白。
 * tone を付けると文字だけ状態の色の太字（地は塗らない。医療の印の時計の長さの色など。要確認は本文色＋黄の細い帯）。
 * wrap を付けると空白の所でだけ折り返す（狭い表の氏名の下の「経管栄養 2.9日」が列を広げて表が幅を超えないように。T54）
 */
export function Mark({
  inPanel2 = false,
  size = "sm",
  tone,
  wrap = false,
  children,
}: {
  inPanel2?: boolean;
  size?: "sm" | "md";
  tone?: Tone | null;
  wrap?: boolean;
  children: React.ReactNode;
}) {
  const box = size === "md" ? "px-1.5 text-sm leading-6" : "px-1 text-xs leading-[1.125rem]";
  return (
    <span
      className={`inline-block rounded-sm ${wrap ? "break-keep" : "whitespace-nowrap"} ${box} ${inPanel2 ? "bg-panel" : "bg-panel2"} ${tone ? `font-bold ${TONE_TEXT[tone]}` : ""}`}
      data-tone={tone ?? undefined}
    >
      {children}
    </span>
  );
}

/**
 * 状態の人数の組（「至急 2」「要確認 1」「無事 0」）の言葉。1 人以上は 4 つとも言葉を状態の塗りの印（StateTag）にし、数は本文色
 * （countClass）。0 人は印も数も灰: 同じ箱で色の無い地（面の上は面の中の灰、面の中の上は白）に薄い本文色の言葉、数も薄い本文色。
 * 0 人は灰のまま（docs/DECISIONS.md「画面」）。前は数に状態の色・要確認だけ言葉を黄の塗りで、
 * 色の付く所が状態ごとに違った（T66）。0 の灰は不明の塗り（--state-unknown-fill）を使わない（0 人の至急が不明に見えないように）。
 * 担当一覧の上・右の面・地図の全画面・訓練・事業所・様式 9・受入一覧・避難計画の内訳で同じ形
 */
export function CountLabel({
  tone,
  count,
  size = "sm",
  inPanel2 = false,
  children,
}: {
  tone: Tone | null;
  count: number;
  size?: "sm" | "md";
  /** 面の中（灰の地）の上に置くとき。0 の印の地を白にする */
  inPanel2?: boolean;
  children: React.ReactNode;
}) {
  if (tone && count > 0) {
    return (
      <StateTag tone={tone} size={size}>
        {children}
      </StateTag>
    );
  }
  return (
    <span
      className={`inline-block rounded-sm font-bold whitespace-nowrap text-muted ${TAG_BOX[size]} ${inPanel2 ? "bg-panel" : "bg-panel2"}`}
      data-zero
    >
      {children}
    </span>
  );
}

/** 状態の人数の数の文字の色（CountLabel と組で使う）。1 人以上は本文色（色は言葉の印だけに置く）、0 は薄い本文色 */
export function countClass(count: number): string {
  return count > 0 ? "" : "text-muted";
}
