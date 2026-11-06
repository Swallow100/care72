// T174: 評価の 9 回目の「直す所」の台の口。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { DOWN_FOLLOW_MINUTES } from "../../../lib/drill/person-facts.ts";
import { worldNameHits } from "./checks.ts";
import type { LooseAction, LooseTick, LooseTurn, RunOutcome } from "./drive.ts";
import { DOWN_SILENT_MINUTES, factHits } from "./facts-check.ts";
import { planRun } from "./plan.ts";
import type { AiRecord } from "./record.ts";
import { checkContext } from "./run.ts";
import { GUARDS, guardFindings } from "../guards.ts";

const room = (events: ReadonlyArray<Record<string, string>>, seq = 1): AiRecord =>
  ({ type: "ai", seq, role: "world_room", returned: { stopReason: "end_turn", text: JSON.stringify([{ narration: "", events, farewells: [] }]), blocks: [] } }) as unknown as AiRecord;
const outcome = (labels: string[] = []): RunOutcome =>
  ({ replay: { ticks: [{ hour: 1, incidents: labels.map((label) => ({ change: { kind: "shelter", label } })) }] } }) as unknown as RunOutcome;
const ev = (kind: string, name: string, over: Record<string, string> = {}) => ({ kind, name, town: "", target: "", value: "", ...over });

describe("世界の返事で捨てた名前", () => {
  it("地理に無い道・施設・避難所を数える", () => {
    const r = worldNameHits([room([ev("road", "架空の県道"), ev("facility", "架空の施設"), ev("shelter", "架空の避難所")])], outcome());
    expect(r.numbers).toEqual({ total: 3, dropped: 3, byKind: { road: 1, facility: 1, shelter: 1 } });
    expect(r.hits.every((h) => h.check === "world_place" && h.rule.startsWith("dropped_name:"))).toBe(true);
  });

  it("道は地区か本人を書いていれば名前が無くても通る（捨てない）", () => {
    const r = worldNameHits([room([ev("road", "架空の県道", { town: "甲地区" }), ev("road", "架空の市道", { target: "A さん" })])], outcome());
    expect(r.numbers).toEqual({ total: 2, dropped: 0, byKind: {} });
  });

  it("開始の時に読んだ実の避難所は、出来事に出た名前を地理に足して見る", () => {
    expect(worldNameHits([room([ev("shelter", "実の小学校")])], outcome(["実の小学校"])).numbers.dropped).toBe(0);
  });

  it("名前の無い出来事と、ほかの役の返事は見ない", () => {
    const other = { type: "ai", seq: 2, role: "director", returned: { stopReason: "end_turn", text: JSON.stringify({ events: [ev("road", "架空の県道")] }), blocks: [] } } as unknown as AiRecord;
    expect(worldNameHits([room([ev("road", "")]), other], outcome()).numbers).toEqual({ total: 0, dropped: 0, byKind: {} });
  });

  it("1 回呼びの返事（world）も見る", () => {
    const one = { type: "ai", seq: 3, role: "world", returned: { stopReason: "end_turn", text: JSON.stringify({ narration: "", events: [ev("facility", "架空の施設")], farewells: [] }), blocks: [] } } as unknown as AiRecord;
    expect(worldNameHits([one], outcome()).numbers.dropped).toBe(1);
  });
});

// ---------- 帳面の検査（手で組んだ回） ----------

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
/** その人の帳面の検査の決まり（種の酸素の人も停電で数えられるので、見る人で絞る） */
const rulesOf = (o: RunOutcome, person?: string) => factHits(o, CTX.facts!).hits.filter((h) => !person || h.person === person).map((h) => h.rule);

// 呼吸器の人（種の p-02。内蔵 3 時間 + 予備 3 時間の見込み）
const DOWN = "p-02";
const plan = CTX.facts![DOWN].plan;
const CUT = Math.round((plan.devices[0].hours! + plan.spares[0].hours!) * 60);
const OUT = { outage: { area: { scope: "office" }, since: 0, restoredAt: null } };
const endTick = tick(9, 72, []);

