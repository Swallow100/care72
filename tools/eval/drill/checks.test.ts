// 評価の台（docs/tasks/T108.md）の機械の検査と多様さの数え方のテスト。作った入力（架空の記録）で、拾うべき物を拾い、拾うべきでない物を拾わないか。
// Claude は呼ばない。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { bannedHits, checkRun, contradictionHits, leakSentHits, shapeHits, timeOddsOf } from "./checks.ts";
import { aiKinds, aiSayings, diversityOf, entropyOf, jaccard, trigrams } from "./diversity.ts";
import type { LooseAction, LooseIncident, LooseTick, LooseTurn, RunOutcome } from "./drive.ts";
import { planRun } from "./plan.ts";
import type { AiRecord, LogRecord } from "./record.ts";
import { checkContext } from "./run.ts";

const CTX = checkContext();
const CASELOAD = SEED_PEOPLE.map((p) => p.person.id);
const NAME = SEED_PEOPLE[0].person.name;
const TOWN = SEED_PEOPLE[0].ledger.basic.address!.town!;

let seq = 0;
function ai(role: AiRecord["role"], returned: unknown, user = "入力", extra: Partial<AiRecord> = {}): AiRecord {
  seq += 1;
  return {
    seq,
    ms: seq,
    type: "ai",
    role,
    model: "claude-haiku-5-5",
    answeredModel: "claude-haiku-5-5",
    effort: "medium",
    maxTokens: 8000,
    sent: { system: ["指示"], user },
    returned: { stopReason: "end_turn", text: typeof returned === "string" ? returned : JSON.stringify(returned), blocks: ["text"] },
    took: 1,
    usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0.00015,
    retries: 0,
    attempts: [{ took: 1, error: null }],
    error: null,
    parsed: true,
    ...extra,
  };
}

function outcome(ticks: LooseTick[], actions: LooseAction[] = [], world: Record<string, unknown> = {}, over: Partial<RunOutcome> = {}): RunOutcome {
  return {
    plan: planRun("test", 1, CASELOAD, ["heavy_rain"]),
    drillId: "d1",
    status: "finished",
    advances: ticks.length,
    replay: { drill: { id: "d1", scenario: "heavy_rain", status: "finished", step: ticks.length - 1 }, hour: 72, minute: 4320, actions, world, ticks, rows: [] },
    ops: [],
    errors: [],
    aiCalls: [],
    callsLeft: 100,
    names: {},
    worldAgent: null,
    ...over,
  };
}

const turn = (person: string, at: number, color: string, more: Partial<LooseTurn> = {}): LooseTurn => ({ person, at, color, source: "agent", ai: true, saying: null, ...more });
const tick = (step: number, hour: number, incidents: LooseIncident[] = [], turns: LooseTurn[] = []): LooseTick => ({ step, hour, incidents, turns });

