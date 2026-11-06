// 仮想の訓練の人ごとの出来事（docs/tasks/T167.md の 4）。世界（Opus）が出す出来事は街と物の事で、人を指す種類は業者の巡回くらいしか無く、評価の 8 回目で
// 仮想の回の 8/10 人に、その人を指す出来事が 1 つも無かった。監督の出来事の表（lib/drill/event-catalog.ts）の人ごとの種類から、その人に当てはまり、
// 今の決まりで使える物を、世界の刻みごとに 1 人 1 つだけコードが足す（Claude を呼ばない。呼び出しは増えない）。
//
// - 世界の指示は変えない（部屋の Agent の system に触らない）
// - 足すのは「まだその人を指す出来事の無い人」だけ。町の浸水・断水の印は町の事で、その人の筋に数えない
// - AI の印を付けない（表の固定の文）。色・連絡順・結末は決めない
// - 同じ種類は訓練に 2 回まで（kindSpent）。まだ誰にも出していない種類を先に。並びは訓練の種で決める（同じ種なら同じ、T121）

import { eligibleKinds, kindAllowed } from "./director.ts";
import { afterOf, EVENT_CATALOG, isSelfKind, type EventSource, type InjectKind } from "./event-catalog.ts";
import { injectFits, type FitProfile } from "./fit.ts";
import type { DrillIncident } from "./incident-types.ts";
import { kindSpent } from "./person-facts.ts";
import type { PersonState } from "./persona-types.ts";
import type { PersonMarks, WorldState } from "./scenarios.ts";
import { kindOnTime, seededShuffle } from "./time-odds.ts";

/** 町の出来事で付く印（その人の筋に数えない） */
const TOWN_MARKS: ReadonlyArray<keyof PersonMarks> = ["flooded", "waterOut", "lineDown"];

/** まだその人を指す出来事の無い人（並びは members のまま）。結末の人は入れない */
export function quietOf(world: WorldState, members: ReadonlyArray<string>): string[] {
  const touched = new Set<string>();
  for (const x of world.issued ?? []) if (x.person) touched.add(x.person);
  for (const r of world.roads ?? []) if (r.person) touched.add(r.person);
  for (const f of world.facilities ?? []) if (f.person) touched.add(f.person);
  for (const a of world.arrivals ?? []) if (a.from === "world" || a.from === "director") touched.add(a.person);
  for (const [p, m] of Object.entries(world.marks ?? {})) {
    if (Object.entries(m ?? {}).some(([k, v]) => v !== undefined && !TOWN_MARKS.includes(k as keyof PersonMarks))) touched.add(p);
  }
  const ended = world.ended ?? {};
  return members.filter((p) => !touched.has(p) && !ended[p]);
}

export type QuietInput = {
  world: WorldState;
  hour: number;
  members: ReadonlyArray<string>;
  sources: ReadonlyMap<string, EventSource>;
  people: Readonly<Record<string, PersonState | undefined>>;
  seed?: string | null | undefined;
  profile: FitProfile | null;
  /** 業者の巡回を当ててよいか（手か計画の業者の約束。T130） */
  supplyOk?: (person: string) => boolean;
};

/** この刻みに足す 1 人の出来事（無ければ空）。1 つの出来事が 2 行になる種類がある */
export function quietPersonEvent(q: QuietInput): DrillIncident[] {
  const minute = Math.round(q.hour * 60);
  const issued = q.world.issued ?? [];
  const seed = q.seed ?? "";
  for (const person of seededShuffle(quietOf(q.world, q.members), `${seed}|quiet|${minute}`)) {
    const source = q.sources.get(person);
    if (!source) continue;
    const kinds = eligibleKinds(source, person, q.world, q.people[person] ?? null).filter(
      (k) =>
        !isSelfKind(k) &&
        injectFits(q.profile, k) &&
        !kindSpent(q.world, k) &&
        kindAllowed(k, person, q.world, q.hour, minute, source) &&
        kindOnTime(k, q.hour, q.seed, issued) &&
        (k !== "vendor_round" || (q.supplyOk?.(person) ?? false)),
    );
    if (kinds.length === 0) continue;
    const shuffled = seededShuffle(kinds, `${seed}|quiet|${person}|${minute}`);
    const fresh = shuffled.filter((k) => !issued.some((x) => x.kind === k));
    const kind: InjectKind = fresh[0] ?? shuffled[0];
    const row = EVENT_CATALOG[kind];
    const after = afterOf(row, undefined) ?? null;
    const parts = row.build({ person, persons: [], ...(row.factsFor ? { facts: row.factsFor(source) } : {}) }, q.hour, after);
    return parts.map((b) => ({
      actor: "director" as const,
      at: q.hour,
      change: b.change,
      text: b.text,
      person: b.person ?? person,
      inject: kind,
      ai: false,
      filled: true as const,
    }));
  }
  return [];
}
