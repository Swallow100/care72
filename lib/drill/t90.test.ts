// T90 連続の時計（docs/tasks/T90.md）のテスト。偽の hooks（本物の Claude を呼ばない）で、
// 区切りの中の出来事・本人役を呼ぶ人・監督を呼ぶ区切り・1 訓練の上限・手の途中・保存と再生を確かめる。
// 10 分版と前からある訓練（clock の無い訓練）は前からのテストがそのまま通ることで確かめる。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { act } from "./actions.ts";
import { aiStopBand, aiStopParts } from "./ai-stop.ts";
import {
  budgetOf,
  CAP_REASON,
  CLOCK_LABELS,
  crossedClocks,
  DRILL_CALL_CAP,
  DRILL_CALL_SOFT,
  DRILL_END_MINUTE,
  nextEventMinute,
  tableMinutes,
  type ClockMark,
} from "./clock.ts";
import { actDrill, advanceDrill, drillScope, loadDrillRow, loadTicks, participantsOf, replayState, startDrill, stateOfRow } from "./db.ts";
import {
  advance,
  DrillEnded,
  drillEnded,
  initialState,
  step,
  type DirectorEvent,
  type DirectorInput,
  type DrillState,
  type DrillTurn,
  type PersonaInput,
  type StepHooks,
} from "./engine.ts";
import { estimateClockCalls, estimateDrillCalls } from "./estimate.ts";
import { stepPost } from "./http.ts";
import type { WorldState } from "./scenarios.ts";
import { loadDrillScreen } from "./view.ts";

const START = "2026-11-05T01:00:00.000Z";
const TEN = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09", "p-10"];

/** 偽の本人役（呼ばれた入力を残し、緑を 1 つ返す） */
function fakePersona(log: PersonaInput[] = []) {
  return {
    log,
    hook: async (input: PersonaInput): Promise<DrillTurn[]> => {
      log.push(input);
      return [
        {
          person: input.person,
          color: "green",
          source: "agent",
          whereNow: "home",
          injured: null,
          atHome: null,
          canMove: null,
          hasMedicine: null,
          saying: "家にいる",
          doing: null,
          ai: true,
          at: input.hour,
        },
      ];
    },
  };
}

/** 偽の監督（呼ばれた入力を残し、渡した差し込みを返す） */
function fakeDirector(events: DirectorEvent[] = [], log: DirectorInput[] = []) {
  return {
    log,
    hook: async (input: DirectorInput) => {
      log.push(input);
      return { events, words: [] };
    },
  };
}

async function begin(scenario: "heavy_rain" | "earthquake" | "virtual", hooks: StepHooks = {}, participants = TEN): Promise<DrillState> {
  const r = await advance(initialState(scenario, participants, START, { clock: true }), 0, hooks);
  return r!.state;
}

async function go(s: DrillState, to: number, hooks: StepHooks = {}, next = false) {
  const r = await advance(s, to, hooks, { policy: "clock", next });
  return r!;
}

/** 世界の帳簿の欄（engine だけが使う。再生では作り直さない）を外す */
function plain(w: WorldState): Partial<WorldState> {
  const { lastCalled: _a, touched: _b, counts: _c, scheduled: _d, ...rest } = w;
  return rest;
}

// ---------- advance ----------

