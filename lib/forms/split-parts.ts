// 欄の中の区切りの空きに値を分ける（T120）。元の様式が「令和　年　月　日現在」「（　）年　月　日生」「（　歳）」「　−　−　」のように
// 欄の中に字を刷り、値をその間の空きに書く欄で、値（「令和8年11月5日」「090-0000-0001」）を丸ごと置くと刷った字と重なる。
// 様式の読み取り（lib/forms/form-read.ts の決まり 14）が、区切りの字を options（["年","月","日"]）、空きの場所を optionBoxes に返す。
// ここは値をその区切りに合わせて分けるだけの純な計算（元の様式の上に値を置く紙 lib/forms/overlay-sheet.ts が使う）。
// 分けられなければ null（呼ぶ側は今までどおり欄全体に置く）。

/** 単位の字（年・月・日・歳）。区切りの字の最後の 1 字 */
const UNITS = new Set(["年", "月", "日", "歳"]);
const ERA = /^(明治|大正|昭和|平成|令和)/;
/** 電話番号らしい並び（局番・市内・番号） */
const PHONE = /(\d{2,5})\s*[-‐－−ー―]\s*(\d{1,4})\s*[-‐－−ー―]\s*(\d{3,4})/;
const PHONE_PAREN = /[（(]\s*(\d{2,5})\s*[）)]\s*(\d{1,4})\s*[-‐－−ー―]\s*(\d{3,4})/;
const ZIP = /(\d{3})\s*[-‐－−ー―]?\s*(\d{4})/;

const norm = (s: string) => s.normalize("NFKC").trim();

/** 区切りの字が単位（年・月・日・歳）か。元号を付けた「令和年」も単位の年 */
export const isUnitPart = (option: string) => UNITS.has(norm(option).slice(-1));

/**
 * 値を区切りに合わせて分ける。options は区切りの字（左から）。
 * - 単位: options が全部「年」「月」「日」「歳」で終わる物。値の中の同じ字の前で切る（「昭和17年4月18日」→ 昭和17・4・18）。
 *   区切りの字に元号が付いていて（「令和年」）値の元号が同じなら、元号を外す（刷ってある元号と重ねない）
 * - 電話: 区切りが 3 つで、値に電話番号らしい並びがある物（090-0000-0001・(089)000-0000 → 090・0000・0001）
 * - 郵便番号: 区切りが 2 つで、値に 3 桁と 4 桁の並びがある物
 */
export function splitParts(value: string, options: readonly string[]): string[] | null {
  const v = norm(value);
  if (!v || options.length === 0) return null;
  if (options.every(isUnitPart)) {
    const out: string[] = [];
    let at = 0;
    for (const o of options) {
      const unit = norm(o).slice(-1);
      const i = v.indexOf(unit, at);
      if (i < 0) return null;
      let part = v.slice(at, i).trim();
      const printedEra = norm(o).slice(0, -1).match(ERA)?.[1];
      if (printedEra && part.startsWith(printedEra)) part = part.slice(printedEra.length).trim();
      if (part === "") return null;
      out.push(part);
      at = i + 1;
    }
    return out;
  }
  if (options.length === 3) {
    const m = v.match(PHONE_PAREN) ?? v.match(PHONE);
    return m ? [m[1], m[2], m[3]] : null;
  }
  if (options.length === 2) {
    const m = v.match(ZIP);
    return m ? [m[1], m[2]] : null;
  }
  return null;
}
