// T131: 評価の 3 回目（docs/progress/eval-r3-findings.md の 3・4・5）で残った書類の AI の直し。本物の API は呼ばない。
// - 一覧の形の様式（見出しの行＋人ごとの行）: 読み取りの決まりと答えの形の list、対応表の ListShape、1 人ずつの紙は 1 行目、
//   一括印刷は行ごとに 1 人（行の数を超えたら枚を足す）、様式 9 は専用の紙へ案内
// - 1 つの書く所に 2 つの欄（名前が 2 つ）: 重ねて 1 つに置く
// - 名前と電話の列: 名前の欄の値の電話を同じ行の電話の列（項目なし）に分けて置く
// - 避難場所ごとの手段・時間、事業所名と担当ケアマネの項目
// - 薬の区分の □: 専用の紙（災害診療記録 lib/forms/medical-summary.ts）と同じ印
import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MappingEditor } from "../../components/forms/mapping/MappingEditor.tsx";
import { PaperBatch, groupListPapers, type BatchPaper } from "../../components/forms/PaperBatch.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { AiTruncated } from "../claude/errors.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { FORM9_HEADS } from "./frame-form9.ts";
import { FORM9_PATH } from "./form9-href.ts";
import { FORM_READ_SYSTEM, PageReadSchema, readForm, salvagePageRead, toPageRead, type FormFile } from "./form-read.ts";
import { pageReadReply } from "./form-read-fake.ts";
import { FORM9_PAPER_PATH, isForm9Like, isListSheet, mergeListSheets } from "./list-sheet.ts";
import { checkReadResult, itemCatalog, listFieldIds, listShapeOf, parseMappingInput, type FieldBox, type FormMapping, type MappingField, type ReadResult } from "./mapping.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import type { Cell } from "./matsuyama.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import { buildOverlaySheet, telColumns, type OverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const P = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const IMG: PageImage[] = [{ page: 1, width: 2000, height: 1414, bytes: 1 }];

let n = 0;
const field = (over: Partial<MappingField>): MappingField => ({
  id: `f${++n}`,
  page: 1,
  section: "",
  label: "",
  position: "",
  shape: "text",
  options: [],
  item: null,
  removed: false,
  ai: null,
  ...over,
});

// ---------- 一覧の形の様式 ----------

/** 架空の一覧の表（A4 横、10 行）: 表の外に事業所名、表の列は No・氏名・住所・避難所・担当ケアマネ・電話 */
const ROW_Y = 0.2;
const ROW_H = 0.05;
const listRead = (rows = 10): ReadResult => {
  // 行が多い表は行を低く（最後の行も頁の中に）
  const h = Math.min(ROW_H, 0.7 / rows);
  const col = (x: number, w: number): FieldBox => ({ x, y: ROW_Y, w, h });
  const f = (label: string, item: string | null, box: FieldBox, section = "", shape: "text" | "phone" = "text") => ({
    page: 1,
    section,
    label,
    position: "",
    shape,
    options: [],
    item,
    confidence: "high" as const,
    reason: "見出し",
    box,
    option_boxes: [],
  });
  return {
    title: "利用者一覧表（架空）",
    issuer: "",
    pages: 1,
    typeface: "gothic",
    fields: [
      f("事業所名", "plan.office", { x: 0.1, y: 0.1, w: 0.4, h: 0.03 }),
      f("No", null, col(0.05, 0.04)),
      f("氏名", "person.name", col(0.09, 0.15)),
      f("住所", "basic.address", col(0.24, 0.25)),
      f("避難所", "evacuation.destination1", col(0.49, 0.15), "想定される避難場所"),
      f("担当ケアマネ", "plan.careManager", col(0.64, 0.12)),
    ],
    list: { page: 1, rows, first: { x: 0.05, y: ROW_Y, w: 0.71, h }, last: { x: 0.05, y: ROW_Y + h * (rows - 1), w: 0.71, h } },
  };
};

describe("一覧の形の様式（T131、評価の 3 回目の 3）", () => {
  it("読み取りの決まり: 見出しを欄に、行の番号を段にしない、1 行目の枠、list に行の数と帯", () => {
    expect(FORM_READ_SYSTEM).toContain("17. 1 人 1 行の空の行が見出しの行の下に何行も並ぶ一覧の表");
    expect(FORM_READ_SYSTEM).toContain("行の番号（1・2・3）を段や欄の名前にしない");
    expect(FORM_READ_SYSTEM).toContain("box は 1 行目（見出しのすぐ下の行）のその列の枠");
    expect(FORM_READ_SYSTEM).toContain("list には、その表の人を書く行の数（rows）");
    // 答えの形の list は null を許す（一覧の無い頁）
    expect(PageReadSchema.safeParse({ title: "", issuer: "", typeface: "gothic", sections: [], list: null }).success).toBe(true);
    expect(PageReadSchema.safeParse({ title: "", issuer: "", typeface: "gothic", sections: [], list: { rows: 20, first: [0, 0.2, 1, 0.03], last: [0, 0.8, 1, 0.03] } }).success).toBe(true);
  });

  it("読んだ答えの list が対応表の ListShape に（行の間は 1 行目と最後の行から）。表の列の欄は 1 行目の帯の中の欄", () => {
    const m = checkReadResult(listRead()).mapping;
    expect(m.list).toEqual({ page: 1, rows: 10, first: { x: 0.05, y: 0.2, w: 0.71, h: 0.05 }, step: 0.05 });
    const ids = listFieldIds(m.fields, m.list!);
    expect(m.fields.filter((f) => ids.includes(f.id)).map((f) => f.label)).toEqual(["No", "氏名", "住所", "避難所", "担当ケアマネ"]);
  });

  it("形の合わない list は一覧にしない（行 1 つ・行の間が帯の高さと合わない・最後の行が上）", () => {
    const first = { x: 0, y: 0.2, w: 1, h: 0.05 };
    expect(listShapeOf({ page: 1, rows: 1, first, last: first }, 1)).toBeNull();
    expect(listShapeOf({ page: 1, rows: 10, first, last: { ...first, y: 0.21 } }, 1)).toBeNull();
    expect(listShapeOf({ page: 1, rows: 10, first, last: { ...first, y: 0.1 } }, 1)).toBeNull();
    expect(listShapeOf({ page: 1, rows: 10, first: null, last: first }, 1)).toBeNull();
    expect(listShapeOf({ page: 3, rows: 2, first, last: { ...first, y: 0.25 } }, 1)?.page).toBe(1);
  });

  it("保存の形: 画面から来た対応表の list を確かめて残す。形の違う list は落とす", () => {
    const m = checkReadResult(listRead()).mapping;
    const back = parseMappingInput(JSON.parse(JSON.stringify(m)));
    expect(back.ok && back.mapping.list).toEqual(m.list);
    const bad = parseMappingInput({ ...JSON.parse(JSON.stringify(m)), list: { page: 1, rows: 10, first: m.list!.first, step: 0.5 } });
    expect(bad.ok && bad.mapping.list).toBeUndefined();
  });

  it("答えの list は頁ごとの読み取りを通って対応表に（偽の client。切れた答えからは list を拾わない）", async () => {
    const sqlite: DatabaseSync = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    try {
      const db = d1FromSqlite(sqlite);
      const answer = listRead(20);
      const claude: ClaudeClient = {
        beta: {
          messages: {
            create: async (p) =>
              ({
                id: "m",
                type: "message",
                role: "assistant",
                model: OPUS,
                content: [{ type: "text", text: pageReadReply(answer, p), citations: null }],
                stop_reason: "end_turn",
                stop_details: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
              }) as unknown as Anthropic.Beta.Messages.BetaMessage,
          },
        },
      };
      const ctx: AskJsonContext = { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(db), office: { id: "office-demo", kind: "demo" }, claude };
      const file: FormFile = { kind: "image", attachment: { kind: "image", mediaType: "image/jpeg", data: "AA==" }, bytes: 2 };
      const out = await readForm([file], ctx);
      expect(out.mapping.list?.rows).toBe(20);
      expect(toPageRead(answer, 1).list?.rows).toBe(20);
      expect(toPageRead(answer, 2).list).toBeNull();
      const cut = JSON.stringify(toPageRead(answer, 1));
      expect(salvagePageRead(cut.slice(0, cut.indexOf('"list"') - 30))?.list ?? null).toBeNull();
      expect(new AiTruncated("x", OPUS).reason).toBe("max_tokens");
    } finally {
      sqlite.close();
    }
  });

  const listSheets = (people: string[], rows = 2): OverlaySheet[] => {
    const m = checkReadResult(listRead(rows)).mapping;
    return people.map((id) => buildOverlaySheet(buildMappedSheet(seedRows(P(id)), m, OPTS), IMG));
  };

  it("1 人ずつの紙は 1 行目に置き、何人かをまとめた紙は行ごとに 1 人。行の数を超えたら枚を足す。表の外の欄は枚ごとに 1 回", () => {
    const sheets = listSheets(["p-01", "p-02", "p-03"], 2);
    expect(sheets.every(isListSheet)).toBe(true);
    const nameItem = (s: OverlaySheet, label: string) => s.pages[0].items.filter((i) => i.kind === "text" && i.lines.join("").includes(label));
    expect(nameItem(sheets[0], P("p-01").person.name)[0].box.y).toBe(ROW_Y);
    const merged = mergeListSheets(sheets);
    expect(merged).toHaveLength(2);
    expect(nameItem(merged[0], P("p-01").person.name)[0].box.y).toBe(ROW_Y);
    expect(nameItem(merged[0], P("p-02").person.name)[0].box.y).toBe(ROW_Y + ROW_H);
    expect(nameItem(merged[1], P("p-03").person.name)[0].box.y).toBe(ROW_Y);
    // 事業所名（表の外）は枚ごとに 1 つ
    expect(nameItem(merged[0], "デモ事業所")).toHaveLength(1);
    expect(merged[0].name).toBe("2 人");
  });

  it("一括印刷: 続いて並ぶ同じ対応表の一覧の紙をまとめる。ほかの紙はそのまま", () => {
    const sheets = listSheets(["p-01", "p-02", "p-03"], 10);
    const papers: BatchPaper[] = sheets.map((sheet) => ({ kind: "overlay", personId: sheet.personId, sheet, mappingId: "fm-list", checked: "", imageSrc: () => "", fill: false }));
    const grouped = groupListPapers(papers);
    expect(grouped).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(PaperBatch, { papers }));
    for (const id of ["p-01", "p-02", "p-03"]) expect(html).toContain(P(id).person.name);
    // 一覧でない紙は 1 人 1 枚のまま
    const one: FormMapping = { title: "様式", issuer: "", pages: 1, fields: [field({ label: "氏名", item: "person.name", box: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 } })] };
    const plain = ["p-01", "p-02"].map((id) => buildOverlaySheet(buildMappedSheet(seedRows(P(id)), one, OPTS), IMG));
    expect(groupListPapers(plain.map((sheet) => ({ kind: "overlay", personId: sheet.personId, sheet, mappingId: "fm-one", checked: "", imageSrc: () => "", fill: false })))).toHaveLength(2);
  });

  it("様式 9 を読んだ対応表は専用の紙へ案内する（題とひな形の列の見出し）。ほかの一覧はしない", () => {
    expect(FORM9_PAPER_PATH).toBe(FORM9_PATH);
    const heads = FORM9_HEADS.filter((h) => !["優先順位※", "想定される避難場所"].includes(h.text));
    const m9: FormMapping = {
      title: "様式9：災害時利用者一覧表 (安否確認優先順位)",
      issuer: "",
      pages: 1,
      fields: heads.map((h) => field({ label: h.text.replace("\n", "") })),
      list: { page: 1, rows: 20, first: { x: 0, y: 0.2, w: 1, h: 0.03 }, step: 0.03 },
    };
    expect(isForm9Like(m9)).toBe(true);
    expect(isForm9Like({ ...m9, list: undefined })).toBe(false);
    expect(isForm9Like(checkReadResult(listRead()).mapping)).toBe(false);
    // 確かめの画面: 一覧の行の数と、様式 9 なら専用の紙へ
    const html = renderToStaticMarkup(createElement(MappingEditor, { id: "fm-9", version: 1, status: "draft", initial: m9 }));
    expect(html).toContain("一覧");
    expect(html).toContain("20 行");
    expect(html).toContain('href="/office/form9"');
    expect(html).toContain("data-form9-paper");
    const other = renderToStaticMarkup(createElement(MappingEditor, { id: "fm-1", version: 1, status: "draft", initial: checkReadResult(listRead()).mapping }));
    expect(other).not.toContain("data-form9-paper");
  });

  it("事業所名と担当ケアマネは別々の項目（様式 9 の列）。計画作成者は両方を 1 つに", () => {
    const keys = itemCatalog().map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["plan.office", "plan.careManager", "plan.author"]));
    const fs = [field({ label: "事業所名", item: "plan.office" }), field({ label: "担当ケアマネ", item: "plan.careManager" })];
    const s = buildMappedSheet(seedRows(P("p-01")), { title: "様式", issuer: "", pages: 1, fields: fs }, OPTS);
    const text = s.pages[0].sections.flatMap((x) => x.rows).map((r) => (r.cell.kind === "value" ? r.cell.lines.flat().map((p) => p.text).join("") : ""));
    expect(text).toEqual(["デモ事業所", "山本"]);
  });
});

