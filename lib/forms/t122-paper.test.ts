// T122: 実在の様式の欄の読み違い（評価の 2 回目、docs/progress/eval-r2-forms-findings.md の 2）の紙の側と読み取りの決まり。
// - 複数選択の □ の並び（自宅のリスク・支援の内容・既往症）を 1 欄で読んだときに、合う選択肢の全部に印（前は 1 つだけ）
// - □ ごとに種類を問う欄（在宅酸素療法・透析の □）に医療機器を当てたとき、台帳の種類と合う □ だけに印（前は機器が 1 つでもあれば全部）
// - 読み取りの決まりと欄の説明に、評価で外れの多かった欄の種類の決まり
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { FORM_READ_SYSTEM } from "./form-read.ts";
import { itemCatalog, type FormMapping, type MappingField } from "./mapping.ts";
import { buildMappedSheet, wordMatches } from "./mapped-sheet.ts";
import type { Cell } from "./matsuyama.ts";
import { buildOverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";

const P = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };

let n = 0;
const field = (over: Partial<MappingField>): MappingField => ({
  id: `f${++n}`,
  page: 1,
  section: "",
  label: "",
  position: "",
  shape: "check",
  options: [],
  item: null,
  removed: false,
  ai: null,
  ...over,
});

function cells(person: ReturnType<typeof P>, fields: MappingField[]): Map<string, Cell> {
  const m: FormMapping = { title: "様式", issuer: "", pages: 1, fields };
  const s = buildMappedSheet(seedRows(person), m, OPTS);
  return new Map(s.pages.flatMap((p) => p.sections.flatMap((x) => x.rows.map((r) => [r.field.id, r.cell] as const))));
}
const ons = (c: Cell | undefined) => (c?.kind === "choice" ? c.options.filter((o) => o.on).map((o) => o.label) : null);

describe("複数選択の欄は合う選択肢の全部に印（T122）", () => {
  it("自宅のリスク（複数選択可）: 浸水と土砂の人は 洪水・土砂災害 の 2 つ", () => {
    const p = P("p-01");
    const person = { ...p, ledger: { ...structuredClone(p.ledger), evacuation: { ...p.ledger.evacuation, hazards: [{ kind: "flood" as const }, { kind: "landslide" as const }] } } };
    const f = field({ label: "自宅のリスク（複数選択可）", shape: "choice", options: ["土砂災害", "洪水", "高潮", "津波", "地震"], item: "evacuation.hazards" });
    expect(ons(cells(person, [f]).get(f.id))).toEqual(["土砂災害", "洪水"]);
  });

  it("支援の内容・既往症も同じ。合う物が無ければ選択肢は □ のまま値を後ろに", () => {
    const p = P("p-01");
    const person = {
      ...p,
      ledger: {
        ...structuredClone(p.ledger),
        evacuation: { ...p.ledger.evacuation, support: ["call" as const, "assist" as const] },
        medical: { ...p.ledger.medical, history: ["高血圧", "糖尿病"] },
      },
    };
    const sup = field({ label: "支援の内容（複数選択可）", shape: "choice", options: ["避難の声掛け", "避難の誘導", "移動介助", "その他"], item: "evacuation.support" });
    const his = field({ label: "既往症", shape: "choice", options: ["高血圧", "糖尿病", "喘息", "その他"], item: "medical.history" });
    const none = field({ label: "既往症", shape: "choice", options: ["心臓病", "腎臓病"], item: "medical.history" });
    const c = cells(person, [sup, his, none]);
    expect(ons(c.get(sup.id))).toEqual(["避難の声掛け", "移動介助"]);
    expect(ons(c.get(his.id))).toEqual(["高血圧", "糖尿病"]);
    const nc = c.get(none.id);
    expect(ons(nc)).toEqual([]);
    expect(nc?.kind === "choice" && nc.after?.length).toBeTruthy();
  });

  it("あり・なしの欄: 医療機器のある人は あり、無い人は なし", () => {
    const f = field({ label: "医療機器", shape: "choice", options: ["あり", "なし"], item: "medical.devices" });
    expect(ons(cells(P("p-02"), [f]).get(f.id))).toEqual(["あり"]);
    expect(ons(cells(P("p-04"), [f]).get(f.id))).toEqual(["なし"]);
  });

  it("元の様式の上の紙も、選んだ選択肢の全部の □ に印", () => {
    const p = P("p-01");
    const person = { ...p, ledger: { ...structuredClone(p.ledger), evacuation: { ...p.ledger.evacuation, hazards: [{ kind: "flood" as const }, { kind: "tsunami" as const }] } } };
    const opts = ["土砂災害", "洪水", "高潮", "津波", "地震"];
    const f = field({
      label: "自宅のリスク（複数選択可）",
      shape: "choice",
      options: opts,
      item: "evacuation.hazards",
      box: { x: 0.1, y: 0.3, w: 0.6, h: 0.03 },
      optionBoxes: opts.map((_, i) => ({ x: 0.1 + i * 0.1, y: 0.305, w: 0.02, h: 0.02 })),
    });
    const m: FormMapping = { title: "様式", issuer: "", pages: 1, fields: [f] };
    const img: PageImage[] = [{ page: 1, width: 1413, height: 2000, bytes: 1 }];
    const s = buildOverlaySheet(buildMappedSheet(seedRows(person), m, OPTS), img);
    const marks = s.pages[0].items.filter((i) => i.kind === "mark" && i.fieldId === f.id).map((i) => i.box.x);
    expect(marks).toEqual([0.2, 0.4]);
  });
});

