// 訓練の採点の機械で数える所（docs/tasks/T22.md・T94.md、docs/SPEC.md「訓練」「評価」）。Claude を呼ばない。D1 を使わない。
// 数字は 4 つ: 対応の順番の一致、市役所への報告の遅れ、様式 9 の空欄、条件に達した人。言葉（講評）は lib/drill/review.ts（Opus 1 回）。
// 入力は手の履歴（ActionRecord）・着信と応答・時計・様式 9 の行で、訓練でも本番の発災後でも同じ形で渡せる（手の履歴を作れば）。
//
// 決め（docs/progress/t22.md の「決めた所」。作者の確認待ち）:
// - 順番: 本人に向けた手（手の表の towardPerson）だけを数える。手を打った順に、その人への最初の手が
//   「その時の左の表（手の前の状態の before.ranking）で、まだ手を打っていない人の一番上」なら一致。手の無かった人は未対応で一致しない。
//   赤の着信を拒否した人は一致にしない。分母は参加者の全員（「7/10」）
// - 報告の遅れ: 市役所への報告（行政報告）が届いた最初の時刻（発災からの時間）。期限は SPEC にも登録簿にも無いので作らない。
//   届かなければ未報告（訓練の終わりまで）
// - 様式 9 の空欄: 平時の様式 9（lib/forms/form9 の buildForm9、色なし）の参加者の行で、計画に要る欄（FORM9_PLAN_COLUMNS）の空き。
//   避難場所は避難所・介護医療機関のどちらかがあれば埋まっている。安否確認できた日・色・結果・手直しは発災時に埋まる欄なので数えない
// - 条件に達した人: 走り出した時計（ルールの表と同じ時計。停電の時計は本人が停電の地区にいるときだけ）が訓練の終わりまでに切れ、
//   切れる時刻までにその人へ届いた手が 1 つも無かった人。停電の前の手も数える（早めの連絡と避難を
//   よしとする。lib/sources の nanbyo-tsuiho-2022）。1 人 1 行（最初に切れた時計）。
//   「死亡」とは書かない。「条件に達した」まで
//
// T94（手の表 v2 と分の時計）: 「その人への手」と「届いた」は手の表（lib/drill/action-catalog.ts）の旗から読む。
// - その人への手は towardPerson の手（18 のうち 13）。自由対応は読み替えた手（as）で数える。記録・退避・行政報告・応援依頼は数えない
// - 届いたは表の reach（数える結果と、手の終わりか向かった人の着いた時刻か）。着く時刻は返事の arriveAt、無ければ世界の arrivals、
//   無ければ表の分（訪問依頼の 40 分は表の値で、前の決め打ちと同じ）
// - 内訳に足す数（4 つの大きな数字は増やさない。docs/DECISIONS.md の T94 の案）: 空振り（打った時に分かっていた事実で結果の決まっていた手）・
//   重複（同じ人に同じ手を、新しい事が無いまま 30 分以内に 2 回）・頼み事の未対応・通話の往復（T93 の欄。入る前の記録には無く 0）

import type { PlanScore } from "./person-facts.ts";
import type { ClockRow, ContactKind, DependsOn, DrillAction } from "../db/types.ts";
import { inOutageArea } from "../disaster/state.ts";
import type { Form9Row } from "../forms/form9.ts";
import { clockHours } from "../triage/index.ts";
import { ACTION_CATALOG, actionRow, effectiveKind, isCatalogAction, isOwnFree, type ActionRow } from "./action-catalog.ts";
import type { ActionRecord } from "./engine.ts";
import type { PersonState } from "./persona-types.ts";
import type { CallRecord } from "./responses.ts";
import { ASK_KINDS, type Arrival, type Ask, type AskKind, type Dispatched, type Facility, type PhoneState } from "./scenarios.ts";

// ---------- 手の表の旗 ----------

/** 手の働きの行（自由対応は読み替えた手。読み替えの無い自由対応と表に無い手は null） */
export function rowOf(a: Pick<ActionRecord, "kind" | "as">): ActionRow | null {
  const k = effectiveKind(a);
  return isCatalogAction(k) && k !== "free" ? actionRow(k) : null;
}

