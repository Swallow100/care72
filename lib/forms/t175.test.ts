// T175: 書類の読み取りの揺れ。同じ様式でも読み取りが回ごとに違う形（評価の 8 回目と 9 回目の答えの差。docs/progress/t175.md）で、
// 紙と見直しの数が変わらないようにする。どれも架空の頁と種の人で確かめる（原本の絵は使わない）。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { bracketOwner, bracketPair, extraItemFields } from "./form-shape.ts";
import { buildMappedSheet, pairedItem } from "./mapped-sheet.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { buildOverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";
import { settleRead } from "./read-settle.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const rowsOf = (id: string) => seedRows(seed(id));
const image: PageImage = { page: 1, width: 2100, height: 2970, bytes: 1 };

let n = 0;
type BoxedField = MappingField & { box: NonNullable<MappingField["box"]> };
const field = (over: Partial<MappingField>): BoxedField =>
  ({
    id: `f${++n}`,
    page: 1,
    section: "",
    label: "欄",
    position: "",
    shape: "text",
    options: [],
    item: null,
    removed: false,
    ai: null,
    box: { x: 0.1, y: 0.9, w: 0.1, h: 0.01 },
    ...over,
  }) as BoxedField;
const mapping = (fields: MappingField[]): FormMapping => ({ title: "架空の様式", issuer: "", pages: 1, fields });
const cells = (rows: ReturnType<typeof rowsOf>, m: FormMapping) =>
  new Map(buildMappedSheet(rows, m, OPTS).pages.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => [r.field.id, r.cell] as const))));
const box = (x: number, y: number, w: number, h = 0.012) => ({ x, y, w, h });

/** 選択肢の深さの空き（「洪水浸水想定区域（浸水想定　m）」）に親と同じ項目を当てた読み取りの形。架空の場所 */
function hazardRows() {
  const item = "evacuation.hazards" as const;
  const choice = field({
    label: "地形的特性",
    shape: "choice",
    item,
    options: ["洪水浸水想定区域", "高潮浸水想定区域", "土砂災害（特別）警戒区域"],
    optionBoxes: [box(0.5, 0.3, 0.01, 0.01), box(0.7, 0.3, 0.01, 0.01), box(0.5, 0.33, 0.01, 0.01)],
    box: box(0.5, 0.3, 0.4, 0.05),
  });
  const flood = field({ label: "洪水浸水想定区域（浸水想定　m）", item, box: box(0.62, 0.3, 0.05, 0.014) });
  const surge = field({ label: "高潮浸水想定区域（浸水想定　m）", item, box: box(0.82, 0.3, 0.05, 0.014) });
  return { choice, flood, surge, all: [choice, flood, surge] };
}

