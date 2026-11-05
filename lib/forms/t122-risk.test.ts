// T122: 確かめの画面で先に見る欄（要確認）と、確認するまで紙に使わない形（保留）。評価の 2 回目で読み違いの多かった欄の種類
// （複数選択の □ の並びを □ ごとに分けた・機器の種類の □ を項目なし・元号だけの欄）と、自信の低い欄・台帳の項目なしの欄。
// 画面は描いた HTML で確かめる（ブラウザは使わない）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MappingEditor } from "../../components/forms/mapping/MappingEditor.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { fieldRisks, heldFields, openRisks, riskOrder } from "./field-risk.ts";
import { checkReadResult, parseMappingInput, type FormMapping, type ReadResult } from "./mapping.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { seedRows } from "./print-harness.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

type F = ReadResult["fields"][number];
const f = (over: Partial<F>): F => ({ page: 1, section: "", label: "", position: "", shape: "text", options: [], item: null, confidence: "high", reason: "", ...over });

/** 評価の 2 回目の本物の読み方の形（架空の欄の並び。値は無い） */
const read: ReadResult = {
  title: "様式",
  issuer: "",
  pages: 1,
  typeface: "gothic",
  fields: [
    f({ label: "氏名", item: "person.name" }),
    f({ label: "大正・昭和・平成・令和", shape: "choice", options: ["大正", "昭和", "平成", "令和"], confidence: "low", reason: "元号" }),
    f({ label: "生年月日", shape: "date", item: "person.birth" }),
    // 自宅のリスク（複数選択可）を □ ごとに分けて、1 つ目だけ項目
    f({ section: "自宅のリスク", label: "洪水", shape: "check", item: "evacuation.hazards", confidence: "medium" }),
    f({ section: "自宅のリスク", label: "土砂災害", shape: "check", confidence: "low", reason: "同じ項目を重ねない" }),
    // 機器の種類の □ を項目なし
    f({ section: "特記事項", label: "在宅酸素療法（HOT）", shape: "check", confidence: "low" }),
    f({ label: "住居 種別", shape: "choice", options: ["戸建", "集合"], item: "basic.housing.type", confidence: "low" }),
    f({ label: "受付番号", confidence: "high", reason: "市が書く" }),
    f({ label: "本人：氏名（自署）", shape: "handwrite" }),
  ],
};
const mapping = () => checkReadResult(read).mapping;

describe("要確認の欄（T122）", () => {
  it("訳: 元号・複数選択・種類欄・自信低・項目なし。手書きと自信の高い項目ありは要確認でない", () => {
    const r = fieldRisks(mapping().fields);
    expect(Object.fromEntries(r)).toEqual({ f2: "era", f4: "multi", f5: "multi", f6: "kind", f7: "low", f8: "none" });
  });

  it("要確認順: 重い訳から、同じ訳は様式の順、要確認でない欄は後ろ。確認した欄も後ろ", () => {
    const m = mapping();
    expect(riskOrder(m.fields).map((x) => x.id)).toEqual(["f4", "f5", "f6", "f2", "f7", "f8", "f1", "f3", "f9"]);
    const done = m.fields.map((x) => (x.id === "f4" ? { ...x, confirmed: true } : x));
    expect(riskOrder(done).map((x) => x.id).slice(0, 2)).toEqual(["f5", "f6"]);
    expect(openRisks({ fields: done })).toBe(5);
  });

  it("保留: 確認していない要確認の項目ありの欄を紙に使わない（未確認）。確認すれば使う", () => {
    const p = SEED_PEOPLE.find((x) => x.person.id === "p-01")!;
    const base = mapping();
    const held: FormMapping = { ...base, holdRisky: true };
    expect([...heldFields(held)].sort()).toEqual(["f4", "f7"]);
    const cellOf = (m: FormMapping, id: string) =>
      buildMappedSheet(seedRows(p), m, { today: "2026-11-05", officeName: "デモ事業所" })
        .pages.flatMap((x) => x.sections.flatMap((s) => s.rows))
        .find((r) => r.field.id === id)!.cell;
    const on = (c: ReturnType<typeof cellOf>) => c.kind === "choice" && c.options.some((o) => o.on);
    expect(on(cellOf(base, "f4"))).toBe(true);
    expect(on(cellOf(held, "f4"))).toBe(false);
    const ok: FormMapping = { ...held, fields: held.fields.map((x) => (x.id === "f4" ? { ...x, confirmed: true } : x)) };
    expect(on(cellOf(ok, "f4"))).toBe(true);
    // 保留を選ばなければ今まで通り
    expect(heldFields(base).size).toBe(0);
  });

  it("保存の形に確認と保留が残る", () => {
    const m = { ...mapping(), holdRisky: true };
    m.fields[3] = { ...m.fields[3], confirmed: true };
    const parsed = parseMappingInput(JSON.parse(JSON.stringify(m)));
    expect(parsed.ok && parsed.mapping.holdRisky).toBe(true);
    expect(parsed.ok && parsed.mapping.fields[3].confirmed).toBe(true);
    expect(parsed.ok && parsed.mapping.fields[4].confirmed).toBeUndefined();
  });
});

describe("確かめの画面の要確認（T122）", () => {
  it("下書きは要確認順で、要確認の数・訳・確認・保留・並びの切り替え", () => {
    const html = renderToStaticMarkup(createElement(MappingEditor, { id: "fm-1", version: 1, status: "draft", initial: mapping() }));
    expect(html).toContain('data-risks="6"');
    expect(html).toContain('data-confirm="f4"');
    expect(html).toContain("複数選択");
    expect(html).toContain("種類欄");
    expect(html).toContain("元号");
    expect(html).toContain('data-hold="0"');
    expect(html).toContain('data-order="risk"');
    // 要確認順: 最初の行は複数選択の欄
    const firstRow = html.match(/<tr[^>]*data-field="(f\d+)"/)?.[1];
    expect(firstRow).toBe("f4");
  });

  it("確認保存した対応表は様式順。保留を選んだ対応表は確認していない項目ありの欄に「保留」", () => {
    const m = { ...mapping(), holdRisky: true };
    const html = renderToStaticMarkup(createElement(MappingEditor, { id: "fm-1", version: 2, status: "checked", initial: m }));
    expect(html.match(/<tr[^>]*data-field="(f\d+)"/)?.[1]).toBe("f1");
    expect(html).toContain('data-hold="1"');
    const row = html.slice(html.indexOf('data-risk-tag="f7"'), html.indexOf('data-confirm="f7"'));
    expect(row).toContain("保留");
  });
});
