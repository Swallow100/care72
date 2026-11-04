// 訓練の画面の中身（docs/tasks/T17.md）。保存した刻みから見る刻みの状態を作り直し、左の表の行（担当一覧と同じ形）を作る。
// 色と順位は担当一覧と同じ所（lib/caseload.ts の toCaseloadRows → lib/disaster/triage.ts → lib/triage）で出し、ここで決めない。
// 入力の違いは 3 つだけ: 状況は訓練の時計（lib/drill/engine.ts の drillSituation）、安否は訓練の物（signals の drill_id がこの訓練）、
// 時計の頼り先は訓練の世界で書き換えた写し（lib/drill/director.ts の drillClocks。栄養剤の持ち出し忘れ・透析施設の休止）。
// 電話の記録・ケアマネの上書き（本番の経過）は読まない。再生も同じ道（Claude を呼ばない）。
// 通話で聞いた安否は、本番の電話と同じく 赤 けが・動けない（red_injury）の人への「無事」を表に渡さない（T84、lib/drill/heard-keep.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import { toCaseloadRows, type CaseloadRow } from "../caseload.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ClockRow, ContactRow, DrillRow, PersonRow } from "../db/types.ts";
import type { DisasterSituation } from "../disaster/state.ts";
import { toTriageSignal } from "../disaster/triage.ts";
import { callTargetText } from "../list/calls.ts";
import type { ClockForDetail, ContactForDetail, SignalForDetail } from "../list/detail.ts";
import type { TriageSignal } from "../triage/index.ts";
import { heardSignalId, loadDrillRow, loadTicks, participantsOf, replayState, undoableAct, type DrillScope } from "./db.ts";
import { drillClocks } from "./director.ts";
import { drillSituation, nowHour, simAt, type ActionRecord, type DrillState, type HeardSignal, type Tick } from "./engine.ts";
import { fictionKindOf, type FictionKind } from "./fiction.ts";
import { passHeard } from "./heard-keep.ts";
import { nightTimeLabel } from "./night.ts";
import { lastHour, scenarioOf } from "./scenarios.ts";
import { shortJst } from "../disaster/state.ts";

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
  hours: readonly number[];
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
  const { state, ticks } = replayState(row, participants, await loadTicks(db, id, scenario.hours, shown), shown);
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
    hours: scenario.hours,
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
    contacts: contactsByPerson(contactRows),
    undoable: undoableAct(row),
    fiction: fictionKindOf(scope.officeId),
  };
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
 * ほかは今まで通り開始からの実の日時（「11/3 21:59」）。started_at はずらさず表示だけ
 */
export function screenTimeText(s: Pick<DrillScreen, "state" | "situation">): string {
  if (s.state.options?.night === true) return nightTimeLabel(Math.round(nowHour(s.state) * 60));
  return shortJst(s.situation.now);
}

/** 想定の今の時刻（ISO）。画面の「今の時刻」 */
export function screenNow(s: Pick<DrillScreen, "drill" | "state">): string {
  return simAt(s.drill.started_at, nowHour(s.state));
}
