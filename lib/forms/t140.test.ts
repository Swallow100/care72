// T140 評価の 4 回目（書類）で残った物の直し: 選ぶ欄の選択肢と台帳の値の表（言い換えの表・範囲外・候補 2 つ・AI の当て）、
// 日付と電話の部品（西暦・刷ってある元号・横棒と括弧）、収まらない「その他」の書き足しの別紙、頁ごとの同じ場所の重複、シートの選び方。
// どれも架空の頁と種の人で確かめる（原本の絵は使わない）。AI は偽の client
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { FORM_OPTIONS } from "../claude/models.ts";
import type { UsageStore } from "../claude/usage.ts";
import { explanationSheet, formSheets } from "../ooxml/pick.ts";
import { readForm, toFormFile, type PageRead } from "./form-read.ts";
import { extraItemFields, pageRepeat, phonePair } from "./form-shape.ts";
import { packInk, type InkBlob } from "./ink.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { LIMITS, parseMappingInput, type FormMapping, type MappingField } from "./mapping.ts";
import { assignOptionValues, OPTION_AI_SYSTEM, optionTargets } from "./option-ai.ts";
import { codeOfOption, NONE_CODE, OTHER_CODE, optionTable, pickByCodes, codesOf } from "./option-values.ts";
import { checkLook } from "./overlay-check.ts";
import { buildOverlaySheet, inkDateParts, inkPhoneParts, partItems, westernYear, type PlaceCtx } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";
import { mappedSubject, ruleReview } from "./review.ts";
import { splitParts } from "./split-parts.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const IMAGE = { x: 0, y: 0, w: 210, h: 297 };
const pc = (ink: InkBlob[] | null): PlaceCtx => ({ page: { page: 1, landscape: false, image: IMAGE, items: [], fills: [] }, ink });
const blob = (x: number, y: number, w: number, h: number, box = false): InkBlob => ({ x, y, w, h, box });
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
const image = (ink: InkBlob[], page = 1): PageImage => ({ page, width: 2100, height: 2970, bytes: 1, ink: packInk(ink) });
const W = 1 / 210;
const H = 1 / 297;

/** 選ぶ欄（□ の並び。□ は 3mm、選択肢の間は 30mm） */
function choice(label: string, item: MappingField["item"], options: string[], y = 0.3, over: Partial<MappingField> = {}): MappingField {
  return field({
    label,
    shape: "choice",
    item,
    options,
    box: { x: 0.1, y, w: 0.85, h: 0.02 },
    optionBoxes: options.map((_, i) => ({ x: 0.1 + i * 30 * W + 0.002, y: y + 0.004, w: 3 * W, h: 3 * H })),
    ...over,
  });
}
const cellOf = (rows: ReturnType<typeof rowsOf>, f: MappingField) => buildMappedSheet(rows, mapping([f]), OPTS).pages[0].sections[0].rows[0].cell;
const onLabels = (rows: ReturnType<typeof rowsOf>, f: MappingField) => {
  const c = cellOf(rows, f);
  return c.kind === "choice" ? c.options.filter((o) => o.on).map((o) => o.label) : null;
};

