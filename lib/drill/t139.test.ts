// T139（docs/tasks/T139.md）のテスト。偽の答え・偽の client だけ（本物の Claude を呼ばない）。
// 評価の 4 回目で見えた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { CLIP_MARK, clipWords, endsMidSentence } from "./clip.ts";
import { BUSY_CALL_RATE, homeOf, routeRoll, routeTurns, viaOf } from "./comms.ts";
import type { DrillTurn, PersonaInput, PersonState } from "./engine.ts";
import { factLines, factsOf, gateLog, GO_MINUTES, planOf, screenTurn, sentenceSlip, slipContextOf, WITH_MINUTES } from "./person-facts.ts";
import {
  buildPersona,
  CALL_PICKUP_ODDS,
  CALL_SYSTEM,
  cleanPersonaWords,
  PERSONA_SYSTEM,
  personaTurns,
  SPEECH_ASK,
  SPEECH_MAX,
  TALK_SYSTEM,
  VISIT_SYSTEM,
  type PersonaAnswer,
} from "./persona.ts";
import { FINDINGS_MAX, findingRoom, findingRooms, REVIEW_SYSTEM, reviewBody } from "./review.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import type { DrillScore } from "./score.ts";
import { drillDropped, drillLeanings, kindOnTime, OFF_BAND_MAX, offBand, POOL_DROP } from "./time-odds.ts";

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
const LONG =
  "さっきから電池の残りが少なくなってきていて心配です。業者さんにも訪問看護にも連絡がつながりにくくて、このまま家で待っていればいいのか分からないのですがどうしたらいいでしょうか";

// ---------- 1. 言葉を文の切れ目で切る ----------

describe("言葉を文の途中で切らない（clipWords）", () => {
  it("上限の中ならそのまま。超えたら上限の中の最後の句点まで", () => {
    expect(clipWords("家にいます。", 10)).toBe("家にいます。");
    const out = clipWords(LONG, SPEECH_MAX);
    expect(Array.from(out).length).toBeLessThanOrEqual(SPEECH_MAX);
    expect(out.endsWith("。")).toBe(true);
    expect(endsMidSentence(out, Array.from(out).length)).toBe(false);
  });

  it("句点が上限の中に無ければ読点の前で「…」。どちらも無ければ上限の手前で「…」", () => {
    const comma = "電池の残りが少なくなってきているので業者さんか訪問看護の人に、早めに来てもらえると本当に助かるのですがどうしたらいいでしょう";
    const c = clipWords(comma, 40);
    expect(c.endsWith(CLIP_MARK)).toBe(true);
    expect(c).not.toContain("、…");
    const plain = "あ".repeat(100);
    expect(clipWords(plain, 30)).toBe(`${"あ".repeat(29)}${CLIP_MARK}`);
  });

  it("本人役の言葉の掃除（全部の道が通る）は長い返事を文の切れ目で切る", () => {
    const { key } = pseudonymize([seedInput("p-01")], { on: "2026-11-05" });
    const out = cleanPersonaWords(LONG, key, SPEECH_MAX)!;
    expect(out.endsWith("。") || out.endsWith(CLIP_MARK)).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(SPEECH_MAX);
  });

  it("刻み・通話・往復・訪問の指示に字数を書く（決まり 6・7 の文は変えない）", () => {
    for (const sys of [PERSONA_SYSTEM, CALL_SYSTEM, TALK_SYSTEM, VISIT_SYSTEM]) expect(sys).toContain(`${SPEECH_ASK} 字まで`);
    expect(SPEECH_ASK).toBeLessThan(SPEECH_MAX);
    expect(PERSONA_SYSTEM).toContain("6. 名前・住所・電話番号を言わない。「A さん」とも言わない。");
    expect(PERSONA_SYSTEM).toContain("7. 「診断」「判定」「重症」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。");
  });

  it("刻みの安否の言う事も切れ目で切れる（表の行の無い連絡）", () => {
    const persona = buildPersona(seedInput("p-01"), { on: "2026-11-05" });
    const [t] = personaTurns(personaInput("p-01"), persona, answer({ contactsCaremanager: true, from: "本人", location: "home", speech: LONG }));
    expect(t.saying).not.toBeNull();
    expect(t.saying!.endsWith("。") || t.saying!.endsWith(CLIP_MARK)).toBe(true);
  });
});

