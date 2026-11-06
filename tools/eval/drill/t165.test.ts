// T165 の台（審査役に渡す流れに足した物・人ごとの筋の数）を、手で組んだ回と偽の client で確かめる。
// 本物の API と評価の生の記録は読まない（言葉はここで作った物）。記録は一時のフォルダに書いて消す。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readFindings } from "../findings.ts";
import { itemOf, valuesOf } from "../scorecard-items.ts";
import { readRunDir } from "../scorecard-shapes.ts";
import { personArcHits } from "./checks.ts";
import { personArcNumbers, personKinds } from "./diversity.ts";
import type { RunOutcome } from "./drive.ts";
import { metaOf } from "./findings.ts";
import { JUDGE_SYSTEM, storyClock, storyText, talkSummary } from "./judge.ts";
import { runEval, type EvalConfig } from "./run.ts";

const tmp = mkdtempSync(join(tmpdir(), "t165-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const SLOW = 240_000;

const plan = (over: Record<string, unknown> = {}) => ({ index: 1, scenario: "heavy_rain", scale: null, participants: ["p-02", "p-06", "p-10"], night: false, ...over });
const inc = (person: string, kind: string, at: number, text: string, actor = "director") => ({ person, inject: kind, change: { kind: "note" }, text, actor, at, ai: true });

/** 手で組んだ回 */
function outcome(): RunOutcome {
  return {
    plan: plan(),
    replay: {
      drill: { id: "d", scenario: "heavy_rain", status: "finished", step: 3 },
      hour: 72,
      minute: 4320,
      ticks: [
        {
          step: 1,
          hour: 21,
          incidents: [inc("p-02", "landslide_warn", 21, "土砂災害 警戒"), { ...inc("p-02", "landslide_warn", 21, "山側の道 通行止め"), change: { kind: "road" } }, inc("p-06", "supply_left", 21, "栄養剤 持ち出し忘れ")],
          turns: [{ person: "p-06", color: "red", source: "family", saying: "栄養剤を家に置いてきました。", doing: "相談する", at: 21, ai: true }],
        },
      ],
      actions: [
        { id: "a1", kind: "dispatch", person: "p-10", atMinute: 2370, result: { status: "dispatched", arriveAt: 2700, because: null } },
        {
          id: "a2",
          kind: "call_person",
          person: "p-10",
          atMinute: 2900,
          result: {
            status: "connected",
            speech: "はい、家にいます。",
            talk: [
              { who: "cm", text: "けがはありませんか", ai: false },
              { who: "them", text: "けがはありません。妻と一緒です。", ai: true },
              { who: "cm", text: "薬はありますか", ai: false },
              { who: "them", text: "薬は手元にあります。", ai: true },
            ],
          },
        },
        { id: "a3", kind: "visit", person: "p-02", atMinute: 300, result: { status: "arrived", visit: { condition: "寝たまま、呼吸器をつけている", speech: "来てくれて助かりました。", ai: true } } },
        { id: "a4", kind: "visit", person: "p-06", atMinute: 100, result: { status: "turnedBack", because: "家の前の道 通行止" } },
      ],
      world: { arrivals: [{ person: "p-06", role: "medicine", arrive: 2165, arrived: true }, { person: "p-02", role: "vendor", arrive: 5000, arrived: false }] },
      rows: [],
    },
    incoming: [{ signal: "s1", person: "p-02", minute: 600, first: "家内の呼吸器の電池が心配です。", lines: [{ who: "cm", text: "今どこですか" }, { who: "them", text: "家にいます。", ai: true }] }],
  } as unknown as RunOutcome;
}

const alias = new Map([
  ["p-02", "D さん"],
  ["p-06", "F さん"],
  ["p-10", "H さん"],
]);

describe("審査役に渡す流れ（T165）", () => {
  it("着いた人・届いた物、手の訳と着く見込み、通話の往復と着信、訪問の様子、訓練の中の時刻を書く。同じ時刻・同じ人の出来事は 1 行", () => {
    const text = storyText(outcome(), alias);
    const lines = text.split("\n");
    expect(lines[0]).toContain("発災は 10時ごろ");
    // 出来事: D さんの 2 つの変化は 1 行、F さんは別の行
    expect(lines.filter((l) => l.includes("D さん:") && l.includes("出来事"))).toHaveLength(1);
    expect(text).toContain("土砂災害 警戒・山側の道 通行止め");
    expect(text).toMatch(/36:05（2日目 22時） 着いた 薬 → F さん/);
    // 着いていない到着は書かない
    expect(text).not.toContain("機器の業者");
    expect(text).toContain("dispatch → H さん: dispatched（着く見込み 45:00（3日目 7時））");
    expect(text).toContain("turnedBack（訳 家の前の道 通行止）");
    expect(text).toContain("往復（ケアマネ 2 回）: 「けがはありません。妻と一緒です。」 「薬は手元にあります。」");
    expect(text).toContain("訪問の様子: 寝たまま、呼吸器をつけている 「来てくれて助かりました。」");
    expect(text).toContain("着信 D さん 「家内の呼吸器の電池が心配です。」 往復（ケアマネ 1 回）: 「家にいます。」");
    // ケアマネの打った文は書かない（名前に戻した物なので）
    expect(text).not.toContain("けがはありませんか");
    // 時刻の順
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at("訪問の様子")).toBeLessThan(at("着いた 薬"));
  });

  it("夜間発災は深夜 2 時から、回の番号の無い流れは時刻を添えない。往復の行は切って数を添える", () => {
    expect(storyClock({ plan: plan({ night: true }) } as never)!(5)).toBe("1日目 7時");
    expect(storyClock({ plan: plan({ index: undefined }) } as never)).toBeNull();
    const many = Array.from({ length: 8 }, (_, i) => ({ who: "them", text: `返事 ${i}` }));
    expect(talkSummary(many)).toContain("ほか 2 行");
    expect(talkSummary([{ who: "cm", text: "はい" }])).toBe("");
  });

  it("物差しの文は変えていない（人ごとの筋の物差しの 1 行のまま）", () => {
    expect(JUDGE_SYSTEM).toContain("- consistency: 人ごとの筋の通り方。同じ人の言う事・様子・暮らしが回の中で食い違わないか");
    expect(itemOf("drill.judge.consistency")?.notes?.[0]).toMatch(/^r8〜（T165）: /);
  });
});

describe("人ごとの筋の数（T165）", () => {
  it("人ごとの出来事の種類、出来事の無い人、人どうしの種類の重なりとそっくり同じ組", () => {
    const o = outcome();
    const kinds = personKinds(o);
    expect([...kinds.get("p-02")!].sort()).toEqual(["landslide_warn"]);
    expect(kinds.get("p-10")!.size).toBe(0);
    const r = personArcHits(o);
    expect(r.numbers).toMatchObject({ people: 3, noKind: 1, sameArc: 0, kindJaccard: 0 });
    expect(r.numbers.kinds).toBeCloseTo(2 / 3);
    expect(r.hits.map((h) => h.rule)).toEqual(["no_kind"]);
    expect(metaOf(r.hits[0])).toMatchObject({ cause: "drill:persons:no_kind", accept: { item: "drill.personNoKind", op: "<=", value: 0 } });
    // 2 人が同じ種類だけなら same_arc
    const same = outcome();
    same.replay!.ticks[0].incidents.push(inc("p-10", "landslide_warn", 22, "土砂災害 警戒"));
    same.replay!.ticks[0].incidents.push(inc("p-06", "landslide_warn", 22, "土砂災害 警戒"));
    same.replay!.ticks[0].incidents = same.replay!.ticks[0].incidents.filter((e) => e.inject !== "supply_left");
    const s = personArcHits(same);
    expect(s.numbers.sameArc).toBe(3);
    expect(s.numbers.kindJaccard).toBe(1);
    expect(personArcNumbers([o, same])).toMatchObject({ kindsPerPersonMin: 0, kindPairs: 4 });
  });
});

describe("偽の client（人ごとの筋の数が summary・findings.json・点数の表に出る）", () => {
  const cfg = (over: Partial<EvalConfig>): EvalConfig => ({
    runs: 1,
    seed: "t165",
    real: false,
    key: "fake-key-not-used",
    world: "session",
    scenarios: ["heavy_rain"],
    judge: 1,
    review: false,
    maxAdvances: 40,
    out: join(tmp, "drill"),
    md: null,
    noise: 0,
    maxUsd: null,
    terms: true,
    answerCalls: true,
    talkRounds: 2,
    say: () => {},
    ...over,
  });

  it(
    "回の数に persons、まとめの多様さに人ごとの種類の数、点数の表に 3 つの項目。審査役の流れは伏せて送れる",
    async () => {
      const r = await runEval(cfg({ stamp: "20261106-165001-fake" }));
      const n = r.summary.runs[0].numbers;
      expect(n.persons).toBeDefined();
      expect(n.persons!.people).toBe(r.summary.runs[0].numbers.participants);
      expect(r.summary.diversity.persons.kindsPerPerson).toBeGreaterThan(0);
      expect(r.summary.diversity.persons.kindJaccard).not.toBeUndefined();
      const [data] = readRunDir(r.dir);
      const v = valuesOf(data);
      expect(v["drill.personKinds"]).toBeGreaterThan(0);
      expect(v["drill.personNoKind"]).toBeGreaterThanOrEqual(0);
      expect(typeof v["drill.personKindOverlap"]).toBe("number");
      // 審査役は伏せきれずに落ちていない（足した往復・訪問の言葉も伏せて送れる）
      expect(r.summary.judge[0]?.error ?? null).toBeNull();
      const f = readFindings(r.findingsPath)!;
      for (const x of f.findings.filter((x) => x.cause.startsWith("drill:persons:"))) expect(x.accept).toBeDefined();
    },
    SLOW,
  );
});
