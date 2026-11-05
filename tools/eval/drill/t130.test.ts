// T130 の評価の台の検査（帳面との矛盾）のテスト。作った入力（架空の記録）で、拾うべき物を拾い、拾うべきでない物を拾わないか。
// Claude は呼ばない。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { checkRun } from "./checks.ts";
import type { LooseAction, LooseTick, LooseTurn, RunOutcome } from "./drive.ts";
import { factHits } from "./facts-check.ts";
import { planRun } from "./plan.ts";
import { checkContext } from "./run.ts";

const CTX = checkContext();
const CASELOAD = SEED_PEOPLE.map((p) => p.person.id);

function outcome(ticks: LooseTick[], actions: LooseAction[] = [], world: Record<string, unknown> = {}, over: Partial<RunOutcome> = {}): RunOutcome {
  return {
    plan: planRun("test", 1, CASELOAD, ["heavy_rain"]),
    drillId: "d1",
    status: "finished",
    advances: ticks.length,
    replay: {
      drill: { id: "d1", scenario: "heavy_rain", status: "finished", step: ticks.length - 1 },
      hour: 72,
      minute: 4320,
      actions,
      world: { alertLevel: null, quake: null, tsunami: "none", flood: false, outage: null, phone: "ok", water: "none", roads: [], shelters: [], facilities: [], staff: 1, marks: {}, dispatched: [], ...world },
      ticks,
      rows: [],
    },
    ops: [],
    errors: [],
    aiCalls: [],
    callsLeft: 100,
    names: {},
    worldAgent: null,
    ...over,
  };
}

const turn = (person: string, at: number, color: string, more: Partial<LooseTurn> = {}): LooseTurn => ({ person, at, color, source: "family", ai: true, saying: null, ...more });
const tick = (step: number, hour: number, turns: LooseTurn[], incidents: LooseTick["incidents"] = []): LooseTick => ({ step, hour, incidents, turns });
const rules = (o: RunOutcome) => factHits(o, CTX.facts!).hits.map((h) => h.rule);

describe("帳面との矛盾（facts-check）", () => {
  it("避難所にいた人が手も戻った言葉も無く家・避難所にいるのに家で過ごす、を拾う", () => {
    const o = outcome([
      tick(0, 3, [turn("p-06", 3, "green", { whereNow: "shelter" })]),
      tick(1, 6, [turn("p-06", 6, "green", { whereNow: "home", saying: "様子を見ています。" })]),
      tick(2, 9, [turn("p-06", 9, "green", { whereNow: "shelter", saying: "避難所に着きました。家で過ごします。" })]),
    ]);
    expect(rules(o)).toEqual(expect.arrayContaining(["place_flip", "place_text"]));
  });

  it("「家に戻った」なら家にしてよい・表の固定の言葉（AI でない）は見ない", () => {
    const o = outcome([
      tick(0, 3, [turn("p-06", 3, "green", { whereNow: "shelter" })]),
      tick(1, 6, [turn("p-06", 6, "green", { whereNow: "home", saying: "水が引いて家に戻りました。" })]),
      tick(2, 9, [turn("p-06", 9, "green", { whereNow: "shelter", ai: false, saying: "避難所に着きました。家で過ごします。" })]),
    ]);
    expect(rules(o)).toEqual([]);
  });

  it("同居の人が「来た」・声が無いと伝えたあと本人が話す・電気が戻ったあとの電池の頼み事", () => {
    const o = outcome(
      [
        tick(0, 3, [turn("p-02", 3, "red", { source: "family", saying: "呼びかけても返事がありません。", atHome: true })]),
        tick(1, 6, [turn("p-02", 6, "green", { source: "agent", whereNow: "home", saying: "大丈夫です。" })]),
        tick(2, 9, [turn("p-01", 9, "green", { source: "agent", whereNow: "home", saying: "電池を届けてほしいです。" })]),
      ],
      [],
      { outage: { area: { scope: "office" }, since: 1, restoredAt: 5 } },
    );
    expect(rules(o)).toEqual(expect.arrayContaining(["voice_lost", "ask_after_power"]));
    const w = outcome([tick(0, 3, [turn("p-02", 3, "red", { source: "agent", atHome: true, saying: "夫がさっき帰ってきました。" })])]);
    expect(rules(w)).toContain("with_arrived");
  });

  it("手も計画も無い業者の巡回・同じ言い回しの出来事を別の人に・画面の結末の理由の医療の言い方", () => {
    const o = outcome(
      [
        tick(0, 3, [], [
          { at: 3, text: "近くの薬局が今日は休み", actor: "director", ai: true, inject: "pharmacy_closed", person: "p-03", change: { kind: "facility" } },
          { at: 3, text: "近くの薬局が今日は休み", actor: "director", ai: true, inject: "pharmacy_closed", person: "p-04", change: { kind: "facility" } },
          { at: 4, text: "x", actor: "director", ai: true, person: "p-02", change: { kind: "outcome", reason: "呼吸器の電池が切れた" } },
        ]),
      ],
      [],
      {
        arrivals: [
          { person: "p-01", role: "vendor", arrive: 300, back: null, arrived: true, from: "director" },
          { person: "p-02", role: "vendor", arrive: 300, back: null, arrived: true, from: "director" },
        ],
      },
    );
    const r = rules(o);
    expect(r.filter((x) => x === "supply_without_hand")).toHaveLength(1); // p-02 は業者の約束（台帳の連絡先）がある
    expect(r).toEqual(expect.arrayContaining(["repeat_text", "reason_medical"]));
  });

  it("赤（動けない）→ 緑の検査は、計画で移った（避難先と手段・手伝う人、家の外）を手と同じに見る（門と同じ）", () => {
    const ticks = [
      tick(0, 3, [turn("p-06", 3, "red", { canMove: false, atHome: true })]),
      tick(1, 6, [turn("p-06", 6, "green", { whereNow: "shelter" })]),
      tick(2, 9, [turn("p-03", 9, "red", { canMove: false, atHome: true })]),
      tick(3, 12, [turn("p-03", 12, "green", { whereNow: "home" })]),
    ];
    const { numbers } = checkRun([], outcome(ticks), CTX);
    // p-06 は娘の車で避難先へ（計画）、p-03 は家のまま緑（手なし）
    expect(numbers.contradictions.byRule).toEqual({ hurt_to_safe: 1 });
  });

  it("checkRun の数に帳面の矛盾と門の数（drills.world の gated）が入る", () => {
    const o = outcome([tick(0, 3, [turn("p-06", 3, "green", { whereNow: "shelter", saying: "避難所です。家で過ごします。" })])], [], {}, { gated: { hurt_to_safe: 2 } });
    const { numbers } = checkRun([], o, CTX);
    expect(numbers.facts).toMatchObject({ hits: 1, byRule: { place_text: 1 }, gated: { hurt_to_safe: 2 } });
  });
});
