// ケアマネの手と世界の返事（docs/tasks/T20.md・T91.md）。D1 を使わない所。保存は lib/drill/db.ts の actDrill。
//
// 手は手の表（lib/drill/action-catalog.ts）の 18。今までの 7 つ（本人電話・連絡先電話・訪問・訪問依頼・受入依頼・行政報告・退避）は
// 時間・相手・動きを変えず、T91 で 119勧奨・見守依頼・応援依頼・薬手配・透析調整・病院受入・移送手配・電源手配・業者連絡・記録・自由対応を足した。
// 所要時間は表で固定。手を打つとケアマネの時計がその分進み、次の刻みの時刻を越えたら、
// その刻みを手の中で進める（表の出来事 → 監督 → 本人役。engine の step と同じ）。その刻みの安否は「着信」（割り込み。画面と声は T21）。
//
// 世界の返事:
// - 結果は先に表で決める（world-reply.ts の decideWorldReply と WORLD_ODDS、本人・家族が出るかは T18 の decideCallPickup）。
//   Claude は結果を決めない。手が刻みを越えたときは、その刻みの監督（Opus）の 1 回に相乗りして文だけ言い換える（呼び出しは増やさない）
// - 本人・家族・支援者が電話に出たら、言う事は本人役（Haiku、T18 の personaCallReply。CallHook）。鍵が無い・失敗は固定の言葉
// - 返事が決まる時刻は手の終わり（刻みを越えた手は、越えた刻みの表の出来事のあとの世界）
//
// 聞いた安否（T21）: 本人・家族・支援者が電話に出て答えた・訪問で着いた → ケアマネが聞いた安否（HeardSignal）。
// 表の効き目に heard のある手（本人電話・連絡先電話・訪問）だけ。色と 4 問は本人役の今の様子から決め（heardOf）、
// 保存の所が signals に出どころ care_manager で足す。人が聞いた結果なので AI の印なし（本人役の言葉は吹き出しにだけ、AI の印つき）。
//
// 世界の変化は手の表の効き目（閉じた一覧）だけ。返事が ok のとき applyResult が順に当てる（保存した物からの作り直しも同じ所）:
// 訪問で着いた・受入依頼が受けられた → 本人の印（栄養剤の持ち出し忘れ・帰宅希望）を消す。訪問依頼 → 今のまま world.dispatched。
// 見守依頼・薬手配・病院受入・移送手配・電源手配・業者連絡 → world.arrivals（着いたら settleWorld が印・届いた物・職員の空きを進める）。
// 薬手配・透析調整 → world.checks（時計の頼り先の確認。左の表に届くのはこの道と聞いた安否だけ）。119勧奨 → world.advised（勧めるまで）。
// 応援依頼 → 90 分後に職員の空き +1。頼み事（world.asks）は向かった人が着いた時刻に済ませる（settleAsks）。
// 自由対応（free）は Claude（Opus）が表の手に読み替え（lib/drill/free-action.ts）、結果と効き目は読み替えた手の行でコードが決める。
// この画面で正解・不正解を出さない（採点は T22・T94）。手の前の状態（before）を残す。

import type { ContactKind, DrillAction } from "../db/types.ts";
import { actionRow, effectiveKind, FIXED_CALLEE_LABELS, type ActionEffect, type ActionRow } from "./action-catalog.ts";
import { ACTION_MINUTES } from "./action-table.ts";
import { callLine, decideWorldReply, WORLD_REPLY_LABELS, WORLD_REPLY_TEXTS, type WorldReplyStatus } from "./world-reply.ts";
import { DRILL_END_MINUTE, ZERO_COUNTS } from "./clock.ts";
import {
  advance,
  DrillEnded,
  isClock,
  isNight,
  step,
  type ActionBefore,
  type ActionRecord,
  type ActionResult,
  type ActionStatus,
  type DrillIncident,
  type DrillState,
  type HeardSignal,
  type PersonState,
  type ReplyAsk,
  type ReplyWords,
  type StepHooks,
  type Tick,
} from "./engine.ts";
import { countFree, freeText, planFree, type FreeHook } from "./free-action.ts";
import { actionTerm, blockOf, termFactsOf } from "./action-terms.ts";
import type { FreePlan } from "./action-types.ts";
import { talkEnd, withResultAsks, type VisitHook } from "./dialogue.ts";
import { CALL_FIXED_SPEECH, CALL_STATUS_LABELS, CALL_STATUS_TEXTS } from "./labels.ts";
import { CALL_PICKUP_ODDS, decideCallPickup, type CallPickup } from "./persona.ts";
import {
  clearMarks,
  phoneOf,
  scenarioOf,
  settleWorld,
  type Arrival,
  type ArrivalRole,
  type WorldState,
} from "./scenarios.ts";

