// T134 の 5: 評価の台が一覧の様式（lib/forms/municipal-forms.ts）を全部回せる（偽の client。本物の API・Chrome は使わない）。
// - --forms=catalog で取り込める様式を全部並べる（原本が無ければ「原本なし」で飛ばす）
// - 一覧の道（取った記録の版・元の頁の番号）で読み、2 つ目の事業所は AI を呼ばずに共有の対応表を写す
// - 原本を取る道（--catalog-fetch）は一覧の URL だけを取り、版が一覧と違う物は写しに置かない

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { allMunicipalEntries, availability } from "../../../lib/forms/municipal-forms.ts";
import { runEval } from "./run.ts";

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

const root = mkdtempSync(join(tmpdir(), "care72-eval-t134-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const base = { mode: "fake" as const, fakeStyle: "noisy" as const, outRoot: root, corpusRoot: null, progressDir: null, paper: "none" as const, renderer: null, inputs: ["none-"] };

describe("評価の台で一覧の様式を回す", () => {
  it("--forms=catalog は取り込める様式を全部並べる（原本が無ければ原本なしで飛ばし、AI を呼ばない）", async () => {
    const r = await runEval({ ...base, forms: ["catalog"], runId: "t134-all" });
    const usable = allMunicipalEntries().filter((e) => availability(e).ok);
    expect(r.forms.map((f) => f.id).sort()).toEqual(usable.map((e) => `cat-${e.form.id}`).sort());
    expect(r.forms.every((f) => f.status === "skipped" && f.reason === "原本なし")).toBe(true);
    expect(r.calls.calls).toBe(0);
  });

  it("一覧の道で読み、2 つ目の事業所は AI を呼ばずに共有の対応表を写す（偽の答え）", async () => {
    const ids = ["cat-kumamoto-1", "cat-sapporo-1"];
    const r = await runEval({
      ...base,
      forms: ids,
      runId: "t134-two",
      formPages: { "cat-kumamoto-1": [tinyJpeg(1754, 1240, 1), tinyJpeg(1754, 1240, 2)], "cat-sapporo-1": [tinyJpeg(1240, 1754, 3)] },
    });
    expect(r.forms.map((f) => f.id).sort()).toEqual([...ids].sort());
    for (const f of r.forms) {
      expect(f.status, f.id).toBe("ok");
      expect(f.catalog, f.id).toMatchObject({ version: "same", from: "pages", shared: true });
    }
    // 呼んだのは 1 つ目の事業所の 1 頁 1 回だけ（3 頁）
    expect(r.calls.calls).toBe(3);
    const steps = readFileSync(join(r.dir, "steps.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { stage: string; ok: boolean });
    expect(steps.filter((s) => s.stage === "form.shared").every((s) => s.ok)).toBe(true);
  });

  it("--catalog-fetch は一覧の URL だけを取り、版が一覧と違う物は写しに置かない", async () => {
    const entry = allMunicipalEntries().find((e) => availability(e).ok && e.form.format === "pdf")!;
    const urls: string[] = [];
    const r = await runEval({
      ...base,
      forms: [`cat-${entry.form.id}`],
      runId: "t134-fetch",
      catalogFetch: async (url) => {
        urls.push(url);
        return new Response(new TextEncoder().encode("%PDF-1.7\n% 偽\n%%EOF\n") as BodyInit, { status: 200 });
      },
    });
    expect(urls).toEqual([entry.form.url]);
    expect(r.forms).toHaveLength(1);
    // 偽の PDF は描けない（版違いの写しは置かない）
    expect(existsSync(join(root, "_catalog")) ? readdirSync(join(root, "_catalog")) : []).toEqual([]);
  });
});