describe("選択肢と台帳の値の表（言い換えの表）", () => {
  const plain = { label: "欄", section: "" };
  it("言い換えの表で当たる選択肢はコード、当たらない物は null、不明は空の並び", () => {
    expect(["自力でできる", "家族と一緒ならできる", "わからない"].map((o) => codeOfOption("care.walking", o, plain))).toEqual([["ok"], null, []]);
    expect(["自力歩行可", "杖歩行", "歩行に介助が必要", "その他"].map((o) => codeOfOption("care.walking", o, plain))).toEqual([["ok"], ["some"], ["hard"], [OTHER_CODE]]);
    // 頭の番号を外す。「車」と「車いす」は長い言葉の方
    expect(["1 徒歩", "2 車いす", "3 車", "4その他"].map((o) => codeOfOption("evacuation.transport", o, plain))).toEqual([["foot"], ["wheelchair"], ["family_car"], [OTHER_CODE]]);
    // 「・」で分けた言葉ごと
    expect(codeOfOption("basic.housing.structure", "鉄骨・鉄筋コンクリート", plain)).toEqual(["steel", "concrete"]);
    expect(codeOfOption("evacuation.carryItems", "お薬・お薬手帳", plain)).toEqual(["medicine", "notebook"]);
    expect(codeOfOption("evacuation.carryItems", "携帯電話充電器", plain)).toEqual(["charger"]);
    // 浸水の区域の名前は洪水にも内水にも入る。内水・津波の区域は洪水にしない
    expect(codeOfOption("evacuation.hazards", "洪水（氾濫流、河川浸食含む）", plain)).toEqual(["flood"]);
    expect(codeOfOption("evacuation.hazards", "内水氾濫", plain)).toBeNull();
    expect(codeOfOption("medical.devices", "なし", plain)).toEqual([NONE_CODE]);
    expect(codeOfOption("emergency1.relation", "連絡先なし", plain)).toEqual([NONE_CODE]);
    // 年齢の条件の付いた選択肢は表で当てない（台帳の値だけで決まらない）
    expect(codeOfOption("basic.household", "75歳以上一人暮らし高齢者", plain)).toBeNull();
    expect(codeOfOption("basic.household", "その他７５歳以上等世帯の高齢者", plain)).toBeNull();
  });

  it("要介護度: 数だけ・幅・要支援", () => {
    expect(["3", "4", "5"].map((o) => codeOfOption("care.careLevel", o, { label: "介護度", section: "" }))).toEqual([["care3"], ["care4"], ["care5"]]);
    expect(codeOfOption("care.careLevel", "要介護３～５", plain)).toEqual(["care3", "care4", "care5"]);
    expect(codeOfOption("care.careLevel", "要支援", plain)).toEqual(["support1", "support2"]);
    expect(codeOfOption("care.careLevel", "1", { label: "要支援", section: "" })).toEqual(["support1"]);
  });

  it("照らし方: 当たれば印、全部の選択肢が表で当たり値が外なら範囲外、1 つを選ぶ欄で 2 つ当たれば選ばない", () => {
    const care = ["3", "4", "5"].map((o) => codeOfOption("care.careLevel", o, { label: "介護度", section: "" }));
    expect(pickByCodes(care, ["care4"], false, codesOf("care.careLevel"))).toEqual({ hits: [1], range: false, ambiguous: false });
    expect(pickByCodes(care, ["care2"], false, codesOf("care.careLevel"))).toEqual({ hits: [], range: true, ambiguous: false });
    const sex = ["男性", "女性（妊娠なし）", "女性（妊娠あり）"].map((o) => codeOfOption("basic.sex", o, { label: "性別", section: "" }));
    expect(pickByCodes(sex, ["female"], false, codesOf("basic.sex")).ambiguous).toBe(true);
    // 「その他」は、ほかの選択肢が全部表で当たっているときだけ
    const rel = ["家族", "知人", "その他", "連絡先なし"].map((o) => codeOfOption("emergency1.relation", o, plain));
    expect(pickByCodes(rel, ["kind:care_service"], false, codesOf("emergency1.relation")).hits).toEqual([2]);
    expect(pickByCodes(rel, [], false, codesOf("emergency1.relation")).hits).toEqual([3]);
    const walk = ["自力でできる", "家族と一緒ならできる", "その他"].map((o) => codeOfOption("care.walking", o, plain));
    expect(pickByCodes(walk, ["some"], false, codesOf("care.walking"))).toEqual({ hits: [], range: false, ambiguous: false });
  });
});

