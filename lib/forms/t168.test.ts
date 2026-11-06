// T168: 評価の 8 回目の書類で残った物。どれも架空の頁と種の人で確かめる（原本の絵は使わない）。
// 1. 刷ってある小さな字のかけらを電話の区切りと読み、連絡先が置けなかった
// 2. 手段の値が「その他」でも、補記が 1 つの手段を言っていればその手段の □
// 3. □ だけに読んだ欄の中身（アレルギーの物の名前）を書く所が紙に無かった
import { describe, expect, it } from "vitest";
import { packInk, type InkBlob } from "./ink.ts";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { soleCodeOfText } from "./option-values.ts";
import { bracketOwner } from "./form-shape.ts";
import { checkLook } from "./overlay-check.ts";
import { addTrailingFields } from "./trailing-field.ts";
import { annexGaps, buildOverlaySheet, inkPhoneParts, type PlaceCtx } from "./overlay-sheet.ts";
import { buildMappedSheet, type MappedSheet } from "./mapped-sheet.ts";
import { value, t } from "./matsuyama.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";

const IMAGE = { x: 0, y: 0, w: 297, h: 210 };
const W = 1 / IMAGE.w;
const H = 1 / IMAGE.h;
const blob = (xMm: number, yMm: number, wMm: number, hMm: number): InkBlob => ({ x: xMm * W, y: yMm * H, w: wMm * W, h: hMm * H, box: false });
const pc = (ink: InkBlob[], others: PlaceCtx["others"] = []): PlaceCtx => ({ page: { page: 1, landscape: true, image: IMAGE, items: [], fills: [] }, ink, others });

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

/** 欄の左上に刷ってある小さな見出し（「住所・連絡先」の形）の字のかたまり。かけらの中に横に細い物が 2 つある */
const PRINTED_LABEL = (x: number, y: number): InkBlob[] => [
  blob(x + 0.3, y + 0.2, 0.6, 2.1),
  blob(x + 0.9, y + 0.3, 1.5, 1.9),
  blob(x + 2.5, y + 0.3, 0.9, 0.1),
  blob(x + 2.5, y + 0.8, 0.9, 1.3),
  blob(x + 3.4, y + 0.3, 1.0, 1.9),
  blob(x + 5.5, y + 1.1, 0.3, 0.4),
  blob(x + 6.9, y + 0.4, 0.3, 0.3),
  blob(x + 7.4, y + 0.3, 1.3, 1.6),
  blob(x + 6.8, y + 1.2, 2.1, 1.0),
  blob(x + 9.0, y + 0.2, 1.9, 2.1),
  blob(x + 11.1, y + 0.3, 2.1, 1.9),
];

