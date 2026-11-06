// T158（docs/tasks/T158.md）の訓練のテスト。偽の答えだけ（本物の Claude を呼ばない）。
// 評価の 6 回目で見えた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import type { PersonaInput, PersonState } from "./engine.ts";
import { EVENT_CATALOG } from "./event-catalog.ts";
import {
  carryPlace,
  dropFactSlips,
  dropRepeats,
  factLines,
  factsOf,
  overlapOf,
  placeOfState,
  placeSaid,
  placeWords,
  planOf,
  sentenceFix,
  sentenceSlip,
  type SlipContext,
} from "./person-facts.ts";
import { buildPersona, clockWords, personaTurns, TALK_REPEAT_ACKS, TALK_SYSTEM, talkAsked, talkPrior, type PersonaAnswer } from "./persona.ts";
import type { TalkLine } from "./dialogue.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";

const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const state = (over: Partial<PersonState>): PersonState => ({ color: "green", source: "family", whereNow: "home", at: 1, saying: null, doing: null, ...over });
const NONE: PersonaAnswer = { condition: "", location: "home", action: "", contactsCaremanager: false, from: "", pressesRed: false, redAnswers: null, speech: "" };
const personaInput = (person: string, over: Partial<PersonaInput> = {}): PersonaInput => ({
  step: 3,
  hour: 4,
  person,
  world: EMPTY_WORLD,
  incidents: [],
  state: null,
  lastAction: null,
  actions: [],
  fixed: [],
  toMinute: 240,
  ...over,
});
const ctx = (over: Partial<SlipContext> = {}): SlipContext => ({ place: null, together: [], kin: null, powerBack: false, noSpare: false, down: false, ...over });

describe("いる所: 赤の「家にいない」で避難所を家の外にしない", () => {
  it("前に避難所と言っていれば、赤の「家にいない」は避難所のまま。言葉が避難所にいると言っていても避難所", () => {
    const atShelter = state({ whereNow: "shelter", at: 30 });
    expect(carryPlace(atShelter, { color: "red", whereNow: null, atHome: false })).toBe("shelter");
    expect(carryPlace(null, { color: "red", whereNow: null, atHome: false, saying: "車で避難所に移りました。" })).toBe("shelter");
    // 前が家なら、赤の「家にいない」はその他（前のまま）
    expect(carryPlace(state({ whereNow: "home" }), { color: "red", whereNow: null, atHome: false })).toBe("other");
    // いる所の分からない連絡は前のまま。赤の「家にいる」は家
    expect(carryPlace(atShelter, { color: "red", whereNow: null, atHome: null })).toBe("shelter");
    expect(carryPlace(atShelter, { color: "red", whereNow: null, atHome: true })).toBe("home");
    // 引き継いだ物を読むと避難所（前の保存には無いので、無ければ前の読み方のその他）
    expect(placeOfState({ ...state({ color: "red", whereNow: null }), atHome: false, placeKnown: "shelter" })).toBe("shelter");
    expect(placeOfState({ ...state({ color: "red", whereNow: null }), atHome: false })).toBe("other");
  });

  it("帳面のいる所は避難所で、「家の外（避難所でない所）」と書かない。どこか分からない赤の「家にいない」も「避難所でない」と書かない", () => {
    const plan = planOf(seedInput("p-06"));
    const known: PersonState = { ...state({ color: "red", whereNow: null, at: 50 }), atHome: false, placeKnown: "shelter" };
    const f = factsOf({ person: "p-06", world: EMPTY_WORLD, state: known, actions: [], now: 3900, plan, inOutage: false });
    expect(f.place).toMatchObject({ where: "shelter", by: "turn" });
    expect(placeWords(f)).toBe("避難所");
    const loose = factsOf({ person: "p-06", world: EMPTY_WORLD, state: { ...known, placeKnown: undefined }, actions: [], now: 3900, plan, inOutage: false });
    expect(loose.place).toMatchObject({ where: "other", loose: true });
    expect(placeWords(loose)).not.toContain("避難所でない");
    expect(factLines(loose).join("\n")).toContain("家にいない");
  });

  it("移送の車が前の連絡より前に着いていれば、そのあとの赤の「家にいない」は移った先のまま", () => {
    const plan = planOf(seedInput("p-06"));
    const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-06", role: "transport", arrive: 2900, back: null, arrived: true, from: "a1" }] };
    const red: PersonState = { ...state({ color: "red", whereNow: null, at: 49 }), atHome: false };
    const f = factsOf({ person: "p-06", world, state: red, actions: [], now: 3800, plan, inOutage: false });
    expect(f.place?.where).toBe(plan.destination === "shelter" ? "shelter" : "other");
  });
});