/** 本人に向けた手（順番と条件で、その人への手に数える物）。手の表の towardPerson */
export const PERSON_ACTIONS: ReadonlyArray<DrillAction> = ACTION_CATALOG.filter((r) => r.towardPerson).map((r) => r.id);

/**
 * その人への手か（自由対応は読み替えた手で）。自由対応のそのままの手（T110）は、本人を選び、電話か訪問のやり方の物を数える
 * （順番の一致に入る。世界を変えないので「届いた」には数えない）
 */
export const isPersonAction = (
  a: Pick<ActionRecord, "kind" | "person" | "as"> & Partial<Pick<ActionRecord, "way">>,
): a is Pick<ActionRecord, "kind" | "as"> & { person: string } =>
  a.person !== null && (rowOf(a)?.towardPerson === true || (isOwnFree(a) && a.way !== "desk"));

// ---------- 順番 ----------

/** 本人ごとの最初の手の判定 */
export type OrderTurn = {
  /** 手の番号（a1…） */
  action: string;
  /** 手の働き（自由対応は読み替えた手） */
  kind: DrillAction;
  person: string;
  /** 打った時刻（発災からの分） */
  atMinute: number;
  /** その時の左の表の、まだ手を打っていない人の一番上。並びが残っていなければ null */
  expected: string | null;
  /** その時の左の表の順位（1 から）。無ければ null */
  rank: number | null;
  expectedRank: number | null;
  /** 一致（並びが残っていなければ null で、一致に数えない） */
  match: boolean | null;
};

/** 一致しなかった人の理由。late は先に別の人へ手、missing は手なし、declined は赤の着信を拒否、unknown は並びが残っていない */
export type OrderMissKind = "late" | "missing" | "declined" | "unknown";

export type OrderMiss = {
  person: string;
  why: OrderMissKind[];
  /** late のとき、その時の一番上の人 */
  expected?: string | null;
  /** declined のとき、拒否した着信の時刻（分） */
  declinedAt?: number[];
};

export type OrderScore = {
  matched: number;
  total: number;
  turns: OrderTurn[];
  misses: OrderMiss[];
};

/** 対応の順番の一致（上の決め）。participants の並びは表示の順に使う */
export function scoreOrder(
  participants: ReadonlyArray<string>,
  actions: ReadonlyArray<ActionRecord>,
  calls: ReadonlyArray<Pick<CallRecord, "person" | "color" | "response" | "minute">>,
): OrderScore {
  const members = new Set(participants);
  const done = new Set<string>();
  const turns: OrderTurn[] = [];
  for (const a of actions) {
    if (!isPersonAction(a) || !members.has(a.person) || done.has(a.person)) continue;
    const ranking = Array.isArray(a.before.ranking) ? a.before.ranking.filter((p) => members.has(p)) : null;
    const expected = ranking ? (ranking.find((p) => !done.has(p)) ?? null) : null;
    const rankOf = (p: string | null) => (ranking && p !== null && ranking.includes(p) ? ranking.indexOf(p) + 1 : null);
    turns.push({
      action: a.id,
      kind: effectiveKind(a),
      person: a.person,
      atMinute: a.atMinute,
      expected,
      rank: a.before.triage?.rank ?? rankOf(a.person),
      expectedRank: rankOf(expected),
      match: ranking ? expected === a.person : null,
    });
    done.add(a.person);
  }
  const declined = new Map<string, number[]>();
  for (const c of calls) {
    if (c.color !== "red" || c.response !== "decline" || !members.has(c.person)) continue;
    declined.set(c.person, [...(declined.get(c.person) ?? []), c.minute]);
  }
  const misses: OrderMiss[] = [];
  let matched = 0;
  for (const p of participants) {
    const t = turns.find((x) => x.person === p);
    const why: OrderMissKind[] = [];
    if (!t) why.push("missing");
    else if (t.match === false) why.push("late");
    else if (t.match === null) why.push("unknown");
    if (declined.has(p)) why.push("declined");
    if (why.length === 0) {
      matched += 1;
      continue;
    }
    misses.push({
      person: p,
      why,
      ...(t && t.match === false ? { expected: t.expected } : {}),
      ...(declined.has(p) ? { declinedAt: declined.get(p) } : {}),
    });
  }
  return { matched, total: participants.length, turns, misses };
}

