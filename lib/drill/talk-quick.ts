// 通話の往復の短い返事（docs/tasks/T167.md の 1）。相づち・待って・聞こえますか・何でしたっけ・話と関係ない問い・また後で電話します、
// 同じ通話でもう答えた問いは、Haiku を呼ばずにコードの短い返事にする。評価の 8 回目で、1 回の訓練の呼び出しの半分（137 回のうち 72 回）が 8 往復の通話の
// 本人役で、往復の 4 割ほどは本人役の指示でも「1 文だけで短く返す」言葉だった。
//
// - 初めて聞く問いと、中身のある文（機械の音・毛布・いる所の確かめ）は今までどおり本人役が答える（会話の中身は AI のまま）
// - 返事に AI の印を付けない（コードの固定の言葉。talkRound が ai: false で残す）。頼み事は積まない。色・4 問・聞いた安否は変えない
// - 名前・場所・体の具合・曜日の言い切りを書かない。D1 も Claude も使わない

import { TALK_ASK_WORDS, type TalkAsk, type TalkLine } from "./dialogue.ts";

export const QUICK_KINDS = ["ack", "wait", "hear", "again", "offtopic", "later", "stay", "repeat"] as const;
export type QuickKind = (typeof QUICK_KINDS)[number];

/** 返事の候補（同じ通話でまだ言っていない物から。訳は上の注） */
export const QUICK_REPLIES: Readonly<Record<QuickKind, ReadonlyArray<string>>> = {
  ack: ["はい。", "ええ。", "はい、どうぞ。"],
  // 「大丈夫」と言わない（T174。評価の 9 回目で、機器が止まったままの人の短い返事が落ち着いた言い方に数えられた。門を通らない文）
  wait: ["はい、待っています。", "はい、待ちます。", "分かりました。待ちます。"],
  hear: ["はい、聞こえています。", "はい、聞こえます。", "少し遠いですが、聞こえます。"],
  again: ["今の様子をお話ししていました。", "さっきのお話の続きです。"],
  offtopic: ["すみません、今はよく分かりません。", "すみません、それはちょっと。", "ごめんなさい、今は分かりません。"],
  later: ["はい、お願いします。", "分かりました。お願いします。", "はい、お電話を待っています。"],
  stay: ["はい、待っています。", "分かりました。連絡を待ちます。"],
  // 「はい」で始めない（同じ問いが「無事ですか」「大丈夫ですか」のとき、前の答えと関係なく無事・大丈夫と読める）
  repeat: ["さっきお話しした通りです。", "先ほどと同じです。", "先ほどのままです。"],
};

/** 文の頭と間の言いよどみ・呼び掛け（消した残りで言葉の中身を見る） */
const FILLERS = /(?:えっと|えーと|ええと|あのう?|あー+|うう+|うーん|んー+|もしもし|えー+|ああ|あっ|はい|ええ|うん|そうですか|なるほど)/gu;
const MARKS = /[\s、。，．,.！？!?…・「」]+/gu;
const PLAIN_ACK = /^(?:分かりました|わかりました|了解(?:です|しました)?|承知しました|ありがとう(?:ございます|ございました)?|お願いします|そうなんですね)*$/u;
const WAIT = /^(?:ちょっと|少し|少々)?(?:待って|お待ち)(?:ください|下さい|くださいね)?$/u;
const HEAR = /^聞こえ(?:ます|ています|てます)か(?:電波が悪いみたいで|電波が悪いようで)?$/u;
const AGAIN = /^(?:それで)?(?:何|なん)(?:でしたっけ|の話でしたっけ|の話でしたか)$|^もう一度(?:お願いします|言ってください)?$/u;
const OFFTOPIC = /^(?:今日は)?(?:何曜日|何日|何月何日)(?:でしたっけ|ですか)$/u;
const LATER = /^(?:あとで|後で)?(?:また)?(?:あとで|後で)?(?:電話|連絡)(?:します|しますね|しますので)$/u;

