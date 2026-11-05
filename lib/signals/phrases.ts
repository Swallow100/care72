// 本人のスマホ（docs/tasks/T10.md）と家族・支援者のスマホ（T11）に出す決まった言葉と、定型文の声。全部ここに書いた定型で、Claude に作らせない。
// やさしい日本語: 短く、1 画面 1 つ。漢字にはふりがな（書き方は lib/forms/easy-words.ts の "{漢字|よみ}"）。
// 本人の状態の判定（至急・要確認など）は本人の画面に出さない。出すのは問いと、送れたかどうかと、119 の一般の案内だけ。

import { easy, plainText, type Word } from "../forms/easy-words.ts";
import { emergencyWords } from "../forms/own-sheet.ts";
import type { WhereNow } from "../db/types.ts";
import { allQuestionMarkups } from "./questions.ts";

/** 赤の 4 問（1 画面 1 問の順）。答えは信号の表の injured・at_home・can_move・has_medicine */
export const RED_QUESTIONS = ["injured", "atHome", "canMove", "hasMedicine"] as const;
export type RedQuestion = (typeof RED_QUESTIONS)[number];

export const PHONE_PHRASES = {
  safe: "{無事|ぶじ}",
  notSafe: "{無事|ぶじ}じゃない",
  where: "どこに いますか",
  sending: "{送|おく}っています",
  sent: "とどきました",
  /** 聞き直しても無音のまま、録音だけ送ったとき（T37） */
  recordingSent: "ろくおんを おくりました",
  queued: "まだ とどいて いません",
  queuedSub: "つながったら {送|おく}ります",
  /** 送り終わりのボタン（上へ戻る）。家族の画面も同じ言葉（T80。前は本人「もう 一度」・家族「最初から」） */
  again: "{最初|さいしょ}から",
  /** AI の印（「AI」）のあとに続ける。録っている間は「AI が きいています」と出す（AI であることを示す。docs/DECISIONS.md「AI の使い所」） */
  aiListening: "が きいています",
  prompt1: "{大丈夫|だいじょうぶ}ですか",
  prompt2: "{状況|じょうきょう}を {説明|せつめい}して ください",
  left: "あと",
  seconds: "{秒|びょう}",
  more: "もっと {話|はな}す",
  send: "{送|おく}る",
  /** 聞き取りの問いをとばす（T49。どの問いにも置く） */
  skip: "とばす",
  /** 車・ほかの ところ を押したあと、本人の画面だけ（T69b）。はい なら端末の位置を 1 回だけ送る */
  sendPlace: "いまの {場所|ばしょ}を おくりますか",
  yes: "はい",
  no: "いいえ",
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

/** 赤の流れの 119 の 1 行。本人の 1 枚（T06）と同じ言葉（lib/forms/own-sheet.ts の emergencyWords。一般の案内。本人の状態の判定ではない） */
export { emergencyWords };

/**
 * AI の告知（T48）。一般の人が使う仕組みは AI であることを伝える決まり（Anthropic の利用ポリシー）で、画面を見られない人がいるので声でも出す。
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

// ---------- 声の聞き取りの会話（docs/tasks/T137.md） ----------

/**
 * 会話の決まった文（AI に作らせない）。最初の問いは上の定型文（VOICE_PROMPT_TEXT）、話題ごとの決まった問いは
 * lib/signals/questions.ts の問いの表（lib/signals/talk.ts の TALK_TOPIC_SPECS）。ここは締め・危ない言葉のとき・ボタンの答え方の文。
 * 119 の文は本人の 1 枚と画面の 1 行と同じ（EMERGENCY_TEXT）。どの締めにも付けるので、危ない言葉のときだけ出す文にはしない
 */
export const TALK_PHRASES = {
  /** 締めの頭（どの締めも） */
  thanks: "ありがとうございました。ケアマネジャーに とどけます",
  /** 上限に近づいて締めるとき（10 往復・5 分ほど） */
  later: "また あとで ききます",
  /** 命に関わる言葉が出たとき（119 の文のあと） */
  notify: "すぐ ケアマネジャーに しらせます",
  /** ボタンの答え方に替えたとき、問いのあとに読む */
  yesNoHint: "はいなら みどり、いいえなら あかを おして ください",
  /** 話題「連絡してほしい人」の決まった問い（問いの表に無い話題） */
  callee: "{連絡|れんらく}して ほしい {人|ひと}は いますか",
  // 1 段深く聞く問い（T137b。lib/signals/talk.ts の TALK_ITEMS。問いの表に無い物だけここに。はい・いいえで答えられる形）
  /** けが ある → けがした所を動かせるか */
  injuryMove: "けがした ところは {動|うご}かせますか",
  /** 動けない → 何かに挟まれているか */
  pinned: "{何|なに}かに はさまれて いますか",
  /** 動けない・ひとり → 近くの人を呼べるか */
  callHelp: "{近|ちか}くの {人|ひと}を よべますか",
  /** 機器 → 電池の残り */
  battery: "{電池|でんち}は のこって いますか",
  /** 機器が止まった → 予備 */
  spare: "{予備|よび}の {電池|でんち}や ボンベは ありますか",
  /** 薬 ある → 3 日分あるか */
  medDays: "くすりは みっかぶん ありますか",
  /** 連絡してほしい人 → 家族か */
  calleeFamily: "{家族|かぞく}に {連絡|れんらく}して ほしいですか",
  /** 次の 1 文を待つ間の相づち（T137b）。本人が話したあと */
  fillerHeard: "わかりました",
  /** 次の 1 文を待つ間の相づち（T137b）。聞き取れなかったあと */
  fillerWait: "しょうしょう おまちください",
} as const;

// ---------- 家族・支援者のスマホ（docs/tasks/T11.md） ----------

/** 家族・支援者の画面の決まった言葉。本人の画面と同じく、判定・助言の言葉は無い */
export const FAMILY_PHRASES = {
  isSafe: "は {無事|ぶじ}ですか",
  san: "さん",
  safe: "{無事|ぶじ}です",
  notSafe: "{無事|ぶじ}じゃない",
  unknown: "{分|わ}からない",
  unknownSub: "{連絡|れんらく}が つかない",
  /** 送り終わりのボタン。本人の画面と同じ定型（T80） */
  restart: PHONE_PHRASES.again,
  history: "これまでの こと",
  callCm: "ケアマネジャーに {電話|でんわ}",
  you: "あなた",
  answered: "と こたえました",
  /** 問いの主語「お母さんは」の「は」（T49） */
  wa: "は",
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
    PHONE_PHRASES.skip,
    ...allQuestionMarkups(),
  ];
  return [...marks.flatMap((m) => easy(m)), ...emergencyWords()];
}

/** 全部の決まった言葉（ふりがなの確かめ用） */
export function allPhoneWords(): Word[] {
  const marks = [
    ...Object.values(PHONE_PHRASES),
    ...Object.values(WHERE_PHRASES),
    ...Object.values(RED_QUESTION_PHRASES).flatMap((p) => [p.q, p.yes, p.no]),
    ...allQuestionMarkups(),
    ...Object.values(TALK_PHRASES),
    AI_NOTICE_TEXT,
  ];
  return [...marks.flatMap((m) => easy(m)), ...emergencyWords()];
}
