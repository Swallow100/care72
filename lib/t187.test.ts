// T187: 11/8 の点検の低の残り 3 件。
// 2 担当一覧の平時の表の先頭の列と本人のページの上は同じ言葉「連絡順」、平時の連絡順の数に色を付けない。
// 5 本人のページの上の避難先は、空の欄に台帳の pending があれば下の「避難」の区分と同じ「未確認」と理由、無ければ「未入力」。
// 9 ヘッダーの「平時」は押せる形にしない（lib/ui/t79.test.ts）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseloadTable } from "../components/list/CaseloadTable.tsx";
import { PersonHead } from "../components/person/PersonHead.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../seed/people.ts";
import { HEAD_LABELS, PENDING_STATUS_LABELS } from "./labels.ts";
import { tierColumnLabel } from "./list/labels.ts";
import { caseloadColumns } from "./forms/caseload-csv.ts";
import { toPersonView, type PersonPageRows } from "./person.ts";

const TODAY = "2026-11-02";
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const viewOf = (id: string) => toPersonView(seedRows(seed(id)), { today: TODAY });
const renderHead = (id: string) => renderToStaticMarkup(createElement(PersonHead, { head: viewOf(id).head, level: 2, titleId: "t" }));
/** 上の段の避難先の欄の HTML */
const evacuationHtml = (id: string) => renderHead(id).match(/<dl[^>]*data-head-evacuation[\s\S]*?<\/dl>/)![0];
/** 避難先の欄の 1 行（「1」「2」「手段」）の値の HTML */
const slot = (dl: string, label: string) => dl.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([\\s\\S]*?)</dd>`))![1];

describe("#2 連絡順の言葉と色", () => {
  it("担当一覧の平時の表の先頭の列・平時の CSV の先頭の列は、本人のページの上と同じ「連絡順」", () => {
    expect(tierColumnLabel(false)).toBe(HEAD_LABELS.priority);
    expect(tierColumnLabel(true)).toBe(HEAD_LABELS.priority);
    const html = renderToStaticMarkup(createElement(CaseloadTable, { rows: [], sort: "tier" }));
    const firstHead = html.match(/<th[^>]*>([\s\S]*?)<\/th>/)![1];
    expect(firstHead).toContain(HEAD_LABELS.priority);
    expect(html).not.toMatch(/>組</);
    expect(caseloadColumns(false)[0].header).toBe(HEAD_LABELS.priority);
    // 発災時の CSV は表の並びの番号（連絡順）と骨格の段（組）が並ぶので呼び分けたまま
    expect(caseloadColumns(true).map((c) => c.header).slice(0, 4)).toEqual(["連絡順", "状態", "理由", "組"]);
  });

  it("平時の本人のページの上の連絡順の数は色なし（酸素の赤い時計の人でも）。時計の色は医療の印だけ", () => {
    const html = renderHead("p-01");
    const tier = html.match(/<span[^>]*data-head-tier[^>]*>/)![0];
    expect(tier).not.toMatch(/data-tone|state-|text-danger/);
    // 医療の印の赤はそのまま
    expect(html).toMatch(/data-head-mark="酸素"[\s\S]*?data-tone="urgent"/);
  });
});

describe("#5 上の段の避難先の空の欄", () => {
  it("台帳に pending（不明）のある避難先2 は、下の区分と同じ「未確認」と理由。「未入力」にしない", () => {
    const p = seed("p-01");
    expect(p.ledger.evacuation.destination2 ?? null).toBeNull();
    expect(p.ledger.pending).toContainEqual({ field: "evacuation.destination2", status: "unknown" });
    const two = slot(evacuationHtml("p-01"), "2");
    expect(two).toContain("未確認");
    expect(two).toContain(PENDING_STATUS_LABELS.unknown);
    expect(two).not.toContain("未入力");
  });

  it("pending の無い空の欄は「未入力」（まだ誰も入れていない）", () => {
    for (const p of SEED_PEOPLE) {
      const e = p.ledger.evacuation;
      const view = viewOf(p.person.id);
      if (!view.head.evacuation) continue;
      const dl = evacuationHtml(p.person.id);
      const pairs: Array<[string, string | undefined, string]> = [
        ["1", e.destination1, "evacuation.destination1"],
        ["2", e.destination2, "evacuation.destination2"],
      ];
      for (const [label, value, field] of pairs) {
        if (value?.trim()) continue;
        const pending = p.ledger.pending.some((x) => x.field === field);
        const cell = slot(dl, label);
        expect(cell, `${p.person.id} ${label}`).toContain(pending ? "未確認" : "未入力");
        expect(cell, `${p.person.id} ${label}`).not.toContain(pending ? "未入力" : "未確認");
      }
    }
  });
});
