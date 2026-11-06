// 連続の時計（docs/tasks/T90.md）。進め方（30 分・1 時間・3 時間・次の出来事まで）と、AI の呼び出しを数で決める所の定数と純な計算。
// Claude を呼ばない。D1 も読まない（画面の束に入る。サーバーの物は型だけ読む）。色と順位はここで決めない（lib/triage だけ）。
//
// - 進めるのは大雨想定・地震想定・仮想の新しい訓練だけ（DrillOptions.clock）。10 分版と前からある訓練は刻みの道のまま（engine の step）
// - 本人役はその区切りで理由のある人だけ（1 区切り 6 人まで）、監督は表の出来事のある区切り・前の監督から 3 時間・「次まで」のどれか
// - 1 訓練の AI の呼び出しは 2 段の上限（120 で巡回と 3 時間ごとの監督を止め、150 で AI を呼ばない）。講評と 1 日の上限は別

import type { DrillAction, DrillScenario } from "../db/types.ts";
import { actionRow, isCatalogAction } from "./action-catalog.ts";
import type { PersonaReason } from "./persona-types.ts";
import { eventHour, scenarioOf, type DrillCounts, type WorldState } from "./scenarios.ts";

/** 訓練の終わり（発災からの分） */
export const DRILL_END_MINUTE = 72 * 60;

/** 進め方の分（30 分・1 時間・3 時間） */
export const CLOCK_STEPS = [30, 60, 180] as const;
export type ClockStep = (typeof CLOCK_STEPS)[number];

export const isClockStep = (v: unknown): v is ClockStep => typeof v === "number" && (CLOCK_STEPS as readonly number[]).includes(v);

/**
 * 進め方の行き先。分だけ進めるか、次の出来事までか、手の分（T110: 時計は進めず、手に使った時間を AI も動かして閉じる）
 */
export type ClockTo = { minutes: ClockStep } | { next: true } | { acts: true };

/** 画面の言葉（lib/drill/labels.ts は触らない） */
export const CLOCK_LABELS = {
  m30: "30 分",
  h1: "1 時間",
  h3: "3 時間",
  next: "次まで",
  /** 手の分（T110）。手に使った時間を、AI も動かして閉じる */
  acts: "手の分",
  /** 1 訓練の AI の上限に達した（帯の理由） */
  cap: "訓練上限",
  /** 1 訓練の AI の残り回数（操作の横の数） */
  left: "AI 残",
  /** 次まで・自動進行で進んだ分（操作の横。T162） */
  moved: "進行",
} as const;

