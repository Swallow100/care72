// 生年月日の形（T118）。仮名化の層（./index.ts の scrub・findLeaks・maskReply）だけが使う。
//
// 台帳の生年月日は YYYY-MM-DD で持つが、ケアマネの文・書き起こし・書類の写しには、和暦（昭和 17 年 4 月 18 日）・略記（S17.4.18・昭 17.4.18）・
// 漢数字（昭和十七年四月十八日）・西暦（1942 年 4 月 18 日・1942/4/18）・全角の数字・空きの入った形で書かれる。どれも同じ日に読み直して比べる。
//
// 伏せる物:
// - 台帳の生年月日と同じ日（年月日）。年月だけ・年だけ（昭和十七年）は、台帳の生年月日の年月・年と同じときだけ
// - 生年月日らしい形: 「生年月日」「誕生日」の後ろ、「生」「生まれ」の前の日付（年だけでも）と、明治・大正・昭和（M・T・S）の年月日
//   （在宅の高齢者の書類で明治〜昭和の年月日はほぼ生年月日。平成・令和・西暦の年月日は訪問の日などに使うので、文脈か台帳と同じときだけ）
// 伏せ字は（生年月日）。元の書き方は ./index.ts の置き換えの記録が持ち、sourceRestorer が元の書き方に戻す。

import type { Span } from "./forms.ts";

export const BIRTH_MARK = "（生年月日）";

/** 台帳の生年月日（YYYY-MM-DD）と、漏れの見張りの名前（「A さんの生年月日」） */
export type Birth = { iso: string; what: string };

/** 台帳と照らさずに形だけで見つけた物の名前 */
export const BIRTH_FORM_WHAT = "生年月日らしい並び";

// ---------- 数 ----------

const D = "[0-9０-９]";
const KN = "[〇零一二三四五六七八九十百千]";
const NUM = `(?:${D}{1,4}|${KN}{1,6}|元)`;
const SP = "[ 　]*";
const SEP = "[./／・．\\-‐－ー−]";

const KANJI_DIGIT: Readonly<Record<string, number>> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNIT: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };

/** 数の字（半角・全角の数字、漢数字〔十五・一五〕、元）を整数に。読めなければ null */
export function numberOf(raw: string): number | null {
  const s = raw.trim();
  if (s === "元") return 1;
  if (/^[0-9０-９]+$/u.test(s)) return Number(s.replace(/[０-９]/gu, (c) => String(c.charCodeAt(0) - 0xff10)));
  if (!new RegExp(`^${KN}+$`, "u").test(s)) return null;
  if (/[十百千]/u.test(s)) {
    let total = 0;
    let cur = 0;
    for (const c of s) {
      if (c in KANJI_DIGIT) cur = KANJI_DIGIT[c];
      else {
        total += (cur || 1) * KANJI_UNIT[c];
        cur = 0;
      }
    }
    return total + cur;
  }
  let n = 0;
  for (const c of s) n = n * 10 + KANJI_DIGIT[c];
  return n;
}

// ---------- 元号 ----------

type EraName = "明治" | "大正" | "昭和" | "平成" | "令和";
const ERA_START: Readonly<Record<EraName, number>> = { 明治: 1868, 大正: 1912, 昭和: 1926, 平成: 1989, 令和: 2019 };
/** 略記（M・T・S・H・R と 明・大・昭・平・令）→ 元号 */
const ERA_ABBR: Readonly<Record<string, EraName>> = {
  M: "明治", T: "大正", S: "昭和", H: "平成", R: "令和",
  明: "明治", 大: "大正", 昭: "昭和", 平: "平成", 令: "令和",
};
/** 明治・大正・昭和の年月日は文脈が無くても生年月日らしい */
const OLD_ERAS: ReadonlySet<EraName> = new Set(["明治", "大正", "昭和"]);

const abbrEra = (raw: string): EraName | null => ERA_ABBR[raw.normalize("NFKC").toUpperCase()] ?? null;

// ---------- 日付の形 ----------

/** 見つけた日付（年は西暦。月・日は無いこともある） */
type Found = Span & { y: number; m: number | null; d: number | null; era: EraName | null };

const WEST_YEAR = `(?:[1１][89８９]${D}{2}|[2２][0０]${D}{2}|${KN}{4})`;
const ERA = "明治|大正|昭和|平成|令和";
const ABBR = "[MTSHRＭＴＳＨＲmtshr]|明|大|昭|平|令";

/**
 * 日付の形（左から順に試す。長い形が先）:
 * 1. 元号 年（月（日））: 昭和 17 年 4 月 18 日・昭和十七年・平成元年
 * 2. 略記 年.月.日: S17.4.18・S.17/4/18・昭17.4.18（略記の前が英数字なら当てない）
 * 3. 略記 年 月 日: S17年4月18日・昭17年4月18日（年月日まで揃うときだけ）
 * 4. 西暦 年（月（日））: 1942 年 4 月 18 日・一九四二年四月十八日・1942年
 * 5. 西暦 年-月-日: 1942-04-18・1942/4/18・1942.4.18
 * 6. 西暦の 8 桁: 19420418（台帳と同じ日か文脈のあるときだけ伏せる。番号と見分けられないので形だけでは伏せない）
 */
