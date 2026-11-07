// T179: 選択肢の並びを □ 1 つに読んだ形（評価の 11 回目の住居の構造）を、印刷の字の位置から選ぶ欄に分ける。架空の頁と種の人で確かめる。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { packInk, type InkBlob } from "./ink.ts";
import { splitLoneMarks } from "./lone-mark.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { checkReadResult, type FieldBox, type FormMapping, type MappingField } from "./mapping.ts";
import { buildOverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";
import type { TrailingPage } from "./trailing-field.ts";

const IMAGE = { w: 210, h: 297 };
const mark = (x: number, y = 0.31): InkBlob => ({ x, y, w: 0.016, h: 0.011, box: true });
const glyph = (x: number, y = 0.31): InkBlob => ({ x, y, w: 0.012, h: 0.011, box: false });
const rule = (x: number): InkBlob => ({ x, y: 0.3, w: 0.001, h: 0.03, box: false, line: true });

const field = (over: Partial<MappingField>): MappingField => ({ id: "f0", page: 1, section: "住まい", label: "欄", position: "", shape: "text", options: [], item: null, removed: false, ai: null, ...over });

const near = (b: InkBlob): FieldBox => ({ x: b.x + 0.002, y: b.y + 0.001, w: 0.013, h: 0.01 });
const A = mark(0.3);
const B = mark(0.45);
/** □ 木造 □ その他（　）。「その他」の □ を読まず、括弧の中だけを項目なしの字の欄に読んだ形 */
const lone = (over: Partial<MappingField> = {}) =>
  field({ id: "f1", label: "木造", shape: "check", item: "basic.housing.structure", box: near(A), ai: { item: "basic.housing.structure", confidence: "medium", reason: "構造の種類", box: near(A) }, ...over });
const bracket = (over: Partial<MappingField> = {}) => field({ id: "f2", label: "その他（　）", box: { x: 0.55, y: 0.308, w: 0.13, h: 0.014 }, ...over });
/** 名前の字（□ の右に刷ってある） */
const NAMES = [glyph(0.32), glyph(0.335), glyph(0.47), glyph(0.485), glyph(0.5), glyph(0.515)];
const INK: InkBlob[] = [A, B, ...NAMES, rule(0.2), rule(0.9)];
const page = (ink: InkBlob[] = INK): ReadonlyMap<number, TrailingPage> => new Map([[1, { ink, image: IMAGE }]]);

describe("□ 1 つに読んだ選択肢の並びを分ける", () => {
  it("同じ行の読まれていない □ と右の括弧の欄から、選ぶ欄にする", () => {
    const out = splitLoneMarks([lone(), bracket()], page());
    expect(out.map((f) => f.id)).toEqual(["f1", "f2"]);
    const f = out[0];
    expect(f).toMatchObject({ shape: "choice", options: ["木造", "その他"], item: "basic.housing.structure", label: "木造・その他" });
    expect(f.optionBoxes?.map((b) => b?.x)).toEqual([A.x, B.x]);
    expect(f.ai?.reason).toContain("（補）");
    expect(f.ai?.box).toEqual(f.box);
    // 字の欄はそのまま（選ぶ欄の「その他」の中身の置き場）
    expect(out[1]).toEqual(bracket());
    // □ も括弧も欄の枠の中
    const b = f.box!;
    for (const x of [...f.optionBoxes!, bracket().box!]) {
      expect(x!.x).toBeGreaterThanOrEqual(b.x);
      expect(x!.x + x!.w).toBeLessThanOrEqual(b.x + b.w + 1e-9);
    }
  });

  it("欄の名前に当てない（別の項目の並びでも同じ）", () => {
    const out = splitLoneMarks([lone({ label: "戸建", item: "basic.housing.type" }), bracket()], page());
    expect(out[0]).toMatchObject({ shape: "choice", options: ["戸建", "その他"] });
  });

  it("読み直した頁だけに当てる（only）", () => {
    expect(splitLoneMarks([lone(), bracket()], page(), new Set([2]))[0].shape).toBe("check");
  });

  describe("確かに分けられない時は今のまま", () => {
    const same = (fields: MappingField[], ink: InkBlob[] = INK) => expect(splitLoneMarks(fields, page(ink))).toEqual(fields);

    it("印刷の字の位置が無い", () => {
      const fields = [lone(), bracket()];
      expect(splitLoneMarks(fields, new Map())).toEqual(fields);
      expect(splitLoneMarks(fields, new Map([[1, { ink: null, image: IMAGE }]]))).toEqual(fields);
    });
    it("自分の □ が印刷に無い", () => same([lone({ box: { x: 0.1, y: 0.31, w: 0.013, h: 0.01 } }), bracket()]));
    it("同じ行にほかの □ が無い", () => same([lone(), bracket()], [A, ...NAMES]));
    it("読まれていない □ が 2 つで、名前の元が 1 つ", () => same([lone(), bracket()], [...INK, mark(0.38)]));
    it("読まれていない □ の名前の元が無い", () => same([lone()]));
    it("右の欄に項目がある", () => same([lone(), bracket({ item: "notes.other" })]));
    it("右の欄が括弧の欄でない", () => same([lone(), bracket({ label: "備考" })]));
    it("□ と括弧の間に縦の罫線がある（別の枠）", () => same([lone(), bracket()], [...INK, rule(0.53)]));
    it("□ と括弧が離れすぎている（括弧の前の名前の字の幅でない）", () => same([lone(), bracket({ box: { x: 0.8, y: 0.308, w: 0.09, h: 0.014 } })], [...INK, glyph(0.7)]));
    it("□ と括弧の間に名前の字が無い", () => same([lone(), bracket()], [A, B, glyph(0.32), rule(0.2), rule(0.9)]));
    it("間の □ がほかの欄の □", () => same([lone(), field({ id: "f3", label: "他", shape: "check", item: null, box: near(B) }), bracket()]));
    it("同じ頁に同じ項目の欄がある", () => same([lone(), bracket(), field({ id: "f3", label: "構造", item: "basic.housing.structure", box: { x: 0.3, y: 0.5, w: 0.3, h: 0.02 } })]));
    it("□ の名前が項目の種類に当たらない", () => same([lone({ label: "木の家" }), bracket()]));
    it("□ の名前が「その他」", () => same([lone({ label: "その他" }), bracket()]));
    it("項目が値の表を持たない", () => same([lone({ label: "木造", item: "notes.other" }), bracket()]));
    it("種類ごとの □ の項目（読み取りの決まり 12 の例外）", () => same([lone({ label: "在宅酸素", item: "medical.devices" }), bracket()]));
    it("字の欄は当たらない", () => same([lone({ shape: "text" }), bracket()]));
    it("外した欄は当たらない", () => same([lone({ removed: true }), bracket()]));
  });

  it("ほかの欄で切る: 左の選ぶ欄の □ は混ぜない", () => {
    const left = mark(0.22);
    const choice = field({ id: "f9", label: "種別", shape: "choice", options: ["甲", "乙"], item: "basic.housing.type", box: { x: 0.21, y: 0.305, w: 0.08, h: 0.02 }, optionBoxes: [near(left), null] });
    const out = splitLoneMarks([choice, lone(), bracket()], page([...INK, left]));
    expect(out[0]).toEqual(choice);
    expect(out[1].options).toEqual(["木造", "その他"]);
  });
});

describe("分けた形の紙", () => {
  const TODAY = "2026-11-07";
  const pageImage = (ink: InkBlob[]): PageImage => ({ page: 1, width: 1413, height: 2000, bytes: 1, ink: packInk(ink) });
  const rowsWith = (structure: "wood" | "steel") => {
    const p = SEED_PEOPLE[0];
    return seedRows({ ...p, ledger: { ...p.ledger, basic: { ...p.ledger.basic, housing: { ...p.ledger.basic.housing, structure } } } });
  };
  const paper = (fields: MappingField[], structure: "wood" | "steel") => {
    const mapping: FormMapping = { title: "架空の様式", issuer: "", pages: 1, fields };
    return buildOverlaySheet(buildMappedSheet(rowsWith(structure), mapping, { today: TODAY, officeName: "デモ事業所" }), [pageImage(INK)]);
  };
  const marksOf = (o: ReturnType<typeof paper>) => o.pages.flatMap((p) => p.items).flatMap((i) => (i.kind === "mark" ? [i] : []));

  it("分ける前は □ に印が付かず、分けたあとは台帳の値の □ に付く", () => {
    expect(marksOf(paper([lone(), bracket()], "wood"))).toEqual([]);
    const on = marksOf(paper(splitLoneMarks([lone(), bracket()], page()), "wood"));
    expect(on.map((m) => m.box.x)).toEqual([A.x]);
  });

  it("選択肢に無い値は「その他」の □。値を別の欄に書かない", () => {
    const o = paper(splitLoneMarks([lone(), bracket()], page()), "steel");
    expect(marksOf(o).map((m) => m.box.x)).toEqual([B.x]);
    expect(o.pages.flatMap((p) => p.items).filter((i) => i.kind === "text")).toEqual([]);
  });

  it("□ 2 つの選ぶ欄に読んだ答えと、紙の印が同じ（読みの形の揺れが紙に効かない）", () => {
    const read = (fields: MappingField[], v: "wood" | "steel") => marksOf(paper(fields, v)).map((m) => m.box.x);
    const choice = field({ id: "f1", label: "種別", shape: "choice", options: ["木造", "その他"], item: "basic.housing.structure", box: { x: 0.29, y: 0.305, w: 0.61, h: 0.02 }, optionBoxes: [A, B] });
    for (const v of ["wood", "steel"] as const) expect(read(splitLoneMarks([lone(), bracket()], page()), v)).toEqual(read([choice, bracket()], v));
  });

  it("読み取りの決まり（checkReadResult）だけでは分けない。印刷の字の位置の無い道は今のまま", () => {
    const { mapping } = checkReadResult({
      title: "架空",
      issuer: "",
      pages: 1,
      typeface: "gothic",
      fields: [
        { page: 1, section: "住まい", label: "木造", position: "", shape: "check", options: [], item: "basic.housing.structure", candidate: null, confidence: "medium", reason: "", box: near(A), option_boxes: [] },
        { page: 1, section: "住まい", label: "その他（　）", position: "", shape: "text", options: [], item: null, candidate: null, confidence: "low", reason: "", box: bracket().box!, option_boxes: [] },
      ],
    });
    expect(mapping.fields[0].shape).toBe("check");
  });
});