// ---------- 2. 帳面（電池の残り・いる所・そばにいる人） ----------

describe("帳面: 予備の時間と残り", () => {
  it("予備の時間が台帳に無ければ内蔵と同じ時間の見込み。替えたあとの残りと切れる時刻を書く", () => {
    const plan = planOf(seedInput("p-02"));
    expect(plan.spares[0]).toMatchObject({ hours: 3, assumed: true });
    // 停電 0 時間 → 内蔵 3 時間で切れ → 予備 3 時間。4 時間の時点は予備の残り 2 時間
    const f = factsOf({ person: "p-02", world: OUTAGE, state: null, actions: [], now: 240, plan, inOutage: true });
    expect(f.devices[0].spare).toMatchObject({ at: 180, outAt: 360, assumed: true });
    expect(factLines(f).join("\n")).toContain("予備の残り 2 時間（見込み）");
    // 7 時間の時点は予備も切れて止まっている（落ち着いたままと言わない）
    const late = factsOf({ person: "p-02", world: OUTAGE, state: null, actions: [], now: 420, plan, inOutage: true });
    expect(late.devices[0].down).toBe(true);
    expect(sentenceSlip("呼吸器は予備でまだもっています。", slipContextOf(late))).toBe("spare_without_plan");
  });

  it("内蔵の電池で動いている間は残りを書く", () => {
    const f = factsOf({ person: "p-02", world: OUTAGE, state: null, actions: [], now: 60, plan: planOf(seedInput("p-02")), inOutage: true });
    expect(factLines(f).join("\n")).toContain("内蔵の電池で動いている。残り 2 時間");
  });
});

describe("帳面: いる所（移送の到着・向かうと言った後）", () => {
  const plan = planOf(seedInput("p-01"));

  it("移送の車が着いたら、いる所は避難先の種類。家にいると答えても帳面のいる所に直す", () => {
    const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-01", role: "transport", arrive: 200, back: null, arrived: true, from: "a1" }] };
    const prev = state({ whereNow: "home", at: 2, source: "agent" });
    const f = factsOf({ person: "p-01", world, state: prev, actions: [], now: 240, plan, inOutage: false });
    expect(f.place).toMatchObject({ where: "shelter", by: "transport", at: 200 });
    const gates = gateLog();
    const home: DrillTurn = { person: "p-01", color: "green", source: "agent", whereNow: "home", injured: null, atHome: null, canMove: null, hasMedicine: null, saying: null, doing: null, ai: true, at: 4 };
    expect(screenTurn(home, f, gates.hit)).toMatchObject({ whereNow: "shelter" });
    expect(gates.take()).toEqual({ place_flip: 1 });
  });

  it("避難先へ向かうと言い、計画に手段があれば GO_MINUTES で着いたと見る。手段が無ければ「向かえていない」を書く", () => {
    const said = state({ whereNow: "home", at: 2, saying: "これから避難所へ向かいます。" });
    const before = factsOf({ person: "p-01", world: EMPTY_WORLD, state: said, actions: [], now: 120 + GO_MINUTES - 1, plan, inOutage: false });
    expect(before.place?.by).toBe("turn");
    expect(factLines(before).join("\n")).toContain("避難先へ向かうと言った");
    const after = factsOf({ person: "p-01", world: EMPTY_WORLD, state: said, actions: [], now: 120 + GO_MINUTES, plan, inOutage: false });
    expect(after.place).toMatchObject({ where: "shelter", by: "plan" });
    const none = { ...plan, move: false, helper: false };
    const stuck = factsOf({ person: "p-01", world: EMPTY_WORLD, state: said, actions: [], now: 400, plan: none, inOutage: false });
    expect(stuck.place?.where).toBe("home");
    expect(factLines(stuck).join("\n")).toContain("計画に移る手段が無い");
  });

  it("道が通れない・家の辺りが浸水の間は、計画に手段があっても移らない（向かえていない理由を言う）", () => {
    const said = state({ whereNow: "home", at: 2, saying: "これから避難所へ向かいます。" });
    const road: WorldState = { ...EMPTY_WORLD, roads: [{ id: "rd-1", label: "川沿いの市道", open: false, person: null }] };
    const f = factsOf({ person: "p-01", world: road, state: said, actions: [], now: 400, plan, inOutage: false });
    expect(f.place?.where).toBe("home");
    expect(factLines(f).join("\n")).toContain("道が通れない");
    const flooded: WorldState = { ...EMPTY_WORLD, marks: { "p-01": { flooded: 1 } } };
    expect(factsOf({ person: "p-01", world: flooded, state: said, actions: [], now: 400, plan, inOutage: false }).place?.where).toBe("home");
    // ほかの人の家の近くの道の通行止は効かない
    const other: WorldState = { ...EMPTY_WORLD, roads: [{ id: "rd-2", label: "山すその道", open: false, person: "p-07" }] };
    expect(factsOf({ person: "p-01", world: other, state: said, actions: [], now: 400, plan, inOutage: false }).place?.where).toBe("shelter");
  });

  it("「行かん」「向かえない」「行きたいが行けない」は向かうと言った事にしない", () => {
    for (const saying of ["避難所には行かん", "避難所へ向かえないです。", "避難所に行きたいが、道が通れず行けない。"]) {
      const f = factsOf({ person: "p-01", world: EMPTY_WORLD, state: state({ saying, at: 1 }), actions: [], now: 400, plan, inOutage: false });
      expect(f.going).toBeNull();
    }
  });
});

