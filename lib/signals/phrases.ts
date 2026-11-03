// 本人のスマホ（docs/tasks/T10.md）と家族・支援者のスマホ（T11）に出す決まった言葉と、定型文の声。全部ここに書いた定型で、Claude に作らせない。
// やさしい日本語: 短く、1 画面 1 つ。漢字にはふりがな（書き方は lib/forms/easy-words.ts の "{漢字|よみ}"）。
// 本人の状態の判定（至急・要確認など）は本人の画面に出さない。出すのは問いと、送れたかどうかと、119 の一般の案内だけ。

import { easy, plainText, type Word } from "../forms/easy-words.ts";
import { OWN_PHRASES } from "../forms/own-sheet.ts";
import type { WhereNow } from "../db/types.ts";

/** 赤の 4 問（1 画面 1 問の順）。答えは信号の表の injured・at_home・can_move・has_medicine */
export const RED_QUESTIONS = ["injured", "atHome", "canMove", "hasMedicine"] as const;
export type RedQuestion = (typeof RED_QUESTIONS)[number];

export const PHONE_PHRASES = {
  safe: "{無事|ぶじ}",
  notSafe: "{無事|ぶじ}じゃない",
  where: "どこに いますか",
  sending: "{送|おく}っています",
  sent: "とどきました",
  /** 聞き直しても無音のまま、録音だけ送ったとき（T37。docs/DECISIONS.md 11/3 04:0x の 9） */
  recordingSent: "ろくおんを おくりました",
  queued: "まだ とどいて いません",
  queuedSub: "つながったら {送|おく}ります",
  again: "もう {一度|いちど}",
  /** AI の印（「AI」）のあとに続ける。録っている間は「AI が きいています」と出す（docs/DECISIONS.md 運営の返事） */
  aiListening: "が きいています",
  prompt1: "{大丈夫|だいじょうぶ}ですか",
  prompt2: "{状況|じょうきょう}を {説明|せつめい}して ください",
  left: "あと",
  seconds: "{秒|びょう}",
  more: "もっと {話|はな}す",
  send: "{送|おく}る",
} as const;

export const WHERE_PHRASES: Record<WhereNow, string> = {
  home: "{家|いえ}",
  shelter: "{避難所|ひなんじょ}",
  other: "ほかの ところ",
};

/** 赤の問いと、2 つの答え（先が「はい」の側） */
export const RED_QUESTION_PHRASES: Record<RedQuestion, { q: string; yes: string; no: string }> = {
  injured: { q: "けがは ありますか", yes: "ある", no: "ない" },
  atHome: { q: "いまは {家|いえ}ですか", yes: "はい", no: "いいえ" },
  canMove: { q: "{動|うご}けますか", yes: "{動|うご}ける", no: "{動|うご}けない" },
  hasMedicine: { q: "くすりは ありますか", yes: "ある", no: "ない" },
};

/** 赤の流れの最後の 1 行。本人の 1 枚（T06）と同じ言葉（一般の案内。本人の状態の判定ではない） */
export function emergencyWords(): Word[] {
  return [...easy(OWN_PHRASES.emergencyLead), { text: " " }, { text: OWN_PHRASES.emergencyNumber, strong: true }];
}

/**
 * AI の告知（T48、アドバイザーの返事）。一般の人が使う仕組みは AI であることを伝える決まりで、画面を見られない人がいるので声でも出す。
 * 本人のスマホの赤の流れの最初（1 問目）と定型文の画面に文字で、定型文の声の頭に声で。文はここの 1 か所だけで、AI の印（「AI」）を挟んで前後に分けて持つ
 */
export const AI_NOTICE = {
  lead: "これは",
  rest: "（{人|ひと}では ない しくみ）が {聞|き}いています。こたえは ケアマネジャーに とどきます",
} as const;

/** 告知の文字（書き方。ふりがなつき） */
export const AI_NOTICE_TEXT = `${AI_NOTICE.lead} AI${AI_NOTICE.rest}`;

/** 告知の声の文（ふりがなと空白を落とし、かっこを読点に）。「これはAI、人ではないしくみが聞いています。こたえはケアマネジャーにとどきます」 */
export const AI_NOTICE_VOICE = plainText(easy(AI_NOTICE_TEXT)).replace(/ /g, "").replace("（", "、").replace("）", "");

/**
 * 赤を押して 20 秒操作が無いときに流す定型文（docs/SPEC.md「発災時」）。声にするのはこの文だけで、名前を入れない。
 * 頭に AI の告知（T48）、続けて画面に出す文（prompt1・prompt2）と同じ言葉
 */
export const VOICE_PROMPT_TEXT = `${AI_NOTICE_VOICE}。大丈夫ですか。状況を説明してください`;

