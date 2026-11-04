// T121（docs/tasks/T121.md）のテスト。偽の hooks・偽の client だけ（本物の Claude を呼ばない）。
// 評価の 1 回目で見えた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { advance, initialState, type DirectorEvent, type DirectorInput, type DrillIncident, type DrillState, type StepHooks } from "./engine.ts";
import { applyEvent, EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { DWELL_MINUTES, screenIncident, screenIncidents, stateLines, tableAheadOf } from "./state-rules.ts";

const START = "2026-11-05T01:00:00.000Z";
const TEN = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09", "p-10"];

const inc = (change: DrillIncident["change"], at: number, extra: Partial<DrillIncident> = {}): DrillIncident => ({
  change,
  text: "x",
  actor: "director",
  at,
  ai: true,
  ...extra,
});

async function begin(scenario: "heavy_rain" | "earthquake" | "virtual", hooks: StepHooks = {}): Promise<DrillState> {
  const r = await advance(initialState(scenario, TEN, START, { clock: true }), 0, hooks);
  return r!.state;
}

/** 偽の監督（区切りごとに渡した関数の差し込みを返す） */
function director(pick: (input: DirectorInput) => DirectorEvent[]) {
  const log: DirectorInput[] = [];
  return {
    log,
    hook: async (input: DirectorInput) => {
      log.push(input);
      return { events: pick(input), words: [] };
    },
  };
}

const ev = (inject: DirectorEvent["inject"], extra: Partial<DirectorEvent> = {}): DirectorEvent => ({
  inject,
  person: null,
  text: "監督の文",
  reason: "理由",
  basis: null,
  ai: true,
  ...extra,
});

// ---------- 0. 監督の差し込みの数で切る（行で切らない） ----------

describe("監督の差し込みを数で切る（行で切らない）", () => {
  it("区切りの budget が 1 でも、2 行の種類（携帯不可と回復見込）は 2 行とも当たる", async () => {
    let s = await begin("earthquake");
    // 地震の表は電話が通話不可から始まる。14 時間の表の「一部回復」の後、6 時間たってから携帯不可
    for (const to of [180, 360, 540, 720, 900, 1080, 1260]) s = (await advance(s, to, {}, { policy: "clock" }))!.state;
    expect(s.world.phone).toBe("busy");
    const d = director((input) => (input.hour * 60 === 1500 ? [ev("mobile_down", { after: 3 })] : []));
    const r = (await advance(s, 1500, { director: d.hook }, { policy: "clock", next: true }))!;
    const rows = r.tick.incidents.filter((e) => e.inject === "mobile_down");
    expect(rows.map((e) => e.change.kind)).toEqual(["phone", "schedule"]);
    expect(r.state.world.scheduled?.some((x) => x.change.kind === "phone" && x.change.state === "busy")).toBe(true);
  });
});

// ---------- 1. 変わった時刻と決まりの表 ----------

describe("変わった時刻（stamps）", () => {
  it("道・電話・停電・施設の変わった時刻を applyEvent が書き、変わらなければ書かない", () => {
    let w: WorldState = { ...EMPTY_WORLD };
    w = applyEvent(w, inc({ kind: "road", id: "rd-1", label: "川沿いの市道", open: false }, 3), 3);
    w = applyEvent(w, inc({ kind: "phone", state: "busy" }, 3), 3);
    expect(w.stamps).toEqual({ "road:rd-1": 3, phone: 3 });
    const same = applyEvent(w, inc({ kind: "phone", state: "busy" }, 5), 5);
    expect(same.stamps).toEqual({ "road:rd-1": 3, phone: 3 });
    w = applyEvent(w, inc({ kind: "outage", area: { scope: "office" } }, 4), 4);
    w = applyEvent(w, inc({ kind: "outage_restored" }, 30), 30);
    expect(w.stamps?.outage).toBe(30);
  });
});

describe("変わり方の決まり（state-rules）", () => {
  const closed: WorldState = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: false }, 3, { person: "p-01" }), 3);

  it("一度きり: 停電の復旧は 1 回だけ（復旧済・停電なしの復旧は捨てる）", () => {
    const out = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "outage", area: { scope: "office" } }, 0), 0);
    const restored = applyEvent(out, inc({ kind: "outage_restored" }, 36), 36);
    expect(screenIncident(out, inc({ kind: "outage_restored" }, 36), { minute: 2160, origin: "ai" })).toEqual({ keep: true });
    expect(screenIncident(restored, inc({ kind: "outage_restored" }, 48), { minute: 2880, origin: "table" })).toEqual({ keep: false, rule: "once:restore" });
    expect(screenIncident({ ...EMPTY_WORLD }, inc({ kind: "outage_restored" }, 5), { minute: 300, origin: "ai" })).toEqual({ keep: false, rule: "once:restore" });
  });

  it("表が先: 表がこのあと復旧させる停電を、監督が先に復旧させない（見込みの予定も）", () => {
    const out = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "outage", area: { scope: "office" } }, 0), 0);
    const ahead = tableAheadOf([{ event: { change: { kind: "outage_restored" } }, minute: 2880 }], 1440);
    expect(screenIncident(out, inc({ kind: "outage_restored" }, 36), { minute: 2160, origin: "ai", ahead })).toEqual({ keep: false, rule: "table_first" });
    const eta = inc({ kind: "schedule", at: 2160, by: "director", then: { kind: "event", change: { kind: "outage_restored" }, text: "停電 復旧" } }, 24);
    expect(screenIncident(out, eta, { minute: 1440, origin: "ai", ahead })).toEqual({ keep: false, rule: "table_first" });
    // 表の出来事そのものは通る
    expect(screenIncident(out, inc({ kind: "outage_restored" }, 48, { actor: "world", ai: false }), { minute: 2880, origin: "table", ahead })).toEqual({ keep: true });
  });

  it("変わるのに要る時間: 通行止から 6 時間たつまでの通行再開は、決まりの時刻へ予定に回す", () => {
    const reopen = inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: true }, 5, { person: "p-01", inject: "road_reopen" });
    const v = screenIncident(closed, reopen, { minute: 300, origin: "ai" });
    expect(v).toEqual({ keep: "defer", rule: "dwell:road", at: 180 + DWELL_MINUTES.roadReopen });
    const s = screenIncidents(closed, [reopen], { origin: "ai", minute: 300 });
    expect(s.kept).toHaveLength(1);
    const c = s.kept[0].change;
    expect(c.kind).toBe("schedule");
    if (c.kind === "schedule") {
      expect(c.at).toBe(300 + 240); // 4 時間後（9 時間）
      expect(c.then).toEqual({ kind: "event", change: reopen.change, text: reopen.text });
    }
    expect(s.kept[0].text).toBe("家の前の道 通行再開見込 4 時間後");
    expect(s.kept[0].inject).toBe("road_reopen");
    expect(s.world.roads[0].open).toBe(false);
    // 6 時間たったあとは通る
    expect(screenIncident(closed, reopen, { minute: 540, origin: "ai" })).toEqual({ keep: true });
  });

  it("通れるようになった道は 12 時間たつまで通行止に戻らない（捨てる）。同じ状態にする出来事も捨てる", () => {
    const opened = applyEvent(closed, inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: true }, 27, { person: "p-01" }), 27);
    const again = inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: false }, 30, { person: "p-01" });
    expect(screenIncident(opened, again, { minute: 1800, origin: "ai" })).toEqual({ keep: false, rule: "dwell:road" });
    expect(screenIncident(opened, again, { minute: 27 * 60 + DWELL_MINUTES.roadClose, origin: "ai" })).toEqual({ keep: true });
    expect(screenIncident(closed, inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: false }, 5, { person: "p-01" }), { minute: 300, origin: "ai" })).toEqual({
      keep: false,
      rule: "same",
    });
  });

  it("電話: 前に変わってから 6 時間たたない入れ替わりは捨てる。表がすぐ変える電話も先に変えない", () => {
    const busy = applyEvent({ ...EMPTY_WORLD, phone: "down" }, inc({ kind: "phone", state: "busy" }, 14, { actor: "world", ai: false }), 14);
    expect(screenIncident(busy, inc({ kind: "phone", state: "down" }, 18), { minute: 1080, origin: "ai" })).toEqual({ keep: false, rule: "dwell:phone" });
    expect(screenIncident(busy, inc({ kind: "phone", state: "down" }, 21), { minute: 1260, origin: "ai" })).toEqual({ keep: true });
    const ahead = tableAheadOf([{ event: { change: { kind: "phone", state: "ok" } }, minute: 1440 }], 1260);
    expect(screenIncident(busy, inc({ kind: "phone", state: "down" }, 21), { minute: 1260, origin: "ai", ahead })).toEqual({ keep: false, rule: "table_first" });
  });

  it("予定の電話の回復（携帯不可の一部回復）は、今の電話の方が良ければ起きない", () => {
    const ok = { ...EMPTY_WORLD, phone: "ok" as const };
    expect(screenIncident(ok, inc({ kind: "phone", state: "busy" }, 25), { minute: 1500, origin: "scheduled" })).toEqual({ keep: false, rule: "same" });
    expect(screenIncident({ ...EMPTY_WORLD, phone: "down" }, inc({ kind: "phone", state: "busy" }, 25), { minute: 1500, origin: "scheduled" })).toEqual({ keep: true });
  });

  it("到着は一度きり: 同じ人に同じ役が向かっている・24 時間のうちに着いた・届いたなら、同じ役の予定を受けない", () => {
    const vendor = (at: number) => inc({ kind: "schedule", at, by: "director", then: { kind: "arrival", role: "vendor" } }, at / 60 - 4, { person: "p-02" });
    const coming: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "vendor", arrive: 660, back: null, arrived: false, from: "director" }] };
    expect(screenIncident(coming, vendor(900), { minute: 660, origin: "ai" })).toEqual({ keep: false, rule: "once:arrival" });
    const came: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "vendor", arrive: 660, back: null, arrived: true, from: "director" }] };
    expect(screenIncident(came, vendor(2200), { minute: 1980, origin: "ai" })).toEqual({ keep: false, rule: "once:arrival" });
    expect(screenIncident(came, vendor(2400 + 660), { minute: 660 + 1440, origin: "ai" })).toEqual({ keep: true });
    // ほかの人・ほかの役は通る
    expect(screenIncident(coming, { ...vendor(900), person: "p-01" }, { minute: 660, origin: "ai" })).toEqual({ keep: true });
  });

  it("印・家の電話の不通・note の話題は一度きり", () => {
    const w: WorldState = { ...EMPTY_WORLD, marks: { "p-04": { lineDown: 7, familyAway: 12 } }, notes: { water_station: 36 } };
    expect(screenIncident(w, inc({ kind: "line_down" }, 15, { person: "p-04" }), { minute: 900, origin: "ai" }).keep).toBe(false);
    expect(screenIncident(w, inc({ kind: "mark", mark: "familyAway" }, 34, { person: "p-04" }), { minute: 2040, origin: "ai" }).keep).toBe(false);
    expect(screenIncident(w, inc({ kind: "note", topic: "water_station" }, 42), { minute: 2520, origin: "ai" }).keep).toBe(false);
    expect(screenIncident(w, inc({ kind: "line_down" }, 15, { person: "p-09" }), { minute: 900, origin: "ai" }).keep).toBe(true);
  });

  it("今の状態の行に、変わった時刻と、まだ変わらない時刻を書く（監督・世界に渡す）", () => {
    const lines = stateLines(closed, 300, (p) => (p === "p-01" ? "A さん" : null));
    expect(lines).toContain("家の前の道（A さん）: 通行止（3 時間から）。9 時間まで変わらない");
    expect(lines.some((l) => l.startsWith("電話: 通常"))).toBe(true);
  });
});