describe("帳面: そばにいる人と、避難所の人の言葉", () => {
  it("支援者が見に行った・家にいると伝えた間は「様子が分からない」を落とす。間が過ぎれば落とさない", () => {
    const seen = state({ source: "supporter", saying: "見に行きました。家にいます", at: 6 });
    const f = factsOf({ person: "p-04", world: EMPTY_WORLD, state: seen, actions: [], now: 360 + 60, plan: planOf(seedInput("p-04")), inOutage: false });
    expect(f.withPerson).toMatchObject({ by: "supporter", at: 360 });
    expect(sentenceSlip("様子が分からなくて心配です。", slipContextOf(f))).toBe("unknown_while_with");
    const later = factsOf({ person: "p-04", world: EMPTY_WORLD, state: seen, actions: [], now: 360 + WITH_MINUTES + 1, plan: planOf(seedInput("p-04")), inOutage: false });
    expect(sentenceSlip("様子が分からなくて心配です。", slipContextOf(later))).toBeNull();
  });

  it("避難所にいる人は、家の外（道・屋外）で動けないと言わない", () => {
    const f = factsOf({ person: "p-01", world: EMPTY_WORLD, state: state({ whereNow: "shelter", at: 3 }), actions: [], now: 400, plan: planOf(seedInput("p-01")), inOutage: false });
    expect(sentenceSlip("外で転んで動けない。", slipContextOf(f))).toBe("place_text");
    expect(sentenceSlip("避難所で少し休んでいます。", slipContextOf(f))).toBeNull();
  });
});

// ---------- 3. 赤 → 緑の抜け道 ----------