describe("T175 選択肢の名前の字の欄は選ぶ欄の子", () => {
  it("選択肢の名前と括弧の説明・選択肢の名前そのものの字の欄は、同じ項目の選ぶ欄の子", () => {
    const h = hazardRows();
    expect(bracketOwner(h.flood, h.all)).toMatchObject({ owner: h.choice, option: 0 });
    expect(bracketOwner(h.surge, h.all)).toMatchObject({ owner: h.choice, option: 1 });
    const same = field({ label: "土砂災害（特別）警戒区域", item: "evacuation.hazards", box: box(0.62, 0.33, 0.1) });
    expect(bracketOwner(same, [...h.all, same])).toMatchObject({ owner: h.choice, option: 2 });
    // 見直しの重複にしない
    expect(bracketPair(h.flood, h.choice)).toBe(true);
    expect(extraItemFields([h.choice, h.flood]).size).toBe(0);
  });

  it("項目の違う欄・項目なしの欄・名前の違う欄・□ と選ぶ欄の組でない形は子にしない", () => {
    const h = hazardRows();
    const other = field({ label: "洪水浸水想定区域（浸水想定　m）", item: "notes.other", box: box(0.62, 0.3, 0.05, 0.014) });
    expect(bracketOwner(other, [...h.all, other])).toBeNull();
    const free = field({ label: "洪水浸水想定区域（浸水想定　m）", item: null, box: box(0.62, 0.3, 0.05, 0.014) });
    expect(bracketOwner(free, [...h.all, free])).toBeNull();
    const near = field({ label: "洪水の備考", item: "evacuation.hazards", box: box(0.62, 0.36, 0.1) });
    expect(bracketOwner(near, [...h.all, near])).toBeNull();
    // 種類の □ の後ろの括弧は今までどおり（「在宅酸素療法（HOT）」のように中に字のある名前は子にしない）
    const oxy = field({ label: "在宅酸素療法（HOT）", shape: "check", item: "medical.devices", box: box(0.1, 0.5, 0.01, 0.01) });
    const text = field({ label: "在宅酸素療法（HOT）", item: "medical.devices", box: box(0.2, 0.5, 0.1) });
    expect(bracketOwner(text, [oxy, text])).toBeNull();
  });

  it("紙は子の欄に災害の種類を丸ごと書かない", () => {
    const h = hazardRows();
    const id = SEED_PEOPLE.map((p) => p.person.id).find((pid) => {
      const c = cells(rowsOf(pid), mapping([h.choice]));
      const v = c.get(h.choice.id);
      return v?.kind === "choice" && v.options.some((o) => o.on);
    });
    expect(id).toBeTruthy();
    const c = cells(rowsOf(id!), mapping(h.all));
    expect(c.get(h.flood.id)?.kind).toBe("empty");
    expect(c.get(h.surge.id)?.kind).toBe("empty");
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf(id!), mapping(h.all), OPTS), [image]);
    // 親の □ に印が付き、子の欄で置けなかった欄を作らない
    expect(sheet.unplacedIds ?? []).not.toContain(h.flood.id);
    expect(sheet.unplacedIds ?? []).not.toContain(h.surge.id);
  });
});

