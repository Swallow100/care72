// T178: 評価の 11 回目の「直す所」の 1〜3。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { advance, initialState, type DrillTurn, type PersonaInput } from "./engine.ts";
import { EVENT_CATALOG } from "./event-catalog.ts";
import type { DirectorEvent } from "./incident-types.ts";
import { factsOf, planOf, sentenceSlip, slipContextOf, startsMove, talkContextOf } from "./person-facts.ts";
import { fireScheduled } from "./schedule.ts";
import { changesWhere, SAME_CUT_HOLD_MINUTES } from "./state-rules.ts";
import { EMPTY_WORLD } from "./scenarios.ts";

const source = (id: string) => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { ledger: p.ledger, clocks: p.clocks, contacts: p.contacts };
};
const factsFor = (id: string) => factsOf({ person: id, world: EMPTY_WORLD, state: null, actions: [], now: 600, plan: planOf(source(id)), inOutage: false, startHour: 10 });

describe("移る言葉（門と台が同じ表）", () => {
  // 自力で移れる人（p-10）と、移れない人（寝たきりの p-02）
  const mover = factsFor("p-10");
  const stuck = factsFor("p-02");
  const says = [
    // 行き先の語が無い言い方
    "これから移ります。",
    "今から移ります。",
    "透析の時間が近いので、これから移ります。",
    "道が通れるようになったので移ります。",
    "車で移ります。",
    "娘の車で移動します。",
    "父を車で移します。",
    // 読点を挟む言い方
    "父を車で避難所へ、これから移ります。",
    "高台の集会所へ、今から移ります。",
    "避難所へ車で、これから行きます。",
    "避難所へ、母を連れて移ります。",
    // 前からの形
    "これから避難所へ歩いて移ります。",
    "避難所へ行きます。",
  ];
  const talk = [
    // 頼み事・打ち消し・問い
    "移る手だてを頼みます。",
    "移る車をお願いします。",
    "移る準備の相談をしたいです。",
    "道が通れず移れません。",
    "移りますか。",
    "移るかは相談します。",
    "移ろうか迷っています。",
    // 条件つき
    "手伝う人か車が来たら、移ります。",
    "水が引いてから移ります。",
    "道が通れたら避難所へ移ります。",
    // 本人でない・家の中・機器の話
    "今から母の家へ向かいます。",
    "これから向かいます。",
    "2階へ移ります。",
    "2階へ、これから移ります。",
    "予備に移ります。",
    "場所を移ります。",
    "電話が移ります。",
    "父を2階へ移します。",
    // 計画の説明・済んだ話
    "計画では避難所に行く予定です。",
    "移るのは後です。",
    "2階にいます。",
  ];

  it.each(says)("移ると言った文: %s", (s) => {
    expect(startsMove(mover, [s])).toBe(true);
    expect(sentenceSlip(s, { ...slipContextOf(stuck, "home"), noMove: true })).toBe("move_said");
  });

  it.each(talk)("普通の会話は移ると言った事にしない: %s", (s) => {
    expect(startsMove(mover, [s])).toBe(false);
    expect(sentenceSlip(s, { ...slipContextOf(stuck, "home"), noMove: true })).not.toBe("move_said");
  });

  it("する事の短い形も読む。文ごとに見る", () => {
    expect(startsMove(mover, [null, "車で移る。"])).toBe(true);
    expect(startsMove(mover, [null, "移る手だてを頼む。家にいる"])).toBe(false);
    expect(startsMove(mover, ["さっきは道が通れず移れませんでした。これから移ります。"])).toBe(true);
    expect(startsMove(mover, ["車が来たら移ります。今は家です。"])).toBe(false);
  });

  it("通話でも移れない人は同じ文で落ちる", () => {
    expect(sentenceSlip("これから移ります。", talkContextOf(stuck))).toBe("move_said");
    expect(sentenceSlip("移る手だてを頼みます。", talkContextOf(stuck))).not.toBe("move_said");
  });
});