describe("赤（動けない）→ 緑の門の抜け道", () => {
  it("台帳でふだん歩けない人の「動けない」はけがと数えない（表の次の緑と食い違わない）", () => {
    const plan = planOf(seedInput("p-02"));
    expect(plan.immobile).toBe(true);
    const red = state({ color: "red", source: "family", canMove: false, atHome: true, at: 4 });
    const f = factsOf({ person: "p-02", world: EMPTY_WORLD, state: red, actions: [], now: 360, plan, inOutage: false });
    expect(f.hurt).toBeNull();
    // ふだん歩ける人の「動けない」は今までどおり
    const walker = factsOf({ person: "p-01", world: EMPTY_WORLD, state: red, actions: [], now: 360, plan: planOf(seedInput("p-01")), inOutage: false });
    expect(walker.hurt).not.toBeNull();
  });

  it("表の次の行が緑なら、表に無いけが・閉じ込めの赤を使わない（表の次が赤・表の行が無いなら使う）", () => {
    const persona = buildPersona(seedInput("p-01"), { on: "2026-11-05" });
    const hurt = answer({ contactsCaremanager: true, from: "本人", pressesRed: true, redAnswers: { injured: true, atHome: true, canMove: false, hasMedicine: true }, speech: "足を打ちました。" });
    const gates = gateLog();
    expect(personaTurns(personaInput("p-01", { ahead: { color: "green", at: 360 } }), persona, hurt, gates.hit)).toEqual([]);
    expect(gates.take()).toEqual({ hurt_to_safe: 1 });
    expect(personaTurns(personaInput("p-01", { ahead: { color: "red", at: 360 } }), persona, hurt)).toHaveLength(1);
    expect(personaTurns(personaInput("p-01"), persona, hurt)).toHaveLength(1);
    // けがの無い赤（電池が心配など）は表の次が緑でも使う
    const worry = answer({ contactsCaremanager: true, from: "本人", pressesRed: true, redAnswers: { injured: false, atHome: true, canMove: true, hasMedicine: true }, speech: "電池が心配です。" });
    expect(personaTurns(personaInput("p-01", { ahead: { color: "green", at: 360 } }), persona, worry)).toHaveLength(1);
  });
});

// ---------- 4. 出来事の候補と時間帯 ----------

describe("訓練ごとの出来事の候補と帯の外（kindOnTime）", () => {
  it("使わない種類は種で決まり、同じ種なら同じ・種が違えば違う。起きにくい側を含む", () => {
    const a = drillDropped("heavy_rain|2026-11-05T01:00:00.000Z");
    const b = drillDropped("heavy_rain|2026-11-06T01:00:00.000Z");
    expect(a.size).toBe(POOL_DROP);
    expect([...a]).toEqual([...drillDropped("heavy_rain|2026-11-05T01:00:00.000Z")]);
    expect([...a].sort()).not.toEqual([...b].sort());
    for (const k of drillLeanings("heavy_rain|2026-11-05T01:00:00.000Z").less) expect(a.has(k)).toBe(true);
    for (const k of a) expect(kindOnTime(k, 6, "heavy_rain|2026-11-05T01:00:00.000Z")).toBe(false);
  });

  it("帯の外の種類は、この訓練で起きやすい種類だけ OFF_BAND_MAX 回まで。種が無ければ見ない", () => {
    const seed = "earthquake|2026-11-05T01:00:00.000Z";
    const more = drillLeanings(seed).more;
    expect(kindOnTime("line_down", 40, null)).toBe(true);
    // 起きやすい種類のうち、ある帯で外になる物を探して確かめる
    const hours = [1, 6, 18, 40];
    const pair = more.flatMap((k) => hours.filter((h) => offBand(k, h)).map((h) => [k, h] as const))[0];
    if (pair) {
      const [k, h] = pair;
      expect(kindOnTime(k, h, seed)).toBe(true);
      const used = Array.from({ length: OFF_BAND_MAX }, () => ({ kind: k, at: h * 60 }));
      expect(kindOnTime(k, h, seed, used)).toBe(false);
    }
    // 起きやすくない帯の外の種類は差し込まない
    const lean = drillLeanings(seed);
    const off = (["line_down", "pharmacy_closed", "mobile_down", "outage_spread"] as const).flatMap((k) => hours.filter((h) => offBand(k, h)).map((h) => [k, h] as const));
    for (const [k, h] of off) if (!lean.more.includes(k)) expect(kindOnTime(k, h, seed)).toBe(false);
  });
});

// ---------- 5. 講評の指摘の数 ----------

