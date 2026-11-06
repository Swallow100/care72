// T141（docs/tasks/T141.md）の訓練のテスト。偽の答え・偽の client だけ（本物の Claude を呼ばない）。
// 評価の 5 回目で見えた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import type { ActionRecord } from "./action-types.ts";
import type { PersonaInput, PersonState } from "./engine.ts";
import { aftershockOf, EVENT_CATALOG, extraWorldWords } from "./event-catalog.ts";
import { foundMinute, lostFollowUps, LOST_MAX_MINUTES, LOST_MIN_MINUTES } from "./lost.ts";
import {
  canLeaveHome,
  dropFactSlips,
  factLines,
  factsOf,
  gateLog,
  GO_MINUTES,
  placeWords,
  planOf,
  remainWords,
  scorePlans,
  sentenceFix,
  sentenceSlip,
  slipContextOf,
} from "./person-facts.ts";
import { buildPersona, personaTurns, type PersonaAnswer } from "./persona.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { FINDING_ASK, FINDING_TEXT_MAX, findingRoom, findingRooms, kindCounts, kindSummary, REVIEW_LIMIT, REVIEW_SYSTEM, REVIEW_WEIGHT, reviewBody } from "./review.ts";
import { applyEvent, EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { AREA_GAP_MINUTES, areaRested } from "./time-odds.ts";

const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const NONE: PersonaAnswer = { condition: "", location: "home", action: "", contactsCaremanager: false, from: "", pressesRed: false, redAnswers: null, speech: "" };
const answer = (over: Partial<PersonaAnswer>): PersonaAnswer => ({ ...NONE, ...over });
const state = (over: Partial<PersonState>): PersonState => ({ color: "green", source: "family", whereNow: "home", at: 1, saying: null, doing: null, ...over });
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
const OUTAGE: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0, restoredAt: null } };
const said = (text: string, at = 2) => state({ whereNow: "home", at, saying: text });

// ---------- いる所と動けるか ----------

