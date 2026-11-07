// T181: 読み取りの後の決まり（lib/forms/read-settle.ts・lone-mark.ts）で紙から字が黙って消える形。事業所が上げた様式を読んだ形を
// 架空の欄と種の人で組み、紙の印と字を見る（原本の絵・評価の記録は使わない）。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { InkBlob } from "./ink.ts";
import { splitLoneMarks } from "./lone-mark.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { checkReadResult, type FieldBox, type FormMapping, type LedgerItemKey, type MappingField } from "./mapping.ts";
import { buildOverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";

const OPTS = { today: "2026-11-07", officeName: "デモ事業所" };
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const image: PageImage = { page: 1, width: 2100, height: 2970, bytes: 1 };
const box = (x: number, y: number, w: number, h: number): FieldBox => ({ x, y, w, h });

/** 読み取りの答えの欄（AI の返す形） */
type ReadField = { page: number; section: string; label: string; shape: string; item: LedgerItemKey | null; box: FieldBox; options?: string[]; option_boxes?: FieldBox[] };
const fld = (o: Partial<ReadField> & Pick<ReadField, "label" | "shape" | "item" | "box">) => ({
  page: 1,
  section: "医療",
  position: "",
  options: [],
  candidate: null,
  confidence: "high",
  reason: "読み",
  option_boxes: [],
  ...o,
});
const read = (fields: ReturnType<typeof fld>[], pages = 1): FormMapping => checkReadResult({ title: "架空の様式", issuer: "", pages, typeface: "gothic", fields } as never).mapping;

/** 紙の印の x と字 */
function paper(m: FormMapping, id: string) {
  const sheet = buildOverlaySheet(buildMappedSheet(seedRows(seed(id)), m, OPTS), [image]);
  const items = sheet.pages.flatMap((p) => p.items);
  return {
    marks: items.filter((i) => i.kind === "mark").map((i) => Number(i.box.x.toFixed(2))),
    texts: items.flatMap((i) => (i.kind === "text" ? i.lines : [])),
    unplaced: sheet.unplacedIds ?? [],
    annex: sheet.annex.flatMap((a) => a.lines),
  };
}
const itemOf = (m: FormMapping, label: string) => m.fields.find((f) => f.label === label)?.item;

// アレルギーのある人（p-03）と無い人（p-01）
const ALLERGY: readonly string[] = seed("p-03").ledger?.medical.allergies ?? [];
const allergies = "medical.allergies" as const;

describe("T181 1 □ と同じ行の空きの欄を、ほかに値を書く欄が無ければ外さない", () => {
  const yes = fld({ label: "あり", shape: "check", item: allergies, box: box(0.3, 0.3, 0.012, 0.01) });
  const no = fld({ label: "なし", shape: "check", item: allergies, box: box(0.2, 0.3, 0.012, 0.01) });
  const slot = fld({ label: "病名（　　）", shape: "text", item: allergies, box: box(0.4, 0.297, 0.4, 0.016) });

  it("□ あり 1 つと「病名（　　）」: 空きの欄に項目が残り、アレルギーの名前が紙に出る", () => {
    expect(ALLERGY.length).toBeGreaterThan(0);
    const m = read([yes, slot]);
    expect(itemOf(m, "病名（　　）")).toBe(allergies);
    const p = paper(m, "p-03");
    expect(p.marks).toEqual([0.3]);
    expect(p.texts.join("")).toContain(ALLERGY[0]);
    expect(paper(m, "p-01").texts).toEqual([]);
  });

  it("□ なし・あり の並びと「病名（　　）」も同じ（並びをまとめる所でも外さない）", () => {
    const m = read([no, yes, slot]);
    expect(itemOf(m, "病名（　　）")).toBe(allergies);
    const p = paper(m, "p-03");
    expect(p.marks).toEqual([0.3]);
    expect(p.texts.join("")).toContain(ALLERGY[0]);
    expect(paper(m, "p-01")).toMatchObject({ marks: [0.2], texts: [], unplaced: [] });
  });

  it("同じ頁・同じ項目で値を書く字の欄がほかにあれば、今までどおり外す", () => {
    const wide = fld({ label: "アレルギーの内容", shape: "lines", item: allergies, box: box(0.2, 0.4, 0.6, 0.05) });
    const m = read([yes, slot, wide]);
    expect(itemOf(m, "病名（　　）")).toBeNull();
    expect(itemOf(m, "アレルギーの内容")).toBe(allergies);
    expect(paper(m, "p-03").texts.join("")).toContain(ALLERGY[0]);
  });

  it("親が種類の並び（手帳の種類）の空き「（部位　）」は、ほかに書く欄が無くても今までどおり外す（種類の添えの所に値を丸ごと書かない）", () => {
    const handbook = "care.handbook" as const;
    const kinds = fld({ section: "制度", label: "手帳", shape: "choice", item: handbook, options: ["身体", "療育", "精神"], box: box(0.12, 0.11, 0.34, 0.05), option_boxes: [box(0.12, 0.115, 0.01, 0.01), box(0.32, 0.115, 0.01, 0.01), box(0.12, 0.14, 0.01, 0.01)] });
    const part = fld({ section: "制度", label: "（部位　）", shape: "text", item: handbook, box: box(0.27, 0.115, 0.045, 0.02) });
    expect(itemOf(read([kinds, part]), "（部位　）")).toBeNull();
  });
});

describe("T181 3 同じ項目の字の欄の組は同じ頁の中だけ", () => {
  const text = (o: Partial<ReadField> & Pick<ReadField, "label" | "item" | "box" | "page">) => fld({ section: "", shape: "text", ...o });

  it("頁の頭の氏名が頁ごとに名前と場所が違っても、2 頁目の欄は外さない", () => {
    const m = read([text({ page: 1, section: "本人", label: "氏名", item: "person.name", box: box(0.2, 0.15, 0.3, 0.02) }), text({ page: 2, label: "利用者名", item: "person.name", box: box(0.6, 0.04, 0.2, 0.015) })], 2);
    expect(m.fields.map((f) => [f.page, f.item])).toEqual([
      [1, "person.name"],
      [2, "person.name"],
    ]);
  });

  it("1 頁の作成日（日付の形）と 2 頁の記入日（字の欄）も両方残す", () => {
    const m = read([fld({ page: 1, section: "", label: "作成日", shape: "date", item: "plan.date", box: box(0.7, 0.05, 0.2, 0.015) }), text({ page: 2, label: "記入日", item: "plan.date", box: box(0.1, 0.9, 0.2, 0.015) })], 2);
    expect(m.fields.map((f) => f.item)).toEqual(["plan.date", "plan.date"]);
  });

  it("同じ頁の 2 つ目は今までどおり外す。日付の欄の項目を別の頁の日付でない字の欄に当てた読みも外す（T176）", () => {
    const m = read([text({ page: 1, label: "必ず持ち出す物", item: "evacuation.carryItems", box: box(0.5, 0.1, 0.4, 0.2) }), text({ page: 1, label: "持ち出し品", item: "evacuation.carryItems", box: box(0.5, 0.5, 0.05, 0.02) })]);
    expect(m.fields.map((f) => f.item)).toEqual(["evacuation.carryItems", null]);
    const n = read([fld({ page: 1, section: "", label: "生年月日", shape: "date", item: "person.birth", box: box(0.3, 0.2, 0.4, 0.014) }), text({ page: 2, label: "識別番号", item: "person.birth", box: box(0.3, 0.9, 0.6, 0.014) })], 2);
    expect(n.fields.map((f) => f.item)).toEqual(["person.birth", null]);
  });
});

describe("T181 2 「□なし □あり（　）」の括弧の中に値を書く", () => {
  const no = fld({ label: "なし", shape: "check", item: allergies, box: box(0.3, 0.3, 0.012, 0.01) });
  const yes = fld({ label: "あり", shape: "check", item: allergies, box: box(0.4, 0.3, 0.012, 0.01) });
  const bracket = (item: LedgerItemKey | null = allergies) => fld({ label: "あり（　）", shape: "text", item, box: box(0.44, 0.297, 0.4, 0.016) });

  it("□ 2 つと括弧に読んだ形: 括弧は外さず（選ぶ欄の あり の子）、あり の人は括弧に名前、なし の人は なし に印だけ", () => {
    const m = read([no, yes, bracket()]);
    expect(m.fields.map((f) => [f.shape, f.item])).toEqual([
      ["choice", allergies],
      ["text", allergies],
    ]);
    const p = paper(m, "p-03");
    expect(p.marks).toEqual([0.4]);
    expect(p.texts.join("")).toContain(ALLERGY[0]);
    expect(p.unplaced).toEqual([]);
    expect(paper(m, "p-01")).toMatchObject({ marks: [0.3], texts: [], unplaced: [] });
  });

  it("選ぶ欄 1 つと括弧に読んだ形も同じ紙", () => {
    const choice = fld({ label: "アレルギー", shape: "choice", item: allergies, options: ["なし", "あり"], box: box(0.3, 0.3, 0.55, 0.016), option_boxes: [box(0.3, 0.3, 0.012, 0.01), box(0.4, 0.3, 0.012, 0.01)] });
    const m = read([choice, bracket()]);
    const p = paper(m, "p-03");
    expect(p.marks).toEqual([0.4]);
    expect(p.texts.join("")).toContain(ALLERGY[0]);
    expect(paper(m, "p-01")).toMatchObject({ marks: [0.3], texts: [] });
  });

  it("あり・なし でない選択肢の括弧（その他（　））は今までどおり選ぶ欄の添えの置き場（値を丸ごと書かない）", () => {
    const transport = "evacuation.transport" as const;
    const marks = ["徒歩", "車いす", "その他"].map((l, i) => fld({ section: "避難", label: l, shape: "check", item: transport, box: box(0.2 + i * 0.12, 0.3, 0.012, 0.01) }));
    const other = fld({ section: "避難", label: "その他（　）", shape: "text", item: transport, box: box(0.51, 0.297, 0.2, 0.016) });
    const m = read([...marks, other]);
    expect(m.fields.map((f) => [f.shape, f.item])).toEqual([
      ["choice", transport],
      ["text", transport],
    ]);
    // 徒歩の人は 徒歩 の □ に印だけ
    expect(paper(m, "p-08")).toMatchObject({ marks: [0.2], texts: [], unplaced: [] });
  });
});

describe("T181 5 □ を 1 つ読み落とした行の □ 1 つを分けるのは、□ と括弧の間の名前が 1 つの時だけ", () => {
  const IMAGE = { w: 210, h: 297 };
  const mark = (x: number): InkBlob => ({ x, y: 0.31, w: 0.016, h: 0.011, box: true });
  const glyph = (x: number): InkBlob => ({ x, y: 0.31, w: 0.012, h: 0.011, box: false });
  const rule = (x: number): InkBlob => ({ x, y: 0.3, w: 0.001, h: 0.03, box: false, line: true });
  const near = (b: InkBlob): FieldBox => ({ x: b.x + 0.002, y: b.y + 0.001, w: 0.013, h: 0.01 });
  const A = mark(0.3);
  const B = mark(0.42);
  const field = (over: Partial<MappingField>): MappingField => ({ id: "f0", page: 1, section: "住まい", label: "欄", position: "", shape: "text", options: [], item: null, removed: false, ai: null, ...over });
  const lone = field({ id: "f1", label: "木造", shape: "check", item: "basic.housing.structure", box: near(A), ai: { item: "basic.housing.structure", confidence: "medium", reason: "r", box: near(A) } });
  const bracket = field({ id: "f2", label: "その他（　）", box: { x: 0.545, y: 0.308, w: 0.13, h: 0.014 } });
  const pages = (ink: InkBlob[]) => new Map([[1, { ink, image: IMAGE }]]);

  it("「□木造 □鉄骨造 その他（　）」で 鉄骨造 の □ を読み落とした形は分けない（鉄骨造 の □ を その他 と呼ばない）", () => {
    // 木造 / 鉄骨造 / その他 の字。その他 には □ が無い
    const ink = [A, B, glyph(0.32), glyph(0.335), glyph(0.44), glyph(0.455), glyph(0.47), glyph(0.495), glyph(0.51), glyph(0.525), rule(0.2), rule(0.9)];
    expect(splitLoneMarks([lone, bracket], pages(ink))).toEqual([lone, bracket]);
  });

  it("名前の字が 1 つの塊なら今までどおり分ける（T179 の形）", () => {
    const ink = [A, B, glyph(0.32), glyph(0.335), glyph(0.44), glyph(0.455), glyph(0.47), rule(0.2), rule(0.9)];
    const b = { ...bracket, box: { x: 0.49, y: 0.308, w: 0.13, h: 0.014 } };
    expect(splitLoneMarks([lone, b], pages(ink))[0]).toMatchObject({ shape: "choice", options: ["木造", "その他"] });
  });

  it("2 つに割れた字（「他」）と括弧の前の細い「（」は名前の塊を分けない（松山市の 2 頁の刷りの形）", () => {
    const g = (x: number, w: number): InkBlob => ({ x, y: 0.31, w, h: 0.011, box: false });
    const ink = [A, B, glyph(0.32), glyph(0.335), g(0.44, 0.014), g(0.456, 0.015), g(0.473, 0.005), g(0.477, 0.011), g(0.508, 0.004), rule(0.2), rule(0.9)];
    const b = { ...bracket, box: { x: 0.515, y: 0.308, w: 0.13, h: 0.014 } };
    expect(splitLoneMarks([lone, b], pages(ink))[0]).toMatchObject({ shape: "choice", options: ["木造", "その他"] });
  });
});

describe("T181 6 災害の種類ごとに あり・なし の行が並ぶ様式", () => {
  const hazards = "evacuation.hazards" as const;
  const rows: Array<[string, number]> = [
    ["洪水浸水想定区域", 0.3],
    ["土砂災害警戒区域", 0.33],
    ["津波浸水想定区域", 0.36],
  ];
  const m = () =>
    read(
      rows.map(([label, y]) =>
        fld({ section: "自宅のリスク", label, shape: "choice", item: hazards, options: ["あり", "なし"], box: box(0.5, y, 0.2, 0.015), option_boxes: [box(0.5, y, 0.01, 0.01), box(0.6, y, 0.01, 0.01)] }),
      ),
    );
  /** 行ごとの印（あり・なし・空） */
  const marks = (id: string) => {
    const sheet = buildMappedSheet(seedRows(seed(id)), m(), OPTS);
    return sheet.pages.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => (r.cell.kind === "choice" ? (r.cell.options.find((o) => o.on)?.label ?? "") : r.cell.kind))));
  };
  const kindsOf = (id: string) => (seed(id).ledger?.evacuation.hazards ?? []).map((h) => h.kind);

  it("種類の言葉の行は外さない", () => {
    expect(m().fields.map((f) => f.item)).toEqual([hazards, hazards, hazards]);
  });

  it("行ごとに、その種類が台帳にあれば あり、無ければ なし（ほかの種類の人の行に あり を付けない）", () => {
    const want = (k: string[]) => [k.includes("flood") ? "あり" : "なし", k.includes("landslide") ? "あり" : "なし", k.includes("tsunami") ? "あり" : "なし"];
    const tried = new Set<string>();
    for (const p of SEED_PEOPLE) {
      const k = kindsOf(p.person.id);
      if (seed(p.person.id).ledger?.pending.some((x) => x.field.startsWith("evacuation.hazards"))) continue;
      expect(marks(p.person.id), p.person.id).toEqual(want(k));
      tried.add(k.join(","));
    }
    // 洪水の人・土砂の人・津波の人のどれも見た
    for (const k of ["flood", "landslide", "tsunami"]) expect([...tried].some((t) => t.split(",").includes(k)), k).toBe(true);
  });

  it("種類の言葉でない あり・なし の選ぶ欄は今までどおり 1 つ（2 つ目を外す）", () => {
    const a = fld({ section: "手帳", label: "手帳の有無", shape: "choice", item: "care.handbook", options: ["あり", "なし"], box: box(0.5, 0.3, 0.2, 0.015), option_boxes: [box(0.5, 0.3, 0.01, 0.01), box(0.6, 0.3, 0.01, 0.01)] });
    const b = fld({ section: "手帳", label: "交付", shape: "choice", item: "care.handbook", options: ["あり", "なし"], box: box(0.5, 0.33, 0.2, 0.015), option_boxes: [box(0.5, 0.33, 0.01, 0.01), box(0.6, 0.33, 0.01, 0.01)] });
    expect(read([a, b]).fields.map((f) => f.item)).toEqual(["care.handbook", null]);
  });
});

