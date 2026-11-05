// T133 実在の様式に埋めた紙の直し: 頁の印刷の字の位置（ink）、欄の枠の中だけで印刷の字を避けて置く、部品つきの欄（元号の □・年月日の空き・
// 括弧・その他の括弧・選択肢の添え）、置けない値は置かずに「置けなかった」、黄の塗りの 2 つ、別紙 あり の印、読み取りの補い、電話の欄の役、
// 住所の欄に仮の言い方を刷らない。どれも架空の頁と種の人で確かめる（原本の絵は使わない）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlaySheet as OverlayView } from "../../components/forms/OverlaySheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { grayOf, inkBlobs, packInk, unpackInk, type InkBlob } from "./ink.ts";
import { itemHints, refineItems } from "./item-hints.ts";
import { buildMappedSheet, phoneRole } from "./mapped-sheet.ts";
import { checkReadResult, type FieldBox, type FormMapping, type MappingField, type ReadResult } from "./mapping.ts";
import { t, sub, value } from "./matsuyama.ts";
import { checkLook } from "./overlay-check.ts";
import { buildOverlaySheet, fieldLines, hitsInk, inside, placeText, printedOff, textExtent, type OverlayItem, type PlaceCtx } from "./overlay-sheet.ts";
import { parsePageImages, type PageImage } from "./page-images.ts";
import { freeRects } from "./place.ts";
import { seedRows } from "./print-harness.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const IMAGE = { x: 0, y: 0, w: 210, h: 297 };
const pc = (ink: InkBlob[] | null): PlaceCtx => ({ page: { page: 1, landscape: false, image: IMAGE, items: [], fills: [] }, ink });
/** 印刷の字のかたまり（頁の比） */
const blob = (x: number, y: number, w: number, h: number, box = false): InkBlob => ({ x, y, w, h, box });
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
const image = (ink: InkBlob[]): PageImage => ({ page: 1, width: 2100, height: 2970, bytes: 1, ink: packInk(ink) });

/** 置いた物の全部が欄の枠の中で、印刷の字と重ならず、隣の欄の枠に掛からない（T133 の決まり） */
function expectClean(sheet: ReturnType<typeof buildOverlaySheet>, fields: MappingField[], img: PageImage) {
  const look = checkLook(sheet, fields, [img]);
  expect(look.outside).toBe(0);
  expect(look.neighbor).toBe(0);
  expect(look.overlap).toBe(0);
  return look;
}

describe("頁の印刷の字の位置（ink）", () => {
  it("罫線を外し、字と □ のかたまりを箱にする。保存の形を行き来できる", () => {
    // 297mm の頁を 297 画素（1 画素 1mm）に。横の罫線 1 本、3mm の □、2mm の字のかたまり
    const w = 210;
    const h = 297;
    const data = new Uint8Array(w * h).fill(255);
    const dot = (x: number, y: number) => (data[y * w + x] = 0);
    for (let x = 10; x < 200; x++) dot(x, 50);
    for (let i = 0; i < 4; i++) {
      dot(30 + i, 100);
      dot(30 + i, 103);
      dot(30, 100 + i);
      dot(33, 100 + i);
    }
    for (let y = 120; y < 123; y++) for (let x = 60; x < 62; x++) dot(x, y);
    const blobs = inkBlobs({ width: w, height: h, data });
    const marks = blobs.filter((b) => !b.line);
    expect(marks).toHaveLength(2);
    expect(marks.filter((b) => b.box)).toHaveLength(1);
    expect(marks.every((b) => b.y > 60 / h)).toBe(true);
    // 罫線は線の印で残す（欄の枠の中の線を避けるため）
    expect(blobs.filter((b) => b.line).map((b) => Math.round(b.y * h))).toEqual([50]);
    const back = unpackInk(packInk(blobs))!;
    expect(back).toHaveLength(3);
    expect(back.map((b) => [b.box, !!b.line])).toEqual(blobs.map((b) => [b.box, !!b.line]));
    expect(grayOf(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1).data).toEqual(new Uint8Array([255, 0]));
  });

  it("頁の画像の JSON に持ち、壊れた物は捨てる（位置なしで置く）", () => {
    const ok = parsePageImages(JSON.stringify([{ page: 1, width: 10, height: 10, bytes: 1, ink: [1, 2, 3, 4, 0] }]))!;
    expect(ok[0].ink).toEqual([1, 2, 3, 4, 0]);
    const bad = parsePageImages(JSON.stringify([{ page: 1, width: 10, height: 10, bytes: 1, ink: [1, 2, 3] }]))!;
    expect(bad[0].ink).toBeUndefined();
  });
});

