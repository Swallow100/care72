// T125 区域の出来事・通信の段・連絡の経路・上の帯・対象の関数のテスト（docs/tasks/T125.md）。Claude を呼ばない。
// 種の 10 人の家（台帳の区域と連絡手段）: p-01 洪水 3 m・固定電話とスマホ、p-02 洪水 3 m・固定電話だけ、p-05 洪水 0.5 m・固定電話だけ、
// p-07 土砂・スマホ、p-08 津波・スマホ、p-09 区域なし・スマホ、p-10 区域なし・固定電話だけ

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { actionTerm, termFactsOf, termsFor, type TermSource } from "./action-terms.ts";
import { act, ActionBlocked } from "./actions.ts";
import { isPhoneTurn } from "./calls.ts";
import { commsOf, homeOf, radioDownAt, routeTurns, viaOf, homeComms, type Homes } from "./comms.ts";
import { advance, initialState, type DrillState } from "./engine.ts";
import { FIT_PROFILES } from "./fit.ts";
import { drillHeaderMark, headerMarkText } from "./header-mark.ts";
import { demoOverlay } from "../map/demo.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { targetsOf } from "./targets.ts";
import { bandsOf } from "./view.ts";
import type { DrillTurn } from "./persona-types.ts";
import { decideWorldReply } from "./world-reply.ts";

const START = "2026-11-05T01:00:00.000Z"; // 日本の 10 時（昼）
const ALL = SEED_PEOPLE.map((p) => p.person.id);
const HOMES: Homes = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, homeOf(p.ledger)]));

const src = (scenario: TermSource["scenario"], world: Partial<WorldState>, minute = 60, extra: Partial<TermSource> = {}): TermSource => ({
  scenario,
  startedAt: START,
  minute,
  world: { ...EMPTY_WORLD, staff: 2, ...world },
  options: { terms: true, clock: true },
  homes: HOMES,
  ...extra,
});

const EQ_0H: Partial<WorldState> = { quake: "6強", tsunami: "evacuate", outage: { area: { scope: "office" }, since: 0, restoredAt: null }, phone: "down" };

describe("区域の出来事は区域の人と事業所だけ（手の所要）", () => {
  it("地震の津波警報の間: 河川の洪水の区域の人の訪問に「浸水」を付けない。津波の区域の人には付ける", () => {
    const s = src("earthquake", EQ_0H);
    const river = termsFor(s, "p-05").visit;
    expect(river.adds).not.toContain("浸水");
    expect(river.minutes).toBe(40);
    const coast = termsFor(s, "p-08").visit;
    expect(coast.adds).toContain("浸水");
    expect(coast.minutes).toBe(60);
    // 津波警報が解除されたら付けない
    expect(termsFor(src("earthquake", { ...EQ_0H, tsunami: "lifted" }), "p-08").visit.adds).not.toContain("浸水");
  });

  it("大雨の警戒レベル 4: 洪水の区域の人だけ「浸水」。区域なしの人には付けない", () => {
    const s = src("heavy_rain", { alertLevel: 4 });
    expect(termsFor(s, "p-05").visit.adds).toContain("浸水");
    expect(termsFor(s, "p-09").visit.adds).not.toContain("浸水");
  });

  it("事業所が津波の区域なら、警報の間は自分の訪問と職員の訪問依頼を出せない（避難中）。外の相手の訪問依頼は出せる", () => {
    const s = src("earthquake", EQ_0H, 60, { officeZones: ["tsunami"] });
    const t = termsFor(s, "p-09");
    expect(t.visit.block).toBe("避難中");
    expect(t.dispatch.targets.fixed).toBe("避難中");
    expect(t.dispatch.targets.visiting_nurse).toBeUndefined();
    expect(termsFor(src("earthquake", { ...EQ_0H, tsunami: "lifted" }, 60, { officeZones: ["tsunami"] }), "p-09").visit.block).toBeNull();
  });
});

