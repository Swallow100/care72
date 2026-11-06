// T165（docs/tasks/T165.md）の訓練のテスト。偽の答えだけ（本物の Claude を呼ばない）。
// 評価の 7 回目の審査役の指摘の形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import type { PersonState } from "./engine.ts";
import { timeOf } from "./engine.ts";
import { EVENT_CATALOG } from "./event-catalog.ts";
import { dayLine, nightLine, startHourOf, timeLines } from "./night.ts";
import {
  BACKSTAGE,
  carryPromises,
  dropFactSlips,
  factLines,
  factsOf,
  GATE_RULES,
  intentsSaid,
  issuedBlock,
  placeSaid,
  planOf,
  quietPeople,
  sentenceSlip,
  slipContextOf,
  voiceLostSaid,
  type Facts,
  type SlipContext,
} from "./person-facts.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";

const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const state = (over: Partial<PersonState>): PersonState => ({ color: "green", source: "family", whereNow: "home", at: 1, saying: null, doing: null, ...over });
const ctx = (over: Partial<SlipContext> = {}): SlipContext => ({ place: null, together: [], kin: null, powerBack: false, noSpare: false, down: false, ...over });

describe("いる所の言い方（T165）", () => {
  it("「家で横になっている」「家で座って話せる」は家にいる言い方。避難所にいる人の言葉なら落とす", () => {
    expect(placeSaid("家で横になっている")).toBe("home");
    expect(placeSaid("家で座って話せる")).toBe("home");
    expect(sentenceSlip("家で横になっている", ctx({ place: "shelter" }))).toBe("place_text");
    expect(sentenceSlip("家で横になっている", ctx({ place: "home" }))).toBeNull();
    // 家で話し合う（相談）は家にいる言い方に入れない
    expect(placeSaid("家族で話し合っています")).toBeNull();
  });

  it("「避難所へ歩いて行きます」「避難所へ妻と行きます」も向かう言い方。行けない言い方は向かうと見ない", () => {
    expect(placeSaid("計画どおり避難所へ歩いて行きます。")).toBe("going");
    expect(placeSaid("避難所へ妻と行きます。")).toBe("going");
    expect(placeSaid("避難所へ車で移ります。")).toBe("going");
    expect(placeSaid("避難所へ歩いて行けません。")).toBeNull();
    // 向かうと言った人は計画の手段で移る（歩いて行ける人。前は言い方が取れず、移らないまま家にいた）
    const plan = planOf(seedInput("p-10"));
    const s = state({ at: 30, saying: "主人は元気です。計画どおり避難所へ歩いて行きます。" });
    const f = factsOf({ person: "p-10", world: EMPTY_WORLD, state: s, actions: [], now: 30 * 60 + 120, plan, inOutage: false });
    expect(f.going).toMatchObject({ can: true });
    expect(f.place?.where).toBe(plan?.destination === "shelter" ? "shelter" : "other");
  });
});