describe("いる所: ふだん動けない人・浸水・訪問", () => {
  // 寝たきりの人（同居の人の車の無い形と、ある形を同じ台帳から作る）
  const base = seedInput("p-02");
  const noCarer: PseudonymInput = { ...base, contacts: base.contacts.map((c) => ({ ...c, has_car: 0 })) };
  const visit = (atMinute: number): ActionRecord =>
    ({ id: "v1", person: "p-02", kind: "visit", step: 1, at: atMinute / 60, atMinute, result: { status: "arrived", atMinute, visit: { condition: "", speech: "", asks: [] } } }) as unknown as ActionRecord;

  it("ふだん動けない人は、同居で車のある人も来た人もいなければ、台帳の手段の字だけでは移らない（向かえない訳を書く）", () => {
    const plan = planOf(noCarer);
    expect(plan).toMatchObject({ immobile: true, move: true, carer: false });
    const f = factsOf({ person: "p-02", world: EMPTY_WORLD, state: said("計画どおり病院へ移ります。"), actions: [], now: 600, plan, inOutage: false });
    expect(f.place).toMatchObject({ where: "home", by: "turn" });
    expect(f.going).toMatchObject({ can: false, why: "helper" });
    expect(factLines(f).join("\n")).toContain("手伝う人か乗り物が来るまで");
    expect(canLeaveHome(f)).toBe(false);
  });

  it("手伝う人が来たら、その時刻に計画の避難先へ移る。言葉は避難先の種類（病院）で「家の外」と書かない", () => {
    const plan = planOf(noCarer);
    const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "nurse", arrive: 300, back: null, arrived: true, from: "a1" }] };
    const f = factsOf({ person: "p-02", world, state: said("計画どおり病院へ移ります。"), actions: [], now: 600, plan, inOutage: false });
    expect(f.place).toMatchObject({ where: "other", by: "plan", at: 300 });
    expect(placeWords(f)).toBe("病院");
    expect(factLines(f).join("\n")).toContain("いる所: 病院");
    expect(factLines(f).join("\n")).not.toContain("家の外");
  });

  it("川の氾濫の間、浸水の区域の家は計画の手段があっても移れない（同居の車があっても）", () => {
    const plan = planOf(base);
    expect(plan.carer).toBe(true);
    expect(plan.floodM).toBe(3);
    const dry = factsOf({ person: "p-02", world: EMPTY_WORLD, state: said("計画どおり病院へ移ります。"), actions: [], now: 120 + GO_MINUTES, plan, inOutage: false });
    expect(dry.place).toMatchObject({ by: "plan" });
    const wet = factsOf({ person: "p-02", world: { ...EMPTY_WORLD, flood: true }, state: said("計画どおり病院へ移ります。"), actions: [], now: 600, plan, inOutage: false });
    expect(wet.place).toMatchObject({ where: "home", by: "turn" });
    expect(wet.going).toMatchObject({ can: false, why: "blocked" });
    // 浸水の区域の外（浅い想定）の家は止めない
    const shallow = planOf({ ...base, ledger: { ...base.ledger, evacuation: { ...base.ledger.evacuation, hazards: [{ kind: "flood", depthM: 0.5 }] } } });
    expect(factsOf({ person: "p-02", world: { ...EMPTY_WORLD, flood: true }, state: said("計画どおり病院へ移ります。"), actions: [], now: 600, plan: shallow, inOutage: false }).place?.by).toBe("plan");
  });

  it("訪問は本人のいる所へ行くので、いる所を家に直さない（T167。計画の移動も本人・家族の連絡も訪問で上書きしない）", () => {
    const plan = planOf(base);
    const f = factsOf({ person: "p-02", world: EMPTY_WORLD, state: said("計画どおり病院へ移ります。"), actions: [visit(300)], now: 400, plan, inOutage: false });
    expect(f.place).toMatchObject({ where: "other", by: "plan" });
    const away = state({ color: "green", whereNow: "shelter", at: 2 });
    const g = factsOf({ person: "p-02", world: EMPTY_WORLD, state: away, actions: [visit(300)], now: 400, plan, inOutage: false });
    expect(g.place).toMatchObject({ where: "shelter", by: "turn" });
  });

  it("もう家の外にいると伝えた人（「避難所に移りました」）は、向かう途中と見ない", () => {
    const moved = state({ color: "red", whereNow: null, atHome: false, at: 2, saying: "避難所に移りました。" });
    const f = factsOf({ person: "p-02", world: EMPTY_WORLD, state: moved, actions: [], now: 400, plan: planOf(base), inOutage: false });
    expect(f.going).toBeNull();
    expect(f.place).toMatchObject({ where: "other", by: "turn" });
  });

  it("ふだん動けない人は、電源や薬が届いただけでは家から出ない（運べる人が来た時だけ）", () => {
    const persona = buildPersona(base, { on: "2026-11-05" });
    const world: WorldState = { ...EMPTY_WORLD, flood: true, arrivals: [{ person: "p-02", role: "power", arrive: 300, back: null, arrived: true, from: "a1" }] };
    const [t] = personaTurns(
      personaInput("p-02", { world, state: state({ whereNow: "home", at: 3 }), toMinute: 400 }),
      persona,
      answer({ contactsCaremanager: true, from: "夫", location: "other", speech: "電源が届きました。" }),
    );
    expect(t.whereNow).toBe("home");
  });

  it("家にいる人の「家の外にいます」は使わない。「家の外に出られない」は使う", () => {
    const f = factsOf({ person: "p-02", world: EMPTY_WORLD, state: said("家にいます。"), actions: [], now: 300, plan: planOf(noCarer), inOutage: false });
    const ctx = slipContextOf(f);
    expect(sentenceSlip("今は家の外にいます。", ctx)).toBe("place_text");
    expect(sentenceSlip("家の外に出られないので待っています。", ctx)).toBeNull();
  });

  it("本人役の答えで、ふだん動けない人が手も無く「家の外」に移ると、いる所を家に直す", () => {
    const persona = buildPersona(noCarer, { on: "2026-11-05" });
    const gates = gateLog();
    const [t] = personaTurns(
      personaInput("p-02", { state: state({ whereNow: "home", at: 3 }), toMinute: 400 }),
      persona,
      answer({ contactsCaremanager: true, from: "夫", location: "other", speech: "家内は家の外にいます。" }),
      gates.hit,
    );
    expect(t.whereNow).toBe("home");
    expect(t.saying ?? "").not.toContain("家の外にいます");
    expect(gates.take()).toMatchObject({ place_flip: 1, place_text: 1 });
  });

  it("採点の「計画の避難先へ移った」は、ふだん動けない人では計画の手段で移った時だけ数える", () => {
    const plan = planOf(noCarer);
    const people = { "p-02": state({ color: "red", whereNow: null, atHome: false, at: 10 }) };
    const s = scorePlans({ participants: ["p-02"], plans: new Map([["p-02", plan]]), world: EMPTY_WORLD, people, actions: [], endMinute: 900, inOutage: () => false });
    expect(s.rows.find((r) => r.person === "p-02")?.acted ?? []).not.toContain("evacuate");
  });
});