// ---------- 報告 ----------

export type ReportScore = {
  /** 市役所に報告が届いた最初の時刻（発災からの分）。届かなければ null（未報告） */
  minute: number | null;
  /** 行政報告の手の数（届かなかった物を含む） */
  tries: number;
};

/** 市役所への報告の遅れ（発災から最初に届いた報告まで）。自由対応の読み替えも行政報告に数える */
export function scoreReport(actions: ReadonlyArray<ActionRecord>): ReportScore {
  const reports = actions.filter((a) => effectiveKind(a) === "report_city");
  const hit = reports.find((a) => a.result?.ok === true);
  return { minute: hit ? hit.result!.atMinute : null, tries: reports.length };
}

// ---------- 様式 9 の空欄 ----------

/** 数える欄。place は避難場所（避難所か介護・医療機関のどちらか） */
export const FORM9_PLAN_COLUMNS = ["area", "address", "place", "careManager", "emergency1", "means"] as const;
export type Form9PlanColumn = (typeof FORM9_PLAN_COLUMNS)[number];

export type Form9Blanks = {
  blanks: number;
  rows: Array<{ person: string; columns: Form9PlanColumn[] }>;
};

const empty = (v: string | undefined) => !v || v.trim() === "";

/** 様式 9（平時）の行の計画に要る欄の空き。参加者の行だけ */
export function scoreForm9(rows: ReadonlyArray<Pick<Form9Row, "id" | "cells">>, participants: ReadonlyArray<string>): Form9Blanks {
  const members = new Set(participants);
  const out: Form9Blanks["rows"] = [];
  for (const r of rows) {
    if (!members.has(r.id)) continue;
    const c = r.cells;
    const columns = FORM9_PLAN_COLUMNS.filter((k) => (k === "place" ? empty(c.shelter) && empty(c.facility) : empty(c[k])));
    if (columns.length > 0) out.push({ person: r.id, columns });
  }
  return { blanks: out.reduce((n, r) => n + r.columns.length, 0), rows: out };
}

// ---------- 条件に達した人 ----------

/** 時計 1 つの走り方（発災からの分）。呼ぶ側が台帳の時計と訓練の世界（停電の始まり・地区、頼り先の写し）から作る */
export type ClockRun = {
  person: string;
  label: string;
  /** 時計の長さ（時間） */
  hours: number;
  /** 走り出した時刻（分） */
  startMinute: number;
  /** 切れる時刻（分） */
  outMinute: number;
  /** 頼り先が未確認（透析先・冷蔵・配達） */
  unchecked: DependsOn[];
};

/** 時計の行（台帳の時計に訓練の世界の頼り先の写しを当てた物。lib/drill/director.ts の drillClocks） */
export type ClockForRun = Pick<ClockRow, "person_id" | "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check">;

/**
 * 時計の走り方を作る。ルールの表（lib/triage の clockStates）と同じ読み方: 本人の状態（starts_on none）と値の無い時計は走らない、
 * 発災の時計は 0 分から、停電の時計は停電の始まりから（本人の町名が停電の地区のときだけ。lib/disaster/state.ts の inOutageArea）
 */
export function clockRuns(
  clocks: ReadonlyArray<ClockForRun>,
  towns: ReadonlyMap<string, string | null>,
  outage: { since: number; towns: ReadonlyArray<string> | null; townSince?: Readonly<Record<string, number>> } | null,
): ClockRun[] {
  const out: ClockRun[] = [];
  for (const k of clocks) {
    if (k.starts_on === "none") continue;
    const hours = clockHours(k);
    if (hours === null) continue;
    let start: number;
    if (k.starts_on === "disaster") start = 0;
    else if (outage && inOutageArea(outage.towns, towns.get(k.person_id))) {
      // 町ごとの停電の始まり（仮想モード、T50）があればその時刻から
      const town = towns.get(k.person_id)?.trim();
      start = ((town ? outage.townSince?.[town] : undefined) ?? outage.since) * 60;
    }
    else continue;
    out.push({
      person: k.person_id,
      label: k.label,
      hours,
      startMinute: start,
      outMinute: start + hours * 60,
      unchecked: k.depends_on && k.depends_check === "unconfirmed" ? [k.depends_on] : [],
    });
  }
  return out;
}

