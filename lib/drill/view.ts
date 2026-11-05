// 訓練の画面の中身（docs/tasks/T17.md）。保存した刻みから見る刻みの状態を作り直し、左の表の行（担当一覧と同じ形）を作る。
// 色と順位は担当一覧と同じ所（lib/caseload.ts の toCaseloadRows → lib/disaster/triage.ts → lib/triage）で出し、ここで決めない。
// 入力の違いは 3 つだけ: 状況は訓練の時計（lib/drill/engine.ts の drillSituation）、安否は訓練の物（signals の drill_id がこの訓練）、
// 時計の頼り先は訓練の世界で書き換えた写し（lib/drill/director.ts の drillClocks。栄養剤の持ち出し忘れ・透析施設の休止）。
// 電話の記録・ケアマネの上書き（本番の経過）は読まない。再生も同じ道（Claude を呼ばない）。
// 通話で聞いた安否は、本番の電話と同じく 赤 けが・動けない（red_injury）の人への「無事」を表に渡さない（T84、lib/drill/heard-keep.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import { toCaseloadRows, type CaseloadRow } from "../caseload.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ClockRow, ContactRow, DrillAction, DrillRow, PersonRow } from "../db/types.ts";
import type { DisasterSituation } from "../disaster/state.ts";
import { toTriageSignal } from "../disaster/triage.ts";
import { callTargetText } from "../list/calls.ts";
import type { ClockForDetail, ContactForDetail, SignalForDetail } from "../list/detail.ts";
import { clockRemaining, type TriageSignal } from "../triage/index.ts";
import { personSituation } from "../disaster/state.ts";
import { clockOfRow, heardSignalId, loadDrillRow, loadTicks, participantsOf, replayState, undoableAct, type DrillScope } from "./db.ts";
import { callsLeft } from "./clock.ts";
import { clockOver, termsFor, type ActionTerm } from "./action-terms.ts";
import { hintsOf, type ActionHints, type HintClock } from "./action-hints.ts";
import { busyOf, type BusyView } from "./busy.ts";
import { drillClocks } from "./director.ts";
import { drillSituation, nowHour, simAt, type ActionRecord, type DrillState, type HeardSignal, type Tick } from "./engine.ts";
import { fictionKindOf, type FictionKind } from "./fiction.ts";
import { passHeard } from "./heard-keep.ts";
import { nightTimeLabel } from "./night.ts";
import { lastHour, scenarioOf } from "./scenarios.ts";
import { simTimeText } from "./time-text.ts";

/** 72 時間の棒の帯（停電・断水・電話）。始まりと終わりは発災からの時間。終わりが無ければ今まで続いている */
export type Band = { kind: "outage" | "water" | "phone"; from: number; to: number | null };

export type DrillScreen = {
  drill: Pick<DrillRow, "id" | "scenario" | "status" | "step" | "started_at" | "finished_at"> & { startedByName: string | null };
  /** 見ている刻み（進行中は今の刻み。再生は選んだ刻み） */
  shown: number;
  /** 見ている刻みのあとの状態 */
  state: DrillState;
  /** 0 から見ている刻みまで */
  ticks: Tick[];
  /** 刻みの時刻（発災からの時間。添字は刻み）。連続の時計の訓練（T90）は保存した区切りの時刻 */
  hours: readonly number[];
  /** 連続の時計の訓練か（T90。操作は 30 分・1 時間・3 時間・次まで） */
  clock: boolean;
  /** 連続の時計の訓練の AI の呼び出しの残り（1 訓練の上限 150 まで。clock.ts）。clock の無い訓練は null */
  left: number | null;
  /** 想定の最後の時刻（72） */
  last: number;
  situation: DisasterSituation;
  /** 左の表の行（担当一覧と同じ形。行の詳細の中身も） */
  rows: CaseloadRow[];
  /** 本人の id → 氏名（状況の行に出す） */
  names: Record<string, string>;
  bands: Band[];
  /** 本人役（T18、Claude）が作った安否の signals の id。行の詳細の安否に AI の印を付ける */
  aiSignals: string[];
  /**
   * ケアマネが通話・訪問で聞いた安否の signals の id → 通話か訪問か（T21。行の詳細で「通話」「訪問 確認済」と添える。AI の印なし）。
   * 表に渡さなかった物（refused）は入れない
   */
  heard: Record<string, HeardSignal["via"]>;
  /**
   * 通話で聞いた安否を表に渡さなかった手（T84、至急維持）。手の番号 → 本番の電話と同じ言葉「無事 不可（本人が「けが」）」。
   * 手の結果の「通話」の横と紙の訓練記録に出す
   */
  refused: Record<string, string>;
  /**
   * 本人ごとの連絡先（ケアマネの手の相手を選ぶ。T20）。区分と続柄の言い方と、番号があるかだけ（名前と番号は画面に出さない。
   * 訓練の画面から本物の番号にかけない、T17 の決め）
   */
  contacts: Record<string, DrillContact[]>;
  /** 取り消せる最後の手の番号（T59。進行中で、刻みを越えなかった最後の手だけ）。無ければ null */
  undoable: string | null;
  /** 訓練の人の印（T70。デモ事業所は架空、ほかは本人役。lib/drill/fiction.ts）。無ければ架空 */
  fiction?: FictionKind;
  /** 時間を使う手の見え方（T110、lib/drill/busy.ts）。手に使った時間・職員の空き・次に空く時刻 */
  busy: BusyView;
  /**
   * 手の可否と所要（T110、lib/drill/action-terms.ts）。本人の id（全体の手は ""）→ 手 → 所要・押せない理由。
   * 決まりを選ばなかった訓練（10 分版・前からある訓練）と再生は null（表の分のまま）
   */
  terms: Record<string, Record<DrillAction, ActionTerm>> | null;
  /**
   * 打てる手の候補（T126、lib/drill/action-hints.ts）。本人の id → 候補（無い人は入れない）。分かった事・頼み事・本人の時計から引き、
   * 可否は上の terms（無ければ連絡先の有無だけ）。色と連絡順には使わない。進行中の今の区切りだけで、再生は null
   */
  hints: Record<string, ActionHints> | null;
};

