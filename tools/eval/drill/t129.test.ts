// T129 評価の台の自由対応の検査（docs/tasks/T129.md の 7）。本物の API は呼ばない（偽の答え・偽の client）。

import { describe, expect, it } from "vitest";
import type { FreeHook } from "../../../lib/drill/free-action.ts";
import { createFreeHook } from "../../../lib/drill/free-action.ts";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { checkRun, freeHits, INNER_NAME } from "./checks.ts";
import type { LooseAction, RunOutcome } from "./drive.ts";
import { fakeClaude } from "./fake.ts";
import { freeProbe, PROBE_CASES, PROBE_TEXTS } from "./free-probe.ts";
import { planRun } from "./plan.ts";
import type { AiRecord } from "./record.ts";
import { rngOf } from "./rng.ts";
import { checkContext } from "./run.ts";

const CASELOAD = SEED_PEOPLE.map((p) => p.person.id);

let seq = 0;
function ai(role: AiRecord["role"], returned: unknown, user: string): AiRecord {
  seq += 1;
  return {
    seq,
    ms: seq,
    type: "ai",
    role,
    model: "claude-opus-5-5",
    answeredModel: "claude-opus-5-5",
    effort: "high",
    maxTokens: 8000,
    sent: { system: ["指示"], user },
    returned: { stopReason: "end_turn", text: JSON.stringify(returned), blocks: ["text"] },
    took: 1,
    usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0.01,
    retries: 0,
    attempts: [{ took: 1, error: null }],
    error: null,
    parsed: true,
  };
}

function outcome(actions: LooseAction[]): RunOutcome {
  return {
    plan: planRun("test", 1, CASELOAD, ["earthquake"]),
    drillId: "d1",
    status: "finished",
    advances: 1,
    replay: { drill: { id: "d1", scenario: "earthquake", status: "finished", step: 0 }, hour: 72, minute: 4320, actions, world: {}, ticks: [], rows: [] },
    ops: [],
    errors: [],
    aiCalls: [],
    callsLeft: 100,
    names: {},
    worldAgent: null,
  };
}

const SENT = JSON.stringify({
  文: { text: "A さんは危険な状態のため119" },
  手: { 一覧: [{ id: "advise_119", 名前: "119勧奨", 中身: "電話で 119 への連絡を勧めた", 今: "不可（通話不可）", 相手: [] }] },
  事実: { text: "電話: 通話不可" },
});

describe("自由対応の検査（画面の内部の名前・変化なしに落ちた手・不可の手を「できる」）", () => {
  it("内部の名前の語: 手・相手・やり方の id と「_」の語。大文字の略語と仮名は当てない", () => {
    for (const t of ["advise_119", "free の電話", "一覧に call_contact", "self に"]) expect(INNER_NAME.test(t), t).toBe(true);
    for (const t of ["119勧奨", "A さんの家", "AED を確かめる", "自由対応 扱い 電話"]) expect(INNER_NAME.test(t), t).toBe(false);
  });

  it("画面に出た文に内部の名前・表の手から変化なしに落ちた手・生の返事の不可の手を「できる」", () => {
    const actions: LooseAction[] = [
      {
        id: "a1",
        kind: "free",
        person: "p-01",
        atMinute: 30,
        reason: "一覧に advise_119 が無いため free の電話とした",
        result: { ok: true, status: "unchanged", text: "変化なし" },
        judge: { output: { kind: "advise_119", can: true }, decided: { as: null, block: null, idle: true } },
      },
      {
        id: "a2",
        kind: "free",
        as: "advise_119",
        person: "p-01",
        atMinute: 40,
        reason: "119 の連絡に当たる",
        result: { ok: true, status: "connected", text: "つながった" },
        judge: { output: { kind: "advise_119", can: true }, decided: { as: "advise_119", block: null } },
      },
    ];
    const records = [
      ai("free", { kind: "advise_119", callee: "self", can: true, text: "119 を勧めた", reason: "advise_119 に当たる", alt: "" }, SENT),
      ai("free", { kind: "advise_119", callee: "self", can: false, whyNot: "通話不可", text: "", reason: "119 に当たる", alt: "近所の人に頼む" }, SENT),
    ];
    const hits = freeHits(records, outcome(actions));
    expect(hits.map((h) => h.rule).sort()).toEqual(["can_mismatch", "dropped", "inner_name:raw", "inner_name:shown"]);
    const { numbers } = checkRun(records, outcome(actions), checkContext());
    expect(numbers.free).toEqual({ acts: 2, innerShown: 1, innerRaw: 1, dropped: 1, canMismatch: 1 });
  });
});