describe("□ ごとに種類を問う欄（T122）", () => {
  // 災害診療記録の【特記事項（常用薬等）】の形（ケア72 の lib/forms/medical-summary.ts の欄の名前）
  const hot = () => field({ label: "在宅酸素療法（HOT）", item: "medical.devices" });
  const dia = () => field({ label: "透析", item: "medical.devices" });
  const vent = () => field({ label: "人工呼吸器", item: "medical.devices" });
  const any = () => field({ label: "医療機器の使用", item: "medical.devices" });
  const anti = () => field({ label: "抗凝固薬", item: "medical.medications" });
  const ins = () => field({ label: "インスリン", item: "medical.medications" });

  it("在宅酸素の人: 在宅酸素療法の □ だけ。透析・人工呼吸器の □ は空ける。種類でない □ は今まで通り有無", () => {
    const fs = [hot(), dia(), vent(), any()];
    const c = cells(P("p-01"), fs);
    expect(fs.map((f) => ons(c.get(f.id))?.length)).toEqual([1, 0, 0, 1]);
  });

  it("透析の人は透析の □、人工呼吸器と吸引の人は人工呼吸器の □", () => {
    const a = [hot(), dia(), vent()];
    const c3 = cells(P("p-03"), a);
    expect(a.map((f) => ons(c3.get(f.id))?.length)).toEqual([0, 1, 0]);
    const b = [hot(), dia(), vent()];
    const c2 = cells(P("p-02"), b);
    expect(b.map((f) => ons(c2.get(f.id))?.length)).toEqual([0, 0, 1]);
  });

  it("薬の区分の □: 抗凝固薬の人は抗凝固薬だけ", () => {
    const fs = [anti(), ins()];
    const c = cells(P("p-01"), fs);
    expect(fs.map((f) => ons(c.get(f.id))?.length)).toEqual([1, 0]);
  });

  it("言葉の合わせ方（括弧・空白の揺れ、片方がもう片方を含む）", () => {
    expect(wordMatches("在宅酸素療法（HOT）", ["在宅酸素"])).toBe(true);
    expect(wordMatches("洪水", ["浸水", "洪水"])).toBe(true);
    expect(wordMatches("避難の声掛け", ["声掛け"])).toBe(true);
    expect(wordMatches("地震", ["浸水", "洪水"])).toBe(false);
    expect(wordMatches("", ["浸水"])).toBe(false);
  });
});

describe("読み取りの決まりと欄の説明（T122）", () => {
  it("評価で外れの多かった欄の種類の決まりがある", () => {
    expect(FORM_READ_SYSTEM).toContain("「複数選択可」「あてはまるものすべて」の □ の並びでも");
    expect(FORM_READ_SYSTEM).toContain("1 つの欄にまとめず、別々の欄にする");
    expect(FORM_READ_SYSTEM).toContain("□ ごとに同じ項目（医療機器・常用薬）を当てる");
    expect(FORM_READ_SYSTEM).toContain("元号だけの欄を別に挙げない");
    // T131 で「〇〇 種類」の 1 欄に □ の選択肢を全部（□ を 1 つずつ check に挙げない）に書き直した
    expect(FORM_READ_SYSTEM).toContain("種類の □ は「〇〇 種類」の名前の 1 欄");
  });

  it("欄の説明: 別紙・医薬品情報・複数選択の項目", () => {
    const hint = (k: string) => itemCatalog().find((i) => i.key === k)?.hint ?? "";
    expect(hint("medical.annex")).toContain("別紙 あり・なし");
    expect(hint("medical.medications")).toContain("医薬品情報");
    expect(hint("medical.doctor")).toContain("医薬品情報の欄とは別");
    expect(hint("evacuation.hazards")).toContain("1 つの欄");
    expect(hint("medical.devices")).toContain("□ ごとにこの項目");
  });
});
