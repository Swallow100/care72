// 種の事業所（デモ事業所と確認用の事業所）の「発災開始」（T153）。種は平時で始まり、審査員がこのボタンで発災時に入る。
// 入れる物は T153 の前に種が持っていた大雨の想定と同じ（lib/seed/demo.ts の seedDisasterRows）:
// - 災害モード 大雨・警戒レベル 4・浸水 3 m の町で停電、事業所の経過の 2 行（大雨に切替・停電と警戒レベル 4）
// - 山田の赤の信号（けが あり・文字起こし・Claude の分類の列。種の録音が R2 にあれば結ぶ）と、本人の経過の 3 行
// 時刻は押した時刻から数える（発災 4 時間前・停電 3 時間前・赤 1 時間前）。色と連絡順はルールの表（lib/triage）がこの入力から出す。
//
// 書き方: 1 つの batch（取引）。先に事業所の経過の 1 行目を「版が合い平時のときだけ」入れ、ほかの文はその行があるときだけ流す（片方だけ残らない）。
// 版は 2 つ上がる（切替と情報の 2 回ぶん。T153 の前の種と同じ数え方）。重なった押しは片方だけ通り、もう片方は「競合」。
// もう一度押したとき（平時に戻したあと）は、前に入れた山田の赤と経過の 3 行（決まった id）と、その赤を指す経過を消してから入れ直す。
// 事業所の経過の行は毎回新しい id で、時刻は押した時刻（切替の履歴として残る）。書き手は押した人（審査員なら審査員 1〜3）。
// 入ったあとに医療班への受入依頼（T163、lib/seed/requests.ts）を、ルールの表の連絡順の上から入れる。
// 平時に戻すのは今の切替（lib/disaster/db.ts の switchDisasterMode）。

import type { D1Database } from "@cloudflare/workers-types";
import { seedTargets } from "../auth/demo.ts";
import { loadDisasterState } from "../disaster/db.ts";
import type { DisasterScope } from "../disaster/scope.ts";
import { isDisaster } from "../disaster/state.ts";
import { lit, type SqlValue } from "../../seed/sql.ts";
import { seedDisasterRows, seedRedSignalId, type SeedRecording } from "./demo.ts";
import { findSeedRecording, type SeedBucket } from "./reset.ts";
import { seedStartRequests } from "./requests.ts";

export type StartResult = { ok: true } | { ok: false; error: "conflict" | "disaster" | "not_seed" };

/** 値つきの INSERT を、条件が真のときだけ流す形に（INSERT … SELECT 値 WHERE 条件） */
function insertWhere(table: string, row: Record<string, SqlValue>, cond: string, tail = ""): string {
  const cols = Object.keys(row);
  return `INSERT INTO ${table} (${cols.join(", ")}) SELECT ${cols.map((c) => lit(row[c])).join(", ")} WHERE ${cond}${tail};`;
}

/**
 * 「発災開始」の文。version は画面で読んだ災害の状態の版（行が無ければ 0）。newId は事業所の経過の行の id（テストで決まった値を渡す）。
 * 種の事業所でなければ投げる
 */
