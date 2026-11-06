// T168 印を付けた □ の中身が紙に無い欄の数が、見た目の数・指摘・点数の表・守りに出るか。架空の頁と種の人で（本物の回の記録は使わない）
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { buildMappedSheet } from "../../../lib/forms/mapped-sheet.ts";
import type { FormMapping, MappingField } from "../../../lib/forms/mapping.ts";
import { buildOverlaySheet } from "../../../lib/forms/overlay-sheet.ts";
import type { PageImage } from "../../../lib/forms/page-images.ts";
import { seedRows } from "../../../lib/forms/print-harness.ts";
import { GUARDS, guardFindings } from "../guards.ts";
import { itemOf, valuesOf } from "../scorecard-items.ts";
import { formsFindings } from "./findings.ts";
import { lookOfPaper } from "./look.ts";
import type { RunResult } from "./run.ts";

const TODAY = "2026-11-07";
const image: PageImage = { page: 1, width: 2100, height: 2970, bytes: 1 };
const rowsOf = (id: string) => seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
const field = (over: Partial<MappingField>): MappingField => ({ id: "f1", page: 1, section: "", label: "欄", position: "", shape: "text", options: [], item: null, removed: false, ai: null, ...over });
const mark = field({ id: "f1", label: "アレルギー", shape: "check", item: "medical.allergies", box: { x: 0.12, y: 0.46, w: 0.013, h: 0.013 } });
const bracket = field({ id: "f2", label: "アレルギー（　）", item: "medical.allergies", box: { x: 0.25, y: 0.458, w: 0.6, h: 0.016 } });

function lookOf(personId: string, fields: MappingField[]) {
  const mapping: FormMapping = { title: "架空の様式", issuer: "", pages: 1, fields };
  const rows = rowsOf(personId);
  const overlay = buildOverlaySheet(buildMappedSheet(rows, mapping, { today: TODAY, officeName: "デモ事業所" }), [image]);
  return lookOfPaper({ rows, mapping, images: [image], overlay, today: TODAY }).score;
}

type R = Pick<RunResult, "run" | "mode" | "fakeStyle" | "forms" | "inputs" | "papers" | "calls" | "leaks">;
type Look = NonNullable<RunResult["papers"][number]["look"]>;
const baseLook: Look = { texts: 1, marks: 1, overlap: 0, outside: 0, neighbor: 0, shifted: 0, unplaced: 0, inkPages: 1, blanks: 0, blanksChoice: 0, masks: 0, unplacedOption: 0, unplacedRoom: 0, unplacedBox: 0, annexGap: 0 };
const result = (look: Look): R => ({
  run: "20261107-000000-fake",
  mode: "fake",
  fakeStyle: "noisy",
  forms: [{ id: "cat-x", title: "架空の様式", gold: false, status: "ok", pages: 1, read: null, overlay: true }],
  inputs: [],
  papers: [{ form: "cat-x", input: "text-p-03", kind: "text", score: null, look, files: {}, review: null }],
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
});

describe("T168 印を付けた □ の中身", () => {
  it("□ に印があり中身の字がどこにも無ければ 1。字の欄があれば 0。値の無い人は 0", () => {
    expect(lookOf("p-03", [mark]).markNoContent).toBe(1);
    expect(lookOf("p-03", [mark, bracket]).markNoContent).toBe(0);
    expect(lookOf("p-01", [mark]).markNoContent).toBe(0);
  });

  it("指摘・点数の表・守りに出る。前の回の結果に無ければ空", () => {
    const r = result({ ...baseLook, markNoContent: 2 });
    expect(formsFindings(r).find((f) => f.cause === "forms:mark.no_content")?.count).toBe(2);
    const v = valuesOf({ bench: "forms", run: r.run, client: "fake", data: r });
    expect(v["forms.markNoContent"]).toBe(2);
    expect(itemOf("forms.markNoContent")?.better).toBe("lower");
    expect(valuesOf({ bench: "forms", run: r.run, client: "fake", data: result(baseLook) })["forms.markNoContent"]).toBeUndefined();
    const mine = GUARDS.filter((g) => g.task === "T168");
    expect(mine.map((g) => g.id)).toEqual(["forms-mark-content"]);
    expect(guardFindings({ bench: "forms", run: r.run, values: v, counts: {}, repro: ["npm run eval:forms"], guards: mine }).map((f) => f.cause)).toEqual(["guard:forms-mark-content"]);
    const clean = valuesOf({ bench: "forms", run: r.run, client: "fake", data: result({ ...baseLook, markNoContent: 0 }) });
    expect(guardFindings({ bench: "forms", run: r.run, values: clean, counts: {}, repro: ["npm run eval:forms"], guards: mine })).toEqual([]);
  });
});
