// T123 の人ごとの筋（#2）と待ち（#3）のテスト（docs/tasks/T123.md）。Claude を呼ばない（呼び口は作った関数）。
// 漏れていた道（通話・往復・訪問の文、通行止めの先への到着、呼吸器の人の業者、表の行より先の「外へ出た」、10 分版の監督の差し込み）に、
// T121 の世界の状態の決まりを当てる。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { DRILL_END_MINUTE } from "./clock.ts";
import { advance, initialState, step, type DirectorEvent, type DirectorInput, type DrillIncident } from "./engine.ts";
import { EVENT_CATALOG, extraWorldWords, type EventSource } from "./event-catalog.ts";
import { buildPersona, CALL_SYSTEM, callText, PATH_RULE, TALK_SYSTEM, talkText, VISIT_SYSTEM, visitText } from "./persona.ts";
import { applyEvent, EMPTY_WORLD, settleWorld, type WorldState } from "./scenarios.ts";
import { screenIncident, tableAheadOf, WHERE_AHEAD_MINUTES, whereKey } from "./state-rules.ts";

const START = "2026-11-05T01:00:00.000Z";
const TEN = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09", "p-10"];

const sourceOf = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const inc = (change: DrillIncident["change"], at: number, extra: Partial<DrillIncident> = {}): DrillIncident => ({
  change,
  text: "x",
  actor: "director",
  at,
  ai: true,
  ...extra,
});
const road = (open: boolean, at: number) => inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open }, at, { person: "p-01" });

describe("通話・往復・訪問の道にも持ちこたえる時間の今と決まり", () => {
  const persona = buildPersona(sourceOf("p-02"));
  const out: WorldState = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "outage", area: { scope: "office" } }, 1), 1);
  const call = { person: "p-02", hour: 10, world: out, incidents: [], state: null, callee: "夫" };

  it("通話の最初の言葉・往復・訪問の文に、時計の段（切れた分は切れた）", () => {
    for (const text of [callText(call, persona), talkText({ ...call, first: null, lines: [], said: "大丈夫ですか" }, persona), visitText(call, persona)]) {
      expect(text).toContain("持ちこたえる時間の今");
      expect(text).toMatch(/の分は切れた（/);
    }
  });

  it("通話・往復・訪問の指示に、刻みの決まり 10 と同じ筋の決まり", () => {
    for (const sys of [CALL_SYSTEM, TALK_SYSTEM, VISIT_SYSTEM]) expect(sys).toContain(PATH_RULE);
    expect(PATH_RULE).toContain("切れた分を、まだ残ると言わない");
    expect(PATH_RULE).toContain("急に動ける・無事と言わない");
  });
});

describe("通行止めの先には着かない（届け物・人）", () => {
  const closed = applyEvent({ ...EMPTY_WORLD }, road(false, 3), 3);
  const withVendor = applyEvent(
    closed,
    inc({ kind: "schedule", at: 11 * 60, by: "director", then: { kind: "arrival", role: "vendor" } }, 8, { person: "p-01" }),
    8,
  );

  it("家の前の道が通れない間は業者が着かず、酸素も届かない。言い方は「通れず着けない」", () => {
    const w = settleWorld(withVendor, 12 * 60);
    expect(w.arrivals?.[0]).toMatchObject({ role: "vendor", arrived: false, arrive: 660 });
    expect(w.supplies?.["p-01"]?.oxygen).toBeUndefined();
    expect(extraWorldWords(w, "p-01").join("\n")).toContain("酸素業者が向かっているが、家の前の道が通れず着けない");
  });

  it("道が通れるようになった時刻に着き、その時刻に届く", () => {
    const opened = applyEvent(settleWorld(withVendor, 12 * 60), road(true, 23), 23);
    const w = settleWorld(opened, 24 * 60);
    expect(w.arrivals?.[0]).toMatchObject({ arrived: true, arrive: 23 * 60 });
    expect(w.supplies?.["p-01"]?.oxygen).toBe(23 * 60);
  });

  it("着く時刻のあとに通行止になった道は、着いたまま（その時は通れた）", () => {
    const later = applyEvent(withVendor, road(true, 9), 9);
    const blocked = applyEvent(later, road(false, 11.5), 11.5);
    expect(settleWorld(blocked, 12 * 60).arrivals?.[0]).toMatchObject({ arrived: true, arrive: 660 });
  });

  it("歩いて来られる家族・支援者は今までどおり着く", () => {
    const fam: WorldState = { ...closed, arrivals: [{ person: "p-01", role: "family", arrive: 600, back: null, arrived: false, from: "a1" }] };
    expect(settleWorld(fam, 12 * 60).arrivals?.[0]).toMatchObject({ arrived: true, arrive: 600 });
  });

  it("出向いてもらった職員（T20）も、道が通れない間は着かない", () => {
    const sent: WorldState = { ...closed, dispatched: [{ person: "p-01", arrive: 600, back: null, arrived: false }] };
    expect(settleWorld(sent, 12 * 60).dispatched?.[0]).toMatchObject({ arrived: false });
  });
});

