import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { triageDoc } from "./doc.ts";
import { ORDER, QUALIFIERS, RULES } from "./index.ts";

describe("docs/TRIAGE.md", () => {
  const file = readFileSync(new URL("../../docs/TRIAGE.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");

  it("ルールの表のコードから作った物と同じ（違えば npm run docs:triage を流す）", () => {
    expect(file).toBe(triageDoc());
  });

  it("表の行・足す言葉・並びの鍵が全部載っている", () => {
    for (const r of RULES) expect(file).toContain(`| ${r.input} |`);
    for (const q of QUALIFIERS) expect(file).toContain(`| ${q.when} |`);
    for (const k of ORDER) expect(file).toContain(k.label);
  });
});
