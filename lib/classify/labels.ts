// 録音と自由文の分類（T12）の言葉。画面（components/list/Classification.tsx）・経過の 1 行・Claude に渡す答えの文が使う。
// lib/labels.ts でなくここに置く（担当一覧の作業 T13 が同時に lib/labels.ts を触るので、重ならないように）。
// 分類は本人の状態の言い切りでなく、録音・文に出た言葉の分け方。「診断」「判定」と書かない。

import type { ClassifyError, RecordingClass } from "../db/types.ts";
import type { RedQuestion } from "../signals/phrases.ts";

/** 6 つの分類（CLAUDE.md の 5 つの言葉と、T64 の その他） */
export const CLASS_LABELS: Record<RecordingClass, string> = {
  injury: "けが",
  immobile: "動けない",
  water: "水が来た",
  device_stopped: "機器が止まった",
  other: "その他",
  unknown: "不明",
};

/** 画面の言葉 */
export const CLASSIFY_LABELS = {
  title: "分類",
  confidence: "確信",
  quote: "引用",
  edit: "修正",
  save: "保存",
  cancel: "取消",
  edited: "修正済",
  none: "分類なし",
  pending: "未分類",
  saving: "保存中",
  failed: "保存失敗",
  /** 人が直す前の Claude の分類（直したあとも小さく残す） */
  before: "修正前",
} as const;

/** 分類できなかった理由 */
export const CLASSIFY_ERROR_LABELS: Record<ClassifyError, string> = {
  no_text: "文字なし",
  not_configured: "AI 未設定",
  limit: "上限到達",
  refused: "AI 不可",
  bad_output: "形式相違",
  failed: "AI 失敗",
  leak: "送信不可",
};

/** Claude の分類から来た言葉の印。lib/triage の理由（「録音の分類（AI）: 動けない」）と同じ書き方 */
export const AI_CLASS_PREFIX = "録音の分類（AI）: ";

/** 経過の行の言葉 */
export const CLASS_LOG_LABELS = { edit: "分類修正", ai: "（AI）" } as const;

/** 確信を画面の数に（0.9 → 90%） */
export function confidenceText(c: number): string {
  return `${Math.round(Math.min(Math.max(c, 0), 1) * 100)}%`;
}

export function classesText(classes: readonly RecordingClass[]): string {
  return classes.map((c) => CLASS_LABELS[c]).join("・");
}

/** Claude の分類の経過の 1 行「録音の分類（AI）: 動けない 確信 90%「うごけない」」 */
export function aiClassLogBody(r: { classes: readonly RecordingClass[]; confidence: number; quote: string }): string {
  const quote = r.quote ? `「${r.quote}」` : "";
  return `${AI_CLASS_PREFIX}${classesText(r.classes)} ${CLASSIFY_LABELS.confidence} ${confidenceText(r.confidence)}${quote}`;
}

/** 人の直しの経過の 1 行「分類修正 動けない（AI） → けが」。前が無ければ「分類なし」 */
export function classEditLogBody(r: {
  from: readonly RecordingClass[] | null;
  fromBy: "claude" | "care_manager" | null;
  to: readonly RecordingClass[];
}): string {
  const before = r.from && r.from.length > 0 ? classesText(r.from) : CLASSIFY_LABELS.none;
  const mark = r.from && r.from.length > 0 && r.fromBy === "claude" ? CLASS_LOG_LABELS.ai : "";
  return `${CLASS_LOG_LABELS.edit} ${before}${mark} → ${classesText(r.to)}`;
}

/** Claude に渡す答えの文の問いの名前（答えていない問いは「けが 未回答」） */
export const QUESTION_NAMES: Record<RedQuestion, string> = {
  injured: "けが",
  atHome: "自宅",
  canMove: "動けるか",
  hasMedicine: "薬",
};

// ---------- 録音のまとめ（T69b） ----------

/** まとめの長さの上限（字）。Claude の文はここで切る（lib/classify/summary.ts） */
export const SUMMARY_MAX = 80;
/** ケアマネが直す文の長さの上限（字） */
export const SUMMARY_EDIT_MAX = 160;

/** 画面の言葉（ケアマネの画面の 2〜4 字） */
export const SUMMARY_LABELS = {
  title: "まとめ",
  words: "本人の言葉",
  none: "なし",
  edit: "修正",
  make: "生成",
  making: "生成中",
  save: "保存",
  saving: "保存中",
  cancel: "取消",
  edited: "修正済",
  failed: "失敗",
} as const;

/** 経過の行の言葉（ケアマネがまとめを直した） */
export const SUMMARY_LOG_LABELS = { edit: "まとめ修正" } as const;

/** ケアマネがまとめを直した経過の 1 行「まとめ修正「…」」 */
export function summaryEditLogBody(text: string): string {
  return `${SUMMARY_LOG_LABELS.edit}「${text}」`;
}
