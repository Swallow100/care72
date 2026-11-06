// T161 の評価の台の直し（偽の client。本物の API・Chrome は使わない）:
// - 一覧の様式の共有の対応表: 4 頁からの様式でも 2 つ目の事業所が AI を呼ばずに写す（評価の 6 回目の岐阜市は 4 頁で、頁の組の鍵が 3 頁まで
//   だったので共有に入らなかった）。共有の当たり・外れを結果・指摘・点数の表・守りに
// - 正解の表: 災害診療記録の既往症・予防接種は □ の並び（原本の選択肢）、「□アレルギー（　）」は □ と括弧の 2 欄
// - 値の比べ: 文の終わりの句点・全角半角・空白の違いを外れにしない（意味の変わる違いは外れのまま）

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { MEDICAL_AUDIT } from "../../../lib/forms/form-audit.ts";
import { GUARDS, guardFindings } from "../guards.ts";
import { buildScorecard, scorecardMarkdown, seedColumns } from "../scorecard.ts";
import { itemOf, sharedMissOf, valuesOf } from "../scorecard-items.ts";
import { formsFindings } from "./findings.ts";
import { GOLD_FORMS } from "./gold.ts";
import { runEval, type RunResult } from "./run.ts";
import { canonical, valueNorm } from "./score.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = mkdtempSync(join(tmpdir(), "care72-eval-t161-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function tinyJpeg(width: number, height: number, seed = 0): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    seed & 0xff, 0x00, 0x12, 0x34,
    0xff, 0xd9,
  ]);
}

const base = { mode: "fake" as const, fakeStyle: "noisy" as const, outRoot: root, corpusRoot: null, progressDir: null, paper: "none" as const, renderer: null, inputs: ["none-"] };