export type DrillContact = { id: string; kind: ContactRow["kind"]; label: string; hasPhone: boolean };

type PersonForDrill = Pick<PersonRow, "id" | "name" | "kana" | "birth_date" | "plan_status" | "self_report_unreliable" | "ledger">;

/** 刻みの状況から帯を作る（見ている刻みまで。先の出来事は出さない） */
export function bandsOf(ticks: ReadonlyArray<Tick>): Band[] {
  const out: Band[] = [];
  const open = new Map<Band["kind"], Band>();
  const begin = (kind: Band["kind"], at: number) => {
    if (open.has(kind)) return;
    const b: Band = { kind, from: at, to: null };
    open.set(kind, b);
    out.push(b);
  };
  const end = (kind: Band["kind"], at: number) => {
    const b = open.get(kind);
    if (!b) return;
    b.to = at;
    open.delete(kind);
  };
  for (const t of ticks) {
    for (const e of t.incidents) {
      const c = e.change;
      if (c.kind === "outage") begin("outage", e.at);
      else if (c.kind === "outage_restored") end("outage", e.at);
      else if (c.kind === "water") (c.out ? begin : end)("water", e.at);
      else if (c.kind === "phone") (c.state === "ok" ? end : begin)("phone", e.at);
    }
  }
  return out;
}

/** 日本の日付（年齢の計算に使う） */
function jstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 訓練の画面の中身を読む。範囲（事業所）の外・無い id は null。want は見る刻み（無ければ今の刻み。今より先は今に丸める）
 */