describe("いる所の言葉の門", () => {
  it("言葉が言ういる所: 避難所にいる・家にいる・避難所へ向かう・家に置いてきた", () => {
    expect(placeSaid("今は避難所にいます。")).toBe("shelter");
    expect(placeSaid("車で避難所に移りました。")).toBe("shelter");
    expect(placeSaid("これから避難所へ移ります。")).toBe("going");
    expect(placeSaid("母と二人、家にいます。")).toBe("home");
    expect(placeSaid("家には父と私の二人です。")).toBe("home");
    expect(placeSaid("私が家で付き添っています。")).toBe("home");
    expect(placeSaid("薬を家に置いてきました。")).toBe("left");
    expect(placeSaid("電気は戻りました。")).toBeNull();
    // 向かうか迷っている・行きたいが行けないは向かうと言った事にしない
    expect(placeSaid("避難所に行くか迷っています。")).toBeNull();
    expect(sentenceSlip("避難所に行くか迷っています。", ctx({ place: "shelter", shelterBefore: true }))).toBeNull();
  });

  it("前から避難所の人の「避難所へ移ります」「避難所ではない」「家で付き添う」を落とす。家にいる人が向かうと言うのは落とさない", () => {
    expect(sentenceSlip("避難所へ移ります。", ctx({ place: "other", shelterBefore: true }))).toBe("place_text");
    expect(sentenceSlip("避難所ではありません。", ctx({ place: "other", shelterBefore: true }))).toBe("place_text");
    expect(sentenceSlip("私が家で付き添っています。", ctx({ place: "shelter" }))).toBe("place_text");
    expect(sentenceSlip("家には父と私の二人です。", ctx({ place: "shelter" }))).toBe("place_text");
    expect(sentenceSlip("これから避難所へ移ります。", ctx({ place: "home" }))).toBeNull();
    // この連絡そのものが「向かう途中」の緑の避難所は見ない（前の連絡からの避難所だけ）
    expect(sentenceSlip("これから避難所へ行きます。", ctx({ place: "shelter" }))).toBeNull();
  });

  it("前の連絡でもう避難所と言った人の「避難所に着きました」は「避難所にいます」に直す", () => {
    const r = sentenceFix("避難所に着きました。", ctx({ place: "shelter", shelterBefore: true }));
    expect(r.text).toBe("避難所にいます。");
    expect(r.rules).toContain("old_news");
    expect(sentenceFix("避難所に着きました。", ctx({ place: "shelter" })).rules).toEqual([]);
  });
});

