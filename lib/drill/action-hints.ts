// 打てる手の候補（docs/tasks/T126.md）。分かった事・頼み事・本人の時計 → 手の候補の表は、このファイルの 1 か所。
// 対応の欄（components/drill/ActionPanel）の手の段の上と、本人の詳細（components/drill/DrillRowDetail）に同じ物を出す。
// 手 1 つの押せる・押せないの見え方（押せない手は薄く、理由の 2〜4 字）も、対応の欄の手のボタンと候補が同じ所（actAvail）を読む。
//
// 線:
// - 色と連絡順（lib/triage）には使わない。候補は手の名前の並びだけで、何をすべきとは言わない（医療の助言をしない）。選ぶのはケアマネ
// - 候補の並びは手の表（lib/drill/action-catalog.ts）の順。急ぐ順に並べ替えない（並べ替えは表の判断になる）。押せる物を先、押せない物をあと
// - 手の可否と所要は決まりの表（lib/drill/action-terms.ts、T110・T125）の結果（ActionTerm の minutes・block・targets）を読むだけ。
//   理由の言葉（「通話不可」など）の中身は見ない。電話の手が全部押せないかは、結果の決め方が電話型の手が全部押せないかで見る
// - 元にする事実は、ケアマネに分かっている物だけ（未対応の頼み事・走っている時計・公表の事実〔透析施設の休止・訪問看護が来られない〕。
//   lib/drill/timeline.ts の INCIDENT_REACH の公表の線）
//
// D1・Claude を読まない純な計算。ブラウザの束に入る（型のほかは action-catalog・action-table・dialogue・labels だけ）。

import type { CheckStatus, ClockCategory, ContactKind, DependsOn, DrillAction } from "../db/types.ts";
import { ACTION_CATALOG, actionRow, actionsOfGroup, type ActionEffect, type ActionGroup } from "./action-catalog.ts";
import { needsPerson, needsTarget, picksTarget } from "./action-table.ts";
import type { ActionTerm, TermCallee } from "./action-terms.ts";
import { ASK_LABELS } from "./dialogue.ts";
import { ACTION_UI } from "./labels.ts";
import type { StateTone } from "../person.ts";
import type { Ask, AskKind, WorldState } from "./scenarios.ts";

// ---------- 言葉（2〜4 字） ----------

export const HINT_LABELS = {
  /** 候補の見出し（押し付けない短い印） */
  head: "候補",
  /** 電話の手が全部押せない時の別の道 */
  alt: "代替",
  /** 向かっている人がいる・届いた・確認済の手 */
  done: "手配済",
  /** 相手の連絡先が台帳に無い手 */
  noTarget: ACTION_UI.noTarget,
  /** 公表の事実 */
  dialysisClosed: "透析休止",
  nurseAway: "看護不在",
} as const;

// ---------- 対応の欄に出す手 ----------

/**
 * 対応の欄の手の一覧と候補に出さない手。記録（note）は、打った手・着信・分かった事が経過と訓練記録の紙面に自動で残るので要らない。
 * 手の表の行・型・保存の形（結果の記録済 noted）は、前の訓練の再生と紙面のために残す（API は今までどおり受ける）
 */
export const PANEL_HIDDEN: ReadonlyArray<DrillAction> = ["note"];

/** 対応の欄の区分の段に並べる手（手の表の順から出さない手を除いた物） */
export function panelActionsOf(group: ActionGroup): DrillAction[] {
  return actionsOfGroup(group)
    .map((r) => r.id)
    .filter((k) => !PANEL_HIDDEN.includes(k));
}

// ---------- 誰の時間か（訪問と訪問依頼の違い） ----------

/** 手に時間を使う人（2 字） */
export const ACTOR_LABELS = { self: "自分", staff: "職員" } as const;
export type Actor = keyof typeof ACTOR_LABELS;

/**
 * 手の時間の言い方の部分。自分が出る訪問はその間ケアマネの手が止まる（「自分 40 分」）。事業所の職員に行ってもらう手（表の staff が 1）は、
 * 自分の時間は電話の分だけで、職員が向かう（「自分 10 分 職員 40 分」。職員の分は表の効き目の着くまでの分）。ほかの手は分だけ（who が null）
 */
export function timeParts(kind: DrillAction, minutes: number): Array<{ who: Actor | null; minutes: number }> {
  const row = actionRow(kind);
  if (row.staff > 0) {
    const go = row.effects.find((e): e is Extract<ActionEffect, { kind: "arrival" }> => e.kind === "arrival" && e.role === "staff");
    const at = go ? (typeof go.arriveMin === "number" ? go.arriveMin : go.arriveMin[0]) : null;
    return [{ who: "self", minutes }, ...(at !== null ? [{ who: "staff" as const, minutes: at }] : [])];
  }
  if (row.decide.type === "visit") return [{ who: "self", minutes }];
  return [{ who: null, minutes }];
}

