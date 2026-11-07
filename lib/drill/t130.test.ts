// T130（docs/tasks/T130.md）のテスト。偽の答え・偽の client だけ（本物の Claude を呼ばない）。
// 評価の 3 回目で審査役が挙げた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import type { UsageStore } from "../claude/usage.ts";
import { pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import type { ActionRecord } from "./action-types.ts";
import { screenRepeats } from "./director.ts";
import { advance, initialState, type DirectorEvent, type PersonaInput, type PersonState, type StepHooks } from "./engine.ts";
import {
  dropFactSlips,
  factsOf,
  gateLog,
  KIND_REPEAT_MAX,
  kindSpent,
  noteIssued,
  planOf,
  pushTold,
  sameWording,
  scorePlans,
  screenAsks,
  sentenceSlip,
  slipContextOf,
  supplyAllowed,
  wordingUsed,
} from "./person-facts.ts";
import { buildPersona, maskWith, PATH_RULE, PERSONA_SYSTEM, personaCallReply, personaFacts, personaTurns, tickText, type PersonaAnswer } from "./persona.ts";
import { findingRoom, reviewBody } from "./review.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import type { DrillScore } from "./score.ts";
import { farewellIncidents, worldIncidents, type ApplyContext } from "./world-apply.ts";
import { REASON_RULE_LINE } from "./world-oneshot.ts";

const START = "2026-11-05T01:00:00.000Z";
const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};

/** 同じ人で計画（予備・持ち物・避難先・手段）を外した台帳 */
function withoutPlan(src: PseudonymInput): PseudonymInput {
  return {
    ...src,
    ledger: { ...src.ledger, evacuation: { ...src.ledger.evacuation, destination1: undefined, destination2: undefined, transport: undefined, transportKind: undefined, carryItems: [] } },
    clocks: src.clocks.filter((k) => k.kind !== "supply"),
    contacts: src.contacts.filter((c) => c.kind !== "oxygen_supplier"),
  };
}

const NONE: PersonaAnswer = {
  condition: "",
  location: "home",
  action: "",
  contactsCaremanager: false,
  from: "",
  pressesRed: false,
  redAnswers: null,
  speech: "",
};
const answer = (over: Partial<PersonaAnswer>): PersonaAnswer => ({ ...NONE, ...over });

const state = (over: Partial<PersonState>): PersonState => ({ color: "green", source: "family", whereNow: "home", at: 1, saying: null, doing: null, ...over });

function personaInput(person: string, over: Partial<PersonaInput> = {}): PersonaInput {
  return { step: 3, hour: 4, person, world: EMPTY_WORLD, incidents: [], state: null, lastAction: null, actions: [], fixed: [], toMinute: 240, ...over };
}

/** 全域の停電（発災の時刻から） */
const OUTAGE: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0, restoredAt: null } };

// ---------- 計画（台帳から） ----------

describe("計画（planOf）", () => {
  it("予備の時計・持ち物の予備・避難先の種類・手段・業者の約束を台帳から読む（名前は持たない）", () => {
    const p1 = planOf(seedInput("p-01"));
    expect(p1.devices.map((d) => d.label)).toEqual(["酸素 内蔵電池"]);
    expect(p1.spares).toEqual([{ category: "oxygen", label: "酸素 予備ボンベ", hours: 8 }]);
    expect(p1).toMatchObject({ destination: "shelter", move: true, helper: true, vendor: false, zone: true });
    const p2 = planOf(seedInput("p-02"));
    // 持ち物の予備の時間は台帳に無いので、内蔵の電池と同じ時間の見込み（T139）
    expect(p2.spares).toEqual([{ category: "ventilator", label: "バッテリー", hours: 3, assumed: true }]);
    expect(p2).toMatchObject({ destination: "hospital", move: true, vendor: true });
    expect(JSON.stringify(p2)).not.toContain("かわなぎ");
  });

  it("計画を外した同じ人は、予備・避難先・手段・業者が無い", () => {
    expect(planOf(withoutPlan(seedInput("p-01")))).toMatchObject({ spares: [], destination: null, move: false, vendor: false });
  });
});

// ---------- 帳面の文（計画あり・なしで変わる） ----------

