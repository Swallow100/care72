// T159 の評価の台のテスト（画面に出た（氏名）で、元の生の返事のその所に名前が無かった物）。作った入力（架空の記録）だけ。
// Claude は呼ばない。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { GUARDS, guardFindings } from "../guards.ts";
import { itemOf } from "../scorecard-items.ts";
import { checkRun, notNameOrigin, overmaskHits } from "./checks.ts";
import type { LooseTick, LooseTurn, RunOutcome } from "./drive.ts";
import { metaOf } from "./findings.ts";
import { planRun } from "./plan.ts";
import type { AiRecord, LogRecord } from "./record.ts";
import { checkContext } from "./run.ts";

const CTX = checkContext();
const CASELOAD = SEED_PEOPLE.map((p) => p.person.id);

function outcome(ticks: LooseTick[]): RunOutcome {
  return {
    plan: planRun("test", 1, CASELOAD, ["earthquake"]),
    drillId: "d1",
    status: "finished",
    advances: ticks.length,
    replay: {
      drill: { id: "d1", scenario: "earthquake", status: "finished", step: ticks.length - 1 },
      hour: 72,
      minute: 4320,
      actions: [],
      world: { alertLevel: null, quake: null, tsunami: "none", flood: false, outage: null, phone: "ok", water: "none", roads: [], shelters: [], facilities: [], staff: 1, marks: {}, dispatched: [] },
      ticks,
      rows: [],
    },
    ops: [],
    errors: [],
    aiCalls: [],
    callsLeft: 100,
    names: {},
    worldAgent: null,
  };
}
const turn = (person: string, at: number, saying: string): LooseTurn => ({ person, at, color: "green", source: "family", ai: true, saying });
const tick = (step: number, hour: number, turns: LooseTurn[]): LooseTick => ({ step, hour, incidents: [], turns });
const personaRecord = (seq: number, speech: string): LogRecord =>
  ({ type: "ai", seq, ms: 0, role: "persona", sent: { system: [], user: "" }, returned: { text: JSON.stringify({ speech, condition: "", action: "" }), stopReason: "end_turn" }, attempts: [], retries: 0 }) as unknown as AiRecord;

/** 画面に出た言葉（伏せたあと）と元の生の返事の組 */
const PAIRS: ReadonlyArray<{ shown: string; raw: string; overmask: boolean }> = [
  // 評価の 6 回目の形（続柄＋の＋語尾まで含めたかな）
  { shown: "母の（氏名）。栄養剤があと少しで心配です。", raw: "母のことです。栄養剤があと少しで心配です。", overmask: true },
  { shown: "（氏名）が来てくれました。", raw: "民生さんが来てくれました。", overmask: true },
  { shown: "うちの（氏名）が心配です。", raw: "うちのワンちゃんが心配です。", overmask: true },
  { shown: "（氏名）、ここにいます。", raw: "そうです、ここにいます。", overmask: true },
  // 名前のある所（伏せ過ぎに数えない）
  { shown: "孫の（氏名）が来る。", raw: "孫のみつきが来る。", overmask: false },
  { shown: "隣の（氏名）が見に来た。", raw: "隣の佐藤さんが見に来た。", overmask: false },
  { shown: "長女 （氏名）が来る。", raw: "長女 内藤 早苗が来る。", overmask: false },
];

describe("画面の（氏名）で元の語に名前が無かった物（overmaskHits）", () => {
  it("元の語が普通の言い方の物だけを数え、名前の所は数えない", () => {
    const o = outcome([tick(0, 1, PAIRS.map((p, i) => turn(CASELOAD[i % CASELOAD.length], 1, p.shown)))]);
    const r = overmaskHits(
      PAIRS.map((p, i) => personaRecord(i + 1, p.raw)),
      o,
      CTX,
    );
    expect(r.checked).toBe(PAIRS.length);
    expect(r.hits.map((h) => h.seq).sort()).toEqual(PAIRS.flatMap((p, i) => (p.overmask ? [i + 1] : [])).sort());
    expect(r.hits[0]).toMatchObject({ check: "overmask", where: "shown", rule: "name_mark" });
  });

  it("元の生の返事が見つからない（氏名）は数えない（突き合わせた数にも入れない）", () => {
    const o = outcome([tick(0, 1, [turn("p-01", 1, "母の（氏名）。水がありません。")])]);
    expect(overmaskHits([personaRecord(1, "停電しています。")], o, CTX)).toEqual({ checked: 0, hits: [] });
  });

  it("台帳の名前・仮名・漢字やカナの語は名前として数える", () => {
    const p = SEED_PEOPLE[0];
    expect(notNameOrigin(p.person.name, CTX)).toBe(false);
    expect(notNameOrigin(`${p.person.name.split(" ")[0]}さん`, CTX)).toBe(false);
    expect(notNameOrigin("A さん", CTX)).toBe(false);
    expect(notNameOrigin("佐藤さん", CTX)).toBe(false);
    expect(notNameOrigin("みつき", CTX)).toBe(false);
    expect(notNameOrigin("ことです", CTX)).toBe(true);
    expect(notNameOrigin("民生さん", CTX)).toBe(true);
  });

  it("回の数（numbers.overmask）・指摘・点数の表の項目・守りに出る", () => {
    const o = outcome([tick(0, 1, [turn("p-01", 1, PAIRS[0].shown)])]);
    const { hits, numbers } = checkRun([personaRecord(1, PAIRS[0].raw)], o, CTX);
    expect(numbers.overmask).toEqual({ checked: 1, hits: 1 });
    const hit = hits.find((h) => h.check === "overmask")!;
    expect(metaOf(hit)).toMatchObject({ cause: "drill:overmask:shown", accept: { item: "drill.overmask", op: "<=", value: 0 } });
    expect(itemOf("drill.overmask")).toMatchObject({ bench: "drill", better: "lower", threshold: { op: "<=", value: 0 } });
    const guard = GUARDS.find((g) => g.item === "drill.overmask")!;
    expect(guard).toMatchObject({ bench: "drill", op: "<=", value: 0, task: "T159" });
    const repro = ["npm run eval:drill"];
    expect(guardFindings({ bench: "drill", run: "x", values: { "drill.overmask": 0 }, counts: {}, repro })).toEqual([]);
    expect(guardFindings({ bench: "drill", run: "x", values: { "drill.overmask": 1 / 4 }, counts: {}, repro })[0]).toMatchObject({ cause: "guard:drill-overmask-none", severity: "high" });
  });
});