// ---------- 表（lib/drill/action-table.ts。画面と同じ物） ----------

export {
  ACTION_MINUTES,
  CALL_CONTACT_KINDS,
  DISPATCH_KINDS,
  needsPerson,
  needsTarget,
  picksTarget,
  targetKinds,
} from "./action-table.ts";

/** 出向いてもらった人が着くまで（分、手配が決まってから）。ケアマネが出向くのと同じ 40 分 */
export const DISPATCH_ARRIVE_MINUTES = 40;
/** 事業所の職員が戻るまで（分、手配が決まってから）。行って 40 分・いて 40 分・戻って 40 分 */
export const DISPATCH_BACK_MINUTES = 120;

/**
 * 応援（ほかの事業所の職員）が事業所に着いた印の arrivals の person。本人の所へ向かう人ではないので、本人ごとに読む所（本人役・採点・被害状況）は
 * 拾わない。settleWorld が着いた時刻（back）に職員の空きを 1 戻す動きをそのまま使う（WorldChange に職員の増減が無いため。docs/progress/t91.md）
 */
export const BACKUP_PERSON = "";

/** 本人役が出る相手（本人・家族・支援者・民生委員）。ほかの相手（事業所・施設・市役所）は世界が答える */
const PERSON_CALLEES: ReadonlySet<ContactKind> = new Set(["self", "family", "supporter", "welfare_commissioner"]);

/** 職員の空きを減らさない相手（訪問看護は事業所の職員でない） */
const NOT_OUR_STAFF: ReadonlySet<ContactKind> = new Set(["visiting_nurse"]);

/** 今までの 7 つの手（相手の言い方は今のまま。相手なしは calleeText が固定の相手を出す） */
const LEGACY: ReadonlySet<DrillAction> = new Set([
  "call_person",
  "call_contact",
  "visit",
  "dispatch",
  "request_welfare_shelter",
  "report_city",
  "evacuate_self",
]);

/** 返事の状態の言葉（2〜4 字）。T19 の 13 と記録と電話の 3 つ */
export const ACTION_STATUS_LABELS: Readonly<Record<ActionStatus, string>> = { ...WORLD_REPLY_LABELS, ...CALL_STATUS_LABELS };

/** 返事の固定の文 */
export const ACTION_STATUS_TEXTS: Readonly<Record<ActionStatus, string>> = { ...WORLD_REPLY_TEXTS, ...CALL_STATUS_TEXTS };

/**
 * 決まりの表（lib/drill/action-terms.ts、T110）で押せない手。label は押せない理由（2〜4 字。「通行止」「通話不可」）。
 * 画面は押せないようにしているので、ほかの画面の古い表示・二度押しのときだけ（API は 409 と理由）
 */
export class ActionBlocked extends Error {
  // Node の型の取り除き（種の作り・道具）で読めるよう、引数の readonly でなく欄で持つ
  readonly label: string;
  constructor(label: string) {
    super(`押せない手: ${label}`);
    this.name = "ActionBlocked";
    this.label = label;
  }
}

/** 決まりの表を当てる訓練か（T110。開始で選んだ訓練だけ） */
export const termsOn = (s: Pick<DrillState, "options">): boolean => s.options?.terms === true;

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

/**
 * memo はケアマネのメモ（T59、100 字まで）。記録に残すだけで Claude には渡さない。
 * text は自由対応の文（T91、120 字まで）、contacts は自由対応の相手を選ぶ元（その本人の台帳の連絡先。保存の所が作る）
 */
