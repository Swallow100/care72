// T80（2 回目の点検）: 訓練の「早送り」のチェックが 16px だった → 事業所と同じ 18px（components/ui/choice.ts の CHOICE_INPUT）。
// 同じ画面の開始の設定（参加者・夜間発災）のチェックも同じ 16px だったので合わせた。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DrillControls } from "../../components/drill/DrillControls.tsx";
import { CHOICE_INPUT } from "../../components/ui/choice.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

describe("訓練のチェックの大きさ（T80）", () => {
  it("早送りのチェックは 18px（事業所と同じ CHOICE_INPUT）", () => {
    const html = renderToStaticMarkup(createElement(DrillControls, { id: "d-1", step: 0, done: false }));
    const input = html.match(/<input[^>]*data-action="fast"[^>]*>/)![0];
    expect(input).toContain('type="checkbox"');
    for (const c of CHOICE_INPUT.split(" ")) expect(input).toContain(c);
    expect(input).not.toMatch(/\bsize-4\b/);
  });

  it("開始の設定のチェック（参加者・夜間発災）も 18px", () => {
    const src = readFileSync(new URL("../../components/drill/StartButtons.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/const CHECK = CHOICE_INPUT;/);
    expect(src).not.toMatch(/size-4 shrink-0 accent-accent/);
  });
});