describe("通信の段", () => {
  it("通話の規制（地震 0〜12 時間）は全部を止めない: 事業所の職員への訪問依頼は打てる。電話の手は所要が伸びる", async () => {
    const s = src("earthquake", EQ_0H);
    const t = termsFor(s, "p-09");
    expect(t.dispatch.block).toBeNull();
    expect(t.dispatch.targets.fixed).toBeUndefined();
    expect(t.call_contact.block).toBeNull();
    expect(t.call_contact.adds).toContain("規制");
    // 世界の返事: 職員は電話なしで出せる（事務所で頼む）
    expect(decideWorldReply({ action: "dispatch", person: "p-09", callee: null, world: { ...EMPTY_WORLD, ...EQ_0H, staff: 2 } as WorldState, hour: 1 }, 0).status).toBe("dispatched");
    // 打てる（決まりで断らない）
    let state: DrillState = initialState("earthquake", ALL, START, { clock: true, terms: true }, {}, { homes: HOMES });
    state = (await advance(state, 0, {}))!.state;
    expect(state.world.phone).toBe("down");
    const out = await act(state, { kind: "dispatch", person: "p-09", target: null }, {}, () => 0);
    expect(out.record.result?.status).toBe("dispatched");
  });

  it("停電の家の固定電話は使えない: 固定電話だけの人に本人電話は打てない（通話不可）。スマホのある人は打てる", () => {
    const s = src("earthquake", EQ_0H);
    expect(termsFor(s, "p-02").call_person.block).toBe("通話不可");
    expect(termsFor(s, "p-01").call_person.block).toBeNull();
    // 停電が復旧したら固定電話も使える
    expect(termsFor(src("earthquake", { ...EQ_0H, outage: { area: { scope: "office" }, since: 0, restoredAt: 48 } }, 49 * 60), "p-02").call_person.block).toBeNull();
    // 世界の返事も同じ（決まりの表で押せない物は、返事も事実で外れ）
    const f = termFactsOf(s, "p-02");
    expect(decideWorldReply({ action: "call_person", person: "p-02", callee: "self", world: { ...EMPTY_WORLD, ...EQ_0H } as WorldState, hour: 1, selfLine: f.selfLine }, 0).status).toBe("noLine");
  });

  it("電波不通は、停電が想定の表の時間（24 時間）続いた表の区域の家（地震は津波・土砂の区域）。メッセージも届かない", () => {
    const w = { ...EMPTY_WORLD, ...EQ_0H } as WorldState;
    const quake = FIT_PROFILES.earthquake;
    expect(radioDownAt(w, quake, HOMES["p-08"], 23 * 60)).toBe(false);
    expect(radioDownAt(w, quake, HOMES["p-08"], 24 * 60)).toBe(true);
    expect(radioDownAt(w, quake, HOMES["p-09"], 30 * 60)).toBe(false);
    expect(termsFor(src("earthquake", EQ_0H, 30 * 60), "p-08").message.targets.self).toBe("電波不通");
    expect(termsFor(src("earthquake", EQ_0H, 10 * 60), "p-08").message.targets.self).toBeUndefined();
    // 携帯の無い人にはメッセージを送れない
    expect(termsFor(src("earthquake", EQ_0H, 10 * 60), "p-10").message.targets.self).toBe("携帯なし");
    expect(commsOf(w, quake, HOMES, 30 * 60)).toEqual({ voice: "down", radio: "area" });
    expect(commsOf({ ...w, radio: "down" }, quake, HOMES, 1)).toEqual({ voice: "down", radio: "all" });
  });

  it("メッセージの手: 返信なら本人役の言葉と聞いた安否（通話の規制の間も届く）", async () => {
    let state: DrillState = initialState("earthquake", ALL, START, { clock: true, terms: true }, {}, { homes: HOMES });
    state = (await advance(state, 0, {}))!.state;
    const out = await act(state, { kind: "message", person: "p-09", target: { id: "c-self", kind: "self", label: "本人", hasPhone: true } }, {}, () => 0);
    expect(out.record.result?.status).toBe("replied");
    expect(out.record.result?.ok).toBe(true);
    await expect(act(state, { kind: "message", person: "p-10", target: { id: "c-self", kind: "self", label: "本人", hasPhone: true } }, {}, () => 0)).rejects.toBeInstanceOf(ActionBlocked);
  });

  it("全域の電波不通（監督の差し込み）: 家族の携帯にかからない・メッセージも届かない。事業所（訪問看護・職員）は固定電話で頼める", () => {
    const s = src("earthquake", { ...EQ_0H, radio: "down" });
    const t = termsFor(s, "p-09");
    expect(t.call_contact.targets.family).toBe("電波不通");
    expect(t.message.targets.family).toBe("電波不通");
    expect(t.dispatch.targets.visiting_nurse).toBeUndefined();
    expect(t.dispatch.targets.fixed).toBeUndefined();
  });
});

