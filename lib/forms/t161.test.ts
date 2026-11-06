// T161: 一覧の様式の共有の鍵（頁の組）は読み取りの受け口と同じ 10 頁まで、読み取りの決まり 21（□ と、□ の中身を書く括弧の 2 つの欄）、
// 見直しは □ と括弧の組を同じ項目の重複にしない。本物の API は呼ばない。
import { describe, expect, it } from "vitest";
import { PDF_PAGES_MAX } from "../intake/read-form.ts";
import { FORM_READ_SYSTEM } from "./form-read.ts";
import { bracketPair, extraItemFields } from "./form-shape.ts";
import { itemHints } from "./item-hints.ts";
import type { MappingField } from "./mapping.ts";
import { pagesKeyOf } from "./shared-mapping.ts";

describe("共有の頁の組の鍵", () => {
  it("1〜10 頁で作れ、11 頁からは作らない（評価の 6 回目の岐阜市は 4 頁で、前は 3 頁までだった）", () => {
    expect(PDF_PAGES_MAX).toBe(10);
    expect(pagesKeyOf([1, 2, 3, 4])).toBe("1,2,3,4");
    const ten = Array.from({ length: 10 }, (_, i) => 191 + i);
    // 3 桁の番号 10 個でも表の CHECK（40 字まで、migration 0034）に収まる
    expect(pagesKeyOf(ten)!.length).toBeLessThanOrEqual(40);
    expect(pagesKeyOf([...ten, 1])).toBeNull();
    expect(pagesKeyOf([1, 201])).toBeNull();
  });
});

type BoxedField = MappingField & { box: NonNullable<MappingField["box"]> };
const field = (over: Partial<MappingField> & Pick<MappingField, "id" | "label">): BoxedField => ({
  page: 1,
  section: "禁忌事項等",
  shape: "text",
  options: [],
  item: null,
  box: { x: 0.1, y: 0.47, w: 0.3, h: 0.01 },
  ...over,
}) as BoxedField;

describe("□ と括弧の 2 つの欄（読み取りの決まり 21）", () => {
  it("決まりの文に □ と括弧の 2 欄と、決まり 12 の例外がある", () => {
    expect(FORM_READ_SYSTEM).toContain("21. □ 1 つの後ろに、その □ の中身を書く括弧が続く欄");
    expect(FORM_READ_SYSTEM).toContain("決まり 12 の例外");
  });

  it("括弧の欄が項目なしでも、読み取りの補いが □ の項目を当てる", () => {
    const fields = [
      field({ id: "f1", label: "アレルギー", shape: "check", item: "medical.allergies", box: { x: 0.12, y: 0.47, w: 0.013, h: 0.01 } }),
      field({ id: "f2", label: "アレルギー（　）", shape: "text", item: null }),
    ];
    expect(itemHints(fields)).toEqual([{ id: "f2", item: "medical.allergies", rule: "bracket" }]);
  });

  it("□ と括弧の組は同じ項目を 2 か所に当ててよい（見直しの重複にしない）。名前の違う 2 つ目・別の段の 2 つ目は重複", () => {
    const check = field({ id: "f1", label: "アレルギー", shape: "check", item: "medical.allergies" });
    const paren = field({ id: "f2", label: "アレルギー（　）", item: "medical.allergies" });
    expect(bracketPair(check, paren)).toBe(true);
    expect(extraItemFields([check, paren]).size).toBe(0);
    const other = field({ id: "f3", label: "食物（　）", item: "medical.allergies" });
    expect(bracketPair(check, other)).toBe(false);
    expect([...extraItemFields([check, other]).keys()]).toEqual(["f3"]);
    const twice = field({ id: "f4", label: "アレルギー", item: "medical.allergies" });
    expect([...extraItemFields([check, paren, twice]).keys()]).toEqual(["f4"]);
  });
});