describe("禁じた中身", () => {
  it("本人役の生の返事: 診断の語・薬の量・人の生き死に・仮名の残り・台帳の名前と電話を拾い、根拠の記録の番号を添える", () => {
    const records: LogRecord[] = [
      ai("persona", { speech: "重症かもしれません", condition: "横になっている", action: "待つ" }),
      ai("persona_call", { speech: "薬を2錠多めに飲ませました" }),
      ai("persona_talk", { speech: "もう死亡しているかもしれません", asks: [] }),
      ai("persona", { speech: "B さんにも伝えてください", condition: "", action: "" }),
      ai("persona_call", { speech: `${NAME}です。090-1234-5678 に電話ください` }),
      ai("persona", { speech: "停電しています。誰か来てもらえませんか", condition: "暗い部屋で待っている", action: "懐中電灯を探す" }),
    ];
    const hits = bannedHits(records, outcome([]), CTX).filter((h) => h.where === "raw");
    const rules = hits.map((h) => `${h.seq}:${h.rule.replace(/^personal:.*/, "personal")}`);
    expect(rules).toContain(`${records[0].seq}:diagnosis`);
    expect(rules).toContain(`${records[1].seq}:dose`);
    expect(rules).toContain(`${records[2].seq}:life`);
    expect(rules).toContain(`${records[3].seq}:alias`);
    expect(rules.filter((r) => r === `${records[4].seq}:personal`).length).toBeGreaterThanOrEqual(2);
    // ふつうの言葉は拾わない
    expect(hits.some((h) => h.seq === records[5].seq)).toBe(false);
    expect(hits.every((h) => h.evidence.length > 0)).toBe(true);
  });

  it("訪問の様子の欄は体の具合の言い切りも拾う。世界・監督の文は人の生き死にの語を別に数える", () => {
    const records: LogRecord[] = [
      ai("persona_visit", { condition: "意識がない様子", location: "home", asks: [], speech: "来てくれてありがとう" }),
      ai("director", { events: [{ target: "A さん", kind: "supply_left", text: "家の中で亡くなった人がいる", reason: "", basis: "" }] }),
      ai("world", { narration: "雨が強まる", events: [], farewells: [{ target: "A さん", text: "手が届かなかった", reason: "低血糖で意識が" }] }),
    ];
    const hits = bannedHits(records, outcome([]), CTX);
    expect(hits.find((h) => h.seq === records[0].seq)?.rule).toBe("condition");
    expect(hits.find((h) => h.seq === records[1].seq)).toMatchObject({ role: "director", rule: "life_or_diagnosis" });
    expect(hits.find((h) => h.seq === records[2].seq)).toMatchObject({ role: "world", rule: "medical_reason" });
  });

  it("画面に出た物: 刻みの安否の言う事と手の返事の言葉。町名は画面の言葉なので漏れに数えない", () => {
    const o = outcome(
      [tick(0, 0, [], [turn("p-01", 0, "green", { saying: `${TOWN}の家にいます` }), turn("p-02", 0, "red", { saying: "もう死亡しているかもしれません" })])],
      [{ id: "a1", person: "p-03", result: { atMinute: 30, speech: `${NAME}です`, talk: [{ who: "them", text: "重症です", ai: true }] } }],
    );
    const shown = bannedHits([], o, CTX).filter((h) => h.where === "shown");
    expect(shown.map((h) => `${h.person}:${h.rule.replace(/^personal:.*/, "personal")}`).sort()).toEqual(["p-02:life", "p-03:diagnosis", "p-03:personal"]);
  });
});

describe("仮名の漏れ（送った中身）", () => {
  it("送った全文に台帳の名前・町名・電話の形があれば拾う。仮名と地区の別名だけなら拾わない", () => {
    const records: LogRecord[] = [
      ai("persona", {}, `{"本人役":{"text":"${NAME}は 80 歳"}}`),
      ai("director", {}, `時刻: 発災から 3 時間。${TOWN}で停電`),
      ai("free", {}, "文: 090-0000-0001 に電話する"),
      ai("persona", {}, "A さん: 80 歳。甲地区で停電"),
    ];
    const hits = leakSentHits(records, CTX);
    expect(new Set(hits.map((h) => h.seq))).toEqual(new Set([records[0].seq, records[1].seq, records[2].seq]));
    expect(hits.find((h) => h.seq === records[1].seq)?.rule).toMatch(/町名/);
  });
});

describe("形の失敗", () => {
  it("失敗した呼び出し（再試行の跡つき）と、JSON として読めない返事", () => {
    const records: LogRecord[] = [
      ai("persona", null, "x", { returned: null, error: "APIConnectionTimeoutError", attempts: [{ took: 1, error: "APIConnectionTimeoutError" }, { took: 1, error: "APIConnectionTimeoutError" }], retries: 1 }),
      ai("director", "{", "x", { parsed: false }),
      ai("persona", { speech: "" }),
    ];
    const hits = shapeHits(records);
    expect(hits.map((h) => h.rule)).toEqual(["error:APIConnectionTimeoutError", "not_json"]);
    expect(hits[0].evidence).toBe("APIConnectionTimeoutError → APIConnectionTimeoutError");
  });
});

describe("時間ごとの起きやすさ", () => {
  it("監督の差し込み（AI）の種類が、その時刻の帯の目安に無ければ帯の外。表の物・目安に無い種類は数えない", () => {
    const o = outcome([
      tick(0, 1, [
        { actor: "director", ai: true, inject: "line_down", at: 1, text: "家の電話 通話不可" },
        { actor: "director", ai: false, inject: "line_down", at: 1, text: "表の物" },
      ]),
      tick(1, 5, [{ actor: "director", ai: true, inject: "line_down", at: 5, text: "家の電話 通話不可" }]),
      tick(2, 30, [{ actor: "director", ai: true, inject: "supply_left", at: 30, text: "目安に無い種類" }]),
    ]);
    const r = timeOddsOf(o);
    expect(r.checked).toBe(2);
    expect(r.offBand).toBe(1);
    expect(r.hits[0]).toMatchObject({ rule: "line_down", minute: 60 });
  });
});