export type Reached = ClockRun & {
  /** 切れる時刻までにその人へ打った手（届かなかった物）の数 */
  tries: number;
};

/** 向かった人の着いた時刻を引く所（世界の arrivals の from。手の番号 → 着く時刻、発災からの分） */
export type ArriveIndex = ReadonlyMap<string, number>;

/** 世界の arrivals から、手の番号ごとの着く時刻 */
export function arriveIndex(arrivals: ReadonlyArray<Pick<Arrival, "from" | "arrive">> | undefined): ArriveIndex {
  const out = new Map<string, number>();
  for (const a of arrivals ?? []) if (a.from && !out.has(a.from)) out.set(a.from, a.arrive);
  return out;
}

/** 手の表の向かう人の分（手の終わりから）。幅のある物は短い方（手の所の applyEffects と同じ） */
function tableArriveMinutes(row: ActionRow): number | null {
  for (const e of row.effects) {
    if (e.kind === "arrival") return typeof e.arriveMin === "number" ? e.arriveMin : e.arriveMin[0];
  }
  return null;
}

/**
 * その人へ届いた手の時刻（分）。手の表の reach: 数える結果だけ、時刻は手の終わりか向かった人の着いた時刻
 * （返事の arriveAt → 世界の arrivals → 表の分）。届いていなければ null
 */
export function reachedAt(a: ActionRecord, arrive: ArriveIndex = new Map()): number | null {
  if (!isPersonAction(a) || a.result?.ok !== true) return null;
  const reach = rowOf(a)?.reach;
  if (!reach || !reach.statuses.includes(a.result.status)) return null;
  if (reach.at === "end") return a.result.atMinute;
  const fromTable = tableArriveMinutes(rowOf(a)!);
  return a.result.arriveAt ?? arrive.get(a.id) ?? a.result.atMinute + (fromTable ?? 0);
}

/** 条件に達した人（上の決め）。endMinute は訓練の終わり（ケアマネの時計）。1 人 1 行、最初に切れた時計 */
export function scoreReached(
  runs: ReadonlyArray<ClockRun>,
  actions: ReadonlyArray<ActionRecord>,
  endMinute: number,
  arrive: ArriveIndex = new Map(),
): Reached[] {
  const out: Reached[] = [];
  const sorted = [...runs].sort((a, b) => a.outMinute - b.outMinute || a.label.localeCompare(b.label, "ja"));
  for (const run of sorted) {
    if (run.outMinute >= endMinute || out.some((r) => r.person === run.person)) continue;
    const own = actions.filter((a) => a.person === run.person);
    const inWindow = (m: number) => m <= run.outMinute;
    if (own.some((a) => { const m = reachedAt(a, arrive); return m !== null && inWindow(m); })) continue;
    const tries = own.filter((a) => isPersonAction(a) && inWindow(a.atMinute)).length;
    out.push({ ...run, tries });
  }
  return out;
}

// ---------- 着信 ----------

export type CallScore = { total: number; answered: number; declined: number; open: number; redDeclined: number };

export function scoreCalls(calls: ReadonlyArray<Pick<CallRecord, "color" | "response">>): CallScore {
  const out: CallScore = { total: calls.length, answered: 0, declined: 0, open: 0, redDeclined: 0 };
  for (const c of calls) {
    if (c.response === "answer") out.answered += 1;
    else if (c.response === "decline") {
      out.declined += 1;
      if (c.color === "red") out.redDeclined += 1;
    } else out.open += 1;
  }
  return out;
}

// ---------- 手を打った時に分かっていた事実（T94） ----------