describe("T181 4 まとめた選ぶ欄の枠は括弧まで、名前は □ の名前", () => {
  const transport = "evacuation.transport" as const;
  const marks = ["徒歩", "車いす", "その他"].map((l, i) => fld({ section: "避難", label: l, shape: "check", item: transport, box: box(0.2 + i * 0.12, 0.3, 0.012, 0.01) }));
  const other = (item: LedgerItemKey | null) => fld({ section: "避難", label: "その他（　）", shape: "text", item, box: box(0.51, 0.297, 0.2, 0.016) });
  // 補記（娘の車）のある人
  const who = "p-01";

  it("「その他（　）」の中身は括弧の中に（置けない欄にしない）。括弧の欄の項目が同じでも項目なしでも同じ紙", () => {
    const note = seed(who).ledger?.evacuation.transport ?? "";
    expect(note).not.toBe("");
    for (const item of [transport, null]) {
      const m = read([...marks, other(item)]);
      const choice = m.fields[0];
      expect(choice).toMatchObject({ shape: "choice", label: "徒歩・車いす・その他", options: ["徒歩", "車いす", "その他"] });
      // 枠は □ の並びと括弧を含む
      const b = choice.box!;
      expect(b.x + b.w).toBeCloseTo(0.71, 6);
      const p = paper(m, who);
      expect(p.marks).toEqual([0.44]);
      expect(p.texts.join("")).toContain(note);
      expect(p.unplaced).toEqual([]);
    }
  });

  it("段の名前を欄の名前にしない（置けない欄の名前が「避難 避難」にならない）", () => {
    const m = read(marks);
    expect(m.fields[0].label).toBe("徒歩・車いす・その他");
  });
});