describe("選ぶ欄の紙（種の人）", () => {
  it("歩行が問題なしの人は「自力でできる」に印。一部の人は表で当たらず、選択肢に無いとして置けなかった", () => {
    const ok = SEED_PEOPLE.find((p) => p.ledger.care?.walking === "ok")!.person.id;
    const some = SEED_PEOPLE.find((p) => p.ledger.care?.walking === "some")!.person.id;
    const f = choice("玄関まで", "care.walking", ["自力でできる", "家族と一緒ならできる", "支援者と一緒ならできる", "わからない"]);
    expect(onLabels(rowsOf(ok), f)).toEqual(["自力でできる"]);
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf(some), mapping([f]), OPTS), [image([])]);
    expect(sheet.unplacedWhy).toEqual({ [f.id]: "option" });
    // 置けなかった欄は紙の上で選べる黄の塗り（fix）
    expect(sheet.pages[0].fills.map((x) => x.kind)).toEqual(["fix"]);
  });

  it("要介護 2 の人の「3・4・5」は範囲外: 印も置けなかった印も塗りも無い", () => {
    const id = SEED_PEOPLE.find((p) => p.ledger.care?.careLevel === "care2")!.person.id;
    const f = choice("介護度", "care.careLevel", ["3", "4", "5"]);
    const cell = cellOf(rowsOf(id), f);
    expect(cell.kind === "choice" && cell.range).toBe(true);
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf(id), mapping([f]), OPTS), [image([])]);
    expect(sheet.unplaced ?? []).toEqual([]);
    expect(sheet.pages[0].fills).toEqual([]);
    expect(sheet.pages[0].items).toEqual([]);
  });

  it("要介護度の幅の □ 1 つは、幅の中の人だけ印", () => {
    const f = field({ label: "要介護認定が３～５のかた", shape: "check", item: "care.careLevel", box: { x: 0.1, y: 0.3, w: 3 * W, h: 3 * H } });
    const care3 = SEED_PEOPLE.find((p) => p.ledger.care?.careLevel === "care3")!.person.id;
    const care2 = SEED_PEOPLE.find((p) => p.ledger.care?.careLevel === "care2")!.person.id;
    expect(onLabels(rowsOf(care3), f)).toEqual([""]);
    expect(onLabels(rowsOf(care2), f)).toEqual([]);
  });

  it("性別「女性（妊娠なし／あり）」は台帳に無い事実: 選ばず、その他にも書かない", () => {
    const female = SEED_PEOPLE.find((p) => p.ledger.basic.sex === "female")!.person.id;
    const male = SEED_PEOPLE.find((p) => p.ledger.basic.sex === "male")!.person.id;
    const f = choice("性別・受診区分", "basic.sex", ["男性", "女性（妊娠なし）", "女性（妊娠あり）"]);
    expect(onLabels(rowsOf(male), f)).toEqual(["男性"]);
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf(female), mapping([f]), OPTS), [image([])]);
    expect(sheet.pages[0].items).toEqual([]);
    expect(sheet.unplacedWhy?.[f.id]).toBe("option");
  });

  it("連絡先の種類の □（家族・知人・その他・連絡先なし）は緊急連絡先の種類で印。関係の字は書かない", () => {
    const f = choice("連絡先", "emergency1.relation", ["家族", "知人", "その他", "連絡先なし"]);
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf("p-01"), mapping([f]), OPTS), [image([])]);
    expect(sheet.pages[0].items.map((i) => i.kind)).toEqual(["mark"]);
    expect(sheet.pages[0].items[0].box).toEqual(f.optionBoxes![0]);
    expect(sheet.unplaced ?? []).toEqual([]);
  });

  it("選択肢が 16 より多い持ち出し品の □ も後ろまで照らす（お薬・お薬手帳が 17 番目）", () => {
    expect(LIMITS.options).toBeGreaterThanOrEqual(24);
    const opts = ["現金", "通帳・印鑑", "マイナンバーカード", "免許証", "懐中電灯/ランタン", "携帯電話（スマホ）", "乾電池/バッテリー", "携帯電話充電器", "飲料水", "食料", "下着・衣類", "靴", "防寒着", "毛布・寝袋", "タオル", "メガネ", "お薬・お薬手帳", "ハブラシ"];
    const parsed = parseMappingInput({ title: "x", pages: 1, fields: [{ ...choice("持ち出し品", "evacuation.carryItems", opts), id: "f1" }] });
    expect(parsed.ok && parsed.mapping.fields[0].options).toHaveLength(opts.length);
    const f = parsed.ok ? parsed.mapping.fields[0] : choice("持ち出し品", "evacuation.carryItems", opts);
    // 種の人の持出品「薬」「お薬手帳」→ お薬・お薬手帳
    const id = SEED_PEOPLE.find((p) => (p.ledger.evacuation.carryItems ?? []).includes("お薬手帳"))!.person.id;
    expect(onLabels(rowsOf(id), f)).toEqual(["お薬・お薬手帳"]);
  });

  it("手段の補記は、印を付けた選択肢の所の空きに添える（補記を紙から落とさない）", () => {
    const id = SEED_PEOPLE.find((p) => (p.ledger.evacuation.transport ?? "").includes("娘の車"))!.person.id;
    const f = choice("【手段】", "evacuation.transport", ["徒歩", "その他"]);
    const cell = cellOf(rowsOf(id), f);
    expect(cell.kind === "choice" && cell.options.map((o) => [o.label, o.on, o.detail ?? ""])).toEqual([
      ["徒歩", false, ""],
      ["その他", true, "娘の車"],
    ]);
  });

  it("「その他（　）」の空きに入らない書き足しは、その空きに「別紙」と書いて別紙に（印と中身をそろえる）", () => {
    const id = SEED_PEOPLE.find((p) => (p.ledger.evacuation.transport ?? "").includes("訪問看護"))!.person.id;
    // 「その他」の □ の後ろに 4mm しか空きの無い欄
    const f = field({
      label: "【手段】",
      shape: "choice",
      item: "evacuation.transport",
      options: ["徒歩", "その他"],
      box: { x: 0.1, y: 0.3, w: 0.2, h: 0.02 },
      optionBoxes: [
        { x: 0.1 + 0.002, y: 0.304, w: 3 * W, h: 3 * H },
        { x: 0.3 - 9 * W, y: 0.304, w: 3 * W, h: 3 * H },
      ],
    });
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf(id), mapping([f]), OPTS), [image([])]);
    expect(sheet.annex.map((a) => [a.fieldId, a.reason])).toEqual([[f.id, "overflow"]]);
    const texts = sheet.pages[0].items.filter((i) => i.kind === "text");
    expect(texts.map((t) => (t.kind === "text" ? t.lines : []))).toEqual([["別紙"]]);
    expect(checkLook(sheet, [f], [image([])]).outside).toBe(0);
  });
});