describe("矛盾", () => {
  it("けがの赤のあと、手も到着も無いまま緑になれば拾う。間に手の返事か到着があれば拾わない", () => {
    const base = [tick(0, 1, [], [turn("p-01", 1, "red", { injured: true })]), tick(1, 3, [], [turn("p-01", 3, "green")])];
    expect(contradictionHits(outcome(base)).map((h) => h.rule)).toEqual(["hurt_to_safe"]);
    expect(contradictionHits(outcome(base, [{ id: "a1", person: "p-01", result: { atMinute: 120 } }]))).toEqual([]);
    expect(contradictionHits(outcome(base, [], { arrivals: [{ person: "p-01", arrive: 150 }] }))).toEqual([]);
    // ほかの人への手は数えない
    expect(contradictionHits(outcome(base, [{ id: "a1", person: "p-02", result: { atMinute: 120 } }])).length).toBe(1);
  });

  it("結末のあとの連絡、緑なのにけがの言葉、赤なのに無事の言葉", () => {
    const o = outcome(
      [
        tick(0, 2, [], [turn("p-01", 2, "green", { saying: "足を打って動けない" }), turn("p-02", 2, "red", { saying: "こちらは大丈夫です" })]),
        tick(1, 10, [], [turn("p-03", 10, "unknown")]),
      ],
      [],
      { ended: { "p-03": { at: 8 } } },
    );
    expect(contradictionHits(o).map((h) => `${h.person}:${h.rule}`).sort()).toEqual(["p-01:green_but_hurt", "p-02:red_but_fine", "p-03:after_end"]);
  });
});

describe("1 回の数", () => {
  it("1 訓練の数えは画面の AI 残から、費用は呼び出しの記録の和（審査役は外す）", () => {
    const records: LogRecord[] = [ai("persona", { speech: "" }), ai("judge", {}, "x", { costUsd: 1 })];
    const o = outcome([tick(0, 0, [{ actor: "world", change: { kind: "ai_stop", stopped: ["persona"] }, at: 0, text: "停止" }])], [], {}, {
      callsLeft: 30,
      aiCalls: [{ purpose: "persona", model: "claude-haiku-5-5", status: "failed", error: "bad_output", input_tokens: null, output_tokens: null }],
      ops: [{ op: "advance", status: 200, ok: true, took: 10, error: null }, { op: "act", status: 409, ok: false, took: 3, error: null }],
    });
    const { numbers, hits } = checkRun(records, o, CTX);
    expect(numbers.budget.drillCounted).toBe(120);
    expect(numbers.budget.capRatio).toBeCloseTo(0.8);
    expect(numbers.budget.dayRatio).toBeCloseTo(1 / 200);
    expect(numbers.cost.usd).toBeCloseTo(0.00015);
    expect(numbers.aiCalls.byError).toEqual({ bad_output: 1 });
    expect(numbers.stops).toMatchObject({ aiStop: 1, opFailed: 1 });
    expect(numbers.timing.advanceP50).toBe(10);
    expect(hits.some((h) => h.check === "stop")).toBe(true);
  });
});

