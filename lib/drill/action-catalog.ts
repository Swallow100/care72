// ケアマネの手の表 v2（docs/tasks/T91.md）。1 行 1 手で、所要時間・職員の空き・相手・結果の決め方・効き目・言い方を持つ。
// 画面（components/drill/ActionPanel、ブラウザ）・手の所（lib/drill/actions.ts）・世界の返事（lib/drill/world-reply.ts）・
// 本人役・監督・世界の言い方（persona.ts・director.ts・world-oneshot.ts）が同じ表を読む。採点（T94）は towardPerson と reach を読む。
// ここは型と定数だけ（Claude を呼ぶ層を読まない。ブラウザの束に入る）。
//
// 線: 手の効き目は下の閉じた一覧（ActionEffect）だけ。左の表（色と連絡順、lib/triage）に届くのは今までの 2 つの道だけ
// （時計の頼り先の確認の写し check → world.checks、通話・訪問で聞いた安否 heard）。119 は勧めるまで（advise。救急を世界が作らない）。

import type { CheckStatus, ContactKind, DependsOn, DrillAction } from "../db/types.ts";
import type { ActionStatus } from "./action-types.ts";
import type { ArrivalRole, AskKind, PersonMarks, SupplyKind } from "./scenarios.ts";

// ---------- 区分 ----------

export const ACTION_GROUPS = ["contact", "visit", "arrange", "report", "record"] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

/** 区分の見出し（画面、2 字） */
export const ACTION_GROUP_LABELS: Readonly<Record<ActionGroup, string>> = {
  contact: "連絡",
  visit: "訪問",
  arrange: "手配",
  report: "報告",
  record: "記録",
};

// ---------- 結果の決め方（lib/drill/world-reply.ts が読む） ----------

/** 手配型の確率の行（world-reply.ts の WORLD_ODDS） */
export type ArrangeOdds = "arrange" | "vendor" | "backup";

/**
 * 結果を決める規則の種類。世界の事実（通行止・不通・休止・職員の空き・訪問看護）を先に見て、確率は WORLD_ODDS。
 * - call: 電話型（線の様子 → 本人・家族・支援者は出るかを本人役の割合、ほかはつながる確率）
 * - visit: 訪問型（通行止 → 警戒の中の確率）
 * - dispatch: 訪問依頼（今のまま。訪問看護の印・職員の空き・通行止・電話の様子）
 * - arrange: 手配型（電話の様子の確率。ok は受けてもらえたときの状態。closedBy の施設が休止なら「休止」）
 * - accept: 受入型（時間ごとの確率。福祉避難所と同じ表）
 * - report: 報告型
 * - record: 記録型（いつも ok）
 */
export type ActionDecide =
  | { type: "call" }
  | { type: "visit" }
  | { type: "dispatch" }
  | { type: "arrange"; odds: ArrangeOdds; ok: "dispatched" | "accepted"; closedBy?: DependsOn }
  | { type: "accept" }
  | { type: "report" }
  | { type: "record"; status: "evacuated" | "noted" };

// ---------- 効き目（閉じた一覧） ----------

/**
 * 手の効き目。結果が ok のときに lib/drill/actions.ts がこの順に当てる（保存した物からの作り直しでも同じ所を通る）。
 * - reach: 届いた（採点 T94 の「その人に届いた」。時刻は reach の欄）
 * - heard: 通話・訪問で聞いた安否（左の表に入る。今までの 3 つの手だけ）
 * - arrival: 本人の所へ向かう人を world.arrivals に積む（arriveMin は手の終わりからの分。[最小, 最大] は確率で決めて返事に残す）。
 *   role "callee" は相手の区分から（家族 → family、ほか → supporter）。legacy は今の訪問依頼の world.dispatched（動きを変えない）
 * - check: 時計の頼り先の確認の上書き（world.checks。world-clocks.ts の drillClocks が左の表の入力に写す）
 * - clearMarks: 本人の印を手の終わりに消す（訪問で着いた・受け入れ）
 * - staff: 職員の空きの増減。afterMin があればその分のあとに（応援が着く）
 * - supply: 届いた物（world.supplies。着いたら settleWorld が書く物の印として持つ）
 * - ask_done: 本人・家族の頼み事を、向かった人が着いた時刻に済ませる（world.asks）
 * - advise: 119 への連絡を勧めた時刻（world.advised）。勧めるまでで、救急は作らない
 * - schedule: 予定の出来事（world.scheduled）。今の表では使わない（足すときは WorldChange の種類が要る）
 * - none: 世界を変えない
 */