describe("帳面の文（本人役の刻みの文）", () => {
  it("停電で内蔵電池が切れたあと、計画のある人は「計画どおり予備に替えた」、無い人は「予備は無く戻らない」", () => {
    const withPlan = buildPersona(seedInput("p-01"), { on: "2026-11-05" });
    const noPlan = buildPersona(withoutPlan(seedInput("p-01")), { on: "2026-11-05" });
    const input = personaInput("p-01", { world: OUTAGE });
    const a = tickText(input, withPlan);
    const b = tickText(input, noPlan);
    expect(a).toContain("計画どおり酸素 予備ボンベに替えた");
    expect(a).toContain("計画（台帳");
    expect(b).toContain("予備は無く、電源が届くか停電が戻るまで戻らない");
    expect(b).toContain("予備は計画に無い");
    // 避難先の名前は渡さない（種類だけ）
    expect(a).not.toContain("かわなぎ小学校");
  });

  it("前に言った「動けない」と、そのあと誰も来ていない事を書く。同居の人も書く", () => {
    const persona = buildPersona(seedInput("p-02"), { on: "2026-11-05" });
    const t = tickText(personaInput("p-02", { state: state({ color: "red", injured: true, canMove: false, atHome: true, at: 2 }) }), persona);
    expect(t).toContain("前に言った事: 動けない・けが（2 時間）。そのあと誰も来ていない");
    expect(t).toContain("同居の人（もう家にいる。あとから「来た」と言わない）: 夫");
  });
});

// ---------- 門（帳面に反する答えを使わない） ----------

describe("赤（動けない）→ 緑の門", () => {
  // 台帳でふだん歩けない人（p-06 は歩行 困難）の「動けない」はけがと数えない（T139）ので、けがの赤で見る
  const red = state({ color: "red", source: "family", injured: true, canMove: false, atHome: true, at: 2 });
  const green = answer({ contactsCaremanager: true, from: "娘", pressesRed: false, location: "home", speech: "落ち着きました。" });

  it("手も到着も無いまま緑は使わない（連絡なし）。門の数を書き留める", () => {
    const persona = buildPersona(seedInput("p-06"), { on: "2026-11-05" });
    const gates = gateLog();
    expect(personaTurns(personaInput("p-06", { state: red }), persona, green, gates.hit)).toEqual([]);
    expect(gates.take()).toEqual({ hurt_to_safe: 1 });
  });

  it("前の連絡のあとに人が着いていれば緑を使う", () => {
    const persona = buildPersona(seedInput("p-06"), { on: "2026-11-05" });
    const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-06", role: "nurse", arrive: 200, back: null, arrived: true, from: "a1" }] };
    const [t] = personaTurns(personaInput("p-06", { state: red, world }), persona, green);
    expect(t).toMatchObject({ color: "green", whereNow: "home" });
  });

  it("計画で避難先へ移ると答えた（手段あり）は緑を使い、移った事は記録で（T177。着くまで家のまま）。同じ人で計画が無ければ使わない", () => {
    const moved = answer({ contactsCaremanager: true, from: "娘", location: "shelter", speech: "避難所に着きました。" });
    const plan = buildPersona(seedInput("p-06"), { on: "2026-11-05" });
    const noPlan = buildPersona(withoutPlan(seedInput("p-06")), { on: "2026-11-05" });
    expect(personaTurns(personaInput("p-06", { state: red }), plan, moved)[0]).toMatchObject({ color: "green", whereNow: "home", move: { to: "shelter", by: "plan" } });
    expect(personaTurns(personaInput("p-06", { state: red }), noPlan, moved)).toEqual([]);
  });

  it("表の行がある刻みは表のまま（骨。色を止めない）", () => {
    const persona = buildPersona(seedInput("p-06"), { on: "2026-11-05" });
    const fixed = [{ person: "p-06", color: "green" as const, source: "family" as const, whereNow: "home" as const }];
    const [t] = personaTurns(personaInput("p-06", { state: red, fixed }), persona, green);
    expect(t.color).toBe("green");
  });
});

