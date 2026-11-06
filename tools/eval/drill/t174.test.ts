// T174: 評価の 9 回目の「直す所」の台の口。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { worldNameHits } from "./checks.ts";
import type { AiRecord } from "./record.ts";
import type { RunOutcome } from "./drive.ts";

const room = (events: ReadonlyArray<Record<string, string>>, seq = 1): AiRecord =>
  ({ type: "ai", seq, role: "world_room", returned: { stopReason: "end_turn", text: JSON.stringify([{ narration: "", events, farewells: [] }]), blocks: [] } }) as unknown as AiRecord;
const outcome = (labels: string[] = []): RunOutcome =>
  ({ replay: { ticks: [{ hour: 1, incidents: labels.map((label) => ({ change: { kind: "shelter", label } })) }] } }) as unknown as RunOutcome;
const ev = (kind: string, name: string, over: Record<string, string> = {}) => ({ kind, name, town: "", target: "", value: "", ...over });

describe("世界の返事で捨てた名前", () => {
  it("地理に無い道・施設・避難所を数える", () => {
    const r = worldNameHits([room([ev("road", "架空の県道"), ev("facility", "架空の施設"), ev("shelter", "架空の避難所")])], outcome());
    expect(r.numbers).toEqual({ total: 3, dropped: 3, byKind: { road: 1, facility: 1, shelter: 1 } });
    expect(r.hits.every((h) => h.check === "world_place" && h.rule.startsWith("dropped_name:"))).toBe(true);
  });

  it("道は地区か本人を書いていれば名前が無くても通る（捨てない）", () => {
    const r = worldNameHits([room([ev("road", "架空の県道", { town: "甲地区" }), ev("road", "架空の市道", { target: "A さん" })])], outcome());
    expect(r.numbers).toEqual({ total: 2, dropped: 0, byKind: {} });
  });

  it("開始の時に読んだ実の避難所は、出来事に出た名前を地理に足して見る", () => {
    expect(worldNameHits([room([ev("shelter", "実の小学校")])], outcome(["実の小学校"])).numbers.dropped).toBe(0);
  });

  it("名前の無い出来事と、ほかの役の返事は見ない", () => {
    const other = { type: "ai", seq: 2, role: "director", returned: { stopReason: "end_turn", text: JSON.stringify({ events: [ev("road", "架空の県道")] }), blocks: [] } } as unknown as AiRecord;
    expect(worldNameHits([room([ev("road", "")]), other], outcome()).numbers).toEqual({ total: 0, dropped: 0, byKind: {} });
  });

  it("1 回呼びの返事（world）も見る", () => {
    const one = { type: "ai", seq: 3, role: "world", returned: { stopReason: "end_turn", text: JSON.stringify({ narration: "", events: [ev("facility", "架空の施設")], farewells: [] }), blocks: [] } } as unknown as AiRecord;
    expect(worldNameHits([one], outcome()).numbers.dropped).toBe(1);
  });
});