/** 刻みのあとの世界の写し（手を打った時の世界の電話と施設の休止。lib/drill/record.ts が DrillScreen の ticks から渡す） */
export type TickWorld = { step: number; world: { phone: PhoneState; facilities: ReadonlyArray<Pick<Facility, "person" | "open" | "depends">> } };

/**
 * 手を打った時に分かっていた事実。手の前の状態（before）と、手を打った刻みのあとの世界（状況の欄に出た電話と施設の休止）から。
 * 空振りの決め（wasteOf）と、講評・紙面の「事実」の言葉が同じ物を読む
 */
export type Known = {
  /** 本人の家の電話（家の電話の不通の印を含む） */
  homeLine: PhoneState;
  /** 世界の電話（本人の家のほかへかける線）。分からなければ null（家の電話の不通の印があり、刻みの世界も無いとき） */
  line: PhoneState | null;
  roadClosed: boolean;
  /** 職員の空き */
  staff: number;
  /** 訪問看護が来られない印 */
  nurseAway: boolean;
  /** 本人の頼り先の休止した施設 */
  closed: DependsOn[];
  /** 本人の最後の連絡（本人役の今の様子）。無ければ null */
  person: PersonState | null;
};

export function knownOf(a: Pick<ActionRecord, "person" | "step" | "before">, ticks?: ReadonlyArray<TickWorld>): Known {
  const b = a.before;
  const tick = ticks?.find((t) => t.step === a.step);
  const homeDown = b.marks.lineDown !== undefined;
  const closed: DependsOn[] = [];
  for (const f of tick?.world.facilities ?? []) {
    if (a.person && f.person === a.person && !f.open && f.depends && !closed.includes(f.depends)) closed.push(f.depends);
  }
  return {
    homeLine: b.phone,
    line: tick ? tick.world.phone : homeDown ? null : b.phone,
    roadClosed: b.roadClosed,
    staff: b.staff,
    nurseAway: b.marks.nurseAway !== undefined,
    closed,
    person: b.person,
  };
}

/** 同じ人への前の手（どの手でも）からの分。前の手が無い・全体への手は null */
export function gapBefore(actions: ReadonlyArray<Pick<ActionRecord, "id" | "person" | "atMinute">>, a: Pick<ActionRecord, "id" | "person" | "atMinute">): number | null {
  if (!a.person) return null;
  let prev: number | null = null;
  for (const x of actions) {
    if (x.id === a.id) break;
    if (x.person === a.person && x.atMinute <= a.atMinute) prev = x.atMinute;
  }
  return prev === null ? null : a.atMinute - prev;
}

/** 空振りの理由: phone 電話の線が不通・road 家の前の道が通行止・staff 職員の空き 0・closed 頼り先の施設が休止・nurse 訪問看護が来られない */
export const WASTE_WHYS = ["phone", "road", "staff", "closed", "nurse"] as const;
export type WasteWhy = (typeof WASTE_WHYS)[number];

/**
 * 空振りか。打った時に分かっていた事実で結果が決まっていた手（世界の返事 lib/drill/world-reply.ts の、確率の前に事実で決まる道と同じ順）。
 * 結果が届かなかった手だけ（手の途中で事実が変わって届いた手は空振りにしない）。記録・退避は無い
 */
export function wasteOf(a: ActionRecord, k: Known): WasteWhy | null {
  if (!a.result || a.result.ok) return null;
  const row = rowOf(a);
  if (!row) return null;
  const kind = row.id;
  const callee: ContactKind | null = kind === "call_person" ? "self" : a.callee;
  switch (row.decide.type) {
    case "call": {
      const line = callee === "self" || callee === null ? k.homeLine : k.line;
      if (line === "down") return "phone";
      if (callee === "dialysis_center" && k.closed.includes("dialysis_center")) return "closed";
      return null;
    }
    case "visit":
      return k.roadClosed ? "road" : null;
    case "dispatch":
      if (callee === "visiting_nurse" && k.nurseAway) return "nurse";
      if (callee !== "visiting_nurse" && k.staff <= 0) return "staff";
      if (k.roadClosed) return "road";
      return k.line === "down" ? "phone" : null;
    case "arrange": {
      const by = row.decide.closedBy;
      if (by && callee === by && k.closed.includes(by)) return "closed";
      if (k.line === "down") return "phone";
      return k.roadClosed && row.effects.some((e) => e.kind === "arrival") ? "road" : null;
    }
    case "accept":
    case "report":
      return k.line === "down" ? "phone" : null;
    case "record":
      return null;
  }
}