describe("いる所の門", () => {
  const persona = buildPersona(withoutPlan(seedInput("p-06")), { on: "2026-11-05" });

  it("避難所にいた人が、手も戻った言葉も無く「家」と答えたら避難所に直す", () => {
    const gates = gateLog();
    const [t] = personaTurns(
      personaInput("p-06", { state: state({ whereNow: "shelter", at: 3 }) }),
      persona,
      answer({ contactsCaremanager: true, from: "娘", location: "home", speech: "様子を見ています。" }),
      gates.hit,
    );
    expect(t.whereNow).toBe("shelter");
    expect(gates.take()).toEqual({ place_flip: 1 });
  });

  it("「家に戻った」と言えば家にしてよい", () => {
    const [t] = personaTurns(
      personaInput("p-06", { state: state({ whereNow: "shelter", at: 3 }) }),
      persona,
      answer({ contactsCaremanager: true, from: "娘", location: "home", speech: "水が引いたので家に戻りました。" }),
    );
    expect(t.whereNow).toBe("home");
  });

  it("避難所にいるのに「家で過ごす」と言う文を落とす", () => {
    const [t] = personaTurns(
      personaInput("p-06", { state: state({ whereNow: "shelter", at: 3 }) }),
      persona,
      answer({ contactsCaremanager: true, from: "娘", location: "shelter", speech: "避難所に着きました。今夜は家で過ごします。" }),
    );
    // T158: 前の連絡でもう避難所と言った人の「着きました」は「避難所にいます」に（着いた知らせを 2 度言わない）
    expect(t.saying).toBe("避難所にいます。");
  });
});

describe("文の門（同居・いない家族・電気・予備・落ち着いたまま）", () => {
  const base = { place: "home" as const, together: [] as string[], kin: null, powerBack: false, noSpare: false, down: false };

  it("同居の人が「来た」・台帳に無い続柄の家族を落とす（お兄さん・孫娘の形は見ない）", () => {
    expect(sentenceSlip("夫がさっき帰ってきました。", { ...base, together: ["夫"] })).toBe("with_arrived");
    expect(sentenceSlip("夫が横にいます。", { ...base, together: ["夫"] })).toBeNull();
    expect(sentenceSlip("息子が来ると言っています。", { ...base, kin: ["娘"] })).toBe("absent_kin");
    expect(sentenceSlip("娘が来ると言っています。", { ...base, kin: ["娘"] })).toBeNull();
    expect(sentenceSlip("配達のお兄さんが来ました。", { ...base, kin: ["娘"] })).toBeNull();
  });

  it("電気が戻ったあとの電池の頼み事、予備の無い人の予備、止まった機器のまま落ち着いている、を落とす", () => {
    expect(sentenceSlip("電池を届けてほしいです。", { ...base, powerBack: true })).toBe("ask_after_power");
    expect(sentenceSlip("電池を届けてほしいです。", base)).toBeNull();
    expect(sentenceSlip("予備のバッテリーに替えました。", { ...base, noSpare: true })).toBe("spare_without_plan");
    expect(sentenceSlip("落ち着いています。", { ...base, down: true })).toBe("calm_while_down");
    expect(sentenceSlip("大丈夫ですか。", { ...base, down: true })).toBeNull();
    // 打ち消しの形（止まった機器の人の訴え・家にいて言う「避難所にいません」）は落とさない
    expect(sentenceSlip("大丈夫じゃないんです。", { ...base, down: true })).toBeNull();
    expect(sentenceSlip("落ち着いていません。", { ...base, down: true })).toBeNull();
    expect(sentenceSlip("問題なのは電池です。", { ...base, down: true })).toBeNull();
    expect(sentenceSlip("充電できないんです。", { ...base, down: true })).toBeNull();
    expect(sentenceSlip("予備に替えられません。", { ...base, noSpare: true })).toBeNull();
    expect(sentenceSlip("避難所にいません。", base)).toBeNull();
    expect(sentenceSlip("家で過ごせません。", { ...base, place: "shelter" })).toBeNull();
    expect(sentenceSlip("今夜は家で過ごします。", { ...base, place: "shelter" })).toBe("place_text");
    expect(dropFactSlips("停電です。落ち着いています。", { ...base, down: true })).toBe("停電です。");
  });

  it("同じ人で、計画の予備がある人は「予備に替えた」を残し、無い人は落とす", () => {
    const say = answer({ contactsCaremanager: true, from: "娘", location: "home", speech: "予備のボンベに替えました。" });
    const withPlan = buildPersona(seedInput("p-01"), { on: "2026-11-05" });
    const noPlan = buildPersona(withoutPlan(seedInput("p-01")), { on: "2026-11-05" });
    const input = personaInput("p-01", { world: OUTAGE });
    expect(personaTurns(input, withPlan, say)[0]?.saying).toBe("予備のボンベに替えました。");
    // 予備の無い人の「替えた」は落とす。止まったままなので連絡はコードの言葉で残す（T174）
    expect(personaTurns(input, noPlan, say)[0]?.saying ?? "").not.toContain("予備");
  });

  it("停電が戻ったあとの頼み事の電池・電源を外す", () => {
    const world: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0, restoredAt: 3 } };
    const f = factsOf({ person: "p-02", world, state: null, actions: [], now: 300, plan: planOf(seedInput("p-02")), inOutage: true });
    expect(screenAsks(["battery", "water", "power"], f)).toEqual(["water"]);
    expect(slipContextOf(f).powerBack).toBe(true);
  });
});

