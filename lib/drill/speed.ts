// 早送りの間（T59）。DrillControls の早送りの横で選ぶ。端末の中だけで、保存しない。既定は今までと同じ 2.5 秒。

/** 選べる間（ms）。1・2.5・5 秒 */
export const FAST_INTERVALS = [1000, 2500, 5000] as const;

/** 既定の間（ms）。T59 の前の FAST_MS と同じ */
export const DEFAULT_FAST_MS = 2500;

/** 選んだ値（Select の value の文字）を間にする。表の外は既定 */
export function parseInterval(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return (FAST_INTERVALS as readonly number[]).includes(n) ? n : DEFAULT_FAST_MS;
}

/** 「2.5 秒」 */
export function intervalLabel(ms: number, unit: string): string {
  return `${ms / 1000} ${unit}`;
}
