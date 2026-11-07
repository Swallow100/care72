// T186: 開始の画面の参加者の選択（描くだけ、renderToStaticMarkup）。担当一覧が 20 人を越えるときは設定を開いた形で、
// 上から 20 人に印、選んでいない人は押せない、「選択 20 / 20」。20 人以下は今のまま（閉じた設定・全員）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StartButtons, type StartPerson } from "../../components/drill/StartButtons.tsx";
import { SCENARIO_ORDER } from "./scenarios.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const people = (n: number): StartPerson[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `q-${String(i + 1).padStart(2, "0")}`,
    name: `試行 ${i + 1}`,
    canPress: i !== 2,
    town: i % 2 === 0 ? "みずほし町" : null,
    facts: i === 0 ? ["酸素", "独居"] : [],
  }));

const render = (n: number) => renderToStaticMarkup(createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people: people(n) }));
const checked = (html: string) => [...html.matchAll(/<input[^>]*data-start-person="([^"]+)"[^>]*>/g)].filter((m) => /\schecked=""/.test(m[0])).map((m) => m[1]);
const locked = (html: string) => [...html.matchAll(/<input[^>]*data-start-person="([^"]+)"[^>]*>/g)].filter((m) => /\sdisabled=""/.test(m[0])).map((m) => m[1]);

describe("参加者の選択（T186）", () => {
  it("21 人以上: 設定を開いた形で、上から 20 人に印、残りは押せない、「選択 20 / 20」・既定・解除", () => {
    const html = render(23);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("data-start-over");
    expect(checked(html)).toEqual(people(20).map((p) => p.id));
    expect(locked(html)).toEqual(["q-21", "q-22", "q-23"]);
    expect(html).toMatch(/data-start-picked="20"[^>]*>選択 (<!-- -->)?20(<!-- -->)? \/ (<!-- -->)?20</);
    expect(html).toContain("data-start-reset");
    expect(html).toContain("data-start-clear");
    expect(html).not.toContain("data-start-all");
    // 町と台帳の要点、押せる人なし
    expect(html).toContain("みずほし町・酸素・独居");
    expect(html).toMatch(/data-start-note="true">[^<]*押せる人なし/);
    // 想定のボタンは押せる（20 人で始められる）
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-scenario=/);
  });

  it("20 人以下は今のまま: 閉じた設定、全員", () => {
    const html = render(20);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-start-options");
    expect(html).not.toContain("data-start-over");
  });
});