describe("選択肢の AI の当て（偽の client）", () => {
  const usage: UsageStore = { reserve: async () => true, finish: async () => {}, countDay: async () => 0 };
  const sent: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const reply = (body: unknown) => ({
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: JSON.stringify(body), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
  const ctxWith = (answer: (p: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => unknown): AskJsonContext => {
    const claude: ClaudeClient = {
      beta: {
        messages: {
          async create(params) {
            sent.push(params);
            return reply(answer(params)) as unknown as Anthropic.Beta.Messages.BetaMessage;
          },
        },
      },
    };
    return { env: { ANTHROPIC_API_KEY: "test" }, usage, office: { id: "o1", kind: "demo" }, claude };
  };

  it("当たらない選択肢だけを送り、答えのコードを欄に残す（知らないコードは捨てる・null は人が選ぶ）。紙はその表で印", async () => {
    sent.length = 0;
    const f = choice("玄関まで", "care.walking", ["自力でできる", "家族と一緒ならできる", "支援者と一緒ならできる", "わからない"]);
    expect(optionTargets([f]).map((t) => t.open)).toEqual([[1, 2]]);
    const out = await assignOptionValues(
      [f],
      ctxWith(() => ({ fields: [{ id: f.id, options: [{ no: 1, codes: ["some"] }, { no: 2, codes: ["hard", "made_up"] }, { no: 0, codes: ["hard"] }] }] })),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].model).toBe(FORM_OPTIONS.model);
    const text = JSON.stringify(sent[0]);
    // 送った物は様式の字と値の名前だけ（台帳の値・名前は無い）
    expect(text).toContain("家族と一緒ならできる");
    expect(text).not.toContain("自力でできる");
    for (const p of SEED_PEOPLE) expect(text).not.toContain(p.person.name);
    expect(out[0].optionValues).toEqual({ item: "care.walking", values: [null, ["some"], ["hard"], null], ai: [1, 2] });
    expect(optionTable(out[0])).toEqual([["ok"], ["some"], ["hard"], []]);
    const some = SEED_PEOPLE.find((p) => p.ledger.care?.walking === "some")!.person.id;
    expect(onLabels(rowsOf(some), out[0])).toEqual(["家族と一緒ならできる"]);
    // 対応表の保存の形を通っても残る（共有の対応表も同じ JSON）
    const parsed = parseMappingInput({ title: "x", pages: 1, fields: out });
    expect(parsed.ok && parsed.mapping.fields[0].optionValues).toEqual(out[0].optionValues);
    // 項目を変えたら AI の当ては使わない
    expect(optionTable({ ...out[0], item: "care.hearing" })).toEqual([["ok"], null, null, []]);
  });

  it("当てる欄が無ければ呼ばない。読み取り（readForm）は頁を読んだあとに 1 回、optionAi: false なら呼ばない。失敗しても読み取りは止まらない", async () => {
    const page: PageRead = {
      title: "架空の様式",
      issuer: "",
      typeface: "gothic",
      list: null,
      sections: [
        {
          name: "",
          fields: [
            { label: "氏名", shape: "text", options: [], item: "person.name", candidate: null, confidence: "high", reason: "氏名", box: [0.1, 0.1, 0.3, 0.02], option_boxes: [] },
            { label: "屋内移動", shape: "choice", options: ["自力歩行可", "車いす"], item: "care.walking", candidate: null, confidence: "high", reason: "歩行", box: [0.1, 0.2, 0.6, 0.02], option_boxes: [] },
          ],
        },
      ],
    };
    const jpeg = toFormFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]));
    if (!jpeg.ok) throw new Error("jpeg");
    sent.length = 0;
    const answer = (p: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) =>
      JSON.stringify(p.system).includes(OPTION_AI_SYSTEM.slice(0, 30)) ? { fields: [{ id: "f2", options: [{ no: 1, codes: ["hard"] }] }] } : page;
    const r = await readForm([jpeg.file], ctxWith(answer));
    expect(sent).toHaveLength(2);
    expect(r.mapping.fields[1].optionValues).toEqual({ item: "care.walking", values: [null, ["hard"]], ai: [1] });
    sent.length = 0;
    const off = await readForm([jpeg.file], ctxWith(answer), { optionAi: false });
    expect(sent).toHaveLength(1);
    expect(off.mapping.fields[1].optionValues).toBeUndefined();
    // 当ての呼び出しが失敗しても、言い換えの表だけで続ける
    sent.length = 0;
    const bad = await readForm([jpeg.file], ctxWith((p) => (JSON.stringify(p.system).includes(OPTION_AI_SYSTEM.slice(0, 30)) ? { nope: 1 } : page)));
    expect(bad.mapping.fields).toHaveLength(2);
    expect(bad.mapping.fields[1].optionValues).toBeUndefined();
  });
});

