// 分類（T12）で Claude（Haiku）に渡す指示と、返事の形。指示はコードの定数だけで、氏名・住所・電話・本人の値を入れない。
// どの用途にも先に付く指示（lib/claude/call.ts の COMMON_SYSTEM: 仮名・診断しない・下書き）のあとに足される。

import * as z from "zod";
import { RECORDING_CLASSES } from "../db/types.ts";

/** これ未満の確信は「不明」（指示にも書き、返ったあとにコードでも強制する） */
export const CONFIDENCE_MIN = 0.6;

/** 引用の長さの上限（字） */
export const QUOTE_MAX = 10;

export const CLASSIFY_SYSTEM = [
  "本人のスマホの録音の文字起こし（または本人・家族が書いた短い文）を読み、下の 5 つに分ける。分けるだけ。",
  "助言・指示・手当ての方法・診断・本人の状態の言い切りは書かない。返すのは categories・confidence・quote の 3 つだけ。",
  "入力は JSON。「文字起こし」が分ける文、「答えと音」は本人が押したボタンの答えと録音の長さ。",
  "",
  "categories の値:",
  "- injury（けが）: 痛い・血が出た・転んだ・ぶつけた・切った など、けがをしたと言っている",
  "- immobile（動けない）: 立てない・歩けない・起き上がれない・挟まれた・閉じ込められた・出られない",
  "- water（水が来た）: 水が入ってきた・床まで水・水が上がってくる",
  "- device_stopped（機器が止まった）: 酸素・吸引・人工呼吸器・電動ベッドなどの機械が止まった・電池が切れる・電気が来ず機械が動かない",
  "- unknown（不明）: 上のどれとも言えない・うめき声だけ・黙っている・聞き取れない・関係のない話",
  "",
  "決まり:",
  "1. 文字起こしに書かれた言葉だけで分ける。推し量らない。",
  "2. 当てはまる物を全部選ぶ（けがと動けないの両方など）。unknown はほかと一緒に選ばない。",
  `3. confidence は 0 から 1 の数。言葉がはっきりしていれば高く、短い・途切れた・どちらとも取れるときは低く。${CONFIDENCE_MIN} 未満なら categories は unknown だけ。`,
  `4. quote は分けた手がかりの言葉を、文字起こしから ${QUOTE_MAX} 字まで、そのまま写す。言い換えない・つなげない。手がかりが無ければ空文字。`,
  "5. 答えと音は文字起こしを読む助けにだけ使う。文字起こしに手がかりの無い分類は選ばない。",
  "6. 伏せ字（（氏名）（町名）（電話））と役割名（娘・支援者 1 など）はそのまま。「A さん」は本人。",
].join("\n");

/**
 * 返事の形。enum・数の範囲は SDK が JSON Schema の説明文に回し、文法では縛らない（lib/claude の T00 の記録）。
 * 範囲の外の確信や長い引用で呼び出し全体を失わないように、zod では型だけを確かめ、範囲は classify.ts で直す。
 * 分類の値が 5 つの外なら形の違い（AiBadOutput）で、分類なし（形式相違）になる。
 */
export const ClassifySchema = z.object({
  categories: z.array(z.enum(RECORDING_CLASSES)),
  confidence: z.number(),
  quote: z.string(),
});

export type ClassifyAnswer = z.output<typeof ClassifySchema>;