describe("電話の欄の刷ってある区切り", () => {
  const box = { x: 72 * W, y: 167 * H, w: 66 * W, h: 10.5 * H };
  const phone = () => field({ label: "連絡先", shape: "phone", item: "emergency2.phone", box });

  it("見出しの字のかけらを区切りと読まない", () => {
    expect(inkPhoneParts(phone(), ["090-0000-0012"], pc(PRINTED_LABEL(72.5, 167.1)))).toBeNull();
  });

  it("字の間でない本当の「　−　−　」は今までどおり分ける。見出しが一緒に刷ってあっても", () => {
    const dashes = [blob(95, 172, 2.2, 0.4), blob(115, 172, 2.2, 0.4)];
    const items = inkPhoneParts(phone(), ["090-0000-0012"], pc([...PRINTED_LABEL(72.5, 167.1), ...dashes])) as Exclude<ReturnType<typeof inkPhoneParts>, null | "fail">;
    expect(items.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["090", "0000", "0012"]);
  });

  it("高さの違う所にある 2 つの細い印は区切りの組にしない", () => {
    expect(inkPhoneParts(phone(), ["090-0000-0012"], pc([blob(95, 168, 2.2, 0.4), blob(115, 175, 2.2, 0.4)]))).toBeNull();
  });

  it("2 つの区切りの間に字があれば分けない", () => {
    expect(inkPhoneParts(phone(), ["090-0000-0012"], pc([blob(95, 172, 2.2, 0.4), blob(105, 170, 3, 3), blob(115, 172, 2.2, 0.4)]))).toBeNull();
  });

  it("括弧の組: 間に字のある縦の線は括弧にしない", () => {
    const low = { ...box, h: 6 * H };
    const f = field({ label: "電話", shape: "phone", box: low });
    const strokes = [blob(80, 168, 0.5, 2.1), blob(84, 168.1, 1.5, 1.9), blob(90, 168, 0.5, 2.1)];
    expect(inkPhoneParts(f, ["089-000-0001"], pc(strokes))).toBeNull();
    const parens = [blob(80, 168, 0.5, 2.1), blob(90, 168, 0.5, 2.1)];
    const items = inkPhoneParts(f, ["089-000-0001"], pc(parens)) as Exclude<ReturnType<typeof inkPhoneParts>, null | "fail">;
    expect(items.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["089", "000-0001"]);
  });

  it("同じ書く所に別の欄（住所）がある欄は区切りに分けない", () => {
    const dashes = [blob(95, 172, 2.2, 0.4), blob(115, 172, 2.2, 0.4)];
    const f = phone();
    expect(inkPhoneParts(f, ["090-0000-0012"], pc(dashes, [{ id: f.id, box }, { id: "addr", box }]))).toBeNull();
  });

  it("住所と連絡先が 1 つの書く所の欄で、番号が 1 つの人も住所と電話の両方が紙に出る", () => {
    const addr = field({ label: "住所", item: "emergency2.address", box });
    const tel = phone();
    const mapped: MappedSheet = {
      personId: "p",
      name: "架空",
      title: "架空の様式",
      issuer: "",
      pages: [{ page: 1, sections: [{ section: "", rows: [{ field: addr, cell: value([t("松山市 ほたる坂町")]) }, { field: tel, cell: value([t("090-0000-0012")]) }] }] }],
      fields: 2,
      unconfirmed: [],
      unmapped: [],
      withheld: [],
    };
    const image: PageImage = { page: 1, width: 2970, height: 2100, bytes: 1, ink: packInk(PRINTED_LABEL(72.5, 167.1)) };
    const sheet = buildOverlaySheet(mapped, [image]);
    expect(sheet.unplacedIds ?? []).toEqual([]);
    const texts = sheet.pages[0].items.flatMap((i) => (i.kind === "text" ? i.lines : []));
    expect(texts).toContain("090-0000-0012");
    expect(texts).toContain("松山市 ほたる坂町");
  });
});

describe("手段の値が「その他」で補記が 1 つの手段を言う", () => {
  const P = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
  const cellOf = (kind: "other" | "foot", note: string | undefined, options: string[]) => {
    const p = P("p-04");
    const person = { ...p, ledger: { ...structuredClone(p.ledger), evacuation: { ...p.ledger.evacuation, transportKind: kind, transport: note } } };
    const f = field({ label: "【手段】", item: "evacuation.transport", shape: "choice", options });
    const m: FormMapping = { title: "架空の様式", issuer: "", pages: 1, fields: [f] };
    return buildMappedSheet(seedRows(person), m, { today: "2026-11-07", officeName: "デモ事業所" }).pages[0].sections[0].rows[0].cell;
  };
  const on = (c: ReturnType<typeof cellOf>) => (c.kind === "choice" ? c.options.filter((o) => o.on).map((o) => [o.label, o.detail]) : c.kind);

  it("歩いて → 徒歩の □ に印、補記はその選択肢に添える", () => {
    expect(on(cellOf("other", "民生委員と歩いて", ["徒歩", "その他"]))).toEqual([["徒歩", "民生委員と歩いて"]]);
  });
  it("徒歩の □ の無い様式は今までどおりその他の □", () => {
    expect(on(cellOf("other", "民生委員と歩いて", ["車", "その他"]))).toEqual([["その他", "民生委員と歩いて"]]);
  });
  it("手段を言わない・2 つ言う・言い換えの表の外の補記はその他のまま", () => {
    expect(on(cellOf("other", "近所の人に頼む", ["徒歩", "その他"]))).toEqual([["その他", "近所の人に頼む"]]);
    expect(on(cellOf("other", "息子の車で迎え", ["徒歩", "家族の車", "送迎", "その他"]))).toEqual([["その他", "息子の車で迎え"]]);
    expect(on(cellOf("other", "自転車", ["徒歩", "家族の車", "その他"]))).toEqual([["その他", "自転車"]]);
  });
  it("値が「その他」でない人は補記で替えない", () => {
    expect(on(cellOf("foot", "車を呼ぶ", ["徒歩", "家族の車", "その他"]))).toEqual([["徒歩", "車を呼ぶ"]]);
  });
  it("補記が 1 つだけ言う時のコード", () => {
    expect(soleCodeOfText("evacuation.transport", "民生委員と歩いて")).toBe("foot");
    expect(soleCodeOfText("evacuation.transport", "車椅子で")).toBe("wheelchair");
    expect(soleCodeOfText("evacuation.transport", "")).toBeNull();
  });
});

