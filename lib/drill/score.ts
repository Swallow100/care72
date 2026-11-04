// 訓練の採点の機械で数える所（docs/tasks/T22.md、docs/SPEC.md「訓練」「評価」）。Claude を呼ばない。D1 を使わない。
// 数字は 4 つ: 対応の順番の一致、市役所への報告の遅れ、様式 9 の空欄、条件に達した人。言葉（講評）は lib/drill/review.ts（Opus 1 回）。
// 入力は手の履歴（ActionRecord）・着信と応答・時計・様式 9 の行で、訓練でも本番の発災後でも同じ形で渡せる（手の履歴を作れば）。
//
// 決め（docs/progress/t22.md の「決めた所」。作者の確認待ち）:
// - 順番: 本人に向けた手（本人電話・連絡先電話・訪問・訪問依頼・受入依頼）だけを数える。手を打った順に、その人への最初の手が
//   「その時の左の表（手の前の状態の before.ranking）で、まだ手を打っていない人の一番上」なら一致。手の無かった人は未対応で一致しない。
//   赤の着信を拒否した人は一致にしない。分母は参加者の全員（「7/10」）
// - 報告の遅れ: 市役所への報告（行政報告）が届いた最初の時刻（発災からの時間）。期限は SPEC にも登録簿にも無いので作らない。
//   届かなければ未報告（訓練の終わりまで）
// - 様式 9 の空欄: 平時の様式 9（lib/forms/form9 の buildForm9、色なし）の参加者の行で、計画に要る欄（FORM9_PLAN_COLUMNS）の空き。
//   避難場所は避難所・介護医療機関のどちらかがあれば埋まっている。安否確認できた日・色・結果・手直しは発災時に埋まる欄なので数えない
// - 条件に達した人: 走り出した時計（ルールの表と同じ時計。停電の時計は本人が停電の地区にいるときだけ）が訓練の終わりまでに切れ、
//   切れる時刻までにその人へ届いた手（通話・到着・手配済・受入）が 1 つも無かった人。停電の前の手も数える（早めの連絡と避難を
//   よしとする。lib/sources の nanbyo-tsuiho-2022）。訪問依頼は着く時刻で数える。1 人 1 行（最初に切れた時計）。
//   「死亡」とは書かない。「条件に達した」まで

import type { ClockRow, DependsOn, DrillAction } from "../db/types.ts";
import { inOutageArea } from "../disaster/state.ts";
import type { Form9Row } from "../forms/form9.ts";
import { clockHours } from "../triage/index.ts";
import { DISPATCH_ARRIVE_MINUTES } from "./actions.ts";
import type { ActionRecord } from "./engine.ts";
import type { CallRecord } from "./responses.ts";

// ---------- 順番 ----------

/** 本人に向けた手（順番と条件で、その人への手に数える物） */
export const PERSON_ACTIONS: ReadonlyArray<DrillAction> = ["call_person", "call_contact", "visit", "dispatch", "request_welfare_shelter"];

const isPersonAction = (a: Pick<ActionRecord, "kind" | "person">): a is Pick<ActionRecord, "kind"> & { person: string } =>
  a.person !== null && PERSON_ACTIONS.includes(a.kind);

/** 本人ごとの最初の手の判定 */
export type OrderTurn = {
  /** 手の番号（a1…） */
  action: string;
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
      kind: a.kind,
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

/** 市役所への報告の遅れ（発災から最初に届いた報告まで） */
export function scoreReport(actions: ReadonlyArray<ActionRecord>): ReportScore {
  const reports = actions.filter((a) => a.kind === "report_city");
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

/** その人へ届いた手の時刻（分）。訪問依頼は着く時刻 */
function reachedAt(a: ActionRecord): number | null {
  if (!isPersonAction(a) || a.result?.ok !== true) return null;
  return a.kind === "dispatch" ? a.result.atMinute + DISPATCH_ARRIVE_MINUTES : a.result.atMinute;
}

/** 条件に達した人（上の決め）。endMinute は訓練の終わり（ケアマネの時計）。1 人 1 行、最初に切れた時計 */
export function scoreReached(
  runs: ReadonlyArray<ClockRun>,
  actions: ReadonlyArray<ActionRecord>,
  endMinute: number,
): Reached[] {
  const out: Reached[] = [];
  const sorted = [...runs].sort((a, b) => a.outMinute - b.outMinute || a.label.localeCompare(b.label, "ja"));
  for (const run of sorted) {
    if (run.outMinute >= endMinute || out.some((r) => r.person === run.person)) continue;
    const own = actions.filter((a) => a.person === run.person);
    const inWindow = (m: number) => m <= run.outMinute;
    if (own.some((a) => { const m = reachedAt(a); return m !== null && inWindow(m); })) continue;
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
};

/**
 * 仮想モード（T53）の結末 1 人。世界（AI）が決めた筋書きで、時計の計算の「条件に達した人」（reached）とは別に数える。
 * at は結末の刻みの時刻（発災からの時間）、text は画面の 1 文、reason は世界の事実（AI。無ければ null）
 */
export type EndedScore = { person: string; at: number; text: string; reason: string | null };

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
};

export function scoreDrill(input: ScoreInput): DrillScore {
  return {
    v: 1,
    participants: [...input.participants],
    endMinute: input.endMinute,
    order: scoreOrder(input.participants, input.actions, input.calls),
    report: scoreReport(input.actions),
    form9: scoreForm9(input.form9, input.participants),
    reached: scoreReached(input.runs, input.actions, input.endMinute),
    calls: scoreCalls(input.calls),
    ...(input.ended ? { ended: [...input.ended] } : {}),
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

