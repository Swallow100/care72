// T176: 親の項目が深さでない空きに広がった読み取りの形（評価の 10 回目）を、後の決まりでそろえる。どれも架空の欄で確かめる（原本の絵は使わない）。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { FORM_READ_SYSTEM } from "./form-read.ts";
import { allowedTwice, extraItemFields } from "./form-shape.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { buildOverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";
import { settleRead } from "./read-settle.ts";
import { mappedSubject, ruleReview } from "./review.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const image: PageImage = { page: 1, width: 2100, height: 2970, bytes: 1 };

let n = 0;
const box = (x: number, y: number, w: number, h = 0.014) => ({ x, y, w, h });
const field = (over: Partial<MappingField>): MappingField =>
  ({
    id: `f${++n}`,
    page: 1,
    section: "段",
    label: "欄",
    position: "",
    shape: "text",
    options: [],
    item: null,
    removed: false,
    ai: { item: over.item ?? null, confidence: "high", reason: "読んだ" },
    box: box(0.1, 0.9, 0.1),
    ...over,
  }) as MappingField;
const itemsOf = (fs: readonly MappingField[]) => Object.fromEntries(fs.map((f) => [f.label, f.item]));
const yesNo = (over: Partial<MappingField>) => field({ shape: "choice", options: ["なし", "あり"], optionBoxes: [box(0.2, 0.1, 0.01), box(0.25, 0.1, 0.01)], box: box(0.2, 0.1, 0.1), ...over });

describe("T176 読み取りの文", () => {
  it("T175 で足した 2 行を外した。□ と括弧の決まりは残す", () => {
    expect(FORM_READ_SYSTEM).not.toContain("深さ・数を書く空き");
    expect(FORM_READ_SYSTEM).not.toContain("自由記入の 1 つの項目");
    expect(FORM_READ_SYSTEM).toContain("「□アレルギー（　）」");
  });
});

describe("T176 深さでない空きから親の項目を外す", () => {
  const item = "care.handbook" as const;

  it("親の選ぶ欄と同じ項目の、選択肢の子でない空きの欄は項目なし。AI の読んだ項目は候補に残す", () => {
    const fs = [
      yesNo({ label: "手帳", item }),
      field({ label: "身体（　）級", item, box: box(0.4, 0.1, 0.04) }),
      field({ label: "精神（　）級", item, box: box(0.5, 0.1, 0.04) }),
      field({ label: "療育（　）", item, box: box(0.6, 0.1, 0.04) }),
      field({ label: "その他【　】", item, box: box(0.7, 0.1, 0.04) }),
      field({ label: "深さ：【　】", item, box: box(0.8, 0.1, 0.04) }),
    ];
    const got = settleRead(fs);
    expect(itemsOf(got)).toEqual({ 手帳: item, "身体（　）級": null, "精神（　）級": null, "療育（　）": null, "その他【　】": null, "深さ：【　】": null });
    expect(got[1].ai?.candidate).toBe(item);
    expect(got[1].ai?.reason).toContain("親の項目");
  });

  it("選択肢の子の括弧（その他（　）・洪水（　～　）・選択肢と説明）はそのまま（紙は親の添えの置き場）", () => {
    const hazards = "evacuation.hazards" as const;
    const fs = [
      field({ label: "リスク", shape: "choice", item: hazards, options: ["洪水", "洪水区域", "その他"], box: box(0.2, 0.1, 0.5) }),
      field({ label: "洪水（　～　）", item: hazards, box: box(0.3, 0.1, 0.05) }),
      field({ label: "洪水区域（想定　m）", item: hazards, box: box(0.4, 0.1, 0.05) }),
      field({ label: "その他（　）", item: hazards, box: box(0.5, 0.1, 0.05) }),
    ];
    expect(settleRead(fs).map((f) => f.item)).toEqual([hazards, hazards, hazards, hazards]);
  });

  it("□ と同じ名前の括弧（単位の字が後ろにあっても）は □ の中身を書く所のまま", () => {
    const care = "care.careLevel" as const;
    const fs = [field({ label: "要介護", shape: "check", item: care, box: box(0.2, 0.1, 0.01) }), field({ label: "要介護（　）級", item: care, box: box(0.3, 0.1, 0.04) })];
    expect(settleRead(fs).map((f) => f.item)).toEqual([care, care]);
  });

  it("別の段・別の頁・別の項目の親では外さない。種類ごとの □（常用薬）の括弧も外さない", () => {
    const parent = yesNo({ label: "手帳", item, section: "上" });
    const other = field({ label: "療育（　）", item, section: "下", box: box(0.4, 0.5, 0.2) });
    const page2 = field({ label: "精神（　）", item, page: 2, box: box(0.4, 0.5, 0.2) });
    const diff = field({ label: "階（　）", item: "basic.housing.floor", section: "上", box: box(0.5, 0.1, 0.04) });
    expect(settleRead([parent, other, diff]).map((f) => f.item)).toEqual([item, item, "basic.housing.floor"]);
    expect(settleRead([parent, page2]).map((f) => f.item)).toEqual([item, item]);
    const meds = "medical.medications" as const;
    const kinds = [field({ label: "内服", shape: "check", item: meds, box: box(0.2, 0.1, 0.01) }), field({ label: "外用（　）剤", item: meds, box: box(0.3, 0.1, 0.05) })];
    expect(settleRead(kinds).map((f) => f.item)).toEqual([meds, meds]);
  });

  it("名前に空きの無い字の欄は親と同じ項目でも残す（□ に印、字の欄に中身）", () => {
    const care = "care.careLevel" as const;
    const fs = [field({ label: "認定あり", shape: "check", item: care, box: box(0.2, 0.1, 0.01) }), field({ label: "要介護状態区分", item: care, box: box(0.6, 0.1, 0.15) })];
    expect(settleRead(fs).map((f) => f.item)).toEqual([care, care]);
    // 同じ行の □ と字の欄は重複に数えない。行が違えば数える
    expect(allowedTwice(fs[0], fs[1])).toBe(true);
    expect(extraItemFields(fs).size).toBe(0);
    const far = { ...fs[1], box: box(0.6, 0.5, 0.15) };
    expect(allowedTwice(fs[0], far)).toBe(false);
  });

  it("空きの欄に手帳の値を丸ごと書かず、親の項目との重複も置けずも出ない", () => {
    const fs = [
      field({ label: "手帳", shape: "choice", item, options: ["なし", "あり"], optionBoxes: [box(0.2, 0.1, 0.01), box(0.25, 0.1, 0.01)], box: box(0.2, 0.1, 0.1, 0.02) }),
      field({ label: "身体（　）級", item, box: box(0.4, 0.1, 0.03, 0.012) }),
      field({ label: "精神（　）級", item, box: box(0.5, 0.1, 0.03, 0.012) }),
    ];
    const mapping: FormMapping = { title: "架空の様式", issuer: "", pages: 1, fields: settleRead(fs) };
    for (const p of SEED_PEOPLE) {
      const sheet = buildMappedSheet(seedRows(p), mapping, OPTS);
      const overlay = buildOverlaySheet(sheet, [image]);
      const found = ruleReview(mappedSubject(sheet, overlay));
      expect(found.filter((f) => f.kind === "duplicate")).toEqual([]);
      const texts = overlay.pages.flatMap((pg) => pg.items).filter((it) => it.kind === "text");
      expect(texts).toEqual([]);
    }
  });
});

