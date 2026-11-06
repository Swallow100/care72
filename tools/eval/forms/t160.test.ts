// T160 書類の台の数（日付の要修正・置けない日付・当てたのに紙に出ない選択肢・連絡先の置けず）が、指摘（findings.json）と点数の表の項目と
// 守り（tools/eval/guards.ts）に出るか。結果は手で組む（本物の回の記録は使わない）
import { describe, expect, it } from "vitest";
import { GUARDS, guardFindings } from "../guards.ts";
import { itemOf, valuesOf } from "../scorecard-items.ts";
import { formsFindings } from "./findings.ts";
import type { RunResult } from "./run.ts";

type R = Pick<RunResult, "run" | "mode" | "fakeStyle" | "forms" | "inputs" | "papers" | "calls" | "leaks">;
type Look = NonNullable<RunResult["papers"][number]["look"]>;

const baseLook: Look = { texts: 10, marks: 0, overlap: 0, outside: 0, neighbor: 0, shifted: 0, unplaced: 6, inkPages: 1, blanks: 0, blanksChoice: 0, masks: 0, unplacedOption: 0, unplacedRoom: 0, unplacedBox: 0, annexGap: 0 };

function result(look: Look, dateKinds: number): R {
  return {
    run: "20261106-000000-fake",
    mode: "fake",
    fakeStyle: "noisy",
    forms: [{ id: "cat-x", title: "架空の様式", gold: false, status: "ok", pages: 1, read: null, overlay: true }],
    inputs: [],
    papers: [
      { form: "cat-x", input: "text-p-01", kind: "text", score: null, look, files: {}, review: { rule: { fix: dateKinds, check: 0, note: 0, kinds: dateKinds > 0 ? { date: dateKinds } : {} }, ai: null } },
    ],
    calls: {
      aiCalls: { rows: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byPurpose: {} },
      calls: 0,
      ok: 0,
      failed: 0,
      retried: 0,
      attempts: 0,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      byModel: {},
      truncated: 0,
      formReadMaxOutput: 0,
    },
    leaks: { calls: 0, textHits: 0, strongHits: 0, birthHits: 0, weakHits: 0, images: 0, imagesRedacted: 0, imagesNotRedacted: 0 },
  };
}

describe("T160 書類の台の数", () => {
  const r = result({ ...baseLook, unplacedDate: 2, unplacedPicked: 1, unplacedContact: 3 }, 4);

  it("指摘に日付・選ぶ欄・連絡先の原因が出る（様式ごと）", () => {
    const fs = formsFindings(r);
    const by = (cause: string) => fs.find((f) => f.cause === cause);
    expect(by("forms:date.fix")).toMatchObject({ count: 4, where: { file: "様式 cat-x" } });
    expect(by("forms:date.unplaced")).toMatchObject({ count: 2 });
    expect(by("forms:option.unplaced")).toMatchObject({ count: 1 });
    expect(by("forms:contact.unplaced")).toMatchObject({ count: 3 });
  });

  it("点数の表の項目。前の回の結果（数の無い物）は空で、0 と見せない", () => {
    const v = valuesOf({ bench: "forms", run: r.run, client: "fake", data: r });
    expect(v["forms.dateFix"]).toBe(4);
    expect(v["forms.unplacedDate"]).toBe(2);
    expect(v["forms.unplacedPicked"]).toBe(1);
    expect(v["forms.unplacedContact"]).toBe(3);
    const old = valuesOf({ bench: "forms", run: "old", client: "fake", data: result(baseLook, 0) });
    expect(old["forms.unplacedDate"]).toBeUndefined();
    expect(old["forms.unplacedContact"]).toBeUndefined();
    for (const id of ["forms.dateFix", "forms.unplacedDate", "forms.unplacedPicked", "forms.unplacedContact"]) expect(itemOf(id)?.better).toBe("lower");
  });

  it("守り: 日付の要修正と連絡先の置けずが戻ったら外れる", () => {
    const mine = GUARDS.filter((g) => g.task === "T160");
    expect(mine.map((g) => g.item).sort()).toEqual(["forms.dateFix", "forms.unplacedContact", "forms.unplacedDate", "forms.unplacedPicked"]);
    const repro = ["npm run eval:forms"];
    const values = valuesOf({ bench: "forms", run: r.run, client: "fake", data: r });
    const out = guardFindings({ bench: "forms", run: r.run, values, counts: {}, repro, guards: mine });
    expect(out.map((f) => f.cause).sort()).toEqual(mine.filter((g) => values[g.item] > g.value).map((g) => `guard:${g.id}`).sort());
    const clean = valuesOf({ bench: "forms", run: r.run, client: "fake", data: result({ ...baseLook, unplacedDate: 0, unplacedPicked: 0, unplacedContact: 0 }, 0) });
    expect(guardFindings({ bench: "forms", run: r.run, values: clean, counts: {}, repro, guards: mine })).toEqual([]);
  });
});