// ---------- 電池の残り・一度起きた事・停電の復旧 ----------

describe("電池: 残りの数をコードが決める", () => {
  const plan = planOf(seedInput("p-02"));

  it("内蔵の電池の間は、内蔵の残りと予備を合わせた残り、言う数を書く", () => {
    const f = factsOf({ person: "p-02", world: OUTAGE, state: null, actions: [], now: 60, plan, inOutage: true });
    expect(f.devices[0].remain).toEqual({ internal: 120, spare: 180, total: 300 });
    const text = factLines(f).join("\n");
    expect(text).toContain("内蔵の電池で動いている。残り 2 時間");
    expect(text).toContain("合わせた残り 5 時間");
    expect(text).toContain("残りを言う時の数: あと約 2 時間");
  });

  it("予備に替えたあとは予備の残りを言う数にする（10 分・30 分に丸める）", () => {
    const f = factsOf({ person: "p-02", world: OUTAGE, state: null, actions: [], now: 310, plan, inOutage: true });
    expect(f.devices[0].remain).toEqual({ internal: 0, spare: 50, total: 50 });
    // T158: 予備の残りは「予備の〜があと〜」と言う言い方まで書く
    expect(factLines(f).join("\n")).toContain("あと約 50 分（予備の残り");
    expect(remainWords(50)).toBe("約 50 分");
    expect(remainWords(95)).toBe("約 1 時間半");
    expect(remainWords(400)).toBe("約 7 時間");
  });

  it("帳面と合わない残りの数はコードの数に直す。合う数（内蔵・予備・合わせた残り）はそのまま", () => {
    const f = factsOf({ person: "p-02", world: OUTAGE, state: null, actions: [], now: 310, plan, inOutage: true });
    const ctx = slipContextOf(f);
    const fixed = sentenceFix("呼吸器の予備の電池はあと3時間しかもちません。", ctx);
    expect(fixed.rules).toEqual(["remain_mismatch"]);
    expect(fixed.text).toContain("約 50 分");
    expect(fixed.text).not.toContain("3時間");
    expect(sentenceFix("予備の電池はあと50分ほどです。", ctx).rules).toEqual([]);
    // 電池の話は次の文にも続く
    const gates = gateLog();
    const out = dropFactSlips("呼吸器が予備に替わりました。あと4時間ほどです。", ctx, gates.hit);
    expect(out).toContain("約 50 分");
    expect(gates.take()).toMatchObject({ remain_mismatch: 1 });
    // 電池でない話（薬・栄養剤）の数は見ない
    expect(sentenceFix("栄養剤はあと3時間分です。", ctx).rules).toEqual([]);
  });

  it("電池で動いていない（止まった・電気が戻った）のに残りの数を言う文は使わない", () => {
    const down = factsOf({ person: "p-02", world: OUTAGE, state: null, actions: [], now: 420, plan, inOutage: true });
    expect(dropFactSlips("電池はあと2時間ほどです。", slipContextOf(down))).toBe("");
  });

  it("前の連絡より前に切れた電池は「切れたまま」に直す。前の連絡のあとに切れたなら直さない", () => {
    const prevLate = state({ at: 10 });
    const f = factsOf({ person: "p-02", world: OUTAGE, state: prevLate, actions: [], now: 700, plan, inOutage: true });
    expect(f.devices[0].known).toBe(true);
    expect(factLines(f).join("\n")).toContain("新しい事のように「切れました」と言わない");
    const r = sentenceFix("家内の呼吸器の電池が切れました。", slipContextOf(f));
    expect(r).toMatchObject({ rules: ["old_news"] });
    expect(r.text).toContain("切れたままです");
    const prevEarly = state({ at: 5 });
    const g = factsOf({ person: "p-02", world: OUTAGE, state: prevEarly, actions: [], now: 420, plan, inOutage: true });
    expect(g.devices[0].known).toBe(false);
    expect(sentenceFix("予備も切れました。", slipContextOf(g)).rules).toEqual([]);
  });

  it("停電が戻ったあとは、機器は電気で動いていると書き、電池が切れた・止まったの文は使わない", () => {
    const world: WorldState = { ...OUTAGE, outage: { area: { scope: "office" }, since: 0, restoredAt: 48 } };
    const f = factsOf({ person: "p-02", world, state: state({ at: 43 }), actions: [], now: 50 * 60, plan, inOutage: true });
    expect(f.devices[0]).toMatchObject({ backAt: 48 * 60, down: false, remain: null, known: false });
    const text = factLines(f).join("\n");
    expect(text).toContain("今は電気で動いている");
    expect(text).not.toContain("予備も");
    const ctx = slipContextOf(f);
    expect(sentenceSlip("家内の呼吸器の予備も切れました。", ctx)).toBe("out_after_power");
    expect(sentenceSlip("停電の間に電池が切れましたが、電気が戻って動いています。", ctx)).toBeNull();
    // 予備が切れる前に戻れば、予備は切れていない
    const early: WorldState = { ...OUTAGE, outage: { area: { scope: "office" }, since: 0, restoredAt: 4 } };
    const e = factsOf({ person: "p-02", world: early, state: null, actions: [], now: 600, plan, inOutage: true });
    expect(e.devices[0].spare?.outAt).toBeNull();
  });
});