describe("声が無いと伝えられた本人", () => {
  const said = state({ source: "family", saying: "呼びかけても返事がありません。", at: 3 });

  it("本人からの連絡は人が来るまで使わない", () => {
    const persona = buildPersona(seedInput("p-01"), { on: "2026-11-05" });
    const r = personaTurns(personaInput("p-01", { state: said }), persona, answer({ contactsCaremanager: true, from: "本人", location: "home", speech: "大丈夫よ。" }));
    expect(r).toEqual([]);
  });

  it("本人への電話は物音だけ（Claude を呼ばない）", async () => {
    const persona = buildPersona(seedInput("p-01"), { on: "2026-11-05" });
    let called = 0;
    const client: ClaudeClient = { beta: { messages: { create: async () => ((called += 1), {} as never) } } };
    const r = await personaCallReply(
      persona,
      { person: "p-01", hour: 4, world: EMPTY_WORLD, incidents: [], state: said, callee: "本人" },
      "answers",
      ctxOf(client),
    );
    expect(r).toEqual({ pickup: "background_only", speech: null, ai: false });
    expect(called).toBe(0);
  });
});

// ---------- 監督・世界（業者の巡回・同じ出来事のくり返し・結末の理由） ----------

describe("業者の巡回は手か計画があるときだけ", () => {
  it("業者の約束（台帳の連絡先）のある人と、業者に連絡した人だけ", () => {
    expect(supplyAllowed("p-01", [], planOf(seedInput("p-01")))).toBe(false);
    expect(supplyAllowed("p-02", [], planOf(seedInput("p-02")))).toBe(true);
    expect(supplyAllowed("p-01", [{ person: "p-01", kind: "call_vendor" } as ActionRecord], planOf(seedInput("p-01")))).toBe(true);
  });

  it("世界（仮想）の業者の巡回は supplyOk が false なら当てない", () => {
    const src = seedInput("p-01");
    const { key } = pseudonymize([src], {});
    const ctx: ApplyContext = {
      key,
      facts: new Map([["p-01", { town: null, depends: [], categories: ["oxygen"], nurse: false }]]),
      ended: new Set(),
      hour: 3,
      via: "oneshot",
      supplyOk: () => false,
    };
    const step = { narration: "", events: [{ kind: "vendor", town: "", target: "A さん", name: "", value: "4" }], farewells: [] };
    expect(worldIncidents(step, ctx)).toEqual([]);
    expect(worldIncidents(step, { ...ctx, supplyOk: () => true }).some((e) => e.change.kind === "schedule")).toBe(true);
  });
});

describe("同じ出来事のくり返し", () => {
  it("出した出来事を覚え、同じ言い回しを別の人に使わない・同じ種類は上限まで", () => {
    let w: WorldState = { ...EMPTY_WORLD };
    w = noteIssued(w, [{ ai: true, inject: "pharmacy_closed", person: "p-03", text: "近くの薬局が今日は休み", at: 3 }]);
    expect(wordingUsed(w, "近くの薬局が今日は休み", "p-04")).toBe(true);
    expect(wordingUsed(w, "近くの薬局が今日は休み", "p-03")).toBe(false);
    expect(sameWording("A さんの家の前で倒木", "B さんの家の前で倒木")).toBe(true);
    const ev = (person: string, text: string): DirectorEvent => ({ inject: "pharmacy_closed", person, text, ai: true });
    const gates = gateLog();
    const kept = screenRepeats([ev("p-04", "近くの薬局が今日は休み"), ev("p-05", "かかりつけの薬局の電話が通じない")], w, gates);
    expect(kept.map((e) => e.person)).toEqual(["p-05"]);
    expect(gates.take()).toEqual({ repeat_text: 1 });
    expect(kindSpent(w, "pharmacy_closed")).toBe(false);
    for (let i = 1; i < KIND_REPEAT_MAX; i++) w = noteIssued(w, [{ ai: true, inject: "pharmacy_closed", person: `p-0${4 + i}`, text: `別の言い方 ${i}`, at: 4 }]);
    expect(kindSpent(w, "pharmacy_closed")).toBe(true);
  });

  it("区切りを進めると監督の出来事が world.issued に入り、門の数が world.gated に入る", async () => {
    const gates = gateLog();
    const hooks: StepHooks = {
      gates,
      director: async () => [{ inject: "pharmacy_closed", person: "p-03", text: "近くの薬局が休み", ai: true }],
      persona: async (input) => {
        if (input.person === "p-03") gates.hit("hurt_to_safe");
        return [];
      },
    };
    let s = (await advance(initialState("heavy_rain", ["p-03"], START, { clock: true }), 0, hooks))!.state;
    s = (await advance(s, 180, hooks, { policy: "clock", next: true }))!.state;
    expect((s.world.issued ?? []).some((x) => x.kind === "pharmacy_closed" && x.person === "p-03")).toBe(true);
    expect((s.world.gated?.hurt_to_safe ?? 0) > 0).toBe(true);
  });
});

