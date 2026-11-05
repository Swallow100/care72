// T89: 手元の試験の所見の直し（入れる欄・様式の読み取りの指示）。本物の API は呼ばない。
// 指示の文に決まりが入っていることと、返事の形（zod）を変えていないことを見る。

import { describe, expect, it } from "vitest";
import { FORM_READ_SYSTEM, PageReadSchema } from "../forms/form-read.ts";
import { EXTRACT_RULES, EXTRACT_SYSTEM } from "./extract.ts";
import { INTAKE_READ_SYSTEM } from "./read.ts";
import { ExtractSchema } from "./schema.ts";

describe("入れる欄の指示（T89）", () => {
  it("特記は避難と支援に関わる事だけ。雑談・絵文字・「笑」は入れない。欄に入れた事は重ねない", () => {
    expect(EXTRACT_RULES).toContain("notes に入れるのは避難と支援に関わる事だけ");
    expect(EXTRACT_RULES).toContain("避難と支援に関わらない雑談は notes にもどの欄にも入れない");
    expect(EXTRACT_RULES).toContain("絵文字・顔文字・「笑」「（笑）」「w」は、notes にもどの欄にも写さない");
    expect(EXTRACT_RULES).toContain("欄に入れた事（介護の状態・続柄・機器・薬など）は notes に重ねない");
    // 前からの決まりは残す
    expect(EXTRACT_RULES).toContain("本人の言葉を言い換えない");
    expect(EXTRACT_RULES).toContain("医療依存の度合い・優先・緊急度");
  });

  it("続柄は本人から見た続柄。書き手から見た続柄なら言い直す", () => {
    expect(EXTRACT_RULES).toContain("relation（続柄）は、本人（A さん）から見た続柄にする");
    expect(EXTRACT_RULES).toContain("書き手から見た続柄なら、本人から見た続柄に言い直す（本人の息子が書いた「妹」は本人の娘）");
  });

  it("移乗・歩行・認知など介護の状態は care.* の欄へ（notes に流さない）", () => {
    expect(EXTRACT_RULES).toContain("介護の状態は care.* の欄に入れ、notes に流さない");
    expect(EXTRACT_RULES).toContain("立ち上がり・移乗・歩行は care.walking");
    expect(EXTRACT_RULES).toContain("care.dementia を true");
    for (const k of ["care.bedridden", "care.hearing", "care.vision", "care.understanding", "care.judgment", "care.orientation", "care.careLevel"]) {
      expect(EXTRACT_RULES).toContain(k);
    }
    // 状態の重さは決めない（書かれた事を欄に写す）
    expect(EXTRACT_RULES).toContain("本人の状態の重さは決めない");
  });

  it("文の分け方と写真・PDF の読み取りの両方に同じ決まりが入る", () => {
    expect(EXTRACT_SYSTEM).toContain(EXTRACT_RULES);
    expect(INTAKE_READ_SYSTEM).toContain(EXTRACT_RULES);
  });

  it("返事の形は変えない", () => {
    expect(Object.keys(ExtractSchema.shape)).toEqual(["items", "medications", "devices", "hazards", "contacts", "notes", "unknowns"]);
    expect(Object.keys(ExtractSchema.shape.contacts.element.shape)).toEqual(["kind", "relation", "night", "note"]);
  });
});

describe("様式の読み取りの指示（T89）", () => {
  it("自治体・受付が書く欄と、同意・署名など本人の意思の欄は対応なし", () => {
    expect(FORM_READ_SYSTEM).toContain("市・自治体・受付が書く欄");
    expect(FORM_READ_SYSTEM).toContain("「市記入欄」");
    expect(FORM_READ_SYSTEM).toContain("「受付」");
    expect(FORM_READ_SYSTEM).toContain("同意・署名・押印など本人の意思を示す欄（同意の □、「同意する・同意しない」の選択、署名）は item を null");
  });

  it("同じ項目を 2 つの欄に重ねない（2 つ目は 2 番目の値があるときだけ）。意味の違う欄に近い語で当てない（年築と構造）", () => {
    expect(FORM_READ_SYSTEM).toContain("同じ項目を 2 つの欄に重ねない");
    expect(FORM_READ_SYSTEM).toContain("2 つ目は台帳に 2 番目の値の項目（携帯番号・緊急連絡先2 など）があるときだけそれを当て、無ければ null");
    expect(FORM_READ_SYSTEM).toContain("意味の違う欄に、名前の近い項目を当てない");
    expect(FORM_READ_SYSTEM).toContain("「年築」「建築年」は建てた年で、木造・鉄骨などの種類（構造）とは違う");
  });

  it("場所（矩形）を返す（T86）。T120 から 1 頁の短い形（段ごと、頁・位置の説明は返させない、候補）", () => {
    // T131: 一覧の表の行の数と帯（list。表の無い頁は null）
    expect(Object.keys(PageReadSchema.shape)).toEqual(["title", "issuer", "typeface", "sections", "list"]);
    expect(Object.keys(PageReadSchema.shape.sections.element.shape.fields.element.shape)).toEqual([
      "label",
      "shape",
      "options",
      "item",
      "candidate",
      "confidence",
      "reason",
      "box",
      "option_boxes",
    ]);
    expect(FORM_READ_SYSTEM).toContain("左上を (0,0)、右下を (1,1)");
  });
});
