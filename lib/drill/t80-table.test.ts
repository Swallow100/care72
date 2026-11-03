// T80（2 回目の点検）: /drill の訓練記録の表が 375 で崩れていた（「印刷」が右で切れ、経過・想定・状態が 1〜2 字ずつ折れる）。
// 640px 未満は 経過 を想定の下、開始者 を開始の下に畳み（列は省かず畳む）、操作のボタンは縦に積む。言葉は 1 字ずつ折らない。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DrillRecordTable } from "../../components/drill/DrillRecordTable.tsx";
import type { DrillListItem } from "./db.ts";

const item = (p: Partial<DrillListItem>): DrillListItem => ({
  id: "d-1",
  scenario: "short",
  status: "finished",
  step: 3,
  sim_hour: 72,
  started_at: "2026-11-04T00:10:00.000Z",
  finished_at: "2026-11-04T00:20:00.000Z",
  started_by: "acct-yamamoto",
  started_by_name: "山本",
  abandon_reason: null,
  ...p,
});

const html = renderToStaticMarkup(
  createElement(DrillRecordTable, {
    items: [item({}), item({ id: "d-2", scenario: "heavy_rain", status: "abandoned", sim_hour: 9, abandon_reason: "24h" }), item({ id: "d-3", status: "running", sim_hour: 12 })],
  }),
);
const row = (id: string) => html.match(new RegExp(`<tr data-drill="${id}"[^>]*>(.*?)</tr>`))![1];
const cells = (tr: string) => [...tr.matchAll(/<td class="([^"]*)"[^>]*>(.*?)<\/td>/g)].map((m) => ({ cls: m[1], body: m[2] }));

describe("訓練記録の表（T80、375 の崩れ）", () => {
  it("経過・開始者の列は 640px 以上だけ。640px 未満は想定・開始の下に同じ値を畳む（値は落とさない）", () => {
    const heads = [...html.matchAll(/<th class="([^"]*)"[^>]*>(.*?)<\/th>/g)].map((m) => ({ cls: m[1], text: m[2].replace(/<[^>]+>/g, "") }));
    expect(heads.find((h) => h.text === "経過")!.cls).toContain("hidden sm:table-cell");
    expect(heads.find((h) => h.text === "開始者")!.cls).toContain("hidden sm:table-cell");
    for (const h of heads.filter((h) => h.text === "開始" || h.text === "想定" || h.text === "状態")) expect(h.cls).not.toContain("hidden");

    const c = cells(row("d-1"));
    expect(c[0].body).toMatch(/data-narrow="started-by"[^>]*>.*山本/);
    expect(c[1].body).toMatch(/data-narrow="elapsed"[^>]*>.*経過.*72 \/ 72.*時間/);
    expect(c[1].body).toContain("sm:hidden");
  });

  it("言葉は 1 字ずつ折らない: 想定・状態・経過の数字・中断の理由は折らない塊", () => {
    const c = cells(row("d-2"));
    expect(c[1].body).toMatch(/whitespace-nowrap[^>]*>大雨想定</);
    expect(c[3].cls).toContain("whitespace-nowrap");
    expect(c[2].body).toMatch(/whitespace-nowrap[^>]*>9 \/ 72</);
    expect(c[3].body).toMatch(/data-abandon-reason="24h"/);
  });

  it("操作のボタンは 640px 未満で縦に積む（「再生」「印刷」とも文字つき、右で切れない）。進行中は「再開」だけ", () => {
    const ops = cells(row("d-1")).at(-1)!.body;
    expect(ops).toMatch(/class="flex flex-col items-stretch gap-1 sm:flex-row/);
    expect(ops).toContain("再生");
    expect(ops).toContain("印刷");
    const running = cells(row("d-3")).at(-1)!.body;
    expect(running).toContain("再開");
    expect(running).not.toContain("印刷");
  });

  it("1 件も無ければ「なし」の 1 行", () => {
    expect(renderToStaticMarkup(createElement(DrillRecordTable, { items: [] }))).toMatch(/colSpan="6"|colspan="6"/);
  });
});
