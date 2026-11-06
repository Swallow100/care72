// T160 評価の 6 回目（書類）で残った物の直し: 日付の欄（生年月日の「歳」の空き・刷ってある元号と違う元号・西暦の欄・マスの欄・狭い空き）、
// 選ぶ欄で当たる選択肢が 2 つのときの狭い方、低い欄（フリガナの行）の最後の置き方。どれも架空の頁と種の人で確かめる（原本の絵は使わない）
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { InkBlob } from "./ink.ts";
import { agePartItem, buildMappedSheet, pickWords } from "./mapped-sheet.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { pickByCodes } from "./option-values.ts";
import {
  combItems,
  DIGITS_MIN_PT,
  partItems,
  placeText,
  SNUG_PAD_X_MM,
  textExtent,
  textPads,
  TIGHT_PAD_X_MM,
  westernDateLines,
  type OverlayItem,
  type PlaceCtx,
} from "./overlay-sheet.ts";
import { seedRows } from "./print-harness.ts";
import { splitParts } from "./split-parts.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const IMAGE = { x: 0, y: 0, w: 210, h: 297 };
const W = 1 / 210;
const H = 1 / 297;
const pc = (ink: InkBlob[] | null): PlaceCtx => ({ page: { page: 1, landscape: false, image: IMAGE, items: [], fills: [] }, ink });
const blob = (x: number, y: number, w: number, h: number, line = false): InkBlob => ({ x, y, w, h, box: false, ...(line ? { line: true } : {}) });
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

let n = 0;
const field = (over: Partial<MappingField>): MappingField => ({
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
  ...over,
});
const mapping = (fields: MappingField[]): FormMapping => ({ title: "架空の様式", issuer: "", pages: 1, fields });
const texts = (items: readonly OverlayItem[]) => items.flatMap((i) => (i.kind === "text" ? i.lines : []));
type Items = Exclude<ReturnType<typeof partItems>, null | "fail" | "era">;

describe("T160 生年月日の「歳」の空き", () => {
  const boxes = [0.12, 0.2, 0.28, 0.36].map((x) => ({ x, y: 0.201, w: 0.05, h: 0.016 }));
  const birth = (over: Partial<MappingField> = {}) =>
    field({ label: "生年月日", shape: "date", item: "person.birth", options: ["年", "月", "日", "歳"], box: { x: 0.1, y: 0.2, w: 0.4, h: 0.02 }, optionBoxes: boxes, ...over });

  it("欄の名前に年齢が無くても「歳」の空きがあれば年齢を組にする", () => {
    expect(agePartItem({ item: "person.birth", options: ["年", "月", "日", "歳"] })).toMatchObject({ item: "person.age", second: true });
    expect(agePartItem({ item: "person.birth", options: ["年", "月", "日"] })).toBeNull();
    expect(agePartItem({ item: "plan.date", options: ["年", "月", "日", "歳"] })).toBeNull();
  });

  it("紙の値は年・月・日・歳に分けられ、4 つの空きに置く", () => {
    const f = birth();
    const sheet = buildMappedSheet(seedRows(seed("p-01")), mapping([f]), OPTS);
    const cell = sheet.pages[0].sections[0].rows[0].cell;
    expect(cell.kind).toBe("value");
    const value = cell.kind === "value" ? cell.lines.flat().map((p) => p.text).join(" ") : "";
    expect(splitParts(value, f.options)).toEqual(["昭和17", "4", "18", "84"]);
    const items = partItems(f, [value], pc(null)) as Items;
    expect(texts(items)).toEqual(["昭和17", "4", "18", "84"]);
  });
});

