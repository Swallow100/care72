// 伏せ字の印の崩れた形（T122）。仮名化の層（./index.ts）が文に入れる伏せ字は全角の括弧の形（（町名）（氏名）…）だけだが、
// Claude の返事では括弧が崩れて返ることがある（評価の 2 回目で、自由文の避難先が半角の括弧の「(町名)」の形で返り、戻しも捨てもされずに
// 台帳に入った。docs/progress/eval-r2-forms-findings.md の 3）。ここは崩れた形を見つけて全角の括弧の形にそろえる所。
//
// 崩れた形として見る物:
// - 7 つの伏せ字の言葉（氏名・町名・電話・住所・郵便番号・メール・生年月日）を、両側を括弧で囲んだ形。括弧は全角・半角・別の種類
//   （【】［］[]〔〕〈〉《》「」『』＜＞<>｛｝{}）、左右の種類が違う物、括弧の内側の空き、言葉の字の間の空きも
// - 町名だけは、括弧の片方・両方が落ちた形も（「町名総合病院」「（町名小学校」「町名）公民館」）。町名はふつうの文に出てこない言葉なので。
//   ほかの 6 つ（電話・住所・氏名…）は特記・備考にふつうに書く言葉なので、括弧の無い形は伏せ字と見ない
//
// 戻す側（./index.ts の sourceRestorer）は、崩れた形をそろえてから元の文と照らして戻す。戻せなければ全角の括弧の形のまま返すので、
// 伏せ字の検査（hasMaskMark。lib/intake の diff.ts・save.ts）がそのまま捕まえる。
// ケアマネが入れた文・台帳の文にその形がそのまま書いてある物（「連絡(電話)」と自分で書いた）は、keep で崩れた形と見ない。

/** 伏せ字の言葉（./index.ts の MASK_MARKS の括弧の中と同じ順） */
export const MARK_WORDS = ["氏名", "町名", "電話", "住所", "郵便番号", "メール", "生年月日"] as const;
export type MarkWord = (typeof MARK_WORDS)[number];

const OPEN = "（(【［\\[〔〈《「『＜<｛{";
const CLOSE = "）)】］\\]〕〉》」』＞>｝}";
const SP = "[ 　]*";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 言葉の字の間の空きも受ける（「町 名」） */
const wordSource = (w: string) => [...w].map(esc).join("[ 　]?");

/** 両側を括弧で囲んだ形（7 つの言葉） */
const PAIRED = new RegExp(`[${OPEN}]${SP}(${MARK_WORDS.map(wordSource).join("|")})${SP}[${CLOSE}]`, "gu");
/** 町名は括弧が片方・両方落ちた形も */
const TOWN_LOOSE = new RegExp(`[${OPEN}]?${SP}(${wordSource("町名")})${SP}[${CLOSE}]?`, "gu");

export type MarkSpan = {
  start: number;
  end: number;
  word: MarkWord;
  /** 全角の括弧の形そのもの（（町名）） */
  canonical: boolean;
};

const markOf = (word: MarkWord) => `（${word}）`;
const wordOf = (raw: string): MarkWord | null => {
  const w = raw.replace(/[ 　]/g, "");
  return (MARK_WORDS as readonly string[]).includes(w) ? (w as MarkWord) : null;
};

/** 文の中の伏せ字の形（全角の括弧の形と崩れた形）の場所。重なる所は先に見つけた物（長い方）だけ */
export function markSpans(text: string): MarkSpan[] {
  const out: MarkSpan[] = [];
  const taken = (s: number, e: number) => out.some((x) => s < x.end && e > x.start);
  for (const re of [PAIRED, TOWN_LOOSE]) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      const start = m.index ?? 0;
      let span = m[0];
      // 町名の緩い形は、括弧の無い側の空きを含めない（「町名 総合」の空きは文の空き）
      let s = start;
      if (re === TOWN_LOOSE) {
        const lead = span.length - span.trimStart().length;
        s += lead;
        span = span.trim();
      }
      const e = s + span.length;
      const word = wordOf(m[1]);
      if (!word || span === "" || taken(s, e)) continue;
      out.push({ start: s, end: e, word, canonical: span === markOf(word) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 崩れた形が残っているか（全角の括弧の形は数えない） */
export function hasBrokenMark(text: string, keep?: (span: string) => boolean): boolean {
  return markSpans(text).some((s) => !s.canonical && !(keep?.(text.slice(s.start, s.end)) ?? false));
}

/** 全角の括弧の形・崩れた形のどれかが残っているか（評価の台の数え。T122） */
export function hasAnyMark(text: string): boolean {
  return markSpans(text).length > 0;
}

/**
 * 崩れた形を全角の括弧の形（（町名））にそろえる。keep が true を返す形（元の文にそのまま書いてある物）はそのまま。
 * 全角の括弧の形はもとからそのまま
 */
export function canonicalMarks(text: string, keep?: (span: string) => boolean): string {
  const spans = markSpans(text).filter((s) => !s.canonical && !(keep?.(text.slice(s.start, s.end)) ?? false));
  if (spans.length === 0) return text;
  let out = "";
  let pos = 0;
  for (const s of spans) {
    out += text.slice(pos, s.start) + markOf(s.word);
    pos = s.end;
  }
  return out + text.slice(pos);
}