// ---------- 実在の様式の読み違いと紙のずれ ----------

const ons = (c: Cell | undefined) => (c?.kind === "choice" ? c.options.filter((o) => o.on).map((o) => o.label) : null);
function cellsOf(person: ReturnType<typeof P>, fields: MappingField[]): Map<string, Cell> {
  const s = buildMappedSheet(seedRows(person), { title: "様式", issuer: "", pages: 1, fields }, OPTS);
  return new Map(s.pages.flatMap((p) => p.sections.flatMap((x) => x.rows.map((r) => [r.field.id, r.cell] as const))));
}

describe("実在の様式の読み違いと紙のずれ（T131、評価の 3 回目の 4）", () => {
  it("決まり: 1 つの書く所に名前が 2 つなら名前ごとに欄・同じ box、種類の □ と名前の所は行の欄の名前、医療の人が書く段はまとめる、避難場所ごとの手段", () => {
    expect(FORM_READ_SYSTEM).toContain("名前ごとに別々の欄にし、どちらの box も同じ書く所にする");
    expect(FORM_READ_SYSTEM).toContain("その行の欄の名前（左の名前の列の字。例「避難先１」）");
    expect(FORM_READ_SYSTEM).toContain("□ を 1 つずつ別の欄（check）に挙げない");
    expect(FORM_READ_SYSTEM).toContain("段ごとに 1 欄（label は段の見出しの字、shape handwrite、item null、box は段全体）にまとめる");
    expect(FORM_READ_SYSTEM).toContain("19. 避難場所が何行か並び");
    // 特定の自治体の欄の名前を決まりに書かない（ほかの様式でも効く形）
    expect(FORM_READ_SYSTEM).not.toContain("かかりつけ医・薬局");
  });

  it("1 つの書く所に 2 つの欄: 字が重ならないよう、欄の順に行を重ねて 1 つに置く", () => {
    const box = { x: 0.2, y: 0.1, w: 0.6, h: 0.12 };
    const doc = field({ label: "主治医", item: "medical.doctor", box, shape: "lines" });
    const med = field({ label: "服薬の情報", item: "medical.medications", box: { ...box, w: box.w - 0.001 }, shape: "lines" });
    const m: FormMapping = { title: "様式", issuer: "", pages: 1, fields: [doc, med] };
    const s = buildOverlaySheet(buildMappedSheet(seedRows(P("p-01")), m, OPTS), IMG);
    const items = s.pages[0].items.filter((i) => i.kind === "text");
    expect(items).toHaveLength(1);
    const meds = SEED_PEOPLE.find((p) => p.person.id === "p-01")!.ledger.medical.medications;
    expect(items[0].kind === "text" && items[0].lines.join("")).toContain(meds[0].name);
  });

  it("名前と電話の列: 名前の欄（民生委員）の電話を、同じ行の右の電話の列（項目なし）に置く", () => {
    const person = SEED_PEOPLE.find((p) => p.contacts.some((c) => c.kind === "welfare_commissioner" && c.phone))!;
    const nameF = field({ label: "民生委員", item: "people.welfare", box: { x: 0.5, y: 0.2, w: 0.12, h: 0.02 } });
    const telF = field({ label: "TEL(携帯)", item: null, shape: "phone", box: { x: 0.7, y: 0.2, w: 0.15, h: 0.02 } });
    const other = field({ label: "TEL", item: null, shape: "phone", box: { x: 0.7, y: 0.4, w: 0.15, h: 0.02 } });
    const m: FormMapping = { title: "様式", issuer: "", pages: 1, fields: [nameF, telF, other] };
    const mapped = buildMappedSheet(seedRows(person), m, OPTS);
    expect([...telColumns(mapped.pages[0].sections.flatMap((x) => x.rows)).entries()].map(([k, v]) => [k, v.field.id])).toEqual([[nameF.id, telF.id]]);
    const s = buildOverlaySheet(mapped, IMG);
    const at = (id: string) => s.pages[0].items.find((i) => i.kind === "text" && i.fieldId === id);
    const tel = person.contacts.find((c) => c.kind === "welfare_commissioner")!.phone!;
    const nameText = at(nameF.id);
    expect(nameText?.kind === "text" && nameText.lines.join("")).not.toContain(tel);
    const telText = at(telF.id);
    expect(telText?.kind === "text" && telText.lines.join("")).toContain(tel);
    expect(s.annex).toEqual([]);
    expect(s.pages[0].fills.some((f) => f.keys.includes(telF.id))).toBe(false);
  });

  it("避難場所ごとの手段: 避難先2・最寄りの手段の項目、避難場所の無い人は空き枠。避難先1 の手段は選ぶ欄の □ に", () => {
    const p = P("p-01");
    const person = {
      ...p,
      ledger: {
        ...structuredClone(p.ledger),
        evacuation: { ...p.ledger.evacuation, destination2: "長女宅", destination2Means: "family_car" as const, nearest: undefined, nearestMeans: undefined, transportKind: "foot" as const },
      },
    };
    const pre = field({ label: "【手段】", item: "evacuation.destination2Means" });
    const near = field({ label: "【手段】", item: "evacuation.nearestMeans" });
    const city = field({ label: "【手段】", item: "evacuation.transport", shape: "choice", options: ["徒歩", "家族の車", "その他"] });
    const c = cellsOf(person, [pre, near, city]);
    const pc = c.get(pre.id);
    expect(pc?.kind === "value" && pc.lines.flat().map((x) => x.text).join("")).toBe("家族の車");
    expect(c.get(near.id)?.kind).toBe("empty");
    expect(ons(c.get(city.id))).toEqual(["徒歩"]);
  });
});

