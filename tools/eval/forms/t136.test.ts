// T136 評価の台の紙の見直し: 決まりの見直しの数と、AI の照合が偽の答えで動くこと（塗った欄と一覧に無い id の答えを捨てる）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { diffMarkdown, oneLine } from "./report.ts";
import { reviewTotals } from "./review.ts";
import { runEval, type RunResult } from "./run.ts";

/** 形だけの JPEG（tools/eval/forms/eval.test.ts と同じ） */
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

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

async function run(fakeStyle: "gold" | "noisy", review: boolean): Promise<RunResult> {
  const root = mkdtempSync(join(tmpdir(), "care72-eval-t136-"));
  roots.push(root);
  return runEval({
    mode: "fake",
    fakeStyle,
    outRoot: root,
    corpusRoot: null,
    progressDir: null,
    paper: "none",
    forms: ["komorebi"],
    people: ["p-01"],
    inputs: ["ledger-"],
    renderer: null,
    review,
    runId: `20261105-13600${review ? 1 : 0}-${fakeStyle}`,
    formPages: { komorebi: [tinyJpeg(1240, 1754, 1), tinyJpeg(1240, 1754, 2)] },
  });
}

describe("評価の台の紙の見直し（T136）", () => {
  it("決まりの見直しの数はいつも数え、AI の照合は review のときだけ回す", async () => {
    const off = await run("gold", false);
    const p = off.papers.find((x) => x.review)!;
    expect(p.review!.rule.fix + p.review!.rule.check + p.review!.rule.note).toBeGreaterThan(0);
    expect(p.review!.ai).toBeNull();
    expect(off.calls.byModel["claude-sonnet-5-5"]).toBeUndefined();
  }, 120_000);

  it("偽の照合（noisy）: 塗った欄と一覧に無い id を捨て、ふつうの欄の 1 件だけ使う。送った物に名前・電話・町名が無い", async () => {
    const r = await run("noisy", true);
    const reviewed = r.papers.filter((x) => x.review?.ai);
    expect(reviewed.length).toBeGreaterThan(0);
    for (const x of reviewed) {
      // noisy の偽は形の違う返事を混ぜる（失敗の数え方の確かめ）。返った物は 1 件
      if (x.review!.ai!.status === "ok") expect(x.review!.ai!.found).toBe(1);
      expect(x.review!.ai!.painted).toBeGreaterThan(0);
      expect(x.review!.ai!.images).toBe("blank");
    }
    expect(r.leaks.strongHits).toBe(0);
    const t = reviewTotals(r.papers);
    expect(t.ai).toBe(reviewed.length);
    expect(oneLine(r, null)).toContain("見直し");
    expect(diffMarkdown(r, null)).toContain("見直し AI の照合の紙");
  }, 120_000);

  it("偽の照合（gold）: 挙げる物が無ければ 0", async () => {
    const r = await run("gold", true);
    const reviewed = r.papers.filter((x) => x.review?.ai);
    expect(reviewed.length).toBeGreaterThan(0);
    for (const x of reviewed) expect(x.review!.ai).toMatchObject({ status: "ok", found: 0 });
  }, 120_000);
});
