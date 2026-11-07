// T178: 評価の 11 回目の「直す所」の台の口。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { GUARDS, guardFindings } from "../guards.ts";
import type { LooseTick, LooseTurn, RunOutcome } from "./drive.ts";
import { DOWN_GAP_MINUTES, factHits } from "./facts-check.ts";
import { planRun } from "./plan.ts";
import { checkContext, SEED_SOURCES } from "./run.ts";

const CTX = checkContext();
const plan0 = planRun("t178", 1, SEED_SOURCES.map((s) => s.person.id) as never, ["earthquake"] as never, "all");
const baseWorld = { outage: null, roads: [], facilities: [], shelters: [], marks: {}, arrivals: [], dispatched: [], asks: {}, supplies: {} };
function run(ticks: LooseTick[], world: Record<string, unknown> = {}): RunOutcome {
  return {
    plan: { ...plan0, scenario: "earthquake", night: false },
    drillId: "d1",
    status: "finished",
    advances: ticks.length,
    replay: { drill: { id: "d1", scenario: "earthquake", status: "finished", step: ticks.length - 1 }, hour: 72, minute: 4320, actions: [], world: { ...baseWorld, ...world }, ticks, rows: [] },
    ops: [],
    errors: [],
    aiCalls: [],
    callsLeft: 100,
    names: {},
    worldAgent: null,
  } as unknown as RunOutcome;
}
const turn = (person: string, minute: number, more: Partial<LooseTurn> = {}): LooseTurn => ({ person, at: minute / 60, color: "red", source: "family", ai: true, saying: null, atHome: true, ...more });
const tick = (step: number, minute: number, turns: LooseTurn[], incidents: LooseTick["incidents"] = []): LooseTick => ({ step, hour: minute / 60, incidents, turns });
const rules = (o: RunOutcome, person?: string, people = CTX.facts!) => factHits(o, people).hits.filter((h) => !person || h.person === person).map((h) => h.rule);

const DOWN = "p-02";
const plan = CTX.facts![DOWN].plan;
const CUT = Math.round((plan.devices[0].hours! + plan.spares[0].hours!) * 60);
const OUT = { outage: { area: { scope: "office" }, since: 0, restoredAt: null } };
const END = tick(99, 4320, []);
/** from から to まで every 分ごとの連絡 */
const contacts = (person: string, from: number, to: number, every: number): LooseTick[] => {
  const out: LooseTick[] = [];
  for (let m = from, i = 0; m < to; m += every, i += 1) out.push(tick(i, m, [turn(person, m, { saying: `連絡 ${i} 件目です。ことばを変えます ${"あいうえおかきくけこ"[i % 10]}` })]));
  return out;
};