describe("□ の右の空きに中身の欄を補う", () => {
  const A4 = { w: 210, h: 297 };
  const X = 1 / A4.w;
  const Y = 1 / A4.h;
  const ink = (x: number, y: number, w: number, h: number, kind: "glyph" | "box" | "line" = "glyph"): InkBlob => ({ x: x * X, y: y * Y, w: w * X, h: h * Y, box: kind === "box", ...(kind === "line" ? { line: true } : {}) });
  const mark = (label: string, y: number, item: MappingField["item"] = "medical.allergies") => field({ label, shape: "check", item, box: { x: 26 * X, y: y * Y, w: 3.5 * X, h: 4 * Y }, ai: { item, confidence: "high", reason: "" } });
  /** □ と名前の字（□アレルギー）と、右の表の罫線 */
  const row = (y: number): InkBlob[] => [ink(26.6, y + 0.4, 3, 3, "box"), ink(30.2, y + 0.6, 3, 3), ink(34, y + 0.6, 2.5, 2.8), ink(37, y + 0.8, 1, 2.7), ink(38.8, y + 0.7, 1.8, 2.7), ink(40.8, y + 0.2, 3.4, 3.4), ink(44.6, y + 1.8, 3.4, 0.4)];
  const pageOf = (blobs: InkBlob[]) => new Map([[1, { ink: blobs, image: A4 }]]);
  const RULE = ink(192.5, 100, 0.3, 80, "line");

  it("名前の右から罫線の手前まで、行の高さに字の欄を足す", () => {
    const f = mark("アレルギー", 139.3);
    const out = addTrailingFields([f], pageOf([...row(139.3), RULE]));
    expect(out).toHaveLength(2);
    const added = out[1];
    expect(added.label).toBe("アレルギー（　）");
    expect(added.shape).toBe("text");
    expect(added.item).toBe("medical.allergies");
    expect(added.ai?.reason).toContain("（補）");
    const b = added.box!;
    expect(b.x * A4.w).toBeGreaterThan(48);
    expect((b.x + b.w) * A4.w).toBeLessThan(192.5);
    expect(b.h * A4.h).toBeGreaterThanOrEqual(2.6);
    expect(bracketOwner(added, out)?.owner.id).toBe(f.id);
  });

  it("次の行の字に掛からない。上下の字があれば手前まで", () => {
    const f = mark("アレルギー", 139.3);
    const out = addTrailingFields([f], pageOf([...row(139.3), RULE, ink(60, 143, 30, 3), ink(60, 136.5, 30, 3)]));
    const b = out[1].box!;
    expect((b.y + b.h) * A4.h).toBeLessThanOrEqual(143 + 1e-6);
    expect(b.y * A4.h).toBeGreaterThanOrEqual(139.5 - 1e-6);
  });

  it("同じ頁に同じ項目の欄があれば足さない（人が外した欄も足し直さない）", () => {
    const f = mark("アレルギー", 139.3);
    const bracket = field({ label: "アレルギー（　）", item: "medical.allergies", box: { x: 50 * X, y: 139.3 * Y, w: 100 * X, h: 4 * Y } });
    expect(addTrailingFields([f, bracket], pageOf(row(139.3)))).toHaveLength(2);
    expect(addTrailingFields([f, { ...bracket, removed: true }], pageOf(row(139.3)))).toHaveLength(2);
  });

  it("種類を指す □（常用薬・機器）・項目なしの □ には足さない", () => {
    expect(addTrailingFields([mark("透析", 139.3, "medical.devices")], pageOf([...row(139.3), RULE]))).toHaveLength(1);
    expect(addTrailingFields([mark("抗血小板薬", 139.3, "medical.medications")], pageOf([...row(139.3), RULE]))).toHaveLength(1);
    expect(addTrailingFields([mark("禁忌食物", 139.3, null)], pageOf([...row(139.3), RULE]))).toHaveLength(1);
  });

  it("印刷の字の位置が無い頁・狭い空き・ほかの欄が名前に掛かる行は足さない", () => {
    const f = mark("アレルギー", 139.3);
    expect(addTrailingFields([f], new Map([[1, { ink: null, image: A4 }]]))).toHaveLength(1);
    expect(addTrailingFields([f], pageOf([...row(139.3), ink(60, 140, 3, 3)]))).toHaveLength(1);
    const over = field({ label: "備考", box: { x: 40 * X, y: 139.3 * Y, w: 100 * X, h: 4 * Y } });
    expect(addTrailingFields([f, over], pageOf([...row(139.3), RULE]))).toHaveLength(2);
    expect(addTrailingFields([f, over], pageOf([...row(139.3), RULE]))[1]).toBe(over);
  });

  it("右の欄の手前まで。□ を中に持つ段全体の欄は避けない", () => {
    const f = mark("アレルギー", 139.3);
    const right = field({ label: "備考", box: { x: 120 * X, y: 139.3 * Y, w: 60 * X, h: 4 * Y } });
    const out = addTrailingFields([f, right], pageOf([...row(139.3), RULE]));
    expect((out[1].box!.x + out[1].box!.w) * A4.w).toBeLessThan(120);
    const block = field({ label: "禁忌事項等", shape: "handwrite", box: { x: 20 * X, y: 135 * Y, w: 170 * X, h: 20 * Y } });
    expect(addTrailingFields([f, block], pageOf([...row(139.3), RULE]))).toHaveLength(3);
  });

  it("括弧が刷ってある行は括弧の中（閉じ括弧の手前）", () => {
    const f = mark("アレルギー", 139.3);
    const out = addTrailingFields([f], pageOf([...row(139.3), ink(49, 139.8, 1, 3.5), ink(180, 139.8, 1, 3.5), RULE]));
    expect(out[1].box!.x * A4.w).toBeGreaterThan(49);
    expect((out[1].box!.x + out[1].box!.w) * A4.w).toBeLessThan(180);
  });

  it("足した欄に物の名前。無い人は □ に印なしでなし。枠の外に出ない", () => {
    const f = mark("アレルギー", 139.3);
    const fields = addTrailingFields([f], pageOf([...row(139.3), RULE]));
    const m: FormMapping = { title: "架空の様式", issuer: "", pages: 1, fields };
    const image: PageImage = { page: 1, width: 2100, height: 2970, bytes: 1, ink: packInk([...row(139.3), RULE]) };
    const paper = (id: string) => buildOverlaySheet(buildMappedSheet(seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!), m, { today: "2026-11-07", officeName: "デモ事業所" }), [image]);
    const has = paper("p-03");
    const child = has.pages[0].items.find((i) => i.fieldId === fields[1].id);
    expect(child?.kind === "text" && child.lines).toEqual(["ヨード造影剤"]);
    expect(has.pages[0].items.some((i) => i.kind === "mark" && i.fieldId === f.id)).toBe(true);
    const check = checkLook(has, fields, [image]);
    expect([check.overlap, check.outside, check.neighbor]).toEqual([0, 0, 0]);
    const none = paper("p-01");
    expect(none.pages[0].items.some((i) => i.kind === "mark" && i.fieldId === f.id)).toBe(false);
  });
});

describe("狭い空きの「別紙」", () => {
  it("2 行に折れた「別紙」も紙の印と数える", () => {
    const box = { x: 0.1, y: 0.1, w: 0.01, h: 0.04 };
    const sheet = {
      pages: [{ page: 1, landscape: false, image: { x: 0, y: 0, w: 210, h: 297 }, fills: [], items: [{ kind: "text" as const, fieldId: "f1", box, lines: ["別", "紙"], fontPt: 6, top: false }] }],
      annex: [{ fieldId: "f1", label: "避難場所までの移動", lines: ["家族と歩く"], reason: "overflow" as const, page: 1, mark: "f1" }],
    };
    expect(annexGaps(sheet)).toEqual({ noMark: [], noRow: [] });
  });
});