describe("T175 読み方の揺れをそろえる（settleRead）", () => {
  const texts = (fs: readonly MappingField[]) => fs.map((f) => [f.label, f.shape, f.item]);

  it("同じ項目の □ の並びは 1 つの選ぶ欄に。間の括弧は項目なし。どちらの読み方でも同じ □ に印", () => {
    const item = "care.handbook" as const;
    const boxes = [box(0.1, 0.1, 0.01, 0.01), box(0.3, 0.1, 0.01, 0.01), box(0.1, 0.13, 0.01, 0.01)];
    const a = field({ section: "制度", label: "身体障害者手帳1級・2級", shape: "check", item, box: boxes[0] });
    const part = field({ section: "制度", label: "部位（　）", item, box: box(0.2, 0.1, 0.05) });
    const b = field({ section: "制度", label: "精神障害者保健福祉手帳1級", shape: "check", item, box: boxes[1] });
    const c = field({ section: "制度", label: "療育手帳A", shape: "check", item, box: boxes[2] });
    const got = settleRead([a, part, b, c]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ id: a.id, shape: "choice", item, options: [a.label, b.label, c.label], optionBoxes: boxes });
    expect(got[0].box?.w).toBeCloseTo(0.21);
    expect(got[0].box?.h).toBeCloseTo(0.04);
    expect(got[1]).toMatchObject({ id: part.id, item: null });
    // 手帳のある人で、印は 1 つまで（まとめる前は全部の □ に印が付く）
    const id = SEED_PEOPLE.map((p) => p.person.id).find((pid) => {
      const v = cells(rowsOf(pid), mapping([a])).get(a.id);
      return v?.kind === "choice" && v.options.some((o) => o.on);
    });
    expect(id).toBeTruthy();
    const v = cells(rowsOf(id!), mapping(got)).get(a.id);
    expect(v?.kind === "choice" ? v.options.filter((o) => o.on).length : -1).toBeLessThanOrEqual(1);
  });

  it("医療機器・常用薬の □ は □ ごとのまま。項目の違う □・段の違う □・1 つだけの □ はまとめない", () => {
    const dev = (label: string, x: number) => field({ label, shape: "check", item: "medical.devices", box: box(x, 0.1, 0.01, 0.01) });
    const fs = [dev("人工呼吸器", 0.1), dev("吸引", 0.2)];
    expect(settleRead(fs)).toEqual(fs);
    const one = field({ label: "独居", shape: "check", item: "basic.household", box: box(0.1, 0.2, 0.01, 0.01) });
    const other = field({ label: "要介護", shape: "check", item: "care.careLevel", box: box(0.2, 0.2, 0.01, 0.01) });
    expect(texts(settleRead([one, other]))).toEqual(texts([one, other]));
    const s1 = field({ section: "甲", label: "身体", shape: "check", item: "care.handbook", box: box(0.1, 0.3, 0.01, 0.01) });
    const s2 = field({ section: "乙", label: "療育", shape: "check", item: "care.handbook", box: box(0.1, 0.4, 0.01, 0.01) });
    expect(settleRead([s1, s2]).map((f) => f.shape)).toEqual(["check", "check"]);
  });

  it("同じ項目の字の欄は 1 つに。広い欄か項目の名前の言葉を持つ欄に残し、ほかは項目なしで候補に残す", () => {
    const ai = (item: MappingField["item"]) => ({ item, confidence: "high" as const, reason: "読み" });
    const narrow = field({ label: "持ち出し品", item: "evacuation.carryItems", box: box(0.5, 0.5, 0.05, 0.02), ai: ai("evacuation.carryItems") });
    const wide = field({ label: "必ず持ち出す物", shape: "lines", item: "evacuation.carryItems", box: box(0.5, 0.1, 0.4, 0.2), ai: ai("evacuation.carryItems") });
    const got = settleRead([wide, narrow]);
    expect(got[0].item).toBe("evacuation.carryItems");
    expect(got[1]).toMatchObject({ id: narrow.id, item: null, ai: { candidate: "evacuation.carryItems" } });
    // 項目の名前の言葉（その他の特記 の 特記）を持つ欄が先。広さが 10 倍より離れていれば広い欄
    const tok = field({ label: "特記事項", shape: "lines", item: "notes.other", box: box(0.1, 0.1, 0.34, 0.06) });
    const help = field({ label: "助けてほしいこと", shape: "lines", item: "notes.other", box: box(0.5, 0.1, 0.4, 0.3) });
    expect(settleRead([help, tok]).map((f) => f.item)).toEqual([null, "notes.other"]);
    const tiny = field({ label: "特記", item: "notes.other", box: box(0.1, 0.1, 0.03, 0.01) });
    expect(settleRead([help, tiny]).map((f) => f.item)).toEqual(["notes.other", null]);
  });

  it("重ねてよい組は外さない: 頁ごとの同じ場所・電話と携帯・選択肢の子の欄", () => {
    const p1 = field({ page: 1, label: "氏名", item: "person.name", box: box(0.1, 0.1, 0.2) });
    const p2 = field({ page: 2, label: "氏名", item: "person.name", box: box(0.1, 0.1, 0.2) });
    expect(settleRead([p1, p2]).map((f) => f.item)).toEqual(["person.name", "person.name"]);
    const tel = field({ label: "電話", shape: "phone", item: "emergency1.phone", box: box(0.1, 0.2, 0.2) });
    const mob = field({ label: "携帯", shape: "phone", item: "emergency1.phone", box: box(0.1, 0.3, 0.2) });
    expect(settleRead([tel, mob]).map((f) => f.item)).toEqual(["emergency1.phone", "emergency1.phone"]);
    const h = hazardRows();
    expect(settleRead(h.all).map((f) => f.item)).toEqual(["evacuation.hazards", "evacuation.hazards", "evacuation.hazards"]);
  });

  it("「住所・連絡先」の欄は住所と電話の組（T141 の組）", () => {
    expect(pairedItem({ item: "supporter1.address", label: "住所・連絡先 ①" })).toMatchObject({ item: "supporter1.phone", role: "phone" });
    expect(pairedItem({ item: "supporter1.phone", label: "連絡先" })).toBeNull();
  });
});