describe("advance（連続の時計の 1 区切り）", () => {
  it("30 分 × 6 と 3 時間 × 1 で、同じ表の出来事が同じ順に当たる", async () => {
    const a0 = await begin("heavy_rain");
    let a = a0;
    const small: string[] = [];
    for (let m = 30; m <= 180; m += 30) {
      const r = await go(a, m);
      small.push(...r.tick.incidents.map((e) => `${e.at}:${e.text}`));
      a = r.state;
    }
    const big = await go(a0, 180);
    expect(big.tick.incidents.map((e) => `${e.at}:${e.text}`)).toEqual(small);
    expect(small.length).toBeGreaterThan(0);
    expect(plain(big.state.world)).toEqual(plain(a.world));
    expect(a.cuts).toEqual([0, 30, 60, 90, 120, 150, 180]);
    expect(big.state.cuts).toEqual([0, 180]);
  });

  it("区切りの中の出来事だけ当たる（0〜30 分は無し、30〜60 分に 1 時間の出来事）", async () => {
    const s0 = await begin("heavy_rain");
    const r1 = await go(s0, 30);
    expect(r1.tick.incidents).toEqual([]);
    expect(r1.tick.hour).toBe(0.5);
    const r2 = await go(r1.state, 60);
    expect(r2.tick.incidents.map((e) => e.at)).toEqual([1, 1]);
    expect(r2.state.world.outage).not.toBeNull();
  });

  it("72 時間で終わり（finished）、その先は進めない", async () => {
    const s0 = await begin("earthquake");
    const r = await go(s0, 99_999);
    expect(r.tick.finished).toBe(true);
    expect(r.tick.hour).toBe(72);
    expect(r.state.status).toBe("finished");
    expect(drillEnded(r.state)).toBe(true);
    await expect(advance(r.state, 4400)).rejects.toThrow(DrillEnded);
  });

  it("今より前・同じ時刻へは進めない", async () => {
    const s0 = await begin("heavy_rain");
    const r = await go(s0, 60);
    await expect(advance(r.state, 60)).rejects.toThrow(RangeError);
  });

  it("clock の無い訓練は前と同じ（step の道、cuts の鍵なし）", async () => {
    const r = await step(initialState("heavy_rain", TEN, START));
    expect(r.state.cuts).toBeUndefined();
    expect(r.state.options).toBeUndefined();
  });
});

// ---------- 次の出来事まで ----------

describe("次の出来事まで（nextEventMinute）", () => {
  const base = { scenario: "virtual" as const, minute: 100, world: {} as Pick<WorldState, "scheduled" | "arrivals" | "dispatched"> };

  it("何も無ければ今から 3 時間", () => {
    expect(nextEventMinute(base)).toBe(280);
  });

  it("表・予定・到着・時計の一番早い物", () => {
    expect(nextEventMinute({ ...base, scenario: "heavy_rain", minute: 0 })).toBe(60);
    expect(nextEventMinute({ ...base, scenario: "heavy_rain", minute: 60 })).toBe(180);
    const world = {
      scheduled: [{ at: 200, change: { kind: "outage_restored" as const }, text: "停電 復旧", by: "director" as const }],
      arrivals: [{ person: "p-01", role: "nurse" as const, arrive: 150, back: null, arrived: false, from: "a1" }],
      dispatched: [],
    };
    expect(nextEventMinute({ ...base, world })).toBe(150);
    expect(nextEventMinute({ ...base, world: { ...world, arrivals: [] } })).toBe(200);
    const marks: ClockMark[] = [{ person: "p-02", at: 130, kind: "half" }];
    expect(nextEventMinute({ ...base, world }, marks)).toBe(130);
  });

  it("72 時間で止める", () => {
    expect(nextEventMinute({ ...base, minute: 4300 })).toBe(DRILL_END_MINUTE);
  });

  it("表の時刻は出来事と行の時刻（仮想は空）", () => {
    expect(tableMinutes("virtual")).toEqual([]);
    expect(tableMinutes("heavy_rain").slice(0, 4)).toEqual([0, 60, 180, 360]);
  });
});

// ---------- 本人役を呼ぶ人 ----------