describe("同じ文を状況違い（事業所／訪問先 × 通話可／不可 × 昼／夜）で", () => {
  /** 偽の client で読み替えの口を作る（種の 10 人を伏せる） */
  function fakeHook(): FreeHook {
    const sources = new Map(SEED_PEOPLE.map((p) => [p.person.id, { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks }] as const));
    const client = fakeClaude({ rng: rngOf("t129-probe") });
    const usage = { reserve: async () => true, finish: async () => {}, countDay: async () => 0 };
    return createFreeHook({
      load: async () => sources,
      ai: { env: { ANTHROPIC_API_KEY: "dummy" }, claude: client, usage, office: { id: "office-demo", kind: "demo" }, now: () => new Date("2026-11-05T01:00:00.000Z") },
      on: "2026-11-05",
    });
  }

  it("偽の client（状況に合わせて答える）では、通話不可で電話の手が打てる形・代案の無い不可・変化なしへの落ち・内部の名前・夜の訪問の不足が 0", async () => {
    const { rows, hits } = await freeProbe(fakeHook());
    expect(rows).toHaveLength(PROBE_CASES.length * PROBE_TEXTS.length);
    expect(hits).toEqual([]);
    // 通話不可の 119 は、どの状況でも 119勧奨のまま不可と代案
    // 通信の道が無い（T125）: 本人の家は家の電話の不通、家族・近所の人は携帯の電波不通で不可
    for (const r of rows.filter((x) => x.text === PROBE_TEXTS[0] && x.phone === "down")) {
      expect(r.label).toBe("119勧奨");
      expect(["通話不可", "電波不通"]).toContain(r.block);
    }
    for (const r of rows.filter((x) => x.text === PROBE_TEXTS[0] && x.phone === "down")) expect(r.alt).not.toBeNull();
    // 電話が通じれば 119勧奨は打てる
    for (const r of rows.filter((x) => x.text === PROBE_TEXTS[0] && x.phone === "ok")) expect(r.block).toBeNull();
  });

  it("状況を見ない口（いつもできると答え、理由に内部の名前）は数で見える", async () => {
    const careless: FreeHook = async (ask) => ({
      stored: ask.text,
      reading: { kind: "free", callee: "family", way: "phone", minutes: 5, can: true, text: "電話した", reason: "free の phone にした", effect: null },
    });
    const { hits } = await freeProbe(careless, [PROBE_TEXTS[2]]);
    // 内部の名前は口が置き換えるので画面には出ない。通話不可の電話は決まりの表が止める（代案は決まりの言葉）
    expect(hits.filter((h) => h.rule === "probe:inner_name")).toEqual([]);
    expect(hits.filter((h) => h.rule === "probe:phone_down_ran")).toEqual([]);
    expect(hits.filter((h) => h.rule === "probe:no_alt")).toEqual([]);
    // 表の手に当たる文を何もしないと答える口は、変化なしへの落ちとして数える
    const lazy: FreeHook = async (ask) => ({ stored: ask.text, reading: { kind: "none", callee: "", text: null, reason: null } });
    const lazyHits = await freeProbe(lazy, [PROBE_TEXTS[1]]);
    expect(lazyHits.hits.filter((h) => h.rule === "probe:dropped")).toHaveLength(PROBE_CASES.length);
  });
});
