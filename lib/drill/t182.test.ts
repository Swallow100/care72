// T182: 11/7 夜の見直しの訓練の不具合。形は見直しの再現の台から起こし直した（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { advance, floodDepthOf, foldTick, initialState, timeOf, type DrillTurn, type PersonaInput } from "./engine.ts";
import { DRILL_END_MINUTE } from "./clock.ts";
import type { DirectorEvent } from "./incident-types.ts";
import { homeOf } from "./comms.ts";
import { createClockHooks } from "./hooks.ts";
import { carryMoved, dropRoadSlips, factsOf, placeOfState, placeReplyOf, planOf } from "./person-facts.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { clockOfMinute, clockWhen, dayLine, startHourOf } from "./night.ts";
import { simTimeText } from "./time-text.ts";

describe("1. 発災の時刻の分", () => {
  const startedAt = "2026-11-04T01:50:00.000Z"; // 日本の 10:50

  it("帳面の時計が画面の時刻とそろう（分で切り捨てない）", () => {
    const s = timeOf({ startedAt });
    expect(simTimeText(startedAt, 410)).toContain("17:40");
    expect(clockWhen(410, s.startHour!, 410)).toBe("17 時 40 分ごろ");
    expect(clockOfMinute(410, s.startHour!)).toEqual({ day: 1, hour: 17, min: 40 });
  });

  it("時ちょうどの発災は前と同じ", () => {
    expect(startHourOf("2026-11-05T01:00:00.000Z")).toBe(10);
    expect(dayLine(36, 10)).toContain("発災は 10 時ごろ。今は 2 日目の 22 時ごろ");
  });

  it("今の時刻の 1 行も分で数える（10:50 から 1 時間 10 分は 12 時）", () => {
    const h = startHourOf(startedAt)!;
    expect(dayLine(70 / 60, h)).toContain("発災は 10 時 50 分ごろ。今は 12 時ごろ");
    expect(dayLine(13.5, h)).toContain("今は 2 日目の 0 時ごろ");
  });

  it("浮動小数で分がずれない（日をまたぐ分も）", () => {
    for (let m = 0; m < 60; m++) {
      const at = `2026-11-04T14:${String(m).padStart(2, "0")}:00.000Z`; // 日本の 23:mm
      const h = startHourOf(at)!;
      expect(clockOfMinute(0, h)).toEqual({ day: 1, hour: 23, min: m });
      expect(clockOfMinute(60, h)).toEqual({ day: 2, hour: 0, min: m });
    }
  });
});

const seedInput = (id: string) => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const clockSources = () => new Map(SEED_PEOPLE.map((p) => [p.person.id, { ledger: p.ledger, clocks: p.clocks.map((k) => ({ ...k, person_id: p.person.id })) }] as const));
const turnOf = (person: string, at: number, x: Partial<DrillTurn>): DrillTurn => ({
  person,
  color: "green",
  source: "agent",
  whereNow: "home",
  at,
  saying: null,
  doing: null,
  injured: null,
  atHome: null,
  canMove: null,
  hasMedicine: null,
  ai: true,
  ...x,
});

describe("2. 計画の手段で移った人の機器の呼び出し", () => {
  it("着く時刻のあとは止まったままの呼び出しを出さない（着く前は出す）", async () => {
    const ID = "p-01";
    const plan = planOf(seedInput(ID));
    const device = plan.devices[0];
    const spare = plan.spares.find((s) => s.category === device.category)!;
    const SINCE = 1;
    const CUT = Math.round((SINCE + device.hours! + spare.hours!) * 60);
    const world: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "hazard", hazard: "flood", minDepthM: 3 }, since: SINCE, restoredAt: null } };
    const ARRIVE = CUT + 150;
    // 切れたあとに移り始めた連絡（門が付ける形: いる所は家のまま、移った事は記録に）
    const turn = turnOf(ID, (CUT + 30) / 60, { saying: "これから移ります。", move: { to: "shelter", at: ARRIVE, by: "plan" } });
    const base = { ...initialState("heavy_rain", [ID], "2026-11-05T01:00:00.000Z", { clock: true }), world };
    const st = foldTick(base, { step: 1, hour: (CUT + 30) / 60, incidents: [], turns: [turn] }, 99);
    expect(placeOfState(st.people[ID]!)).toBe("home");
    expect(factsOf({ person: ID, world, state: st.people[ID]!, actions: [], now: CUT + 300, plan, inOutage: true }).place?.where).toBe("shelter");
    const hooks = createClockHooks({ loadOutcome: async () => clockSources() as never });
    const downs = (await hooks.marks!({ ...st, minute: CUT + 30 } as never)).filter((m) => m.person === ID && m.kind === "down").map((m) => m.at);
    expect(downs.filter((at) => at >= ARRIVE)).toEqual([]);
    // 記録が無ければ前と同じに呼ぶ（呼び出しを減らしすぎない）
    const { moved: _m, ...stay } = st.people[ID]!;
    const still = (await hooks.marks!({ ...st, minute: CUT + 30, people: { ...st.people, [ID]: stay } } as never)).filter((m) => m.person === ID && m.kind === "down");
    expect(still.some((m) => m.at >= ARRIVE)).toBe(true);
  });
});