describe("薬の区分の □（T131、評価の 3 回目の 4）: 専用の紙と同じ印", () => {
  // 災害診療記録2018 の【特記事項（常用薬等）】の □（ケア72 の専用の紙 lib/forms/medical-summary.ts の欄と選択肢）
  const KIROKU_DRUG_BOXES: Array<{ key: "drug.antiplatelet" | "drug.anticoagulant" | "drug.diabetes" | "drug.steroid" | "drug.antiepileptic" | "drug.other"; option: string }> = [
    { key: "drug.antiplatelet", option: "抗血小板薬" },
    { key: "drug.anticoagulant", option: "抗凝固薬" },
    { key: "drug.anticoagulant", option: "ワーファリン" },
    { key: "drug.diabetes", option: "糖尿病治療薬" },
    { key: "drug.diabetes", option: "インスリン" },
    { key: "drug.diabetes", option: "経口薬" },
    { key: "drug.steroid", option: "ステロイド" },
    { key: "drug.antiepileptic", option: "抗てんかん薬" },
    { key: "drug.other", option: "その他" },
  ];

  it("種の 10 人と薬の区分を足した人で、□ ごとに常用薬を当てた紙の印が専用の紙の印と同じ", () => {
    const extra = (() => {
      const p = P("p-01");
      return {
        ...p,
        person: { ...p.person, id: "p-x" },
        ledger: {
          ...structuredClone(p.ledger),
          pending: [],
          medical: {
            ...p.ledger.medical,
            medications: [
              { name: "ワーファリン", category: "anticoagulant" as const },
              { name: "インスリン注", category: "insulin" as const },
              { name: "降圧薬", category: "other" as const },
            ],
          },
        },
      };
    })();
    let compared = 0;
    for (const person of [...SEED_PEOPLE, extra]) {
      const rows = seedRows(person);
      const med = buildMedicalSummary(rows, OPTS);
      if (med.kind !== "sheet") continue;
      if (person.ledger.pending.some((x) => x.field.startsWith("medical.medications"))) continue;
      const fields = KIROKU_DRUG_BOXES.map((b) => field({ label: b.option, item: "medical.medications", shape: "check" }));
      const c = cellsOf(person, fields);
      KIROKU_DRUG_BOXES.forEach((b, i) => {
        const cell = c.get(fields[i].id);
        if (cell?.kind === "withheld") return;
        const want = med.sheet.cells[b.key];
        const on = want.kind === "choice" ? want.options.find((o) => o.label === b.option)?.on ?? false : false;
        expect([person.person.id, b.option, (ons(cell) ?? []).length > 0]).toEqual([person.person.id, b.option, on]);
        compared += 1;
      });
    }
    expect(compared).toBeGreaterThan(30);
  });
});