// ---------- 行き先の分からない人 ----------

describe("行き先の分からない人を世界が扱う", () => {
  const lostWorld = applyEvent({ ...EMPTY_WORLD, marks: {} }, { person: "p-04", change: { kind: "mark", mark: "wandering" }, text: "本人が家の外へ出た" }, 13.5);

  it("帳面のいる所は「行き先が分からない」（家と書かない）", () => {
    const f = factsOf({ person: "p-04", world: lostWorld, state: state({ at: 9 }), actions: [], now: 15 * 60, plan: planOf(seedInput("p-04")), inOutage: false });
    expect(f.place).toMatchObject({ by: "wandering", where: "other" });
    expect(factLines(f).join("\n")).toContain("行き先が分からない");
    expect(factLines(f).join("\n")).not.toContain("いる所: 家（");
    expect(sentenceSlip("母は家にいます。", slipContextOf(f))).toBe("place_text");
  });

  it("決まった時間のうちに見つかる（種と本人で揺れる。作り直しでは同じ）", () => {
    const at = foundMinute(lostWorld, "p-04", "seed-a")!;
    expect(at).toBeGreaterThanOrEqual(13.5 * 60 + LOST_MIN_MINUTES);
    expect(at).toBeLessThanOrEqual(13.5 * 60 + LOST_MAX_MINUTES);
    expect(foundMinute(lostWorld, "p-04", "seed-a")).toBe(at);
    const many = new Set(["a", "b", "c", "d", "e", "f"].map((s) => foundMinute(lostWorld, "p-04", s)));
    expect(many.size).toBeGreaterThan(1);
    const out = lostFollowUps(lostWorld, at - 1, at + 1, new Set(["p-04"]), "seed-a");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ person: "p-04", ai: false, change: { kind: "mark", mark: "found" } });
    // 区切りの外・参加者でない人は出さない
    expect(lostFollowUps(lostWorld, at, at + 60, new Set(["p-04"]), "seed-a")).toEqual([]);
    expect(lostFollowUps(lostWorld, at - 1, at + 1, new Set(["p-01"]), "seed-a")).toEqual([]);
  });

  it("見つかったあとは、いる所は家・「どこにいるか分からない」を本人役に渡さない・もう出さない", () => {
    const at = foundMinute(lostWorld, "p-04", "seed-a")!;
    const found = applyEvent(lostWorld, lostFollowUps(lostWorld, at - 1, at + 1, new Set(["p-04"]), "seed-a")[0], at / 60);
    const f = factsOf({ person: "p-04", world: found, state: state({ at: 9 }), actions: [], now: at + 30, plan: planOf(seedInput("p-04")), inOutage: false });
    expect(f.place).toMatchObject({ where: "home", by: "found" });
    expect(f.away).toBe(false);
    expect(extraWorldWords(found, "p-04").join("\n")).not.toContain("どこにいるか分からない");
    expect(extraWorldWords(found, "p-04").join("\n")).toContain("見つかり");
    expect(foundMinute(found, "p-04", "seed-a")).toBeNull();
  });
});