// ---------- 1. 区切りの中で（advance） ----------

describe("区切りの中の決まり（advance）", () => {
  it("大雨: 監督が 36 時間に停電を復旧させても通らず、表の 48 時間の復旧が 1 回だけ起きる", async () => {
    let s = await begin("heavy_rain");
    const d = director((input) => (input.hour * 60 === 2160 ? [ev("outage_eta", { after: 2 })] : []));
    const restores: number[] = [];
    for (let to = 180; to <= 72 * 60; to += 180) {
      const r = (await advance(s, to, { director: d.hook }, { policy: "clock" }))!;
      for (const e of r.tick.incidents) if (e.change.kind === "outage_restored" || (e.change.kind === "schedule" && e.change.then.kind === "event" && e.change.then.change.kind === "outage_restored")) restores.push(to);
      s = r.state;
      if (r.tick.finished) break;
    }
    expect(restores).toEqual([2880]);
    expect(s.world.outage?.restoredAt).toBe(48);
  });

  it("監督の通行再開が早すぎれば予定に回り、決まりの時刻に表の出来事と同じ道で起きる", async () => {
    let s = await begin("heavy_rain");
    // 表: 3 時間に川沿いの市道（rd-1、p-05）が通行止
    const d = director((input) => (input.hour * 60 === 360 ? [ev("road_blocked", { person: "p-01", text: "家の前の道が倒木で通れない" })] : input.hour * 60 === 540 ? [ev("road_reopen", { person: "p-01", text: "家の前の道が通れるようになった" })] : []));
    for (const to of [180, 360, 540]) s = (await advance(s, to, { director: d.hook }, { policy: "clock" }))!.state;
    // 6 時間に通行止 → 9 時間の再開は 3 時間早いので 12 時間の予定に
    expect(s.world.roads.find((r) => r.id === "rd-p-01")?.open).toBe(false);
    expect(s.world.scheduled?.find((x) => x.person === "p-01")?.at).toBe(720);
    s = (await advance(s, 720, { director: d.hook }, { policy: "clock" }))!.state;
    expect(s.world.roads.find((r) => r.id === "rd-p-01")?.open).toBe(true);
    expect(s.world.stamps?.["road:rd-p-01"]).toBe(12);
  });
});