describe("本人役を呼ぶ人（この区切りで理由のある人だけ）", () => {
  it("表の行の人を table で呼ぶ。理由の無い人は呼ばない", async () => {
    const p = fakePersona();
    const s0 = await begin("heavy_rain", { persona: p.hook });
    // 0 時間の行は 3 田中・6 高橋・10 中村
    expect(p.log.map((x) => x.person).sort()).toEqual(["p-03", "p-06", "p-10"]);
    expect(p.log.every((x) => x.reasons?.join() === "table" && x.toMinute === 0 && x.since === 0)).toBe(true);
    p.log.length = 0;
    const r = await go(s0, 30, { persona: p.hook });
    expect(p.log).toEqual([]);
    expect(r.state.world.counts?.persona).toBe(3);
  });

  it("状況が指す人を incident、手の返事の人を action、時計の半分・切れを越えた人を clock で呼ぶ", async () => {
    const p = fakePersona();
    let s = await begin("virtual", { persona: p.hook });
    expect(p.log).toEqual([]);
    s = {
      ...s,
      world: { ...s.world, scheduled: [{ at: 20, change: { kind: "line_down" }, text: "家の電話 不通", person: "p-05", by: "director" }] },
      actions: [
        {
          id: "a1",
          kind: "call_person",
          person: "p-07",
          target: null,
          callee: "self",
          calleeLabel: null,
          at: 0,
          atMinute: 0,
          endMinute: 5,
          minutes: 5,
          step: 0,
          before: { person: null, marks: {}, staff: 3, phone: "ok", roadClosed: false },
          result: { ok: false, status: "noAnswer", because: null, text: "", ai: false, speech: null, speechAi: false, pickup: "no_answer", cleared: [], staff: 0, crossed: [], atMinute: 5, heard: null },
        },
      ],
      minute: 5,
    };
    const marks: ClockMark[] = [{ person: "p-02", at: 25, kind: "half" }];
    await go(s, 30, { persona: p.hook, clock: { marks: async () => marks } });
    const by = Object.fromEntries(p.log.map((x) => [x.person, x.reasons]));
    expect(by).toEqual({ "p-07": ["action"], "p-05": ["incident"], "p-02": ["clock"] });
  });

  it("1 区切り 6 人まで。残りは touched に残して次の進めで呼ぶ", async () => {
    const p = fakePersona();
    let s = await begin("virtual", { persona: p.hook });
    const scheduled = TEN.slice(0, 8).map((person) => ({ at: 10, change: { kind: "line_down" as const }, text: "家の電話 不通", person, by: "director" as const }));
    s = { ...s, world: { ...s.world, scheduled } };
    const r1 = await go(s, 30, { persona: p.hook });
    expect(p.log.map((x) => x.person)).toEqual(TEN.slice(0, 6));
    expect(Object.keys(r1.state.world.touched ?? {}).sort()).toEqual(["p-07", "p-08"]);
    p.log.length = 0;
    const r2 = await go(r1.state, 60, { persona: p.hook });
    expect(p.log.map((x) => x.person)).toEqual(["p-07", "p-08"]);
    expect(p.log.every((x) => x.reasons?.join() === "incident")).toBe(true);
    expect(r2.state.world.touched).toEqual({});
  });

  it("12 時間（720 分）何も無い人を巡回で 3 人まで（押せる人だけ、古い順）", async () => {
    const p = fakePersona();
    const clock = { pressable: async () => new Set(TEN.filter((x) => x !== "p-01")) };
    let s = await begin("virtual", { persona: p.hook, clock });
    for (let m = 180; m < 720; m += 180) s = (await go(s, m, { persona: p.hook, clock })).state;
    expect(p.log).toEqual([]);
    s = (await go(s, 720, { persona: p.hook, clock })).state;
    expect(p.log.map((x) => x.person)).toEqual(["p-02", "p-03", "p-04"]);
    expect(p.log.every((x) => x.reasons?.join() === "round")).toBe(true);
    p.log.length = 0;
    await go(s, 750, { persona: p.hook, clock });
    expect(p.log.map((x) => x.person)).toEqual(["p-05", "p-06", "p-07"]);
  });

  it("仮想の結末の人は呼ばない", async () => {
    const p = fakePersona();
    let s = await begin("virtual", { persona: p.hook });
    const scheduled = ["p-01", "p-02"].map((person) => ({ at: 10, change: { kind: "line_down" as const }, text: "家の電話 不通", person, by: "director" as const }));
    s = { ...s, world: { ...s.world, scheduled, ended: { "p-01": { at: 0, label: "", reason: null } } } };
    await go(s, 30, { persona: p.hook });
    expect(p.log.map((x) => x.person)).toEqual(["p-02"]);
  });

  it("押せる人がいなく表の行も無い人は呼ばない", async () => {
    const p = fakePersona();
    let s = await begin("virtual", { persona: p.hook });
    const scheduled = ["p-01", "p-02"].map((person) => ({ at: 10, change: { kind: "line_down" as const }, text: "家の電話 不通", person, by: "director" as const }));
    s = { ...s, world: { ...s.world, scheduled } };
    const r = await go(s, 30, { persona: p.hook, clock: { pressable: async () => new Set(["p-02"]) } });
    expect(p.log.map((x) => x.person)).toEqual(["p-02"]);
    expect(r.state.world.touched).toEqual({});
  });
});

