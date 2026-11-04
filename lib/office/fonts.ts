// Excel・Word の書体の名前を、描くときの書体と字の幅の見積もりに写す（T119）。
// 端末に元の書体（ＭＳ 明朝・游ゴシックなど）があればそれで、無ければ明朝・ゴシックの近い書体で描く（iPhone に MS の書体は無い）。
// 枠の位置は書体に左右されない（Excel の列幅は既定の書体の数字の幅で決まる＝mdwOf、Word の表は格子の幅）。字の幅は折り返しと行の高さにだけ効く。

import type { FontSpec } from "./page.ts";

const MINCHO = /明朝|mincho|century|times|serif|ming|song|batang|教科書|楷書|kyokasho/i;

/** 明朝の系統か */
export const isMincho = (name: string) => MINCHO.test(name);

/** 等幅の和文書体（半角が全角の半分）か。ＭＳ ゴシック・ＭＳ 明朝（P の付かない物）、BIZ UD ゴシック・明朝（P の無い物） */
export const isMonospaceJa = (name: string) => /^(ＭＳ|MS)\s*(ゴシック|明朝|Gothic|Mincho)$/i.test(name.trim()) || /^BIZ\s*UD(ゴシック|明朝|Gothic|Mincho)/i.test(name.trim());

const GOTHIC_STACK = ['"Yu Gothic"', '"YuGothic"', '"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"', '"BIZ UDPGothic"', '"Meiryo"', '"MS PGothic"', '"Noto Sans JP"', "sans-serif"];
const MINCHO_STACK = ['"Yu Mincho"', '"YuMincho"', '"Hiragino Mincho ProN"', '"BIZ UDPMincho"', '"MS PMincho"', '"MS Mincho"', '"Noto Serif JP"', "serif"];

/** 和名の書体の英名（端末によっては英名でしか引けない） */
const ALIASES: Record<string, string> = {
  "ＭＳ 明朝": "MS Mincho",
  "ＭＳ Ｐ明朝": "MS PMincho",
  "ＭＳ ゴシック": "MS Gothic",
  "ＭＳ Ｐゴシック": "MS PGothic",
  "ＭＳ ＵＩ ゴシック": "MS UI Gothic",
  游明朝: "Yu Mincho",
  游ゴシック: "Yu Gothic",
  "游ゴシック Medium": "Yu Gothic Medium",
  メイリオ: "Meiryo",
  "BIZ UD明朝 Medium": "BIZ UDMincho",
  "BIZ UDP明朝 Medium": "BIZ UDPMincho",
  "BIZ UD明朝": "BIZ UDMincho",
  "BIZ UDP明朝": "BIZ UDPMincho",
  "BIZ UDゴシック": "BIZ UDGothic",
  "BIZ UDPゴシック": "BIZ UDPGothic",
  "HG丸ｺﾞｼｯｸM-PRO": "HGMaruGothicMPRO",
  "HGP創英角ﾎﾟｯﾌﾟ体": "HGPSoeiKakupoptai",
};

const quote = (s: string) => `"${s.replace(/["\\]/g, "")}"`;

/** CSS の書体の並び（元の名前 → 英名 → 近い書体 → 総称） */
export function cssFamily(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  const stack = n && isMincho(n) ? MINCHO_STACK : GOTHIC_STACK;
  const head: string[] = [];
  if (n) {
    head.push(quote(n));
    const alias = ALIASES[n];
    if (alias) head.push(quote(alias));
  }
  return [...head, ...stack.filter((s) => !head.includes(s))].join(", ");
}

/** canvas の font の文字（px） */
export const cssFont = (f: FontSpec, px: number) => `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${Math.max(1, px).toFixed(2)}px ${f.family}`;

/** 全角の字か（CJK・かな・全角の記号と英数字） */
export function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x2460 && code <= 0x24ff) ||
    (code >= 0x25a0 && code <= 0x27bf) ||
    (code >= 0x2190 && code <= 0x21ff) ||
    (code >= 0x2200 && code <= 0x22ff) ||
    (code >= 0x2010 && code <= 0x2027) ||
    code >= 0x20000
  );
}