export async function loadDrillScreen(
  db: D1Database,
  scope: Pick<DrillScope, "officeId">,
  id: string,
  want: number | null,
): Promise<DrillScreen | null> {
  const row = await loadDrillRow(db, scope.officeId, id);
  if (!row) return null;
  const scenario = scenarioOf(row.scenario);
  const shown = want === null ? row.step : Math.max(0, Math.min(row.step, Math.trunc(want)));
  // 連続の時計の訓練（T90）は区切りの時刻を drills.world の cuts から（clock の無い訓練は想定の表の hours）
  const clock = clockOfRow(row);
  const hours = clock.clock ? clock.hours : scenario.hours;
  const participants = participantsOf(row);
  const ids = JSON.stringify(participants);

  const inDrill = "SELECT value FROM json_each(?2)";
  const [people, clocks, contacts, signals, aiTurns] = await db.batch([
    db
      .prepare(
        `SELECT id, name, kana, birth_date, plan_status, self_report_unreliable, ledger FROM people
          WHERE office_id = ?1 AND id IN (${inDrill}) ORDER BY kana, id`,
      )
      .bind(scope.officeId, ids),
    db
      .prepare(
        `SELECT * FROM clocks WHERE person_id IN (SELECT id FROM people WHERE office_id = ?1 AND id IN (${inDrill}))
          ORDER BY person_id, sort, id`,
      )
      .bind(scope.officeId, ids),
    db
      .prepare(
        `SELECT id, person_id, kind, relation, name, phone, reach, emergency_order, supporter_order,
                night_ok, has_car, has_smartphone, note, sort
           FROM contacts WHERE person_id IN (SELECT id FROM people WHERE office_id = ?1 AND id IN (${inDrill}))
          ORDER BY person_id, sort, id`,
      )
      .bind(scope.officeId, ids),
    // 訓練の安否だけ（この訓練の drill_id）。本番の安否（drill_id IS NULL）は読まない
    db
      .prepare(
        `SELECT * FROM signals WHERE drill_id = ?3
            AND person_id IN (SELECT id FROM people WHERE office_id = ?1 AND id IN (${inDrill}))
          ORDER BY occurred_at, created_at, id`,
      )
      .bind(scope.officeId, ids, id),
    // 本人役（Claude）の 1 刻みが書いた安否の id（drill_events の payload の signal。ai が true の物）
    db
      .prepare(
        `SELECT json_extract(payload, '$.signal') AS signal FROM drill_events
          WHERE drill_id = ?1 AND kind = 'persona_turn' AND step <= ?2 AND json_extract(payload, '$.ai') = 1`,
      )
      .bind(id, shown),
  ]);

  const peopleRows = people.results as PersonForDrill[];
  const ledgers = peopleRows.map((p) => parseLedger(p.ledger));
  const { state, ticks } = replayState(row, participants, await loadTicks(db, id, hours, shown, clock.clock ? lastHour(scenario) : undefined), shown);
  const situation = drillSituation(state, ledgers);

  const signalRows = signals.results as SignalForDetail[];
  // ケアマネが通話・訪問で聞いた安否（T21）。訪問で会えた物は緑の理由が「訪問 確認済」
  const heardAll = heardOf(id, state.actions);
  const toSignal = (s: SignalForDetail): TriageSignal => {
    const t = toTriageSignal(s);
    return heardAll[s.id] === "visit" ? { ...t, visit: true } : t;
  };
  // 訓練の世界が時計の頼り先を書き換える（栄養剤の持ち出し忘れ・透析施設の休止 → 未確認）。台帳そのものは変えない
  const clockRows = drillClocks(clocks.results as unknown as Array<ClockRow>, state.world);
  const contactRows = contacts.results as unknown as Array<ContactRow>;
  const today = jstDate(situation.now);

  // 至急維持（T84）: 通話で聞いた「無事」と けが・動けない の無い「無事でない」は、その前の表の行が red_injury なら表に渡さない
  // （本番の電話と同じ線。lib/drill/heard-keep.ts）。その前の表は、その人の渡した安否だけで担当一覧と同じ道で当てる
  const pass = passHeard(signalRows, heardAll, toSignal, situation.now, (personId, sigs) => {
    const one = toCaseloadRows(
      peopleRows.filter((p) => p.id === personId),
      clockRows,
      contactRows,
      today,
      { situation, signals: new Map([[personId, sigs]]) },
    )[0];
    return one?.triage ? { rule: one.triage.rule, reason: one.triage.reason } : null;
  });
  const heard = Object.fromEntries(Object.entries(heardAll).filter(([sid]) => !pass.refused.has(sid)));

  const rows = toCaseloadRows(peopleRows, clockRows, contactRows, today, {
    situation,
    signals: pass.byPerson,
    detail: {
      contacts: contactRows as unknown as ContactForDetail[],
      clocks: clockRows as unknown as Array<ClockForDetail & { person_id: string }>,
      signals: pass.kept,
      calls: [],
    },
  });

  const live = row.status === "running" && shown === row.step;
  const terms =
    // 72 時間に着いた後（T123）は決まりを選ばない訓練も、どの手も押せない印を出す
    live && (state.options?.terms === true || clockOver(state))
      ? Object.fromEntries(["", ...participants].map((p) => [p, termsFor(state, p || null)]))
      : null;
  const contactMap = contactsByPerson(contactRows);

  return {
    drill: {
      id: row.id,
      scenario: row.scenario,
      status: row.status,
      step: row.step,
      started_at: row.started_at,
      finished_at: row.finished_at,
      startedByName: row.started_by_name,
    },
    shown,
    state,
    ticks,
    hours,
    clock: clock.clock,
    left: clock.clock ? callsLeft(clock.counts) : null,
    last: lastHour(scenario),
    situation,
    rows,
    names: Object.fromEntries(peopleRows.map((p) => [p.id, p.name])),
    bands: bandsOf(ticks),
    aiSignals: (aiTurns.results as Array<{ signal: unknown }>)
      .map((r) => r.signal)
      .filter((x): x is string => typeof x === "string"),
    heard,
    refused: refusedOf(id, state.actions, pass.refused),
    contacts: contactMap,
    undoable: undoableAct(row),
    fiction: fictionKindOf(scope.officeId),
    busy: busyOf(state, { on: clock.clock, aiAt: clock.aiAt }),
    terms,
    hints: live
      ? hintsByPerson({ state, people: peopleRows, ledgers, clockRows, rows, situation, terms, contacts: contactMap, last: lastHour(scenario) })
      : null,
  };
}