describe("多様さの数え方", () => {
  it("3-gram・Jaccard・正規化エントロピー", () => {
    expect(trigrams("停電、して")).toEqual(["停電し", "電して"]);
    expect(trigrams("はい")).toEqual(["はい"]);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBeNull();
    expect(entropyOf([5, 5])).toBeCloseTo(1);
    expect(entropyOf([10])).toBe(0);
    expect(entropyOf([9, 1])).toBeLessThan(0.5);
  });

  const run = (index: number, kinds: string[], sayings: Array<[string, string]>, scenario = "heavy_rain"): RunOutcome => {
    const o = outcome(
      [
        tick(
          0,
          1,
          kinds.map((k, i) => ({ actor: "director", ai: true, inject: k, at: i, text: k })),
          sayings.map(([p, s], i) => turn(p, i, "green", { saying: s })),
        ),
      ],
    );
    return { ...o, plan: { ...o.plan, index, scenario: scenario as RunOutcome["plan"]["scenario"], participants: ["p-01", "p-02"] } };
  };

  it("同じ回を 2 つ並べると重なり 1・同じ文の割合 50%、違えば下がる。表の出来事（AI でない物）と止まった印は数えない", () => {
    const a = run(1, ["line_down", "supply_left"], [["p-01", "電気がつかないんです"], ["p-02", "水が出なくて困っています"]]);
    const same = diversityOf([a, run(2, ["line_down", "supply_left"], [["p-01", "電気がつかないんです"], ["p-02", "水が出なくて困っています"]])]);
    expect(same.sequence.kindJaccard).toBe(1);
    expect(same.words.crossRunJaccard).toBe(1);
    expect(same.words.duplicateRate).toBeCloseTo(0.5);
    expect(same.persons.samePersonAcrossRuns).toBe(0);
    const other = diversityOf([a, run(2, ["outage_eta", "nurse_away"], [["p-01", "揺れがこわくて眠れません"], ["p-02", "道が通れないそうです"]])]);
    expect(other.sequence.kindJaccard).toBe(0);
    expect(other.words.crossRunJaccard!).toBeLessThan(0.2);
    expect(other.kinds.distinct).toBe(4);
    expect(other.persons.samePersonAcrossRuns!).toBeGreaterThan(0.8);
    expect(other.persons.differentPersonsSameRun!).toBeGreaterThan(0.8);

    const withTable: RunOutcome = {
      ...a,
      replay: {
        ...a.replay!,
        ticks: [
          ...a.replay!.ticks,
          tick(1, 2, [
            { actor: "world", ai: false, change: { kind: "alert" }, at: 2, text: "表" },
            { actor: "world", ai: true, change: { kind: "world_note" }, at: 2, text: "代替" },
          ]),
        ],
      },
    };
    expect(aiKinds(withTable)).toEqual(["line_down", "supply_left"]);
  });

  it("本人役の言葉は AI の物だけ（表の言う事・ケアマネの行は数えない）", () => {
    const o = outcome(
      [tick(0, 1, [], [turn("p-01", 1, "green", { saying: "表の言葉", ai: false }), turn("p-02", 1, "green", { saying: "AI の言葉" })])],
      [{ id: "a1", person: "p-03", result: { speech: "通話の言葉", speechAi: true, talk: [{ who: "cm", text: "けがは", ai: false }, { who: "them", text: "往復の言葉", ai: true }] } }],
    );
    expect(aiSayings(o).map((s) => s.text)).toEqual(["AI の言葉", "通話の言葉", "往復の言葉"]);
  });
});

// ---------- T118: 台が同じ穴を見つけられること ----------

describe("T118 の穴の形を台が拾う", () => {
  it("送った中身の生年月日（台帳と同じ日の和暦・略記・漢数字・西暦）を、層の findLeaks を借りずに拾う", () => {
    for (const form of ["昭和17年4月18日", "昭和 17 年 4 月 18 日", "S17.4.18", "昭和十七年四月十八日", "1942年4月18日", "昭和十七年"]) {
      const rec = ai("free", { as: "note" }, `本人（${form}生）の家に行く`);
      const hits = leakSentHits([rec], CTX);
      expect(hits.some((h) => h.rule === "personal:生年月日（台の表）"), form).toBe(true);
    }
    // 伏せた物（（生年月日））と台帳に無い日は拾わない
    expect(leakSentHits([ai("free", { as: "note" }, "本人（（生年月日）生）の家に行く。令和8年11月5日")], CTX)).toEqual([]);
  });

  it("本人役の決まりの形（薬の量の単位・流量、病名、助言、人の生き死にの言い方）を生の返事で拾う", () => {
    const records: LogRecord[] = [
      ai("persona", { speech: "インスリンは10単位打ちました", condition: "", action: "" }),
      ai("persona_call", { speech: "酸素は2L/分にしています" }),
      ai("persona_talk", { speech: "糖尿病があるので心配です", asks: [] }),
      ai("persona_visit", { speech: "薬を飲んだほうがいいですよ", condition: "", location: "home", asks: [] }),
      ai("persona_call", { speech: "息を引き取ったかもしれない" }),
    ];
    const hits = bannedHits(records, outcome([]), CTX).filter((h) => h.where === "raw");
    const rules = hits.map((h) => `${h.seq}:${h.rule}`);
    expect(rules).toContain(`${records[0].seq}:dose`);
    expect(rules).toContain(`${records[1].seq}:dose`);
    expect(rules).toContain(`${records[2].seq}:disease`);
    expect(rules).toContain(`${records[3].seq}:advice`);
    expect(rules).toContain(`${records[4].seq}:life`);
  });

  it("1 訓練の数え（画面の AI 残）に入らない呼び出し: ai_calls（講評・声のほか）との差を数え、印を出す", () => {
    const row = (purpose: string) => ({ purpose, model: "claude-haiku-5-5", status: "ok", error: null, input_tokens: 1, output_tokens: 1 });
    // T108 の偽の回の形: ai_calls 160（うち講評 0）に対し数え 144
    const o = outcome([], [], {}, { callsLeft: 150 - 144, aiCalls: [...Array.from({ length: 150 }, () => row("persona")), ...Array.from({ length: 10 }, () => row("director")), row("scoring")] });
    const { numbers, hits } = checkRun([], o, CTX);
    expect(numbers.budget.uncounted).toBe(16);
    expect(hits).toContainEqual(expect.objectContaining({ check: "budget", rule: "uncounted" }));
    // 数えがそろえば 0、10 分版（数えなし）は見ない
    expect(checkRun([], { ...o, callsLeft: 150 - 160 }, CTX).numbers.budget.uncounted).toBe(0);
    expect(checkRun([], { ...o, callsLeft: null }, CTX).numbers.budget.uncounted).toBe(0);
  });
});

