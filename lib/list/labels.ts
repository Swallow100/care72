// 担当一覧の発災時（T13）の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。
// 色の言葉（至急・要確認・不明・無事）は lib/labels.ts の COLOR_LABELS、連絡先の種類は CONTACT_KIND_LABELS。

import type { RecordingClass } from "../db/types.ts";

/** 列の見出し */
export const COLUMN_LABELS = {
  state: "状態",
  tier: "連絡順",
  kana: "氏名",
  remain: "残り",
  contact: "最終連絡",
  age: "年齢・介護度",
  medical: "医療",
  hazard: "ハザード",
  supporter: "支援者",
  plan: "避難計画",
} as const;

/**
 * 段の列の見出し。平時も発災時も「連絡順」（T187）。平時の値は骨格の段（1〜8）で、本人のページの上の「連絡順」と同じ数・同じ言葉
 * （T78 で平時を「組」にしたが、本人のページと 2 つの名前になり審査で通じなかった）。
 * 平時は信号も時刻も無く表の並びが無いので、1〜N の番号は作らない（作ると表の外で順を決めることになる）。
 * 2 つの番号が同じ表に並ぶのは発災時の CSV だけで、そこでは骨格の段を「組」と呼び分ける（lib/forms/caseload-csv.ts の GROUP_HEADER）
 */
export function tierColumnLabel(_disaster: boolean): string {
  return COLUMN_LABELS.tier;
}

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
  override: "順番変更",
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
  connected: "通話",
  heard: "安否",
  heardGreen: "無事",
  heardRed: "無事でない",
  heardNone: "聞けず",
  injured: "けが",
  immobile: "動けない",
  memo: "メモ",
  reach: "距離",
  cancel: "取消",
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
  other: "その他",
  unknown: "不明",
};

/** 絞込の帯（T58）の言葉 */
export const FILTER_LABELS = {
  title: "絞込",
  color: "状態",
  area: "地区",
  mark: "医療",
  search: "検索",
  clear: "解除",
  all: "全部",
  none: "なし",
} as const;