/** 空振りの手 1 つ */
export type WasteRow = { action: string; kind: DrillAction; person: string | null; atMinute: number; why: WasteWhy };
export type WasteScore = { total: number; rows: WasteRow[] };

export function scoreWasted(actions: ReadonlyArray<ActionRecord>, ticks?: ReadonlyArray<TickWorld>): WasteScore {
  const rows: WasteRow[] = [];
  for (const a of actions) {
    const why = wasteOf(a, knownOf(a, ticks));
    if (why) rows.push({ action: a.id, kind: effectiveKind(a), person: a.person, atMinute: a.atMinute, why });
  }
  return { total: rows.length, rows };
}

// ---------- 重複 ----------

/** 重複に数える間（分）。同じ人に同じ手を、この分の内にもう一度 */
export const REPEAT_MINUTES = 30;

/** 2 回目の手 1 つ。first は前の同じ手、gap は前の手からの分 */
export type RepeatRow = { action: string; first: string; kind: DrillAction; person: string; atMinute: number; gap: number };
export type RepeatScore = { total: number; rows: RepeatRow[] };

/** 重複の「新しい事」を引く物: 着信（その人の連絡）・状況（その人の物。at は発災からの時間）・向かった人の到着 */
export type RepeatSources = {
  calls: ReadonlyArray<Pick<CallRecord, "person" | "minute">>;
  incidents?: ReadonlyArray<{ at: number; person?: string | null }>;
  arrivals?: ReadonlyArray<Pick<Arrival, "person" | "arrive">>;
  dispatched?: ReadonlyArray<Pick<Dispatched, "person" | "arrive">>;
};

/**
 * 重複: 同じ人に同じ手（自由対応は読み替えた手）を、前の同じ手から 30 分以内に打ち、その間（前の手を打った時刻より後、
 * この手を打った時刻まで）にその人の連絡・状況・到着が 1 つも無かった手。3 回続けば 2 つ
 */
export function scoreRepeat(actions: ReadonlyArray<ActionRecord>, src: RepeatSources): RepeatScore {
  const rows: RepeatRow[] = [];
  const last = new Map<string, ActionRecord>();
  const news = (person: string, from: number, to: number) => {
    const inside = (m: number) => m > from && m <= to;
    return (
      src.calls.some((c) => c.person === person && inside(c.minute)) ||
      (src.incidents ?? []).some((e) => e.person === person && inside(Math.round(e.at * 60))) ||
      (src.arrivals ?? []).some((x) => x.person === person && inside(x.arrive)) ||
      (src.dispatched ?? []).some((x) => x.person === person && inside(x.arrive))
    );
  };
  const sorted = actions.map((a, i) => ({ a, i })).sort((x, y) => x.a.atMinute - y.a.atMinute || x.i - y.i);
  for (const { a } of sorted) {
    if (!a.person || !rowOf(a)) continue;
    const kind = effectiveKind(a);
    const key = `${a.person}\u0000${kind}`;
    const prev = last.get(key);
    last.set(key, a);
    if (!prev) continue;
    const gap = a.atMinute - prev.atMinute;
    if (gap > REPEAT_MINUTES || news(a.person, prev.atMinute, a.atMinute)) continue;
    rows.push({ action: a.id, first: prev.id, kind, person: a.person, atMinute: a.atMinute, gap });
  }
  return { total: rows.length, rows };
}

// ---------- 頼み事 ----------

/** 頼み事の未対応: 訓練の終わりまでに頼まれ、終わりまでに済まなかった物。人ごとの種類（頼まれた順） */
export type AskScore = { open: number; total: number; rows: Array<{ person: string; kinds: AskKind[] }> };