// ---------- 手 1 つの見え方（対応の欄の手のボタンと候補が同じ所を読む） ----------

/**
 * 手 1 つの状態。ok 押せる・wait 本人を選べば押せる（押せない手と分けて今の見た目）・done 手配済（押せる）・block 押せない（理由つき）
 */
export type ActState = "ok" | "wait" | "done" | "block";
export type ActAvail = { state: ActState; why: string | null };

/** 手の見え方を決める元。term は決まりの表の結果（決まりを選ばなかった訓練は null）、contacts はその本人の連絡先の区分 */
export type AvailContext = {
  person: string | null;
  term: ActionTerm | null;
  contacts: ReadonlyArray<{ kind: ContactKind }>;
};

/** 相手に選べる連絡先の区分（表の targetKinds の中で、その本人の台帳にある物） */
function targetKeys(kind: DrillAction, contacts: AvailContext["contacts"]): TermCallee[] {
  const row = actionRow(kind);
  return [...(row.fixed ? (["fixed"] as TermCallee[]) : []), ...contacts.filter((c) => row.targetKinds.includes(c.kind)).map((c) => c.kind)];
}

/**
 * 手 1 つの押せる・押せない（理由つき）。押せない理由の順: 相手の連絡先が台帳に無い（この訓練の間は変わらない）→ 決まりの表の手全体の理由 →
 * 選べる相手が全部押せない（相手ごとの理由の先頭）
 */
export function actAvail(kind: DrillAction, ctx: AvailContext): ActAvail {
  if (needsPerson(kind) && !ctx.person) return { state: "wait", why: null };
  if (ctx.person && needsTarget(kind) && !ctx.contacts.some((c) => actionRow(kind).targetKinds.includes(c.kind))) {
    return { state: "block", why: HINT_LABELS.noTarget };
  }
  const t = ctx.term;
  if (!t) return { state: "ok", why: null };
  if (t.block) return { state: "block", why: t.block };
  if (ctx.person && picksTarget(kind)) {
    const keys = targetKeys(kind, ctx.contacts);
    if (keys.length > 0 && keys.every((k) => t.targets[k])) return { state: "block", why: t.targets[keys[0]] ?? null };
  }
  return { state: "ok", why: null };
}

const RANK: Readonly<Record<ActState, number>> = { ok: 0, wait: 0, done: 1, block: 2 };

/** 押せる物を先、手配済、押せない物をあとに（同じ状態の中は元の並び＝手の表の順） */
export function usableFirst<T extends { state: ActState }>(items: ReadonlyArray<T>): T[] {
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => RANK[a.x.state] - RANK[b.x.state] || a.i - b.i)
    .map(({ x }) => x);
}

// ---------- 候補の表（1 か所） ----------

const CATALOG_ORDER: ReadonlyMap<DrillAction, number> = new Map(ACTION_CATALOG.map((r, i) => [r.id, i]));
const byCatalog = (a: DrillAction, b: DrillAction) => (CATALOG_ORDER.get(a) ?? 0) - (CATALOG_ORDER.get(b) ?? 0);

/** 手の表の効き目から引く: 頼み事を済ませる手（ask_done） */
function catalogAskActions(ask: AskKind): DrillAction[] {
  return ACTION_CATALOG.filter((r) => r.effects.some((e) => e.kind === "ask_done" && e.asks.includes(ask))).map((r) => r.id);
}

/** 手の表の効き目から引く: 時計の頼り先を確認済にする手（check） */
function catalogCheckActions(depends: DependsOn): DrillAction[] {
  return ACTION_CATALOG.filter((r) => r.effects.some((e) => e.kind === "check" && e.depends === depends && e.status === "confirmed")).map((r) => r.id);
}

/**
 * 頼み事 → 手のうち、手の表の効き目（ask_done）に無い物（足す分だけ）。電源・電池は業者連絡（機器の業者の予備の電池）、
 * 家族は連絡先電話、水・食事・保温は近所や家族に見に行ってもらうか福祉避難所、便所は見に行ってもらうか訪問
 */
export const ASK_EXTRA: Readonly<Record<AskKind, ReadonlyArray<DrillAction>>> = {
  medicine: [],
  water: ["ask_check", "request_welfare_shelter"],
  food: ["ask_check", "request_welfare_shelter"],
  power: ["call_vendor"],
  transport: ["request_welfare_shelter"],
  family_contact: ["call_contact"],
  battery: ["call_vendor"],
  toilet: ["ask_check", "visit"],
  warmth: ["ask_check", "request_welfare_shelter"],
};

