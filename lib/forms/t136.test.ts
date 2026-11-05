// T136 書類の紙を作ったあとの見直し（決まりの見直し）。手で組んだ紙と、種の 10 人の原本の枠の紙で確かめる。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { kirokuFrameSheet, matsuyamaFrameSheet } from "./frame-build.ts";
import type { FieldBox } from "./mapping.ts";
import { buildMatsuyamaSheet } from "./matsuyama.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import { ORIGINALS, type OriginalManifest } from "./originals.ts";
import type { OverlayItem, OverlaySheet } from "./overlay-sheet.ts";
import { seedRows } from "./print-harness.ts";
import { dateProblem, kirokuSubject, matsuyamaSubject, reviewCount, ruleReview, sheetHash, type ReviewField, type ReviewSubject } from "./review.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const manifest = (id: "matsuyama" | "kiroku"): OriginalManifest => ({
  id,
  sha256: ORIGINALS[id].sha256,
  pages: ORIGINALS[id].usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-05T00:00:00.000Z",
});

const IMAGE = { x: 0, y: 0, w: 210, h: 297 };
/** mm の矩形を頁の比に */
const box = (x: number, y: number, w: number, h: number): FieldBox => ({ x: x / 210, y: y / 297, w: w / 210, h: h / 297 });
const text = (fieldId: string, b: FieldBox, lines: string[], fontPt = 10, extra: Partial<Extract<OverlayItem, { kind: "text" }>> = {}): OverlayItem => ({
  kind: "text",
  fieldId,
  box: b,
  lines,
  fontPt,
  top: false,
  ...extra,
});
const field = (id: string, label: string, b: FieldBox | null, extra: Partial<ReviewField> = {}): ReviewField => ({
  id,
  label,
  page: 1,
  box: b,
  shape: "text",
  options: [],
  source: `src.${id}`,
  state: "value",
  values: [],
  marked: [],
  self: false,
  ...extra,
});
function subject(fields: ReviewField[], items: OverlayItem[], extra: Partial<OverlaySheet> = {}, redoable = true): ReviewSubject {
  const sheet: OverlaySheet = {
    personId: "p-x",
    name: "x",
    title: "様式",
    issuer: "",
    typeface: "gothic",
    pages: [{ page: 1, landscape: false, image: IMAGE, items, fills: [] }],
    annex: [],
    unconfirmed: [],
    unmapped: [],
    withheld: [],
    ...extra,
  };
  const ids = new Set(fields.map((f) => f.id));
  return { sheet, fields, fieldOf: (id) => (ids.has(id) ? id : null), redoable };
}
const kinds = (s: ReviewSubject) => ruleReview(s).map((f) => `${f.kind}:${f.field}`);

