// 着信の選び方（docs/tasks/T21.md）のテスト。電話の形（家族・支援者の言う事のある連絡）、1 刻みに 2 件まで、同じ人は 1 件、
// 赤が先、相手の言い方。想定の表で大雨 1 時間の小林の夫が着信になる（11/3 07:0x の確定 3）。D1 を使わない。

import { describe, expect, it } from "vitest";
import { callerLabel, callIndexes, callsOf, CALLS_PER_TICK, isPhoneTurn } from "./calls.ts";
import { initialState, step, type DrillTurn } from "./engine.ts";
import { SCENARIOS, SCENARIO_ORDER } from "./scenarios.ts";

const START = "2026-11-05T01:00:00.000Z";
const TEN = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09", "p-10"];

function turn(over: Partial<DrillTurn>): DrillTurn {
  return {
    person: "p-01",
    color: "green",
    source: "family",
    whereNow: "home",
    injured: null,
    atHome: null,
    canMove: null,
    hasMedicine: null,
    saying: "家にいます",
    doing: null,
    ai: false,
    at: 1,
    ...over,
  };
}

describe("電話の形", () => {
  it("家族・支援者の言う事のある連絡は電話。本人・言う事なし・赤の 4 問に答えた物はボタン", () => {
    expect(isPhoneTurn(turn({}))).toBe(true);
    expect(isPhoneTurn(turn({ source: "supporter" }))).toBe(true);
    expect(isPhoneTurn(turn({ source: "agent" }))).toBe(false);
    expect(isPhoneTurn(turn({ saying: null }))).toBe(false);
    expect(isPhoneTurn(turn({ saying: "  " }))).toBe(false);
    // 家族の赤: 4 問に答えた物は赤ボタン、言う事だけの物（「酸素ボンベが残り少ない」）は電話
    expect(isPhoneTurn(turn({ color: "red", injured: true }))).toBe(false);
    expect(isPhoneTurn(turn({ color: "red", canMove: false }))).toBe(false);
    expect(isPhoneTurn(turn({ color: "red" }))).toBe(true);
  });

  it("1 刻みに 2 件まで。赤が先、次に時刻の早い順、同じなら表の順。同じ人は 1 件（いちばん早い物）", () => {
    const turns = [
      turn({ person: "p-03", at: 1 }),
      turn({ person: "p-06", at: 0 }),
      turn({ person: "p-02", at: 1, color: "red" }),
      turn({ person: "p-10", at: 0 }),
      turn({ person: "p-07", source: "agent", at: 0 }),
    ];
    expect(callIndexes(turns)).toEqual([2, 1]);
    expect(callsOf(turns).map((t) => t.person)).toEqual(["p-02", "p-06"]);
    expect(CALLS_PER_TICK).toBe(2);
    // 10 分版で同じ人の連絡が 2 つ寄っても 1 回
    const same = [turn({ person: "p-02", at: 1 }), turn({ person: "p-02", at: 3 }), turn({ person: "p-06", at: 3 })];
    expect(callsOf(same).map((t) => [t.person, t.at])).toEqual([
      ["p-02", 1],
      ["p-06", 3],
    ]);
    expect(callIndexes([])).toEqual([]);
  });

  it("相手の言い方: 家族が 1 人なら続柄まで、何人かなら区分だけ。名前と番号は出さない", () => {
    const husband = [{ kind: "family" as const, label: "家族 夫" }, { kind: "visiting_nurse" as const, label: "訪問看護" }];
    expect(callerLabel("family", husband)).toBe("家族 夫");
    expect(callerLabel("family", [...husband, { kind: "family", label: "家族 娘" }])).toBe("家族");
    expect(callerLabel("supporter", [{ kind: "welfare_commissioner", label: "民生委員" }])).toBe("民生委員");
    expect(callerLabel("supporter", [])).toBe("支援者");
    expect(callerLabel("agent", husband)).toBe("本人");
  });
});

describe("想定の表の着信", () => {
  it("大雨 1 時間: 小林の夫の電話（緑・家、呼吸器の電池）が表の固定の行で、着信になる（Haiku 任せにしない）", async () => {
    let s = initialState("heavy_rain", TEN, START);
    const ticks = [];
    for (let i = 0; i < 2; i++) {
      const r = await step(s);
      s = r.state;
      ticks.push(r.tick);
    }
    const row = SCENARIOS.heavy_rain.ticks[1].turns.find((t) => t.person === "p-02");
    expect(row).toMatchObject({ color: "green", source: "family", whereNow: "home" });
    expect(row?.saying).toContain("呼吸器");
    expect(callsOf(ticks[1].turns).map((t) => [t.person, t.source, t.saying])).toEqual([
      ["p-02", "family", row?.saying],
    ]);
    // 0 時間は田中・高橋の家族の電話（言う事のある緑）。言う事の無い渡辺の家族はボタン
    expect(callsOf(ticks[0].turns).map((t) => t.person).sort()).toEqual(["p-03", "p-06"]);
  });

  it("10 分版は 3 時間の刻みに 1 時間の小林の夫が寄り、着信になる（元の時刻 1 時間）", async () => {
    let s = initialState("short", TEN, START);
    let tick;
    for (let i = 0; i < 2; i++) {
      const r = await step(s);
      s = r.state;
      tick = r.tick;
    }
    expect(tick!.hour).toBe(3);
    expect(callsOf(tick!.turns).map((t) => [t.person, t.at])).toEqual([
      ["p-02", 1],
      ["p-06", 3],
    ]);
  });

  it("どの想定のどの刻みも着信は 2 件まで", async () => {
    for (const id of SCENARIO_ORDER) {
      let s = initialState(id, TEN, START);
      for (let i = 0; i < SCENARIOS[id].hours.length; i++) {
        const r = await step(s);
        s = r.state;
        expect(callIndexes(r.tick.turns).length, `${id} ${r.tick.hour} 時間`).toBeLessThanOrEqual(CALLS_PER_TICK);
      }
    }
  });
});
