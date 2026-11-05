// T90 連続の時計の画面: 進め方の 4 つ（主の操作は次まで）と AI の残り、72 時間の棒の固定の目盛りと区切りの印、開始の見込み。
// 描くだけ（renderToStaticMarkup）。10 分版・前からある訓練の操作は「進める」のまま。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DrillBar } from "../../components/drill/DrillBar.tsx";
import { DrillControls } from "../../components/drill/DrillControls.tsx";
import { StartButtons } from "../../components/drill/StartButtons.tsx";
import { CLOCK_LABELS } from "./clock.ts";
import { estimateClockCalls } from "./estimate.ts";
import { DRILL_LABELS } from "./labels.ts";
import { SCENARIO_ORDER } from "./scenarios.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

describe("進める操作", () => {
  it("連続の時計の訓練は 30 分・1 時間・3 時間・次まで（主の操作は次まで）と AI の残り", () => {
    const html = renderToStaticMarkup(createElement(DrillControls, { id: "d1", step: 3, done: false, clock: true, left: 87 }));
    expect(html).toContain('data-controls="clock"');
    for (const m of [30, 60, 180]) expect(html).toContain(`data-minutes="${m}"`);
    for (const w of [CLOCK_LABELS.m30, CLOCK_LABELS.h1, CLOCK_LABELS.h3, CLOCK_LABELS.next]) expect(html).toContain(w);
    expect(html).not.toContain(`>${DRILL_LABELS.advance}<`);
    // 主の操作の色は次までだけ
    expect((html.match(/bg-accent-fill/g) ?? []).length).toBe(1);
    expect(html.indexOf("data-next")).toBeGreaterThan(html.lastIndexOf("bg-accent-fill") - 400);
    expect(html).toContain('data-ai-left="87"');
    expect(html).toContain(CLOCK_LABELS.left);
  });

  it("10 分版・前からある訓練は「進める」のまま（残りの数も出さない）", () => {
    const html = renderToStaticMarkup(createElement(DrillControls, { id: "d1", step: 0, done: false }));
    expect(html).toContain(`>${DRILL_LABELS.advance}<`);
    expect(html).not.toContain("data-minutes");
    expect(html).not.toContain("data-ai-left");
  });
});

describe("72 時間の棒（連続の時計）", () => {
  it("目盛りは 3 時間ごとの固定、区切りは保存した時刻の印（再生では押せる）", () => {
    const hours = [0, 0.5, 1, 2.5, 3.6666666666666665];
    const html = renderToStaticMarkup(
      createElement(DrillBar, { hours, last: 72, now: 2.5, bands: [], reached: 4, clock: true, hrefOf: (i: number) => `/drill/d1?step=${i}` }),
    );
    expect((html.match(/data-scale=/g) ?? []).length).toBe(25);
    expect(html).toContain('data-scale="72"');
    expect((html.match(/data-tick=/g) ?? []).length).toBe(hours.length);
    expect(html).toContain('href="/drill/d1?step=3"');
    expect(html).toContain('aria-current="true"');
  });

  it("clock の無い訓練は今までの刻みの印", () => {
    const hours = [0, 1, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72];
    const html = renderToStaticMarkup(createElement(DrillBar, { hours, last: 72, now: 3, bands: [], reached: 2 }));
    expect(html).not.toContain("data-scale");
    expect((html.match(/data-tick=/g) ?? []).length).toBe(12);
  });
});

describe("開始の見込み", () => {
  it("大雨・地震・仮想は連続の時計の式（10 分版は T124 で開始から外した）", () => {
    const people = Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}`, name: `人${i}` }));
    const html = renderToStaticMarkup(createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people, ai: null }));
    for (const s of SCENARIO_ORDER) expect(html).toContain(`data-estimate-scenario="${s}" data-estimate-calls="${estimateClockCalls(s, people)}"`);
    expect(html).not.toContain('data-estimate-scenario="short"');
  });
});