describe("日付と電話の部品", () => {
  it("和暦の年を西暦に", () => {
    expect(westernYear("昭和17")).toBe("1942");
    expect(westernYear("令和元")).toBe("2019");
    expect(westernYear("8")).toBeNull();
  });

  it("「□西暦 □明治…□平成 年 月 日」の欄に令和の日付: 西暦の □ に印、年は西暦の数", () => {
    const opts = ["西暦", "明治", "大正", "昭和", "平成", "年", "月", "日"];
    const f = field({
      label: "記載日",
      shape: "date",
      options: opts,
      box: { x: 0.1, y: 0.2, w: 0.6, h: 0.02 },
      optionBoxes: opts.map((_, i) => (i < 5 ? { x: 0.1 + i * 8 * W, y: 0.203, w: 3 * W, h: 3 * H } : { x: 0.1 + (40 + (i - 5) * 20) * W, y: 0.2, w: 14 * W, h: 0.02 })),
    });
    const items = partItems(f, ["令和8年11月5日"], pc([]));
    expect(Array.isArray(items)).toBe(true);
    const list = items as Exclude<typeof items, null | "fail">;
    expect(list.filter((i) => i.kind === "mark").map((i) => i.box)).toEqual([f.optionBoxes![0]]);
    expect(list.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["2026", "11", "5"]);
    // 昭和の日付は昭和の □
    const showa = partItems(f, ["昭和17年4月18日"], pc([])) as Exclude<typeof items, null | "fail">;
    expect(showa.filter((i) => i.kind === "mark").map((i) => i.box)).toEqual([f.optionBoxes![3]]);
    expect(showa.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["17", "4", "18"]);
  });

  it("刷ってある「令和　年　月　日」（4 つのかたまり。頭が 2 字の幅）の空きに数だけ。ほかの元号の日付は置かない", () => {
    const box = { x: 0.1, y: 0.2, w: 0.5, h: 0.02 };
    const ink = [blob(0.1, 0.203, 8 * W, 4 * H), blob(0.1 + 20 * W, 0.203, 4 * W, 4 * H), blob(0.1 + 40 * W, 0.203, 4 * W, 4 * H), blob(0.1 + 60 * W, 0.203, 4 * W, 4 * H)];
    const f = field({ label: "作成日", shape: "date", box });
    const items = inkDateParts(f, ["令和8年11月5日"], pc(ink)) as Exclude<ReturnType<typeof inkDateParts>, null | "fail">;
    expect(items.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["8", "11", "5"]);
    // 年の字は刷ってある元号の右（元号に重ねない）
    expect(items[0].box.x).toBeGreaterThanOrEqual(0.1 + 8 * W - 1e-9);
    expect(inkDateParts(f, ["昭和17年4月18日"], pc(ink))).toBe("fail");
    // 「（西暦）」の欄は西暦の年
    const w = inkDateParts({ ...f, label: "生年月日（西暦）" }, ["昭和17年4月18日"], pc(ink.slice(1).map((b) => ({ ...b, x: b.x - 10 * W })))) as Exclude<ReturnType<typeof inkDateParts>, null | "fail">;
    expect(w.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["1942", "4", "18"]);
  });

  it("電話の欄に刷ってある「　−　−　」「（　）　−　」の空きに局番・市内・番号", () => {
    const box = { x: 0.1, y: 0.2, w: 0.4, h: 0.02 };
    const dash = (x: number) => blob(0.1 + x * W, 0.209, 2.5 * W, 0.6 * H);
    const f = field({ label: "電話", shape: "phone", box });
    const two = inkPhoneParts(f, ["089-000-0001"], pc([dash(20), dash(45)])) as Exclude<ReturnType<typeof inkPhoneParts>, null | "fail">;
    expect(two.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["089", "000", "0001"]);
    const paren = (x: number) => blob(0.1 + x * W, 0.2025, 1.2 * W, 4.5 * H);
    const p3 = inkPhoneParts(f, ["089-000-0001"], pc([paren(2), paren(18), dash(40)])) as Exclude<ReturnType<typeof inkPhoneParts>, null | "fail">;
    expect(p3.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["089", "000", "0001"]);
    // 局番が括弧の中
    expect(p3[0].box.x).toBeGreaterThan(0.1 + 2 * W);
    expect(p3[0].box.x + p3[0].box.w).toBeLessThanOrEqual(0.1 + 18 * W + 1e-9);
    // 区切りが刷ってなければ分けない
    expect(inkPhoneParts(f, ["089-000-0001"], pc([]))).toBeNull();
    // 電話の 2 つの空き（局番と残り）を郵便番号に取らない
    expect(splitParts("089-000-0001", ["局番", "番号"])).toEqual(["089", "000-0001"]);
    expect(splitParts("790-0001", ["〒", "番号"])).toEqual(["790", "0001"]);
  });
});