describe("連絡の経路（着信は通話不可・電波不通の間に出さない）", () => {
  const turn = (over: Partial<DrillTurn>): DrillTurn => ({
    person: "p-09",
    color: "green",
    source: "family",
    whereNow: "home",
    injured: null,
    atHome: null,
    canMove: null,
    hasMedicine: null,
    saying: "家にいます",
    doing: null,
    ai: true,
    at: 6,
    ...over,
  });
  it("家族の言う事: 通話が規制の間は伝言（着信にしない）、不安定なら着信。言う事が無ければボタン", () => {
    const c = homeComms({ ...EMPTY_WORLD, phone: "down" }, null, "p-09", HOMES["p-09"], 360);
    expect(viaOf(turn({}), { ...EMPTY_WORLD, phone: "down" }, c)).toBe("message");
    expect(viaOf(turn({}), { ...EMPTY_WORLD, phone: "busy" }, c)).toBe("call");
    expect(viaOf(turn({ saying: null }), EMPTY_WORLD, c)).toBe("button");
    expect(isPhoneTurn(turn({ via: "message" }))).toBe(false);
    expect(isPhoneTurn(turn({ via: "call" }))).toBe(true);
    // 経路の無い前からの安否は前の見分け方
    expect(isPhoneTurn(turn({}))).toBe(true);
  });

  it("電波不通の家の本人の AI の安否は届かない（外して数える）。表の固定の行は外さない", () => {
    const w = { ...EMPTY_WORLD, ...EQ_0H } as WorldState;
    const r = routeTurns(
      [turn({ person: "p-08", source: "agent", saying: null, at: 30 }), turn({ person: "p-08", source: "agent", saying: null, at: 30, ai: false })],
      w,
      FIT_PROFILES.earthquake,
      HOMES,
    );
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0]).toMatchObject({ ai: false, via: "button" });
    expect(r.dropped).toEqual(["comms:radio"]);
  });

  it("地震の連続の時計: 通話が規制の 0〜12 時間に、表の家族・支援者の行は着信にならない（伝言）", async () => {
    let state: DrillState = initialState("earthquake", ALL, START, { clock: true }, {}, { homes: HOMES });
    const turns: DrillTurn[] = [];
    for (const to of [0, 180, 360, 540, 720]) {
      const r = (await advance(state, to, {}))!;
      state = r.state;
      turns.push(...r.tick.turns);
    }
    const early = turns.filter((t) => t.at < 12 && t.source !== "agent" && t.saying);
    expect(early.length).toBeGreaterThan(0);
    for (const t of early) {
      expect(t.via).toBe("message");
      expect(isPhoneTurn(t)).toBe(false);
    }
    // 12 時間（一部回復 不安定）の家族の行は着信
    const noon = turns.filter((t) => t.at === 12 && t.source === "family");
    for (const t of noon) expect(t.via).toBe("call");
  });
});

