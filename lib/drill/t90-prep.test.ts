// T90 の準備（docs/tasks/T90.md「0. 準備の commit」）のテスト: 型と世界の返事の分割で同じ物が前の場所からも読めること、
// WorldState の共有の欄（予定・向かっている人・確認の上書き）と withoutMemo の拡張。欄が無い世界・手は今までと同じ物を返す。
// 色は lib/triage の入力（時計の頼り先の確認）までを見る。画面の言葉は書かない。

import { describe, expect, it } from "vitest";
import * as director from "./director.ts";
import * as engine from "./engine.ts";
import * as incidentTypes from "./incident-types.ts";
import { fireScheduled } from "./schedule.ts";
import { EMPTY_WORLD, applyEvent, injectChange, settleWorld, type Arrival, type Scheduled, type WorldState } from "./scenarios.ts";
import * as worldClocks from "./world-clocks.ts";
import * as worldReply from "./world-reply.ts";
import type { ActionRecord } from "./engine.ts";

describe("分割: 前の場所からも同じ物が読める", () => {
  it("engine.ts は状況と監督の値を incident-types.ts と同じ物で出す", () => {
    expect(engine.directorIncidents).toBe(incidentTypes.directorIncidents);
    expect(engine.stopIncidents).toBe(incidentTypes.stopIncidents);
    expect(engine.aiStoppedOf).toBe(incidentTypes.aiStoppedOf);
    expect(engine.DIRECTOR_MAX).toBe(incidentTypes.DIRECTOR_MAX);
  });

  it("director.ts は世界の返事と時計の書き換えを新しいファイルと同じ物で出す", () => {
    expect(director.drillClocks).toBe(worldClocks.drillClocks);
    for (const k of ["acceptOdds", "callLine", "decideWorldReply", "worldReply", "WORLD_ODDS", "WORLD_REPLY_LABELS", "WORLD_REPLY_TEXTS"] as const) {
      expect(director[k], k).toBe(worldReply[k]);
    }
  });
});

describe("予定の出来事（fireScheduled）", () => {
  const at = (minute: number, text: string, extra: Partial<Scheduled> = {}): Scheduled => ({
    at: minute,
    change: { kind: "outage_restored" },
    text,
    by: "director",
    ...extra,
  });

  it("予定が無い世界は同じ世界と空の配列", () => {
    const w = { ...EMPTY_WORLD };
    const r = fireScheduled(w, 600);
    expect(r.world).toBe(w);
    expect(r.incidents).toEqual([]);
    expect("scheduled" in r.world).toBe(false);
  });

  it("時刻までの物を時刻の順に取り出して状況にし、後の物は残す。世界には当てない", () => {
    const w: WorldState = {
      ...EMPTY_WORLD,
      outage: { area: { scope: "office" }, since: 0, restoredAt: null },
      scheduled: [at(360, "停電 復旧"), at(90, "業者 到着", { person: "p-02", basis: "mhlw-bcp-2020", by: "action" }), at(361, "後の予定")],
    };
    const r = fireScheduled(w, 360);
    expect(r.incidents).toEqual([
      { change: { kind: "outage_restored" }, text: "業者 到着", person: "p-02", basis: "mhlw-bcp-2020", actor: "director", at: 1.5, ai: false },
      { change: { kind: "outage_restored" }, text: "停電 復旧", actor: "director", at: 6, ai: false },
    ]);
    expect(r.world.scheduled).toEqual([at(361, "後の予定")]);
    // 当てるのは engine（停電はまだ続いている）
    expect(r.world.outage?.restoredAt).toBeNull();
    // 元の世界は変えない
    expect(w.scheduled).toHaveLength(3);
  });
});

describe("向かっている人（settleWorld の arrivals）", () => {
  const arrival = (x: Partial<Arrival>): Arrival => ({ person: "p-06", role: "supporter", arrive: 120, back: null, arrived: false, from: "a1", ...x });

  it("arrivals の無い世界は今までと同じ物を返す（鍵を足さない）", () => {
    const w = { ...EMPTY_WORLD, staff: 3 };
    expect(settleWorld(w, 600)).toBe(w);
    const marked = applyEvent(w, { change: injectChange("supply_left", "p-06"), text: "", person: "p-06" }, 6);
    const settled = settleWorld(marked, 600);
    expect(settled).toBe(marked);
    expect(Object.keys(settled).sort()).toEqual(Object.keys(EMPTY_WORLD).sort());
  });

  it("着いたら arrived にして印を消し、届く物を supplies に書く。職員は戻ったら空きを 1 戻す。着いた物も残る", () => {
    let w: WorldState = applyEvent({ ...EMPTY_WORLD, staff: 1 }, { change: injectChange("supply_left", "p-06"), text: "", person: "p-06" }, 6);
    w = applyEvent(w, { change: injectChange("nurse_away", "p-06"), text: "", person: "p-06" }, 6);
    w = {
      ...w,
      arrivals: [
        arrival({ role: "staff", arrive: 420, back: 480, from: "a1" }),
        arrival({ person: "p-02", role: "vendor", arrive: 450, from: "a2" }),
        arrival({ person: "p-08", role: "medicine", arrive: 900, from: "a3" }),
      ],
    };
    // まだ誰も着かない
    expect(settleWorld(w, 419)).toBe(w);

    const at450 = settleWorld(w, 450);
    expect(at450.arrivals!.map((a) => [a.arrived, a.back])).toEqual([
      [true, 480],
      [true, null],
      [false, null],
    ]);
    // 着いた人で消えるのは CLEARED_ON_ARRIVAL（栄養剤の持ち出し忘れ）だけ。訪問看護が来られないは残る
    expect(at450.marks["p-06"]).toEqual({ nurseAway: 6 });
    expect(at450.supplies).toEqual({ "p-02": { oxygen: 450 } });
    expect(at450.staff).toBe(1);

    const at480 = settleWorld(at450, 480);
    expect(at480.staff).toBe(2);
    expect(at480.arrivals![0]).toEqual(arrival({ role: "staff", arrive: 420, back: null, arrived: true, from: "a1" }));
    // 同じ時刻で何度呼んでも同じ
    expect(settleWorld(at480, 480)).toBe(at480);

    const at900 = settleWorld(at480, 900);
    expect(at900.supplies).toEqual({ "p-02": { oxygen: 450 }, "p-08": { medicine: 900 } });
    expect(at900.staff).toBe(2);
  });

  it("dispatched（T20）は今までどおり着いて戻った物を一覧から外す。arrivals と並べても互いに触らない", () => {
    const w: WorldState = {
      ...EMPTY_WORLD,
      staff: 0,
      dispatched: [{ person: "p-01", arrive: 60, back: 120, arrived: false }],
      arrivals: [arrival({ role: "staff", arrive: 60, back: 120 })],
    };
    const r = settleWorld(w, 120);
    expect(r.dispatched).toEqual([]);
    expect(r.arrivals).toHaveLength(1);
    expect(r.staff).toBe(2);
  });
});

