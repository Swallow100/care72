// 本人・家族・支援者のスマホから来た信号を、経過の 1 行（ケアマネ・医療班が読む）にする言葉。画面の決まりの短い漢語。
// 本人の状態を言い切らない: 本人が押した答えをそのまま並べる（「本人が「動けない」」と同じ読み方）。

import type { ContactKind, WhereNow } from "../db/types.ts";
import { HEARING_FIELD_LABELS, HEARING_LABELS } from "../labels.ts";
import type { HearingField } from "./questions.ts";
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

/** ケアマネが聞き取りの欄を直した経過の 1 行「聞き取り修正 体の訴え「胸が少し痛い」」。空にしたら「空欄」（T49） */
export function memoEditLogBody(field: HearingField, text: string | null): string {
  return `${HEARING_LABELS.title}${HEARING_LABELS.edit} ${HEARING_FIELD_LABELS[field]}${text ? `「${text}」` : ` ${HEARING_LABELS.clear}`}`;
}

// ---------- 場所（T69b） ----------

/** ケアマネの画面の場所の言葉（聞き取りの欄の位置・地図のピン） */
export const PLACE_LABELS = {
  /** 本人が送った端末の位置 */
  position: "位置",
  has: "あり",
  /** 地図のピンの title（台帳の位置でなく本人が送った位置に置いたとき） */
  reported: "申告位置",
} as const;

/** 「位置 あり（±50 m）」。精度が無ければ「位置 あり」 */
export function positionText(accuracyM: number | null): string {
  const head = `${PLACE_LABELS.position} ${PLACE_LABELS.has}`;
  return accuracyM === null || !Number.isFinite(accuracyM) ? head : `${head}（±${Math.round(accuracyM)} m）`;
}

/** 座標の文字（地図の全画面へのリンクが無いので、座標をそのまま出す）。小数 5 桁（約 1 m） */
export function coordText(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

// ---------- 声の聞き取りの会話（T137）: ケアマネの画面の言葉 ----------

/** 会話の欄の言葉（2〜4 字）。応答不明瞭はコードが付けた印（無音・うめき声・短すぎるが続いた）で、色と順には使わない */
export const TALK_LABELS = {
  title: "会話",
  ask: "問",
  reply: "答",
  unclear: "応答不明瞭",
  silent: "無音",
  mumble: "不明瞭",
  pressed: "押下",
  noPress: "未押下",
  skipped: "とばし",
  got: "取得",
  end: "終了",
  danger: "危険語",
  aiCalls: "AI 呼出",
  closing: "締め",
} as const;

/** 終わり方の言葉 */
export const TALK_END_LABELS = {
  grasped: "把握",
  wants_end: "本人終了",
  send: "送信",
  unclear: "ボタン回答",
  cap: "上限",
  danger: "危険語",
} as const;

/** 命に関わる言葉の種類の言葉 */
export const DANGER_LABELS = {
  fire: "火・煙",
  water: "水",
  breath: "息",
  trapped: "挟まれ",
  bleeding: "出血",
} as const;
