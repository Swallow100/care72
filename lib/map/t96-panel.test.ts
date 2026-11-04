// T96 右の面の避難計画・見直し・未確認の欄と、担当一覧の表の「未確認 N」（docs/tasks/T96.md の 2）。
// 色だけの横の帯（計画の割合・未確認の件数）と数の前の黄の細い帯（tone-check）を外し、数と言葉で。
// 「未確認 N」は言葉ごと黄の塗りの印、右の面の未確認の行は押すと欄の一覧が開く。見た目は docs/progress/t96。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseloadTable } from "../../components/list/CaseloadTable.tsx";
import { DisasterTable } from "../../components/list/DisasterTable.tsx";
import { SidePane } from "../../components/list/SidePane.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { rank } from "../triage/index.ts";
import { buildSidePane } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
const T0 = Date.parse("2026-11-05T09:00:00.000Z");
const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
const results = rank(
  SEED_PEOPLE.map((p) => ({ person: toTriagePerson(p), signals: [] })),
  { now: iso(3.5), disasterAt: iso(0), outageAt: iso(0) },
);

describe("右の面の避難計画・見直し・未確認（平時）", () => {
  const data = buildSidePane(rows, { sort: "tier" });
  const html = renderToStaticMarkup(createElement(SidePane, { data }));
  const section = (id: string) => html.match(new RegExp(`<section[^>]*data-section="${id}"[\\s\\S]*?</section>`))?.[0] ?? "";

  it("避難計画: 色の割合の横の帯は無く、4 つの段の名前と数が読める", () => {
    const plan = section("plan");
    expect(plan).not.toBe("");
    expect(plan).not.toContain("data-plan-bar");
    expect(plan).not.toContain("style=");
    for (const c of data.plan) {
      const item = plan.match(new RegExp(`data-status="${c.status}"[\\s\\S]*?</div>`))?.[0] ?? "";
      expect(item).toContain(c.label);
      expect(item).toMatch(new RegExp(`<dd[^>]*>${c.count}</dd>`));
    }
  });

  it("面のどこにも黄の細い帯（tone-check）と色だけの横の帯が無い（平時・発災時）", () => {
    expect(html).not.toContain("tone-check");
    expect(section("pending")).not.toContain("style=");
    const disaster = renderToStaticMarkup(
      createElement(SidePane, {
        data: buildSidePane(rows, { sort: "tier", disaster: { results, scene: { kind: "heavy_rain", level: 4 } } }),
      }),
    );
    expect(disaster).not.toContain("tone-check");
    expect(disaster).not.toContain("data-plan-bar");
  });

  it("見出しの横の人数は本文色の数と単位だけ（今週 2 人、2 人・計 4 件）", () => {
    const n = (k: string) => `<span class="font-bold tabular-nums text-ink">${k}</span>`;
    expect(section("review")).toContain(`今週 ${n(String(data.review.length))} 人`);
    const total = data.pendingTop.reduce((a, r) => a + r.pending, 0);
    expect(section("pending")).toContain(`${n(String(data.pendingTop.length))} 人・計 ${n(String(total))} 件`);
    // 畳んだときの 1 行も
    const fold = html.match(/<span[^>]*data-fold-summary[^>]*>[\s\S]*?<\/span><\/div>/)?.[0] ?? "";
    expect(fold.replace(/<[^>]+>/g, "")).toBe(`見直し ${data.review.length} 人・未確認 ${data.pendingTop.length} 人`);
  });

  it("見直しの行: 「未確認 N」は言葉ごと黄の塗りの印、計画の状態は小さな言葉、何が未確認かは下に", () => {
    const review = section("review");
    for (const r of data.review) {
      const row = review.match(new RegExp(`data-review="${r.id}"[\\s\\S]*?</a>`))?.[0] ?? "";
      expect(row).toMatch(new RegExp(`data-tone="check">未確認 <span class="tabular-nums">${r.pending}</span></span>`));
      expect(row).toContain(`data-review-plan="${r.plan}"`);
      expect(row).toContain(r.labels.join("・"));
    }
  });

  it("未確認の行: 件数の帯は無く、氏名で本人のページ、「未確認 N」を押すと何の欄が未確認かが開く", () => {
    const pending = section("pending");
    expect(data.pendingTop.length).toBeGreaterThan(0);
    for (const r of data.pendingTop) {
      const row = pending.match(new RegExp(`<li[^>]*data-pending-row="${r.id}"[\\s\\S]*?</li>`))?.[0] ?? "";
      expect(row).not.toBe("");
      expect(row).toContain(`href="${r.href.replace(/&/g, "&amp;")}"`);
      const button = row.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
      expect(button).toContain('aria-expanded="false"');
      expect(button).toContain(`aria-controls="pending-fields-${r.id}"`);
      expect(button).toMatch(new RegExp(`data-tone="check">未確認 <span class="tabular-nums">${r.pending}</span>`));
      // 開く印＋文字（アイコンだけのボタンにしない）
      expect(button).toContain("<svg");
      const list = row.match(new RegExp(`<p id="pending-fields-${r.id}"[^>]*>([\\s\\S]*?)</p>`));
      expect(list).not.toBeNull();
      expect(list![0]).toContain("hidden");
      expect(list![1]).toBe(r.labels.join("・"));
    }
  });

  it("避難先の「未確認」も言葉ごと黄の塗りの印", () => {
    const dest = html.match(/<ul[^>]*data-destinations[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(dest).toMatch(/data-tone="check">未確認<\/span>/);
  });

  it("位置の無い人の数も言葉ごと黄の塗りの印（位置なし 1 人）", () => {
    const missing = rows.map((r, i) => (i === 0 ? { ...r, location: null } : r));
    const map = renderToStaticMarkup(createElement(SidePane, { data: buildSidePane(missing, { sort: "tier" }) }));
    expect(map).toMatch(/data-unplaced="1"><span class="[^"]*bg-state-check-fill[^"]*" data-tone="check">位置なし 1 人<\/span>/);
  });
});

describe("担当一覧の表の「未確認 N」", () => {
  it("平時の表・発災時の表とも、言葉ごと黄の塗りの印（黄の細い帯にしない）", () => {
    const normal = renderToStaticMarkup(createElement(CaseloadTable, { rows, sort: "tier" }));
    const disasterRows = toCaseloadRows(people, clocks, contacts, "2026-11-05", {
      situation: { now: iso(1.5), disasterAt: iso(0), outageAt: iso(0), outageTowns: null },
      signals: new Map(),
    });
    const disaster = renderToStaticMarkup(createElement(DisasterTable, { rows: disasterRows, sort: "state" }));
    for (const [html, list] of [
      [normal, rows],
      [disaster, disasterRows],
    ] as const) {
      const withPending = list.filter((r) => r.pending > 0);
      expect(withPending.length).toBeGreaterThan(0);
      const marks = [...html.matchAll(/data-row-pending="(\d+)"><span class="([^"]*)" data-tone="check">未確認 <span class="tabular-nums">(\d+)<\/span>/g)];
      expect(marks).toHaveLength(withPending.length);
      for (const m of marks) {
        expect(m[1]).toBe(m[3]);
        expect(m[2]).toContain("bg-state-check-fill");
      }
      expect(html).not.toMatch(/tone-check[^"]*">未確認/);
    }
  });
});
