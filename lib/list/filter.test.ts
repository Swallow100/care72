// 担当一覧の絞込・検索・並びの向き（docs/tasks/T58.md）。URL の読み方と書き方、絞っても優先の番号が変わらないこと、
// 向きの反転と aria-sort、絞込の帯の hidden（sort・dir・open の持ち越し）、上の人数のリンク。
// 行は種の 10 人と大雨の筋（lib/triage/heavy-rain.fixture.ts。lib/list/board.test.ts と同じ）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import {
  caseloadHref,
  closeHref,
  defaultDir,
  filterActive,
  filterCaseload,
  filterOptions,
  NO_FILTER,
  parseDir,
  parseFilter,
  rowLink,
  sortCaseload,
  SORT_KEYS,
  toCaseloadRows,
  type CaseloadDisaster,
} from "../caseload.ts";
import { SIGNALS, situation } from "../triage/heavy-rain.fixture.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { SortHeader, sortHeaderHref } = await import("../../components/list/SortHeader.tsx");
const { FilterBar } = await import("../../components/list/FilterBar.tsx");
const { DisasterSummary } = await import("../../components/list/DisasterSummary.tsx");

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));

function disasterAt(h: number): CaseloadDisaster {
  return { situation: { ...situation(h), outageTowns: null }, signals: new Map(Object.entries(SIGNALS)) };
}
const board = (h = 3) => toCaseloadRows(people, clocks, contacts, "2026-11-05", disasterAt(h));
const normal = () => toCaseloadRows(people, clocks, contacts, "2026-11-05");

describe("URL の読み方と書き方", () => {
  it("絞込: 形の違う物は無かったことに。地区と検索は前後の空白を除き 40 字まで", () => {
    expect(parseFilter({})).toEqual(NO_FILTER);
    expect(parseFilter({ color: "red", area: " かわなぎ町 ", mark: "oxygen", q: " やまだ " })).toEqual({
      color: "red",
      area: "かわなぎ町",
      mark: "oxygen",
      q: "やまだ",
    });
    expect(parseFilter({ color: "purple", area: "", mark: "coffee", q: ["a", "b"] })).toEqual(NO_FILTER);
    expect(parseFilter({ color: ["red", "green"] }).color).toBeNull();
    expect(parseFilter({ q: "あ".repeat(60) }).q).toHaveLength(40);
    expect(filterActive(NO_FILTER)).toBe(false);
    expect(filterActive({ ...NO_FILTER, q: "a" })).toBe(true);
  });

  it("向き: 既定は年齢・ハザード・状態が降順、ほかは昇順。形が違えば既定", () => {
    expect(SORT_KEYS.filter((k) => defaultDir(k) === "desc")).toEqual(["state", "age", "hazard"]);
    expect(parseDir("asc", "age")).toBe("asc");
    expect(parseDir("up", "age")).toBe("desc");
    expect(parseDir(undefined, "kana")).toBe("asc");
  });

  it("href: 既定の並び・向きと空の絞込は書かない。行のリンクと閉じるは絞込と向きを持ち越す", () => {
    expect(caseloadHref({ sort: "age", dir: "desc" })).toBe("/?sort=age");
    expect(caseloadHref({ sort: "age", dir: "asc" })).toBe("/?sort=age&dir=asc");
    expect(caseloadHref({ dir: "desc" })).toBe("/?dir=desc");
    const filter = { color: "red" as const, area: "かわなぎ町", mark: "oxygen" as const, q: "山田" };
    const view = { dir: "asc" as const, filter };
    expect(caseloadHref({ sort: "tier", filter: NO_FILTER })).toBe("/");
    expect(rowLink("kana", null, "p-01", view).href).toBe(
      `/?sort=kana&color=red&area=${encodeURIComponent("かわなぎ町")}&mark=oxygen&q=${encodeURIComponent("山田")}&open=p-01`,
    );
    expect(closeHref("age", view)).toBe(
      `/?sort=age&dir=asc&color=red&area=${encodeURIComponent("かわなぎ町")}&mark=oxygen&q=${encodeURIComponent("山田")}`,
    );
    // 書いた URL を読み直すと同じ絞込
    const u = new URL(closeHref("age", view), "https://care72.app");
    expect(parseFilter(Object.fromEntries(u.searchParams))).toEqual(filter);
    expect(parseDir(u.searchParams.get("dir"), "age")).toBe("asc");
  });
});

