// 仮想モード（docs/tasks/T50.md）の結末。AI が決めない。Claude を呼ばない。
//
// 刻みごとに、走り出した時計（ルールの表と同じ時計。停電の時計は本人の町が停電のときだけ）が切れて、
// 切れる時刻までにその人へ届いた手（通話・到着・手配済・受入）が 1 つも無い人を「条件に達した」とコードが決める。
// 計算は採点（lib/drill/score.ts の clockRuns・scoreReached）と同じ関数で、訓練の終わりの講評（T22）の「条件に達した人」と数が合う。
// 決まった人には、世界の部屋（または 1 回呼び）にオブラートに包んだ 1 文だけを書かせる（lib/drill/world-apply.ts の worldIncidents）。
// 以後その人の本人役は呼ばず、信号を出さず、着信も鳴らない（lib/drill/engine.ts）。ルールの表の色は変えない（lib/triage は触らない）

import type { D1Database } from "@cloudflare/workers-types";
import { parseLedger } from "../db/ledger.ts";
import type { Ledger } from "../db/types.ts";
import { formatHours } from "../triage/index.ts";
import { drillClocks } from "./director.ts";
import type { ActionRecord } from "./engine.ts";
import { outageTownsOf } from "./engine.ts";
import type { WorldState } from "./scenarios.ts";
import { clockRuns, scoreReached, type ClockForRun, type Reached } from "./score.ts";
import { farewellFixed, type OutcomeAsk } from "./world-apply.ts";

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

/** 結末の理由の言い方（「酸素の電池 2時間を超過」）。画面と部屋への伝え方 */
export const outcomeLabel = (r: Pick<Reached, "label" | "hours">) => `${r.label} ${formatHours(r.hours)}を超過`;

export type OutcomeInput = {
  world: WorldState;
  actions: ReadonlyArray<ActionRecord>;
  participants: ReadonlyArray<string>;
  /** 今の時刻（発災からの分） */
  minute: number;
};

/** この刻みで新しく条件に達した人（もう結末の人は除く） */
export function newOutcomes(sources: ReadonlyMap<string, OutcomeSource>, input: OutcomeInput): OutcomeAsk[] {
  const ended = input.world.ended ?? {};
  return reachedBy(sources, input.participants, input.world, input.actions, input.minute)
    .filter((r) => !ended[r.person])
    .map((r) => ({ person: r.person, label: outcomeLabel(r), fixed: farewellFixed(sources.get(r.person)!.name) }));
}

/** engine に渡す口。仮想の刻みで、世界の前に呼ぶ */
export type OutcomeHook = (input: OutcomeInput) => Promise<OutcomeAsk[]>;

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

/** 結末の口を作る（1 要求ごと。台帳は最初の呼び出しで 1 回だけ読む） */
export function createOutcomeHook(deps: { load: () => Promise<ReadonlyMap<string, OutcomeSource>> }): OutcomeHook {
  let loaded: Promise<ReadonlyMap<string, OutcomeSource>> | null = null;
  return async (input) => newOutcomes(await (loaded ??= deps.load()), input);
}