export type ActInput = {
  kind: DrillAction;
  person: string | null;
  target: ActTarget | null;
  memo?: string;
  text?: string;
  contacts?: ReadonlyArray<ActTarget>;
};

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
  /** 電話で伝える様子（左の表に入る聞いた安否。T21）。本人役の言葉がこれと食い違わないように渡す */
  tell?: HeardSignal;
  /** 夜間発災（T59）。本人役に時刻の 1 行を足す */
  night?: boolean;
};

/**
 * 出た人の言う事。pickup が no_answer なら本人役の周りにいない相手（出ない）。called は Claude を呼んだか
 * （失敗も数える。手の所が 1 訓練の数え counts.call に足す。T118）
 */
export type CallHook = (ask: CallAsk) => Promise<{ pickup: CallPickup; speech: string | null; ai: boolean; called?: boolean }>;

/** free は自由対応の読み替え（T91、Opus × 1 回。lib/drill/free-action.ts の createFreeHook） */
export type ActionHooks = StepHooks & { call?: CallHook; free?: FreeHook; visit?: VisitHook };

// ---------- 返事を決める ----------

type Decision = Omit<ActionResult, "ai" | "speech" | "speechAi" | "cleared" | "staff" | "crossed" | "atMinute">;

/** 電話型の手（本人電話・連絡先電話・119勧奨・見守依頼） */
const isCall = (k: DrillAction) => actionRow(k).decide.type === "call";

const hasEffect = (row: ActionRow, kind: ActionEffect["kind"]) => row.effects.some((e) => e.kind === kind);

/** 手の相手の区分（本人電話は本人。ほかは選んだ連絡先、無ければ固定の相手・相手なし） */
function calleeOf(input: Pick<ActInput, "kind" | "target">): ContactKind | null {
  if (input.kind === "call_person") return "self";
  return input.target?.kind ?? null;
}

function fixed(status: ActionStatus, ok: boolean, because: string | null, pickup: CallPickup | null = null): Decision {
  return { ok, status, because, text: ACTION_STATUS_TEXTS[status], pickup };
}

/**
 * 世界の返事を決める（文は固定）。電話は台帳に番号が無ければ「番号なし」。本人・家族・支援者への電話は、
 * 線がつながる（呼出）なら出るかを T18 の割合で決める（出る → 通話、出ない → 応答なし、背景の音だけ → 無言。本人が話せない も無言）。
 * 自由対応は読み替えた手（kind に読み替えた手を渡す）。pickupFactor は決まりの表の電話に出る割合に掛ける数（T110。1 は昼のまま）
 */