describe("T176 同じ項目の字の欄は □ があっても 1 つ", () => {
  it("□ と字の欄 2 つの組: 字の欄は広い方に残し、□ は残す", () => {
    const item = "care.handbook" as const;
    const fs = [
      field({ label: "手帳所持", shape: "check", item, box: box(0.2, 0.1, 0.01) }),
      field({ label: "障害名", item, box: box(0.5, 0.1, 0.14) }),
      field({ label: "等級", item, box: box(0.8, 0.1, 0.07) }),
    ];
    expect(itemsOf(settleRead(fs))).toEqual({ 手帳所持: item, 障害名: item, 等級: null });
  });

  it("日付の形の欄が持つ項目を、別の頁の項目の名前の無い字の欄に当てた読みは字の欄を外す。日付の欄は外さない", () => {
    const item = "person.birth" as const;
    const birth = field({ label: "生年月日", shape: "date", item, box: box(0.3, 0.2, 0.4) });
    const stray = field({ label: "識別番号", item, page: 4, box: box(0.3, 0.9, 0.6) });
    expect(itemsOf(settleRead([birth, stray]))).toEqual({ 生年月日: item, 識別番号: null });
    // 頁ごとに繰り返す同じ名前の欄は外さない
    const again = field({ label: "生年月日", item, page: 2, box: box(0.3, 0.2, 0.4) });
    expect(settleRead([birth, again]).map((f) => f.item)).toEqual([item, item]);
  });
});

describe("T176 同じ頁の同じ項目の選ぶ欄は 1 つ", () => {
  const hazards = "evacuation.hazards" as const;
  it("2 つ目を外す。項目の名前そのものの欄があればそちらを残す", () => {
    const first = field({ label: "周辺の状況", shape: "choice", item: hazards, options: ["洪水", "土砂"], box: box(0.2, 0.1, 0.3) });
    const second = field({ label: "想定の深さ", shape: "choice", item: hazards, options: ["0.5m 未満", "0.5m 以上"], box: box(0.2, 0.2, 0.3) });
    expect(settleRead([first, second]).map((f) => f.item)).toEqual([hazards, null]);
    const support = "evacuation.support" as const;
    const want = field({ label: "受けたい支援", shape: "choice", item: support, options: ["自力", "その他"], box: box(0.2, 0.1, 0.3) });
    const named = field({ label: "支援内容", shape: "choice", item: support, options: ["声掛け", "誘導"], box: box(0.2, 0.2, 0.3) });
    expect(settleRead([want, named]).map((f) => f.item)).toEqual([null, support]);
  });

  it("別の頁の選ぶ欄・□ と選ぶ欄の組・種類ごとの項目は外さない", () => {
    const a = field({ label: "性別", shape: "choice", item: "basic.sex", options: ["男", "女"], box: box(0.2, 0.1, 0.3) });
    const b = field({ label: "性別区分", shape: "choice", item: "basic.sex", options: ["男", "女"], page: 2, box: box(0.2, 0.1, 0.3) });
    expect(settleRead([a, b]).map((f) => f.item)).toEqual(["basic.sex", "basic.sex"]);
    const c = "care.careLevel" as const;
    const mark = field({ label: "要介護３～５", shape: "check", item: c, box: box(0.2, 0.1, 0.01) });
    const level = field({ label: "介護度", shape: "choice", item: c, options: ["3", "4", "5"], box: box(0.3, 0.1, 0.1) });
    expect(settleRead([mark, level]).map((f) => f.item)).toEqual([c, c]);
    const d = "medical.devices" as const;
    const x = field({ label: "酸素", shape: "choice", item: d, options: ["あり"], box: box(0.2, 0.1, 0.1) });
    const y = field({ label: "呼吸器", shape: "choice", item: d, options: ["あり"], box: box(0.2, 0.2, 0.1) });
    expect(settleRead([x, y]).map((f) => f.item)).toEqual([d, d]);
  });
});
