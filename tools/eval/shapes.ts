// 評価の台（tools/eval）が共有する「漏れの形」の表（T118）。台は仮名化の層（lib/pseudonym）の物差しを借りずに、自分の物差しで見る
// （同じ物差しだと、層の穴を台が見つけられない）。
//
// 生年月日: 台帳の YYYY-MM-DD から、ケアマネの文・書き起こし・書類に出る書き方を全部作る（西暦・和暦・略記・漢数字・年だけ）。
// 比べるときは両方を NFKC にして空きを抜く（全角の数字・空きの入った形も同じに見る）。
// 書類の台（T107、tools/eval/forms/record.ts の bannedWords）も、integrate/t11-t12 に入ったあとにこの表を使う（docs/progress/t118.md）。

import { wareki } from "../../lib/forms/wareki.ts";

/** NFKC にして空きを抜く（比べる形） */
export const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

const KANJI = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1〜99 の漢数字（十五・二十・十）と、1 字ずつの漢数字（一五） */
function kanjiForms(n: number): string[] {
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const additive = `${tens === 0 ? "" : tens === 1 ? "十" : `${KANJI[tens]}十`}${ones === 0 ? "" : KANJI[ones]}` || "〇";
  const positional = String(n)
    .split("")
    .map((d) => KANJI[Number(d)])
    .join("");
  return [...new Set([additive, positional])];
}

const ERA_LETTER: Readonly<Record<string, string>> = { 明治: "M", 大正: "T", 昭和: "S", 平成: "H", 令和: "R" };

/**
 * 台帳の生年月日（YYYY-MM-DD）の書き方の一覧（squash した形）。年月日・年月・年（和暦の年だけ）。
 * 西暦の年だけ（1942 年）は入れない（ほかの年の数と見分けられない。仮名化の層は台帳と同じ年なら伏せる）
 */
export function birthVariants(iso: string): string[] {
  const [y, m, d] = iso.split("-").map(Number);
  const out = new Set<string>([
    iso,
    `${y}/${m}/${d}`,
    `${y}.${m}.${d}`,
    `${y}年${m}月${d}日`,
    `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`,
  ]);
  const w = wareki(iso);
  if (w) {
    const years = w.year === 1 ? ["元", "1"] : [String(w.year), ...kanjiForms(w.year)];
    const letter = ERA_LETTER[w.era];
    const short = w.era.slice(0, 1);
    for (const yy of years) {
      out.add(`${w.era}${yy}年`);
      for (const mm of [String(w.month), ...kanjiForms(w.month)]) {
        out.add(`${w.era}${yy}年${mm}月`);
        for (const dd of [String(w.day), ...kanjiForms(w.day)]) out.add(`${w.era}${yy}年${mm}月${dd}日`);
      }
    }
    for (const p of [letter, `${letter}.`, short]) {
      for (const sep of [".", "/"]) out.add(`${p}${w.year}${sep}${w.month}${sep}${w.day}`);
      out.add(`${p}${w.year}年${w.month}月${w.day}日`);
    }
  }
  return [...out].map(squash);
}

/** 文の中に台帳の生年月日の書き方のどれかがあるか。あれば当たった書き方（squash した形） */
export function birthIn(text: string, iso: string): string | null {
  const flat = squash(text);
  // 長い書き方から（「昭和17年4月18日」が「昭和17年」より先）
  for (const v of birthVariants(iso).sort((a, b) => b.length - a.length)) if (flat.includes(v)) return v;
  return null;
}
