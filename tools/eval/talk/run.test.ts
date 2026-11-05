// 声の聞き取りの会話の台（T137）を偽の client で回す。決まりを破る文を混ぜても、読んだ文に残らない・名前と電話が Claude に渡らないことを数で確かめる。

import { describe, expect, it } from "vitest";
import { CASES, markdown, runTalkEval } from "./run.ts";

describe("声の聞き取りの会話の台（偽）", () => {
  it("筋を全部回し、言わない事・名前と電話・表の 2 問の前の締め が 0。うめき声・黙るはボタン、危ない言葉は危険語で締める", async () => {
    const s = await runTalkEval({ real: false });
    expect(s.cases).toHaveLength(CASES.length);
    expect(s.totals).toMatchObject({ banned: 0, leaks: 0, closedEarly: 0 });
    const by = Object.fromEntries(s.cases.map((c) => [c.id, c]));
    expect(by.moan.buttons).toBe(true);
    expect(by.silent.buttons).toBe(true);
    expect(by.danger).toMatchObject({ danger: "fire", end: "danger", aiCalls: 0 });
    expect(by.plain.end).not.toBeNull();
    expect(markdown(s)).toContain("| 筋 | 往復 |");
  });

  it("決まりを破る文を混ぜても（noise 1）、門が外して決まった問いに戻す", async () => {
    let i = 0;
    const s = await runTalkEval({ real: false, noise: 1, rnd: () => ((i++ * 0.37) % 1) });
    expect(s.totals.gate).toBeGreaterThan(0);
    expect(s.totals.banned).toBe(0);
    expect(s.totals.fallback).toBeGreaterThanOrEqual(s.totals.gate);
  });
});