// ---------- 監督を呼ぶ区切り ----------

describe("監督を呼ぶ区切りと差し込みの数", () => {
  const INJECT = (person: string): DirectorEvent => ({ inject: "line_down", person, text: "家の電話 不通", ai: true });

  it("表の出来事のある区切り・3 時間・「次まで」で呼び、空の 30 分では呼ばない", async () => {
    const d = fakeDirector();
    const s0 = await begin("heavy_rain", { director: d.hook });
    expect(d.log.length).toBe(1);
    const r1 = await go(s0, 30, { director: d.hook });
    expect(d.log.length).toBe(1);
    // 30〜60 分は 1 時間の表の出来事
    const r2 = await go(r1.state, 60, { director: d.hook });
    expect(d.log.length).toBe(2);
    expect(d.log[1]).toMatchObject({ since: 30, budget: 1, hour: 1 });
    // 60〜90 分は表の出来事なし・前の監督から 30 分 → 呼ばない。「次まで」なら呼ぶ
    await go(r2.state, 90, { director: d.hook });
    expect(d.log.length).toBe(2);
    await go(r2.state, 90, { director: d.hook }, true);
    expect(d.log.length).toBe(3);
  });

  it("前の監督から 180 分以上なら空の区切りでも呼ぶ（仮想は世界）", async () => {
    const calls: number[] = [];
    const world = async (input: DirectorInput & { minute: number }) => {
      calls.push(input.minute);
      return { incidents: [] };
    };
    let s = await begin("virtual", { world });
    for (const m of [30, 60, 90, 120, 150, 180, 210]) s = (await go(s, m, { world })).state;
    expect(calls).toEqual([0, 180]);
    expect(s.world.counts?.director).toBe(2);
  });

  it("差し込みは budget（区切り ÷ 3 時間、1〜3。T92 までは 2 で切る）", async () => {
    const d = fakeDirector([INJECT("p-01"), INJECT("p-02"), INJECT("p-03")]);
    const s0 = await begin("heavy_rain", { director: d.hook });
    const r1 = await go(s0, 60, { director: d.hook });
    expect(r1.tick.incidents.filter((e) => e.actor === "director" && e.ai)).toHaveLength(1);
    const r2 = await go(r1.state, 60 + 6 * 60, { director: d.hook });
    expect(d.log.at(-1)?.budget).toBe(2);
    expect(r2.tick.incidents.filter((e) => e.actor === "director" && e.ai)).toHaveLength(2);
    expect(budgetOf(0, 30)).toBe(1);
    expect(budgetOf(0, 600)).toBe(3);
  });

  it("1 訓練 20 回で止まる", async () => {
    const d = fakeDirector();
    const s0 = await begin("heavy_rain", { director: d.hook });
    const s = { ...s0, world: { ...s0.world, counts: { director: 20, persona: 0, call: 0, free: 0 } } };
    await go(s, 60, { director: d.hook });
    expect(d.log.length).toBe(1);
  });
});

// ---------- 上限 ----------

