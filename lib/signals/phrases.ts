// 本人のスマホ（docs/tasks/T10.md）に出す決まった言葉と、定型文の声。全部ここに書いた定型で、Claude に作らせない。
// やさしい日本語: 短く、1 画面 1 つ。漢字にはふりがな（書き方は lib/forms/easy-words.ts の "{漢字|よみ}"）。
// 本人の状態の判定（至急・要確認など）は本人の画面に出さない。出すのは問いと、送れたかどうかと、119 の一般の案内だけ。

import { easy, type Word } from "../forms/easy-words.ts";
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
  queued: "まだ とどいて いません",
  queuedSub: "つながったら {送|おく}ります",
  again: "もう {一度|いちど}",
  aiListening: "AI が きいています",
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
 * 赤を押して 20 秒操作が無いときに流す定型文（docs/SPEC.md「発災時」）。声にするのはこの文だけで、名前を入れない。
 * 画面に出す文（prompt1・prompt2）と同じ言葉
 */
export const VOICE_PROMPT_TEXT = "大丈夫ですか。状況を説明してください";

/** 全部の決まった言葉（ふりがなの確かめ用） */
export function allPhoneWords(): Word[] {
  const marks = [
    ...Object.values(PHONE_PHRASES),
    ...Object.values(WHERE_PHRASES),
    ...Object.values(RED_QUESTION_PHRASES).flatMap((p) => [p.q, p.yes, p.no]),
  ];
  return [...marks.flatMap((m) => easy(m)), ...emergencyWords()];
}