/** 頼み事 → 手の候補（手の表の効き目から引いた物と足す分。手の表の順） */
export function askActions(ask: AskKind): DrillAction[] {
  return [...new Set([...catalogAskActions(ask), ...ASK_EXTRA[ask]])].sort(byCatalog);
}

/**
 * 時計の区分 → 手の候補（走っている時計）。機器（酸素・呼吸器・吸引）は 119勧奨・病院受入・電源手配・業者連絡、透析は透析調整・病院受入、
 * 薬と栄養は薬手配。本人の状態（認知症）とその他は無し
 */
export const CLOCK_HINTS: Readonly<Partial<Record<ClockCategory, ReadonlyArray<DrillAction>>>> = {
  ventilator: ["advise_119", "request_hospital", "arrange_power", "call_vendor"],
  suction: ["advise_119", "request_hospital", "arrange_power", "call_vendor"],
  oxygen: ["advise_119", "request_hospital", "arrange_power", "call_vendor"],
  dialysis: ["arrange_dialysis", "request_hospital"],
  insulin: ["arrange_medicine"],
  tube_feeding: ["arrange_medicine"],
  antiplatelet: ["arrange_medicine"],
  anticoagulant: ["arrange_medicine"],
  steroid: ["arrange_medicine"],
  antiepileptic: ["arrange_medicine"],
};

/** 公表の事実 → 手の候補 */
export const FACT_HINTS = {
  /** その人の透析施設の休止 */
  dialysisClosed: ["arrange_dialysis", "request_hospital"],
  /** 訪問看護が来られない（事業所の職員に行ってもらう・自分で行く） */
  nurseAway: ["visit", "dispatch"],
} as const satisfies Readonly<Record<string, ReadonlyArray<DrillAction>>>;
export type FactHint = keyof typeof FACT_HINTS;

/** 電話の手が全部押せない時の別の道（訪問・職員に行ってもらう・近所や家族に見に行ってもらう・自由対応） */
export const ALT_ACTIONS: ReadonlyArray<DrillAction> = ["visit", "dispatch", "ask_check", "free"];

/**
 * 結果の決め方が電話型で、本人の要る手のうち代替に入らない物（本人電話・連絡先電話・119勧奨）。これが全部押せない時に代替を出す。
 * 見守依頼は代替の側（近所の人へは歩いて頼める。押せるかは決まりの表の結果のまま）なので数えない
 */
export const PHONE_ACTIONS: ReadonlyArray<DrillAction> = ACTION_CATALOG.filter(
  (r) => r.decide.type === "call" && r.needsPerson && !ALT_ACTIONS.includes(r.id),
).map((r) => r.id);

// ---------- 候補を組む ----------

/** 候補の元に渡す時計（走っているか・残りの時間〔超えたら負〕は呼ぶ側が lib/triage の clockRemaining で数えた物） */
export type HintClock = {
  id: string;
  category: ClockCategory;
  label: string;
  running: boolean;
  /** 残り（時間）。超えたら負 */
  left: number | null;
  /** 残りの言葉（行の詳細と同じ「残り 1 時間」「超過 30 分」）と色。無ければ null */
  remaining: string | null;
  tone: StateTone | null;
  depends_on: DependsOn | null;
  depends_check: CheckStatus | null;
};

export type HintInput = {
  person: string;
  /** その人の頼み事（済んだ物は落とす） */
  asks: ReadonlyArray<Ask>;
  clocks: ReadonlyArray<HintClock>;
  world: Pick<WorldState, "facilities" | "marks" | "arrivals" | "supplies" | "checks">;
  /** 決まりの表の結果（その本人）。決まりを選ばなかった訓練は null（相手の連絡先の有無だけで見る） */
  terms: Readonly<Partial<Record<DrillAction, ActionTerm>>> | null;
  contacts: ReadonlyArray<{ kind: ContactKind }>;
  /** 訓練の終わりまでの時間（時間）。この中に切れる時計だけ候補にする */
  hoursLeft: number;
};

/** 候補の元 1 つ。ask 頼み事・fact 公表の事実・clock 時計 */
export type HintSource =
  | { from: "ask"; ask: AskKind; label: string }
  | { from: "fact"; fact: FactHint; label: string }
  | { from: "clock"; clock: string; label: string; remaining: string | null; tone: StateTone | null };

export type HintAct = { kind: DrillAction; state: Exclude<ActState, "wait">; why: string | null; minutes: number };
export type HintGroup = { sources: HintSource[]; actions: HintAct[] };
/** 本人ごとの候補。alt は電話の手が全部押せない時の代替（それ以外は null） */
export type ActionHints = { groups: HintGroup[]; alt: HintAct[] | null };