export function decideAction(input: ActInput, world: WorldState, hour: number, roll: () => number, pickupFactor = 1): Decision {
  const callee = calleeOf(input);
  if (isCall(input.kind) && (!input.target || !input.target.hasPhone)) return fixed("noNumber", false, null);
  const w = decideWorldReply({ action: input.kind, person: input.person, callee, world, hour }, roll());
  const d = fixed(w.status as WorldReplyStatus, w.ok, w.because);
  if (!isCall(input.kind) || w.status !== "ringing") return d;
  const line = callLine(world, input.person, callee);
  const r = roll();
  let pickup = decideCallPickup(line, r, true);
  // 夜は電話に出にくい（T110 の決まりの表の pickup。出る割合を下げた分は応答なし。roll の数は同じ）
  if (pickup === "answers" && pickupFactor < 1 && r >= CALL_PICKUP_ODDS[line].answers * pickupFactor) pickup = "no_answer";
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

/** 通話の最初の言葉（counts.call）と訪問の本人役（counts.persona）を 1 訓練の数えに足した世界（T118） */
export function countPersonaCalls(world: WorldState, call: number, visit: number): WorldState {
  const c = { ...ZERO_COUNTS, ...(world.counts ?? {}) };
  return { ...world, counts: { ...c, call: c.call + call, persona: c.persona + visit } };
}

export function fixedSpeech(state: PersonState | null, callee: ContactKind | null): string {
  const src = callee ? SOURCE_OF[callee] : undefined;
  if (state?.saying && src && state.source === src) return state.saying;
  return CALL_FIXED_SPEECH;
}

/**
 * ケアマネが通話・訪問で聞いた安否。色と 4 問は本人役の今の様子から決める（Claude は決めない）:
 * 本人役が赤ならその赤と 4 問の答え、それ以外（緑・安否不明・まだ連絡なし）は緑（電話に出て答えた・会えた）といる所。
 * at は聞いた時刻（発災からの時間。手の終わり）
 */
export function heardOf(own: PersonState | null, via: HeardSignal["via"], at: number): HeardSignal {
  const red = own?.color === "red";
  const answer = (v: boolean | null | undefined) => (red ? (v ?? null) : null);
  return {
    via,
    color: red ? "red" : "green",
    whereNow: red ? null : (own?.whereNow ?? null),
    injured: answer(own?.injured),
    atHome: answer(own?.atHome),
    canMove: answer(own?.canMove),
    hasMedicine: answer(own?.hasMedicine),
    at,
  };
}

/**
 * 向かう人が着く時刻（発災からの分）。効き目 arrival の分（手の終わりから）か、応援の staff の afterMin。
 * 幅のある物（見守依頼 30〜60 分・業者連絡 120〜240 分）だけ roll を 1 回使う（今までの 7 つの手の roll の数は変えない）
 */
function arriveAtOf(row: ActionRow, end: number, roll: () => number): number | undefined {
  for (const e of row.effects) {
    if (e.kind === "arrival") {
      if (typeof e.arriveMin === "number") return end + e.arriveMin;
      const [lo, hi] = e.arriveMin;
      return end + Math.min(hi, lo + Math.floor(roll() * (hi - lo + 1)));
    }
    if (e.kind === "staff" && e.afterMin !== undefined) return end + e.afterMin;
  }
  return undefined;
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

/** 見守依頼の向かう人の役（相手の区分から。家族は家族、ほかは支援者） */
const roleOfCallee = (callee: ContactKind | null): ArrivalRole => (callee === "family" ? "family" : "supporter");

/**
 * 手の表の効き目を当てる（返事が ok のとき）。印を消す（cleared）と聞いた安否（heard）は返事に載せて別の所で当て、
 * 届いた物（supply）は向かった人の役から settleWorld が、頼み事（ask_done）は settleAsks が着いた時刻に当てる
 */
function applyEffects(world: WorldState, rec: ActionRecord, result: ActionResult, row: ActionRow): WorldState {
  let w = world;
  const person = rec.person;
  for (const e of row.effects) {
    switch (e.kind) {
      case "staff": {
        if (e.afterMin === undefined) {
          w = { ...w, staff: w.staff + result.staff };
        } else {
          // 応援が着く時刻に職員の空き +1（arrivals の戻りの動きで。本人の所へ向かう人ではない）
          const at = result.arriveAt ?? result.atMinute + e.afterMin;
          const backup: Arrival = { person: BACKUP_PERSON, role: "staff", arrive: at, back: at, arrived: false, from: rec.id };
          w = { ...w, arrivals: [...(w.arrivals ?? []), backup] };
        }
        break;
      }
      case "arrival": {
        if (!person) break;
        const first = typeof e.arriveMin === "number" ? e.arriveMin : e.arriveMin[0];
        const arrive = result.arriveAt ?? result.atMinute + first;
        if (e.legacy) {
          // 訪問依頼（T20）: 今のまま world.dispatched（着いたら印を消し、事業所の職員は戻る時刻に空きを 1 戻す）
          w = {
            ...w,
            dispatched: [
              ...(w.dispatched ?? []),
              {
                person,
                arrive,
                back: result.staff < 0 ? result.atMinute + (e.backMin ?? DISPATCH_BACK_MINUTES) : null,
                arrived: false,
              },
            ],
          };
        } else {
          const role = e.role === "callee" ? roleOfCallee(rec.callee) : e.role;
          const back = e.backMin !== undefined ? result.atMinute + e.backMin : null;
          w = { ...w, arrivals: [...(w.arrivals ?? []), { person, role, arrive, back, arrived: false, from: rec.id }] };
        }
        break;
      }
      case "check": {
        if (!person) break;
        w = { ...w, checks: { ...(w.checks ?? {}), [person]: { ...(w.checks?.[person] ?? {}), [e.depends]: e.status } } };
        break;
      }
      case "advise": {
        if (!person) break;
        w = { ...w, advised: { ...(w.advised ?? {}), [person]: result.atMinute } };
        break;
      }
      default:
        break;
    }
  }
  return w;
}

/**
 * 頼み事（world.asks）を、向かった人が着いた時刻に済ませる（手の表の効き目 ask_done。薬手配 → 薬、電源手配 → 電源・電池、移送手配 → 移送）。
 * 着いた時刻より前に頼まれた物だけ。同じ時刻で何度呼んでも同じ（済ませる物が無ければ同じ世界を返す）。
 * settleWorld（刻みの進め）は頼み事を変えないので、手を打つたびにここで追いつく（済んだ時刻は着いた時刻）
 */
export function settleAsks(world: WorldState, actions: ReadonlyArray<ActionRecord>): WorldState {
  if (!world.asks || !world.arrivals) return world;
  let asks = world.asks;
  let changed = false;
  for (const a of world.arrivals) {
    if (!a.arrived || !a.person) continue;
    const rec = actions.find((x) => x.id === a.from);
    if (!rec) continue;
    const kinds = actionRow(effectiveKind(rec)).effects.flatMap((e) => (e.kind === "ask_done" ? e.asks : []));
    const own = asks[a.person];
    if (kinds.length === 0 || !own?.some((x) => x.done === null && kinds.includes(x.kind) && x.at <= a.arrive)) continue;
    asks = { ...asks, [a.person]: own.map((x) => (x.done === null && kinds.includes(x.kind) && x.at <= a.arrive ? { ...x, done: a.arrive } : x)) };
    changed = true;
  }
  return changed ? { ...world, asks } : world;
}

/**
 * 返事を当てる（手を打った要求でも、保存した物からの作り直しでも同じ所を通る）。
 * 消えた印を消し、返事が ok なら手の表の効き目を当て、時計を返事の時刻まで進める
 */
export function applyResult(state: DrillState, id: string, result: ActionResult): DrillState {
  const i = state.actions.findIndex((a) => a.id === id);
  if (i < 0) return state;
  const rec = state.actions[i];
  let world = state.world;
  if (rec.person && result.cleared.length > 0) world = clearMarks(world, rec.person, result.cleared).world;
  if (result.ok) world = applyEffects(world, rec, result, actionRow(effectiveKind(rec)));
  // T93: 往復と訪問の頼み事を積み、時計は往復の終わりまで（作り直しでも同じ）
  world = withResultAsks(world, rec.person, result);
  const minute = Math.max(state.minute, result.atMinute, talkEnd(result));
  const actions = [...state.actions];
  actions[i] = { ...rec, result };
  world = settleAsks(settleWorld(world, minute), actions);
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
 * roll は 0 以上 1 未満（Math.random など。テストで固定）。extra は手の前の左の表（保存の所が画面と同じ道で作る）。
 * 自由対応は先に表の手に読み替え（hooks.free。伏せきれない文は PseudonymLeakError を投げて手を打たない）、読み替えた手として打つ
 */
export async function act(
  state: DrillState,
  raw: ActInput,
  hooks: ActionHooks = {},
  roll: () => number = Math.random,
  extra: Pick<ActionBefore, "triage" | "ranking"> = {},
): Promise<ActOutcome> {
  if (state.status !== "running") throw new DrillEnded();
  // 自由対応の確かめ（T110）は打つ前だけの物。手を打ったあとの状態には残さない
  const { draft, ...clean } = state;
  let start: DrillState = clean;
  let input = raw;
  let free: FreePlan | null = null;
  if (raw.kind === "free") {
    const text = freeText(raw.text ?? "");
    // 読み替えの口（POST /api/drill/[id]/free）が置いた確かめが同じ文・本人・時刻・手の数なら、それを使う（Claude をもう 1 回呼ばない。数え済み）
    const fresh = draft && draft.text === text && draft.person === raw.person && draft.minute === state.minute && draft.actions === state.actions.length;
    free = fresh
      ? draft.plan
      : await planFree(
          { ...clean, participants: state.participants },
          { text, person: raw.person, contacts: raw.contacts ?? [] },
          hooks.free,
        );
    if (free.called && !fresh) start = { ...start, world: countFree(start.world) };
    if (free.block) throw new ActionBlocked(free.block);
    const as = free.as ?? "free";
    input = { ...raw, kind: as, person: as === "evacuate_self" ? null : raw.person, target: free.target };
  }
  const own = free !== null && free.as === null ? free : null;
  const kind = input.kind;
  const row = actionRow(kind);
  const callee = own ? own.callee : calleeOf(input);
  // 時間と状況で変わる手（T110）: 決まりを選んだ訓練は、押せない手を断り、所要に足し分を足す（無ければ表の分のまま）
  const term = own
    ? null
    : actionTerm(kind, termFactsOf(start, input.person), { on: termsOn(start) });
  if (term) {
    const block = blockOf(term, kind === "call_person" ? "self" : (input.target?.kind ?? (row.fixed ? "fixed" : null)));
    if (block) throw new ActionBlocked(block);
  }
  const minutes = own ? own.minutes : term!.minutes;
  const adds = own ? own.adds : term!.adds;
  const atMinute = start.minute;
  const endMinute = atMinute + minutes;
  const fixedLabel = !input.target && !LEGACY.has(kind) && row.fixed ? FIXED_CALLEE_LABELS[row.fixed] : null;
  const record: ActionRecord = {
    // 取り消した手の番号は使い直さない（T59。声の R2 の鍵 act-<番号> と drill_events の id が前の手と重ならない）
    id: `a${start.actions.length + 1 + (start.undone ?? 0)}`,
    kind: raw.kind,
    person: input.person,
    target: input.target?.id ?? null,
    callee,
    calleeLabel: own ? own.calleeLabel : (input.target?.label ?? fixedLabel),
    at: atMinute / 60,
    atMinute,
    endMinute,
    minutes,
    step: start.step,
    before: beforeOf(start, input.person, extra),
    result: null,
    ...(raw.memo ? { memo: raw.memo } : {}),
    ...(free
      ? {
          ...(free.as ? { as: free.as } : {}),
          text: free.stored,
          ...(free.reason ? { reason: free.reason } : {}),
          ...(own?.way ? { way: own.way } : {}),
          ...(own?.words ? { words: own.words } : {}),
          judge: free.judge,
        }
      : {}),
    ...(adds.length > 0 ? { adds: [...adds] } : {}),
  };

  // 手の途中で次の刻みの時刻を越えたら、その刻みを進める。返事はその刻みの表の出来事のあとの世界で決め、監督に言い換えを頼む
  let s = pushAction(start, record);
  const hours = scenarioOf(s.scenario).hours;
  const ticks: Tick[] = [];
  const held: { decided: Decision | null } = { decided: null };
  // そのままの手（T110）は世界の返事を確率で決めない。起きたこと（AI）か固定の文で「実施」。世界は変えない
  const pickupFactor = term?.pickup ?? 1;
  const decide = (world: WorldState, hour: number): Decision =>
    own ? { ...fixed("done", true, null), text: own.outcome ?? ACTION_STATUS_TEXTS.done } : decideAction(input, world, hour, roll, pickupFactor);
  let words: ReplyWords[] = [];
  let incidents: ReadonlyArray<DrillIncident> = [];
  // 連続の時計の訓練（T90）: 手は区切りを起こさない。手の分の (始め, 終わり] に入る表の出来事と予定の出来事を AI を呼ばずに当て
  // （当てる物があるときだけ区切りを 1 つ残す）、返事は進めたあとの世界で決める。言い換えは頼まない（監督の呼び出しを手で増やさない）
  if (isClock(s)) {
    const r = await advance(s, Math.min(endMinute, DRILL_END_MINUTE), hooks, { policy: "silent" });
    if (r) {
      s = r.state;
      ticks.push(r.tick);
      incidents = r.tick.incidents;
    }
  }
  while (!isClock(s) && s.status === "running" && s.step < hours.length - 1 && hours[s.step + 1] * 60 <= endMinute) {
    const at = hours[s.step + 1];
    const r = await step(s, hooks, {
      replies: (world): ReplyAsk[] => {
        const x = decide(world, at);
        held.decided = x;
        // 自由対応で Claude の 1 文があれば、監督に言い換えを頼まない
        if (!wordable(x) || free?.words || own) return [];
        return [{ id: record.id, action: kind, person: input.person, callee, status: x.status, because: x.because, text: x.text }];
      },
    });
    s = r.state;
    ticks.push(r.tick);
    words = r.words;
    incidents = r.tick.incidents;
  }
  const d: Decision = held.decided ?? decide(settleWorld(s.world, endMinute), endMinute / 60);

  // 出たら言う事（本人役。鍵が無い・失敗は固定の言葉）
  let speech: string | null = null;
  let speechAi = false;
  let status = d.status;
  let ok = d.ok;
  let text = d.text;
  let pickup = d.pickup;
  let heard: HeardSignal | null = null;
  let callReply: Awaited<ReturnType<CallHook>> | null = null;
  if (d.status === "connected" && input.person && input.target && PERSON_CALLEES.has(input.target.kind)) {
    const own = s.people[input.person] ?? null;
    const tell = heardOf(own, "call", endMinute / 60);
    const reply = hooks.call
      ? await hooks
          .call({
            person: input.person,
            target: input.target,
            pickup: "answers",
            hour: endMinute / 60,
            world: s.world,
            incidents,
            state: own,
            tell,
            ...(s.options?.night === true ? { night: true } : {}),
          })
          .catch(() => null)
      : null;
    callReply = reply;
    // 結末の人（仮想モード、T50）は電話に出ない（鍵が無く本人役のいないときも）
    if (reply?.pickup === "no_answer" || s.world.ended?.[input.person] !== undefined) {
      status = "noAnswer";
      ok = false;
      text = ACTION_STATUS_TEXTS.noAnswer;
      pickup = "no_answer";
    } else {
      speech = reply?.speech ?? fixedSpeech(own, input.target.kind);
      speechAi = reply?.speech != null && reply.ai;
      // 出て答えた → 聞いた安否（左の表の色・順位を動かす）。表の効き目に heard のある手（本人電話・連絡先電話）だけ
      if (hasEffect(row, "heard")) heard = tell;
    }
  }
  // 訪問で着いた → 確認済（本人に会えた）
  if (row.decide.type === "visit" && status === "arrived" && input.person && s.world.ended?.[input.person] === undefined) {
    heard = heardOf(s.people[input.person] ?? null, "visit", endMinute / 60);
  }
  // T93: 着いたら本人役が見て分かる様子と頼み事（Haiku × 1 回）。聞いた安否・色は変えない。頼み事は applyResult が積む
  const seen = heard?.via === "visit" && hooks.visit ? input.person : null;
  const seenReply = seen ? await hooks.visit!({ person: seen, hour: endMinute / 60, world: s.world, incidents, state: s.people[seen] ?? null, ...(isNight(s) ? { night: true } : {}) }).catch(() => null) : null;
  const visit = seenReply?.report ?? null;
  // T118: 通話の最初の言葉と訪問の本人役も 1 訓練の数え（T90 の 150）に入れる（往復は talk.ts、自由文は countFree）
  if (callReply?.called || seenReply?.called) s = { ...s, world: countPersonaCalls(s.world, callReply?.called ? 1 : 0, seenReply?.called ? 1 : 0) };

  const reworded = words.find((w) => w.id === record.id)?.text.trim() ?? "";
  // 表の手に読み替えた自由対応は Claude の現場の言い方。そのままの手は起きたこと（AI）が返事の文
  const said = own ? (own.outcome?.trim() ?? "") : (free?.words?.trim() ?? "");
  const clears = ok && hasEffect(row, "clearMarks") && input.person;
  const keys = row.effects.flatMap((e) => (e.kind === "clearMarks" ? e.keys : []));
  const arriveAt = ok ? arriveAtOf(row, endMinute, roll) : undefined;
  const result: ActionResult = {
    ok,
    status,
    because: d.because,
    // 自由対応は Claude の現場の言い方（AI の印）、無ければ監督の言い換えか固定の文
    text: said || reworded || text,
    ai: said !== "" || reworded !== "",
    speech,
    speechAi,
    pickup,
    cleared: clears ? clearMarks(s.world, input.person!, keys).cleared : [],
    staff: row.staff > 0 && ok && !(callee && NOT_OUR_STAFF.has(callee)) ? -row.staff : 0,
    crossed: ticks.map((t) => t.step),
    atMinute: endMinute,
    heard,
    ...(arriveAt !== undefined ? { arriveAt } : {}),
    ...(visit ? { visit } : {}),
  };
  s = applyResult(s, record.id, result);
  return { state: s, record: s.actions.find((a) => a.id === record.id)!, ticks };
}