describe("機器が止まったあとの検査", () => {
  it("切れた時刻ちょうどの知らせだけでは足りない。そのあと 4 時間の連絡が無ければ数える", () => {
    expect(rulesOf(run([tick(0, CUT / 60, [turn(DOWN, CUT / 60, "red", { atHome: true })]), endTick], [], OUT), DOWN)).toContain("down_silent");
    const later = (CUT + DOWN_FOLLOW_MINUTES[0]) / 60;
    expect(DOWN_FOLLOW_MINUTES[0]).toBeLessThan(DOWN_SILENT_MINUTES);
    expect(rulesOf(run([tick(0, later, [turn(DOWN, later, "red", { atHome: true })]), endTick], [], OUT), DOWN)).not.toContain("down_silent");
  });

  it("電気が戻った・電源が届いた・家の外へ移った人は数えない", () => {
    const silent = [tick(0, 1, [turn(DOWN, 1, "red", { atHome: true })]), endTick];
    expect(rulesOf(run(silent, [], { outage: { area: { scope: "office" }, since: 0, restoredAt: (CUT + 60) / 60 } }), DOWN)).not.toContain("down_silent");
    expect(rulesOf(run(silent, [], { ...OUT, supplies: { [DOWN]: { power: CUT + 60 } } }), DOWN)).not.toContain("down_silent");
    expect(rulesOf(run(silent, [], { ...OUT, arrivals: [{ person: DOWN, role: "transport", arrive: 100, back: 100, arrived: true, from: "a1" }] }), DOWN)).not.toContain("down_silent");
  });

  it("押せる人のいない人は数えない", () => {
    const people = { ...CTX.facts!, [DOWN]: { ...CTX.facts![DOWN], canPress: false } };
    expect(factHits(run([endTick], [], OUT), people).hits.filter((h) => h.person === DOWN).map((h) => h.rule)).not.toContain("down_silent");
  });

  it("予備も外の電源も無い機器は内蔵が切れた時刻から数える", () => {
    const people = { ...CTX.facts!, [DOWN]: { ...CTX.facts![DOWN], plan: { ...plan, spares: [] } } };
    const hits = factHits(run([endTick], [], OUT), people).hits.filter((h) => h.rule === "down_silent" && h.person === DOWN);
    expect(hits[0]?.minute).toBe(Math.round(plan.devices[0].hours! * 60));
  });

  it("止まったまま家にいる間の AI の緑を数える。止まる前・AI の失敗で表の固定の言葉に戻った物・戻ったあとは数えない", () => {
    const h = (CUT + 30) / 60;
    expect(rulesOf(run([tick(0, h, [turn(DOWN, h, "green", { whereNow: "home" })]), endTick], [], OUT), DOWN)).toContain("down_green");
    expect(rulesOf(run([tick(0, 1, [turn(DOWN, 1, "green", { whereNow: "home" })]), endTick], [], OUT), DOWN)).not.toContain("down_green");
    expect(rulesOf(run([tick(0, h, [turn(DOWN, h, "green", { whereNow: "home", ai: false })]), endTick], [], OUT), DOWN)).not.toContain("down_green");
    expect(rulesOf(run([tick(0, h, [turn(DOWN, h, "green", { whereNow: "home" })]), endTick], [], { outage: { area: { scope: "office" }, since: 0, restoredAt: CUT / 120 } }), DOWN)).not.toContain("down_green");
  });
});

describe("出られない本人の電話の検査", () => {
  const act = (person: string, more: Record<string, unknown>): LooseAction => ({ id: "a1", person, kind: "call_person", callee: "self", atMinute: 120, result: { atMinute: 120, status: "connected", speech: "はい。", ...more } }) as unknown as LooseAction;

  it("出られない人が話したら数える。代わりの人の記録があれば数えない。出られる人は数えない", () => {
    expect(rulesOf(run([endTick], [act(DOWN, {})]))).toContain("self_answer");
    expect(rulesOf(run([endTick], [act(DOWN, { answeredBy: "夫" })]))).not.toContain("self_answer");
    expect(rulesOf(run([endTick], [act("p-01", {})]))).not.toContain("self_answer");
  });
});

describe("道の開通と言葉の検査（その時の道で見る）", () => {
  const P = "p-07";
  const road = (open: boolean, at: number) => ({ at, person: P, actor: "director", text: "道", change: { kind: "road", id: "rd-x", label: "家の前の道", open } }) as never;

  it("開いたあとに通れないと言う・閉じているのに通れたと言うを数える", () => {
    expect(rulesOf(run([tick(0, 2, [turn(P, 2, "red", { atHome: true, saying: "道が通れるようになりました。" })], [road(false, 1)]), endTick]))).toContain("road_said");
    expect(rulesOf(run([tick(0, 2, [turn(P, 2, "red", { atHome: true, saying: "道が通れません。" })], [road(true, 1)]), endTick]))).toContain("road_said");
  });

  it("その時の道と合っていれば、あとで道が変わっても数えない", () => {
    const o = run([tick(0, 2, [turn(P, 2, "red", { atHome: true, saying: "道が通れません。" })], [road(false, 1)]), tick(1, 9, [turn(P, 9, "red", { atHome: true, saying: "道が通れるようになりました。" })], [road(true, 8)]), endTick], [], { roads: [{ id: "rd-x", label: "家の前の道", open: true, person: P }] });
    expect(rulesOf(o)).not.toContain("road_said");
  });

  it("土砂の人が水を訳に挙げたら数える。地区の道の開通で土砂の道も開く", () => {
    const slide = { at: 1, actor: "director", text: "土砂", change: { kind: "landslide", town: "甲", persons: [P] } } as never;
    const reopen = { at: 3, actor: "director", text: "道", change: { kind: "town_road", road: "town-甲地区", label: "甲の道", open: true, persons: [P] } } as never;
    expect(rulesOf(run([tick(0, 2, [turn(P, 2, "red", { atHome: true, saying: "家の辺りが水で車を出せません。" })], [slide]), endTick]))).toContain("road_said");
    expect(rulesOf(run([tick(0, 2, [], [slide]), tick(1, 3, [turn(P, 3, "red", { atHome: true, saying: "道が通れるようになりました。" })], [reopen]), endTick]))).not.toContain("road_said");
  });
});

describe("守りの表", () => {
  it("T174 の守りが r10 から入り、外れたら指摘になる", () => {
    const ids = GUARDS.filter((g) => g.task === "T174").map((g) => g.id);
    expect(ids).toEqual(["drill-down-silent", "drill-down-green", "drill-calm-while-down", "drill-self-answer", "drill-road-said"]);
    const out = guardFindings({ bench: "drill", run: "r10", values: {}, counts: { "drill:facts:down_silent": 2 }, repro: ["x"] });
    expect(out.some((f) => f.cause === "guard:drill-down-silent" && f.severity === "high")).toBe(true);
    expect(guardFindings({ bench: "drill", run: "r10", values: {}, counts: { "drill:facts:down_silent": 1 }, repro: ["x"] }).some((f) => f.cause === "guard:drill-down-silent")).toBe(false);
  });
});