describe("1 訓練の AI の上限", () => {
  it("120 で巡回と 3 時間ごとの監督を止め、表の出来事のある区切りだけ監督", async () => {
    const d = fakeDirector();
    const p = fakePersona();
    let s = await begin("virtual", { director: d.hook, persona: p.hook });
    s = { ...s, minute: 600, cuts: [0, 600], step: 1, hour: 10, world: { ...s.world, counts: { director: 0, persona: DRILL_CALL_SOFT, call: 0, free: 0 } } };
    const world = async () => ({ incidents: [] });
    await go(s, 780, { persona: p.hook, world });
    expect(p.log).toEqual([]);
    const ds = await begin("heavy_rain", { director: d.hook });
    const soft = { ...ds, world: { ...ds.world, counts: { director: 1, persona: DRILL_CALL_SOFT, call: 0, free: 0 } } };
    const r = await go(soft, 30, { director: d.hook }, true);
    expect(d.log.length).toBe(1);
    await go(r.state, 60, { director: d.hook });
    expect(d.log.length).toBe(2);
  });

  it("150 で AI を呼ばない。区切りに「訓練上限」の印、帯の理由も同じ", async () => {
    const d = fakeDirector();
    const p = fakePersona();
    const s0 = await begin("heavy_rain", { director: d.hook, persona: p.hook });
    d.log.length = 0;
    p.log.length = 0;
    const s = { ...s0, world: { ...s0.world, counts: { director: 10, persona: DRILL_CALL_CAP - 10, call: 0, free: 0 } } };
    const r = await go(s, 60, { director: d.hook, persona: p.hook });
    expect(d.log).toEqual([]);
    expect(p.log).toEqual([]);
    // 表の行は固定の安否（想定のみ）
    expect(r.tick.turns.map((t) => [t.person, t.ai])).toEqual([
      ["p-02", false],
      ["p-07", false],
      ["p-08", false],
    ]);
    const cap = r.tick.incidents.find((e) => e.change.kind === "ai_stop");
    expect(cap).toMatchObject({ reason: CAP_REASON, text: CLOCK_LABELS.cap });
    const band = aiStopBand([{ hour: 0, incidents: [] }, r.tick], { virtual: false, running: true, now: null, clock: true })!;
    expect(band.reason).toBe("cap");
    expect(band.resume).toBeNull();
    expect(aiStopParts(band).reason).toBe("訓練上限");
  });

  it("上限に届く区切りは残りの数だけ本人役を呼ぶ（150 を超えない）", async () => {
    const p = fakePersona();
    let s = await begin("virtual", { persona: p.hook });
    const scheduled = TEN.slice(0, 5).map((person) => ({ at: 10, change: { kind: "line_down" as const }, text: "家の電話 不通", person, by: "director" as const }));
    s = { ...s, world: { ...s.world, scheduled, counts: { director: 0, persona: DRILL_CALL_CAP - 2, call: 0, free: 0 } } };
    const r = await go(s, 30, { persona: p.hook });
    expect(p.log.length).toBe(2);
    expect(r.state.world.counts?.persona).toBe(DRILL_CALL_CAP);
  });

  it("開始前の見込み: 10 人で約 160（監督 20 + 本人役 90 + 講評 1 + 声 45）。10 分版の式は前のまま", () => {
    const ten = TEN.map((id) => ({ id }));
    expect(estimateClockCalls("heavy_rain", ten)).toBe(156);
    expect(estimateDrillCalls("short", ten)).toBe(4 * 11 + 1 + 20);
  });

  it("時計の印は区切りの中の半分・切れだけ", () => {
    const marks: ClockMark[] = [
      { person: "p-01", at: 60, kind: "half" },
      { person: "p-01", at: 120, kind: "out" },
      { person: "p-02", at: 200, kind: "half" },
    ];
    expect(crossedClocks(marks, 0, 60)).toEqual(["p-01"]);
    expect(crossedClocks(marks, 60, 180)).toEqual(["p-01"]);
    expect(crossedClocks(marks, 120, 180)).toEqual([]);
  });
});

