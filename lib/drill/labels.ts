// 訓練（T17）の画面の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。設計の側が校正に通す一覧は docs/progress/t17.md。
// 画面では 筋書き → 「想定」、出来事 → 「状況」、世界の状態 → 「被害状況」、刻み → 出さない（「経過 6 時間」）。
// 安否の色の言葉（至急・要確認・灰・無事）は lib/labels.ts の COLOR_LABELS を読み、ここに書かない。

import type { DrillAction, DrillScenario, DrillStatus } from "../db/types.ts";
import { CATALOG_LABELS } from "./action-catalog.ts";
import type { FictionKind } from "./fiction.ts";
import type { AiStop, PhoneState, ShelterState, TsunamiState, WaterState, WorldEventKind } from "./scenarios.ts";
import { markLabels, NO_CALL } from "./event-catalog.ts";
import { hourText, minuteText, TIME_WORDS } from "./time-text.ts";

export const SCENARIO_LABELS: Record<DrillScenario, string> = {
  heavy_rain: "大雨想定",
  earthquake: "地震想定",
  short: "10 分版",
  virtual: "仮想",
};

export const STATUS_LABELS: Record<DrillStatus, string> = {
  running: "進行中",
  finished: "終了",
  abandoned: "中断",
};

/** 見出し・ボタン・欄の名前 */
/** 仮想モード（T50）の言葉 */
export const VIRTUAL_LABELS = {
  note: "仮想モード 架空の人と街。結末まで出ます",
  /** デモ以外の事業所（T70。結末は出さない） */
  noteRole: "仮想モード 本人役と街は AI。結末なし",
  ended: "結末",
  /** 結末の理由（世界が決めた街と物の事実。T53） */
  endedReason: "経緯",
  fallback: "世界 代替",
} as const;

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
  hours: TIME_WORDS.hours,
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

/** 訓練の幅（T59）の言葉。開始の前の設定・早送りの間・手の取消とメモ */
export const T59_LABELS = {
  settings: "設定",
  participants: "参加者",
  staff: "職員",
  /** 職員の既定（想定の表の値） */
  staffDefault: "既定",
  people: "人",
  night: "夜間発災",
  all: "全員",
  noParticipants: "参加者なし",
  interval: "間隔",
  seconds: "秒",
  undo: "取消",
  undoLocked: "取消不可",
  undone: "取消",
  memo: "メモ",
  /** 取消の確認の窓 */
  undoTitle: "対応取消",
  /** 決める方（窓の「取消」と並ぶので同じ言葉にしない） */
  undoOk: "取消確定",
  undoBody: "直前の対応 1 件を取消",
  clock: "時刻",
  quake: "発災",
  now: "今",
  oclock: "時",
} as const;

/** 訓練を本物の事業所で（T70）の言葉。開始の前の押せる人なし・見込み、刻みの停止の印、自動中断 */
export const T70_LABELS = {
  /** 本人も家族・支援者もスマホで赤緑を押せない人（灰の文字） */
  noPresser: "押せる人なし",
  /** AI の呼び出しの見込み（「見込み 約 65 回」） */
  estimate: "見込み",
  about: "約",
  times: "回",
  /** 見込みが残りを超える（赤の文字。開始は止めない） */
  short: "上限不足",
  autoAbandon: "自動中断",
  /** 自動中断の理由（一覧の行の詳細） */
  day: "24 時間",
} as const;

/**
 * AI が止まったときの訓練の帯（T76。lib/drill/ai-stop.ts）。刻みごとに積まず 1 本。理由の言葉は lib/claude/status.ts の AI_STATUS_LABELS。
 * 固定の筋は想定の表の出来事と安否だけで進む（想定のみ）、仮想は街と本人役が止まる（世界停止）。戻り方は engine の動きのまま
 */
export const AI_STOP_UI = {
  title: "AI 停止",
  fixed: "想定のみ",
  fixedTitle: "想定の表の出来事と安否だけで進む。監督と本人役の AI は使わない",
  virtual: "世界停止",
  virtualTitle: "街の出来事と本人役の連絡が止まる。対応と時計は進む",
  /** まだ止まった刻みが無く、次の刻みから止まる（上限に今達した） */
  next: "次から",
  /** 次の「進める」で呼び直す（失敗・日が替わった上限） */
  retry: "自動再試行",
  /** 上限は日（JST）が替われば戻る */
  tomorrow: "翌日再開",
  resumed: "再開済",
} as const;

