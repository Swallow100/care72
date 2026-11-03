// 入れる欄の焦点の枠（T40、T51 の問い 4）。Tailwind 4 の outline-none は線の形まで none にするので、
// focus-visible:outline-2 だけでは枠が出ない。outline-none と焦点の outline を書く所には focus-visible:outline-solid も要る。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

/** 同時に動く作業の場所（T40 では触らない。直すのはその作業のあと）。docs/progress/t40.md の表に載せた */
const LATER = new Set(["components/survey/SurveyForm.tsx", "components/office/SurveyCreate.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("焦点の枠", () => {
  it("outline-none と focus-visible:outline-2 を並べる所は、focus-visible:outline-solid も持つ", () => {
    const missing: string[] = [];
    for (const f of [...files(join(ROOT, "components")), ...files(join(ROOT, "app"))]) {
      const rel = relative(ROOT, f).replaceAll("\\", "/");
      if (LATER.has(rel)) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/\boutline-none\b/.test(line) && /focus-visible:outline-2\b/.test(line) && !/focus-visible:outline-solid\b/.test(line)) {
            missing.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(missing).toEqual([]);
  });

  it("ログインの欄は焦点の枠を持つ", async () => {
    const { FIELD } = await import("@/components/login/field");
    expect(FIELD).toContain("focus-visible:outline-solid");
    expect(FIELD).toContain("focus-visible:outline-accent");
  });
});
