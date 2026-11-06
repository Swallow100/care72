// T164 の評価の台の直し（本物の API・Chrome は使わない）:
// - 正解の表: 災害診療記録の常用薬の種類の行は □ と括弧の 2 欄（原本の枠と同じ。透析・在宅酸素の行は □ だけ）
// - 紙の比べ: 正解の □・選ぶ欄に形の違う AI の欄を合わせたときは、同じ場所の同じ形の欄で比べる（連絡先）
// - 正解に無い印の数（台帳の値に当たらない選択肢の印）と、点数の表の項目・守り

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { buildMappedSheet } from "../../../lib/forms/mapped-sheet.ts";
import type { FormMapping, MappingField } from "../../../lib/forms/mapping.ts";
import { seedRows } from "../../../lib/forms/print-harness.ts";
import type { Cell } from "../../../lib/forms/matsuyama.ts";
import { GUARDS, guardFindings } from "../guards.ts";
import { ITEMS, valuesOf } from "../scorecard-items.ts";
import { GOLD_FORMS, type GoldForm } from "./gold.ts";
import { cellOfSheet, marksNotIn, scorePaper } from "./score.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const rowsOf = (id: string) => seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
const box = (x: number, y: number, w: number, h = 0.012) => ({ x, y, w, h });

describe("災害診療記録の正解の表（T164）", () => {
  const kiroku = GOLD_FORMS.find((g) => g.id === "kiroku")!;

  it("常用薬の種類の行は □ と括弧（「抗血小板薬（　）」）の 2 欄。□ は □ の場所で、括弧は □ より右。透析・在宅酸素は □ だけ", () => {
    for (const label of ["抗血小板薬", "抗凝固薬", "糖尿病治療薬", "ステロイド", "抗てんかん薬", "その他"]) {
      const mark = kiroku.fields.filter((f) => f.label === label && f.shape === "check" && f.item === "medical.medications");
      const text = kiroku.fields.filter((f) => f.label === `${label}（　）`);
      expect(mark, label).toHaveLength(1);
      expect(text, label).toHaveLength(1);
      expect(text[0]).toMatchObject({ shape: "text", item: "medical.medications" });
      expect(mark[0].box!.w).toBeLessThan(0.03);
      expect(mark[0].box!.x + mark[0].box!.w).toBeLessThanOrEqual(text[0].box!.x);
    }
    for (const label of ["透析", "在宅酸素療法（HOT）"]) expect(kiroku.fields.filter((f) => f.label.startsWith(label)), label).toHaveLength(1);
  });
});

let n = 0;
const field = (over: Partial<MappingField>): MappingField => ({ id: `f${++n}`, page: 1, section: "", label: "欄", position: "", shape: "text", options: [], item: null, removed: false, ai: null, ...over });
const mapping = (fields: MappingField[]): FormMapping => ({ title: "架空の様式", issuer: "", pages: 1, fields });

describe("紙の比べ: 同じ場所の同じ形の欄（T164）", () => {
  // 正解は「連絡先」の行の 1 つの選ぶ欄（種類の □）。AI は種類の選ぶ欄と、人の名前を書く字の欄の 2 つに読んだ
  const gold: GoldForm = {
    id: "t164-contact",
    title: "架空の様式",
    pages: [1],
    fields: [{ page: 1, section: "", label: "連絡先", shape: "choice", options: ["家族", "知人", "その他", "連絡先なし"], item: "emergency1.relation", box: box(0.28, 0.386, 0.63, 0.031) }],
  } as unknown as GoldForm;
  const gm = mapping([field({ id: "g1", label: "連絡先", shape: "choice", options: ["家族", "知人", "その他", "連絡先なし"], item: "emergency1.relation", box: box(0.28, 0.386, 0.63, 0.031) })]);
  const kinds = field({ label: "連絡先 種類", shape: "choice", options: ["家族", "知人", "その他", "連絡先なし"], item: "emergency1.relation", box: box(0.3, 0.39, 0.27, 0.012) });
  const name = field({ label: "連絡先", item: "emergency1.name", box: box(0.29, 0.403, 0.62, 0.013) });
  const ai = mapping([kinds, name]);

  it("名前の欄と合わせても、種類の選ぶ欄の印で当たり。正解に無い印は 0", () => {
    const rows = rowsOf("p-01");
    const exp = buildMappedSheet(rows, gm, OPTS);
    const act = buildMappedSheet(rows, ai, OPTS);
    const s = scorePaper({
      form: gold,
      input: "t",
      pairs: new Map([[0, name.id]]),
      goldMapping: gm,
      aiMapping: ai,
      expectedCell: cellOfSheet(exp),
      actualCell: cellOfSheet(act),
      expected: { mapped: exp, overlay: null },
      actual: { mapped: act, overlay: { pages: [], annex: [] } as never },
    });
    expect(s.score.hit).toBe(1);
    expect(s.score.wrong).toBe(0);
    expect(s.score.markExtra).toBe(0);
    expect(s.judgements.map((j) => j.verdict)).toContain("当たり（同じ場所の同じ形の欄）");
  });
});