describe("前に言った予定（T165）", () => {
  it("119 へ掛ける・取りに行く予定を言葉から引き、済んだ・やめた言い方は入れない", () => {
    expect(intentsSaid("母は家で動けません。119にかけます。")).toEqual(["call119"]);
    expect(intentsSaid("119には、このあとかけます。")).toEqual(["call119"]);
    expect(intentsSaid("119にかけましたが、つながりません。")).toEqual([]);
    expect(intentsSaid("119はかけないことにしました。")).toEqual([]);
    expect(intentsSaid("家に栄養剤を取りに行きます。")).toEqual(["fetch"]);
    expect(intentsSaid("今は様子を見ています。")).toEqual([]);
  });

  it("予定は連絡を重ねて残り、済んだ言い方で消える。門で落とした言い直しの次の連絡でも残る", () => {
    const first = carryPromises(null, { saying: "119にかけます。", at: 30 });
    expect(first).toEqual([{ kind: "call119", at: 30 }]);
    // 言い直しは門で落ちて言葉に無い。前の様子から引き継ぐ
    const second = carryPromises(state({ at: 30, saying: "119にかけます。", promised: first }), { saying: "栄養剤が半分を過ぎました。", at: 36 });
    expect(second).toEqual([{ kind: "call119", at: 30 }]);
    const done = carryPromises(state({ at: 36, promised: second }), { saying: "119にかけて、救急車が来ました。", at: 51 });
    expect(done).toEqual([]);
    // 前の保存に予定の欄が無ければ前の言葉から引く
    expect(carryPromises(state({ at: 30, saying: "119にかけます。" }), { saying: null, at: 36 })).toEqual([{ kind: "call119", at: 30 }]);
  });

  it("帳面に予定の 1 行、門は同じ予定の言い直しを落とし、済んだ話・ほかの文は残す", () => {
    const f = factsOf({
      person: "p-06",
      world: EMPTY_WORLD,
      state: state({ at: 30, saying: "母は動けません。", promised: [{ kind: "call119", at: 30 }] }),
      actions: [],
      now: 36 * 60,
      plan: planOf(seedInput("p-06")),
      inOutage: false,
    });
    expect(f.promised).toEqual([{ kind: "call119", at: 1800 }]);
    expect(factLines(f).join("\n")).toContain("前に言った予定（まだ済んでいない）: 119 へ掛ける");
    const c = slipContextOf(f, "home");
    expect(c.promised).toEqual(["call119"]);
    const rules: string[] = [];
    const out = dropFactSlips("栄養剤が半分を過ぎました。119には、このあとかけます。", c, (r) => rules.push(r));
    expect(out).toBe("栄養剤が半分を過ぎました。");
    expect(rules).toContain("repeat_intent");
    expect(dropFactSlips("119にかけましたが、つながりません。", c)).toBe("119にかけましたが、つながりません。");
  });
});

describe("予備に替えた事の二度言い・声・裏側の言葉（T165）", () => {
  const facts = (over: Partial<Facts>): Facts =>
    ({
      ...factsOf({ person: "p-01", world: EMPTY_WORLD, state: null, actions: [], now: 480, plan: planOf(seedInput("p-01")), inOutage: false }),
      ...over,
    }) as Facts;
  const device = { label: "酸素", category: "oxygen", outAt: 120, spare: { label: "予備", at: 120, by: "本人", outAt: 600, assumed: false }, dueAt: null, down: false, backAt: null, remain: null, known: false };

  it("前の連絡より前に予備に替えた人の「予備に替えました」は落とす。残りの数のある文と、前の連絡のあとに替えた人は残す", () => {
    const before = slipContextOf(facts({ prevAt: 380, devices: [device] as never }));
    expect(before.swappedBefore).toBe(true);
    expect(sentenceSlip("酸素は電池から予備に替えました。", before)).toBe("swap_news");
    expect(sentenceSlip("予備に替えたけど、予備があと約2時間です。", before)).toBeNull();
    const fresh = slipContextOf(facts({ prevAt: 60, devices: [device] as never }));
    expect(fresh.swappedBefore).toBe(false);
    expect(sentenceSlip("酸素は電池から予備に替えました。", fresh)).toBeNull();
  });

  it("電話の出方の話（「電話では声が出ませんでした」）は声の印にしない。そばで見た声の話は今までどおり", () => {
    expect(voiceLostSaid("主人は家にいます。電話では声が出ませんでした。")).toBe(false);
    expect(voiceLostSaid("呼びかけても返事がありません。")).toBe(true);
    const f = factsOf({
      person: "p-10",
      world: EMPTY_WORLD,
      state: state({ at: 30, saying: "主人は家にいます。電話では声が出ませんでした。" }),
      actions: [],
      now: 31 * 60,
      plan: planOf(seedInput("p-10")),
      inOutage: false,
    });
    expect(f.voiceLost).toBeNull();
  });

  it("訓練の裏側の言葉（問いの途中で止まった・訓練）は落とす。ふつうの言葉は残す", () => {
    expect(BACKSTAGE.test("4 問の途中で止まった")).toBe(true);
    expect(sentenceSlip("いたくて、うごけないの。", ctx())).toBeNull();
    const rules: string[] = [];
    expect(dropFactSlips("いたくて、うごけないの。質問の途中で止まってしまったわ。", ctx(), (r) => rules.push(r))).toBe("いたくて、うごけないの。");
    expect(rules).toEqual(["backstage"]);
    expect(GATE_RULES).toEqual(expect.arrayContaining(["repeat_intent", "swap_news", "backstage"]));
  });
});