describe("呼吸器だけの人の業者の巡回は医療機器の業者で、届くのは電源", () => {
  const vendor = EVENT_CATALOG.vendor_round;
  const src = (id: string) => ({ ...sourceOf(id), on: "2026-11-05" }) as unknown as EventSource;
  it("酸素の人は酸素業者・酸素、呼吸器だけの人は医療機器業者・電源", () => {
    expect(vendor.factsFor!(src("p-01"))).toEqual({ oxygen: true });
    expect(vendor.factsFor!(src("p-02"))).toEqual({ oxygen: false });
    const [ox] = vendor.build({ person: "p-01", facts: { oxygen: true } }, 6, 3);
    const [vt] = vendor.build({ person: "p-02", facts: { oxygen: false } }, 6, 3);
    expect(ox.text).toBe("酸素業者 巡回予定 3 時間後");
    expect(vt.text).toBe("医療機器業者 巡回予定 3 時間後");
    const w = settleWorld(applyEvent({ ...EMPTY_WORLD }, { ...inc(vt.change, 6), person: "p-02" }, 6), 10 * 60);
    expect(w.supplies?.["p-02"]).toEqual({ power: 540 });
    expect(extraWorldWords(w, "p-02").join("\n")).toContain("医療機器の業者が来た");
  });
});

describe("表の行がいる所を決める人に、AI が先に「外へ出た」を付けない", () => {
  const wander = inc({ kind: "mark", mark: "wandering" }, 0, { person: "p-04" });
  it("12 時間のうちに表の行が「家」と決める人は外す。遠い先の行なら通す。表の出来事そのものは通す", () => {
    const ahead = tableAheadOf([], 0, [{ row: { person: "p-04", whereNow: "home" }, minute: 6 * 60 }]);
    expect(ahead.get(whereKey("p-04"))).toEqual([360]);
    expect(screenIncident({ ...EMPTY_WORLD }, wander, { minute: 0, origin: "ai", ahead })).toEqual({ keep: false, rule: "table_first" });
    const far = tableAheadOf([], 0, [{ row: { person: "p-04", whereNow: "home" }, minute: WHERE_AHEAD_MINUTES + 60 }]);
    expect(screenIncident({ ...EMPTY_WORLD }, wander, { minute: 0, origin: "ai", ahead: far })).toEqual({ keep: true });
    expect(screenIncident({ ...EMPTY_WORLD }, wander, { minute: 0, origin: "table", ahead })).toEqual({ keep: true });
  });
});

describe("10 分版（刻みの道）も監督の差し込みを決まりで見る。最後の刻みは監督を呼ばない", () => {
  type Dir = (input: DirectorInput) => Promise<DirectorEvent[]>;

  it("同じ人の家の前の道の通行止を 2 度続けては当てない（前は 10 分版だけそのまま当たった）", async () => {
    let s = initialState("short", TEN, START);
    const director: Dir = async (input) => (input.step === 1 || input.step === 2 ? [{ inject: "road_blocked", person: "p-01", text: "家の前の道が冠水", ai: true }] : []);
    const inserted: DrillIncident[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await step(s, { director });
      s = r.state;
      inserted.push(...r.tick.incidents.filter((e) => e.ai));
    }
    // 3 時間に通行止。12 時間の同じ通行止は「今と同じ」で外れる
    expect(inserted.filter((e) => e.change.kind === "road")).toHaveLength(1);
  });

  it("10 分版: 最後の刻み（72 時間）は監督を呼ばない（手の返事の言い換えが無ければ）", async () => {
    let s = initialState("short", TEN, START);
    const steps: number[] = [];
    const director: Dir = async (input) => {
      steps.push(input.step);
      return [];
    };
    for (let i = 0; i < 4; i++) s = (await step(s, { director })).state;
    expect(s.status).toBe("finished");
    expect(steps).toEqual([0, 1, 2]);
  });

  it("連続の時計の固定の筋も 72 時間の区切りは監督を呼ばない", async () => {
    const hours: number[] = [];
    const director: Dir = async (input) => {
      hours.push(input.hour);
      return [];
    };
    let s = (await advance(initialState("heavy_rain", TEN, START, { clock: true }), 0, { director }))!.state;
    s = (await advance(s, DRILL_END_MINUTE - 180, { director }, { policy: "clock", next: true }))!.state;
    s = (await advance(s, DRILL_END_MINUTE, { director }, { policy: "clock", next: true }))!.state;
    expect(s.status).toBe("finished");
    expect(hours).toContain(69);
    expect(hours).not.toContain(72);
  });
});