// ---------- 余震の間隔と言い回し ----------

describe("全体の出来事の間隔と言い回し（余震）", () => {
  it("同じ種類は回を重ねるほど間を広げる（種で揺れる）", () => {
    expect(areaRested("aftershock", [], 600, "s")).toBe(true);
    const one = [{ kind: "aftershock", at: 3000, person: null }];
    expect(areaRested("aftershock", one, 3000 + 190, "s")).toBe(false);
    expect(areaRested("aftershock", one, 3000 + AREA_GAP_MINUTES * 1.5, "s")).toBe(true);
    const two = [...one, { kind: "aftershock", at: 3600, person: null }];
    expect(areaRested("aftershock", two, 3600 + AREA_GAP_MINUTES * 1.4, "s")).toBe(false);
    expect(areaRested("aftershock", two, 3600 + AREA_GAP_MINUTES * 3, "s")).toBe(true);
    // 人ごとの出来事は数えない
    expect(areaRested("aftershock", [{ kind: "aftershock", at: 3000, person: "p-01" }], 3010, "s")).toBe(true);
  });

  it("震度と文はコードが決め、回ごとに変える（0 回目は前と同じ）", () => {
    expect(aftershockOf(30, 0)).toEqual({ intensity: "4", text: "余震 震度 4" });
    const texts = [0, 1, 2, 3].map((n) => aftershockOf(56, n).text);
    expect(new Set(texts).size).toBe(4);
    expect(aftershockOf(56, 1).intensity).toBe("3");
    expect(EVENT_CATALOG.aftershock.build({ person: null, nth: 2 }, 56, null)[0].text).toBe(aftershockOf(56, 2).text);
  });
});

// ---------- 講評の指摘を重い順に絞る ----------