/** 上限で止まった AI の役の印（状況 ai_stop の文。画面には出さず、帯 1 本にまとめる。T76） */
export const AI_STOP_LABELS: Record<AiStop, string> = {
  persona: "本人役 停止",
  director: "監督 停止",
  world: "世界 停止",
};

/** 訓練の人の印（T48）。人は全部作った例で、本人役・家族役は AI が演じる */
export const FICTION_LABELS = {
  mark: "架空",
  title: "AI が演じる架空の人",
  note: "訓練の人は AI が演じる架空の人（作った例の記録）",
} as const;

/** デモ以外の事業所の訓練の人の印（T70。本人役は利用者の台帳から作り、AI が演じる。lib/drill/fiction.ts） */
export const ROLE_LABELS = {
  mark: "本人役",
  title: "AI が演じる訓練の本人役",
  note: "訓練の本人・家族の言葉は AI が演じる本人役",
} as const;

/** 印の言葉（デモ事業所は架空、ほかは本人役） */
export function fictionLabels(kind: FictionKind = "fictional"): { mark: string; title: string; note: string } {
  return kind === "role" ? ROLE_LABELS : FICTION_LABELS;
}

/** 状況（世界の出来事）の種類の印 */
export const EVENT_KIND_LABELS: Record<WorldEventKind, string> = {
  alert: "警戒",
  quake: "地震",
  tsunami: "津波",
  flood: "浸水",
  outage: "停電",
  outage_restored: "停電",
  phone: "電話",
  radio: "電波",
  water: "断水",
  road: "道路",
  shelter: "避難所",
  facility: "施設",
  supply_left: "持ち出し",
  nurse_away: "訪問看護",
  going_home: "帰宅",
  line_down: "電話",
  town_flood: "浸水",
  landslide: "土砂",
  town_road: "道路",
  town_water: "断水",
  town_line: "電話",
  town_facility: "施設",
  weather: "天候",
  narration: "世界",
  world_note: "世界",
  outcome: "結末",
  ai_stop: "停止",
  auto_abandon: "中断",
  // T92 の出来事の表の変化（状況の欄は種類の印 lib/drill/event-catalog.ts の incidentLabel を先に見る）
  note: "情報",
  mark: "個別",
  check: "確認",
  schedule: "予定",
};

/** 本人ごとの印（被害状況の「個別」の欄）。PersonMarks の鍵ごと（出来事の表 lib/drill/event-catalog.ts の markLabels。T92 で 5 つ足した） */
export const MARK_LABELS = markLabels;

/** 状況の欄で根拠の出典に添える言葉 */
export const BASIS_LABEL = "出典";

/**
 * 経過の 3 つのタブ（T105、lib/drill/timeline.ts）。発生（起きたこと）・把握（分かったこと）・対応（した対応）。
 * 見比べの印は遅れ（起きてから把握まで時間があった）・未把握（終わりまで届かなかった）・公表（起きた時に把握）
 */
export const LOG_LABELS = {
  panel: "経過",
  tabs: "経過切替",
  occur: "発生",
  know: "把握",
  act: "対応",
  /** 発生のタブの本人のする事（本人役・想定の表の doing）の印 */
  doing: "行動",
  /** 訓練の途中で発生に出していない行があるとき（数は出さない） */
  hidden: "非公表分 終了後表示",
  late: "遅れ",
  never: "未把握",
  public: "公表",
  /** 把握の経路 */
  viaSignal: "安否",
  /** 訓練記録の見比べの欄 */
  compare: "発生と把握",
  happened: "起きたこと",
  knownAt: "把握時刻",
  lag: "差",
  via: "経路",
  mark: "印",
} as const;

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