describe("決まりの見直し（手で組んだ紙）", () => {
  it("置いた字どうしが重なれば重なり、矩形からはみ出せば枠外、下限の字は下限", () => {
    const a = box(10, 10, 60, 6);
    const b = box(40, 10, 60, 6);
    const s = subject([field("f1", "氏名", a), field("f2", "住所", b)], [text("f1", a, ["あいうえおかきくけこさしすせそ"], 9), text("f2", b, ["たちつてと"], 9)]);
    expect(kinds(s)).toContain("overlap:f1");
    const small = box(10, 30, 20, 4);
    const s2 = subject([field("f3", "備考", small)], [text("f3", small, ["とても長い値がここに入って枠を出る"], 6)]);
    const got = kinds(s2);
    expect(got).toContain("overflow:f3");
    expect(got).toContain("small:f3");
  });

  it("離れた字は重ならない。別の欄の □ の上の字は重なり", () => {
    const a = box(10, 10, 40, 6);
    const b = box(10, 20, 40, 6);
    expect(kinds(subject([field("f1", "氏名", a), field("f2", "住所", b)], [text("f1", a, ["山田"]), text("f2", b, ["松山"])]))).toEqual([]);
    const choice = field("f3", "性別", box(10, 40, 30, 6), { shape: "choice", options: ["男", "女"], optionBoxes: [box(12, 41, 3, 3), box(22, 41, 3, 3)] });
    const t = box(10, 40, 30, 6);
    expect(kinds(subject([field("f4", "続柄", t), choice], [text("f4", t, ["長男長男長男"])]))).toContain("overlap:f4");
  });

  it("紙の伏字・本人が書く欄・同じ値・別紙の印", () => {
    const b1 = box(10, 10, 80, 6);
    const b2 = box(10, 20, 80, 6);
    const b3 = box(10, 30, 80, 6);
    const yes = box(100, 100, 3, 3);
    const no = box(110, 100, 3, 3);
    const s = subject(
      [
        field("f1", "特記", b1),
        field("f2", "本人署名", b2, { self: true, shape: "handwrite", source: null, state: "handwrite" }),
        field("f3", "避難先1", b3),
        field("f4", "避難先2", box(10, 40, 80, 6)),
        field("f5", "別紙", box(100, 100, 20, 3), { shape: "choice", options: ["あり", "なし"], optionBoxes: [yes, no] }),
      ],
      [
        text("f1", b1, ["（氏名）が来る"]),
        text("f2", b2, ["山田 太郎"]),
        text("f3", b3, ["松山市立第一小学校"]),
        text("f4", box(10, 40, 80, 6), ["松山市立第一小学校"]),
        { kind: "mark", fieldId: "f5", box: yes, mark: "check" },
      ],
    );
    const got = kinds(s);
    expect(got).toContain("masked:f1");
    expect(got).toContain("signature:f2");
    expect(got).toContain("duplicate:f4");
    expect(got).not.toContain("duplicate:f3");
    expect(got).toContain("annex:f5");
    // 本人が書く欄が空なら参考（数に入れない）
    const blankSign = subject([field("f2", "本人署名", b2, { self: true, shape: "handwrite", state: "handwrite" })], []);
    const f = ruleReview(blankSign);
    expect(f.map((x) => x.kind)).toEqual(["self"]);
    expect(reviewCount(f)).toBe(0);
  });

  it("日付: 年月日の部品のある欄に 1 つで置いた・元号・範囲", () => {
    const b = box(10, 10, 80, 6);
    const parts = [box(20, 10, 10, 6), box(40, 10, 10, 6), box(60, 10, 10, 6)];
    const date = field("f1", "生年月日", b, { shape: "date", options: ["年", "月", "日"], optionBoxes: parts, values: ["昭和17年4月18日"] });
    expect(kinds(subject([date], [text("f1", b, ["昭和17年4月18日"])]))).toContain("date:f1");
    // 部品ごとに置いた紙は問題なし
    const placedParts = parts.map((p, i) => text("f1", p, [["17", "4", "18"][i]], 10, { part: i }));
    expect(kinds(subject([date], placedParts))).toEqual([]);
    expect(dateProblem("昭和70年1月1日", [])).toMatch(/範囲外/);
    expect(dateProblem("令和8年13月1日", [])).toMatch(/範囲外/);
    expect(dateProblem("1942-04-18", ["大正", "昭和"])).toMatch(/西暦/);
    expect(dateProblem("平成3年2月30日", ["昭和", "平成"])).toMatch(/範囲外/);
    expect(dateProblem("明治40年1月1日", ["昭和", "平成"])).toMatch(/元号/);
    expect(dateProblem("昭和17年4月18日", ["大正", "昭和"])).toBeNull();
  });

  it("場所の無い欄の値は未配置（対応表の紙だけ再考の印）、空欄は参考", () => {
    const s = subject([field("f1", "携帯", null)], [], {
      annex: [{ fieldId: "f1", label: "携帯", lines: ["090-0000-0001"], reason: "unplaced" }],
      pages: [{ page: 1, landscape: false, image: IMAGE, items: [], fills: [{ keys: ["f1"], box: box(1, 1, 1, 1) }] }],
    });
    const got = ruleReview(s);
    expect(got.find((f) => f.kind === "unplaced")?.redo).toBe(true);
    expect(got.find((f) => f.kind === "blank")?.level).toBe("note");
    const frame = subject([field("f1", "携帯", null)], [], { annex: [{ fieldId: "f1", label: "携帯", lines: ["x"], reason: "unplaced" }] }, false);
    expect(ruleReview(frame).map((f) => f.kind)).toEqual(["spill"]);
  });
});

describe("決まりの見直し（種の 10 人の原本の枠の紙）", () => {
  const people = SEED_PEOPLE.filter((p) => p.person.office_id === SEED_PEOPLE[0].person.office_id);

  it("計画書・医療要約: 伏字と署名欄の記入は 0、紙の版は同じ紙で同じ", async () => {
    const counts: Record<string, number> = {};
    for (const p of people) {
      const rows = seedRows(p);
      const ms = buildMatsuyamaSheet(rows, OPTS);
      const framed = matsuyamaFrameSheet(ms, manifest("matsuyama"));
      const found = ruleReview(matsuyamaSubject(ms, framed));
      const med = buildMedicalSummary(rows, OPTS);
      const k = med.kind === "sheet" ? ruleReview(kirokuSubject(med.sheet, kirokuFrameSheet(med.sheet, manifest("kiroku")))) : [];
      for (const f of [...found, ...k]) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      expect(found.filter((f) => f.kind === "masked" || f.kind === "signature")).toEqual([]);
      expect(k.filter((f) => f.kind === "masked" || f.kind === "signature")).toEqual([]);
      // 本人の自署の欄は残り（参考）
      expect(found.some((f) => f.kind === "self" && f.field === "sign.self")).toBe(true);
      expect(await sheetHash(framed)).toBe(await sheetHash(matsuyamaFrameSheet(buildMatsuyamaSheet(rows, OPTS), manifest("matsuyama"))));
    }
    // 数は進みに書く（種の紙で何が出るか）
    console.info("T136 種の 10 人の決まりの見直し", JSON.stringify(counts));
  });
});