describe("欄の枠の中で印刷の字を避けて置く", () => {
  const box: FieldBox = { x: 0.1, y: 0.1, w: 0.3, h: 0.02 };
  it("印刷の字が無ければ枠全体（前と同じ）", () => {
    const it0 = placeText("a", ["1"], box, pc(null))!;
    expect(it0.box).toEqual(box);
    expect(it0.shifted).toBeUndefined();
  });

  it("「（　　）階」: 括弧と階の字を避け、括弧の中へ。単位が刷ってあれば数だけ", () => {
    const ink = [blob(0.1, 0.103, 0.012, 0.014), blob(0.25, 0.103, 0.012, 0.014), blob(0.265, 0.103, 0.014, 0.014)];
    const it0 = placeText("a", ["1 階"], box, pc(ink), { units: true })!;
    expect(it0.shifted).toBe(true);
    expect(it0.lines).toEqual(["1"]);
    expect(inside(it0.box, box)).toBe(true);
    expect(hitsInk(textExtent(it0, IMAGE), ink)).toBe(false);
    expect(it0.box.x).toBeGreaterThanOrEqual(0.112);
    expect(it0.box.x + it0.box.w).toBeLessThanOrEqual(0.25 + 1e-9);
  });

  it("枠の中に空きが無ければ置かない（枠の外へは出さない）", () => {
    const full = [blob(0.1, 0.1, 0.3, 0.02)];
    expect(placeText("a", ["かわなぎ小学校"], box, pc(full))).toBeNull();
  });

  it("空いた所は枠の中だけ", () => {
    for (const r of freeRects(box, [blob(0.2, 0.1, 0.02, 0.02)], IMAGE)) expect(inside(r, box, 1e-9, 1e-9)).toBe(true);
  });

  it("欄の名前の括弧の前の字（要介護（　））は値の頭から外す", () => {
    expect(printedOff({ label: "要介護（　）" }, ["要介護3"])).toEqual(["3"]);
    expect(printedOff({ label: "寝室" }, ["要介護3"])).toEqual(["要介護3"]);
  });
});

