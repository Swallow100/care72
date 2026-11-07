// T181: 読み取りの後の決まり（lib/forms/read-settle.ts・lone-mark.ts）で紙から字が黙って消える形。事業所が上げた様式を読んだ形を
// 架空の欄と種の人で組み、紙の印と字を見る（原本の絵・評価の記録は使わない）。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { checkReadResult, type FieldBox, type FormMapping, type LedgerItemKey } from "./mapping.ts";
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