describe("電池・栄養剤の残りの数", () => {
  it("予備で動いているのに残りの数を予備と言わなければ「予備の」を足す。同じ言葉で予備に替えたと言っていれば足さない", () => {
    const on = ctx({ onSpare: true });
    expect(dropFactSlips("呼吸器の電池があと50分です。", on)).toBe("呼吸器の予備の電池があと50分です。");
    expect(dropFactSlips("呼吸器はあと50分です。", on)).toBe("予備で、呼吸器はあと50分です。");
    expect(dropFactSlips("予備のボンベに替えました。あと3時間です。", on)).toBe("予備のボンベに替えました。あと3時間です。");
    const hits: string[] = [];
    dropFactSlips("電池があと50分です。", on, (r) => hits.push(r));
    expect(hits).toEqual(["spare_unsaid"]);
    // 内蔵の電池で動いている間は足さない
    expect(dropFactSlips("電池があと50分です。", ctx())).toBe("電池があと50分です。");
  });

  it("家に置いてきた栄養剤の残りの時間を言う文を落とす。本人役の時計の段は「手元に無い」で、残りを書かない", () => {
    expect(sentenceSlip("栄養剤はあと3時間です。", ctx({ leftBehind: true }))).toBe("left_remain");
    expect(sentenceSlip("栄養剤を届けてほしいです。", ctx({ leftBehind: true }))).toBeNull();
    const persona = buildPersona(seedInput("p-06"));
    const world: WorldState = { ...EMPTY_WORLD, marks: { "p-06": { supplyLeft: 6 } } };
    const lines = clockWords(persona, world, "p-06", 900).filter((x) => x.includes("手元に無い"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(/残り [0-9]/);
    // 印の前は今までどおり残りを書く
    expect(clockWords(persona, EMPTY_WORLD, "p-06", 300).some((x) => x.includes("手元に無い"))).toBe(false);
  });

  it("家にいると連絡のあった人に栄養剤の持ち出し忘れを出さない", () => {
    const row = EVENT_CATALOG.supply_left;
    const src = seedInput("p-06") as unknown as Parameters<typeof row.eligible>[0];
    expect(row.eligible(src, "p-06", EMPTY_WORLD, state({ whereNow: "home" }))).toBe(false);
    expect(row.eligible(src, "p-06", EMPTY_WORLD, state({ whereNow: "shelter" }))).toBe(true);
    expect(row.eligible(src, "p-06", EMPTY_WORLD, null)).toBe(true);
  });
});

describe("繰り返し", () => {
  it("前に言った文とほぼ同じ文を落とす。全部同じなら、刻みの連絡は元のまま・通話は空", () => {
    expect(overlapOf("薬は二階で取れません。", "薬は二階で、まだ取れません。")).toBeGreaterThanOrEqual(0.6);
    expect(dropRepeats("電気は戻りました。薬は二階で取れません。", ["家にいます。薬は二階で取れません。"])).toBe("電気は戻りました。");
    expect(dropRepeats("薬は二階で取れません。", ["薬は二階で取れません。"], { keepAll: true })).toBe("薬は二階で取れません。");
    expect(dropRepeats("薬は二階で取れません。", ["薬は二階で取れません。"])).toBe("");
    // 短い文（「はい」「分かりました」）は見ない
    expect(dropRepeats("はい。電気が戻りました。", ["はい。"])).toBe("はい。電気が戻りました。");
  });

  it("刻みの連絡は前の連絡とほぼ同じ文を落とし、落とした数を門の数えに", () => {
    const persona = buildPersona(seedInput("p-06"));
    const dropped: string[] = [];
    const prev = state({ whereNow: "shelter", at: 21, saying: "母が家に帰ると言っています。食べ物が届いていません。" });
    const [t] = personaTurns(
      personaInput("p-06", { state: prev, hour: 36 }),
      persona,
      { ...NONE, contactsCaremanager: true, from: "娘", location: "shelter", speech: "母が家に帰ると言っています。夜は冷えてきました。" },
      (r) => dropped.push(r),
    );
    expect(t.saying).toBe("夜は冷えてきました。");
    expect(dropped).toContain("repeat_said");
  });

  it("通話の往復: 前の返事・頼み事を数え、指示にくり返さない決まりがある", () => {
    const lines: TalkLine[] = [
      { who: "cm", text: "けがはありませんか", ai: false, minute: 10, ask: "injured" },
      { who: "them", text: "けがはありません。毛布がほしいです。", ai: true, minute: 11, asks: ["warmth"] },
      { who: "cm", text: "はい", ai: false, minute: 11 },
      { who: "them", text: "はい、分かりました", ai: false, minute: 12 },
    ];
    expect(talkPrior(lines)).toEqual(["けがはありません。毛布がほしいです。"]);
    expect(talkAsked(lines)).toEqual(["warmth"]);
    expect(TALK_SYSTEM).toContain("くり返さない");
    expect(TALK_SYSTEM).not.toContain("また頼んでよい。ケアマネ");
    expect(new Set(TALK_REPEAT_ACKS).size).toBe(TALK_REPEAT_ACKS.length);
  });
});