describe("絞込", () => {
  it("色・地区・医療・氏名とカナ（ひらがな・空白・全角半角をそろえる）。優先の番号は絞る前のまま", () => {
    const rows = sortCaseload(board(3), "tier");
    const rank = new Map(rows.map((r) => [r.id, r.rank]));
    const reds = filterCaseload(rows, { ...NO_FILTER, color: "red" });
    expect(reds.length).toBeGreaterThan(0);
    expect(reds.every((r) => r.triage!.color === "red")).toBe(true);
    for (const r of reds) expect(r.rank).toBe(rank.get(r.id));
    expect(reds.map((r) => r.id)).toEqual(rows.filter((r) => r.triage!.color === "red").map((r) => r.id));

    expect(filterCaseload(rows, { ...NO_FILTER, area: "かわなぎ町" }).map((r) => r.id).sort()).toEqual(["p-01", "p-02"]);
    expect(filterCaseload(rows, { ...NO_FILTER, mark: "oxygen" }).map((r) => r.id)).toEqual(["p-01"]);
    expect(filterCaseload(rows, { ...NO_FILTER, q: "やまだ　はな" }).map((r) => r.id)).toEqual(["p-01"]);
    expect(filterCaseload(rows, { ...NO_FILTER, q: "ﾔﾏﾀﾞ" }).map((r) => r.id)).toEqual(["p-01"]);
    expect(filterCaseload(rows, { ...NO_FILTER, q: "山田" }).map((r) => r.id)).toEqual(["p-01"]);
    expect(filterCaseload(rows, { ...NO_FILTER, area: "かわなぎ町", mark: "dialysis" })).toEqual([]);
    expect(filterCaseload(rows, NO_FILTER)).toEqual(rows);
  });

  it("平時の行は色を持たないので、色で絞ると誰も残らない（画面は平時に色を渡さない）", () => {
    expect(filterCaseload(normal(), { ...NO_FILTER, color: "green" })).toEqual([]);
    expect(filterCaseload(normal(), { ...NO_FILTER, area: "そらみ台" }).map((r) => r.id).sort()).toEqual(["p-09", "p-10"]);
  });

  it("選ぶ所の中身: 地区は町名のカナ順で重ねない、医療は骨格の順でいる区分だけ", () => {
    const o = filterOptions(board(3));
    expect(o.areas).toEqual([...new Set(o.areas)]);
    expect(o.areas).toContain("かわなぎ町");
    expect(o.areas).toHaveLength(6);
    expect(o.marks.map(([c]) => c).slice(0, 3)).toEqual(["ventilator", "oxygen", "dialysis"]);
    expect(o.marks.map(([c]) => c)).not.toContain("suction");
  });
});