/** 向かっている人がいる・届いた・確認済で、手配済とする手か（世界の写しから。手の表の効き目で引く） */
function arranged(kind: DrillAction, person: string, w: HintInput["world"]): boolean {
  return actionRow(kind).effects.some((e: ActionEffect) => {
    if (e.kind === "arrival" && !e.legacy) {
      const roles = e.role === "callee" ? ["family", "supporter"] : [e.role];
      return (w.arrivals ?? []).some((a) => a.person === person && !a.arrived && roles.includes(a.role));
    }
    if (e.kind === "supply") return w.supplies?.[person]?.[e.supply] !== undefined;
    if (e.kind === "check") return w.checks?.[person]?.[e.depends] === "confirmed";
    return false;
  });
}

function hintAct(kind: DrillAction, input: HintInput, withDone: boolean): HintAct {
  const term = input.terms?.[kind] ?? null;
  const a = actAvail(kind, { person: input.person, term, contacts: input.contacts });
  const minutes = term?.minutes ?? actionRow(kind).minutes;
  if (withDone && arranged(kind, input.person, input.world)) return { kind, state: "done", why: HINT_LABELS.done, minutes };
  return { kind, state: a.state === "block" ? "block" : "ok", why: a.why, minutes };
}

/** 電話の手（本人電話・連絡先電話・119勧奨）が全部押せないか。相手の連絡先が無いだけの手は数えない */
export function phoneOut(input: Pick<HintInput, "person" | "terms" | "contacts">): boolean {
  if (!input.terms) return false;
  const judged = PHONE_ACTIONS.flatMap((k) => {
    const a = actAvail(k, { person: input.person, term: input.terms?.[k] ?? null, contacts: input.contacts });
    return a.why === HINT_LABELS.noTarget ? [] : [a.state === "block"];
  });
  return judged.length > 0 && judged.every(Boolean);
}

/** 走っていて、訓練の終わりまでに切れる時計か（超えた時計を含む） */
const endsInDrill = (k: HintClock, hoursLeft: number) => k.running && k.left !== null && k.left <= hoursLeft;

/**
 * 本人 1 人の候補。元ごとに手の候補を引き、同じ手の並びになる元を 1 行にまとめる（頼み事 → 公表の事実 → 時計の順）。
 * 1 行の中は手の表の順で、押せる物を先、手配済、押せない物をあと。何も無ければ null
 */
export function hintsOf(input: HintInput): ActionHints | null {
  const raw: Array<{ source: HintSource; kinds: DrillAction[] }> = [];
  // 頼み事（未対応だけ、同じ種類は 1 つ）
  for (const ask of [...new Set(input.asks.filter((a) => a.done === null).map((a) => a.kind))]) {
    raw.push({ source: { from: "ask", ask, label: ASK_LABELS[ask] }, kinds: askActions(ask) });
  }
  // 公表の事実
  const w = input.world;
  if (w.facilities.some((f) => f.person === input.person && !f.open && f.depends === "dialysis_center")) {
    raw.push({ source: { from: "fact", fact: "dialysisClosed", label: HINT_LABELS.dialysisClosed }, kinds: [...FACT_HINTS.dialysisClosed] });
  }
  if (w.marks[input.person]?.nurseAway !== undefined) {
    raw.push({ source: { from: "fact", fact: "nurseAway", label: HINT_LABELS.nurseAway }, kinds: [...FACT_HINTS.nurseAway] });
  }
  // 時計（訓練の中で切れる物と、表の入力の頼り先が未確認の物）
  for (const k of input.clocks) {
    const kinds = [
      ...(endsInDrill(k, input.hoursLeft) ? (CLOCK_HINTS[k.category] ?? []) : []),
      ...(k.depends_on && k.depends_check === "unconfirmed" ? catalogCheckActions(k.depends_on) : []),
    ];
    if (kinds.length === 0) continue;
    raw.push({ source: { from: "clock", clock: k.id, label: k.label, remaining: k.remaining, tone: k.tone }, kinds: [...new Set(kinds)] });
  }

  // 同じ手の並びの元をまとめる（最初に出た元の位置に）
  const merged = new Map<string, { sources: HintSource[]; kinds: DrillAction[] }>();
  for (const r of raw) {
    const kinds = [...new Set(r.kinds)].filter((k) => !PANEL_HIDDEN.includes(k)).sort(byCatalog);
    if (kinds.length === 0) continue;
    const key = kinds.join(",");
    const g = merged.get(key);
    if (g) g.sources.push(r.source);
    else merged.set(key, { sources: [r.source], kinds });
  }
  const groups: HintGroup[] = [...merged.values()].map((g) => ({
    sources: g.sources,
    actions: usableFirst(g.kinds.map((kind) => hintAct(kind, input, true))),
  }));
  const alt = phoneOut(input) ? usableFirst(ALT_ACTIONS.map((kind) => hintAct(kind, input, false))) : null;
  if (groups.length === 0 && !alt) return null;
  return { groups, alt };
}