describe("一覧の様式の共有（T161）", () => {
  it("4 頁・10 頁の様式でも 2 つ目の事業所は AI を呼ばずに共有の対応表を写す", async () => {
    const pages = (n: number, seed: number) => Array.from({ length: n }, (_, i) => tinyJpeg(1240, 1754, seed + i));
    const r = await runEval({
      ...base,
      forms: ["cat-kumamoto-1", "cat-sapporo-1"],
      runId: "t161-pages",
      formPages: { "cat-kumamoto-1": pages(4, 10), "cat-sapporo-1": pages(10, 40) },
    });
    for (const f of r.forms) {
      expect(f.status, f.id).toBe("ok");
      expect(f.catalog, f.id).toMatchObject({ shared: true });
      expect(f.catalog?.sharedWhy, f.id).toBeUndefined();
    }
    // 呼んだのは 1 つ目の事業所の 1 頁 1 回だけ（4 頁 + 10 頁）
    expect(r.calls.calls).toBe(14);
    const steps = readFileSync(join(r.dir, "steps.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { stage: string; ok: boolean; pages?: number });
    expect(
      steps
        .filter((s) => s.stage === "form.shared")
        .map((s) => [s.ok, s.pages])
        .sort((a, b) => Number(a[1]) - Number(b[1])),
    ).toEqual([
      [true, 4],
      [true, 10],
    ]);
    const v = valuesOf({ bench: "forms", run: r.run, client: r.mode, data: r });
    expect(v["forms.shared"]).toBe(1);
    expect(v["forms.sharedMiss"]).toBe(0);
    expect(formsFindings(r).some((f) => f.cause === "forms:catalog.shared_miss")).toBe(false);
  });

  it("写せなかった物は外れ（訳の無い前の回の物も）。1 つ目に読めない頁があった物は決めどおりなので外れにしない", () => {
    const form = (id: string, catalog: RunResult["forms"][number]["catalog"]): RunResult["forms"][number] => ({
      id,
      title: id,
      gold: false,
      status: "ok",
      pages: 4,
      read: null,
      overlay: false,
      catalog,
    });
    const forms = [
      form("cat-a", { id: "a", version: "same", from: "fetch", shared: true }),
      // 評価の 6 回目の岐阜市（訳を持たない前の回の結果）
      form("cat-b", { id: "b", version: "same", from: "fetch", shared: false }),
      form("cat-c", { id: "c", version: "same", from: "fetch", shared: false, sharedWhy: "unread" }),
      form("cat-d", { id: "d", version: "same", from: "fetch", shared: false, sharedWhy: "pages" }),
    ];
    expect(forms.map(sharedMissOf)).toEqual([false, true, false, true]);
    const r = {
      run: "t161-miss",
      mode: "fake" as const,
      fakeStyle: "noisy" as const,
      forms,
      inputs: [],
      papers: [],
      calls: { aiCalls: { rows: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byPurpose: {} }, calls: 0, ok: 0, failed: 0, retried: 0, attempts: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {}, truncated: 0 },
      leaks: { calls: 0, textHits: 0, strongHits: 0, birthHits: 0, weakHits: 0, images: 0, imagesRedacted: 0, imagesNotRedacted: 0 },
    } as unknown as RunResult;
    const v = valuesOf({ bench: "forms", run: r.run, client: r.mode, data: r });
    expect(v["forms.shared"]).toBeCloseTo(1 / 4);
    expect(v["forms.sharedMiss"]).toBe(2);
    const found = formsFindings(r).filter((f) => f.cause === "forms:catalog.shared_miss");
    expect(found.map((f) => f.where.file)).toEqual(["様式 cat-b（訳なし）", "様式 cat-d（pages）"]);
    // 守り: 外れが 1 つでもあれば重さ「重」
    const g = guardFindings({ bench: "forms", run: r.run, values: v, counts: {}, repro: [] });
    expect(g.map((x) => [x.cause, x.severity])).toEqual([["guard:forms-shared-copied", "high"]]);
    expect(GUARDS.find((x) => x.id === "forms-shared-copied")).toMatchObject({ item: "forms.sharedMiss", op: "<=", value: 0, since: "r7", task: "T161" });
  });
});

describe("災害診療記録の正解の表（T161）", () => {
  const kiroku = GOLD_FORMS.find((g) => g.id === "kiroku")!;

  it("既往症・予防接種は □ の並び（choice）で、選択肢は原本の照合の表と同じ字と順", () => {
    for (const [label, key] of [
      ["既往症", "history.disease"],
      ["予防接種", "history.vaccination"],
    ] as const) {
      const g = kiroku.fields.filter((f) => f.label === label);
      expect(g, label).toHaveLength(1);
      const row = MEDICAL_AUDIT.rows.find((x) => x.keys.includes(key))!;
      expect(g[0].shape).toBe("choice");
      expect(g[0].options).toEqual([...row.options!]);
    }
  });

  it("「□アレルギー（　）」は □ と括弧の 2 欄（どちらもアレルギーの項目）。□ は □ の場所、字の欄は括弧の中で □ を含まない", () => {
    const g = kiroku.fields.filter((f) => f.label === "アレルギー");
    expect(g.map((f) => [f.shape, f.item])).toEqual([
      ["check", "medical.allergies"],
      ["text", "medical.allergies"],
    ]);
    const [mark, text] = g.map((f) => f.box!);
    expect(mark.w).toBeLessThan(0.03);
    expect(mark.x + mark.w).toBeLessThanOrEqual(text.x);
  });
});

describe("値の比べ（T161）", () => {
  it("文の終わりの句点・全角半角・空白の違いは同じ。文の中の違い・欠けは違う", () => {
    expect(valueNorm("家から北へ市道を進み、体育館へ。")).toBe(valueNorm("家から北へ市道を進み、体育館へ"));
    expect(valueNorm("ＡＬＳ　気管切開．")).toBe(valueNorm("ALS気管切開"));
    // 紙の行（／）・並び（|）の区切りの前の句点も
    expect(valueNorm("体育館へ。／堤防は通らない。")).toBe(valueNorm("体育館へ／堤防は通らない"));
    // 意味の変わる違いは外れのまま（文の途中で切れた・頭が欠けた・区切りの違い）
    expect(valueNorm("夫の車で病院へ")).not.toBe(valueNorm("夫の車で病院へ。訪問看護が付き添う"));
    expect(valueNorm("県道を通って公民館へ")).not.toBe(valueNorm("長男の車で県道を通って公民館へ"));
    expect(valueNorm("ALS・気管切開")).not.toBe(valueNorm("ALS気管切開"));
    // 文の中の句点は外さない
    expect(valueNorm("体育館へ。堤防は通らない")).not.toBe(valueNorm("体育館へ堤防は通らない"));
  });

  it("入れる欄の値（字・並び）も同じ比べ方", () => {
    const a = canonical({ t: "field", key: "evacuation.route", value: "体育館へ。" } as never)!;
    const b = canonical({ t: "field", key: "evacuation.route", value: "体育館へ" } as never)!;
    expect(a).toEqual(b);
    const l1 = canonical({ t: "field", key: "evacuation.carryItems", value: ["薬。", "眼鏡"] } as never)!;
    const l2 = canonical({ t: "field", key: "evacuation.carryItems", value: ["眼鏡", "薬"] } as never)!;
    expect(l1).toEqual(l2);
  });
});

describe("点数の表の注（T161）", () => {
  it("数え方を変えた項目に注があり、表の終わりの「注」に出る", () => {
    for (const id of ["forms.intake", "forms.paper.kiroku", "forms.paper.matsuyama", "forms.paper.form9", "forms.read.kiroku"]) {
      expect(itemOf(id)?.notes?.some((n) => n.includes("T161")), id).toBe(true);
    }
    const md = scorecardMarkdown(seedColumns());
    expect(md).toContain("## 注");
    expect(md).toContain("入力 当たり（注）");
    expect(md).toMatch(/- 書類 入力 当たり: r7〜（T161）/);
  });

  it("書いた表（docs/progress/eval-scorecard.md）にも注がある", () => {
    const committed = readFileSync(join(REPO, "docs", "progress", "eval-scorecard.md"), "utf8");
    expect(committed).toContain("## 注");
    expect(committed).toContain("一覧の様式 共有の外れ");
    const { md } = buildScorecard({ runs: [], out: "", seed: true, print: true });
    expect(md).toContain("r7〜（T161）");
  });
});