// ---------- 手の途中 ----------

describe("手の途中（clock の訓練）", () => {
  it("40 分の訪問が表の出来事をまたいでも AI を呼ばず、返事は進めたあとの世界で決まる", async () => {
    const d = fakeDirector();
    const p = fakePersona();
    const hooks = { director: d.hook, persona: p.hook };
    let s = await begin("heavy_rain", hooks);
    for (const m of [60, 120, 150]) s = (await go(s, m, hooks)).state;
    d.log.length = 0;
    p.log.length = 0;
    // 3 時間に 5 伊藤の家の前（川沿いの市道）が通行止め。150 分からの訪問（40 分）はその後に着く
    const out = await act(s, { kind: "visit", person: "p-05", target: null }, hooks, () => 0.5);
    expect(d.log).toEqual([]);
    expect(p.log).toEqual([]);
    expect(out.ticks).toHaveLength(1);
    expect(out.ticks[0].hour * 60).toBeCloseTo(190);
    expect(out.ticks[0].incidents.some((e) => e.change.kind === "road" && e.person === "p-05")).toBe(true);
    expect(out.record.result?.status).toBe("blocked");
    expect(out.record.result?.crossed).toEqual([out.ticks[0].step]);
    // 表の行（1 山田・6 高橋）は本人役の骨として残り、道の状況の 5 伊藤は touched。次の進めで呼ぶ（5 伊藤は手の返事のほうが強い理由）
    expect(out.ticks[0].turns).toEqual([]);
    expect(Object.keys(out.state.world.touched ?? {})).toEqual(["p-05"]);
    await go(out.state, 220, hooks);
    expect(p.log.map((x) => [x.person, x.reasons?.join()])).toEqual([
      ["p-01", "table"],
      ["p-06", "table"],
      ["p-05", "action"],
    ]);
    expect(p.log[0].fixed.map((f) => f.at)).toEqual([3]);
  });

  it("出来事の無い手は区切りを作らず、時計だけ進む", async () => {
    const s = await begin("heavy_rain");
    const out = await act(s, { kind: "visit", person: "p-01", target: null }, {}, () => 0.5);
    expect(out.ticks).toEqual([]);
    expect(out.state.minute).toBe(40);
    expect(out.state.step).toBe(0);
  });
});

// ---------- 保存と再生（D1 は node:sqlite に種の 10 人） ----------

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const careManager = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});
const SCOPE = drillScope(careManager())!;

