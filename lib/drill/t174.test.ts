// T174: 評価の 9 回目で人ごとの筋に残った形（機器が切れたあと・出られない人の電話・道の開通と理由）。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { crossedClocks, nextEventMinute, type ClockMark } from "./clock.ts";
import type { DrillState, PersonaInput, PersonState } from "./engine.ts";
import { createClockHooks } from "./hooks.ts";
import { CALL_FIXED_SPEECH } from "./labels.ts";
import { DOWN_FOLLOW_MINUTES, DOWN_SAYINGS, downCuts, factLines, factsOf, planOf, sentenceSlip, stuckDown, type SlipContext } from "./person-facts.ts";
import { buildPersona, personaTurns, TALK_REPEAT_ACKS, tickText, type PersonaAnswer } from "./persona.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { QUICK_REPLIES } from "./talk-quick.ts";

const ctx = (over: Partial<SlipContext> = {}): SlipContext => ({ place: "home", together: [], kin: null, powerBack: false, noSpare: false, down: false, ...over });
const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const state = (over: Partial<PersonState>): PersonState => ({ color: "red", source: "family", whereNow: null, at: 1, saying: null, doing: null, atHome: true, ...over });
const outage = (restoredAt: number | null = null): WorldState => ({ ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0, restoredAt } });
const answer = (over: Partial<PersonaAnswer> = {}): PersonaAnswer => ({ condition: "", location: "home", action: "", contactsCaremanager: true, from: "夫", pressesRed: false, redAnswers: null, speech: "予備も切れました。", ...over });

