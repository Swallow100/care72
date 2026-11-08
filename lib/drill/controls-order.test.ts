// 訓練の上の帯（components/drill/DrillControls.tsx）で、幅の変わる字をボタンの前に置く（11/8 の通し点検）。
// 帯は右寄せなので、後ろに置くと進めるたびにボタンが左へずれ、同じ所を押し直すと「中断」に当たった。
// 地震想定の避難所は一般の呼び方（指定避難所）。架空の「高台の集会所」が実在の避難先と並ぶと食い違って見えた。場所の名前は表に書かない（scenarios.ts の 58 行）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenarios.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("訓練の上の帯の並び", () => {
  const src = read("../../components/drill/DrillControls.tsx");
  it("AI の残り・進んだ時間・読込・失敗・自動進行の説明は、次まで・自動進行・中断のボタンより前", () => {
    const firstButton = src.indexOf('data-action="advance"');
    expect(firstButton).toBeGreaterThan(-1);
    for (const mark of ["data-ai-left=", "data-moved=", "<Loader72", 'role="alert"', "data-fast-note"]) {
      const at = src.indexOf(mark);
      expect(at, mark).toBeGreaterThan(-1);
      expect(at, mark).toBeLessThan(firstButton);
    }
  });
});

describe("地震想定の避難所の名前", () => {
  it("架空の名前の「高台の集会所」は出さず、大雨想定と同じ一般の呼び方（指定避難所）", () => {
    const text = JSON.stringify(SCENARIOS.earthquake);
    expect(text).not.toContain("高台の集会所");
    expect(text).toContain("指定避難所");
  });
});