/** 字の幅の見積もり（mm）。全角 1 字、半角は書体が等幅なら 0.5 字、ほかは字ごとの大まかな幅 */
export function estimateWidth(text: string, font: FontSpec, mono = false): number {
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (isWide(c)) em += 1;
    else if (c >= 0xff61 && c <= 0xff9f) em += 0.5;
    else if (mono) em += 0.5;
    else if (ch === " ") em += 0.3;
    else if (/[il.,:;'!|]/.test(ch)) em += 0.28;
    else if (/[mwMW@]/.test(ch)) em += 0.85;
    else if (/[A-Z]/.test(ch)) em += 0.66;
    else em += 0.55;
  }
  return em * font.size * (font.bold ? 1.04 : 1);
}

/**
 * Excel の既定の書体（標準のスタイルの書体）の数字の幅（96 dpi の画素、11pt のとき）。列幅の文字数を画素にするのに使う（ECMA-376 18.3.1.13）。
 * Excel が画面の書体の数字の幅を整数の画素で持つので、書体ごとの値。表に無い書体はゴシック・明朝の値。
 * 双子の PDF（同じ市の Excel と PDF）で印刷範囲の幅を測って合わせた（docs/progress/t119.md）。
 */
const MDW_11: Array<[RegExp, number]> = [
  [/^calibri$/i, 7],
  [/^arial$/i, 8],
  [/^(ＭＳ|MS)\s*Ｐ?\s*(ゴシック|明朝|P?Gothic|P?Mincho)$/i, 8],
  [/^(游|Yu)\s*(ゴシック|Gothic|明朝|Mincho)/i, 8],
  [/^(メイリオ|Meiryo)/i, 9],
  [/^BIZ\s*UD/i, 8],
];

export function mdwOf(name: string | null | undefined, sizePt: number): number {
  const n = (name ?? "").trim();
  let base = 8;
  for (const [re, v] of MDW_11) {
    if (re.test(n)) {
      base = v;
      break;
    }
  }
  return Math.max(1, Math.round((base * sizePt) / 11));
}

/**
 * Word の「1 行」の高さ（字の大きさに掛ける）。書体の上下の高さの和（OS/2 の win 値）。格子（docGrid の linePitch）に合わせる前の値。
 * 表に無い書体は 1.17（ＭＳ 明朝に近い値）
 */
const LINE_EM: Array<[RegExp, number]> = [
  [/^(ＭＳ|MS)\s*Ｐ?\s*(ゴシック|明朝|P?Gothic|P?Mincho)$/i, 1.0],
  [/^(游|Yu)\s*(ゴシック|Gothic)/i, 1.5],
  [/^(游|Yu)\s*(明朝|Mincho)/i, 1.5],
  [/^(メイリオ|Meiryo)/i, 1.5],
  [/^BIZ\s*UD/i, 1.2],
  [/^century$/i, 1.17],
];

export function lineEmOf(name: string | null | undefined): number {
  const n = (name ?? "").trim();
  for (const [re, v] of LINE_EM) if (re.test(n)) return v;
  return 1.17;
}

/**
 * Excel の既定の書体の数字の幅（字の大きさに掛ける）。印刷の列幅はこれで決まる（列幅の文字数 × 数字の幅）。
 * 値は書体の字の幅（游ゴシック 0.5562・ＭＳ と BIZ UD の書体 0.5 など）。表に無い書体は 0.5
 */
const DIGIT_EM: Array<[RegExp, number]> = [
  [/^(游|Yu)s*(ゴシック|Gothic)/i, 0.5562],
  [/^(游|Yu)s*(明朝|Mincho)/i, 0.542],
  [/^(メイリオ|Meiryo)/i, 0.6211],
  [/^calibri$/i, 0.5068],
  [/^(arial|century)$/i, 0.5562],
];

export function digitEmOf(name: string | null | undefined): number {
  const n = (name ?? "").trim();
  for (const [re, v] of DIGIT_EM) if (re.test(n)) return v;
  return 0.5;
}

/** 高さを指定していない行の、印刷の高さ ÷ 画面の高さ（游ゴシックだけ縮む。双子の PDF で測った値） */
export function autoRowFactorOf(name: string | null | undefined): number {
  return /^(游|Yu)s*(ゴシック|Gothic)/i.test((name ?? "").trim()) ? 0.9637 : 1;
}