describe("部品つきの欄（種の 1 人目）", () => {
  const rows = seedRows(seed("p-01"));

  it("生年月日: 刷ってある元号の □（4 つ）の昭和に印、年月日の空きに数だけ。全部が欄の枠の中", () => {
    const fbox: FieldBox = { x: 0.6, y: 0.1, w: 0.2, h: 0.06 };
    const eras = [blob(0.605, 0.105, 0.012, 0.009, true), blob(0.7, 0.105, 0.012, 0.009, true), blob(0.605, 0.125, 0.012, 0.009, true), blob(0.7, 0.125, 0.012, 0.009, true)];
    const units = [blob(0.66, 0.145, 0.012, 0.01), blob(0.72, 0.145, 0.012, 0.01), blob(0.785, 0.145, 0.012, 0.01)];
    const f = field({
      label: "生年月日",
      shape: "date",
      item: "person.birth",
      box: fbox,
      options: ["年", "月", "日"],
      optionBoxes: [
        { x: 0.62, y: 0.143, w: 0.038, h: 0.015 },
        { x: 0.675, y: 0.143, w: 0.042, h: 0.015 },
        { x: 0.735, y: 0.143, w: 0.045, h: 0.015 },
      ],
    });
    const img = image([...eras, ...units]);
    const sheet = buildOverlaySheet(buildMappedSheet(rows, mapping([f]), OPTS), [img]);
    const items = sheet.pages[0].items;
    const marks = items.filter((i) => i.kind === "mark");
    expect(marks.map((m) => m.box)).toEqual([eras[1]]);
    expect(items.filter((i): i is Extract<OverlayItem, { kind: "text" }> => i.kind === "text").map((i) => i.lines.join(""))).toEqual(["17", "4", "18"]);
    expectClean(sheet, [f], img);
  });

  it("作成日: 元号の □ が無く今の元号なら数だけ。どの空きにも入らなければ置かずに「置けなかった」", () => {
    const f = field({
      label: "年　月　日作成",
      shape: "date",
      item: "plan.date",
      box: { x: 0.7, y: 0.05, w: 0.15, h: 0.012 },
      options: ["年", "月", "日"],
      optionBoxes: [
        { x: 0.7, y: 0.05, w: 0.025, h: 0.012 },
        { x: 0.74, y: 0.05, w: 0.035, h: 0.012 },
        { x: 0.8, y: 0.05, w: 0.035, h: 0.012 },
      ],
    });
    const img = image([]);
    const sheet = buildOverlaySheet(buildMappedSheet(rows, mapping([f]), OPTS), [img]);
    const texts = sheet.pages[0].items.filter((i): i is Extract<OverlayItem, { kind: "text" }> => i.kind === "text");
    expect(texts.map((i) => i.lines.join(""))).toEqual(["8", "11", "5"]);
    // 年の空きが狭く、隣の月の空きまで広げても入らない
    const narrow = { ...f, id: "fn", optionBoxes: [{ x: 0.7, y: 0.05, w: 0.003, h: 0.012 }, { x: 0.703, y: 0.05, w: 0.035, h: 0.012 }, f.optionBoxes![2]] };
    const s2 = buildOverlaySheet(buildMappedSheet(rows, mapping([narrow]), OPTS), [img]);
    expect(s2.pages[0].items).toEqual([]);
    expect(s2.unplaced).toEqual(["年　月　日作成"]);
    expect(s2.pages[0].fills.map((x) => x.kind)).toEqual(["fix"]);
  });

  it("要介護（　）: □ の項目を括弧の欄にも当て（読み取りの補い）、括弧の中に数字だけ", () => {
    const check = field({ label: "要介護", shape: "check", item: "care.careLevel", box: { x: 0.2, y: 0.2, w: 0.014, h: 0.01 } });
    const paren = field({ label: "要介護（　）", shape: "text", item: null, box: { x: 0.25, y: 0.2, w: 0.06, h: 0.012 } });
    const fields = refineItems([check, paren]);
    expect(fields[1].item).toBe("care.careLevel");
    const img = image([]);
    const sheet = buildOverlaySheet(buildMappedSheet(rows, mapping(fields), OPTS), [img]);
    const texts = sheet.pages[0].items.filter((i): i is Extract<OverlayItem, { kind: "text" }> => i.kind === "text");
    expect(texts.map((i) => i.lines.join(""))).toEqual(["3"]);
    expect(sheet.pages[0].items.filter((i) => i.kind === "mark")).toHaveLength(1);
    expectClean(sheet, fields, img);
  });

  it("【手段】: 選択肢に合わない値は「その他」の □ に印、その後ろの括弧の中に。□ の行の上には書かない", () => {
    const fbox: FieldBox = { x: 0.6, y: 0.3, w: 0.3, h: 0.014 };
    const f = field({
      label: "【手段】",
      shape: "choice",
      item: "evacuation.transport",
      box: fbox,
      options: ["徒歩", "その他"],
      optionBoxes: [
        { x: 0.603, y: 0.302, w: 0.012, h: 0.009 },
        { x: 0.7, y: 0.302, w: 0.012, h: 0.009 },
      ],
    });
    const ink = [blob(0.603, 0.302, 0.012, 0.009, true), blob(0.617, 0.302, 0.025, 0.009), blob(0.7, 0.302, 0.012, 0.009, true), blob(0.714, 0.302, 0.03, 0.009), blob(0.746, 0.302, 0.005, 0.01), blob(0.89, 0.302, 0.005, 0.01)];
    const img = image(ink);
    const sheet = buildOverlaySheet(buildMappedSheet(rows, mapping([f]), OPTS), [img]);
    const items = sheet.pages[0].items;
    expect(items.filter((i) => i.kind === "mark").map((i) => i.box.x)).toEqual([0.7]);
    const text = items.find((i): i is Extract<OverlayItem, { kind: "text" }> => i.kind === "text")!;
    expect(text.lines.join("")).toContain("娘の車");
    expect(text.box.x).toBeGreaterThan(0.751);
    expectClean(sheet, [f], img);
    // その他の □ が無い欄は置かない
    const g = { ...f, id: "g1", options: ["徒歩", "自転車"] };
    const s2 = buildOverlaySheet(buildMappedSheet(rows, mapping([g]), OPTS), [img]);
    expect(s2.pages[0].items.filter((i) => i.kind === "text")).toEqual([]);
    expect(s2.unplaced).toHaveLength(1);
  });

  it("自宅のリスク: 洪水の □ に印、深さはその選択肢の所の空き（「（ ～ ）」の中）に", () => {
    const fbox: FieldBox = { x: 0.3, y: 0.1, w: 0.6, h: 0.032 };
    const f = field({
      label: "自宅のリスク（複数選択可）",
      shape: "choice",
      item: "evacuation.hazards",
      box: fbox,
      options: ["土砂災害", "洪水", "津波"],
      optionBoxes: [
        { x: 0.305, y: 0.103, w: 0.013, h: 0.009 },
        { x: 0.45, y: 0.103, w: 0.013, h: 0.009 },
        { x: 0.6, y: 0.103, w: 0.013, h: 0.009 },
      ],
    });
    const ink = [blob(0.465, 0.103, 0.03, 0.009), blob(0.455, 0.118, 0.005, 0.011), blob(0.52, 0.118, 0.01, 0.006), blob(0.585, 0.118, 0.005, 0.011)];
    const img = image(ink);
    const sheet = buildOverlaySheet(buildMappedSheet(rows, mapping([f]), OPTS), [img]);
    const texts = sheet.pages[0].items.filter((i): i is Extract<OverlayItem, { kind: "text" }> => i.kind === "text");
    expect(texts.map((i) => i.lines.join(""))).toEqual(["3m"]);
    expect(inside(texts[0].box, { x: 0.45, y: fbox.y, w: 0.15, h: fbox.h })).toBe(true);
    expectClean(sheet, [f], img);
  });
});