export type ActionEffect =
  | { kind: "reach" }
  | { kind: "heard" }
  | {
      kind: "arrival";
      role: ArrivalRole | "callee";
      arriveMin: number | readonly [number, number];
      backMin?: number;
      legacy?: true;
    }
  | { kind: "check"; depends: DependsOn; status: CheckStatus }
  | { kind: "clearMarks"; keys: ReadonlyArray<keyof PersonMarks> }
  | { kind: "staff"; delta: 1 | -1; afterMin?: number }
  | { kind: "supply"; supply: SupplyKind }
  | { kind: "ask_done"; asks: ReadonlyArray<AskKind> }
  | { kind: "advise" }
  | { kind: "schedule"; afterMin: number; text: string }
  | { kind: "none" };

/** 「届いた」に数える結果（採点 T94）。at: end は手の終わり、arrival は向かった人が着いた時刻（返事の arriveAt） */
export type ActionReach = { statuses: ReadonlyArray<ActionStatus>; at: "end" | "arrival" };

/** 相手を選ばないときの固定の相手（今の calleeText の形。事業所の職員・市役所・福祉避難所・ほかの事業所） */
export type FixedCallee = "staff" | "city" | "shelter" | "office";

/** 固定の相手の言い方（2〜4 字） */
export const FIXED_CALLEE_LABELS: Readonly<Record<FixedCallee, string>> = {
  staff: "事業所",
  city: "市役所",
  shelter: "福祉避難所",
  office: "他事業所",
};

// ---------- 表 ----------

export type ActionRow = {
  id: DrillAction;
  /** 画面のボタンの言葉（2〜4 字） */
  label: string;
  group: ActionGroup;
  /** 所要時間（分）。自由対応は 0（読み替えた手の分） */
  minutes: number;
  /** 職員の空きを減らす数（0 か 1）。訪問依頼で事業所の職員に出向いてもらう分 */
  staff: 0 | 1;
  /** 対象の本人が要る */
  needsPerson: boolean;
  /** 相手に選べる台帳の連絡先の区分。空なら相手を受けない */
  targetKinds: ReadonlyArray<ContactKind>;
  /** 相手の連絡先が無ければ打てない（無ければ灰。固定の相手のある手は要らない） */
  needsTarget: boolean;
  /** 相手を選ばないときの固定の相手 */
  fixed: FixedCallee | null;
  decide: ActionDecide;
  effects: ReadonlyArray<ActionEffect>;
  /** 採点で「その人への手」に数える */
  towardPerson: boolean;
  reach: ActionReach | null;
  /** Claude に渡す言い方（本人役・監督・世界・講評が同じ物を読む。画面の言葉ではない）。主語なしで「〜した」 */
  words: string;
};

/** 人が着いたら消す印（scenarios.ts の CLEARED_ON_ARRIVAL と同じ。ブラウザの束に scenarios.ts を入れないため写す） */
const ON_ARRIVAL: ReadonlyArray<keyof PersonMarks> = ["supplyLeft", "goingHome"];

/** 電話の相手（連絡先電話）。本人のほかの全部 */
const CALL_CONTACT: ReadonlyArray<ContactKind> = [
  "family",
  "supporter",
  "welfare_commissioner",
  "visiting_nurse",
  "care_service",
  "home_doctor",
  "pharmacy",
  "dialysis_center",
  "city_office",
];