describe("区域の出来事の対象（T128 が読む）", () => {
  const ctx = { participants: ALL, homes: HOMES, officeZones: ["tsunami" as const] };
  it("津波警報は津波の区域の人と区域の事業所", () => {
    expect(targetsOf({ change: { kind: "tsunami", state: "evacuate" } }, ctx)).toEqual({ persons: ["p-08"], office: true });
    expect(targetsOf({ change: { kind: "tsunami", state: "evacuate" } }, { ...ctx, officeZones: [] }).office).toBe(false);
  });
  it("警戒レベルは洪水・土砂の区域、氾濫は洪水の区域、地震は全員と事業所、本人の出来事はその人", () => {
    expect(targetsOf({ change: { kind: "alert", level: 4 } }, ctx).persons).toEqual(["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07"]);
    expect(targetsOf({ change: { kind: "flood" } }, ctx).persons).toEqual(["p-01", "p-02", "p-03", "p-05", "p-06"]);
    expect(targetsOf({ change: { kind: "quake", intensity: "6強" } }, ctx)).toEqual({ persons: ALL, office: true });
    expect(targetsOf({ change: { kind: "line_down" }, person: "p-03" }, ctx)).toEqual({ persons: ["p-03"], office: false });
    expect(targetsOf({ change: { kind: "outage", area: { scope: "hazard", hazard: "flood", minDepthM: 3 } } }, ctx).persons).toEqual(["p-01", "p-02"]);
  });
});

describe("上の帯・帯・地図", () => {
  it("訓練の画面の上の帯は訓練の想定・規模・経過（事業所の状態を混ぜない）", () => {
    const m = drillHeaderMark({ scenario: "earthquake", world: { quake: "6強", alertLevel: null }, minute: 360 });
    expect(m.label).toBe("地震想定");
    expect(m.details).toEqual(["震度 6強", "経過 6 時間"]);
    expect(headerMarkText(m)).not.toMatch(/大雨|レベル|停電/);
    const v = drillHeaderMark({ scenario: "virtual", options: { scale: { kind: "heavy_rain", level: 4 } }, world: { quake: null, alertLevel: 4 }, minute: 90 });
    expect(v.details[0]).toBe("大雨 警戒レベル 4");
  });

  it("72 時間の棒に電波の帯（停電の始まり + 24 時間から停電の終わりまで）", () => {
    const ticks = [
      { step: 0, hour: 0, incidents: [{ actor: "world" as const, at: 0, change: { kind: "outage" as const, area: { scope: "office" as const } }, text: "停電", ai: false }], turns: [], world: EMPTY_WORLD, finished: false },
      { step: 1, hour: 48, incidents: [{ actor: "world" as const, at: 48, change: { kind: "outage_restored" as const }, text: "復旧", ai: false }], turns: [], world: EMPTY_WORLD, finished: false },
    ];
    expect(bandsOf(ticks, { profile: FIT_PROFILES.earthquake, homes: HOMES }).find((b) => b.kind === "radio")).toEqual({ kind: "radio", from: 24, to: 48 });
    expect(bandsOf(ticks).some((b) => b.kind === "radio")).toBe(false);
  });

  it("地図の既定の層は想定の表から（地震は津波・土砂、大雨は浸水・土砂）", () => {
    expect(demoOverlay({ kind: "earthquake" }).layers).toEqual(["tsunami", "landslide"]);
    expect(demoOverlay({ kind: "heavy_rain", level: 4 }).layers).toEqual(["flood", "landslide"]);
  });

  it("前からの訓練（家の写しが無い）は区域の浸水を付けず、家の電話の印だけで本人電話を止める", () => {
    const s = src("earthquake", { ...EQ_0H, marks: { "p-02": { lineDown: 1 } } }, 60, { homes: undefined });
    expect(termsFor(s, "p-08").visit.adds).not.toContain("浸水");
    expect(termsFor(s, "p-02").call_person.block).toBe("通話不可");
    expect(termsFor(s, "p-03").call_person.block).toBeNull();
    expect(actionTerm("visit", termFactsOf(s, "p-03"), { on: true }).minutes).toBe(40);
  });
});
