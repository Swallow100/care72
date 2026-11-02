// 状態の印と、色の文字。色は意味にだけ（app/globals.css の --state-*）。印には必ず文字を添える。
// 印は澄んだ色の塗りの小さな四角（角 2px）。ピル型にしない。薄い下地（色を面に混ぜた物）は使わない（ダークで濁る）。
// 1 行に印を並べすぎない: 安否の状態・災害の状態のように一番大事な物だけを塗りの印にし、
// 避難計画・未確認の数のような 2 番目の状態は色の文字（StateText）にする。
// 黄（要確認）だけは文字の色に使わない（白の上で読めない。11/3 03:3x の確定 3）。黄の文字の所は本文色の文字と、前に黄の細い帯
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

/** 色の付いた印（塗り）。文字（至急・未確認・同意など）を必ず持つ */
export function StateTag({ tone, size = "sm", children }: { tone: Tone; size?: "sm" | "md"; children: React.ReactNode }) {
  const box = size === "md" ? "px-1.5 py-px text-sm leading-5" : "px-1 text-xs leading-[1.125rem]";
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
 * tone を付けると文字だけ状態の色の太字（地は塗らない。医療の印の時計の長さの色など。要確認は本文色＋黄の細い帯）
 */
export function Mark({
  inPanel2 = false,
  size = "sm",
  tone,
  children,
}: {
  inPanel2?: boolean;
  size?: "sm" | "md";
  tone?: Tone | null;
  children: React.ReactNode;
}) {
  const box = size === "md" ? "px-1.5 text-sm leading-6" : "px-1 text-xs leading-[1.125rem]";
  return (
    <span
      className={`inline-block rounded-sm whitespace-nowrap ${box} ${inPanel2 ? "bg-panel" : "bg-panel2"} ${tone ? `font-bold ${TONE_TEXT[tone]}` : ""}`}
      data-tone={tone ?? undefined}
    >
      {children}
    </span>
  );
}