// ---------- 家族・支援者のスマホ（docs/tasks/T11.md） ----------

/** 家族・支援者の画面の決まった言葉。本人の画面と同じく、判定・助言の言葉は無い */
export const FAMILY_PHRASES = {
  isSafe: "は {無事|ぶじ}ですか",
  san: "さん",
  safe: "{無事|ぶじ}です",
  notSafe: "{無事|ぶじ}じゃない",
  unknown: "{分|わ}からない",
  unknownSub: "{連絡|れんらく}が つかない",
  restart: "{最初|さいしょ}から",
  history: "これまでの こと",
  callCm: "ケアマネジャーに {電話|でんわ}",
  you: "あなた",
  answered: "と こたえました",
} as const;

/** 家族の答えの言葉（経過の行の「」の中） */
export const FAMILY_ANSWER_PHRASES = {
  green: "{無事|ぶじ}",
  red: "{無事|ぶじ}じゃない",
  unknown: "{分|わ}からない",
} as const;

/** 本人の呼び方（連絡先の続柄から見た本人）。性別で分ける。表に無い続柄・隣人は名前で呼ぶ */
const PARENT = { female: "お{母|かあ}さん", male: "お{父|とう}さん" };
const GRANDPARENT = { female: "おばあさん", male: "おじいさん" };
const OLDER_SIBLING = { female: "お{姉|ねえ}さん", male: "お{兄|にい}さん" };
const AUNT_UNCLE = { female: "おばさん", male: "おじさん" };

export const RELATION_CALLS: Readonly<Record<string, { female: string; male: string }>> = {
  娘: PARENT,
  息子: PARENT,
  長男: PARENT,
  長女: PARENT,
  次男: PARENT,
  次女: PARENT,
  三男: PARENT,
  三女: PARENT,
  孫: GRANDPARENT,
  弟: OLDER_SIBLING,
  妹: OLDER_SIBLING,
  甥: AUNT_UNCLE,
  姪: AUNT_UNCLE,
};

/** 続柄と本人の性別から呼び方（書き方）。決まらなければ null（名前で呼ぶ） */
export function relationCall(relation: string | null, sex: "female" | "male" | "other" | undefined): string | null {
  const r = relation?.trim();
  if (!r || (sex !== "female" && sex !== "male")) return null;
  return RELATION_CALLS[r]?.[sex] ?? null;
}

/** 経過の行の決まった言葉（kind ごと）。actor は「ケアマネジャー」などの書き方 */
export const FAMILY_HISTORY_PHRASES = {
  called: "{電話|でんわ}しました",
  calledNoActor: "{電話|でんわ}が ありました",
  pickup: "{迎|むか}えが {決|き}まりました",
  safetyCheck: "{無事|ぶじ}を たしかめました",
  examined: "みました",
  medicationGiven: "{薬|くすり}を わたしました",
  transported: "{病院|びょういん}へ {運|はこ}びました",
  arrivedShelter: "{避難所|ひなんじょ}に {着|つ}きました",
  received: "{避難所|ひなんじょ}で {受|う}け{付|つ}けました",
  recording: "{録音|ろくおん}が とどきました",
} as const;

/** 経過の行で、書いた人の役の呼び方 */
export const FAMILY_ACTOR_PHRASES = {
  care_manager: "ケアマネジャー",
  medical: "{医療班|いりょうはん}",
  government: "{市役所|しやくしょ}",
  family: "{家族|かぞく}",
  supporter: "{支援者|しえんしゃ}",
  welfare_commissioner: "{民生委員|みんせいいいん}",
} as const;

/** 家族の画面の全部の決まった言葉（ふりがなの確かめ用） */
export function allFamilyWords(): Word[] {
  const marks = [
    ...Object.values(FAMILY_PHRASES),
    ...Object.values(FAMILY_ANSWER_PHRASES),
    ...Object.values(RELATION_CALLS).flatMap((c) => [c.female, c.male]),
    ...Object.values(FAMILY_HISTORY_PHRASES),
    ...Object.values(FAMILY_ACTOR_PHRASES),
    PHONE_PHRASES.sending,
    PHONE_PHRASES.sent,
    PHONE_PHRASES.queued,
    PHONE_PHRASES.queuedSub,
  ];
  return [...marks.flatMap((m) => easy(m)), ...emergencyWords()];
}

/** 全部の決まった言葉（ふりがなの確かめ用） */
export function allPhoneWords(): Word[] {
  const marks = [
    ...Object.values(PHONE_PHRASES),
    ...Object.values(WHERE_PHRASES),
    ...Object.values(RED_QUESTION_PHRASES).flatMap((p) => [p.q, p.yes, p.no]),
    AI_NOTICE_TEXT,
  ];
  return [...marks.flatMap((m) => easy(m)), ...emergencyWords()];
}
