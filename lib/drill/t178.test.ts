// T178: 評価の 11 回目の「直す所」の 1〜3。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { advance, initialState, type DrillTurn, type PersonaInput } from "./engine.ts";
import { EVENT_CATALOG } from "./event-catalog.ts";
import type { DirectorEvent } from "./incident-types.ts";
import { isPhoneTurn } from "./calls.ts";
import { DOWN_FOLLOW_MINUTES, FAR_DOWN_SAYINGS, farDownSaying, factLines, factsOf, planOf, sentenceSlip, slipContextOf, startsMove, talkContextOf } from "./person-facts.ts";
import { buildPersona, personaTurns, type PersonaAnswer } from "./persona.ts";
import { routeTurns, homeOf } from "./comms.ts";
import { profileOf } from "./fit.ts";
import { createClockHooks } from "./hooks.ts";
import { fireScheduled } from "./schedule.ts";
import { changesWhere, SAME_CUT_HOLD_MINUTES } from "./state-rules.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";

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

describe("機器が止まったままの間", () => {
  // 一人暮らしで浸水の区域の酸素の人（種の p-01。離れた娘がいる）と、大雨の 1 時間目からの区域の停電
  const ID = "p-01";
  const seedInput = (id: string) => {
    const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
    return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
  };
  const plan = planOf(seedInput(ID));
  const device = plan.devices[0];
  const spare = plan.spares.find((s) => s.category === device.category)!;
  const SINCE = 1;
  const CUT = Math.round((SINCE + device.hours! + spare.hours!) * 60);
  const AREA = { scope: "hazard" as const, hazard: "flood" as const, minDepthM: 3 };
  const world: WorldState = { ...EMPTY_WORLD, outage: { area: AREA, since: SINCE, restoredAt: null } };
  const RADIO_OFF = Math.round((SINCE + profileOf("heavy_rain")!.radio.hours) * 60);
  const persona = buildPersona(seedInput(ID), { on: "2026-11-05", fit: "heavy_rain" });
  const answer: PersonaAnswer = { condition: "", location: "home", action: "", contactsCaremanager: true, from: "本人", pressesRed: true, redAnswers: { injured: null, atHome: true, canMove: null, hasMedicine: null }, speech: "機械は止まったままです。" };
  const prev = { color: "red" as const, source: "agent" as const, whereNow: null, at: CUT / 60, saying: "機械が止まりました。", doing: null, atHome: true, injured: null, canMove: null, hasMedicine: null };
  const turnsAt = (minute: number, w: WorldState = world, a: PersonaAnswer = answer) =>
    personaTurns({ step: 9, hour: minute / 60, person: ID, world: w, incidents: [], state: prev, lastAction: null, actions: [], fixed: [], toMinute: minute, since: CUT, reasons: ["clock"] }, persona, a);

  it("種の人の形を確かめる（切れた時刻より後に区域の電波が不通になる）", () => {
    expect(RADIO_OFF).toBeGreaterThan(CUT);
    expect(homeOf(seedInput(ID).ledger).zones.some((z) => z.kind === "flood" && (z.depthM ?? 0) >= 3)).toBe(true);
  });

  it("電波のある間は本人の連絡のまま", () => {
    const [t] = turnsAt(RADIO_OFF - 60);
    expect(t).toMatchObject({ source: "agent", color: "red", ai: true });
  });

  it("家の電波が不通の間は、離れた家族がつながらない事を伝える（コードの言葉、AI の印なし、赤、着信にしない）", () => {
    const [t] = turnsAt(RADIO_OFF + 60);
    expect(t).toMatchObject({ source: "family", color: "red", ai: false, atHome: true });
    expect(FAR_DOWN_SAYINGS).toContain(t.saying);
    const routed = routeTurns([t], world, profileOf("heavy_rain"), { [ID]: homeOf(seedInput(ID).ledger) });
    expect(routed.dropped).toEqual([]);
    expect(routed.turns).toHaveLength(1);
    expect(isPhoneTurn(routed.turns[0])).toBe(false);
  });

  it("全域の不通では離れた家族も届かないので替えない。連絡しない答えでも理由が時計なら同じ", () => {
    expect(turnsAt(RADIO_OFF + 60, { ...world, radio: "down" })[0].source).toBe("agent");
    const [t] = turnsAt(RADIO_OFF + 60, world, { ...answer, contactsCaremanager: false, from: "", pressesRed: false, redAnswers: null, speech: "" });
    expect(t.source).toBe("family");
    expect(t.ai).toBe(false);
  });

  it("家族の連絡の言葉は前と同じ文を続けず、機器を言い切らない", () => {
    expect(farDownSaying(FAR_DOWN_SAYINGS[1], 1)).not.toBe(FAR_DOWN_SAYINGS[1]);
    const ctx = { ...slipContextOf(factsFor("p-02"), "home"), down: true };
    for (const s of FAR_DOWN_SAYINGS.flatMap((x) => x.split(/(?<=[。])/u)).filter(Boolean)) expect([s, sentenceSlip(s, ctx)]).toEqual([s, null]);
  });

  it("止まってから 12 時間のあとも 8 時間ごとに呼ぶ。72 時間まで間が開かない。電気が戻ると止まる", async () => {
    const gaps = DOWN_FOLLOW_MINUTES.slice(1).map((m, i) => m - DOWN_FOLLOW_MINUTES[i]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(480);
    expect(DOWN_FOLLOW_MINUTES.at(-1)! + 180).toBeGreaterThanOrEqual(72 * 60 - 180);
    const sources = new Map(SEED_PEOPLE.map((p) => [p.person.id, { ledger: p.ledger, clocks: p.clocks.map((k) => ({ ...k, person_id: p.person.id })) }] as const));
    const hooks = createClockHooks({ loadOutcome: async () => sources as never });
    const drill = (w: WorldState) => ({ participants: [ID], world: w, people: {}, minute: 0, scenario: "heavy_rain" }) as never;
    const downs = (await hooks.marks!(drill(world))).filter((m) => m.kind === "down").map((m) => m.at);
    expect(downs).toEqual(DOWN_FOLLOW_MINUTES.map((g) => CUT + g));
    const back = CUT + 1300;
    const until = (await hooks.marks!(drill({ ...world, outage: { area: AREA, since: SINCE, restoredAt: back / 60 } }))).filter((m) => m.kind === "down").map((m) => m.at);
    expect(Math.max(...until)).toBeLessThan(back);
  });

  it("止まって半日を過ぎたら、周りの人の動きで変える言葉を帳面に渡す（半日より前は渡さない）", () => {
    const at = (now: number) => factLines(factsOf({ person: ID, world, state: prev, actions: [], now, plan, inOutage: true, together: [], kin: null, startHour: 10 })).join("\n");
    expect(at(CUT + 60)).not.toContain("半日を過ぎた");
    expect(at(CUT + 780)).toContain("半日を過ぎた");
    expect(at(CUT + 780)).not.toMatch(/苦しい|危険|重い|診/u);
  });
});
