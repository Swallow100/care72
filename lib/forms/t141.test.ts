// T141 評価の 5 回目（書類）で残った物の直し: 2 つの項目を持つ欄・避難先の番号・別紙の中身と印。
// 架空の頁と種の人で確かめる（原本の絵・評価の記録の言葉は使わない）。AI は呼ばない
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { hasSecondCue, orderDestinations } from "../intake/destination-order.ts";
import { EXTRACT_RULES } from "../intake/extract.ts";
import { AI_INTAKE_FIELDS } from "../intake/fields.ts";
import type { ExtractOutput } from "../intake/schema.ts";
import { packInk } from "./ink.ts";
import { buildMappedSheet, pairedItem } from "./mapped-sheet.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { ANNEX_MARK, annexGaps, buildOverlaySheet, cellLines } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";
import { mappedSubject, ruleReview } from "./review.ts";
import { splitParts } from "./split-parts.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const rowsOf = (id: string) => seedRows(seed(id));
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
const mapping = (fields: MappingField[], pages = 1): FormMapping => ({ title: "架空の様式", issuer: "", pages, fields });
const image = (page = 1): PageImage => ({ page, width: 2100, height: 2970, bytes: 1, ink: packInk([]) });
const textOf = (sheet: ReturnType<typeof buildMappedSheet>, id: string): string => {
  for (const p of sheet.pages) for (const s of p.sections) for (const r of s.rows) if (r.field.id === id) return cellLines(r.cell, false).join("／");
  return "";
};

// ---------- 2 つの項目を持つ欄 ----------

describe("2 つの項目を持つ欄（生年月日・年齢 など）", () => {
  it("欄の名前が 2 つの項目の言葉を区切りの字でつなげば、もう 1 つの項目を返す（括弧の中の言葉は組にしない）", () => {
    expect(pairedItem({ item: "person.age", label: "生年月日・年齢" })).toMatchObject({ item: "person.birth", own: "age", second: false });
    expect(pairedItem({ item: "person.birth", label: "生年月日・年齢" })).toMatchObject({ item: "person.age", second: true });
    expect(pairedItem({ item: "person.name", label: "氏名・ふりがな" })).toMatchObject({ item: "person.kana" });
    expect(pairedItem({ item: "basic.address", label: "住所／電話番号" })).toMatchObject({ item: "self.phone" });
    expect(pairedItem({ item: "emergency1.name", label: "緊急連絡先 氏名・続柄" })).toMatchObject({ item: "emergency1.relation" });
    expect(pairedItem({ item: "person.kana", label: "患者氏名（カタカナ）" })).toBeNull();
    expect(pairedItem({ item: "person.birth", label: "生年月日" })).toBeNull();
    expect(pairedItem({ item: "medical.history", label: "既往・年齢" })).toBeNull();
  });

  it("年齢の項目に当てた「生年月日・年齢」の欄にも、生年月日と年齢の両方を決まった並べ方で置く", () => {
    const f = field({ label: "生年月日・年齢", item: "person.age" });
    const text = textOf(buildMappedSheet(rowsOf("p-01"), mapping([f]), OPTS), f.id);
    expect(text).toMatch(/^(明治|大正|昭和|平成|令和)\d+年\d+月\d+日（\d+ ?歳）$/);
  });

  it("「歳」の区切りの空きのある欄は、空きに分けられる並べ方（年・月・日・歳の空きに分かれる）", () => {
    const f = field({ label: "生年月日・年齢", item: "person.birth", shape: "date", options: ["年", "月", "日", "歳"] });
    const text = textOf(buildMappedSheet(rowsOf("p-01"), mapping([f]), OPTS), f.id);
    const parts = splitParts(text, ["年", "月", "日", "歳"]);
    expect(parts).not.toBeNull();
    expect(parts![3]).toMatch(/^\d+$/);
  });

  it("年月日の空きがあり「歳」の空きが無い欄は組にしない（空きに分けると年齢が落ちるので前のまま）", () => {
    const f = field({ label: "生年月日・年齢", item: "person.birth", shape: "date", options: ["年", "月", "日"] });
    expect(textOf(buildMappedSheet(rowsOf("p-01"), mapping([f]), OPTS), f.id)).not.toContain("歳");
  });

  it("氏名・ふりがなの欄は氏名に括弧でふりがな", () => {
    const f = field({ label: "氏名・ふりがな", item: "person.name" });
    const text = textOf(buildMappedSheet(rowsOf("p-01"), mapping([f]), OPTS), f.id);
    expect(text).toContain("（");
    expect(text.split("（")[1]).toMatch(/[ァ-ヶ]/);
  });
});

// ---------- 避難先の番号 ----------

