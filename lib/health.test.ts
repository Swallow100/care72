// /api/health の中身（lib/health.ts）。形と、秘密の値を返さないこと。build の情報の生成（tools/deploy/write-version.ts）。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { healthBody } from "./health.ts";

const BUILD = { commit: "49c7627", builtAt: "2026-11-03T00:00:00.000Z" };

describe("/api/health の中身", () => {
  it("ok・commit・builtAt・bindings・ai の形。鍵は有る・無いだけ", () => {
    const body = healthBody(
      { DB: {}, RECORDINGS: {}, ANTHROPIC_API_KEY: "sk-test-value-0001", GEMINI_API_KEY: "  " },
      BUILD,
    );
    expect(body).toEqual({
      ok: true,
      commit: "49c7627",
      builtAt: "2026-11-03T00:00:00.000Z",
      bindings: { DB: true, RECORDINGS: true },
      ai: { anthropic: true, gemini: false },
    });
    expect(JSON.stringify(body)).not.toContain("sk-test-value-0001");
  });

  it("binding も鍵も無ければ false", () => {
    expect(healthBody({}, { commit: "unknown", builtAt: BUILD.builtAt })).toMatchObject({
      ok: true,
      commit: "unknown",
      bindings: { DB: false, RECORDINGS: false },
      ai: { anthropic: false, gemini: false },
    });
  });
});

describe("lib/version.ts の生成", () => {
  it("今の HEAD の 7 字の hash と ISO の時刻を書く", () => {
    const script = fileURLToPath(new URL("../tools/deploy/write-version.ts", import.meta.url));
    execFileSync(process.execPath, [script], { stdio: "ignore" });
    const text = readFileSync(new URL("./version.ts", import.meta.url), "utf8");
    const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
    expect(text).toContain(`export const COMMIT = "${head}";`);
    expect(text).toMatch(/export const BUILT_AT = "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z";/);
  });
});