describe("3. 赤の「家にいない」（どこか分からない）", () => {
  it("移った記録にせず、いる所の問いに言い切らない", () => {
    const ID = "p-10";
    const turn = turnOf(ID, 2, { color: "red", source: "family", whereNow: null, saying: "家にいないようです。", atHome: false });
    const st = foldTick(initialState("heavy_rain", [ID], "2026-11-05T01:00:00.000Z", { clock: true }), { step: 1, hour: 2, incidents: [], turns: [turn] }, 99);
    expect(st.people[ID]?.moved).toBeUndefined();
    const f = factsOf({ person: ID, world: EMPTY_WORLD, state: st.people[ID]!, actions: [], now: 300, plan: planOf(seedInput(ID)), inOutage: false });
    expect(f.place?.loose).toBe(true);
    expect(placeReplyOf(f)).toBeNull();
  });

  it("避難所と言った「家にいない」と、前からの記録は今まで通り", () => {
    expect(carryMoved(null, { color: "red", whereNow: null, atHome: false, at: 2, saying: "避難所にいます。" })).toEqual({ to: "shelter", at: 120, by: "turn" });
    const before = { to: "shelter" as const, at: 60, by: "plan" as const };
    expect(carryMoved({ moved: before }, { color: "red", whereNow: null, atHome: false, at: 2, saying: "家にいないようです。" })).toEqual(before);
    expect(carryMoved(null, { color: "green", whereNow: "other", at: 2 })).toEqual({ to: "other", at: 120, by: "turn" });
  });
});

describe("4. 遅れて当たった道の出来事の門と浸水の区域", () => {
  const ID = "p-01";
  const world: WorldState = { ...EMPTY_WORLD, flood: true, roads: [{ id: `rd-x-${ID}`, label: "家の前の道", open: true, person: ID }] } as WorldState;

  it("川の氾濫の区域の人の「冠水で通れない」を落とさない（帳面と同じ深さで見る）", () => {
    const plan = planOf(seedInput(ID));
    expect(plan.floodM ?? 0).toBeGreaterThanOrEqual(3);
    expect(factsOf({ person: ID, world, state: null, actions: [], now: 600, plan, inOutage: false }).blocked).toBe(true);
    const floodM = floodDepthOf({ [ID]: homeOf(seedInput(ID).ledger) }, ID);
    expect(floodM).toBe(plan.floodM);
    const said = "家の前の道が冠水して通れません。待っています。";
    expect(dropRoadSlips(said, world, ID, undefined, floodM)).toBe(said);
    // 深さが分からない（家を写していない）まま川の氾濫の間は、閉じているかを決めず落とさない
    expect(dropRoadSlips(said, world, ID)).toBe(said);
    // 浸水の区域でない人は前と同じに落とす
    expect(dropRoadSlips(said, world, ID, undefined, null)).toBe("待っています。");
  });

  it("家を写していない訓練の深さは分からない、区域の無い家は null", () => {
    expect(floodDepthOf(undefined, ID)).toBeUndefined();
    expect(floodDepthOf({ [ID]: { zones: [], town: null, landline: true, mobile: false } }, ID)).toBeNull();
  });
});

describe("5. 72 時間の近くで次へ回した監督の出来事", () => {
  const P = "p-04";
  const start = () => initialState("earthquake", SEED_PEOPLE.map((p) => p.person.id), "2026-11-07T01:00:00.000Z", { clock: true });
  const wander: DirectorEvent = { inject: "wandering", person: P, text: "本人が家の外へ出て行き先が分からない", ai: true };
  const hooks = {
    director: async () => [wander],
    persona: async (input: PersonaInput): Promise<DrillTurn[]> => (input.person === P ? [turnOf(P, input.hour, { source: "supporter", saying: "様子を見ました。" })] : []),
  } as never;

  it("回す時刻を 72 時間で切り、72 時間の区切りで当たる", async () => {
    const first = await advance(start(), 0, {} as never, { policy: "clock" } as never);
    const a = await advance(first!.state, DRILL_END_MINUTE - 30, hooks, { policy: "clock" } as never);
    expect(a!.state.world.scheduled?.map((s) => s.at)).toEqual([DRILL_END_MINUTE]);
    const b = await advance(a!.state, DRILL_END_MINUTE, { persona: async () => [] } as never, { policy: "clock" } as never);
    expect(b!.tick.finished).toBe(true);
    expect(b!.tick.incidents.some((e) => e.person === P && e.change.kind === "mark")).toBe(true);
    expect(b!.state.world.scheduled ?? []).toEqual([]);
  });

  it("72 時間の区切りで回す物は残さない（次の区切りが無い）", async () => {
    const first = await advance(start(), 0, {} as never, { policy: "clock" } as never);
    const b = await advance(first!.state, DRILL_END_MINUTE, hooks, { policy: "clock" } as never);
    expect(b!.tick.finished).toBe(true);
    expect((b!.state.world.scheduled ?? []).filter((s) => s.at >= DRILL_END_MINUTE)).toEqual([]);
  });
});
