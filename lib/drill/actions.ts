// ケアマネの 7 つの手と世界の返事（docs/tasks/T20.md）。D1 を使わない所。保存は lib/drill/db.ts の actDrill。
//
// 手は 7 つで確定（11/2）: 本人電話・連絡先電話・訪問・訪問依頼・受入依頼（福祉避難所）・行政報告（市役所）・退避（自分も避難）。
// 所要時間は表で固定（ACTION_MINUTES）。手を打つとケアマネの時計がその分進み、次の刻みの時刻を越えたら、
// その刻みを手の中で進める（表の出来事 → 監督 → 本人役。engine の step と同じ）。その刻みの安否は「着信」（割り込み。画面と声は T21）。
//
// 世界の返事:
// - 結果は先に表で決める（T19 の decideWorldReply と WORLD_ODDS、本人・家族が出るかは T18 の decideCallPickup）。
//   Claude は結果を決めない。手が刻みを越えたときは、その刻みの監督（Opus）の 1 回に相乗りして文だけ言い換える（呼び出しは増やさない）
// - 本人・家族・支援者が電話に出たら、言う事は本人役（Haiku、T18 の personaCallReply。CallHook）。鍵が無い・失敗は固定の言葉
// - 返事が決まる時刻は手の終わり（刻みを越えた手は、越えた刻みの表の出来事のあとの世界）
//
// 世界の変化（表で固定）: 訪問で着いた・受入依頼が受けられた → 本人の印（栄養剤の持ち出し忘れ・帰宅希望）を消す。
// 訪問依頼が手配できた → 事業所の職員なら空きを 1 減らし、着く時刻に印を消し、戻る時刻に空きを 1 戻す（scenarios.ts の settleWorld）。
// この画面で正解・不正解を出さない（採点は T22）。手の前の状態（before）を残す。

import type { ContactKind, DrillAction } from "../db/types.ts";
import { decideWorldReply, callLine, WORLD_REPLY_LABELS, WORLD_REPLY_TEXTS, type WorldReplyStatus } from "./director.ts";
import {
  DrillEnded,
  step,
  type ActionBefore,
  type ActionRecord,
  type ActionResult,
  type ActionStatus,
  type DrillIncident,
  type DrillState,
  type PersonState,
  type ReplyAsk,
  type ReplyWords,
  type StepHooks,
  type Tick,
} from "./engine.ts";
import { CALL_FIXED_SPEECH, CALL_STATUS_LABELS, CALL_STATUS_TEXTS } from "./labels.ts";
import { decideCallPickup, type CallPickup } from "./persona.ts";
import {
  CLEARED_ON_ARRIVAL,
  clearMarks,
  phoneOf,
  scenarioOf,
  settleWorld,
  type WorldState,
} from "./scenarios.ts";

// ---------- 表 ----------

/** 手ごとの所要時間（分）。出向く 40 分（仕様書「画面 4」）。電話は 5 分、手配・報告は電話の分と取り次ぎ */
export const ACTION_MINUTES: Readonly<Record<DrillAction, number>> = {
  call_person: 5,
  call_contact: 5,
  visit: 40,
  dispatch: 10,
  request_welfare_shelter: 15,
  report_city: 10,
  evacuate_self: 30,
};

/** 出向いてもらった人が着くまで（分、手配が決まってから）。ケアマネが出向くのと同じ 40 分 */
export const DISPATCH_ARRIVE_MINUTES = 40;
/** 事業所の職員が戻るまで（分、手配が決まってから）。行って 40 分・いて 40 分・戻って 40 分 */
export const DISPATCH_BACK_MINUTES = 120;

/** 本人の相手が要る手 */
const NEEDS_PERSON: ReadonlySet<DrillAction> = new Set(["call_person", "call_contact", "visit", "dispatch", "request_welfare_shelter"]);

export function needsPerson(kind: DrillAction): boolean {
  return NEEDS_PERSON.has(kind);
}