export function seedStartStatements(
  officeId: string,
  at: string,
  recording: SeedRecording,
  scope: Pick<DisasterScope, "authorId" | "authorRole">,
  version: number,
  newId: () => string = () => crypto.randomUUID(),
): string[] {
  if (!seedTargets(officeId)) throw new Error(`種の事業所でない: ${officeId}`);
  const rows = seedDisasterRows(officeId, at, recording, { id: scope.authorId, role: scope.authorRole });
  const OFFICE = lit(officeId);
  const nextVersion = version + 2;
  // 事業所の経過の 2 行の時刻は押した時刻（押した事の履歴。平時に戻したあとにもう一度押しても、経過の並びが前の切替と混ざらない）。
  // 発災・停電の時刻は災害の状態と、情報の行の本文（「停電 地区（…） 11/6 08:00〜」）に入る。並びは切替 → 情報（created_at を 1 ミリ秒ずらす）
  const office = rows
    .filter((r) => r.table === "office_timeline_entries")
    .map((r, i) => ({ ...r.row, id: newId(), occurred_at: at, created_at: new Date(Date.parse(at) + i).toISOString() }));
  const state = rows.find((r) => r.table === "disaster_state");
  const signal = rows.find((r) => r.table === "signals");
  const timeline = rows.filter((r) => r.table === "timeline_entries");
  if (office.length === 0 || !state || !signal) throw new Error("大雨の想定の行が足りない");
  const guardId = String(office[0]!.id);
  const ok = `EXISTS (SELECT 1 FROM office_timeline_entries WHERE id = ${lit(guardId)})`;
  const signalId = seedRedSignalId(officeId);
  const timelineIds = timeline.map((r) => lit(String(r.row.id))).join(", ");
  const s = state.row;
  return [
    // 1 行目: 版が合い、平時（行が無いか kind が normal）のときだけ入る
    insertWhere(
      "office_timeline_entries",
      office[0]!,
      `COALESCE((SELECT version FROM disaster_state WHERE office_id = ${OFFICE}), 0) = ${version}
   AND COALESCE((SELECT kind FROM disaster_state WHERE office_id = ${OFFICE}), 'normal') = 'normal'`,
    ),
    ...office.slice(1).map((r) => insertWhere("office_timeline_entries", r, ok)),
    // 前に入れた山田の赤（もう一度押したとき）。経過を先に（signal_id が信号を指す）
    `DELETE FROM timeline_entries WHERE (id IN (${timelineIds}) OR signal_id = ${lit(signalId)}) AND ${ok};`,
    `DELETE FROM signals WHERE id = ${lit(signalId)} AND ${ok};`,
    insertWhere(
      "disaster_state",
      { ...s, started_by: scope.authorId, updated_by: scope.authorId, version: nextVersion },
      ok,
      ` ON CONFLICT (office_id) DO UPDATE SET kind = excluded.kind, started_at = excluded.started_at, started_by = excluded.started_by,
   outage_scope = excluded.outage_scope, outage_towns = excluded.outage_towns, outage_started_at = excluded.outage_started_at,
   alert_level = excluded.alert_level, water = excluded.water, road = excluded.road, version = excluded.version,
   updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ),
    insertWhere("signals", signal.row, ok),
    ...timeline.map((r) => insertWhere("timeline_entries", r.row, ok)),
  ];
}

/**
 * 種の事業所を大雨の想定に入れる。平時のときだけ（災害モードの間は「disaster」）。版が違えば「conflict」。
 * 種の録音が R2 にあれば山田の赤に結ぶ。入ったら呼ぶ側（app/office/start）が T149 の通知を送る
 */
export async function startSeedDisaster(
  db: D1Database,
  bucket: SeedBucket,
  scope: DisasterScope,
  input: { version: number; at: string },
  newId?: () => string,
): Promise<StartResult> {
  if (!seedTargets(scope.officeId)) return { ok: false, error: "not_seed" };
  const now = await loadDisasterState(db, scope.officeId);
  if (now.version !== input.version) return { ok: false, error: "conflict" };
  if (isDisaster(now)) return { ok: false, error: "disaster" };
  const recording = await findSeedRecording(bucket);
  const statements = seedStartStatements(scope.officeId, input.at, recording, scope, input.version, newId);
  const [first] = await db.batch(statements.map((s) => db.prepare(s)));
  if ((first?.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  // 医療班への受入依頼（T163）。入った後のルールの表の連絡順で選ぶので、切替の取引の後に入れる。
  // 入らなくても切替は済んでいる（依頼はケアマネが本人のページから送れる）
  try {
    await seedStartRequests(db, scope.officeId, input.at);
  } catch (e) {
    console.error("種の受入依頼を入れられない", e);
  }
  return { ok: true };
}

