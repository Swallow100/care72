// T181 欄から値が消えた数（読みの後の決まりで項目を外した欄に、外す前は値が入っていた数）が、見た目の数・点数の表・守りに出るか。架空の欄と種の人で
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { buildMappedSheet } from "../../../lib/forms/mapped-sheet.ts";
import type { FormMapping, MappingField } from "../../../lib/forms/mapping.ts";
import { buildOverlaySheet } from "../../../lib/forms/overlay-sheet.ts";
import type { PageImage } from "../../../lib/forms/page-images.ts";
import { seedRows } from "../../../lib/forms/print-harness.ts";
import { settleFreedItem } from "../../../lib/forms/read-settle.ts";
import { GUARDS, guardFindings, unjudgedGuards } from "../guards.ts";
import { itemOf, valuesOf } from "../scorecard-items.ts";
import { lookOfPaper } from "./look.ts";
import type { RunResult } from "./run.ts";

const TODAY = "2026-11-07";
const image: PageImage = { page: 1, width: 2100, height: 2970, bytes: 1 };
const rowsOf = (id: string) => seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
const field = (over: Partial<MappingField>): MappingField => ({ id: "f1", page: 1, section: "", label: "欄", position: "", shape: "text", options: [], item: null, removed: false, ai: null, ...over });
const allergies = "medical.allergies" as const;
const yes = field({ id: "f1", label: "あり", shape: "check", item: allergies, box: { x: 0.3, y: 0.3, w: 0.012, h: 0.01 } });
/** 決まりで項目を外した「病名（　）」（直す前の形） */
const freedSlot = (reason = "読み（親の項目の空き）") =>
  field({ id: "f2", label: "病名（　）", item: null, box: { x: 0.4, y: 0.297, w: 0.4, h: 0.016 }, ai: { item: null, candidate: allergies, confidence: "high", reason } });

function lookOf(personId: string, fields: MappingField[]) {
  const mapping: FormMapping = { title: "架空の様式", issuer: "", pages: 1, fields };
  const rows = rowsOf(personId);
  const overlay = buildOverlaySheet(buildMappedSheet(rows, mapping, { today: TODAY, officeName: "デモ事業所" }), [image]);
  return lookOfPaper({ rows, mapping, images: [image], overlay, today: TODAY }).score;
}

type Look = NonNullable<RunResult["papers"][number]["look"]>;
const baseLook: Look = { texts: 1, marks: 1, overlap: 0, outside: 0, neighbor: 0, shifted: 0, unplaced: 0, inkPages: 1, blanks: 0, blanksChoice: 0, masks: 0, unplacedOption: 0, unplacedRoom: 0, unplacedBox: 0, annexGap: 0 };
const result = (look: Look, mode: "fake" | "replay" | "real" = "replay") =>
  ({ run: "r", mode, forms: [], inputs: [], papers: [{ form: "cat-x", input: "text-p-03", kind: "text", score: null, look, files: {}, review: null }], calls: {}, leaks: {} }) as never;

describe("T181 欄から値が消えた数", () => {
  it("決まりで外した欄だけを見る（署名の隣の日付・人が外した欄は数えない）", () => {
    expect(settleFreedItem(freedSlot())).toBe(allergies);
    expect(settleFreedItem(freedSlot("読み（署名の隣の日付）"))).toBeNull();
    expect(settleFreedItem(freedSlot("読み"))).toBeNull();
    expect(settleFreedItem({ ...freedSlot(), item: allergies })).toBeNull();
  });

  it("値のある人で、外した欄にも同じ頁の値を書く欄にも何も無ければ 1。値の無い人・ほかの欄に書いた紙は 0", () => {
    expect(lookOf("p-03", [yes, freedSlot()]).freedValue).toBe(1);
    expect(lookOf("p-01", [yes, freedSlot()]).freedValue).toBe(0);
    const wide = field({ id: "f3", label: "アレルギーの内容", shape: "lines", item: allergies, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.05 } });
    expect(lookOf("p-03", [yes, freedSlot(), wide]).freedValue).toBe(0);
  });

  it("点数の表と守りに出る。守りは数え直しでも見る（偽の回は見ない）", () => {
    const v = valuesOf({ bench: "forms", run: "r", client: "replay", data: result({ ...baseLook, freedValue: 3 }) });
    expect(v["forms.freedValue"]).toBe(3);
    expect(itemOf("forms.freedValue")?.better).toBe("lower");
    expect(valuesOf({ bench: "forms", run: "r", client: "replay", data: result(baseLook) })["forms.freedValue"]).toBeUndefined();
    const g = GUARDS.find((x) => x.id === "forms-freed-value")!;
    expect(g).toMatchObject({ item: "forms.freedValue", op: "<=", task: "T181", clients: ["real", "replay"] });
    const rules = (n: number, client: "real" | "replay" | "fake") => guardFindings({ bench: "forms", run: "r", values: { "forms.freedValue": n }, counts: {}, repro: [], client }).map((f) => f.rule);
    expect(rules(g.value, "replay")).not.toContain("guard:forms-freed-value");
    expect(rules(g.value + 1, "replay")).toContain("guard:forms-freed-value");
    expect(rules(g.value + 1, "real")).toContain("guard:forms-freed-value");
    expect(rules(g.value + 1, "fake")).not.toContain("guard:forms-freed-value");
    expect(unjudgedGuards("forms", "fake").map((x) => x.id)).toContain("forms-freed-value");
  });
});
