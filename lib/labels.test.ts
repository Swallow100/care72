import { describe, expect, it } from "vitest";
import * as labels from "./labels.ts";
import { COLOR_LABELS } from "./labels.ts";

// 画面の言葉で本人の状態を言い切らない（docs/DECISIONS.md「運営の返事を受けて」、CLAUDE.md「守ること」）。
const ASSERTING_WORDS = ["危険", "診断", "判定", "重症", "病気がわかる"];

describe("画面の言葉", () => {
  it("赤は連絡の順の言葉「至急」。緑 無事・黄 要確認・灰 未知はそのまま", () => {
    expect(COLOR_LABELS).toEqual({ red: "至急", yellow: "要確認", gray: "未知", green: "無事" });
  });

  it("どの言葉にも、本人の状態を言い切る言葉が入っていない", () => {
    const words = Object.values(labels).flatMap((v) =>
      Array.isArray(v) ? v.flat().map(String) : Object.values(v as Record<string, string>),
    );
    expect(words.length).toBeGreaterThan(20);
    for (const w of words) for (const bad of ASSERTING_WORDS) expect(w).not.toContain(bad);
  });
});