/**
 * 18 の手（docs/tasks/T91.md の表）。並びは画面の並び（区分の段の中の順）。
 * 今までの 7 つ（本人電話・連絡先電話・訪問・訪問依頼・受入依頼・行政報告・退避）は時間・相手・動きを変えない
 */
export const ACTION_CATALOG: ReadonlyArray<ActionRow> = [
  // ---- 連絡 ----
  {
    id: "call_person",
    label: "本人電話",
    group: "contact",
    minutes: 5,
    staff: 0,
    needsPerson: true,
    targetKinds: ["self"],
    needsTarget: false,
    fixed: null,
    decide: { type: "call" },
    effects: [{ kind: "heard" }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["connected"], at: "end" },
    words: "本人に電話した",
  },
  {
    id: "call_contact",
    label: "連絡先電話",
    group: "contact",
    minutes: 5,
    staff: 0,
    needsPerson: true,
    targetKinds: CALL_CONTACT,
    needsTarget: true,
    fixed: null,
    decide: { type: "call" },
    effects: [{ kind: "heard" }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["connected"], at: "end" },
    words: "連絡先に電話した",
  },
  {
    id: "advise_119",
    label: "119勧奨",
    group: "contact",
    minutes: 5,
    staff: 0,
    needsPerson: true,
    targetKinds: ["self", "family", "supporter"],
    needsTarget: true,
    fixed: null,
    decide: { type: "call" },
    effects: [{ kind: "advise" }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["connected"], at: "end" },
    words: "電話で 119 への連絡を勧めた",
  },
  {
    id: "ask_check",
    label: "見守依頼",
    group: "contact",
    minutes: 5,
    staff: 0,
    needsPerson: true,
    targetKinds: ["family", "supporter", "welfare_commissioner", "other"],
    needsTarget: true,
    fixed: null,
    decide: { type: "call" },
    effects: [{ kind: "arrival", role: "callee", arriveMin: [30, 60] }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["connected"], at: "arrival" },
    words: "家族・支援者に様子を見に行ってもらうよう頼んだ",
  },
  // ---- 訪問 ----
  {
    id: "visit",
    label: "訪問",
    group: "visit",
    minutes: 40,
    staff: 0,
    needsPerson: true,
    targetKinds: [],
    needsTarget: false,
    fixed: null,
    decide: { type: "visit" },
    effects: [{ kind: "heard" }, { kind: "clearMarks", keys: ON_ARRIVAL }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["arrived"], at: "end" },
    words: "家に向かった",
  },
  {
    id: "dispatch",
    label: "訪問依頼",
    group: "visit",
    minutes: 10,
    staff: 1,
    needsPerson: true,
    targetKinds: ["visiting_nurse", "care_service"],
    needsTarget: false,
    fixed: "staff",
    decide: { type: "dispatch" },
    effects: [
      { kind: "staff", delta: -1 },
      { kind: "arrival", role: "staff", arriveMin: 40, backMin: 120, legacy: true },
      { kind: "reach" },
    ],
    towardPerson: true,
    reach: { statuses: ["dispatched"], at: "arrival" },
    words: "訪問看護・介護の人に行ってもらうよう頼んだ",
  },
  {
    id: "request_backup",
    label: "応援依頼",
    group: "visit",
    minutes: 10,
    staff: 0,
    needsPerson: false,
    targetKinds: [],
    needsTarget: false,
    fixed: "office",
    decide: { type: "arrange", odds: "backup", ok: "dispatched" },
    effects: [{ kind: "staff", delta: 1, afterMin: 90 }],
    towardPerson: false,
    reach: null,
    words: "ほかの事業所に応援を頼んだ",
  },
  // ---- 手配 ----
  {
    id: "arrange_medicine",
    label: "薬手配",
    group: "arrange",
    minutes: 10,
    staff: 0,
    needsPerson: true,
    targetKinds: ["pharmacy", "home_doctor"],
    needsTarget: true,
    fixed: null,
    decide: { type: "arrange", odds: "arrange", ok: "dispatched" },
    effects: [
      { kind: "check", depends: "delivery", status: "confirmed" },
      { kind: "arrival", role: "medicine", arriveMin: 120 },
      { kind: "supply", supply: "medicine" },
      { kind: "ask_done", asks: ["medicine"] },
      { kind: "reach" },
    ],
    towardPerson: true,
    reach: { statuses: ["dispatched"], at: "arrival" },
    words: "薬局・かかりつけに薬の手配を頼んだ",
  },
  {
    id: "arrange_dialysis",
    label: "透析調整",
    group: "arrange",
    minutes: 15,
    staff: 0,
    needsPerson: true,
    targetKinds: ["dialysis_center", "hospital"],
    needsTarget: true,
    fixed: null,
    decide: { type: "arrange", odds: "arrange", ok: "accepted", closedBy: "dialysis_center" },
    effects: [{ kind: "check", depends: "dialysis_center", status: "confirmed" }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["accepted"], at: "end" },
    words: "透析の受け入れ先を調整した",
  },
  {
    id: "request_welfare_shelter",
    label: "受入依頼",
    group: "arrange",
    minutes: 15,
    staff: 0,
    needsPerson: true,
    targetKinds: [],
    needsTarget: false,
    fixed: "shelter",
    decide: { type: "accept" },
    effects: [{ kind: "clearMarks", keys: ON_ARRIVAL }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["accepted"], at: "end" },
    words: "福祉避難所に受け入れを頼んだ",
  },
  {
    id: "request_hospital",
    label: "病院受入",
    group: "arrange",
    minutes: 15,
    staff: 0,
    needsPerson: true,
    targetKinds: ["hospital", "home_doctor"],
    needsTarget: true,
    fixed: null,
    decide: { type: "accept" },
    effects: [{ kind: "arrival", role: "transport", arriveMin: 60 }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["accepted"], at: "arrival" },
    words: "病院に受け入れを頼んだ",
  },
  {
    id: "arrange_transport",
    label: "移送手配",
    group: "arrange",
    minutes: 15,
    staff: 0,
    needsPerson: true,
    targetKinds: ["care_service", "city_office", "other"],
    needsTarget: false,
    fixed: "city",
    decide: { type: "arrange", odds: "arrange", ok: "dispatched" },
    effects: [
      { kind: "arrival", role: "transport", arriveMin: 60 },
      { kind: "ask_done", asks: ["transport"] },
      { kind: "reach" },
    ],
    towardPerson: true,
    reach: { statuses: ["dispatched"], at: "arrival" },
    words: "移送の手配を頼んだ",
  },
  {
    id: "arrange_power",
    label: "電源手配",
    group: "arrange",
    minutes: 15,
    staff: 0,
    needsPerson: true,
    targetKinds: ["power_company", "city_office", "oxygen_supplier"],
    needsTarget: false,
    fixed: "city",
    decide: { type: "arrange", odds: "arrange", ok: "dispatched" },
    effects: [
      { kind: "arrival", role: "power", arriveMin: 120 },
      { kind: "supply", supply: "power" },
      { kind: "ask_done", asks: ["power", "battery"] },
      { kind: "reach" },
    ],
    towardPerson: true,
    reach: { statuses: ["dispatched"], at: "arrival" },
    words: "電源（蓄電池・発電機）の手配を頼んだ",
  },
  {
    id: "call_vendor",
    label: "業者連絡",
    group: "arrange",
    minutes: 5,
    staff: 0,
    needsPerson: true,
    targetKinds: ["oxygen_supplier", "power_company", "hospital", "other"],
    needsTarget: true,
    fixed: null,
    decide: { type: "arrange", odds: "vendor", ok: "dispatched" },
    effects: [{ kind: "arrival", role: "vendor", arriveMin: [120, 240] }, { kind: "supply", supply: "oxygen" }, { kind: "reach" }],
    towardPerson: true,
    reach: { statuses: ["dispatched"], at: "arrival" },
    words: "機器の業者に連絡して来てもらうよう頼んだ",
  },
  // ---- 報告 ----
  {
    id: "report_city",
    label: "行政報告",
    group: "report",
    minutes: 10,
    staff: 0,
    needsPerson: false,
    targetKinds: ["city_office"],
    needsTarget: false,
    fixed: "city",
    decide: { type: "report" },
    effects: [{ kind: "none" }],
    towardPerson: false,
    reach: null,
    words: "市役所に報告した",
  },
  // ---- 記録 ----
  {
    id: "note",
    label: "記録",
    group: "record",
    minutes: 2,
    staff: 0,
    needsPerson: false,
    targetKinds: [],
    needsTarget: false,
    fixed: null,
    decide: { type: "record", status: "noted" },
    effects: [{ kind: "none" }],
    towardPerson: false,
    reach: null,
    words: "記録だけした",
  },
  {
    id: "evacuate_self",
    label: "退避",
    group: "record",
    minutes: 30,
    staff: 0,
    needsPerson: false,
    targetKinds: [],
    needsTarget: false,
    fixed: null,
    decide: { type: "record", status: "evacuated" },
    effects: [{ kind: "none" }],
    towardPerson: false,
    reach: null,
    words: "自分も避難した",
  },
  {
    id: "free",
    label: "自由対応",
    group: "record",
    minutes: 0,
    staff: 0,
    needsPerson: false,
    targetKinds: [],
    needsTarget: false,
    fixed: null,
    decide: { type: "record", status: "noted" },
    effects: [{ kind: "none" }],
    towardPerson: false,
    reach: null,
    // 本人役・世界は a.kind で引くので、読み替えた手の言い方は actionWords（as）で引く。ここは as の無い古い読み方の受け
    words: "そのほかの対応をした",
  },
];