/** 電話の相手になる区分（本人電話は本人、連絡先電話は本人のほかの全部） */
export const CALL_CONTACT_KINDS: ReadonlyArray<ContactKind> = [
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

/** 出向いてもらえる相手の区分（無ければ事業所の職員） */
export const DISPATCH_KINDS: ReadonlyArray<ContactKind> = ["visiting_nurse", "care_service"];

/** 本人役が出る相手（本人・家族・支援者・民生委員）。ほかの相手（事業所・施設・市役所）は世界が答える */
const PERSON_CALLEES: ReadonlySet<ContactKind> = new Set(["self", "family", "supporter", "welfare_commissioner"]);

/** 相手の連絡先が選べる手と、その区分。無い手は相手を受けない */
export function targetKinds(kind: DrillAction): ReadonlyArray<ContactKind> {
  switch (kind) {
    case "call_person":
      return ["self"];
    case "call_contact":
      return CALL_CONTACT_KINDS;
    case "dispatch":
      return DISPATCH_KINDS;
    case "report_city":
      return ["city_office"];
    default:
      return [];
  }
}

/** 相手の連絡先が無ければ受けない手（連絡先電話）。本人電話は本人の連絡先を自動で選ぶ */
export function needsTarget(kind: DrillAction): boolean {
  return kind === "call_contact";
}

/** 返事の状態の言葉（2〜4 字）。T19 の 13 と電話の 3 つ */
export const ACTION_STATUS_LABELS: Readonly<Record<ActionStatus, string>> = { ...WORLD_REPLY_LABELS, ...CALL_STATUS_LABELS };

/** 返事の固定の文 */
export const ACTION_STATUS_TEXTS: Readonly<Record<ActionStatus, string>> = { ...WORLD_REPLY_TEXTS, ...CALL_STATUS_TEXTS };

// ---------- 入力と呼び口 ----------

/** 手の相手（台帳の連絡先の行から保存の所が作る。名前と番号は持たない） */
export type ActTarget = {
  id: string;
  kind: ContactKind;
  /** 「家族 娘」「訪問看護」（lib/list/calls.ts の callTargetText） */
  label: string;
  /** 台帳に番号がある */
  hasPhone: boolean;
};

export type ActInput = { kind: DrillAction; person: string | null; target: ActTarget | null };

/** 本人役の通話（T18 の personaCallReply）に渡す物。出ると決まったときだけ呼ぶ */
export type CallAsk = {
  person: string;
  target: ActTarget;
  pickup: CallPickup;
  /** 返事の時刻（発災からの時間） */
  hour: number;
  world: WorldState;
  /** この刻みの状況 */
  incidents: ReadonlyArray<DrillIncident>;
  state: PersonState | null;
};

/** 出た人の言う事。pickup が no_answer なら本人役の周りにいない相手（出ない） */
export type CallHook = (ask: CallAsk) => Promise<{ pickup: CallPickup; speech: string | null; ai: boolean }>;

export type ActionHooks = StepHooks & { call?: CallHook };

// ---------- 返事を決める ----------

type Decision = Omit<ActionResult, "ai" | "speech" | "speechAi" | "cleared" | "staff" | "crossed" | "atMinute">;

const isCall = (k: DrillAction) => k === "call_person" || k === "call_contact";

/** 手の相手の区分（本人電話は本人。訪問依頼・行政報告は選んだ連絡先、無ければ事業所の職員・相手なし） */
function calleeOf(input: ActInput): ContactKind | null {
  if (input.kind === "call_person") return "self";
  return input.target?.kind ?? null;
}

function fixed(status: ActionStatus, ok: boolean, because: string | null, pickup: CallPickup | null = null): Decision {
  return { ok, status, because, text: ACTION_STATUS_TEXTS[status], pickup };
}

/**
 * 世界の返事を決める（文は固定）。電話は台帳に番号が無ければ「番号なし」。本人・家族・支援者への電話は、
 * 線がつながる（呼出）なら出るかを T18 の割合で決める（出る → 通話、出ない → 応答なし、背景の音だけ → 無言。本人が話せない も無言）
 */
export function decideAction(input: ActInput, world: WorldState, hour: number, roll: () => number): Decision {
  const callee = calleeOf(input);
  if (isCall(input.kind) && (!input.target || !input.target.hasPhone)) return fixed("noNumber", false, null);
  const w = decideWorldReply({ action: input.kind, person: input.person, callee, world, hour }, roll());
  const d = fixed(w.status as WorldReplyStatus, w.ok, w.because);
  if (!isCall(input.kind) || w.status !== "ringing") return d;
  const pickup = decideCallPickup(callLine(world, input.person, callee), roll(), true);
  if (pickup === "answers") return fixed("connected", true, null, pickup);
  if (pickup === "background_only") return fixed("silent", false, null, pickup);
  return fixed("noAnswer", false, null, pickup);
}

/** 監督に言い換えを頼める返事（世界が答える物）。本人・家族が出た・出ないは本人役の物なので頼まない */
function wordable(d: Decision): boolean {
  return d.pickup === null;
}

/** 本人役の安否の出どころと電話の相手の区分が同じなら、その言う事を出た人の言葉に使う（鍵なし・本人役の失敗のとき） */
const SOURCE_OF: Partial<Record<ContactKind, PersonState["source"]>> = {
  self: "agent",
  family: "family",
  supporter: "supporter",
  welfare_commissioner: "supporter",
};

export function fixedSpeech(state: PersonState | null, callee: ContactKind | null): string {
  const src = callee ? SOURCE_OF[callee] : undefined;
  if (state?.saying && src && state.source === src) return state.saying;
  return CALL_FIXED_SPEECH;
}

// ---------- 手を打つ ----------

/** 手の前の状態（本人の様子・印・職員の空き・電話の線・家の前の道） */
export function beforeOf(state: DrillState, person: string | null, extra: Pick<ActionBefore, "triage" | "ranking"> = {}): ActionBefore {
  const w = state.world;
  return {
    person: person ? (state.people[person] ?? null) : null,
    marks: person ? { ...(w.marks[person] ?? {}) } : {},
    staff: w.staff,
    phone: phoneOf(w, person),
    roadClosed: person ? w.roads.some((r) => r.person === person && !r.open) : false,
    ...(extra.triage !== undefined ? { triage: extra.triage } : {}),
    ...(extra.ranking !== undefined ? { ranking: extra.ranking } : {}),
  };
}

/** 手を 1 つ足す（返事はまだ。刻みを越える間は返事なしのまま） */
export function pushAction(state: DrillState, record: ActionRecord): DrillState {
  return { ...state, actions: [...state.actions, record] };
}

/**
 * 返事を当てる（手を打った要求でも、保存した物からの作り直しでも同じ所を通る）。
 * 消えた印を消し、手配できた訪問依頼は職員の空きを減らして着く・戻る時刻を世界に置き、時計を返事の時刻まで進める
 */
export function applyResult(state: DrillState, id: string, result: ActionResult): DrillState {
  const i = state.actions.findIndex((a) => a.id === id);
  if (i < 0) return state;
  const rec = state.actions[i];
  let world = state.world;
  if (rec.person && result.cleared.length > 0) world = clearMarks(world, rec.person, result.cleared).world;
  if (rec.kind === "dispatch" && result.ok && rec.person) {
    world = {
      ...world,
      staff: world.staff + result.staff,
      dispatched: [
        ...(world.dispatched ?? []),
        {
          person: rec.person,
          arrive: result.atMinute + DISPATCH_ARRIVE_MINUTES,
          back: result.staff < 0 ? result.atMinute + DISPATCH_BACK_MINUTES : null,
          arrived: false,
        },
      ],
    };
  }
  const minute = Math.max(state.minute, result.atMinute);
  world = settleWorld(world, minute);
  const actions = [...state.actions];
  actions[i] = { ...rec, result };
  return { ...state, world, minute, actions };
}

export type ActOutcome = {
  state: DrillState;
  record: ActionRecord;
  /** 手の途中で進んだ刻み（保存する物） */
  ticks: Tick[];
};

/**
 * 手を 1 つ打つ。相手の確かめ（参加者・台帳の連絡先）は保存の所（lib/drill/db.ts）が先にする。
 * roll は 0 以上 1 未満（Math.random など。テストで固定）。extra は手の前の左の表（保存の所が画面と同じ道で作る）
 */
export async function act(
  state: DrillState,
  input: ActInput,
  hooks: ActionHooks = {},
  roll: () => number = Math.random,
  extra: Pick<ActionBefore, "triage" | "ranking"> = {},
): Promise<ActOutcome> {
  if (state.status !== "running") throw new DrillEnded();
  const minutes = ACTION_MINUTES[input.kind];
  const atMinute = state.minute;
  const endMinute = atMinute + minutes;
  const callee = calleeOf(input);
  const record: ActionRecord = {
    id: `a${state.actions.length + 1}`,
    kind: input.kind,
    person: input.person,
    target: input.target?.id ?? null,
    callee,
    calleeLabel: input.target?.label ?? null,
    at: atMinute / 60,
    atMinute,
    endMinute,
    minutes,
    step: state.step,
    before: beforeOf(state, input.person, extra),
    result: null,
  };

  // 手の途中で次の刻みの時刻を越えたら、その刻みを進める。返事はその刻みの表の出来事のあとの世界で決め、監督に言い換えを頼む
  let s = pushAction(state, record);
  const hours = scenarioOf(s.scenario).hours;
  const ticks: Tick[] = [];
  const held: { decided: Decision | null } = { decided: null };
  let words: ReplyWords[] = [];
  let incidents: ReadonlyArray<DrillIncident> = [];
  while (s.status === "running" && s.step < hours.length - 1 && hours[s.step + 1] * 60 <= endMinute) {
    const at = hours[s.step + 1];
    const r = await step(s, hooks, {
      replies: (world): ReplyAsk[] => {
        const x = decideAction(input, world, at, roll);
        held.decided = x;
        if (!wordable(x)) return [];
        return [{ id: record.id, action: input.kind, person: input.person, callee, status: x.status, because: x.because, text: x.text }];
      },
    });
    s = r.state;
    ticks.push(r.tick);
    words = r.words;
    incidents = r.tick.incidents;
  }
  const d: Decision = held.decided ?? decideAction(input, settleWorld(s.world, endMinute), endMinute / 60, roll);

  // 出たら言う事（本人役。鍵が無い・失敗は固定の言葉）
  let speech: string | null = null;
  let speechAi = false;
  let status = d.status;
  let ok = d.ok;
  let text = d.text;
  let pickup = d.pickup;
  if (d.status === "connected" && input.person && input.target && PERSON_CALLEES.has(input.target.kind)) {
    const own = s.people[input.person] ?? null;
    const reply = hooks.call
      ? await hooks
          .call({ person: input.person, target: input.target, pickup: "answers", hour: endMinute / 60, world: s.world, incidents, state: own })
          .catch(() => null)
      : null;
    if (reply?.pickup === "no_answer") {
      status = "noAnswer";
      ok = false;
      text = ACTION_STATUS_TEXTS.noAnswer;
      pickup = "no_answer";
    } else {
      speech = reply?.speech ?? fixedSpeech(own, input.target.kind);
      speechAi = reply?.speech != null && reply.ai;
    }
  }

  const reworded = words.find((w) => w.id === record.id)?.text.trim() ?? "";
  const arrivedAt = (input.kind === "visit" && status === "arrived") || (input.kind === "request_welfare_shelter" && status === "accepted");
  const result: ActionResult = {
    ok,
    status,
    because: d.because,
    text: reworded || text,
    ai: reworded !== "",
    speech,
    speechAi,
    pickup,
    cleared: arrivedAt && input.person ? clearMarks(s.world, input.person, CLEARED_ON_ARRIVAL).cleared : [],
    staff: input.kind === "dispatch" && ok && callee !== "visiting_nurse" ? -1 : 0,
    crossed: ticks.map((t) => t.step),
    atMinute: endMinute,
  };
  s = applyResult(s, record.id, result);
  return { state: s, record: s.actions.find((a) => a.id === record.id)!, ticks };
}