const DATE = new RegExp(
  [
    `(?<era>${ERA})${SP}(?<ey>${NUM})${SP}年(?:${SP}(?<em>${NUM})${SP}月(?:${SP}(?<ed>${NUM})${SP}日)?)?`,
    `(?<![A-Za-zＡ-Ｚａ-ｚ0-9０-９])(?<ab>${ABBR})[.．]?${SP}(?<ay>${D}{1,2})${SP}${SEP}${SP}(?<am>${D}{1,2})${SP}${SEP}${SP}(?<ad>${D}{1,2})(?![0-9０-９])`,
    `(?<![A-Za-zＡ-Ｚａ-ｚ0-9０-９])(?<bb>${ABBR})[.．]?${SP}(?<by>${D}{1,2})${SP}年${SP}(?<bm>${D}{1,2})${SP}月${SP}(?<bd>${D}{1,2})${SP}日`,
    `(?<![0-9０-９])(?<wy>${WEST_YEAR})${SP}年(?:${SP}(?<wm>${NUM})${SP}月(?:${SP}(?<wd>${NUM})${SP}日)?)?`,
    `(?<![0-9０-９])(?<sy>[1１][89８９]${D}{2}|[2２][0０]${D}{2})${SEP}(?<sm>${D}{1,2})${SEP}(?<sd>${D}{1,2})(?![0-9０-９])`,
    `(?<![0-9０-９])(?<cy>[1１][89８９]${D}{2})(?<cm>[01０１]${D})(?<cd>[0-3０-３]${D})(?![0-9０-９])`,
  ].join("|"),
  "gu",
);

function foundOf(m: RegExpMatchArray): Found | null {
  const g = m.groups ?? {};
  const pick = (era: EraName | null, y: string, mo?: string, d?: string): Found | null => {
    const yy = numberOf(y);
    const mm = mo === undefined ? null : numberOf(mo);
    const dd = d === undefined ? null : numberOf(d);
    if (yy === null || (mo !== undefined && mm === null) || (d !== undefined && dd === null)) return null;
    if (mm !== null && (mm < 1 || mm > 12)) return null;
    if (dd !== null && (dd < 1 || dd > 31)) return null;
    let year = yy;
    if (era) {
      if (yy < 1 || yy > 99) return null;
      year = ERA_START[era] + yy - 1;
    } else if (year < 1850 || year > 2100) return null;
    return { start: m.index!, end: m.index! + m[0].length, y: year, m: mm, d: dd, era };
  };
  if (g.era) return pick(g.era as EraName, g.ey, g.em, g.ed);
  if (g.ab) {
    const era = abbrEra(g.ab);
    return era ? pick(era, g.ay, g.am, g.ad) : null;
  }
  if (g.bb) {
    const era = abbrEra(g.bb);
    return era ? pick(era, g.by, g.bm, g.bd) : null;
  }
  if (g.wy) return pick(null, g.wy, g.wm, g.wd);
  if (g.sy) return pick(null, g.sy, g.sm, g.sd);
  if (g.cy) return pick(null, g.cy, g.cm, g.cd);
  return null;
}

/** 文の中の日付の形（重ならない、左から） */
function datesIn(text: string): Found[] {
  return [...text.matchAll(DATE)].flatMap((m) => foundOf(m) ?? []);
}

// ---------- 文脈 ----------

/** 前に「生年月日」「誕生日」（見出し・助詞・コロン・空きを挟んでよい） */
const LABEL_BEFORE = /(?:生年月日|誕生日|生年)[ 　]*(?:[:：]|は|が|の)?[ 　]*$/u;
/** 後ろに「生」「生まれ」「誕生」（「生活」「生命」「生徒」などの言葉は除く） */
const BIRTH_AFTER = /^[ 　]*(?:生まれ|産まれ|うまれ|誕生|生(?![活命徒涯産物協存理地前後])|）?[ 　]*生)/u;

function inBirthContext(text: string, f: Span): boolean {
  return LABEL_BEFORE.test(text.slice(Math.max(0, f.start - 10), f.start)) || BIRTH_AFTER.test(text.slice(f.end, f.end + 4));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 伏せる生年月日の場所と名前（台帳と同じ日なら births の what、形だけなら BIRTH_FORM_WHAT）。左から順、重ならない。
 * births が空なら形だけで見る（Claude の返事の作った日付。maskReply）
 */
export function birthSpans(text: string, births: ReadonlyArray<Birth>): Array<Span & { what: string }> {
  if (!/[0-9０-９〇零一二三四五六七八九十元]/u.test(text)) return [];
  const out: Array<Span & { what: string }> = [];
  for (const f of datesIn(text)) {
    const ymd = f.m !== null && f.d !== null ? `${f.y}-${pad(f.m)}-${pad(f.d)}` : null;
    const ym = f.m !== null ? `${f.y}-${pad(f.m)}` : null;
    const ledger = births.find((b) =>
      ymd !== null ? b.iso === ymd : ym !== null ? b.iso.startsWith(`${ym}-`) : b.iso.startsWith(`${f.y}-`),
    );
    if (ledger) {
      out.push({ start: f.start, end: f.end, what: ledger.what });
      continue;
    }
    const oldEraDay = f.era !== null && OLD_ERAS.has(f.era) && f.d !== null;
    if (oldEraDay || inBirthContext(text, f)) out.push({ start: f.start, end: f.end, what: BIRTH_FORM_WHAT });
  }
  return out;
}

/** 生年月日らしい形を伏せ字に（台帳と照らさない。Claude の返事の maskReply） */
export function maskBirthForms(text: string): string {
  let out = "";
  let last = 0;
  for (const s of birthSpans(text, [])) {
    out += text.slice(last, s.start) + BIRTH_MARK;
    last = s.end;
  }
  return out + text.slice(last);
}