/**
 * 本人ごとの打てる手の候補（T126）。時計は本人の地区の停電で走り出しを決め（担当一覧と同じ personSituation）、残りは lib/triage の
 * clockRemaining（読むだけ。色と順は変えない）。残りの言葉と色は行の詳細の時計と同じ物。仮想モードの結末の人は出さない
 */
function hintsByPerson(x: {
  state: DrillState;
  people: ReadonlyArray<PersonForDrill>;
  ledgers: ReadonlyArray<ReturnType<typeof parseLedger>>;
  clockRows: ReadonlyArray<ClockRow>;
  rows: ReadonlyArray<CaseloadRow>;
  situation: DisasterSituation;
  terms: Record<string, Record<DrillAction, ActionTerm>> | null;
  contacts: Record<string, DrillContact[]>;
  last: number;
}): Record<string, ActionHints> {
  const out: Record<string, ActionHints> = {};
  const w = x.state.world;
  const hoursLeft = Math.max(0, x.last - nowHour(x.state));
  x.people.forEach((p, i) => {
    if (w.ended?.[p.id]) return;
    const own = personSituation(x.situation, x.ledgers[i]?.basic.address?.town ?? null);
    const shown = new Map((x.rows.find((r) => r.id === p.id)?.detail?.clocks ?? []).map((k) => [k.id, k]));
    const clocks: HintClock[] = x.clockRows
      .filter((k) => k.person_id === p.id)
      .map((k) => {
        const r = clockRemaining(k, own);
        const d = shown.get(k.id);
        return {
          id: k.id,
          category: k.category,
          label: k.label,
          running: r?.running ?? false,
          left: r ? r.remaining : null,
          remaining: d?.remaining ?? null,
          tone: d?.tone ?? null,
          depends_on: k.depends_on,
          depends_check: k.depends_check,
        };
      });
    const hints = hintsOf({
      person: p.id,
      asks: w.asks?.[p.id] ?? [],
      clocks,
      world: w,
      terms: x.terms?.[p.id] ?? null,
      contacts: x.contacts[p.id] ?? [],
      hoursLeft,
    });
    if (hints) out[p.id] = hints;
  });
  return out;
}

/** ケアマネが通話・訪問で聞いた安否の signals の id → 通話か訪問か（手の返事から。lib/drill/db.ts の heardSignalId） */
export function heardOf(drillId: string, actions: ReadonlyArray<ActionRecord>): Record<string, HeardSignal["via"]> {
  const out: Record<string, HeardSignal["via"]> = {};
  for (const a of actions) {
    if (a.result?.heard) out[heardSignalId(drillId, a.id)] = a.result.heard.via;
  }
  return out;
}

/** 表に渡さなかった聞いた安否（signals の id → 言葉）を、手の番号 → 言葉に（lib/drill/db.ts の heardSignalId の逆） */
export function refusedOf(drillId: string, actions: ReadonlyArray<ActionRecord>, refused: ReadonlyMap<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of actions) {
    const label = refused.get(heardSignalId(drillId, a.id));
    if (label) out[a.id] = label;
  }
  return out;
}

/** 本人ごとの連絡先（台帳の並び）。名前と番号は落とす */
export function contactsByPerson(rows: ReadonlyArray<Pick<ContactRow, "id" | "person_id" | "kind" | "relation" | "phone">>): Record<string, DrillContact[]> {
  const out: Record<string, DrillContact[]> = {};
  for (const c of rows) {
    (out[c.person_id] ??= []).push({ id: c.id, kind: c.kind, label: callTargetText(c), hasPhone: Boolean(c.phone?.trim()) });
  }
  return out;
}

/**
 * 大きな経過の下の時刻の文（T59）。夜間発災の訓練は訓練の中の時刻（深夜 2 時＋経過。「5:30」、棒の下の「今 N 時」と同じ時）、
 * ほかは今まで通り開始からの実の日時（「11/3 21:59」。lib/drill/time-text.ts の simTimeText）。started_at はずらさず表示だけ
 */
export function screenTimeText(s: Pick<DrillScreen, "state">): string {
  if (s.state.options?.night === true) return nightTimeLabel(Math.round(nowHour(s.state) * 60));
  return simTimeText(s.state.startedAt, nowHour(s.state) * 60);
}

/** 想定の今の時刻（ISO）。画面の「今の時刻」 */
export function screenNow(s: Pick<DrillScreen, "drill" | "state">): string {
  return simAt(s.drill.started_at, nowHour(s.state));
}
