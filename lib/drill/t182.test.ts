// T182: 11/7 夜の見直しの訓練の不具合。形は見直しの再現の台から起こし直した（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { foldTick, initialState, timeOf, type DrillTurn } from "./engine.ts";
import { createClockHooks } from "./hooks.ts";
import { factsOf, placeOfState, planOf } from "./person-facts.ts";
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
