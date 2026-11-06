// T164: □・選択肢の後ろの括弧の欄（括弧の子の欄）。評価の 7 回目で、読み取りの決まり 21 のあと AI が「□抗血小板薬（　）」「□その他（　）」
// 「□洪水（～）」の括弧を親と同じ項目の字の欄として挙げ、紙が括弧に項目の値を丸ごと書いた（常用薬の全部・「なし」、手段の値）。
// 括弧の子の欄は、□ の種類の値だけか、選ぶ欄の添えの置き場にする。どれも架空の頁と種の人で確かめる（原本の絵は使わない）
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { bracketBase, bracketOwner, bracketPair, extraItemFields, strayOther } from "./form-shape.ts";
import { checkLook } from "./overlay-check.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { annexGaps, buildOverlaySheet, cellLines } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const rowsOf = (id: string) => seedRows(seed(id));
const image: PageImage = { page: 1, width: 2100, height: 2970, bytes: 1 };

let n = 0;
type BoxedField = MappingField & { box: NonNullable<MappingField["box"]> };
const field = (over: Partial<MappingField>): BoxedField => ({
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

/** 災害診療記録の常用薬の 3 行の形（□ と括弧。架空の場所） */
function drugRows() {
  const item = "medical.medications" as const;
  const antiplatelet = field({ label: "抗血小板薬", shape: "check", item, box: box(0.127, 0.523, 0.013, 0.009) });
  const antiplateletB = field({ label: "抗血小板薬（　）", item, box: box(0.244, 0.521, 0.648) });
  const anticoag = field({ label: "抗凝固薬", shape: "check", item, box: box(0.127, 0.54, 0.013, 0.009) });
  const warfarin = field({ label: "ワーファリン", shape: "check", item, box: box(0.244, 0.54, 0.013, 0.009) });
  const warfarinB = field({ label: "ワーファリン（　）", item, box: box(0.364, 0.538, 0.528) });
  const other = field({ label: "その他", shape: "check", item, box: box(0.127, 0.623, 0.013, 0.009) });
  const otherB = field({ label: "その他（　）", item, box: box(0.209, 0.621, 0.684) });
  return { antiplatelet, antiplateletB, anticoag, warfarin, warfarinB, other, otherB, all: [antiplatelet, antiplateletB, anticoag, warfarin, warfarinB, other, otherB] };
}

describe("T164 括弧の子の欄の見分け", () => {
  it("名前の後ろの空の括弧・（～）だけ。中に字のある括弧は違う", () => {
    expect(bracketBase({ label: "抗血小板薬（　）", shape: "text" })).toBe("抗血小板薬");
    expect(bracketBase({ label: "洪水（～）", shape: "text" })).toBe("洪水");
    expect(bracketBase({ label: "その他( )", shape: "text" })).toBe("その他");
    expect(bracketBase({ label: "在宅酸素療法（HOT）", shape: "text" })).toBeNull();
    expect(bracketBase({ label: "抗血小板薬（　）", shape: "check" })).toBeNull();
  });

  it("□ の親は名前が同じ □、行の左の同じ項目の □ も中身に入れる。項目なし・違う項目の括弧は子にしない", () => {
    const d = drugRows();
    expect(bracketOwner(d.antiplateletB, d.all)).toMatchObject({ owner: d.antiplatelet, option: null, row: [d.antiplatelet] });
    const w = bracketOwner(d.warfarinB, d.all)!;
    expect(w.owner).toBe(d.warfarin);
    expect(new Set(w.row)).toEqual(new Set([d.anticoag, d.warfarin]));
    const free = field({ label: "抗血小板薬（　）", item: null, box: d.antiplateletB.box });
    expect(bracketOwner(free, [...d.all, free])).toBeNull();
    const notes = field({ label: "その他（　）", item: "medical.notes", box: d.otherB.box });
    expect(bracketOwner(notes, [...d.all, notes])).toBeNull();
  });

  it("選ぶ欄の親は、括弧の前の字を選択肢に持つ欄（頭の番号は外す）", () => {
    const means = field({ label: "【手段】", shape: "choice", item: "evacuation.transport", options: ["1徒歩", "2車", "3その他"], box: box(0.6, 0.264, 0.325, 0.015) });
    const otherB = field({ label: "その他（　）", item: "evacuation.transport", box: box(0.835, 0.267, 0.064, 0.009) });
    expect(bracketOwner(otherB, [means, otherB])).toMatchObject({ owner: means, option: 2 });
    const hazards = field({ label: "自宅のリスク", shape: "choice", item: "evacuation.hazards", options: ["洪水", "土砂災害", "津波"], box: box(0.27, 0.107, 0.65, 0.031) });
    const flood = field({ label: "洪水（～）", item: "evacuation.hazards", box: box(0.41, 0.124, 0.113) });
    expect(bracketOwner(flood, [hazards, flood])).toMatchObject({ owner: hazards, option: 0 });
  });

  it("選択肢の括弧の子の欄は、親と同じ項目でも見直しの重複にしない", () => {
    const means = field({ label: "【手段】", shape: "choice", item: "evacuation.transport", options: ["徒歩", "車", "その他"], box: box(0.6, 0.264, 0.325, 0.015) });
    const otherB = field({ label: "その他（　）", item: "evacuation.transport", box: box(0.835, 0.267, 0.064, 0.009) });
    expect(bracketPair(means, otherB)).toBe(true);
    expect(extraItemFields([means, otherB]).size).toBe(0);
    const unrelated = field({ label: "車種（　）", item: "evacuation.transport", box: box(0.1, 0.3, 0.2) });
    expect([...extraItemFields([means, unrelated]).keys()]).toEqual([unrelated.id]);
  });
});

describe("T164 種類の □ の括弧はその種類の値だけ", () => {
  it("ワーファリンの人（p-01）: 抗凝固薬の行の括弧に薬の名前、ほかの種類の括弧は空（「なし」も書かない）", () => {
    const d = drugRows();
    const c = cells(rowsOf("p-01"), mapping(d.all));
    const lines = (f: MappingField) => cellLines(c.get(f.id)!);
    expect(lines(d.warfarinB).join("")).toContain("ワーファリン");
    expect(lines(d.antiplateletB)).toEqual([]);
    expect(lines(d.otherB)).toEqual([]);
    expect(c.get(d.antiplateletB.id)!.kind).toBe("empty");
    // □ の印は今までどおり種類ごと
    const on = (f: MappingField) => { const x = c.get(f.id)!; return x.kind === "choice" && x.options.some((o) => o.on); };
    expect([on(d.antiplatelet), on(d.anticoag), on(d.warfarin), on(d.other)]).toEqual([false, true, true, false]);
  });

  it("その他の区分の薬の人（p-04）は「その他（　）」に名前。薬の無い人（p-10）はどの括弧も空", () => {
    const d = drugRows();
    expect(cellLines(cells(rowsOf("p-04"), mapping(d.all)).get(d.otherB.id)!).join("")).not.toBe("");
    const none = cells(rowsOf("p-10"), mapping(d.all));
    for (const f of [d.antiplateletB, d.warfarinB, d.otherB]) expect(none.get(f.id)!.kind).toBe("empty");
  });

  it("種類でない □ の括弧（アレルギー）は今までどおり項目の値（T161）", () => {
    const allergy = SEED_PEOPLE.find((p) => (p.ledger.medical.allergies ?? []).length > 0)!.person.id;
    const check = field({ label: "アレルギー", shape: "check", item: "medical.allergies", box: box(0.127, 0.471, 0.013, 0.009) });
    const paren = field({ label: "アレルギー（　）", item: "medical.allergies", box: box(0.24, 0.469, 0.6) });
    const c = cells(rowsOf(allergy), mapping([check, paren]));
    expect(cellLines(c.get(paren.id)!).join("")).not.toBe("");
  });

  it("紙は括弧の枠の中に置き、隣の欄・枠の外に掛けない", () => {
    const d = drugRows();
    const m = mapping(d.all);
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf("p-01"), m, OPTS), [image]);
    const texts = sheet.pages[0].items.filter((i) => i.kind === "text");
    expect(texts.map((t) => t.fieldId)).toEqual([d.warfarinB.id]);
    const look = checkLook(sheet, m.fields, [image]);
    expect([look.overlap, look.outside, look.neighbor]).toEqual([0, 0, 0]);
  });
});

