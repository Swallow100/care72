// 訓練（T17）の画面の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。設計の側が校正に通す一覧は docs/progress/t17.md。
// 画面では 筋書き → 「想定」、出来事 → 「状況」、世界の状態 → 「被害状況」、刻み → 出さない（「経過 6 時間」）。
// 安否の色の言葉（至急・要確認・灰・無事）は lib/labels.ts の COLOR_LABELS を読み、ここに書かない。

import type { DrillScenario, DrillStatus } from "../db/types.ts";
import type { PhoneState, ShelterState, TsunamiState, WorldEventKind } from "./scenarios.ts";

export const SCENARIO_LABELS: Record<DrillScenario, string> = {
  heavy_rain: "大雨の想定",
  earthquake: "地震の想定",
  short: "10 分版",
};

export const STATUS_LABELS: Record<DrillStatus, string> = {
  running: "進行中",
  finished: "終了",
  abandoned: "中断",
};

/** 見出し・ボタン・欄の名前 */
export const DRILL_LABELS = {
  page: "訓練",
  records: "訓練記録",
  scenario: "想定",
  start: "開始",
  advance: "進める",
  fastForward: "早送り",
  abandon: "中断",
  resume: "再開",
  replay: "再生",
  situation: "状況",
  damage: "被害状況",
  actions: "対応",
  elapsed: "経過",
  hours: "時間",
  startedAt: "開始",
  startedBy: "開始者",
  status: "状態",
  prev: "前",
  next: "次",
  compact: "圧縮",
  expand: "展開",
  none: "なし",
  map: "地図",
  confirmAbandon: "中断確定",
  cancel: "取消",
  network: "通信失敗",
} as const;

/** 状況（世界の出来事）の種類の印 */
export const EVENT_KIND_LABELS: Record<WorldEventKind, string> = {
  alert: "警戒",
  quake: "地震",
  tsunami: "津波",
  flood: "浸水",
  outage: "停電",
  outage_restored: "停電",
  phone: "電話",
  water: "断水",
  road: "道路",
  shelter: "避難所",
  facility: "施設",
};

/** 被害状況の欄の名前 */
export const WORLD_LABELS = {
  alert: "警戒レベル",
  quake: "震度",
  tsunami: "津波",
  flood: "浸水",
  outage: "停電",
  phone: "電話",
  water: "断水",
  roads: "道路",
  shelters: "避難所",
  facilities: "施設",
  outageNow: "停電中",
  restored: "復旧",
  area: "地区",
  office: "全域",
  yes: "あり",
  no: "なし",
  open: "通行可",
  closed: "通行止",
  running: "稼働",
  stopped: "休止",
} as const;

export const PHONE_LABELS: Record<PhoneState, string> = { ok: "通常", busy: "不安定", down: "不通" };
export const TSUNAMI_LABELS: Record<TsunamiState, string> = { none: "なし", evacuate: "避難", lifted: "解除" };
export const SHELTER_LABELS: Record<ShelterState, string> = { open: "開設", crowded: "混雑", full: "満員" };

/** 帯の名前（72 時間の棒） */
export const BAND_LABELS = { outage: "停電", water: "断水", phone: "電話" } as const;

/** API の断り */
export const DRILL_API_ERRORS = [
  "login_required",
  "forbidden",
  "invalid",
  "not_found",
  "running",
  "conflict",
  "ended",
] as const;
export type DrillApiError = (typeof DRILL_API_ERRORS)[number];

export const DRILL_API_LABELS: Record<DrillApiError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  invalid: "入力不正",
  not_found: "対象なし",
  running: "実施中あり",
  conflict: "競合 再読込",
  ended: "終了済",
};

/** 「経過 6 時間」 */
export function elapsedLabel(hour: number): string {
  return `${DRILL_LABELS.elapsed} ${hour} ${DRILL_LABELS.hours}`;
}

/** 訓練記録の一覧の「経過 6 時間 / 72」 */
export function progressLabel(hour: number, last: number): string {
  return `${elapsedLabel(hour)} / ${last}`;
}