describe("並びの向き", () => {
  it("押している列をもう一度押すと反転。同じならカナの順のまま。優先の番号は変わらない", () => {
    const rows = board(3);
    const desc = sortCaseload(rows, "age");
    const asc = sortCaseload(rows, "age", "asc");
    const ages = (rs: typeof rows) => rs.map((r) => r.age ?? -1);
    expect(ages(desc)).toEqual([...ages(desc)].sort((a, b) => b - a));
    expect(ages(asc)).toEqual([...ages(asc)].sort((a, b) => a - b));
    const kana = sortCaseload(rows, "kana", "desc").map((r) => r.kana);
    expect(kana).toEqual([...kana].sort((a, b) => b.localeCompare(a, "ja")));
    expect(sortCaseload(rows, "tier", "desc").map((r) => r.rank)).toEqual([...rows.map((r) => r.rank)].sort((a, b) => b! - a!));
    expect(sortCaseload(rows, "age", "desc")).toEqual(desc);
  });

  it("見出し: aria-sort は今の向き、押している列は反転、ほかの列は既定。絞込を持ち越す。訓練の href はそのまま", () => {
    const filter = { ...NO_FILTER, area: "そらみ台" };
    const html = (dir?: "asc" | "desc") =>
      renderToStaticMarkup(createElement("table", null, createElement("thead", null, createElement("tr", null,
        createElement(SortHeader, { k: "age", sort: "age", dir, filter }),
        createElement(SortHeader, { k: "kana", sort: "age", dir, filter }),
      ))));
    const d = html("desc");
    expect(d).toContain('aria-sort="descending"');
    expect(d).toContain(`href="/?sort=age&amp;dir=asc&amp;area=${encodeURIComponent("そらみ台")}"`);
    expect(d).toContain(`href="/?sort=kana&amp;area=${encodeURIComponent("そらみ台")}"`);
    const a = html("asc");
    expect(a).toContain('aria-sort="ascending"');
    expect(a).toContain(`href="/?sort=age&amp;area=${encodeURIComponent("そらみ台")}"`);
    expect(sortHeaderHref("state", "tier", "asc")).toBe("/?sort=state");
    const drill = renderToStaticMarkup(createElement("table", null, createElement("thead", null, createElement("tr", null,
      createElement(SortHeader, { k: "age", sort: "age", href: "/drill/x?sort=age" }),
    ))));
    expect(drill).toContain('href="/drill/x?sort=age"');
    expect(drill).toContain('aria-sort="descending"');
  });
});

describe("絞込の帯と上の人数", () => {
  it("form は GET で、sort・dir・open を hidden で持ち越す。色は発災時だけ。解除は絞っているときだけ", () => {
    const props = { areas: ["かわなぎ町"], marks: [["oxygen", "酸素"]] as Array<["oxygen", string]>, sort: "age" as const, dir: "asc" as const, open: "p-01" };
    const on = renderToStaticMarkup(createElement(FilterBar, { ...props, filter: { ...NO_FILTER, q: "山田" }, disaster: true }));
    expect(on).toMatch(/<form[^>]*action="\/"[^>]*method="get"/);
    expect(on).toContain('<input type="hidden" name="sort" value="age"/>');
    expect(on).toContain('<input type="hidden" name="dir" value="asc"/>');
    expect(on).toContain('<input type="hidden" name="open" value="p-01"/>');
    expect(on).toContain('data-filter="color"');
    expect(on).toContain('name="q"');
    expect(on).toContain("data-filter-clear");
    expect(on).toContain('href="/?sort=age&amp;dir=asc&amp;open=p-01"');
    const off = renderToStaticMarkup(
      createElement(FilterBar, { ...props, sort: "tier", dir: "asc", open: null, filter: NO_FILTER, disaster: false }),
    );
    expect(off).not.toContain('data-filter="color"');
    expect(off).not.toContain('name="sort"');
    expect(off).not.toContain('name="dir"');
    expect(off).not.toContain("data-filter-clear");
  });

  it("上の人数を押すとその色で絞る（今の色はもう一度押すと解除）。href が無ければ押せない（訓練）", () => {
    const counts = { red: 2, yellow: 3, gray: 4, green: 1 };
    const base = { counts, disaster: "5 時間", outage: null, at: "11/5 21:00" };
    const linked = renderToStaticMarkup(
      createElement(DisasterSummary, { ...base, current: "red", href: (c) => caseloadHref({ filter: { ...NO_FILTER, color: c === "red" ? null : c } }) }),
    );
    expect(linked).toContain('data-count-link="yellow"');
    expect(linked).toContain('href="/?color=yellow"');
    expect(linked).toMatch(/aria-current="true"[^>]*data-count="red"|data-count="red"[^>]*aria-current="true"|aria-current="true"[\s\S]*?data-count-link="red"/);
    const plain = renderToStaticMarkup(createElement(DisasterSummary, base));
    expect(plain).not.toContain("<a ");
    expect(plain).toContain("<dl");
  });
});