/** 進んだ分の言い方（「6 分」「3 時間」「1 時間 30 分」）。経過の言い方（lib/drill/time-text.ts）と同じ字 */
export function movedText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} 分`;
  return r === 0 ? `${h} 時間` : `${h} 時間 ${r} 分`;
}

/** 分の進め方の言葉 */
export const CLOCK_STEP_LABELS: Readonly<Record<ClockStep, string>> = { 30: CLOCK_LABELS.m30, 60: CLOCK_LABELS.h1, 180: CLOCK_LABELS.h3 };

/** 監督を呼ぶ間（前の監督からこの分を過ぎた区切りで呼ぶ） */
export const DIRECTOR_GAP_MINUTES = 180;
/** 1 訓練の監督（仮想は世界）の回数の上限 */
export const DIRECTOR_DRILL_MAX = 20;
/** 1 区切りに呼ぶ本人役の上限（Workers の 1 要求の外向きの接続は 6 本。lib/claude/models.ts の注） */
export const PERSONA_PER_CUT = 6;
/** 理由の無いまま、この分たった人を巡回で呼ぶ */
export const ROUND_MINUTES = 720;
/** 1 区切りに巡回で呼ぶ人の上限 */
export const ROUND_PER_CUT = 3;
/** 1 訓練の AI の呼び出しの 1 段目の上限。達したら巡回を止め、監督は表の出来事のある区切りだけ */
export const DRILL_CALL_SOFT = 120;
/** 1 訓練の AI の呼び出しの上限。達したら AI を呼ばない（固定の筋は想定のみ、仮想は世界停止） */
export const DRILL_CALL_CAP = 150;
/** 上限の帯の印（状況 ai_stop の reason。画面に出さない） */
export const CAP_REASON = "cap";

/** 本人役の理由の強さの順（多ければこの順で呼び、残りは次の進めへ） */
export const REASON_ORDER: ReadonlyArray<PersonaReason> = ["table", "action", "incident", "clock", "round"];

export const ZERO_COUNTS: DrillCounts = { director: 0, persona: 0, call: 0, free: 0 };

/** この訓練の AI の呼び出しの合計（監督・世界・本人役・通話の相手・自由に書く手） */
export function totalCalls(c: Partial<DrillCounts> | null | undefined): number {
  if (!c) return 0;
  return (c.director ?? 0) + (c.persona ?? 0) + (c.call ?? 0) + (c.free ?? 0);
}

/** 上限（150）までの残り（0 以上） */
export function callsLeft(c: Partial<DrillCounts> | null | undefined): number {
  return Math.max(0, DRILL_CALL_CAP - totalCalls(c));
}

/** 上限（150）に達したか。達した訓練は AI を呼ばない（通話の相手・自由に書く手も同じ数で見る） */
export function capReached(c: Partial<DrillCounts> | null | undefined): boolean {
  return totalCalls(c) >= DRILL_CALL_CAP;
}

/** 1 段目（120）に達したか */
export function softReached(c: Partial<DrillCounts> | null | undefined): boolean {
  return totalCalls(c) >= DRILL_CALL_SOFT;
}

/** この区切りで差し込んでよい数（区切りの時間を 3 時間で割った物、1 以上 3 以下） */
export function budgetOf(fromMinute: number, toMinute: number): number {
  return Math.min(3, Math.max(1, Math.floor((toMinute - Math.max(0, fromMinute)) / DIRECTOR_GAP_MINUTES)));
}

// ---------- 時計の半分と切れ（本人役を呼ぶ理由 clock・次の出来事） ----------

/**
 * 走っている時計の半分・切れの時刻（発災からの分）。down は機器が止まったままの人を呼ぶ時刻（T174）で、本人役を呼ぶ理由だけ。
 * 「次まで」の行き先にはしない（区切りを増やすと、区切りごとの手と呼び出しが増える。区切りは長くても 3 時間なので次の区切りで拾える）
 */
export type ClockMark = { person: string; at: number; kind: "half" | "out" | "down" };

/** 時計の走り方（lib/drill/score.ts の clockRuns）から半分と切れの時刻 */
export function clockMarksOf(runs: ReadonlyArray<{ person: string; startMinute: number; outMinute: number }>): ClockMark[] {
  return runs.flatMap((r) => [
    { person: r.person, at: r.startMinute + (r.outMinute - r.startMinute) / 2, kind: "half" as const },
    { person: r.person, at: r.outMinute, kind: "out" as const },
  ]);
}

/** 区切り (since, to] で時計が半分か切れを越えた人（重なりなし、並びは時刻の順） */
export function crossedClocks(marks: ReadonlyArray<ClockMark>, since: number, to: number): string[] {
  const out: string[] = [];
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    if (m.at > since && m.at <= to && !out.includes(m.person)) out.push(m.person);
  }
  return out;
}

// ---------- 次の出来事まで ----------

/** 想定の表の出来事と本人の行の時刻（発災からの分、昇順、重なりなし）。仮想は表が無いので空 */
export function tableMinutes(scenario: DrillScenario): number[] {
  const set = new Set<number>();
  for (const t of scenarioOf(scenario).ticks) {
    for (const e of t.events) set.add(Math.round(eventHour(e, t.hour) * 60));
    for (const r of t.turns) set.add(Math.round(eventHour(r, t.hour) * 60));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 「次まで」の行き先（発災からの分）。次の表の出来事・行、予定の出来事、向かっている人の到着、時計の半分・切れ、今から 3 時間、の一番早い物。
 * 今より後の物だけ。72 時間で止める
 */
export function nextEventMinute(
  state: { scenario: DrillScenario; minute: number; world: Pick<WorldState, "scheduled" | "arrivals" | "dispatched"> },
  marks: ReadonlyArray<ClockMark> = [],
): number {
  const now = state.minute;
  const after = (m: number) => m > now;
  const candidates = [
    now + DIRECTOR_GAP_MINUTES,
    ...tableMinutes(state.scenario).filter(after),
    ...(state.world.scheduled ?? []).map((s) => s.at).filter(after),
    ...(state.world.arrivals ?? []).filter((a) => !a.arrived).map((a) => a.arrive).filter(after),
    ...(state.world.dispatched ?? []).filter((d) => !d.arrived).map((d) => d.arrive).filter(after),
    ...marks.filter((m) => m.kind !== "down").map((m) => m.at).filter(after),
  ];
  return Math.min(DRILL_END_MINUTE, Math.ceil(Math.min(...candidates)));
}

// ---------- 本人役の呼び出しを減らす決め（T121） ----------
// 評価の 1 回目で、10 人・72 時間の訓練 1 回が 1 訓練の上限の 89% を使った。大半は本人役で、その半分ほどは「連絡しない」の返事。
// 呼ぶ理由のうち、本人に届かない手（行政報告・記録）・本人がもう話した手（電話に出て話した・訪問で会った）の返事と、
// 短い区切り（30 分）の急がない理由（状況・時計・巡回）が多かった。上限の値は上げず、使う数を減らす。

/** 短い区切りで急がない理由（状況・時計・巡回）を次の区切りへまとめる分。この分たつまで持ち越す */
export const GATHER_MINUTES = 60;

/** 急がない理由（表の行・手の返事のほか） */
export const QUIET_REASONS: ReadonlyArray<PersonaReason> = ["incident", "clock", "round"];

/** 手の返事の形のうち、本人役の理由を決めるのに読む所 */
export type ReasonAction = {
  kind: DrillAction;
  as?: DrillAction | null;
  result: { status: string; speechAi?: boolean; talk?: ReadonlyArray<unknown>; visit?: unknown } | null;
};

/**
 * 手の返事が本人役を呼ぶ理由になるか。手の表（action-catalog.ts）の届き方（reach）が手の終わりに本人に届く手で、届いた結果だけ。
 * 着いたら届く手（訪問依頼・手配）は到着（arrivals・dispatched）の時刻で呼ぶので、ここでは呼ばない。
 * 電話に出て AI が話した・訪問で AI が様子を返した手は、本人がもう話したので呼ばない（119 の勧めは、かけるかを次に言うので呼ぶ）
 */
export function actionReaches(a: ReasonAction): boolean {
  const r = a.result;
  if (!r) return false;
  const kind = a.kind === "free" ? a.as : a.kind;
  if (!kind || !isCatalogAction(kind)) return false;
  const row = actionRow(kind);
  if (!row.towardPerson || !row.reach || row.reach.at !== "end" || !row.reach.statuses.includes(r.status as never)) return false;
  if (kind === "advise_119") return true;
  const spoke = r.speechAi === true || (Array.isArray(r.talk) && r.talk.length > 0) || r.visit !== undefined;
  return !spoke;
}

/** この人の身の回りが since（発災からの分）より後に変わったか（世界の変わった時刻・印・到着・届いた物・頼み事）。巡回の門 */
export function changedSince(world: WorldState, person: string, since: number): boolean {
  const after = (h: number | undefined) => typeof h === "number" && h * 60 > since;
  const s = world.stamps ?? {};
  if (after(s.phone) || after(s.outage) || after(s.water) || after(s.weather)) return true;
  if (world.roads.some((r) => (!r.person || r.person === person) && after(s[`road:${r.id}`]))) return true;
  if (world.facilities.some((f) => (!f.person || f.person === person) && after(s[`facility:${f.id}`]))) return true;
  if (world.shelters.some((x) => after(s[`shelter:${x.id}`]))) return true;
  if (Object.values(world.marks[person] ?? {}).some((h) => after(h))) return true;
  if ((world.arrivals ?? []).some((a) => a.person === person && a.arrive > since)) return true;
  if (Object.values(world.supplies?.[person] ?? {}).some((m) => typeof m === "number" && m > since)) return true;
  if ((world.asks?.[person] ?? []).some((a) => a.at > since || (a.done !== null && a.done > since))) return true;
  return false;
}

/** 身の回りが何も変わらない人を巡回で呼ぶまでの分（変わった人は ROUND_MINUTES） */
export const ROUND_QUIET_MINUTES = 1440;

/** 本人役をまとめて呼ぶとき（T121）の 1 回の人数。1 区切り PERSONA_PER_CUT 人を多くて 2 回に */
export const PERSONA_BATCH_MAX = 4;

/** 並びを n 個ずつに分ける */
export function chunks<T>(xs: ReadonlyArray<T>, n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