describe("講評の指摘の数を種類ごとの中身に", () => {
  const EMPTY = {
    order: { matched: 1, total: 1, misses: [] },
    report: { minute: 120, tries: 1 },
    form9: { blanks: 0, rows: [] },
    reached: [],
    calls: { total: 0, answered: 0, declined: 0, open: 0, redDeclined: 0 },
  } as unknown as DrillScore;
  const { key } = pseudonymize([seedInput("p-01"), seedInput("p-02")], {});

  it("指示に決まった数（8）を書かない。候補の無い種類は書かない", () => {
    expect(REVIEW_SYSTEM).not.toMatch(/8 個|個まで/);
    expect(findingRooms(EMPTY)).toEqual({});
    expect(findingRoom(EMPTY)).toBe(0);
  });

  it("種類ごとの候補の数まで（候補の無い種類・数を超えた分は落とす）。中身が違えば数も内訳も違う", () => {
    const one = { ...EMPTY, reached: [{ person: "p-01" }] } as unknown as DrillScore;
    const rooms = findingRooms(one);
    expect(rooms).toEqual({ report: 1, reached: 1, other: 1 });
    const many = Array.from({ length: 10 }, (_, i) => ({ person: i % 2 ? "A さん" : "B さん", kind: ["reached", "call", "order", "reached", "other"][i % 5], text: `次は早めに本人電話 ${i}`, basis: "根拠なし" }));
    const body = reviewBody({ summary: "s", findings: many }, { key, members: new Set(["p-01", "p-02"]), max: findingRoom(one), rooms });
    const kinds = body.findings.map((f) => f.kind);
    expect(kinds.filter((k) => k === "reached")).toHaveLength(1);
    expect(kinds).not.toContain("call");
    expect(kinds).not.toContain("order");
    const two = { ...one, order: { matched: 0, total: 2, misses: [{ person: "p-01" }, { person: "p-02" }] }, calls: { total: 2, answered: 0, declined: 0, open: 1, redDeclined: 0 } } as unknown as DrillScore;
    expect(findingRooms(two)).toMatchObject({ order: 2, call: 1, reached: 1 });
    expect(findingRoom(two)).not.toBe(findingRoom(one));
    expect(FINDINGS_MAX).toBeGreaterThan(8);
  });
});

// ---------- 6. つながりにくい間の電話 ----------

describe("つながりにくい間（電話 不安定）の電話の形の連絡", () => {
  const home = homeOf(seedInput("p-03").ledger);
  const homes = { "p-03": home };
  const turn = (at: number, ai = true): DrillTurn => ({ person: "p-03", color: "green", source: "family", whereNow: "home", injured: null, atHome: null, canMove: null, hasMedicine: null, saying: "家にいます。", doing: null, ai, at });

  it("つながる割合はケアマネの電話に出る割合と同じ。決めは人と時刻からで、再生しても同じ", () => {
    expect(BUSY_CALL_RATE).toBe(CALL_PICKUP_ODDS.busy.answers);
    expect(routeRoll("p-03|60")).toBe(routeRoll("p-03|60"));
  });

  it("AI の電話の一部はメッセージで届く。通常の間・表の固定の行は電話のまま", () => {
    const busy: WorldState = { ...EMPTY_WORLD, phone: "busy" };
    const turns = Array.from({ length: 40 }, (_, i) => turn(1 + i * 0.5));
    const routed = routeTurns(turns, busy, null, homes).turns.map((t) => t.via);
    const calls = routed.filter((v) => v === "call").length;
    expect(calls).toBeGreaterThan(5);
    expect(calls).toBeLessThan(35);
    expect(routed.filter((v) => v === "message").length).toBe(40 - calls);
    expect(routeTurns(turns, EMPTY_WORLD, null, homes).turns.every((t) => t.via === "call")).toBe(true);
    expect(routeTurns(turns.map((t) => ({ ...t, ai: false })), busy, null, homes).turns.every((t) => t.via === "call")).toBe(true);
    // 決める数が無ければ（前からの呼び方）電話のまま
    expect(viaOf(turn(1), busy, { landline: "ok", mobile: "ok" })).toBe("call");
  });
});