describe("T164 並びの終わりの「その他（　）」に違う項目", () => {
  it("常用薬の □ の並びの後の「その他（　）」に医療の特記を当てても書かない。項目なし・同じ項目は今までどおり", () => {
    const d = drugRows();
    const notes = field({ label: "その他（　）", item: "medical.notes", box: d.otherB.box });
    const fields = [d.antiplatelet, d.antiplateletB, d.anticoag, notes];
    expect(strayOther(notes, fields)).toBe(true);
    const c = cells(rowsOf("p-01"), mapping(fields));
    expect(c.get(notes.id)!.kind).toBe("empty");
    // 段の頭の「その他（　）」・前が同じ項目の欄は違う
    const alone = field({ label: "その他（　）", item: "medical.notes", section: "特記" });
    expect(strayOther(alone, [d.antiplatelet, alone])).toBe(false);
    const free = field({ label: "その他（　）", item: null });
    expect(strayOther(free, [d.antiplatelet, free])).toBe(false);
  });
});

describe("T164 種類の □ の並びの終わりの「その他（　）」（その他の □ を読み落とした形）", () => {
  it("前の □ と同じ項目なら、その他の種類の値だけ（ワーファリンの人は空、その他の区分の薬の人は名前）", () => {
    const d = drugRows();
    const rest = field({ label: "その他（　）", item: "medical.medications", box: d.otherB.box });
    const fields = [d.antiplatelet, d.antiplateletB, d.anticoag, rest];
    expect(bracketOwner(rest, fields)).toMatchObject({ owner: d.anticoag, rest: true });
    expect(cells(rowsOf("p-01"), mapping(fields)).get(rest.id)!.kind).toBe("empty");
    expect(cellLines(cells(rowsOf("p-04"), mapping(fields)).get(rest.id)!).join("")).not.toBe("");
  });

  it("種類の無い項目（アレルギー）の並びの終わりは空ける", () => {
    const allergy = SEED_PEOPLE.find((p) => (p.ledger.medical.allergies ?? []).length > 0)!.person.id;
    const check = field({ label: "アレルギー", shape: "check", item: "medical.allergies", box: box(0.127, 0.471, 0.013, 0.009) });
    const rest = field({ label: "その他（　）", item: "medical.allergies", box: box(0.3, 0.469, 0.5) });
    expect(cells(rowsOf(allergy), mapping([check, rest])).get(rest.id)!.kind).toBe("empty");
  });
});

