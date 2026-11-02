// 和暦。松山市の様式の生年月日（大正・昭和・平成・令和）と作成日に使う。
// 元号の始まりの日から数え、1 年目は「元」と書く。大正より前は西暦のまま（null）。

export const ERAS = ["大正", "昭和", "平成", "令和"] as const;
export type Era = (typeof ERAS)[number];

const STARTS: ReadonlyArray<[Era, string]> = [
  ["令和", "2019-05-01"],
  ["平成", "1989-01-08"],
  ["昭和", "1926-12-25"],
  ["大正", "1912-07-30"],
];

export type Wareki = { era: Era; year: number; month: number; day: number };

/** YYYY-MM-DD を和暦に。形が違う・大正より前は null */
export function wareki(iso: string): Wareki | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (const [era, start] of STARTS) {
    if (iso >= start) return { era, year: y - Number(start.slice(0, 4)) + 1, month: mo, day: d };
  }
  return null;
}

/** 「17 年 4 月 18 日」（元号は付けない）。1 年目は「元年」 */
export function warekiDate(w: Wareki): string {
  return `${w.year === 1 ? "元" : `${w.year} `}年 ${w.month} 月 ${w.day} 日`;
}

/** 「令和 8 年 11 月 2 日」。和暦にできなければ「2026 年 11 月 2 日」 */
export function warekiText(iso: string): string {
  const w = wareki(iso);
  if (w) return `${w.era} ${warekiDate(w)}`;
  const [y, mo, d] = iso.split("-").map(Number);
  return `${y} 年 ${mo} 月 ${d} 日`;
}