describe("結末の理由に医療の言い方を入れない", () => {
  it("医療の語の入った理由は使わない（1 文はそのまま）。世界の刻みの文に理由の決まりの 1 行", () => {
    const src = seedInput("p-02");
    const { key } = pseudonymize([src], {});
    const ctx: ApplyContext = { key, facts: new Map([["p-02", { town: null, depends: [], categories: ["ventilator"], nurse: true }]]), ended: new Set(), hour: 7, via: "oneshot" };
    const [e] = farewellIncidents([{ target: "A さん", text: "この時間までに、手が届かなかった", reason: "停電が続き、呼吸器の内蔵電池が切れた" }], ctx);
    expect(e.change).toMatchObject({ kind: "outcome", reason: null });
    expect(e.text).toBe("この時間までに、手が届かなかった");
    expect(REASON_RULE_LINE).toContain("機器・体・薬の名前");
  });
});

// ---------- 講評の数・採点の記録 ----------

const EMPTY_SCORE: DrillScore = {
  v: 1,
  participants: ["p-01"],
  endMinute: 4320,
  order: { matched: 1, total: 1, misses: [] },
  report: { minute: 120, tries: 1 },
  form9: { blanks: 0, rows: [] },
  reached: [],
  calls: { total: 0, answered: 0, declined: 0, open: 0, redDeclined: 0 },
} as unknown as DrillScore;

