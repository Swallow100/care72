// 訓練の画面の中身（docs/tasks/T17.md）。保存した刻みから見る刻みの状態を作り直し、左の表の行（担当一覧と同じ形）を作る。
// 色と順位は担当一覧と同じ所（lib/caseload.ts の toCaseloadRows → lib/disaster/triage.ts → lib/triage）で出し、ここで決めない。
// 入力の違いは 3 つだけ: 状況は訓練の時計（lib/drill/engine.ts の drillSituation）、安否は訓練の物（signals の drill_id がこの訓練）、
// 時計の頼り先は訓練の世界で書き換えた写し（lib/drill/director.ts の drillClocks。栄養剤の持ち出し忘れ・透析施設の休止）。
// 電話の記録・ケアマネの上書き（本番の経過）は読まない。再生も同じ道（Claude を呼ばない）。

import type { D1Database } from "@cloudflare/workers-types";
import { toCaseloadRows, type CaseloadRow } from "../caseload.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ClockRow, ContactRow, DrillRow, PersonRow } from "../db/types.ts";
import type { DisasterSituation } from "../disaster/state.ts";
import { toTriageSignal } from "../disaster/triage.ts";
import type { ClockForDetail, ContactForDetail, SignalForDetail } from "../list/detail.ts";
import type { TriageSignal } from "../triage/index.ts";
import { loadDrillRow, loadTicks, participantsOf, replayState, type DrillScope } from "./db.ts";
import { drillClocks } from "./director.ts";
import { drillSituation, simAt, type DrillState, type Tick } from "./engine.ts";
import { lastHour, scenarioOf } from "./scenarios.ts";

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
};

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
  const byPerson = new Map<string, TriageSignal[]>();
  for (const s of signalRows) byPerson.set(s.person_id, [...(byPerson.get(s.person_id) ?? []), toTriageSignal(s)]);
  // 訓練の世界が時計の頼り先を書き換える（栄養剤の持ち出し忘れ・透析施設の休止 → 未確認）。台帳そのものは変えない
  const clockRows = drillClocks(clocks.results as unknown as Array<ClockRow>, state.world);
  const contactRows = contacts.results as unknown as Array<ContactRow>;

  const rows = toCaseloadRows(peopleRows, clockRows, contactRows, jstDate(situation.now), {
    situation,
    signals: byPerson,
    detail: {
      contacts: contactRows as unknown as ContactForDetail[],
      clocks: clockRows as unknown as Array<ClockForDetail & { person_id: string }>,
      signals: signalRows,
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
  };
}

/** 想定の今の時刻（ISO）。画面の「今の時刻」 */
export function screenNow(s: Pick<DrillScreen, "drill" | "state">): string {
  return simAt(s.drill.started_at, s.state.hour);
}