describe("業者の巡回を着いたあとに重ねない（T165）", () => {
  it("同じ人に業者が着いたあとは巡回の予定を出さない（着く前も重ねない）", () => {
    const row = EVENT_CATALOG.vendor_round;
    const src = seedInput("p-02");
    expect(row.eligible(src, "p-02", EMPTY_WORLD, null)).toBe(true);
    const arrived: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "vendor", arrive: 600, back: null, arrived: true, from: "director" }] } as WorldState;
    expect(row.eligible(src, "p-02", arrived, null)).toBe(false);
    const coming: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "vendor", arrive: 600, back: null, arrived: false, from: "director" }] } as WorldState;
    expect(row.eligible(src, "p-02", coming, null)).toBe(false);
  });
});

describe("まだ出来事の無い人（T165）", () => {
  it("監督・世界が出した出来事・道・施設・印のどれも無い人を並べる。結末を迎えた人は入れない", () => {
    const world = {
      ...EMPTY_WORLD,
      issued: [{ kind: "pharmacy_closed", person: "p-08", text: "薬局 休止", at: 600 }],
      roads: [{ id: "rd-ls-p-07", label: "山側の道", open: false, person: "p-07" }],
      marks: { "p-04": { wandering: 3 } },
      ended: { "p-09": { at: 20 } },
    } as unknown as WorldState;
    expect(quietPeople(world, ["p-01", "p-04", "p-07", "p-08", "p-09", "p-10"])).toEqual(["p-01", "p-10"]);
    const who = (p: string | null) => (p === "p-01" ? "A さん" : p === "p-10" ? "B さん" : p ? "X さん" : null);
    expect(issuedBlock(world, (k) => k, who, ["p-01", "p-10"]).at(-1)).toContain("まだ出来事の無い人");
    expect(issuedBlock(world, (k) => k, who, ["p-01", "p-10"]).at(-1)).toContain("A さん・B さん");
    // 人を渡さなければ前のまま
    expect(issuedBlock(world, (k) => k, who).join("\n")).not.toContain("まだ出来事の無い人");
  });
});

describe("昼の訓練の時刻の 1 行（T165）", () => {
  it("発災の時刻は started_at の日本の時刻。今の時刻と日を添える。夜間発災は前の 1 行のまま", () => {
    expect(startHourOf("2026-11-05T01:00:00.000Z")).toBe(10);
    expect(startHourOf("x")).toBeNull();
    expect(dayLine(36, 10)).toContain("発災は 10 時ごろ。今は 2 日目の 22 時ごろ");
    expect(dayLine(3, 10)).toContain("今は 13 時ごろ");
    expect(timeLines(5, { night: true })).toEqual([nightLine(5)]);
    expect(timeLines(5, { startHour: 10 })).toEqual([dayLine(5, 10)]);
    expect(timeLines(5, {})).toEqual([]);
    expect(timeOf({ startedAt: "2026-11-05T01:00:00.000Z", options: { night: true } })).toEqual({ night: true });
    expect(timeOf({ startedAt: "2026-11-05T01:00:00.000Z" })).toEqual({ startHour: 10 });
  });
});
