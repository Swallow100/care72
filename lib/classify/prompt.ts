// 分類（T12）で Claude（Haiku）に渡す指示と、返事の形。指示はコードの定数だけで、氏名・住所・電話・本人の値を入れない。
// どの用途にも先に付く指示（lib/claude/call.ts の COMMON_SYSTEM: 仮名・診断しない・下書き）のあとに足される。

import * as z from "zod";
import { RECORDING_CLASSES } from "../db/types.ts";
import { HEARING_FIELDS } from "../signals/questions.ts";

/** これ未満の確信は「不明」（指示にも書き、返ったあとにコードでも強制する） */
export const CONFIDENCE_MIN = 0.6;

/** 引用の長さの上限（字） */
export const QUOTE_MAX = 10;

/** 聞き取りメモの 1 欄の長さの上限（字。T49） */
export const MEMO_MAX = 30;

export const CLASSIFY_SYSTEM = [
  "本人のスマホの録音の文字起こし（または本人・家族が書いた短い文）を読み、下の 6 つに分け、聞き取りメモの欄に本人の言葉を写す。分けると写すだけ。",
  "助言・指示・手当ての方法・診断・本人の状態の言い切りは書かない。返すのは categories・confidence・quote・memo の 4 つだけ。",
  "入力は JSON。「文字起こし」が分ける文、「答えと音」は本人が押したボタンの答えと録音の長さ。",
  "",
  "categories の値:",
  "- injury（けが）: 痛い・血が出た・転んだ・ぶつけた・切った など、けがをしたと言っている",
  "- immobile（動けない）: 立てない・歩けない・起き上がれない・挟まれた・閉じ込められた・出られない",
  "- water（水が来た）: 水が入ってきた・床まで水・水が上がってくる",
  "- device_stopped（機器が止まった）: 酸素・吸引・人工呼吸器・電動ベッドなどの機械が止まった・電池が切れる・電気が来ず機械が動かない",
  "- other（その他）: はっきり言っているが上の 4 つのどれでもない（食べ物・水が無い、家族と連絡が取れない、不安、頼みごと など）",
  "- unknown（不明）: うめき声だけ・黙っている・聞き取れない・途切れて何のことか分からない・困りごとと関係のない話",
  "",
  "決まり:",
  "1. 文字起こしに書かれた言葉だけで分ける。推し量らない。",
  "2. 当てはまる物を全部選ぶ（けがと動けないの両方、けがとその他など）。unknown はほかと一緒に選ばない。",
  `3. confidence は 0 から 1 の数。言葉がはっきりしていれば高く、短い・途切れた・どちらとも取れるときは低く。${CONFIDENCE_MIN} 未満なら categories は unknown だけ。`,
  `4. quote は分けた手がかりの言葉を、文字起こしから ${QUOTE_MAX} 字まで、そのまま写す。言い換えない・つなげない。手がかりが無ければ空文字。`,
  "5. 答えと音は文字起こしを読む助けにだけ使う。文字起こしに手がかりの無い分類は選ばない。",
  "6. 伏せ字（（氏名）（町名）（電話））と役割名（娘・支援者 1 など）はそのまま。「A さん」は本人。",
  "",
  `memo（聞き取りメモ）の欄。どの欄も、文字起こしの言葉をそのまま写した ${MEMO_MAX} 字までの文か null:`,
  "- place: いる場所（家のどこ・何階・外・避難所の名前など）",
  "- trapped: 閉じ込め・挟まれ（何に。ドア・家具・倒れた物・水など）",
  "- body: 体の訴え（本人の言葉のまま。「胸が少し痛い」など）",
  "- injury: けがの部位（「足を打った」など）",
  "- water: 水（どこまで来ているか）",
  "- fireGas: 火・ガス・におい・煙",
  "- device: 機器（酸素・吸引・人工呼吸器などが動いているか）",
  "- medicine: 薬（手元にあるか）",
  "- nearby: そばにいる人",
  "- contact: 連絡の手段",
  "- request: 本人が頼んだこと",
  "",
  "memo の決まり:",
  "7. 文字起こしの言葉を、続いた 1 か所からそのまま写す。言い換えない・要約しない・つなげない・言葉を足さない。",
  "8. 文字起こしに無い欄は null。推し量らない。答えと音から欄を埋めない。",
  "9. 重さ・どのくらい危ないか・急ぐかどうか・病名は書かない。欄は事実の言葉の写しだけ。",
].join("\n");

/**
 * 返事の形。enum・数の範囲は SDK が JSON Schema の説明文に回し、文法では縛らない（lib/claude の T00 の記録）。
 * 範囲の外の確信や長い引用で呼び出し全体を失わないように、zod では型だけを確かめ、範囲は classify.ts で直す。
 * 分類の値が 6 つの外なら形の違い（AiBadOutput）で、分類なし（形式相違）になる。
 */
export const MemoSchema = z.object(
  Object.fromEntries(HEARING_FIELDS.map((f) => [f, z.string().nullable()])) as Record<
    (typeof HEARING_FIELDS)[number],
    z.ZodNullable<z.ZodString>
  >,
);

/**
 * memo（聞き取りメモ、T49）は無くても形の違いにしない（memo の無い返事でも分類は失わない。無ければメモなし）
 */
export const ClassifySchema = z.object({
  categories: z.array(z.enum(RECORDING_CLASSES)),
  confidence: z.number(),
  quote: z.string(),
  memo: MemoSchema.optional(),
});

export type ClassifyAnswer = z.output<typeof ClassifySchema>;
