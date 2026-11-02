// 本人のスマホから来た信号を、経過の 1 行（ケアマネ・医療班が読む）にする言葉。画面の決まりの短い漢語。
// 本人の状態を言い切らない: 本人が押した答えをそのまま並べる（「本人が「動けない」」と同じ読み方）。

import type { WhereNow } from "../db/types.ts";
import type { RedAnswers } from "./body.ts";
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