describe("T160 刷ってある元号と西暦の欄", () => {
  it("「昭和　年」の欄に昭和でない日付を書かない（era）。昭和は数だけ", () => {
    const f = field({
      label: "生年月日",
      shape: "date",
      item: "person.birth",
      options: ["昭和年", "月", "日"],
      box: { x: 0.1, y: 0.2, w: 0.4, h: 0.02 },
      optionBoxes: [0.12, 0.2, 0.28].map((x) => ({ x, y: 0.201, w: 0.05, h: 0.016 })),
    });
    expect(partItems(f, ["大正12年4月18日"], pc(null))).toBe("era");
    expect(texts(partItems(f, ["昭和17年4月18日"], pc(null)) as Items)).toEqual(["17", "4", "18"]);
  });

  it("区切りの無い西暦の欄は西暦に。「8 桁」は数だけの 8 字。ほかの欄はそのまま", () => {
    const f = (label: string, over: Partial<MappingField> = {}) => field({ label, shape: "date", ...over });
    expect(westernDateLines(f("西暦生年月日 8 桁"), ["昭和17年4月18日"])).toEqual(["19420418"]);
    expect(westernDateLines(f("生年月日（西暦）"), ["昭和17年4月18日"])).toEqual(["1942年4月18日"]);
    expect(westernDateLines(f("生年月日"), ["昭和17年4月18日"])).toEqual(["昭和17年4月18日"]);
    expect(westernDateLines(f("生年月日（西暦）", { options: ["年", "月", "日"] }), ["昭和17年4月18日"])).toEqual(["昭和17年4月18日"]);
    expect(westernDateLines(f("西暦生年月日"), ["不明"])).toEqual(["不明"]);
  });
});

describe("T160 マスの欄", () => {
  // 8 つのマス（幅 8mm、高さ 8mm）。縦の罫線 7 本
  const box = { x: 0.1, y: 0.5, w: 64 * W, h: 8 * H };
  const rules = Array.from({ length: 7 }, (_, k) => blob(0.1 + (k + 1) * 8 * W, 0.5, 0.2 * W, 8 * H, true));
  const f = field({ label: "西暦生年月日 8 桁", shape: "date", item: "person.birth", box });

  it("数だけの値を 1 字ずつマスに置く。字はマスの中", () => {
    const items = combItems(f, ["19420418"], pc(rules)) as OverlayItem[];
    expect(texts(items)).toEqual([..."19420418"]);
    for (const [k, it] of items.entries()) {
      const ext = textExtent(it as Extract<OverlayItem, { kind: "text" }>, IMAGE);
      expect(ext.x).toBeGreaterThanOrEqual(0.1 + k * 8 * W - 1e-9);
      expect(ext.x + ext.w).toBeLessThanOrEqual(0.1 + (k + 1) * 8 * W + 1e-9);
    }
    // 大きさはそろう
    expect(new Set(items.map((i) => (i.kind === "text" ? i.fontPt : 0))).size).toBe(1);
  });

  it("マスの数と字の数が違う・数でない値は使わない", () => {
    expect(combItems(f, ["1942418"], pc(rules))).toBeNull();
    expect(combItems(f, ["昭和17年4月18日"], pc(rules))).toBeNull();
    expect(combItems(f, ["19420418"], pc([]))).toBeNull();
  });
});

describe("T160 低い欄・狭い空きの最後の置き方", () => {
  it("高さ 2.3mm の行（フリガナ）に 1 行で置く。字は枠の中", () => {
    const area = { x: 0.1, y: 0.3, w: 32 * W, h: 2.3 * H };
    const t = placeText("kana", ["モリ ケイコ"], area, pc([]));
    expect(t).not.toBeNull();
    expect(t!.snug).toBe(true);
    expect(t!.lines).toEqual(["モリ ケイコ"]);
    const ext = textExtent(t!, IMAGE);
    expect(ext.y).toBeGreaterThanOrEqual(area.y - 1e-9);
    expect(ext.y + ext.h).toBeLessThanOrEqual(area.y + area.h + 1e-9);
  });

  it("刷ってある字に挟まれた幅 3.4mm の空きに 2 桁の数（5.5pt まで）。折り返さない", () => {
    const area = { x: 0.3, y: 0.3, w: 3.4 * W, h: 4.75 * H };
    const t = placeText("y", ["17"], area, pc([]));
    expect(t?.lines).toEqual(["17"]);
    expect(t!.fontPt).toBeGreaterThanOrEqual(DIGITS_MIN_PT);
    const ext = textExtent(t!, IMAGE);
    expect(ext.x + ext.w).toBeLessThanOrEqual(area.x + area.w + 1e-9);
    // 数でない字は 6pt より小さくしない
    expect(placeText("y", ["ああ"], { ...area, w: 3 * W }, pc([]))).toBeNull();
  });

  it("空きの大きさ（紙面・見直し・照合の絵で同じ）", () => {
    expect(textPads({}).padX).toBe(0.8);
    expect(textPads({ tight: true }).padX).toBe(TIGHT_PAD_X_MM);
    expect(textPads({ snug: true })).toEqual({ padX: SNUG_PAD_X_MM, padY: SNUG_PAD_X_MM, lineHeight: 1 });
  });
});