describe("講評の指摘の数を中身に合わせる", () => {
  const { key } = pseudonymize([seedInput("p-01"), seedInput("p-02")], {});
  const eight = Array.from({ length: 8 }, (_, i) => ({ person: i % 2 ? "A さん" : "B さん", kind: ["order", "call", "report", "reached"][i % 4], text: `次は早めに本人電話 ${i}`, basis: "根拠なし" }));

  it("直す所が無ければ指摘は 0（決まった数を求めない）", () => {
    expect(findingRoom(EMPTY_SCORE)).toBe(0);
    expect(reviewBody({ summary: "よく回せた", findings: eight }, { key, members: new Set(["p-01", "p-02"]), max: findingRoom(EMPTY_SCORE) }).findings).toEqual([]);
  });

  it("直す所の数まで。同じ人・同じ種類は重ねない", () => {
    const score = { ...EMPTY_SCORE, report: { minute: null, tries: 0 }, reached: [{ person: "p-01" }] } as unknown as DrillScore;
    const room = findingRoom(score);
    expect(room).toBe(3);
    const body = reviewBody({ summary: "s", findings: eight }, { key, members: new Set(["p-01", "p-02"]), max: room });
    expect(body.findings.length).toBeLessThanOrEqual(room);
    const pairs = body.findings.map((f) => `${f.person}|${f.kind}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("採点の記録（計画で動けた人・計画が無く手が要った人）", () => {
  it("同じ人で、計画ありは「予備に替えた」、なしは「停電の機器の予備・電源」が要った", () => {
    const world: WorldState = { ...OUTAGE, flood: true };
    const run = (src: PseudonymInput) =>
      scorePlans({
        participants: ["p-01"],
        plans: new Map([["p-01", planOf(src)]]),
        world,
        people: { "p-01": state({ whereNow: "home", at: 5 }) },
        actions: [],
        endMinute: 4320,
        inOutage: () => true,
      });
    expect(run(seedInput("p-01")).rows).toEqual([{ person: "p-01", acted: ["spare"], needed: [] }]);
    expect(run(withoutPlan(seedInput("p-01"))).rows).toEqual([{ person: "p-01", acted: [], needed: ["power", "move"] }]);
  });

  it("帳面の機器: 予備が切れたら止まる（予備の時間がある計画）", () => {
    const f = personaFacts(buildPersona(seedInput("p-01"), { on: "2026-11-05" }), { person: "p-01", world: OUTAGE, state: null, now: 11 * 60 });
    expect(f.devices[0]).toMatchObject({ outAt: 120, spare: { at: 120, outAt: 600 }, down: true });
  });
});

// ---------- 偽の client ----------

function memoryUsage(): UsageStore {
  let n = 0;
  return { reserve: async () => (n += 1) > 0, finish: async () => {}, countDay: async () => n };
}

function ctxOf(client: ClaudeClient): AskJsonContext {
  return { env: { ANTHROPIC_API_KEY: "dummy" }, usage: memoryUsage(), office: { id: "office-demo", kind: "demo" }, claude: client, now: () => new Date(START) };
}

// ---------- ケアマネに言われた事（往復の続き） ----------

describe("ケアマネに言われた事（外へ掛けた電話・掛かってきた電話の往復）", () => {
  const sources = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p.person.id)]));
  const other = SEED_PEOPLE.find((p) => p.person.id === "p-03")!.person.name;
  const talkAction = (lines: Array<{ who: "cm" | "them"; text: string; minute: number; ask?: string }>): ActionRecord =>
    ({
      id: "a1",
      kind: "call_person",
      person: "p-01",
      target: "c-01-0",
      callee: "self",
      calleeLabel: "本人",
      at: 3,
      atMinute: 180,
      endMinute: 185,
      minutes: 5,
      step: 2,
      before: {},
      result: { status: "connected", because: null, text: "つながった", ai: false, ok: true, atMinute: 185, talk: lines.map((l) => ({ ai: false, ...l })) },
    }) as unknown as ActionRecord;

  it("外へ掛けた電話の往復の指示と自由の言葉を帳面に。自由の言葉はほかの人の名前を伏せてから", () => {
    const src = seedInput("p-01");
    const persona = { ...buildPersona(src, { on: "2026-11-05" }), mask: maskWith(src, sources) };
    const act = talkAction([
      { who: "cm", text: "具合が悪いなら 119 に電話してください", minute: 186, ask: "advise_119" },
      { who: "them", text: "わかりました", minute: 186 },
      { who: "cm", text: `${other}さんの家の前で娘さんを待ってください`, minute: 188 },
      { who: "cm", text: "今どこにいますか", minute: 190, ask: "where" },
    ]);
    const t = tickText(personaInput("p-01", { actions: [act] }), persona);
    expect(t).toContain("ケアマネに言われた事（覚えて従う。従えない時は理由を言う）");
    expect(t).toContain("「具合が悪いなら 119 に電話してください」");
    expect(t).toContain("家の前で娘さんを待ってください");
    expect(t).not.toContain(other);
    // 聞いただけの問い（所在）は覚えない
    expect(t).not.toContain("今どこにいますか");
  });

  it("伏せる口が無ければ自由の言葉は渡さない（決まった指示だけ）", () => {
    const persona = buildPersona(seedInput("p-01"), { on: "2026-11-05" });
    const act = talkAction([{ who: "cm", text: "家で待っていてください", minute: 186 }]);
    expect(tickText(personaInput("p-01", { actions: [act] }), persona)).not.toContain("ケアマネに言われた事");
  });

  it("掛かってきた電話の往復のケアマネの行は世界に積み（pushTold）、次の区切りの本人役に渡す", () => {
    const world = pushTold(EMPTY_WORLD, "p-01", [
      { who: "them", text: "停電です", minute: 200 },
      { who: "cm", text: "また後で電話します", minute: 202, ask: "will_call_back" },
    ]);
    expect(world.told?.["p-01"]).toEqual([{ minute: 202, text: "また後で電話します", ask: "will_call_back" }]);
    const t = tickText(personaInput("p-01", { world }), buildPersona(seedInput("p-01"), { on: "2026-11-05" }));
    expect(t).toContain("3 時間 22 分「また後で電話します」");
  });

  it("本人役の決まりに「言われた事は覚えて従い、従えない時は理由を言う」", () => {
    expect(PERSONA_SYSTEM).toMatch(/12\. 「ケアマネに言われた事」は覚えて従う/);
    expect(PATH_RULE).toContain("従えない時は理由を言う");
  });
});