describe("別紙 あり の印・黄の塗りの 2 つ・住所の仮の言い方", () => {
  const rows = seedRows(seed("p-01"));
  const annexField = () =>
    field({ label: "別紙", shape: "choice", item: "medical.annex", box: { x: 0.6, y: 0.5, w: 0.3, h: 0.014 }, options: ["あり", "なし"], optionBoxes: [{ x: 0.63, y: 0.502, w: 0.012, h: 0.009 }, { x: 0.75, y: 0.502, w: 0.012, h: 0.009 }] });

  it("別紙の頁が付かなければ なし、付けば あり", () => {
    const a = annexField();
    const img = image([]);
    const none = buildOverlaySheet(buildMappedSheet(rows, mapping([a]), OPTS), [img]);
    expect(none.annex).toEqual([]);
    expect(none.pages[0].items.map((i) => i.box.x)).toEqual([0.75]);
    const long = field({ label: "特記事項", shape: "lines", item: "notes.other", box: { x: 0.1, y: 0.6, w: 0.05, h: 0.012 } });
    const withAnnex = buildOverlaySheet(buildMappedSheet(rows, mapping([a, long]), OPTS), [img]);
    expect(withAnnex.annex.length).toBeGreaterThan(0);
    expect(withAnnex.pages[0].items.filter((i) => i.fieldId === a.id).map((i) => i.box.x)).toEqual([0.63]);
  });

  it("台帳に無い欄は ask、置けなかった欄は fix。紙の色付けの版で縁を分ける", () => {
    const ask = field({ label: "寝室", item: "basic.housing.bedroom", box: { x: 0.1, y: 0.7, w: 0.2, h: 0.02 } });
    const fix = field({ label: "住所", item: "basic.address", box: { x: 0.1, y: 0.75, w: 0.2, h: 0.02 } });
    const img = image([blob(0.1, 0.75, 0.2, 0.02)]);
    const sheet = buildOverlaySheet(buildMappedSheet(rows, mapping([ask, fix]), OPTS), [img]);
    expect(sheet.pages[0].fills.map((x) => [x.keys[0], x.kind])).toEqual([
      [ask.id, "ask"],
      [fix.id, "fix"],
    ]);
    const html = renderToStaticMarkup(createElement(OverlayView, { sheet, imageSrc: () => "", checked: "", fill: true }));
    expect(html).toContain('data-fill-kind="fix"');
    expect(html).toContain("ov-fill ov-fix");
  });

  it("住所の無い人の近さ（市内・近所）だけの値は住所の欄に書かない", () => {
    const f = field({ label: "住所", item: "supporter1.address" });
    expect(fieldLines(f, value([{ text: "", unconfirmed: true }, sub("市内")]))).toEqual([]);
    expect(fieldLines(f, value([t("松山市 かわなぎ町"), sub("市内")]))).toHaveLength(1);
    expect(fieldLines({ ...f, item: "supporter1.relation" }, value([{ text: "", unconfirmed: true }, sub("市内")]))).toEqual(["（市内）"]);
  });
});