describe("T160 当たる選択肢が 2 つのとき", () => {
  it("1 つの並びがほかの並びに全部入り、それより狭ければその選択肢", () => {
    // □独居 □高齢者のみ □同居 で夫婦の人
    const table = [["alone"], ["with_spouse"], ["with_spouse", "with_child", "with_family"]];
    expect(pickByCodes(table, ["with_spouse"], false, [])).toEqual({ hits: [1], range: false, ambiguous: false });
    expect(pickByCodes(table, ["with_child"], false, [])).toEqual({ hits: [2], range: false, ambiguous: false });
  });

  it("並びが同じ選択肢は台帳の値で決まらないので選ばない", () => {
    // □男性 □女性（妊娠なし） □女性（妊娠あり）
    const table = [["male"], ["female"], ["female"]];
    expect(pickByCodes(table, ["female"], false, [])).toMatchObject({ hits: [], ambiguous: true });
  });
});

describe("T160 既往症・予防接種の言葉の当て方", () => {
  it("選択肢の方が細かければ印を付けず「その他」へ、言葉の方が細かければ印と残り、当たらない言葉は「その他」へ", () => {
    const vac = pickWords(["麻疹", "破傷風", "今期インフルエンザ", "肺炎球菌", "風疹", "その他（　）"], ["インフルエンザ", "新型コロナ", "あり"])!;
    expect(vac.options.some((o) => o.on)).toBe(false);
    expect(vac.after).toEqual(["インフルエンザ", "新型コロナ"]);
    expect(pickWords(["なし", "あり"], ["脳梗塞", "あり"])).toBeNull();
    const vac2 = pickWords(["麻疹", "今期インフルエンザ", "肺炎球菌", "その他（　）"], ["インフルエンザ", "肺炎球菌", "新型コロナ", "あり"])!;
    expect(vac2.options.filter((o) => o.on).map((o) => o.label)).toEqual(["肺炎球菌"]);
    expect(vac2.after).toEqual(["インフルエンザ", "新型コロナ"]);
    const his = pickWords(["高血圧", "糖尿病", "喘息", "その他"], ["2 型糖尿病", "高血圧症", "あり"])!;
    expect(his.options.filter((o) => o.on).map((o) => [o.label, o.detail ?? null])).toEqual([
      ["高血圧", null],
      ["糖尿病", "2 型"],
    ]);
    expect(his.after).toEqual([]);
  });

  it("紙の値: 当たる選択肢に印、ほかの言葉は「その他」の括弧へ（落とさない）", () => {
    const f = field({ label: "予防接種", shape: "choice", item: "medical.vaccinations", options: ["麻疹", "今期インフルエンザ", "肺炎球菌", "その他（　）"] });
    const rows = seedRows(seed("p-08"));
    const cell = buildMappedSheet(rows, mapping([f]), OPTS).pages[0].sections[0].rows[0].cell;
    expect(cell.kind).toBe("choice");
    if (cell.kind !== "choice") return;
    expect(cell.options.some((o) => o.on && o.label === "今期インフルエンザ")).toBe(false);
    const after = (cell.after ?? []).map((p) => p.text).join("");
    expect(after).toContain("インフルエンザ");
    expect(after).toContain("新型コロナ");
  });
});
