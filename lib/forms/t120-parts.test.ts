// T120: 欄の中の区切りの空き（「令和　年　月　日現在」「（　）年　月　日生」「（　歳）」「　−　−　」）に値を分けて置く。
// 評価の 1 回目の埋めた紙で、値を丸ごと置いて刷ってある字と重なっていた。読み取りが区切りの字（options）と空きの場所（optionBoxes）を返し、
// 元の様式の上に値を置く紙が値を分ける。あわせて、台帳の項目なしで人が選ぶ欄（同意など）の印。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { FORM_READ_SYSTEM } from "./form-read.ts";
import { checkReadResult, needsPick, parseMappingInput, type FormMapping, type MappingField, type ReadResult } from "./mapping.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { buildOverlaySheet, partItems, type OverlayItem } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";
import { isUnitPart, splitParts } from "./split-parts.ts";

describe("値を区切りに合わせて分ける", () => {
  it("年・月・日・歳で分ける。刷ってある元号と同じ元号は外す", () => {
    expect(splitParts("令和8年11月5日", ["令和年", "月", "日"])).toEqual(["8", "11", "5"]);
    expect(splitParts("令和8年11月5日", ["年", "月", "日"])).toEqual(["令和8", "11", "5"]);
    expect(splitParts("昭和17年4月18日", ["年", "月", "日"])).toEqual(["昭和17", "4", "18"]);
    expect(splitParts("昭和17年4月18日", ["令和年", "月", "日"])).toEqual(["昭和17", "4", "18"]);
    expect(splitParts("昭和１７年４月１８日", ["年", "月", "日"])).toEqual(["昭和17", "4", "18"]);
    expect(splitParts("令和元年5月1日", ["令和年", "月", "日"])).toEqual(["元", "5", "1"]);
    expect(splitParts("84歳", ["歳"])).toEqual(["84"]);
    expect(splitParts("84 歳", ["歳"])).toEqual(["84"]);
  });

  it("電話は 3 つ（局番・市内・番号）、郵便番号は 2 つ。携帯などの添えは捨てる", () => {
    expect(splitParts("090-0000-0001 携帯", ["局番", "市内", "番号"])).toEqual(["090", "0000", "0001"]);
    expect(splitParts("(089)000-0000", ["局番", "市内", "番号"])).toEqual(["089", "000", "0000"]);
    expect(splitParts("〒790-0001", ["前", "後"])).toEqual(["790", "0001"]);
  });

  it("分けられなければ null（欄全体に置く）", () => {
    expect(splitParts("不明", ["年", "月", "日"])).toBeNull();
    expect(splitParts("昭和17年", ["年", "月", "日"])).toBeNull();
    expect(splitParts("090", ["局番", "市内", "番号"])).toBeNull();
    expect(splitParts("", ["年"])).toBeNull();
    expect(splitParts("あり", ["a", "b", "c", "d"])).toBeNull();
    expect(isUnitPart("令和年")).toBe(true);
    expect(isUnitPart("局番")).toBe(false);
  });
});

