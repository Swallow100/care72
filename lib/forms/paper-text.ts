// 紙の書き方（T37）: 数字と単位・年月日の間を詰める（「84歳」「令和8年11月3日」「1日1回」「3m」）。
// 公文書の書き方。画面は今のまま（台帳と画面は「84 歳」の書き方）で、紙の部品（components/forms）が描く直前にだけ通す。
// 本人の言葉（台帳の特記）は台帳の文のまま詰めない（Piece の raw、本人の 1 枚の「本人の ことば」の段）。
// 詰めるのは数字の後ろの単位と、元号・年月日・時刻の並びだけ。「警戒レベル 3」「第 1」のような言葉 → 数字の間は詰めない。

/** 数字の後ろに付く単位（長い物から当てる）。ラテン文字の単位は後ろにラテン文字が続かないときだけ */
const UNITS = [
  "単位",
  "か月",
  "ヶ月",
  "カ月",
  "時間",
  "階建",
  "歳",
  "才",
  "年",
  "月",
  "週",
  "日",
  "時",
  "分",
  "秒",
  "回",
  "階",
  "錠",
  "本",
  "人",
  "枚",
  "頁",
  "包",
  "個",
  "度",
  "円",
  "%",
  "％",
] as const;
const LATIN_UNITS = ["mL", "ml", "mg", "kg", "km", "cm", "mm", "L", "m", "g"] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 数字 ＋ 空白 ＋ 単位 → 数字と単位をつなぐ */
const DIGIT_UNIT = new RegExp(
  `(\\d)[ \\u3000]+(?=(?:${UNITS.map(escape).join("|")})|(?:${LATIN_UNITS.join("|")})(?![A-Za-z]))`,
  "g",
);
/** 元号 ＋ 空白 ＋ 数字（元年） → つなぐ */
const ERA_DIGIT = /(令和|平成|昭和|大正|明治)[ 　]+(?=\d|元)/g;
/** 年・月・日・時・分（と「元年」）の後ろの空白 ＋ 数字 → つなぐ（「8年 11月」→「8年11月」、「1日 2回」→「1日2回」） */
const DATE_DIGIT = /((?:\d|元)(?:年|か月|ヶ月|月|週|日|時間|時|分))[ 　]+(?=\d)/g;

/** 紙の文字を公文書の書き方に（数字と単位・年月日の間を詰める） */
export function paperText(text: string): string {
  if (!/\d/.test(text)) return text;
  return text.replace(DIGIT_UNIT, "$1").replace(ERA_DIGIT, "$1").replace(DATE_DIGIT, "$1");
}

/** 1 語ずつの言葉（ふりがなの付いた語の並び）を紙の書き方に。語をまたぐ「3 」＋「日」の空白も詰める */
export function paperWords<W extends { text: string; name?: boolean }>(words: readonly W[]): W[] {
  // 人の名前の語は触らない。ほかの語をつないだ文字で詰め、語の境目の空白だけを落とす
  const out = words.map((w) => (w.name ? w : { ...w, text: paperText(w.text) }));
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i];
    if (cur.name || out[i + 1].name) continue;
    const joined = paperText(`${cur.text}${out[i + 1].text}`);
    if (/[ 　]+$/.test(cur.text) && joined.length < cur.text.length + out[i + 1].text.length) {
      out[i] = { ...cur, text: cur.text.replace(/[ 　]+$/, "") };
    }
  }
  return out;
}