describe("正解に無い印（T164）", () => {
  const choice = (on: string[], options: string[]): Cell => ({ kind: "choice", options: options.map((label) => ({ label, on: on.includes(label) })) });
  const g = field({ label: "手段", shape: "choice", options: ["徒歩", "車", "その他"] });
  const a = field({ label: "【手段】", shape: "choice", options: ["1徒歩", "2車", "3その他"] });

  it("選ぶ欄は、正解の印に合わない選択肢の印だけ数える（頭の番号・言い方の違いは同じ）", () => {
    expect(marksNotIn(g, choice(["車"], g.options), a, choice(["2車"], a.options))).toEqual([]);
    expect(marksNotIn(g, choice(["車"], g.options), a, choice(["1徒歩", "2車"], a.options))).toEqual(["1徒歩"]);
    expect(marksNotIn(g, { kind: "unconfirmed" }, a, choice(["2車"], a.options))).toEqual(["2車"]);
  });

  it("□ は正解が空なのに印。選択肢の無い正解の選ぶ欄は正解の字と照らす。字の欄は数えない", () => {
    const gc = field({ label: "抗血小板薬", shape: "check" });
    const on: Cell = { kind: "choice", options: [{ label: "", on: true }] };
    const off: Cell = { kind: "choice", options: [{ label: "", on: false }] };
    expect(marksNotIn(gc, off, gc, on)).toEqual(["抗血小板薬"]);
    expect(marksNotIn(gc, on, gc, on)).toEqual([]);
    const sex = field({ label: "性別", shape: "choice", options: [] });
    const aiSex = field({ label: "性別", shape: "choice", options: ["男", "女"] });
    expect(marksNotIn(sex, { kind: "value", lines: [[{ text: "女" }]] }, aiSex, choice(["女"], ["男", "女"]))).toEqual([]);
    expect(marksNotIn(gc, off, field({ label: "抗血小板薬（　）" }), { kind: "value", lines: [[{ text: "なし" }]] })).toEqual([]);
  });
});

describe("点数の表と守り（T164）", () => {
  it("置き間違いと正解に無い印の項目。7 回目までの結果（印の数が無い）は正解に無い印を空に", () => {
    const ids = ITEMS.map((x) => x.id);
    expect(ids).toContain("forms.paperWrong");
    expect(ids).toContain("forms.markExtra");
    const r7like = { run: "r", mode: "real", forms: [], inputs: [], calls: {}, leaks: {}, papers: [{ form: "kiroku", input: "x", kind: "text", score: { wrong: 3, extra: 2 } }] };
    const v = valuesOf({ bench: "forms", run: "r", client: "real", data: r7like as never });
    expect(v["forms.paperWrong"]).toBe(5);
    expect(v["forms.markExtra"]).toBeUndefined();
  });

  it("守り: 正解に無い印 0、置き間違いは 6 回目の 195 まで", () => {
    expect(GUARDS.find((g) => g.id === "forms-mark-extra-none")).toMatchObject({ item: "forms.markExtra", op: "<=", value: 0, task: "T164" });
    expect(GUARDS.find((g) => g.id === "forms-paper-wrong")).toMatchObject({ item: "forms.paperWrong", op: "<=", value: 195, task: "T164" });
    const out = guardFindings({ bench: "forms", run: "r8", values: { "forms.markExtra": 1, "forms.paperWrong": 196 }, counts: {}, repro: [] });
    const ids = out.map((f) => f.rule);
    expect(ids).toContain("guard:forms-mark-extra-none");
    expect(ids).toContain("guard:forms-paper-wrong");
    expect(guardFindings({ bench: "forms", run: "r8", values: { "forms.markExtra": 0, "forms.paperWrong": 73 }, counts: {}, repro: [] }).filter((f) => /mark-extra|paper-wrong/.test(f.rule))).toEqual([]);
  });
});
