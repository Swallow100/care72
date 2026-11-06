// T158 の台の検査（通話の往復の繰り返し・いる所の揺れ・帳面と言葉の食い違い）を、手で組んだ回と偽の client で確かめる。
// 本物の API と評価の生の記録は読まない（言葉はここで作った物）。記録は一時のフォルダに書いて消す。

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readFindings } from "../findings.ts";
import { ITEMS, itemOf, valuesOf } from "../scorecard-items.ts";
import { readRunDir } from "../scorecard-shapes.ts";
import { metaOf } from "./findings.ts";
import { factHits, type FactPerson } from "./facts-check.ts";
import type { RunOutcome } from "./drive.ts";
import type { AiRecord, LogRecord } from "./record.ts";
import { runEval, type EvalConfig } from "./run.ts";
import { rawRepeats, talkHits } from "./talk-check.ts";

const tmp = mkdtempSync(join(tmpdir(), "t158-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const SLOW = 240_000;

type Line = { who: "cm" | "them"; text: string; ai: boolean; minute: number };
const cm = (text: string, minute: number): Line => ({ who: "cm", text, ai: false, minute });
const them = (text: string, minute: number, ai = true): Line => ({ who: "them", text, ai, minute });

/** 手で組んだ回（外へ掛けた電話 1 つと着信 1 つ） */
function outcomeOf(out: Line[], incoming: Line[]): Pick<RunOutcome, "replay" | "incoming"> {
  return {
    replay: {
      drill: { id: "d", scenario: "heavy_rain", status: "finished", step: 3 },
      hour: 10,
      minute: 600,
      actions: [{ id: "a1", kind: "call_person", person: "p-06", atMinute: 300, result: { status: "connected", atMinute: 300, speech: "はい、母と家にいます。", talk: out } }],
      world: {},
      ticks: [],
      rows: [],
    },
    incoming: [{ signal: "s1", person: "p-01", minute: 400, first: "避難所に着きました。", lines: incoming }],
  };
}

describe("通話の往復の検査（手で組んだ回）", () => {
  it("同じ通話の前の返事とほぼ同じ返事を数える（固定の言葉と最初の言葉は前の返事に入れない）", () => {
    const o = outcomeOf(
      [
        cm("けがはありませんか", 300),
        them("けがはありません。毛布がもう一枚あると助かります。", 302),
        cm("はい", 302),
        them("はい、けがはありません。毛布がもう一枚あると助かります。", 304),
        cm("待ってください", 304),
        them("はい、分かりました", 305, false),
        cm("薬はありますか", 305),
        them("薬は冷やして手元にあります。", 307),
      ],
      [],
    );
    const r = talkHits(o);
    expect(r.numbers).toMatchObject({ calls: 1, replies: 4, repeats: 1, placeDrift: 0 });
    expect(r.hits.filter((h) => h.rule === "repeat")).toHaveLength(1);
  });

  it("同じ通話の中のいる所の食い違いを数える（避難所 → 家・避難所へ向かう・避難所ではない、家 → 家に置いてきた）", () => {
    const o = outcomeOf(
      [cm("今どこですか", 300), them("母と私の二人、家にいます。", 302), cm("薬は", 302), them("栄養剤は家に置いてきました。", 304)],
      [
        cm("ご本人は無事ですか", 400),
        them("父は無事です。", 402),
        cm("避難するならどこに行きますか", 402),
        them("これから避難所へ移ります。", 404),
        cm("さっきは家と言っていましたが", 404),
        them("いいえ、避難所ではありません。", 406),
      ],
    );
    const r = talkHits(o);
    // 外へ掛けた電話: 最初の言葉の家 → 家に置いてきた（1）。着信: 最初の言葉の避難所 → 向かう・避難所ではない（2）
    expect(r.numbers.placeDrift).toBe(3);
    expect(r.hits.filter((h) => h.rule === "place_drift").map((h) => h.person)).toEqual(["p-06", "p-01", "p-01"]);
  });

  it("生の返事の繰り返し: 送った「それまでの話」の電話に出た人の行とほぼ同じ返事を数える", () => {
    const sent = (lines: string[]) =>
      JSON.stringify({ 電話: { text: ["時刻: 発災から 5 時間", "それまでの話:", ...lines, "ケアマネの今の言葉: 「はい」"].join("\n") } });
    const rec = (seq: number, user: string, speech: string): AiRecord =>
      ({ seq, ms: 0, type: "ai", role: "persona_talk", sent: { system: [], user }, returned: { stopReason: "end_turn", text: JSON.stringify({ speech }), blocks: [] } }) as unknown as AiRecord;
    const records: LogRecord[] = [
      rec(1, sent(["- ケアマネ: 「けがは」", "- 娘: 「けがはありません。水がほしいです。」"]), "けがはありません。水がほしいです。"),
      rec(2, sent(["- ケアマネ: 「けがは」", "- 娘: 「けがはありません。」"]), "薬は手元にあります。"),
      rec(3, sent([]), "はい、家にいます。"),
    ];
    const r = rawRepeats(records);
    expect(r.checked).toBe(3);
    expect(r.hits.map((h) => h.seq)).toEqual([1]);
  });

  it("指摘の原因と受け入れ（通話の繰り返し・いる所の揺れ・電池の数の流れ）", () => {
    expect(metaOf({ check: "talk", rule: "repeat", evidence: "" })).toMatchObject({ cause: "drill:talk:repeat", accept: { item: "drill.talkRepeat" } });
    expect(metaOf({ check: "talk", rule: "place_drift", evidence: "" })).toMatchObject({ cause: "drill:talk:place_drift", accept: { item: "drill.talkPlaceDrift", op: "<=", value: 0 } });
    expect(metaOf({ check: "facts", rule: "clock_drift", evidence: "" })).toMatchObject({ cause: "drill:facts:clock_drift", accept: { item: "drill.clockDrift" } });
    for (const id of ["drill.talkRepeat", "drill.talkRepeatRaw", "drill.talkPlaceDrift", "drill.factWords", "drill.clockDrift", "drill.capRatioMax"]) expect(itemOf(id)).toBeDefined();
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
});

describe("帳面と言葉の検査（手で組んだ回）", () => {
  const plan = { devices: [{ category: "ventilator", label: "呼吸器の電池", hours: 3 }], spares: [{ category: "ventilator", label: "予備の電池", hours: 3 }], power: false, destination: "shelter" as const, move: true, helper: true, stayHome: false, vendor: false, zone: true, immobile: true, floodM: null, carer: true };
  const people: Record<string, FactPerson> = { "p-02": { plan, together: ["夫"], kin: ["夫"], hazards: [], town: null } };
  const turn = (at: number, saying: string, over: Record<string, unknown> = {}) => ({ person: "p-02", color: "green", source: "family", whereNow: "home", saying, doing: null, ai: true, at, ...over });

  it("電池の残りの数の流れ: 予備に替えたと言わずに終わる時刻が食い違えば数える。予備と言えば数えない", () => {
    const run = (second: string): Pick<RunOutcome, "replay" | "plan" | "cast"> =>
      ({
        plan: { scenario: "heavy_rain" },
        cast: {},
        replay: {
          drill: { id: "d", scenario: "heavy_rain", status: "finished", step: 2 },
          hour: 10,
          minute: 600,
          actions: [],
          world: { outage: { area: { scope: "office" }, since: 0, restoredAt: null }, arrivals: [], marks: {} },
          rows: [],
          ticks: [
            { step: 1, hour: 1, incidents: [], turns: [turn(1, "停電で呼吸器が電池に切り替わりました。3時間しかもちません。")] },
            { step: 2, hour: 5, incidents: [], turns: [turn(5, second)] },
          ],
        },
      }) as unknown as Pick<RunOutcome, "replay" | "plan" | "cast">;
    const drift = (o: ReturnType<typeof run>) => factHits(o as RunOutcome, people).hits.filter((h) => h.rule === "clock_drift").length;
    expect(drift(run("呼吸器の電池があと1時間です。"))).toBe(1);
    expect(drift(run("予備の電池に替えて、あと1時間です。"))).toBe(0);
  });
});

describe("偽の client（わざと繰り返す往復）", () => {
  const cfg = (over: Partial<EvalConfig>): EvalConfig => ({
    runs: 1,
    seed: "t158",
    real: false,
    key: "fake-key-not-used",
    world: "session",
    scenarios: ["heavy_rain"],
    judge: 0,
    review: false,
    maxAdvances: 40,
    out: join(tmp, "drill"),
    md: null,
    noise: 0,
    maxUsd: null,
    terms: true,
    answerCalls: true,
    talkRounds: 4,
    say: () => {},
    ...over,
  });

  it(
    "わざと前の返事をそのまま返すと、生の返事の繰り返しに数え、画面の返事は門が落として繰り返しにならない。数は summary・findings.json・点数の表に出る",
    async () => {
      const r = await runEval(cfg({ talkEcho: 1, stamp: "20261106-158001-fake" }));
      const n = r.summary.runs[0].numbers;
      expect(n.talk).toBeDefined();
      expect(n.talk!.replies).toBeGreaterThan(0);
      expect(n.talk!.raw).toBeGreaterThan(0);
      expect(n.talk!.repeatRaw).toBeGreaterThan(0);
      expect(n.talk!.repeats).toBe(0);
      expect(r.summary.totals.talkRepeatRaw).toBe(n.talk!.repeatRaw);
      const f = readFindings(r.findingsPath)!;
      expect(f.findings.some((x) => x.cause === "drill:talk:repeat_raw")).toBe(true);
      const [data] = readRunDir(r.dir);
      const v = valuesOf(data);
      expect(v["drill.talkRepeatRaw"]).toBeGreaterThan(0);
      expect(v["drill.talkRepeat"]).toBe(0);
      expect(JSON.parse(readFileSync(join(r.dir, "summary.json"), "utf8")).args.talkEcho).toBe(1);
    },
    SLOW,
  );
});