describe("止まったままの長い間の無連絡（down_gap）", () => {
  it("止まった時刻から終わりまで、間が上限を超えた所を数える。超えなければ数えない", () => {
    expect(rules(run([...contacts(DOWN, CUT + 120, 4320, DOWN_GAP_MINUTES), END], OUT), DOWN)).not.toContain("down_gap");
    const hits = factHits(run([...contacts(DOWN, CUT + 120, CUT + 700, 240), END], OUT), CTX.facts!).hits.filter((h) => h.person === DOWN && h.rule === "down_gap");
    expect(hits).toHaveLength(1);
    expect(hits[0].minute).toBeGreaterThan(CUT);
  });

  it("電気が戻る・電源が届く・家の外へ移るまでの間だけ見る", () => {
    const short = [tick(0, CUT + 60, [turn(DOWN, CUT + 60)]), END];
    const back = (CUT + 60 + DOWN_GAP_MINUTES - 10) / 60;
    expect(rules(run(short, { outage: { area: { scope: "office" }, since: 0, restoredAt: back } }), DOWN)).not.toContain("down_gap");
    expect(rules(run(short, { ...OUT, supplies: { [DOWN]: { power: CUT + 200 } } }), DOWN)).not.toContain("down_gap");
    const moved = [tick(0, CUT + 60, [turn(DOWN, CUT + 60, { color: "green", atHome: null, whereNow: "shelter" })]), END];
    expect(rules(run(moved, OUT), DOWN)).not.toContain("down_gap");
  });

  it("人の到着も連絡に数える。結末の人は見ない", () => {
    const every = (minute: number) => ({ person: DOWN, role: "vendor", arrive: minute, back: minute, arrived: true, from: "a1" });
    const arrivals = [];
    for (let m = CUT + 600; m < 4320; m += 600) arrivals.push(every(m));
    expect(rules(run([END], { ...OUT, arrivals }), DOWN)).not.toContain("down_gap");
    expect(rules(run([END], { ...OUT, ended: { [DOWN]: { kind: "x" } } }), DOWN)).not.toContain("down_gap");
  });

  it("全域の電波の不通の間は通信の道が無いので別に数え、守りに入れない", () => {
    const off = { kind: "radio", state: "down" };
    const r = rules(run([tick(0, CUT, [], [{ at: CUT / 60, change: off, text: "携帯の基地局の停止" }] as never), END], OUT), DOWN);
    expect(r).toContain("down_isolated");
    expect(r).not.toContain("down_gap");
  });

  it("離れた家族がいない人の家の電波の不通も別に数える。離れた家族がいれば down_gap", () => {
    const A = "p-01";
    const rain = { ...OUT, outage: { area: { scope: "office" }, since: 0, restoredAt: null } };
    const people = { ...CTX.facts!, [A]: { ...CTX.facts![A], farPress: false } };
    const rainRun = { ...run([END], rain), plan: { ...plan0, scenario: "heavy_rain", night: false } } as RunOutcome;
    expect(rules(rainRun, A, people)).toContain("down_isolated");
    expect(rules(rainRun, A)).toContain("down_gap");
  });

  it("前と同じ言い方の連絡を数える（守りなし）", () => {
    const same = "機械は止まったままで、業者を待っています。";
    const r = rules(run([tick(0, CUT + 60, [turn(DOWN, CUT + 60, { saying: same })]), tick(1, CUT + 400, [turn(DOWN, CUT + 400, { saying: same })]), END], OUT), DOWN);
    expect(r).toContain("down_repeat");
    expect(GUARDS.some((g) => g.item === "count:drill:facts:down_repeat")).toBe(false);
  });

  it("守り: 1 件までは通り、2 件で外れる", () => {
    const f = (n: number) => guardFindings({ bench: "drill", run: "r12", values: {}, counts: { "drill:facts:down_gap": n }, repro: ["x"] }).some((x) => x.cause === "guard:drill-down-gap");
    expect(f(1)).toBe(false);
    expect(f(2)).toBe(true);
  });
});

describe("同じ刻みの出来事と連絡", () => {
  const P = "p-04";
  const wander = (minute: number) => ({ person: P, at: minute / 60, change: { kind: "mark", mark: "wandering" }, text: "本人が家の外へ出た", ai: true, inject: "wandering" });

  it("いる所を変える出来事と同じ時刻に家の連絡があれば数える。連絡が前か、家と言わなければ数えない", () => {
    expect(rules(run([tick(0, 540, [turn(P, 540, { color: "green", whereNow: "home", atHome: null })], [wander(540)] as never), END]), P)).toContain("same_cut_place");
    expect(rules(run([tick(0, 600, [turn(P, 540, { color: "green", whereNow: "home", atHome: null })], [wander(600)] as never), END]), P)).not.toContain("same_cut_place");
    expect(rules(run([tick(0, 540, [turn(P, 540, { atHome: false })], [wander(540)] as never), END]), P)).not.toContain("same_cut_place");
  });

  it("同居の家族のいる人の家族の帰宅困難を数える", () => {
    const stranded = (person: string) => ({ person, at: 7, change: { kind: "mark", mark: "familyAway" }, text: "家族 帰宅困難", ai: false, filled: true, inject: "family_stranded" });
    expect(rules(run([tick(0, 420, [], [stranded("p-06")] as never), END]), "p-06")).toContain("family_away_together");
    expect(rules(run([tick(0, 420, [], [stranded("p-09")] as never), END]), "p-09")).not.toContain("family_away_together");
  });
});

describe("移ると言って記録の無い言い方の台の見え方", () => {
  it("移れる人の、行き先の語の無い言い方と読点を挟む言い方を数える", () => {
    const P = "p-10";
    for (const saying of ["これから移ります。", "夫を車で避難所へ、これから移ります。"]) {
      expect(rules(run([tick(0, 600, [turn(P, 600, { saying, color: "green", whereNow: "home", atHome: null })]), END]), P)).toContain("move_unrecorded");
    }
    expect(rules(run([tick(0, 600, [turn(P, 600, { saying: "車が来たら移ります。", color: "green", whereNow: "home", atHome: null })]), END]), P)).not.toContain("move_unrecorded");
  });
});
