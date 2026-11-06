// T175: 読み取りの揺れを数える口（tools/eval/forms/drift.ts）。架空の記録の形で確かめる
import { describe, expect, it } from "vitest";
import { GUARDS, guardFindings } from "../guards.ts";
import { itemOf, valuesOf } from "../scorecard-items.ts";
import { countsByForm, diffReads, driftMarkdown, fieldsOfCalls, normLabel, reviewDrift, type DriftField } from "./drift.ts";

const page = (fields: Array<Partial<DriftField>>) =>
  JSON.stringify({
    sections: [{ name: "段", fields: fields.map((f) => ({ label: "欄", shape: "text", item: null, options: [], box: [0.1, 0.1, 0.2, 0.05], ...f })) }],
  });
const call = (input: string, text: string, stage = "form_read") => ({ input, stage, response: { text } });

describe("T175 読み取りの差の分類", () => {
  it("記録の返事を様式ごとの欄に。選択肢の当ての答え・ほかの段・切れた答えは飛ばす。頁は順に数える", () => {
    const got = fieldsOfCalls([
      call("a", `[thinking]${page([{ label: "氏名" }])}`),
      call("a", '{"fields":[]}'),
      call("a", page([{ label: "住所" }])),
      call("b", '{"sections":[{"name":"途中'),
      call("a", page([{ label: "読まない" }]), "form_review"),
    ]);
    expect(got.get("a")?.map((f) => [f.page, f.label])).toEqual([
      [1, "氏名"],
      [2, "住所"],
    ]);
    expect(got.has("b")).toBe(false);
  });

  it("名前の表記の差は同じ物に数える", () => {
    expect(normLabel("1　徒歩")).toBe(normLabel("徒歩"));
    expect(normLabel("地　震")).toBe("地震");
    expect(normLabel("＊患者氏名（カタカナ）")).toBe(normLabel("患者氏名(カタカナ)"));
  });

  it("名前・項目・形・位置・選択肢・片方だけの欄を分けて数える", () => {
    const f = (o: Partial<DriftField>): DriftField => ({ page: 1, section: "", label: "欄", shape: "text", item: null, options: [], box: [0.1, 0.1, 0.2, 0.05], ...o });
    const d = diffReads(
      [
        f({ label: "同じ", box: [0, 0, 0.1, 0.1] }),
        f({ label: "名前A", box: [0.2, 0, 0.1, 0.1] }),
        f({ label: "項目", item: "a", box: [0.4, 0, 0.1, 0.1] }),
        f({ label: "形", box: [0.6, 0, 0.1, 0.1] }),
        f({ label: "位置", box: [0.8, 0, 0.05, 0.05] }),
        f({ label: "選択肢", shape: "choice", options: ["1 あり"], box: [0, 0.2, 0.1, 0.1] }),
        f({ label: "Aだけ", box: [0, 0.8, 0.1, 0.1] }),
      ],
      [
        f({ label: "同じ", box: [0, 0, 0.1, 0.1] }),
        f({ label: "名前B", box: [0.2, 0, 0.1, 0.1] }),
        f({ label: "項目", item: "b", box: [0.4, 0, 0.1, 0.1] }),
        f({ label: "形", shape: "lines", box: [0.6, 0, 0.1, 0.1] }),
        f({ label: "位置", box: [0.8, 0.5, 0.05, 0.05] }),
        f({ label: "選択肢", shape: "choice", options: ["なし"], box: [0, 0.2, 0.1, 0.1] }),
        f({ label: "Bだけ", box: [0.5, 0.8, 0.1, 0.1] }),
      ],
    );
    expect(d).toMatchObject({ a: 7, b: 7, same: 1, onlyA: 1, onlyB: 1, label: 1, item: 1, shape: 1, box: 1, options: 1 });
  });

  it("見直しの差は様式ごとの差の絶対値の合計。片方の回に無い様式は比べない", () => {
    const paper = (form: string, check: number, duplicate: number, unplaced = 0) => ({ form, look: { unplaced }, review: { rule: { check, kinds: { duplicate } } } });
    const a = [paper("x", 3, 2, 1), paper("x", 1, 1), paper("y", 5, 0), paper("only-a", 9, 9)];
    const b = [paper("x", 2, 0), paper("y", 7, 1, 2), paper("only-b", 9, 9)];
    expect(countsByForm(a).get("x")).toMatchObject({ check: 4, duplicate: 3, unplaced: 1 });
    expect(reviewDrift(a, b)).toMatchObject({ check: 4, duplicate: 4, unplaced: 3 });
    expect(reviewDrift(a, b, ["y"])).toMatchObject({ check: 2, duplicate: 1, unplaced: 2 });
    const md = driftMarkdown({ calls: new Map(), papers: a }, { calls: new Map(), papers: b });
    expect(md).toContain("| x |");
    expect(md).not.toContain("only-a");
    expect(md).toContain("要確認 4");
  });
});

describe("T175 守りと点数の表", () => {
  const paper = (check: number) => ({ form: "x", input: "i", kind: "ledger", score: null, files: {}, look: { unplaced: 0, blanks: 0, overlap: 0, outside: 0 }, review: { rule: { fix: 0, check, note: 0, kinds: {} }, ai: null } });
  const result = (check: number, drift?: number) =>
    ({ run: "r10", mode: "real", forms: [], inputs: [], papers: [paper(check)], calls: {}, leaks: {}, ...(drift !== undefined ? { drift: { from: "前", check: drift, duplicate: 0, carried: 0, small: 0, unplaced: 0 } } : {}) }) as never;
  const values = (r: never) => valuesOf({ bench: "forms", run: "r10", client: "real", data: r });

  it("要確認の差は比べた回だけ数が入る", () => {
    expect(itemOf("forms.reviewDrift")?.better).toBe("lower");
    expect(values(result(10))["forms.reviewDrift"] ?? null).toBeNull();
    expect(values(result(10, 4))["forms.reviewDrift"]).toBe(4);
  });

  it("守りは数え直しの悪い方の数で、外れたら指摘になる", () => {
    const ids = GUARDS.filter((g) => g.task === "T175").map((g) => [g.id, g.item, g.value]);
    expect(ids).toEqual([
      ["forms-review-check", "forms.reviewCheck", 605],
      ["forms-unplaced-limit", "forms.unplaced", 166],
      ["forms-review-drift", "forms.reviewDrift", 257],
    ]);
    const out = guardFindings({ bench: "forms", run: "r10", values: { "forms.reviewCheck": 606, "forms.unplaced": 166, "forms.reviewDrift": 258 }, counts: {}, repro: [] }).map((f) => f.rule);
    expect(out).toContain("guard:forms-review-check");
    expect(out).toContain("guard:forms-review-drift");
    expect(out).not.toContain("guard:forms-unplaced-limit");
  });
});