describe("機器が止まったあとの連絡", () => {
  const id = "p-02";
  const persona = buildPersona(seedInput(id), { on: "2026-11-05" });
  const plan = planOf(seedInput(id));
  const device = plan.devices[0];
  const spare = plan.spares.find((s) => s.category === device.category)!;
  const cut = Math.round((device.hours! + spare.hours!) * 60);
  const input = (minute: number, over: Partial<PersonaInput> = {}): PersonaInput => ({ step: 3, hour: minute / 60, person: id, world: outage(), incidents: [], state: state({ at: 1 }), fixed: [], actions: [], toMinute: minute, ...over } as PersonaInput);

  it("止まる時刻: 予備があれば予備の切れる時刻、予備も外の電源も無ければ内蔵の切れる時刻、外の電源があれば無し", () => {
    const runs = [{ person: id, label: device.label, outMinute: 180 }];
    expect(downCuts(plan, id, runs)).toEqual([180 + Math.round(spare.hours! * 60)]);
    expect(downCuts({ ...plan, spares: [] }, id, runs)).toEqual([180]);
    expect(downCuts({ ...plan, spares: [], power: true }, id, runs)).toEqual([]);
    expect(downCuts({ ...plan, spares: plan.spares.map((s) => ({ ...s, hours: null })) }, id, runs)).toEqual([]);
  });

  it("止まったままの間は緑を押さず赤にする。AI のする事の色も合わせる。色の出どころはコードで、連絡の順には触らない", () => {
    const dropped: string[] = [];
    const [t] = personaTurns(input(cut), persona, answer({ action: "夫が緑を押す" }), (r) => dropped.push(r));
    expect(t).toMatchObject({ color: "red", source: "family", whereNow: null, ai: true, saying: "予備も切れました。" });
    expect(t.doing).toBe("夫が赤を押す");
    expect(dropped).toContain("calm_while_down");
  });

  it("本人役が連絡しないと答えても、止まった時刻の呼び出しでは押せる人がコードの言葉で赤を連絡する。AI の印を付けない", () => {
    const [t] = personaTurns(input(cut, { reasons: ["clock"] }), persona, answer({ contactsCaremanager: false, speech: "", from: "" }));
    expect(t).toMatchObject({ color: "red", source: "family", ai: false });
    expect(DOWN_SAYINGS).toContain(t.saying);
    expect(sentenceSlip(t.saying!, ctx({ down: true }))).toBeNull();
  });

  it("コードの言葉で連絡するのは機器の見える人だけ。遠くの家族しか押せなければ連絡しない答えのまま", () => {
    const far = { ...persona, together: [], reporters: persona.reporters.map((r) => ({ ...r, canPress: r.source === "family" })) };
    expect(personaTurns(input(cut, { reasons: ["clock"] }), far, answer({ contactsCaremanager: false, speech: "", from: "" }))).toEqual([]);
  });

  it("AI の言葉が全部落ちてコードの言葉に替わったら AI の印を付けない", () => {
    const [t] = personaTurns(input(cut), persona, answer({ speech: "本人は無事です。" }));
    expect(t).toMatchObject({ color: "red", ai: false });
    expect(DOWN_SAYINGS).toContain(t.saying);
  });

  it("前の連絡の直後でほかの理由の呼び出しなら、連絡しない答えのまま", () => {
    expect(personaTurns(input(cut, { reasons: ["incident"], state: state({ at: cut / 60 - 0.5 }) }), persona, answer({ contactsCaremanager: false, speech: "", from: "" }))).toEqual([]);
  });

  it("電気が戻った・電源が届いた・家の外へ移ったあとは緑を使える。止まる前も緑を使える", () => {
    const after = cut + 60;
    expect(personaTurns(input(after, { world: outage(cut / 60) }), persona, answer({ speech: "電気で動いています。" }))[0].color).toBe("green");
    expect(personaTurns(input(after, { world: { ...outage(), supplies: { [id]: { power: cut - 10 } } } }), persona, answer({ speech: "電源で動いています。" }))[0].color).toBe("green");
    expect(personaTurns(input(cut - 60), persona, answer({ speech: "予備で動いています。" }))[0].color).toBe("green");
    const f = (s: PersonState) => factsOf({ person: id, world: outage(), state: s, actions: [], now: after, plan, inOutage: true });
    expect(stuckDown(f(state({ at: 1 })))).toBe(true);
    expect(stuckDown(f(state({ at: 1, color: "green", whereNow: "shelter", atHome: null })))).toBe(false);
  });

  it("想定の表の緑の行も、止まったまま家にいる間は赤にする。表の言う事の元を使わない。止まる前は表のまま", () => {
    const row = { person: id, color: "green" as const, source: "family" as const, whereNow: "home" as const, saying: "予備で動いています" };
    const dropped: string[] = [];
    const [t] = personaTurns(input(cut, { fixed: [row] }), persona, answer({ speech: "" }), (r) => dropped.push(r));
    expect(t).toMatchObject({ color: "red", whereNow: null, atHome: true });
    expect(DOWN_SAYINGS).toContain(t.saying);
    expect(dropped).toContain("calm_while_down");
    expect(tickText(input(cut, { fixed: [row] }), persona)).not.toContain("予備で動いています");
    const [before] = personaTurns(input(cut - 60, { fixed: [row] }), persona, answer({ speech: "" }));
    expect(before).toMatchObject({ color: "green", whereNow: "home", saying: "予備で動いています" });
    expect(tickText(input(cut - 60, { fixed: [row] }), persona)).toContain("予備で動いています");
  });

  it("「落ち着いたまま」は予備が切れた人の帳面にも書く", () => {
    const f = factsOf({ person: id, world: outage(), state: state({ at: 1 }), actions: [], now: cut + 10, plan, inOutage: true });
    expect(factLines(f).join("\n")).toContain("緑（無事）を押さない");
  });

  it("無事の言い切りは止まったままでは落とす。問い・打ち消しは残す", () => {
    const c = ctx({ down: true });
    expect(sentenceSlip("本人は無事です。", c)).toBe("calm_while_down");
    for (const s of ["本人は無事じゃないです。", "無事ではありません。", "無事ですか。"]) expect(sentenceSlip(s, c)).toBeNull();
  });

  describe("呼ぶ時刻（kind down）", () => {
    const sources = new Map(SEED_PEOPLE.map((p) => [p.person.id, { ledger: p.ledger, clocks: p.clocks.map((k) => ({ ...k, person_id: p.person.id })) }] as const));
    const hooks = createClockHooks({ loadOutcome: async () => sources as never });
    const drill = (over: Partial<DrillState> = {}): DrillState => ({ participants: [id], world: outage(), people: {}, minute: 0, scenario: "heavy_rain", ...over }) as DrillState;
    const downs = (ms: ReadonlyArray<ClockMark>) => ms.filter((m) => m.kind === "down").map((m) => m.at);

    it("止まってから 2・6・12 時間。電気が戻る・電源が届くと、その後は呼ばない", async () => {
      expect(downs(await hooks.marks!(drill()))).toEqual(DOWN_FOLLOW_MINUTES.map((g) => cut + g));
      expect(downs(await hooks.marks!(drill({ world: outage((cut + DOWN_FOLLOW_MINUTES[1] + 1) / 60) })))).toEqual(DOWN_FOLLOW_MINUTES.slice(0, 2).map((g) => cut + g));
      expect(downs(await hooks.marks!(drill({ world: { ...outage(), supplies: { [id]: { power: cut + 1 } } } })))).toEqual([]);
    });

    it("家の外へ移った人・移送の車が着いた人は呼ばない。直前に連絡があった時刻は呼ばない", async () => {
      expect(downs(await hooks.marks!(drill({ people: { [id]: state({ color: "green", whereNow: "shelter", atHome: null, at: 1 }) } })))).toEqual([]);
      expect(downs(await hooks.marks!(drill({ world: { ...outage(), arrivals: [{ person: id, role: "transport", arrive: 100, back: 100, arrived: true, from: "a1" }] } })))).toEqual([]);
      const near = cut + DOWN_FOLLOW_MINUTES[0] - 30;
      expect(downs(await hooks.marks!(drill({ people: { [id]: state({ at: near / 60 }) } })))).not.toContain(cut + DOWN_FOLLOW_MINUTES[0]);
    });

    it("呼ぶ理由にはなるが「次まで」の行き先にしない（区切りを増やさない）", async () => {
      const marks = await hooks.marks!(drill());
      const first = cut + DOWN_FOLLOW_MINUTES[0];
      expect(crossedClocks(marks, first - 1, first)).toEqual([id]);
      const atCut = { scenario: "heavy_rain" as const, minute: first - 10, world: EMPTY_WORLD };
      expect(nextEventMinute(atCut, marks.filter((m) => m.kind === "down"))).toBeGreaterThan(first);
    });
  });
});

describe("コードの短い返事（門を通らない文）", () => {
  const fixed = [...Object.values(QUICK_REPLIES).flat(), ...TALK_REPEAT_ACKS, CALL_FIXED_SPEECH];
  const sentences = fixed.flatMap((t) => t.split(/(?<=[。！？!?])/u)).filter(Boolean);

  it.each(["home", "shelter", "other", null] as const)("機器が止まったままでも帳面と食い違わない（いる所 %s）", (place) => {
    for (const s of sentences) expect([s, sentenceSlip(s, ctx({ down: true, place }))]).toEqual([s, null]);
  });
});
