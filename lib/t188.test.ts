// T188: 書類の画面の言葉と折れの直しが戻らないように。中身を描くか、元の字を読んで確かめる。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentMenu } from "../components/forms/DocumentList.tsx";
import { UnconfirmedFold } from "../components/forms/UnconfirmedFold.tsx";
import { UNCONFIRMED_LABELS } from "./forms/unconfirmed.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("T188 の 3: 書類の未確認の数は欄の数と分かる言葉", () => {
  it("担当一覧・本人のページの「未確認」（台帳の項目の数）と同じ言葉にしない", () => {
    expect(UNCONFIRMED_LABELS.unconfirmed).toBe("未確認欄");
    const html = renderToStaticMarkup(createElement(UnconfirmedFold, { view: { count: 6, blank: ["避難先2"], noSource: ["引用"] } }));
    expect(html).toContain('未確認欄 <span class="tabular-nums">6</span>');
    // 担当一覧の言葉は台帳の項目の数のまま
    expect(read("../components/list/CaseloadTable.tsx")).toMatch(/未確認 <span className="tabular-nums">\{r\.pending\}/);
  });
});

describe("T188 の 8: 紙に手で書く欄は本人の 1 枚と同じ「要記入」", () => {
  it("計画書の帯・書類の一覧の内訳も「要記入」、「手書き」は出さない", () => {
    expect(UNCONFIRMED_LABELS.noSource).toBe("要記入");
    expect(read("../app/people/[id]/forms/own/page.tsx")).toContain('write: "要記入"');
    const html = renderToStaticMarkup(createElement(UnconfirmedFold, { view: { count: 1, blank: ["避難先2"], noSource: ["引用"] } }));
    expect(html).toContain("要記入");
    expect(html).not.toContain("手書き");
  });
});

describe("T188 の 10: 書類の左の列の版の注", () => {
  it("語の中で折らない（「未照合」が「未照 / 合」にならない）", () => {
    const item = { key: "cao", label: "計画書（内閣府）", note: "内閣府 取組指針 令和7年6月更新・対応表 未照合", href: "/forms?form=cao", current: false, isDefault: false };
    const html = renderToStaticMarkup(createElement(DocumentMenu, { plan: [item], person: [], office: [] }));
    expect(html).toMatch(/class="[^"]*\bbreak-keep\b[^"]*\bwrap-anywhere\b[^"]*" data-menu-note="true">内閣府 取組指針 令和7年6月更新・対応表 未照合</);
  });
});