describe("頁ごとの同じ場所の重複", () => {
  const sameItem = (page: number, y = 0.1) => ({ id: `p${page}-${y}`, page, label: "氏名", box: { x: 0.2, y, w: 0.3, h: 0.02 }, source: "person.name" });
  it("写しの頁・頁の頭に繰り返す欄は同じ項目でよい。同じ頁の別の場所・電話と携帯", () => {
    expect(pageRepeat(sameItem(1), sameItem(2))).toBe(true);
    expect(pageRepeat(sameItem(1), sameItem(1, 0.5))).toBe(false);
    expect(pageRepeat(sameItem(1), sameItem(2, 0.5))).toBe(false);
    expect(phonePair({ ...sameItem(1), label: "電話", source: "emergency1.phone" }, { ...sameItem(1, 0.2), label: "携帯", source: "emergency1.phone" })).toBe(true);
    const extra = extraItemFields([sameItem(1), sameItem(2), sameItem(3), sameItem(1, 0.6)]);
    expect([...extra.keys()]).toEqual(["p1-0.6"]);
  });

  it("3 頁の写しの様式の紙で、見直しの重複は同じ頁の 2 か所に書いた欄だけ", () => {
    const pages = [1, 2, 3];
    const fields = pages.flatMap((p) => [
      field({ page: p, label: "氏名", item: "person.name", box: { x: 0.2, y: 0.1, w: 0.3, h: 0.03 } }),
      field({ page: p, label: "住所", item: "basic.address", box: { x: 0.2, y: 0.2, w: 0.6, h: 0.03 } }),
    ]);
    const twice = field({ page: 1, label: "本人氏名", item: "person.name", box: { x: 0.2, y: 0.6, w: 0.3, h: 0.03 } });
    const m = mapping([...fields, twice], 3);
    const mapped = buildMappedSheet(rowsOf("p-01"), m, OPTS);
    const sheet = buildOverlaySheet(mapped, pages.map((p) => image([], p)));
    const dups = ruleReview(mappedSubject(mapped, sheet)).filter((x) => x.kind === "duplicate");
    expect(dups.map((d) => d.field)).toEqual([twice.id]);
  });
});

describe("シートの選び方", () => {
  it("集計用・データ・編集禁止のシートは本体にしない（式の結果が刷ってある見出しの並び）", () => {
    expect(explanationSheet("集計用（編集禁止！）")).toBe(true);
    expect(explanationSheet("データ")).toBe(true);
    expect(explanationSheet("様式")).toBe(false);
    const pages = [
      { id: "0", example: false, sheet: "様式", words: 15 },
      { id: "1", example: false, sheet: "様式", words: 15 },
      { id: "2", example: true, sheet: "記入例", words: 18 },
      { id: "3", example: false, sheet: "集計用（編集禁止！）", words: 22 },
    ];
    expect(formSheets(pages)).toEqual(["様式"]);
  });
});
