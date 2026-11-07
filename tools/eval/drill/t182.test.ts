// T182: 11/7 夜の見直しの直しの台の口。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import type { LooseAction, LooseTick, LooseTurn, RunOutcome } from "./drive.ts";
import { factHits } from "./facts-check.ts";
import { planRun } from "./plan.ts";
import { checkContext } from "./run.ts";
import { GUARDS } from "../guards.ts";

const CTX = checkContext();
const CASELOAD = SEED_PEOPLE.map((p) => p.person.id);
const baseWorld = { alertLevel: null, quake: null, tsunami: "none", flood: false, outage: null, phone: "ok", water: "none", roads: [], shelters: [], facilities: [], staff: 1 };
function run(ticks: LooseTick[], actions: LooseAction[] = [], world: Record<string, unknown> = {}): RunOutcome {
  return {
    plan: planRun("test", 1, CASELOAD, ["earthquake"]),
    drillId: "d1",
    status: "finished",
    advances: ticks.length,
    replay: { drill: { id: "d1", scenario: "earthquake", status: "finished", step: ticks.length - 1 }, hour: 72, minute: 4320, actions, world: { ...baseWorld, ...world }, ticks, rows: [] },
    ops: [],
    errors: [],
    aiCalls: [],
    callsLeft: 100,
    names: {},
    worldAgent: null,
  } as unknown as RunOutcome;
}
const turn = (person: string, at: number, color: string, more: Partial<LooseTurn> = {}): LooseTurn => ({ person, at, color, source: "family", ai: true, saying: null, ...more });
const tick = (step: number, hour: number, turns: LooseTurn[], incidents: LooseTick["incidents"] = []): LooseTick => ({ step, hour, incidents, turns });
const rulesOf = (o: RunOutcome, person?: string) => factHits(o, CTX.facts!).hits.filter((h) => !person || h.person === person).map((h) => h.rule);
const endTick = tick(9, 72, []);

describe("2. 計画の手段で移った人の機器の検査", () => {
  const DOWN = "p-02";
  const OUT = { outage: { area: { scope: "office" }, since: 0, restoredAt: null } };
  it("移った事の記録の着く時刻から先は無連絡と数えない", () => {
    const silent = [tick(0, 1, [turn(DOWN, 1, "red", { atHome: true })]), endTick];
    expect(rulesOf(run(silent, [], OUT), DOWN)).toContain("down_silent");
    const moved = [tick(0, 1, [turn(DOWN, 1, "red", { atHome: true, move: { to: "shelter", at: 100, by: "plan" } })]), endTick];
    const rules = rulesOf(run(moved, [], OUT), DOWN);
    expect(rules).not.toContain("down_silent");
    expect(rules).not.toContain("down_gap");
  });
});

describe("8. 離れた人のいる所の言い切り", () => {
  const P = "p-03";
  const together = CTX.facts![P].together;
  const roles = CTX.facts![P].roles!;
  const idOf = (far: boolean) => Object.keys(roles).find((id) => roles[id] !== "本人" && together.includes(roles[id]) !== far)!;
  // 画面の言い方（calleeLabel）は「家族 夫」の形。話し手は連絡先の id から役の名で見る
  const act = (far: boolean, text: string, ai = false): LooseAction =>
    ({ id: "a1", person: P, kind: "call_contact", callee: "family", target: idOf(far), calleeLabel: `家族 ${roles[idOf(far)]}`, atMinute: 120, result: { atMinute: 120, status: "connected", speech: "はい。", talk: [{ who: "cm", text: "今どこですか" }, { who: "them", text, ai }] } }) as unknown as LooseAction;

  it("離れた家族のコードの答えの言い切りを数える。同居の人・はずです・本人役の言葉は数えない", () => {
    expect(together.length).toBeGreaterThan(0);
    expect(rulesOf(run([endTick], [act(true, "家にいます。")]), P)).toContain("far_place_said");
    expect(rulesOf(run([endTick], [act(false, "家にいます。")]), P)).not.toContain("far_place_said");
    expect(rulesOf(run([endTick], [act(true, "家にいるはずです。")]), P)).not.toContain("far_place_said");
    expect(rulesOf(run([endTick], [act(true, "家にいます。", true)]), P)).not.toContain("far_place_said");
  });
});

describe("5. 次へ回した出来事の残り", () => {
  it("72 時間まで進んで AI の予定が残れば数える。表の予定（AI の印なし）と途中で止まった回は数えない", () => {
    const held = { at: 4380, change: { kind: "mark", mark: "wandering" }, text: "x", person: "p-04", by: "director", ai: true };
    expect(rulesOf(run([endTick], [], { scheduled: [held] }))).toContain("held_unfired");
    expect(rulesOf(run([endTick], [], { scheduled: [{ ...held, ai: undefined }] }))).not.toContain("held_unfired");
    expect(rulesOf(run([tick(0, 30, [])], [], { scheduled: [held] }))).not.toContain("held_unfired");
  });
});

describe("守り", () => {
  it("T182 の守りが回の数の項目を持つ", () => {
    for (const id of ["drill-far-place-said", "drill-held-unfired"]) {
      const g = GUARDS.find((x) => x.id === id);
      expect(g?.task).toBe("T182");
      expect(g?.value).toBe(0);
    }
  });
});