describe("同じ刻みの出来事と連絡", () => {
  const seed = (id: string) => SEED_PEOPLE.find((x) => x.person.id === id)!;
  const eventSource = (id: string) => ({ person: seed(id).person, ledger: seed(id).ledger, contacts: seed(id).contacts, clocks: seed(id).clocks });

  it("家族の帰宅困難は同居の家族のいる人に出さない。同居がいなければ前のまま", () => {
    const row = EVENT_CATALOG.family_stranded;
    const can = (id: string) => row.eligible(eventSource(id) as never, id, EMPTY_WORLD, null);
    for (const id of SEED_PEOPLE.map((p) => p.person.id)) {
      const fam = seed(id).contacts.filter((c) => c.kind === "family");
      const together = fam.some((c) => c.reach === "together");
      const far = fam.some((c) => c.reach !== null && c.reach !== "together");
      expect([id, can(id)]).toEqual([id, far && !together]);
    }
  });

  it("いる所を変える出来事の見分け", () => {
    expect(changesWhere({ kind: "mark", mark: "wandering" })).toBe(true);
    expect(changesWhere({ kind: "mark", mark: "carSleep" })).toBe(true);
    expect(changesWhere({ kind: "going_home" })).toBe(true);
    expect(changesWhere({ kind: "mark", mark: "familyAway" })).toBe(false);
    expect(changesWhere({ kind: "nurse_away" })).toBe(false);
  });

  it("次へ回した出来事は AI の印と種類を持ったまま時刻が来る", () => {
    const world = { ...EMPTY_WORLD, scheduled: [{ at: 600, change: { kind: "mark" as const, mark: "wandering" as const }, text: "本人が家の外へ出た", person: "p-04", by: "director" as const, ai: true, inject: "wandering" as const }] };
    const { incidents, world: rest } = fireScheduled(world, 600);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ ai: true, inject: "wandering", person: "p-04", at: 10 });
    expect(rest.scheduled).toEqual([]);
    expect(fireScheduled({ ...EMPTY_WORLD, scheduled: [{ at: 60, change: { kind: "outage_restored" as const }, text: "停電 復旧", by: "director" as const }] }, 60).incidents[0].ai).toBe(false);
  });

  describe("監督の出来事の当たり方（engine）", () => {
    const P = "p-04";
    const start = () => initialState("earthquake", SEED_PEOPLE.map((p) => p.person.id), "2026-11-07T01:00:00.000Z", { clock: true });
    const wander: DirectorEvent = { inject: "wandering", person: P, text: "本人が家の外へ出て行き先が分からない", ai: true };
    const hooksWith = (saying: string) =>
      ({
        director: async () => [wander],
        persona: async (input: PersonaInput): Promise<DrillTurn[]> => (input.person === P ? [{ person: P, color: "green", source: "supporter", whereNow: "home", at: input.hour, saying, doing: null, injured: null, atHome: null, canMove: null, hasMedicine: null, ai: true }] : []),
      }) as never;

    it("同じ時刻に連絡のある人のいる所を変える出来事は次の区切りへ回り、回したあとに当たる", async () => {
      const first = await advance(start(), 0, {} as never, { policy: "clock" } as never);
      const a = await advance(first!.state, 600, hooksWith("様子を見ました。"), { policy: "clock" } as never);
      expect(a!.tick.turns.filter((t) => t.person === P).length).toBeGreaterThan(0);
      expect(a!.tick.incidents.some((e) => e.person === P && e.change.kind === "mark")).toBe(false);
      expect(a!.state.world.scheduled?.map((s) => s.at)).toEqual([600 + SAME_CUT_HOLD_MINUTES]);
      const b = await advance(a!.state, 600 + SAME_CUT_HOLD_MINUTES + 60, { persona: async () => [] } as never, { policy: "clock" } as never);
      const got = b!.tick.incidents.find((e) => e.person === P && e.change.kind === "mark");
      expect(got).toBeTruthy();
      expect(got!.ai).toBe(true);
      expect(b!.state.world.marks[P]?.wandering).toBeDefined();
    });

    it("連絡の無い人には今までどおり区切りの終わりに当たる", async () => {
      const first = await advance(start(), 0, {} as never, { policy: "clock" } as never);
      const a = await advance(first!.state, 600, { director: async () => [wander], persona: async () => [] } as never, { policy: "clock" } as never);
      expect(a!.tick.incidents.some((e) => e.person === P && e.change.kind === "mark")).toBe(true);
      expect(a!.state.world.scheduled ?? []).toEqual([]);
    });
  });
});
