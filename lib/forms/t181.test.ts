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
const read = (fields: ReturnType<typeof fld>[], pages = 1): FormMapping => checkReadResult({ title: "架空の様式", issuer: "", pages, typeface: "gothic", fields }).mapping;

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
const ALLERGY = seed("p-03").ledger!.medical.allergies;
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
