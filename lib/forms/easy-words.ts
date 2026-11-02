// やさしい日本語の言葉とふりがな（本人の 1 枚 T06 と、本人のスマホの普段の画面 T10 が使う）。
// 言葉は { text, ruby } の並びで持ち、描き方（<ruby>）は components/forms/EasyText.tsx。
//
// ふりがなの付け方:
// - 決まった文は書き方 "{逃|に}げる" で読みを書いておく（easy）
// - 台帳の値（避難先・持ち物・薬・続柄など）は読みの表 YOMI の言葉を長い物から当てる（yomi）。
//   表に無い漢字はふりがなを付けず、missing に返す（画面の上に「読み未登録」と出し、ケアマネが手で書く）。
//   地名の読みは推し量らない（谷・町などの地名の字は表に入れない）
// - 人の名前は words の name の印を付け、ふりがなを付けない（連絡先に読みの欄が無い）。本人の名前だけは people.kana から

export type Word = {
  text: string;
  /** ふりがな（ひらがな）。text が漢字を含むときだけ */
  ruby?: string;
  /** 太く大きく（避難先・119） */
  strong?: true;
  /** 人の名前（読みを推し量らない） */
  name?: true;
};

/** 漢字か（々 を含む） */
export const KANJI = /[㐀-䶿一-鿿豈-﫿々]/;

const MARKUP = /\{([^|{}]+)\|([^|{}]+)\}/g;

/** 決まった文の書き方 "{逃|に}げる ところ" を言葉の並びにする */
export function easy(markup: string, opts: { strong?: boolean } = {}): Word[] {
  const out: Word[] = [];
  const push = (w: Word) => out.push(opts.strong ? { ...w, strong: true } : w);
  let last = 0;
  for (const m of markup.matchAll(MARKUP)) {
    const at = m.index ?? 0;
    if (at > last) push({ text: markup.slice(last, at) });
    push({ text: m[1], ruby: m[2] });
    last = at + m[0].length;
  }
  if (last < markup.length) push({ text: markup.slice(last) });
  return out;
}

/**
 * 台帳の値に当てる読みの表。値が "{" を含む物は書き方（送り仮名の入る言葉）、ほかは言葉の全体の読み。
 * 種の 10 人の値と、よく出る言葉。足すときは長い言葉ほど先に当たる（並びは関係ない）
 */
export const YOMI: Readonly<Record<string, string>> = {
  // 避難先
  小学校: "しょうがっこう",
  中学校: "ちゅうがっこう",
  高校: "こうこう",
  学校: "がっこう",
  公民館: "こうみんかん",
  集会所: "しゅうかいじょ",
  体育館: "たいいくかん",
  避難所: "ひなんじょ",
  福祉避難所: "ふくしひなんじょ",
  総合病院: "そうごうびょういん",
  病院: "びょういん",
  施設: "しせつ",
  公園: "こうえん",
  高台: "たかだい",
  台: "だい",
  自宅: "じたく",
  家: "いえ",
  知人宅: "ちじんたく",
  親戚宅: "しんせきたく",
  // 行き方
  車: "くるま",
  徒歩: "とほ",
  // 続柄・間柄
  娘: "むすめ",
  息子: "むすこ",
  夫: "おっと",
  妻: "つま",
  長男: "ちょうなん",
  長女: "ちょうじょ",
  次男: "じなん",
  次女: "じじょ",
  兄: "あに",
  姉: "あね",
  弟: "おとうと",
  妹: "いもうと",
  甥: "おい",
  姪: "めい",
  孫: "まご",
  嫁: "よめ",
  隣人: "りんじん",
  友人: "ゆうじん",
  知人: "ちじん",
  親戚: "しんせき",
  家族: "かぞく",
  支援者: "しえんしゃ",
  民生委員: "みんせいいいん",
  訪問看護: "ほうもんかんご",
  介護事業所: "かいごじぎょうしょ",
  事業所: "じぎょうしょ",
  透析施設: "とうせきしせつ",
  市役所: "しやくしょ",
  薬局: "やっきょく",
  // 持ち物
  薬: "くすり",
  手帳: "てちょう",
  予備: "よび",
  吸引器: "きゅういんき",
  回路: "かいろ",
  透析: "とうせき",
  栄養剤: "えいようざい",
  注入: "ちゅうにゅう",
  道具: "どうぐ",
  保冷: "ほれい",
  血糖: "けっとう",
  測定器: "そくていき",
  杖: "つえ",
  眼鏡: "めがね",
  補聴器: "ほちょうき",
  入れ歯: "{入|い}れ{歯|ば}",
  充電器: "じゅうでんき",
  電池: "でんち",
  携帯電話: "けいたいでんわ",
  電話: "でんわ",
  保険証: "ほけんしょう",
  診察券: "しんさつけん",
  水: "みず",
  紙: "かみ",
  酸素: "さんそ",
  人工呼吸器: "じんこうこきゅうき",
  経管栄養: "けいかんえいよう",
  在宅酸素: "ざいたくさんそ",
  機械: "きかい",
  冷蔵庫: "れいぞうこ",
  // 薬の名前（台帳の言葉のまま。読みだけ付ける）
  抗認知症薬: "こうにんちしょうやく",
  抗凝固薬: "こうぎょうこやく",
  抗血小板薬: "こうけっしょうばんやく",
  抗てんかん薬: "{抗|こう}てんかん{薬|やく}",
  降圧薬: "こうあつやく",
  糖尿病: "とうにょうびょう",
  // 本人の言葉によく出る物
  階: "かい",
  箪笥: "たんす",
  玄関: "げんかん",
  台所: "だいどころ",
  寝室: "しんしつ",
  部屋: "へや",
  棚: "たな",
  引き出し: "{引|ひ}き{出|だ}し",
};