describe("避難先の番号は書類の手がかりで", () => {
  const out = (items: ExtractOutput["items"], notes: string[] = []): ExtractOutput => ({ items, medications: [], devices: [], hazards: [], contacts: [], notes, unknowns: [] });
  const empty = { evacuation: { hazards: [] } } as never;

  it("番号の無い避難先が 2 だけに返り、台帳の 1 が空なら 1 に直す（時間も。作られた 2 の手段は落とす）", () => {
    const r = orderDestinations(
      out([
        { field: "evacuation.destination2", value: "（町名）総合病院" },
        { field: "evacuation.destination2Means", value: "other" },
        { field: "evacuation.destination2Minutes", value: "20" },
      ]),
      empty,
      null,
    );
    expect(r.items).toEqual([
      { field: "evacuation.destination1", value: "（町名）総合病院" },
      { field: "evacuation.destination1Minutes", value: "20" },
    ]);
  });

  it("2 番目の手がかりがあれば 2 のまま。1 も返っている・台帳の 1 がある時も直さない", () => {
    const two = out([{ field: "evacuation.destination2", value: "長女の家" }]);
    expect(orderDestinations(two, empty, "第二の避難先は長女の家。").items[0].field).toBe("evacuation.destination2");
    expect(orderDestinations(two, empty, "2次避難は長女の家").items[0].field).toBe("evacuation.destination2");
    expect(orderDestinations(two, { evacuation: { hazards: [], destination1: "公民館" } } as never, null).items[0].field).toBe("evacuation.destination2");
    const both = out([
      { field: "evacuation.destination1", value: "公民館" },
      { field: "evacuation.destination2", value: "長女の家" },
    ]);
    expect(orderDestinations(both, empty, null)).toBe(both);
    expect(hasSecondCue("避難先：病院")).toBe(false);
    expect(hasSecondCue("事前に避難する先は娘の家")).toBe(true);
  });

  it("読み取りの指示と欄の説明は番号の手がかりで決め、種類では決めない", () => {
    expect(EXTRACT_RULES).toContain("種類（病院・施設・親族の家）だけで 2 にしない");
    const d1 = AI_INTAKE_FIELDS.find((f) => f.key === "evacuation.destination1")!;
    const d2 = AI_INTAKE_FIELDS.find((f) => f.key === "evacuation.destination2")!;
    expect(d1.hint).toContain("番号の無い避難先が 1 つだけ");
    expect(d1.hint).not.toContain("市の指定避難所");
    expect(d2.hint).toContain("第2");
  });
});

// ---------- 別紙の中身と紙の印 ----------

describe("別紙の中身と紙の「別紙」の印", () => {
  // 長い特記を小さな枠に（収まらず別紙へ）
  const notes = field({ label: "特記", item: "medical.notes", shape: "lines", box: { x: 0.1, y: 0.1, w: 0.12, h: 0.012 } });

  it("収まらない値の別紙の行は頁と印の欄を持ち、紙の「別紙」とそろう", () => {
    const mapped = buildMappedSheet(rowsOf("p-02"), mapping([notes]), OPTS);
    const sheet = buildOverlaySheet(mapped, [image()]);
    const rows = sheet.annex.filter((r) => r.reason === "overflow");
    if (rows.length === 0) return; // 種の人に特記が無ければ見ない
    expect(rows[0]).toMatchObject({ page: 1, mark: notes.id });
    expect(annexGaps(sheet)).toEqual({ noMark: [], noRow: [] });
  });

  it("印の無い別紙の行・行の無い印を見つけ、見直しの「別紙相違」に出す", () => {
    const mapped = buildMappedSheet(rowsOf("p-02"), mapping([notes]), OPTS);
    const sheet = buildOverlaySheet(mapped, [image()]);
    const noMark = { ...sheet, pages: sheet.pages.map((p) => ({ ...p, items: p.items.filter((it) => !(it.kind === "text" && it.lines[0] === ANNEX_MARK)) })), annex: [{ fieldId: notes.id, label: "特記", lines: ["x"], reason: "overflow" as const, page: 1, mark: notes.id }] };
    expect(annexGaps(noMark).noMark).toEqual([notes.id]);
    const stray = {
      ...sheet,
      annex: [],
      pages: sheet.pages.map((p) => ({ ...p, items: [...p.items.filter((it) => it.kind !== "text"), { kind: "text" as const, fieldId: notes.id, box: notes.box!, lines: [ANNEX_MARK], fontPt: 8, top: false }] })),
    };
    expect(annexGaps(stray).noRow).toEqual([notes.id]);
    const found = ruleReview(mappedSubject(mapped, stray));
    expect(found.some((x) => x.kind === "annex" && x.field === notes.id)).toBe(true);
  });

  it("別紙の頁は頁・欄・値の 3 列で、頁の順に並べ、欄に別紙と書いた値と欄の無い値を分ける", () => {
    const mapped = buildMappedSheet(rowsOf("p-02"), mapping([notes]), OPTS);
    const sheet = buildOverlaySheet(mapped, [image()]);
    const withRows = {
      ...sheet,
      annex: [
        { fieldId: "b", label: "欄B", lines: ["値B"], reason: "unplaced" as const, page: 2 },
        { fieldId: "a", label: "欄A", lines: ["値A"], reason: "overflow" as const, page: 1, mark: "a" },
      ],
    };
    const html = renderToStaticMarkup(createElement(OverlaySheet, { sheet: withRows, imageSrc: () => "", checked: "" }));
    expect(html).toContain("annex-head");
    expect(html.indexOf("欄A")).toBeLessThan(html.indexOf("欄B"));
    expect(html).toContain("欄に別紙");
    expect(html).toContain("欄なし");
    expect(html).not.toContain("様式に位置の無い欄の値");
  });
});
