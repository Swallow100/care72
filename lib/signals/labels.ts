// 本人・家族・支援者のスマホから来た信号を、経過の 1 行（ケアマネ・医療班が読む）にする言葉。画面の決まりの短い漢語。
// 本人の状態を言い切らない: 本人が押した答えをそのまま並べる（「本人が「動けない」」と同じ読み方）。

import type { ContactKind, WhereNow } from "../db/types.ts";
import type { FamilyAnswer, RedAnswers } from "./body.ts";
import type { RedQuestion } from "./phrases.ts";
import { RED_QUESTIONS } from "./phrases.ts";

/** 本人が押したボタンの言葉（本人の画面の言葉のまま） */
export const PRESSED_LABELS = { green: "無事", red: "無事じゃない" } as const;

export const WHERE_LABELS: Record<WhereNow, string> = { home: "自宅", shelter: "避難所", other: "その他" };

/** 赤の 4 問の答えの言葉。[はい, いいえ] */
export const ANSWER_LABELS: Record<RedQuestion, readonly [string, string]> = {
  injured: ["けが あり", "けが なし"],
  atHome: ["自宅", "自宅外"],
  canMove: ["動ける", "動けない"],
  hasMedicine: ["薬 あり", "薬 なし"],
};

export const SIGNAL_LOG_LABELS = {
  unanswered: "未回答",
  recording: "録音",
  seconds: "秒",
  transcript: "文字起こし",
  noRecording: "録音なし",
} as const;

/** 信号の経過の 1 行。緑「無事 自宅」、赤「無事じゃない けが あり・自宅・動けない・未回答 1」 */
export function signalLogBody(s: { color: "green" | "red"; whereNow: WhereNow | null; answers: RedAnswers }): string {
  if (s.color === "green") {
    return s.whereNow ? `${PRESSED_LABELS.green} ${WHERE_LABELS[s.whereNow]}` : PRESSED_LABELS.green;
  }
  const parts: string[] = [];
  let missing = 0;
  for (const q of RED_QUESTIONS) {
    const a = s.answers[q];
    if (a === null) missing++;
    else parts.push(ANSWER_LABELS[q][a ? 0 : 1]);
  }
  if (missing > 0) parts.push(`${SIGNAL_LOG_LABELS.unanswered} ${missing}`);
  return `${PRESSED_LABELS.red} ${parts.join("・")}`;
}

// ---------- 家族・支援者のスマホ（T11） ----------

/** 家族のスマホで答えられる連絡先の種類（本人の電話・機関の連絡先は答えない） */
export const SIGNAL_WRITER_KINDS = ["family", "supporter", "welfare_commissioner"] as const;
export type SignalWriterKind = Extract<ContactKind, (typeof SIGNAL_WRITER_KINDS)[number]>;

export function isSignalWriterKind(k: ContactKind): k is SignalWriterKind {
  return (SIGNAL_WRITER_KINDS as readonly string[]).includes(k);
}

/** 家族・支援者が押したボタンの言葉（ケアマネの側の短い形） */
export const FAMILY_ANSWER_LABELS: Record<FamilyAnswer, string> = {
  green: "無事",
  red: "無事じゃない",
  unknown: "分からない（連絡つかず）",
};

/** 続柄が無いときの呼び方（連絡先の種類から）。名前は使わない */
export const WRITER_KIND_LABELS: Record<SignalWriterKind, string> = {
  family: "家族",
  supporter: "支援者",
  welfare_commissioner: "民生委員",
};

/** 答えた人の呼び方: 続柄（娘・隣人）、無ければ種類（家族・支援者・民生委員）。名前は入れない */
export function writerWord(w: { kind: SignalWriterKind; relation: string | null }): string {
  return w.relation?.trim() || WRITER_KIND_LABELS[w.kind];
}

/** 家族・支援者の信号の経過の 1 行。「娘が「無事じゃない」と回答」 */
export function familyLogBody(w: { kind: SignalWriterKind; relation: string | null }, color: FamilyAnswer): string {
  return `${writerWord(w)}が「${FAMILY_ANSWER_LABELS[color]}」と回答`;
}

/** 録音の経過の 1 行「録音 31 秒 文字起こし「…」」。文字起こしは言い換えずにそのまま */
export function recordingLogBody(r: { hasAudio: boolean; durationSec: number | null; transcript: string | null }): string {
  const head = r.hasAudio
    ? r.durationSec !== null
      ? `${SIGNAL_LOG_LABELS.recording} ${r.durationSec} ${SIGNAL_LOG_LABELS.seconds}`
      : SIGNAL_LOG_LABELS.recording
    : SIGNAL_LOG_LABELS.noRecording;
  const t = r.transcript?.trim();
  return t ? `${head} ${SIGNAL_LOG_LABELS.transcript}「${t}」` : head;
}