const YOMI_KEYS = Object.keys(YOMI).sort((a, b) => b.length - a.length);

/** 読みの表の 1 つを言葉に */
function entryWords(key: string, reading: string): Word[] {
  return reading.includes("{") ? easy(reading) : [{ text: key, ruby: reading }];
}

/** 隣り合う ruby の無い言葉をつなぐ */
function merge(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && !prev.ruby && !w.ruby && !prev.strong === !w.strong && !prev.name === !w.name) {
      out[out.length - 1] = { ...prev, text: prev.text + w.text };
    } else {
      out.push(w);
    }
  }
  return out;
}

/** 台帳の値にふりがなを付ける。表に無い漢字は付けずに missing へ（続く字はまとめて 1 つ） */
export function yomi(text: string): { words: Word[]; missing: string[] } {
  const words: Word[] = [];
  const missing: string[] = [];
  let unknown = "";
  const flush = () => {
    if (unknown) {
      missing.push(unknown);
      words.push({ text: unknown });
      unknown = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const key = YOMI_KEYS.find((k) => text.startsWith(k, i));
    if (key) {
      flush();
      words.push(...entryWords(key, YOMI[key]));
      i += key.length;
      continue;
    }
    const ch = text[i];
    if (KANJI.test(ch)) {
      unknown += ch;
    } else {
      flush();
      words.push({ text: ch });
    }
    i += 1;
  }
  flush();
  return { words: merge(words), missing };
}

/** カタカナをひらがなに（ふりがなは ひらがな） */
export function hiragana(kana: string): string {
  return Array.from(kana)
    .map((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c;
    })
    .join("");
}

/**
 * 本人の名前にカナからふりがなを付ける。名前とカナを空白で分け、数が同じなら漢字の入った塊ごと。
 * 数が違えば名前の全体にカナの全体。カナが無ければ付けない
 */
export function nameWithKana(name: string, kana: string | null): Word[] {
  const parts = name.trim().split(/\s+/);
  const kanaParts = (kana ?? "").trim().split(/\s+/).filter(Boolean);
  if (kanaParts.length === 0) return [{ text: name, name: true }];
  const hasKanji = (s: string) => KANJI.test(s);
  if (parts.length === kanaParts.length) {
    return parts.flatMap((p, i): Word[] => {
      const w: Word = hasKanji(p) ? { text: p, ruby: hiragana(kanaParts[i]), name: true } : { text: p, name: true };
      return i === 0 ? [w] : [{ text: " ", name: true }, w];
    });
  }
  return hasKanji(name) ? [{ text: name, ruby: hiragana(kanaParts.join("")), name: true }] : [{ text: name, name: true }];
}

/** 言葉の並びを 1 行の文字に（テスト・画面の要約用。ふりがなは落とす） */
export function plainText(words: readonly Word[]): string {
  return words.map((w) => w.text).join("");
}

/** ふりがなの無い漢字（人の名前を除く）。紙面に出す前の確かめに使う */
export function kanjiWithoutRuby(words: readonly Word[]): string[] {
  return words.filter((w) => !w.ruby && !w.name && KANJI.test(w.text)).map((w) => w.text);
}