const BY_ID: ReadonlyMap<DrillAction, ActionRow> = new Map(ACTION_CATALOG.map((r) => [r.id, r]));

/** 手の表の 1 行 */
export function actionRow(id: DrillAction): ActionRow {
  return BY_ID.get(id)!;
}

export function isCatalogAction(v: unknown): v is DrillAction {
  return typeof v === "string" && BY_ID.has(v as DrillAction);
}

function column<V>(pick: (r: ActionRow) => V): Readonly<Record<DrillAction, V>> {
  return Object.fromEntries(ACTION_CATALOG.map((r) => [r.id, pick(r)])) as Record<DrillAction, V>;
}

/** 所要時間（分） */
export const CATALOG_MINUTES = column((r) => r.minutes);
/** ボタンの言葉 */
export const CATALOG_LABELS = column((r) => r.label);
/** Claude に渡す言い方 */
export const CATALOG_WORDS = column((r) => r.words);

/** 区分ごとの手（画面の段の順） */
export function actionsOfGroup(group: ActionGroup): ReadonlyArray<ActionRow> {
  return ACTION_CATALOG.filter((r) => r.group === group);
}

/** 打った手の働き（自由対応は読み替えた手。採点 T94・本人役 T93 が数え・言うときに使う） */
export function effectiveKind(a: { kind: DrillAction; as?: DrillAction | null }): DrillAction {
  return a.kind === "free" && a.as ? a.as : a.kind;
}

/** 打った手の言い方（自由対応は読み替えた手の言い方。ケアマネの文は渡さない） */
export function actionWords(a: { kind: DrillAction; as?: DrillAction | null }): string {
  return CATALOG_WORDS[effectiveKind(a)];
}

// ---------- 自由対応 ----------

/** 自由対応の文の長さの上限（字） */
export const FREE_TEXT_MAX = 120;

/** 自由対応の画面の言葉（2〜4 字） */
export const FREE_LABELS = {
  /** 伏せきれない文を断ったとき（API の 400 の label） */
  refused: "伏字不可",
  /** 文の欄の見出し */
  text: "内容",
  /** 残りの字数 */
  left: "残り",
  /** 読み替えの待ち（実行の横） */
  reading: "読替中",
} as const;
/** 自由対応の読み替え（Opus）の 1 訓練の回数の上限。超えたら読み替えずに記録 */
export const FREE_MAX = 10;