describe("読み取りの補い（item-hints）", () => {
  it("フリガナ・携帯・名前の言葉・名前 2 つの書く所", () => {
    const name = field({ section: "避難支援者", label: "氏名", item: "supporter1.name", box: { x: 0.2, y: 0.1, w: 0.3, h: 0.02 } });
    const kana = field({ section: "避難支援者", label: "フリガナ", item: null, box: { x: 0.2, y: 0.08, w: 0.3, h: 0.01 } });
    const tel = field({ section: "避難支援者", label: "電話番号", shape: "phone", item: "supporter1.phone", box: { x: 0.6, y: 0.08, w: 0.2, h: 0.01 } });
    const mob = field({ section: "避難支援者", label: "携帯番号", shape: "phone", item: null, box: { x: 0.6, y: 0.09, w: 0.2, h: 0.01 } });
    const bed = field({ section: "住居", label: "寝室", item: null, box: { x: 0.2, y: 0.3, w: 0.2, h: 0.02 } });
    const doc = field({ label: "かかりつけ医・薬局 医薬品情報", item: "medical.doctor", box: { x: 0.2, y: 0.4, w: 0.6, h: 0.03 } });
    const hints = itemHints([name, kana, tel, mob, bed, doc]);
    expect(hints.map((h) => [h.id, h.item])).toEqual([
      [kana.id, "supporter1.kana"],
      [mob.id, "supporter1.phone"],
      [bed.id, "basic.housing.bedroom"],
    ]);
    const out = refineItems([name, kana, tel, mob, bed, doc]);
    const added = out.find((f) => f.item === "medical.medications")!;
    expect(added.box).toEqual(doc.box);
    expect(added.label).toBe("医薬品");
  });

  it("その他（　）には前の欄の項目を当てない", () => {
    const other = field({ label: "その他", shape: "check", item: "basic.household" });
    const paren = field({ label: "その他（　）", item: null });
    expect(itemHints([other, paren])).toEqual([]);
  });

  it("checkReadResult が補いを通す", () => {
    const r: ReadResult = {
      title: "架空",
      issuer: "",
      pages: 1,
      fields: [
        { page: 1, section: "", label: "要介護", position: "", shape: "check", options: [], item: "care.careLevel", confidence: "high", reason: "" },
        { page: 1, section: "", label: "要介護（　）", position: "", shape: "text", options: [], item: null, confidence: "low", reason: "□ に当てた" },
      ],
    };
    const m = checkReadResult(r).mapping;
    expect(m.fields[1].item).toBe("care.careLevel");
    expect(m.fields[1].ai?.reason).toContain("（補）");
  });

  it("電話の欄の役: 携帯の欄は携帯だけ、対の電話の欄は電話だけ", () => {
    const cell = value([t("090-0000-0011"), sub("電話")], [t("080-0000-0011"), sub("携帯")]);
    const tel = field({ section: "s", label: "電話番号", item: "emergency1.phone" });
    const mob = field({ section: "s", label: "携帯番号", item: "emergency1.phone" });
    const only = phoneRole(cell, tel, [tel]);
    expect(only).toEqual(cell);
    const a = phoneRole(cell, tel, [tel, mob]);
    const b = phoneRole(cell, mob, [tel, mob]);
    expect(a.kind === "value" && a.lines.map((l) => l[0].text)).toEqual(["090-0000-0011"]);
    expect(b.kind === "value" && b.lines.map((l) => l[0].text)).toEqual(["080-0000-0011"]);
  });
});