export function scoreAsks(asks: Readonly<Record<string, ReadonlyArray<Ask>>> | undefined, participants: ReadonlyArray<string>, endMinute: number): AskScore {
  let open = 0;
  let total = 0;
  const rows: AskScore["rows"] = [];
  for (const p of participants) {
    const own = (asks?.[p] ?? []).filter((x) => (ASK_KINDS as readonly string[]).includes(x.kind) && x.at <= endMinute);
    total += own.length;
    const left = own.filter((x) => x.done === null || x.done > endMinute);
    open += left.length;
    const kinds = [...new Set(left.map((x) => x.kind))];
    if (kinds.length > 0) rows.push({ person: p, kinds });
  }
  return { open, total, rows };
}

// ---------- T93 の欄（通話の往復・訪問の様子。T93 が入る前の記録には無い） ----------

/** 通話の往復の 1 行（T93 の result.talk の読む所だけ。cm はケアマネ、them は相手） */
export type TalkRead = { who: "cm" | "them"; minute: number | null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 手の返事の通話の往復（T93）。無ければ空 */
export function talkOf(a: Pick<ActionRecord, "result">): TalkRead[] {
  const talk = a.result && isObj(a.result) ? (a.result as { talk?: unknown }).talk : undefined;
  if (!Array.isArray(talk)) return [];
  return talk.flatMap((x): TalkRead[] =>
    isObj(x) && (x.who === "cm" || x.who === "them") ? [{ who: x.who, minute: typeof x.minute === "number" ? x.minute : null }] : [],
  );
}

/** 往復の数（ケアマネの言葉の数） */
export const talkTurns = (a: Pick<ActionRecord, "result">): number => talkOf(a).filter((x) => x.who === "cm").length;

/** 訪問の様子と頼み事（T93 の result.visit の読む所だけ。condition は AI の 1 行） */
export type VisitRead = { condition: string | null; asks: AskKind[]; ai: boolean };

export function visitOf(a: Pick<ActionRecord, "result">): VisitRead | null {
  const v = a.result && isObj(a.result) ? (a.result as { visit?: unknown }).visit : undefined;
  if (!isObj(v)) return null;
  const asks = Array.isArray(v.asks) ? v.asks.filter((k): k is AskKind => (ASK_KINDS as readonly unknown[]).includes(k)) : [];
  const condition = typeof v.condition === "string" && v.condition.trim() ? v.condition.trim() : null;
  if (!condition && asks.length === 0) return null;
  return { condition, asks: [...new Set(asks)], ai: v.ai !== false };
}

/** 通話の往復の数（往復の合計と、往復のあった通話の数） */
export type TalkScore = { turns: number; calls: number };

export function scoreTalks(actions: ReadonlyArray<ActionRecord>): TalkScore {
  let turns = 0;
  let calls = 0;
  for (const a of actions) {
    const n = talkTurns(a);
    if (n > 0) {
      turns += n;
      calls += 1;
    }
  }
  return { turns, calls };
}

// ---------- まとめ ----------

export type ScoreInput = {
  participants: ReadonlyArray<string>;
  actions: ReadonlyArray<ActionRecord>;
  calls: ReadonlyArray<CallRecord>;
  runs: ReadonlyArray<ClockRun>;
  form9: ReadonlyArray<Pick<Form9Row, "id" | "cells">>;
  /** 訓練の終わり（ケアマネの時計、発災からの分） */
  endMinute: number;
  /** 仮想モードの結末（世界が決めた。T53）。固定の筋は渡さない */
  ended?: ReadonlyArray<EndedScore>;
  /** 計画で動けた人と、計画が無く手が要った人（T130。台帳を読むので record.ts が数えて渡す） */
  plans?: PlanScore;
  /** 刻みのあとの世界の写し（手を打った時の電話・施設の休止。T94 の空振り）。無ければ手の前の状態だけで決める */
  ticks?: ReadonlyArray<TickWorld>;
  /** 状況（重複の「新しい事」。at は発災からの時間） */
  incidents?: ReadonlyArray<{ at: number; person?: string | null }>;
  /** 訓練の終わりの世界（向かった人の到着・頼み事） */
  world?: { arrivals?: ReadonlyArray<Arrival>; dispatched?: ReadonlyArray<Dispatched>; asks?: Readonly<Record<string, ReadonlyArray<Ask>>> };
};

/**
 * 仮想モード（T53）の結末 1 人。世界（AI）が決めた筋書きで、時計の計算の「条件に達した人」（reached）とは別に数える。
 * at は結末の刻みの時刻（発災からの時間）、text は画面の 1 文、reason は世界の事実（AI。無ければ null）
 */
export type EndedScore = { person: string; at: number; text: string; reason: string | null };

/** 内訳に足す数（T94）。4 つの大きな数字には入れない */
export type ScoreExtras = { wasted: WasteScore; repeat: RepeatScore; asks: AskScore; talks: TalkScore };

export type DrillScore = {
  v: 1;
  /** 参加者（表示の順） */
  participants: string[];
  endMinute: number;
  order: OrderScore;
  report: ReportScore;
  form9: Form9Blanks;
  reached: Reached[];
  calls: CallScore;
  /** 仮想モードの結末（AI の筋書き）。固定の筋と T53 より前の記録には無い */
  ended?: EndedScore[];
  /**
   * 計画で動けた人と、計画が無く手が要った人（T130、lib/drill/person-facts.ts の scorePlans）。講評の入力と訓練の記録に残す（画面は読まない）。
   * T130 より前の記録には無い
   */
  plans?: PlanScore;
} & Partial<ScoreExtras>;

/** 内訳に足す数（空振り・重複・頼み事の未対応・通話の往復）。様式 9 と台帳を読まないので、前の記録でも訓練の記録だけから数え直せる */
export function scoreExtras(input: Omit<ScoreInput, "runs" | "form9" | "ended" | "plans">): ScoreExtras {
  return {
    wasted: scoreWasted(input.actions, input.ticks),
    repeat: scoreRepeat(input.actions, {
      calls: input.calls,
      incidents: input.incidents,
      arrivals: input.world?.arrivals,
      dispatched: input.world?.dispatched,
    }),
    asks: scoreAsks(input.world?.asks, input.participants, input.endMinute),
    talks: scoreTalks(input.actions),
  };
}

export function scoreDrill(input: ScoreInput): DrillScore {
  return {
    v: 1,
    participants: [...input.participants],
    endMinute: input.endMinute,
    order: scoreOrder(input.participants, input.actions, input.calls),
    report: scoreReport(input.actions),
    form9: scoreForm9(input.form9, input.participants),
    reached: scoreReached(input.runs, input.actions, input.endMinute, arriveIndex(input.world?.arrivals)),
    calls: scoreCalls(input.calls),
    ...(input.ended ? { ended: [...input.ended] } : {}),
    ...(input.plans ? { plans: input.plans } : {}),
    ...scoreExtras(input),
  };
}

/** 内訳の数（無い記録は 0。T94 より前に残した採点） */
export function extrasCount(s: Partial<ScoreExtras>): { wasted: number; repeat: number; asksOpen: number; talks: number } {
  return {
    wasted: s.wasted?.total ?? 0,
    repeat: s.repeat?.total ?? 0,
    asksOpen: s.asks?.open ?? 0,
    talks: s.talks?.turns ?? 0,
  };
}

/** 数字 4 つ（画面の大きな数・前回との比較・紙面の表） */
export type ScoreNumbers = {
  /** 順番の一致（一致した人・参加者） */
  order: { matched: number; total: number };
  /** 報告の遅れ（分）。未報告は null */
  report: number | null;
  form9: number;
  reached: number;
  /** 仮想モードの結末（AI の筋書き）の人数。固定の筋は無い */
  ended?: number;
};

export function scoreNumbers(s: Pick<DrillScore, "order" | "report" | "form9" | "reached" | "ended">): ScoreNumbers {
  return {
    order: { matched: s.order.matched, total: s.order.total },
    report: s.report.minute,
    form9: s.form9.blanks,
    reached: s.reached.length,
    ...(s.ended ? { ended: s.ended.length } : {}),
  };
}