describe("元の様式の上の紙で空きごとに置く", () => {
  // 頁と印刷の字の位置（T133 から partItems は頁の文脈を受ける。印刷の字の位置なし）
  const IMG = { page: { page: 1, landscape: false, image: { x: 0, y: 0, w: 210, h: 297 }, items: [], fills: [] }, ink: null };
  const date = (over: Partial<MappingField> = {}): MappingField => ({
    id: "f1",
    page: 1,
    section: "",
    label: "生年月日",
    position: "",
    shape: "date",
    options: ["年", "月", "日"],
    optionBoxes: [
      { x: 0.2, y: 0.1, w: 0.08, h: 0.02 },
      { x: 0.32, y: 0.1, w: 0.04, h: 0.02 },
      { x: 0.4, y: 0.1, w: 0.04, h: 0.02 },
    ],
    item: "person.birth",
    removed: false,
    ai: null,
    box: { x: 0.18, y: 0.1, w: 0.3, h: 0.02 },
    ...over,
  });

  it("空きごとに字を置く（同じ欄の id、何番目かの印）", () => {
    const items = partItems(date(), ["昭和17年4月18日"], IMG) as OverlayItem[];
    expect(items.map((i) => (i.kind === "text" ? [i.lines.join(""), i.part, i.box.x] : null))).toEqual([
      ["昭和17", 0, 0.2],
      ["4", 1, 0.32],
      ["18", 2, 0.4],
    ]);
    expect(items.every((i) => i.fieldId === "f1")).toBe(true);
  });

  it("空きの場所が欠ける・区切りの無い欄・分けられない値は null（欄全体に置く）。分けられたのに空きに収まらない値は fail（置かない。T133）", () => {
    expect(partItems(date({ optionBoxes: [{ x: 0.2, y: 0.1, w: 0.08, h: 0.02 }, null, null] }), ["昭和17年4月18日"], IMG)).toBeNull();
    expect(partItems(date({ options: [], optionBoxes: undefined }), ["昭和17年4月18日"], IMG)).toBeNull();
    expect(partItems(date(), ["不明"], IMG)).toBeNull();
    expect(partItems(date({ optionBoxes: [{ x: 0.2, y: 0.1, w: 0.002, h: 0.002 }, { x: 0.3, y: 0.1, w: 0.04, h: 0.02 }, { x: 0.4, y: 0.1, w: 0.04, h: 0.02 }] }), ["昭和17年4月18日"], IMG)).toBe("fail");
    expect(partItems(date({ shape: "choice" }), ["昭和17年4月18日"], IMG)).toBeNull();
  });

  it("種の人の紙: 生年月日・作成日・年齢・電話の欄を空きごとに。区切りの無い欄は今までどおり 1 つ", () => {
    const rows = seedRows(SEED_PEOPLE.find((p) => p.person.id === "p-01")!);
    const box = (x: number, w = 0.05) => ({ x, y: 0.2, w, h: 0.02 });
    const fields: ReadResult["fields"] = [
      { page: 1, section: "", label: "年　月　日現在", position: "", shape: "date", options: ["令和年", "月", "日"], item: "plan.date", confidence: "high", reason: "", box: box(0.6, 0.3), option_boxes: [box(0.62), box(0.7), box(0.78)] },
      { page: 1, section: "", label: "生年月日", position: "", shape: "date", options: ["年", "月", "日"], item: "person.birth", confidence: "high", reason: "", box: { ...box(0.1, 0.3), y: 0.3 }, option_boxes: [{ ...box(0.1, 0.08), y: 0.3 }, { ...box(0.2), y: 0.3 }, { ...box(0.27), y: 0.3 }] },
      { page: 1, section: "", label: "（　歳）", position: "", shape: "text", options: ["歳"], item: "person.age", confidence: "high", reason: "", box: { ...box(0.4, 0.1), y: 0.3 }, option_boxes: [{ ...box(0.41), y: 0.3 }] },
      { page: 1, section: "", label: "電話", position: "", shape: "phone", options: ["局番", "市内", "番号"], item: "self.phone", confidence: "high", reason: "", box: { ...box(0.1, 0.4), y: 0.4 }, option_boxes: [{ ...box(0.1, 0.08), y: 0.4 }, { ...box(0.22, 0.08), y: 0.4 }, { ...box(0.34, 0.08), y: 0.4 }] },
      { page: 1, section: "", label: "氏名", position: "", shape: "text", options: [], item: "person.name", confidence: "high", reason: "", box: { ...box(0.1, 0.4), y: 0.5 }, option_boxes: [] },
    ];
    const m: FormMapping = checkReadResult({ title: "様式", issuer: "", pages: 1, typeface: "gothic", fields }).mapping;
    expect(m.fields[0].optionBoxes).toHaveLength(3);
    const img: PageImage[] = [{ page: 1, width: 1413, height: 2000, bytes: 1 }];
    const s = buildOverlaySheet(buildMappedSheet(rows, m, { today: "2026-11-05", officeName: "デモ事業所" }), img);
    const texts = (id: string) => s.pages[0].items.filter((i) => i.fieldId === id).map((i) => (i.kind === "text" ? i.lines.join("") : ""));
    expect(texts("f1")).toEqual(["8", "11", "5"]);
    expect(texts("f2")).toHaveLength(3);
    expect(texts("f2")[0]).toMatch(/^昭和\d+$/);
    expect(texts("f3")).toHaveLength(1);
    expect(texts("f3")[0]).toMatch(/^\d+$/);
    expect(texts("f4")).toHaveLength(3);
    expect(texts("f4").join("-")).toMatch(/^\d{2,5}-\d{1,4}-\d{3,4}$/);
    expect(texts("f5")).toHaveLength(1);
  });

  it("保存の形も区切りの空きを残す（日付・電話・文字の欄）", () => {
    const parsed = parseMappingInput(JSON.parse(JSON.stringify({ title: "様式", issuer: "", pages: 1, fields: [date()] })));
    expect(parsed.ok && parsed.mapping.fields[0].optionBoxes).toHaveLength(3);
  });

  it("読み取りの決まりに区切りの空き（決まり 14）", () => {
    expect(FORM_READ_SYSTEM).toContain("options にその字を左から並べ");
    expect(FORM_READ_SYSTEM).toContain("「令和年」のように元号を付けて");
    expect(FORM_READ_SYSTEM).toContain("[\"局番\",\"市内\",\"番号\"]");
  });
});

describe("台帳の項目なしで人が選ぶ欄", () => {
  const f = (over: Partial<MappingField>): MappingField => ({ id: "f1", page: 1, section: "", label: "名簿への登録", position: "", shape: "check", options: [], item: null, removed: false, ai: null, ...over });
  it("同意・承諾の欄と、AI が候補を挙げた欄。項目のある欄・外した欄・手書きの欄は除く", () => {
    expect(needsPick(f({ section: "同意" }))).toBe(true);
    expect(needsPick(f({ label: "承諾書" }))).toBe(true);
    expect(needsPick(f({ ai: { item: null, confidence: "medium", reason: "", candidate: "consent.registry" } }))).toBe(true);
    expect(needsPick(f({}))).toBe(false);
    expect(needsPick(f({ section: "同意", item: "consent.registry" }))).toBe(false);
    expect(needsPick(f({ section: "同意", removed: true }))).toBe(false);
    expect(needsPick(f({ section: "同意", shape: "handwrite" }))).toBe(false);
  });
});
