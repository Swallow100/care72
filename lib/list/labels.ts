// 担当一覧の発災時（T13）の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。
// 色の言葉（至急・要確認・不明・無事）は lib/labels.ts の COLOR_LABELS、連絡先の種類は CONTACT_KIND_LABELS。

import type { RecordingClass } from "../db/types.ts";

/** 列の見出し */
export const COLUMN_LABELS = {
  state: "状態",
  tier: "優先",
  kana: "氏名",
  remain: "残り",
  contact: "最終連絡",
  age: "年齢・介護度",
  medical: "医療",
  hazard: "ハザード",
  supporter: "支援者",
  plan: "計画",
} as const;

/** 行の詳細の見出しと小さな言葉 */
export const DETAIL_LABELS = {
  reason: "理由",
  contacts: "連絡先",
  clocks: "残り時間",
  destinations: "避難先",
  transport: "手段",
  supporters: "支援者",
  lastContact: "最終連絡",
  signals: "安否",
  recording: "録音",
  transcript: "文字起こし",
  classes: "分類",
  noClasses: "分類なし",
  calls: "電話",
  override: "優先変更",
  none: "なし",
  noContact: "連絡なし",
  noRecording: "録音なし",
  left: "残り",
  over: "超過",
  startsOn: "で開始",
  source: "出典",
  confirmed: "確認",
  unconfirmed: "未確認",
  emergency: "緊急",
  support: "支援",
  ago: "前",
  open: "詳細",
  close: "閉じる",
  noAnswer: "不通",
  expired: "失効",
  clear: "解除",
  save: "保存",
  reasonInput: "理由",
  base: "表",
  elapsedDisaster: "発災",
  elapsedOutage: "停電",
  at: "時点",
} as const;

/** 録音・自由文の分類（Claude、T12）の言葉。T12 の部品が来るまでの読むだけの表示に使う */
export const CLASS_LABELS: Record<RecordingClass, string> = {
  injury: "けが",
  immobile: "動けない",
  water: "浸水",
  device_stopped: "機器停止",
  unknown: "不明",
};