describe("時計の頼り先の確認の上書き（drillClocks の checks）", () => {
  const clocks = [
    { id: "k-06-1", person_id: "p-06", category: "tube_feeding" as const, depends_on: null, depends_check: null },
    { id: "k-03-1", person_id: "p-03", category: "dialysis" as const, depends_on: null, depends_check: null },
    { id: "k-08-1", person_id: "p-08", category: "insulin" as const, depends_on: "refrigeration" as const, depends_check: "confirmed" as const },
  ];

  it("checks の無い世界は今までと同じ（同じ行の物を返す）", () => {
    const out = worldClocks.drillClocks(clocks, { ...EMPTY_WORLD });
    out.forEach((k, i) => expect(k).toBe(clocks[i]));
  });

  it("施設の休止・持ち出し忘れより後に当てる（両方あればこちら）。頼り先の無い時計は区分で当てる。ほかの人は変えない", () => {
    let w: WorldState = applyEvent(EMPTY_WORLD, { change: injectChange("supply_left", "p-06"), text: "", person: "p-06" }, 6);
    w = applyEvent(w, { change: injectChange("dialysis_flooded", "p-03"), text: "", person: "p-03" }, 12);
    // 確認の上書きの無い時は今までどおり未確認
    expect(worldClocks.drillClocks(clocks, w).map((k) => [k.depends_on, k.depends_check])).toEqual([
      ["delivery", "unconfirmed"],
      ["dialysis_center", "unconfirmed"],
      ["refrigeration", "confirmed"],
    ]);
    // 透析の振替・配達の手配で確認済、冷蔵できない所へ移って未確認
    w = { ...w, checks: { "p-06": { delivery: "confirmed" }, "p-03": { dialysis_center: "confirmed" }, "p-08": { refrigeration: "unconfirmed" } } };
    expect(worldClocks.drillClocks(clocks, w).map((k) => [k.depends_on, k.depends_check])).toEqual([
      ["delivery", "confirmed"],
      ["dialysis_center", "confirmed"],
      ["refrigeration", "unconfirmed"],
    ]);
    // 頼り先の書かれていない透析の時計にも、施設の休止なしで当たる
    const only = { ...EMPTY_WORLD, checks: { "p-03": { dialysis_center: "unconfirmed" as const } } };
    expect(worldClocks.drillClocks(clocks, only)[1]).toMatchObject({ depends_on: "dialysis_center", depends_check: "unconfirmed" });
    // 当てはまらない頼り先の上書きは時計を変えない
    const other = { ...EMPTY_WORLD, checks: { "p-08": { delivery: "unconfirmed" as const } } };
    expect(worldClocks.drillClocks(clocks, other)[2]).toBe(clocks[2]);
    // 元の行は変えない
    expect(clocks[1].depends_on).toBeNull();
  });
});

describe("withoutMemo（ケアマネの書いた文を Claude に流さない）", () => {
  const base: ActionRecord = {
    id: "a1",
    kind: "call_person",
    person: "p-01",
    target: null,
    callee: "self",
    calleeLabel: "本人",
    at: 1,
    atMinute: 60,
    endMinute: 65,
    minutes: 5,
    step: 1,
    before: { person: null, marks: {}, staff: 3, phone: "ok", roadClosed: false },
    result: null,
  };

  it("メモも文も無い手は同じ物を返す", () => {
    const out = engine.withoutMemo([base]);
    expect(out[0]).toBe(base);
    expect(engine.actionWithoutMemo(base)).toBe(base);
    expect(engine.actionWithoutMemo(null)).toBeNull();
  });

  it("メモ・自由に書く手の文・読み替えの理由を落とす。ほかの欄と元の手は変えない", () => {
    const free: ActionRecord = { ...base, id: "a2", memo: "先に電話", text: "隣の人に見に行ってもらう", reason: "見守依頼に近い" };
    const [out] = engine.withoutMemo([free]);
    expect(out).toEqual({ ...base, id: "a2" });
    expect("memo" in out || "text" in out || "reason" in out).toBe(false);
    expect(JSON.stringify(engine.actionWithoutMemo(free))).not.toMatch(/先に電話|隣の人|見守依頼/);
    expect(free.text).toBe("隣の人に見に行ってもらう");
  });
});
