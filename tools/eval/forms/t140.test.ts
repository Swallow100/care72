// T140 の評価の台の直し:
// - 正解の表: あおぞら市の担当ケアマネは担当ケアマネの項目、様式 9 の列の場所は台が AI に見せる描き方（lib/ooxml）の列、
//   災害診療記録の連絡先は種類の □ の選ぶ欄（緊急連絡先 1 の関係）
// - 一覧の URL から取りに行って取れなかった様式の理由（前は「--catalog-fetch なし」と出た）

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FORM9_PAGE_MM } from "../../../lib/forms/frame-form9.ts";
import { allMunicipalEntries, availability } from "../../../lib/forms/municipal-forms.ts";
import { GOLD_FORMS } from "./gold.ts";
import { runEval } from "./run.ts";

const root = mkdtempSync(join(tmpdir(), "care72-eval-t140-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("正解の表（T140）", () => {
  const form = (id: string) => GOLD_FORMS.find((g) => g.id === id)!;

  it("あおぞら市の担当ケアマネは担当ケアマネの項目（計画作成者は別解）", () => {
    const g = form("aozora").fields.find((f) => f.label === "担当ケアマネ")!;
    expect(g.item).toBe("plan.careManager");
    expect(g.accept).toEqual(["plan.author"]);
  });

  it("様式 9 の列の場所は描き方の列（Yu Gothic 11pt の数字の幅 × 列幅 × 73%）。担当ケアマネは特記の右の列", () => {
    const f9 = form("form9");
    const mm = (label: string) => {
      const b = f9.fields.find((f) => f.label === label)!.box!;
      return [Math.round(b.x * FORM9_PAGE_MM.w * 10) / 10, Math.round((b.x + b.w) * FORM9_PAGE_MM.w * 10) / 10];
    };
    // 描いた頁の縦の罫線（lib/ooxml で描いた様式 9 の頁から測った物）: 19.4 24.6 42.1 52.9 63.7 76.8 98.2 139.6 157.9 176.1 213.3 227.3 239
    expect(mm("No")).toEqual([19.4, 24.6]);
    expect(mm("特記")).toEqual([176.1, 213.3]);
    expect(mm("担当ケアマネ")).toEqual([213.3, 227.3]);
    expect(mm("安否確認できた日")).toEqual([227.3, 238.9]);
  });

  it("災害診療記録の連絡先は種類の □（家族・知人・その他・連絡先なし）の選ぶ欄で、緊急連絡先 1 の関係", () => {
    const g = form("kiroku").fields.find((f) => f.label === "連絡先")!;
    expect(g.item).toBe("emergency1.relation");
    expect(g.shape).toBe("choice");
    expect(g.options).toEqual(["家族", "知人", "その他", "連絡先なし"]);
    expect(g.optionBoxes).toHaveLength(4);
    // 書く所は □ の並びと連絡先の人の書く所を合わせた行。□ は全部その中
    for (const b of g.optionBoxes!) {
      expect(b.x).toBeGreaterThanOrEqual(g.box!.x);
      expect(b.x + b.w).toBeLessThanOrEqual(g.box!.x + g.box!.w);
    }
  });
});

describe("一覧の URL から取れなかった理由（T140）", () => {
  const base = { mode: "fake" as const, fakeStyle: "noisy" as const, outRoot: root, corpusRoot: null, progressDir: null, paper: "none" as const, renderer: null, inputs: ["none-"] };
  const steps = (dir: string) =>
    readFileSync(join(dir, "steps.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { stage: string; form?: string; reason?: string });

  it("接続の失敗は「取れず: 接続の失敗」、--catalog-fetch なしは前のまま", async () => {
    const entry = allMunicipalEntries().find((e) => availability(e).ok && e.form.format === "docx")!;
    const failed = await runEval({
      ...base,
      forms: [`cat-${entry.form.id}`],
      runId: "t140-reset",
      catalogFetch: async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
      },
    });
    expect(steps(failed.dir).find((s) => s.stage === "form")?.reason).toBe("原本なし（一覧の URL から取れず: 接続の失敗 ECONNRESET）");
    const none = await runEval({ ...base, forms: [`cat-${entry.form.id}`], runId: "t140-nofetch" });
    expect(steps(none.dir).find((s) => s.stage === "form")?.reason).toBe("原本なし（置き場・取った写しに無く、--catalog-fetch なし）");
  });
});