// ---------- T121: 台の誤検知と手の決まりの検査 ----------

import { hurtIn, stopHits, termHits } from "./checks.ts";

describe("台の誤検知（T121）", () => {
  it("けがを打ち消す言い方と、物が倒れた言い方は「緑なのにけが」にしない（作った文）", () => {
    for (const s of ["家にいます。大きな怪我はありません。", "大丈夫よ。けがもないの。", "停電だけど、怪我はないし家にいるよ。", "家の前の道に木が倒れて、通れないの。", "棚が倒れたけど、無事です。", "痛くはないです。"]) {
      expect(hurtIn(s), s).toBe(false);
    }
    for (const s of ["転んで足が痛いです。", "けがをしました。", "動けないんです。", "母が倒れて動けません。"]) expect(hurtIn(s), s).toBe(true);
    const ticks: LooseTick[] = [{ step: 1, hour: 8, incidents: [], turns: [turn("p-07", 8, "green", { saying: "家におります。大きな怪我はありません。" })] }];
    expect(contradictionHits(outcome(ticks))).toEqual([]);
  });

  it("役の呼び名に付いた敬称（酸素屋さん・ケアマネさん）は敬称つきの名前にしない。作った名前は今までどおり拾う", () => {
    const ok = ai("persona", { speech: "ケアマネさん、酸素屋さんが来る前にボンベが空になりそうです。" });
    expect(bannedHits([ok], outcome([]), CTX).filter((h) => h.rule === "personal:敬称つきの名前")).toEqual([]);
    const bad = ai("persona", { speech: "隣の佐々木さんが来てくれました。" });
    expect(bannedHits([bad], outcome([]), CTX).some((h) => h.rule.startsWith("personal:"))).toBe(true);
  });
});

describe("手の決まりの検査（T121）", () => {
  const act = (over: Partial<LooseAction>): LooseAction => ({
    id: "a1",
    kind: "call_person",
    person: "p-01",
    callee: "self",
    atMinute: 120,
    minutes: 5,
    before: { phone: "ok", roadClosed: false, staff: 2, marks: {} },
    result: { status: "connected", atMinute: 125 },
    ...over,
  });
  it("電話が通話不可・家の電話の不通・通行止の人に打てた手を拾う（決まりを送らない回の比べにも）", () => {
    const o = outcome([], [
      act({ before: { phone: "down", roadClosed: false, staff: 2, marks: {} } }),
      act({ id: "a2", before: { phone: "ok", roadClosed: false, staff: 2, marks: { lineDown: 3 } } }),
      act({ id: "a3", kind: "visit", callee: null, minutes: 40, before: { phone: "ok", roadClosed: true, staff: 2, marks: {} } }),
      act({ id: "a4" }),
    ]);
    expect(termHits(o).map((h) => h.rule)).toEqual(["ran:通話不可", "ran:通話不可", "ran:通行止"]);
  });
  it("決まりを送った回の夜の訪問の所要が夜の足し分より短ければ拾う", () => {
    const night = { ...planRun("test", 1, CASELOAD, ["heavy_rain"]), night: true };
    const o = (minutes: number) =>
      outcome([], [act({ kind: "visit", callee: null, atMinute: 60, minutes })], {}, { plan: night, terms: true });
    expect(termHits(o(40)).map((h) => h.rule)).toEqual(["dark_minutes"]);
    expect(termHits(o(60))).toEqual([]);
  });
  it("決まりどおりの断り（409 blocked）は失敗した要求に数えない", () => {
    const o = outcome([], [], {}, { ops: [{ op: "act", status: 409, ok: false, took: 1, error: "blocked" }, { op: "advance", status: 500, ok: false, took: 1, error: "x" }] });
    expect(stopHits(o).map((h) => `${h.check}:${h.rule}`)).toEqual(["terms:refused:act", "op_failed:advance:500"]);
  });
});