/** 電話の様子（T105 で down を「不通」から「通話不可」に。lib/drill/event-catalog.ts の NO_CALL） */
/** 世界の電話（通話）。down は通話規制（T125。かけ直せば時々つながる。全部は止めない。家の固定電話の不通は NO_CALL） */
export const PHONE_LABELS: Record<PhoneState, string> = { ok: "通常", busy: "不安定", down: "規制" };
/** 電波（携帯の基地局。T125、lib/drill/comms.ts）。区域は停電が長引いた区域の家だけ */
export const RADIO_LABELS = { ok: "通常", area: "区域不通", all: "不通" } as const;
export const WATER_LABELS: Record<WaterState, string> = { none: "なし", out: "断水中", restored: "解消" };
export const TSUNAMI_LABELS: Record<TsunamiState, string> = { none: "なし", evacuate: "避難", lifted: "解除" };
export const SHELTER_LABELS: Record<ShelterState, string> = { open: "開設", crowded: "混雑", full: "満員", closed: "閉鎖" };

/** 帯の名前（72 時間の棒） */
export const BAND_LABELS = { outage: "停電", water: "断水", phone: "電話", radio: "電波" } as const;

/** API の断り */
export const DRILL_API_ERRORS = [
  "login_required",
  "forbidden",
  "invalid",
  "not_found",
  "running",
  "conflict",
  "ended",
  "locked",
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
  /** 刻みを越えた手・最後でない手は取り消せない（T59） */
  locked: "取消不可",
};

/** 「経過 6 時間」「経過 6 時間 10 分」（発災からの時間。小数の時間は分まで、lib/drill/time-text.ts） */
export function elapsedLabel(hour: number): string {
  return `${DRILL_LABELS.elapsed} ${hourText(hour)}`;
}

// ---------- ケアマネの手（T20） ----------

/** 手（ボタン）。form9 の安否確認の方法（本人電話・連絡先電話・訪問）と同じ言い方。手の表（T91 の lib/drill/action-catalog.ts）の label */
export const ACTION_LABELS: Record<DrillAction, string> = { ...CATALOG_LABELS };

/** 対応の欄の言葉 */
export const ACTION_UI = {
  person: "対象",
  target: "相手",
  execute: "実行",
  result: "結果",
  history: "履歴",
  callIn: "着信",
  minutes: TIME_WORDS.minutes,
  staff: "事業所",
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
export const CALL_STATUS_LABELS = { noAnswer: "応答なし", silent: "無言", noNumber: "番号なし", replied: "返信", read: "既読", unread: "未読" } as const;
export const CALL_STATUS_TEXTS: Record<keyof typeof CALL_STATUS_LABELS, string> = {
  noAnswer: "呼び出したが出ない",
  silent: "出たが声がない。物音だけ",
  noNumber: "電話番号が台帳にない",
  // メッセージ（T125）
  replied: "返信があった",
  read: "既読になったが返信はない",
  unread: "まだ読まれていない",
};

/** 着信の画面と声（T21）の言葉。出る・出ない・切るは電話の画面の言い方 */
export const CALL_UI = {
  incoming: "着信",
  talking: "通話中",
  answer: "出る",
  decline: "出ない",
  hangUp: "切る",
  /** 録音・声の再生のボタン（状態の「再生中」はそのまま） */
  play: "聞く",
  playing: "再生中",
  voice: "音声",
  recording: "録音",
  /** ケアマネが通話・訪問で聞いた安否（行の詳細の印） */
  heardCall: "通話",
  heardVisit: "訪問",
} as const;

/** 出たが言葉の無いとき（鍵なし・本人役の失敗）の固定の言葉。安否の言う事が相手の物なら、そちらを使う（lib/drill/actions.ts） */
export const CALL_FIXED_SPEECH = "はい、もしもし";

/** 「3 時間 40 分」（分が 0 なら「3 時間」）。発災からの分。経過の言い方は lib/drill/time-text.ts の 1 か所 */
export function clockLabel(minute: number): string {
  return minuteText(minute);
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

/** 訓練記録の一覧の「経過 6 / 72 時間」。分のあるときは「経過 6 時間 10 分 / 72 時間」 */
export function progressLabel(hour: number, last: number): string {
  const m = Math.max(0, Math.round(hour * 60));
  if (m % 60 === 0) return `${DRILL_LABELS.elapsed} ${m / 60} / ${last} ${DRILL_LABELS.hours}`;
  return `${DRILL_LABELS.elapsed} ${hourText(hour)} / ${last} ${DRILL_LABELS.hours}`;
}
