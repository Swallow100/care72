// T179 紙の全体の守り。線は本物の回の数で、数え直しと偽の回では外れにも通るにもしない
import { describe, expect, it } from "vitest";
import { GUARDS, guardFindings, unjudgedGuards } from "../guards.ts";
import { ITEMS, itemOf, valuesOf, type Item } from "../scorecard-items.ts";
import { marksOf } from "../scorecard.ts";
import type { RunResult } from "./run.ts";

type Score = NonNullable<RunResult["papers"][number]["score"]>;
const scored = (hit: number, filled: number) => ({ form: "matsuyama", input: "x", kind: "text", score: { hit, filled } as Score, files: {}, review: null }) as RunResult["papers"][number];
const values = (papers: RunResult["papers"], client: "real" | "replay" | "fake" = "real") =>
  valuesOf({ bench: "forms", run: "r", client, data: { run: "r", mode: client, forms: [], inputs: [], papers, calls: {}, leaks: {} } as never });
const rules = (total: number, client: "real" | "replay" | "fake" = "real") =>
  guardFindings({ bench: "forms", run: "r", values: { "forms.paper.total": total / 6509 }, counts: {}, repro: [], client }).map((f) => f.rule);

describe("T179 紙の全体", () => {
  it("正解の表のある全部の紙の当たりと字のある欄の合計", () => {
    const v = values([scored(4000, 4100), scored(2331, 2409), { ...scored(0, 0), score: null }]);
    expect(v["forms.paper.total"]).toBeCloseTo(6331 / 6509, 9);
    expect(itemOf("forms.paper.total")?.better).toBe("higher");
    expect(values([])["forms.paper.total"]).toBeUndefined();
  });

  it("線は本物の回の r8 の数で、緩めていない。r11 の 6,331 と r10 の 6,364 は外れ、r8 と r9 は通る", () => {
    expect(GUARDS.find((g) => g.id === "forms-paper-total")).toMatchObject({ op: ">=", value: 6372 / 6509, clients: ["real"], item: "forms.paper.total" });
    expect(rules(6331)).toContain("guard:forms-paper-total");
    expect(rules(6364)).toContain("guard:forms-paper-total");
    expect(rules(6371)).toContain("guard:forms-paper-total");
    expect(rules(6372)).not.toContain("guard:forms-paper-total");
    expect(rules(6392)).not.toContain("guard:forms-paper-total");
  });

  it("松山市の 54 を落とす形は、直した数の見込み（6,385）から落ちても外れる", () => {
    expect(rules(6385)).not.toContain("guard:forms-paper-total");
    expect(rules(6385 - 54)).toContain("guard:forms-paper-total");
  });

  it("数え直しと偽の回は外れにも通るにもしない（未確認）", () => {
    expect(rules(6331, "replay")).not.toContain("guard:forms-paper-total");
    expect(rules(6331, "fake")).not.toContain("guard:forms-paper-total");
    expect(unjudgedGuards("forms", "replay").map((g) => g.id)).toContain("forms-paper-total");
    expect(unjudgedGuards("forms", "real").map((g) => g.id)).not.toContain("forms-paper-total");
  });

  it("点数の表も本物の回の列にだけ（外）を付ける", () => {
    const item = ITEMS.find((x) => x.id === "forms.paper.total") as Item;
    expect(marksOf(item, undefined, { value: 6331 / 6509 }, GUARDS, "real").outside).toBe(true);
    expect(marksOf(item, undefined, { value: 6331 / 6509 }, GUARDS, "replay").outside).toBe(false);
    expect(marksOf(item, undefined, { value: 6372 / 6509 }, GUARDS, "real").outside).toBe(false);
  });
});