/** 同じ問いと見る自由の文の形（決まった問いのボタンと同じ問いを文で聞いた時）。短い文の形だけ */
const SAME_ASK: ReadonlyArray<[TalkAsk, RegExp]> = [
  ["where", /^今どこ(?:に)?(?:いますか|ですか)$/u],
  ["injured", /^(?:お)?けが(?:は)?(?:ありませんか|ないですか)$/u],
  ["device_medicine", /^(?:お)?薬(?:は)?(?:足りていますか|ありますか|大丈夫ですか)$/u],
  ["safe", /^(?:ご本人は)?無事ですか$/u],
  ["can_move", /^(?:ご本人は)?動けますか$/u],
];

const core = (text: string): string => text.normalize("NFKC").replace(MARKS, "").replace(FILLERS, "").replace(MARKS, "");

/** ケアマネの行の問いの種類（同じ問いの見分け）。決まった問いか、同じ問いの短い文か。無ければ null */
function askOf(l: { ask?: TalkAsk | undefined; text?: string | undefined }): TalkAsk | null {
  if (l.ask) return l.ask;
  const c = core(l.text ?? "");
  for (const [ask, re] of SAME_ASK) if (re.test(c)) return ask;
  for (const [ask, words] of Object.entries(TALK_ASK_WORDS) as Array<[TalkAsk, string]>) if (core(words) === c) return ask;
  return null;
}

type Line = Pick<TalkLine, "who" | "text"> & Partial<Pick<TalkLine, "ask" | "ai">>;

/** その問いに電話に出た人（AI）が答えたか（固定の言葉のままなら、もう一度本人役に聞く） */
function answered(lines: ReadonlyArray<Line>, ask: TalkAsk): boolean {
  return lines.some((l, i) => l.who === "cm" && askOf(l) === ask && lines[i + 1]?.who === "them" && lines[i + 1]?.ai === true);
}

/**
 * 今のケアマネの言葉をコードで返せるか（返せる種類、無ければ null）。lines はこの通話のそれまでの行。
 * 中身のある文（言いよどみを消した残りが上のどの形でもない文）は null で、本人役が答える
 */
export function quickKindOf(t: { ask?: TalkAsk; said: string }, lines: ReadonlyArray<Line>): QuickKind | null {
  if (t.ask === "will_call_back") return "later";
  if (t.ask === "stay") return "stay";
  if (!t.ask) {
    const c = core(t.said);
    if (PLAIN_ACK.test(c)) return "ack";
    if (WAIT.test(c)) return "wait";
    if (HEAR.test(c)) return "hear";
    if (AGAIN.test(c)) return "again";
    if (OFFTOPIC.test(c)) return "offtopic";
    if (LATER.test(c)) return "later";
  }
  const ask = askOf({ ...(t.ask ? { ask: t.ask } : {}), text: t.said });
  return ask && answered(lines, ask) ? "repeat" : null;
}

/** 返事の文。同じ通話でまだ言っていない物から。頭は seed（通話の時刻）で回し、人ごと・通話ごとに同じ返事に偏らない */
export function quickReply(kind: QuickKind, lines: ReadonlyArray<Line>, seed = 0): string {
  const pool = QUICK_REPLIES[kind];
  const said = new Set(lines.filter((l) => l.who === "them").map((l) => l.text));
  const start = Math.abs(Math.trunc(seed)) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const x = pool[(start + i) % pool.length];
    if (!said.has(x)) return x;
  }
  return pool[start];
}

/** 通話を切る合図の言葉か（また後で電話します・待機の指示）。評価の台の通話の回し方が読む（言ったあとに話し続けない） */
export function closesCall(t: { ask?: string; text?: string }): boolean {
  if (t.ask) return t.ask === "will_call_back" || t.ask === "stay";
  return LATER.test(core(t.text ?? ""));
}
