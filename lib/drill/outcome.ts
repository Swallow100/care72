// 仮想モード（docs/tasks/T50.md・T53.md）の「時計の目安」。結末は決めない（決めるのは世界の部屋・1 回呼び、lib/drill/world-apply.ts）。Claude を呼ばない。
//
// 刻みごとに、走り出した時計（ルールの表と同じ時計。停電の時計は本人の町が停電のときだけ）の残り・超過と、
// 切れる時刻までにその人へ届いた手（通話・到着・手配済・受入）が 1 つも無い人（条件に達した人）をコードが数える。
// 計算は採点（lib/drill/score.ts の clockRuns・scoreReached）と同じ関数で、訓練の終わりの講評（T22）の「条件に達した人」と数が合う。
// これは世界への入力（ヒント）で、世界はそれを見て結末を迎えた人を 0〜2 人決める（同じ人とは限らない。T53、DECISIONS 11/3 17:4x）。
// ルールの表の色は変えない（lib/triage は触らない）

import type { D1Database } from "@cloudflare/workers-types";
import { parseLedger } from "../db/ledger.ts";
import type { Ledger } from "../db/types.ts";
import { formatHours } from "../triage/index.ts";
import { drillClocks } from "./director.ts";
import type { ActionRecord } from "./engine.ts";
import { outageTownsOf } from "./engine.ts";
import type { WorldState } from "./scenarios.ts";
import { clockRuns, scoreReached, type ClockForRun, type Reached } from "./score.ts";
import type { OutcomeAsk } from "./world-apply.ts";

/** 時計の走り方に渡す停電（町ごとの始まりも）。採点（record.ts）と結末で同じ物を使う */
export function outageForRuns(
  world: Pick<WorldState, "outage">,
  ledgers: ReadonlyArray<Pick<Ledger, "basic" | "evacuation">>,
): { since: number; towns: string[] | null; townSince?: Record<string, number> } | null {
  const o = world.outage;
  if (!o) return null;
  return {
    since: o.since,
    towns: outageTownsOf(o.area, ledgers),
    ...(o.area.scope === "towns" && o.area.since ? { townSince: o.area.since } : {}),
  };
}

/** 結末に要る本人の事実（サーバーの中だけ。Claude に渡さない） */
export type OutcomeSource = {
  name: string;
  ledger: Pick<Ledger, "basic" | "evacuation">;
  clocks: ReadonlyArray<ClockForRun>;
};

/** この時刻（発災からの分）までに条件に達した人。採点の scoreReached と同じ計算（endMinute = 今の分） */
export function reachedBy(
  sources: ReadonlyMap<string, OutcomeSource>,
  participants: ReadonlyArray<string>,
  world: WorldState,
  actions: ReadonlyArray<ActionRecord>,
  minute: number,
): Reached[] {
  const members = participants.filter((p) => sources.has(p));
  const ledgers = members.map((p) => sources.get(p)!.ledger);
  const towns = new Map(members.map((p) => [p, sources.get(p)!.ledger.basic.address?.town ?? null] as const));
  const clocks = members.flatMap((p) => [...sources.get(p)!.clocks]);
  const runs = clockRuns(drillClocks(clocks, world), towns, outageForRuns(world, ledgers));
  return scoreReached(runs, actions, minute);
}

/** 条件に達した時計の言い方（「酸素の電池 2時間を超過」）。結末の行の label と世界への伝え方 */
export const outcomeLabel = (r: Pick<Reached, "label" | "hours">) => `${r.label} ${formatHours(r.hours)}を超過`;

export type OutcomeInput = {
  world: WorldState;
  actions: ReadonlyArray<ActionRecord>;
  participants: ReadonlyArray<string>;
  /** 今の時刻（発災からの分） */
  minute: number;
};

/** 本人 1 人の、走っている時計のうちいちばん早く切れる物（世界への目安） */
export type ClockHint = {
  person: string;
  /** 時計の名前と長さ（「酸素の電池 2時間」） */
  label: string;
  /** 切れるまでの分。負は超過した分 */
  leftMinutes: number;
};

/** 世界への目安。reached は時計の計算で条件に達した人（まだ結末でない人）、clocks は走っている時計の残り・超過 */
export type OutcomeHints = { reached: OutcomeAsk[]; clocks: ClockHint[] };

export const NO_HINTS: OutcomeHints = { reached: [], clocks: [] };

/** この刻みの目安（もう結末の人は除く） */
export function outcomeHints(sources: ReadonlyMap<string, OutcomeSource>, input: OutcomeInput): OutcomeHints {
  const ended = input.world.ended ?? {};
  const live = input.participants.filter((p) => !ended[p] && sources.has(p));
  const reached = reachedBy(sources, live, input.world, input.actions, input.minute).map((r) => ({ person: r.person, label: outcomeLabel(r) }));
  const ledgers = live.map((p) => sources.get(p)!.ledger);
  const towns = new Map(live.map((p) => [p, sources.get(p)!.ledger.basic.address?.town ?? null] as const));
  const runs = clockRuns(
    drillClocks(live.flatMap((p) => [...sources.get(p)!.clocks]), input.world),
    towns,
    outageForRuns(input.world, ledgers),
  ).filter((r) => r.startMinute <= input.minute);
  const clocks: ClockHint[] = [];
  for (const p of live) {
    const first = runs.filter((r) => r.person === p).sort((a, b) => a.outMinute - b.outMinute)[0];
    if (first) clocks.push({ person: p, label: `${first.label} ${formatHours(first.hours)}`, leftMinutes: first.outMinute - input.minute });
  }
  return { reached, clocks };
}

/** engine に渡す口。仮想の刻みで、世界の前に呼ぶ（目安を作るだけ。結末は世界が決める） */
export type OutcomeHook = (input: OutcomeInput) => Promise<OutcomeHints>;

/** 事業所の本人の氏名・台帳・時計（頼り先の欄も）を 1 回の batch で読む */
export async function loadOutcomeSources(db: D1Database, officeId: string): Promise<Map<string, OutcomeSource>> {
  const inOffice = "SELECT id FROM people WHERE office_id = ?1";
  const [people, clocks] = await db.batch([
    db.prepare("SELECT id, name, ledger FROM people WHERE office_id = ?1 ORDER BY id").bind(officeId),
    db
      .prepare(
        `SELECT person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check FROM clocks
          WHERE person_id IN (${inOffice}) ORDER BY person_id, sort, id`,
      )
      .bind(officeId),
  ]);
  const byPerson = new Map<string, ClockForRun[]>();
  for (const k of clocks.results as unknown as ClockForRun[]) byPerson.set(k.person_id, [...(byPerson.get(k.person_id) ?? []), k]);
  const out = new Map<string, OutcomeSource>();
  for (const p of people.results as unknown as Array<{ id: string; name: string; ledger: string }>) {
    out.set(p.id, { name: p.name, ledger: parseLedger(p.ledger), clocks: byPerson.get(p.id) ?? [] });
  }
  return out;
}

/** 目安の口を作る（1 要求ごと。台帳は最初の呼び出しで 1 回だけ読む） */
export function createOutcomeHook(deps: { load: () => Promise<ReadonlyMap<string, OutcomeSource>> }): OutcomeHook {
  let loaded: Promise<ReadonlyMap<string, OutcomeSource>> | null = null;
  return async (input) => outcomeHints(await (loaded ??= deps.load()), input);
}