describe("保存と再生", () => {
  let sqlite: DatabaseSync;
  let db: ReturnType<typeof d1FromSqlite>;
  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const x of seedStatements()) sqlite.exec(x);
    db = d1FromSqlite(sqlite);
  });
  afterEach(() => sqlite.close());

  async function startClock(scenario: "heavy_rain" | "short" = "heavy_rain") {
    const r = await startDrill(db, SCOPE, scenario, START, {}, () => "drill-t90", { clock: true });
    expect(r).toEqual({ ok: true, id: "drill-t90" });
    return "drill-t90";
  }

  async function replayOf(id: string) {
    const row = (await loadDrillRow(db, SCOPE.officeId, id))!;
    const stored = stateOfRow(row);
    const hours = (stored.cuts ?? []).map((m) => m / 60);
    const ticks = await loadTicks(db, id, hours, row.step, 72);
    return { row, stored, replay: replayState(row, participantsOf(row), ticks, row.step) };
  }

  it("区切りの時刻（cuts）から作り直した世界が、保存した世界と同じ（手の途中の区切りも）", async () => {
    const id = await startClock();
    expect(await advanceDrill(db, SCOPE, id, 0, START, {}, { minutes: 30 })).toEqual({ ok: true, step: 1, hour: 0.5, status: "running", minute: 30 });
    expect(await advanceDrill(db, SCOPE, id, 1, START, {}, { next: true })).toMatchObject({ ok: true, step: 2, hour: 1, minute: 60 });
    expect(await advanceDrill(db, SCOPE, id, 2, START, {}, { minutes: 60 })).toMatchObject({ ok: true, step: 3, hour: 2 });
    expect(await advanceDrill(db, SCOPE, id, 3, START, {}, { minutes: 30 })).toMatchObject({ ok: true, step: 4, hour: 2.5 });
    // 150 分からの訪問 40 分が 3 時間の表の出来事をまたぐ（手の途中の区切り）
    const a = await actDrill(db, SCOPE, id, { step: 4, actions: 0 }, { kind: "visit", person: "p-05", target: null }, START, { roll: () => 0.5 });
    expect(a).toMatchObject({ ok: true, step: 5, minute: 190 });
    const { stored, replay } = await replayOf(id);
    expect(stored.cuts).toEqual([0, 30, 60, 120, 150, 190]);
    expect(replay.state.cuts).toEqual(stored.cuts);
    expect(replay.state.step).toBe(stored.step);
    expect(plain(replay.state.world)).toEqual(plain(stored.world));
    expect(replay.state.people).toEqual(stored.people);
    expect(replay.ticks.map((t) => t.hour)).toEqual([0, 0.5, 1, 2, 2.5, 190 / 60]);
    expect(replay.ticks.every((t) => !t.finished)).toBe(true);
  });

  it("72 時間で終わり、再生でも最後の区切りだけ finished", async () => {
    const id = await startClock();
    let n = 0;
    for (;;) {
      const r = await advanceDrill(db, SCOPE, id, n, START, {}, { minutes: 180 });
      if (!r.ok) throw new Error(r.error);
      n = r.step;
      if (r.status === "finished") break;
    }
    expect(n).toBe(24);
    expect(await advanceDrill(db, SCOPE, id, n, START, {}, { minutes: 30 })).toEqual({ ok: false, error: "ended" });
    const { replay } = await replayOf(id);
    expect(replay.ticks.filter((t) => t.finished).map((t) => t.hour)).toEqual([72]);
    expect(replay.state.status).toBe("finished");
    const screen = (await loadDrillScreen(db, SCOPE, id, null))!;
    expect(screen.clock).toBe(true);
    expect(screen.hours.at(-1)).toBe(72);
    expect(screen.ticks).toHaveLength(25);
  });

  it("clock の訓練は進め方が要る（無ければ・形が違えば 400）。clock の無い訓練は前のまま", async () => {
    const id = await startClock();
    expect(await advanceDrill(db, SCOPE, id, 0, START)).toEqual({ ok: false, error: "invalid" });
    const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
    expect((await read(await stepPost(db, careManager(), id, { step: 0 }, START))).status).toBe(400);
    expect((await read(await stepPost(db, careManager(), id, { step: 0, minutes: 45 }, START))).status).toBe(400);
    expect((await read(await stepPost(db, careManager(), id, { step: 0, next: "yes" }, START))).status).toBe(400);
    expect((await read(await stepPost(db, careManager(), id, { step: 0, minutes: 30 }, START))).body).toEqual({
      ok: true,
      step: 1,
      hour: 0.5,
      status: "running",
      minute: 30,
    });
  });

  it("10 分版に clock が来ても刻みの道のまま", async () => {
    const id = await startClock("short");
    const row = (await loadDrillRow(db, SCOPE.officeId, id))!;
    expect(stateOfRow(row).options).toBeUndefined();
    expect(stateOfRow(row).cuts).toBeUndefined();
    expect(await advanceDrill(db, SCOPE, id, 0, START)).toEqual({ ok: true, step: 1, hour: 3, status: "running" });
  });

  it("画面の残りの数は 1 訓練の上限から（clock の無い訓練は null）", async () => {
    const id = await startClock();
    const screen = (await loadDrillScreen(db, SCOPE, id, null))!;
    expect(screen.left).toBe(DRILL_CALL_CAP);
    expect(screen.hours).toEqual([0]);
  });
});