describe("講評: 重い順に絞り、種類ごとに 1 つにまとめる", () => {
  // 評価の 5 回目に近い形（架空の数）: 順番の外れ 9 人・条件 2 人・空欄 3 人・遅い報告・頼み事 2 人・計画なし 3 人
  const who = (p: string | null | undefined) => (p ? `${p} さん` : "全体");
  const people = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09"];
  const R5 = {
    participants: [...people, "p-10"],
    endMinute: 4320,
    order: { matched: 1, total: 10, misses: people.map((p, i) => ({ person: p, why: [i % 2 ? "late" : "missing"], expected: i % 2 ? "p-10" : null })) },
    report: { minute: 58 * 60 + 20, tries: 1 },
    form9: { blanks: 3, rows: [{ person: "p-01", columns: ["shelter"] }, { person: "p-05", columns: ["shelter"] }, { person: "p-10", columns: ["shelter"] }] },
    reached: [{ person: "p-09", label: "x", hours: 2, outMinute: 180, tries: 1 }, { person: "p-04", label: "y", hours: 3, outMinute: 240, tries: 0 }],
    calls: { total: 11, answered: 5, declined: 0, open: 6, redDeclined: 0 },
    asks: { rows: [{ person: "p-04", kinds: ["water"] }, { person: "p-06", kinds: ["medicine"] }] },
    plans: { acted: 0, needed: 3, rows: [] },
  } as unknown as Parameters<typeof findingRooms>[0];

  it("候補は重い順に種類ごとの上限まで、合わせて REVIEW_LIMIT まで（順番は 1 つ）", () => {
    const rooms = findingRooms(R5);
    expect(rooms.order).toBe(1);
    expect(rooms.reached).toBe(2);
    expect(Object.values(rooms).reduce((a, b) => a + (b ?? 0), 0)).toBeLessThanOrEqual(REVIEW_LIMIT);
    expect(findingRoom(R5)).toBeLessThanOrEqual(REVIEW_LIMIT);
    // 重い種類から埋まる（空欄・ほかの種類は後）
    expect(Object.keys(rooms)).toEqual(REVIEW_WEIGHT.filter((k) => rooms[k] !== undefined));
    expect(kindCounts(R5)).toMatchObject({ order: 9, reached: 2, report: 1, blank: 3 });
    // 早い報告は候補にしない
    expect(kindCounts({ ...R5, report: { minute: 120, tries: 1 } } as typeof R5).report).toBe(0);
  });

  it("返事は重い順に並べ、種類ごと・全体の上限で切る", () => {
    const { key } = pseudonymize([seedInput("p-01"), seedInput("p-02")], {});
    const kinds = ["blank", "order", "order", "order", "choice", "reached", "order", "call", "report", "choice", "choice"];
    const many = kinds.map((k, i) => ({ person: "全体", kind: k, text: `次は手を変えて試す ${i}`, basis: "根拠なし" }));
    const body = reviewBody({ summary: "s", findings: many }, { key, members: new Set(["p-01", "p-02"]), max: findingRoom(R5), rooms: findingRooms(R5) });
    const got = body.findings.map((f) => f.kind);
    expect(got.length).toBeLessThanOrEqual(REVIEW_LIMIT);
    expect(got.filter((k) => k === "order")).toHaveLength(1);
    expect(got[0]).toBe("reached");
    const rank = got.map((k) => REVIEW_WEIGHT.indexOf(k));
    expect([...rank].sort((a, b) => a - b)).toEqual(rank);
  });

  it("入力は種類ごとの要約を先に、順番の外れは訳ごとに 1 行（1 人 1 行で並べない）", () => {
    const lines = kindSummary(R5, who);
    expect(lines[0]).toContain("種類ごとの要約");
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(REVIEW_WEIGHT.length - 1);
    expect(lines.join("\n")).toContain("外れ 9 人");
    expect(lines.join("\n")).toContain("ほか");
    expect(lines.join("\n")).toContain("24 時間より後");
  });

  it("指示に指摘の数の目安と短い字数を書く（決まった数をそろえさせない）", () => {
    expect(REVIEW_SYSTEM).toContain(`${REVIEW_LIMIT} つまで`);
    expect(REVIEW_SYSTEM).toContain(`${FINDING_ASK} 字まで`);
    expect(REVIEW_SYSTEM).toContain("同じ種類は 1 つにまとめ");
    expect(FINDING_ASK).toBeLessThan(FINDING_TEXT_MAX);
  });
});
