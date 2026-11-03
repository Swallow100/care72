// 訓練（T17）の画面の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。設計の側が校正に通す一覧は docs/progress/t17.md。
// 画面では 筋書き → 「想定」、出来事 → 「状況」、世界の状態 → 「被害状況」、刻み → 出さない（「経過 6 時間」）。
// 安否の色の言葉（至急・要確認・灰・無事）は lib/labels.ts の COLOR_LABELS を読み、ここに書かない。

import type { DrillAction, DrillScenario, DrillStatus } from "../db/types.ts";
import type { PhoneState, ShelterState, TsunamiState, WaterState, WorldEventKind } from "./scenarios.ts";

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

/** 訓練の人の印（T48、アドバイザーの返事）。人は全部作った例で、本人役・家族役は AI が演じる */
export const FICTION_LABELS = {
  mark: "架空",
  title: "AI が演じる架空の人",
  note: "訓練の人は AI が演じる架空の人（作った例の記録）",
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
  supply_left: "持出品",
  nurse_away: "訪問看護",
  going_home: "帰宅",
  line_down: "電話",
};

/** 本人ごとの印（被害状況の「個別」の欄）。PersonMarks の鍵ごと */
export const MARK_LABELS = {
  supplyLeft: "未持出",
  nurseAway: "訪問不可",
  goingHome: "帰宅希望",
  lineDown: "電話不通",
} as const;

/** 状況の欄で根拠の出典に添える言葉 */
export const BASIS_LABEL = "出典";

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
  staff: "職員",
  staffFree: "空き",
  people: "人",
  marks: "個別",
} as const;

export const PHONE_LABELS: Record<PhoneState, string> = { ok: "通常", busy: "不安定", down: "不通" };
export const WATER_LABELS: Record<WaterState, string> = { none: "なし", out: "断水中", restored: "解消" };
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
  login_required: "未ログイン",
  forbidden: "権限なし",
  invalid: "入力不正",
  not_found: "対象なし",
  running: "訓練実施中",
  conflict: "要再読込",
  ended: "終了済",
};

/** 「経過 6 時間」 */
export function elapsedLabel(hour: number): string {
  return `${DRILL_LABELS.elapsed} ${hour} ${DRILL_LABELS.hours}`;
}

// ---------- ケアマネの手（T20） ----------

/** 7 つの手（ボタン）。form9 の安否確認の方法（本人電話・連絡先電話・訪問）と同じ言い方 */
export const ACTION_LABELS: Record<DrillAction, string> = {
  call_person: "本人電話",
  call_contact: "連絡先電話",
  visit: "訪問",
  dispatch: "訪問依頼",
  request_welfare_shelter: "受入依頼",
  report_city: "行政報告",
  evacuate_self: "退避",
};

/** 対応の欄の言葉 */
export const ACTION_UI = {
  person: "対象",
  target: "相手",
  execute: "実行",
  result: "結果",
  history: "履歴",
  callIn: "着信",
  minutes: "分",
  staff: "事業所職員",
  shelter: "福祉避難所",
  city: "市役所",
  whole: "全体",
  noTarget: "相手なし",
  ended: "終了済",
  count: "件",
  /** 手の途中（返事の前。刻みを越えている間）・状況の欄で手の途中に来た刻み */
  during: "対応中",
} as const;

/** 電話の返事のうち T19 の表に無い物（本人・家族が出ない・声がない、台帳に番号が無い） */
export const CALL_STATUS_LABELS = { noAnswer: "応答なし", silent: "無言", noNumber: "番号なし" } as const;
export const CALL_STATUS_TEXTS: Record<keyof typeof CALL_STATUS_LABELS, string> = {
  noAnswer: "呼び出したが出ない",
  silent: "出たが声がない。物音だけ",
  noNumber: "電話番号が台帳にない",
};

/** 着信の画面と声（T21）の言葉。応答・拒否は電話の画面の言い方 */
export const CALL_UI = {
  incoming: "着信",
  talking: "通話中",
  answer: "応答",
  decline: "拒否",
  hangUp: "終話",
  play: "再生",
  playing: "再生中",
  voice: "音声",
  recording: "録音",
  /** ケアマネが通話・訪問で聞いた安否（行の詳細の印） */
  heardCall: "通話",
  heardVisit: "訪問",
} as const;

/** 出たが言葉の無いとき（鍵なし・本人役の失敗）の固定の言葉。安否の言う事が相手の物なら、そちらを使う（lib/drill/actions.ts） */
export const CALL_FIXED_SPEECH = "はい、もしもし";

/** 「3 時間 40 分」（分が 0 なら「3 時間」）。発災からの分 */
export function clockLabel(minute: number): string {
  const m = Math.max(0, Math.round(minute));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} ${DRILL_LABELS.hours}` : `${h} ${DRILL_LABELS.hours} ${r} ${ACTION_UI.minutes}`;
}

/** 手の相手の言い方（訪問依頼で相手なしは事業所の職員、行政報告で相手なしは市役所、受入依頼は福祉避難所）。履歴と紙面で同じ */
export function calleeText(a: { kind: DrillAction; calleeLabel: string | null }): string | null {
  if (a.calleeLabel) return a.calleeLabel;
  if (a.kind === "dispatch") return ACTION_UI.staff;
  if (a.kind === "report_city") return ACTION_UI.city;
  if (a.kind === "request_welfare_shelter") return ACTION_UI.shelter;
  return null;
}

/** 「経過 3 時間 40 分」 */
export function elapsedClockLabel(minute: number): string {
  return `${DRILL_LABELS.elapsed} ${clockLabel(minute)}`;
}

/** 訓練記録の一覧の「経過 6 / 72 時間」 */
export function progressLabel(hour: number, last: number): string {
  return `${DRILL_LABELS.elapsed} ${hour} / ${last} ${DRILL_LABELS.hours}`;
}