describe("T164 選択肢の括弧は親の選ぶ欄の添えの置き場", () => {
  const optionBoxes = [box(0.61, 0.266, 0.008, 0.008), box(0.7, 0.266, 0.008, 0.008), box(0.8, 0.266, 0.008, 0.008)];
  const means = () => field({ label: "【手段】", shape: "choice", item: "evacuation.transport", options: ["徒歩", "車", "その他"], optionBoxes, box: box(0.6, 0.262, 0.325, 0.015) });
  const otherB = () => field({ label: "その他（　）", item: "evacuation.transport", box: box(0.815, 0.264, 0.105, 0.011) });

  it("括弧の欄は自分で手段の値を書かず、親のその他の中身を括弧の枠に置く（前は括弧に値を丸ごと、親は置けなかった）", () => {
    // 送迎の人（p-05）は「その他」に中身
    const p = means();
    const b = otherB();
    const m = mapping([p, b]);
    const mapped = buildMappedSheet(rowsOf("p-05"), m, OPTS);
    const c = new Map(mapped.pages.flatMap((pg) => pg.sections.flatMap((s) => s.rows.map((r) => [r.field.id, r.cell] as const))));
    expect(c.get(b.id)!.kind).toBe("empty");
    const sheet = buildOverlaySheet(mapped, [image]);
    expect(sheet.unplacedIds ?? []).toEqual([]);
    const placed = sheet.pages[0].items.filter((i) => i.kind === "text");
    expect(placed.length).toBeGreaterThan(0);
    for (const t of placed) expect(t.fieldId).toBe(b.id);
    const marks = sheet.pages[0].items.filter((i) => i.kind === "mark");
    expect(marks.map((x) => x.box)).toEqual([optionBoxes[2]]);
    const look = checkLook(sheet, m.fields, [image]);
    expect([look.overlap, look.outside, look.neighbor]).toEqual([0, 0, 0]);
    const gaps = annexGaps(sheet);
    expect([gaps.noMark, gaps.noRow]).toEqual([[], []]);
  });

  it("その他に当たらない人（徒歩、p-08）は括弧を空ける", () => {
    const p = means();
    const b = otherB();
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf("p-08"), mapping([p, b]), OPTS), [image]);
    expect(sheet.pages[0].items.filter((i) => i.kind === "text")).toEqual([]);
    expect(sheet.pages[0].items.filter((i) => i.kind === "mark").map((x) => x.box)).toEqual([optionBoxes[0]]);
  });
});
