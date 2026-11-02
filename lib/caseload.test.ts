import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../seed/people.ts";
import { PLAN_STATUSES } from "./db/types.ts";
import { caseloadHref, closeHref, parseOpen, PLAN_TONES, rowLink, sortCaseload, toCaseloadRows } from "./caseload.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
const row = (id: string) => rows.find((r) => r.id === id)!;

describe("担当一覧の行", () => {
  it("10 人ぶん、年齢・介護度・医療の印・ハザード・支援者・計画が出る", () => {
    expect(rows).toHaveLength(10);
    expect(row("p-01")).toMatchObject({
      name: "山田 ハナ",
      age: 84,
      careLevel: "care3",
      marks: ["酸素", "抗凝固"],
      hazards: ["浸水 3 m"],
      supporters: 2,
      plan: "draft",
      pending: 3,
      tier: 2,
    });
    expect(row("p-02").marks).toEqual(["呼吸器"]);
    expect(row("p-04")).toMatchObject({ marks: ["認知症"], hazards: ["土砂"], tier: 6 });
    expect(row("p-05")).toMatchObject({ supporters: 0, tier: 5 });
    expect(row("p-09")).toMatchObject({ marks: [], hazards: [], tier: 8 });
  });

  it("優先の順に並べると、骨格の順・同じならカナの順", () => {
    expect(sortCaseload(rows, "tier").map((r) => r.id)).toEqual([
      "p-02", // 1 呼吸器
      "p-01", // 2 酸素
      "p-03", // 3 透析
      "p-08", // 4 イノウエ
      "p-06", // 4 タカハシ
      "p-05", // 5 イトウ
      "p-07", // 5 カトウ
      "p-04", // 6 認知症で独居
      "p-10", // 8 ナカムラ
      "p-09", // 8 ワタナベ
    ]);
  });

  it("計画の順は未作成が先、同じなら未確認の多い順", () => {
    const ids = sortCaseload(rows, "plan").map((r) => r.id);
    expect(ids.slice(0, 3).sort()).toEqual(["p-04", "p-05", "p-09"]);
    expect(ids.slice(3, 5)).toEqual(["p-01", "p-07"]);
  });

  it("計画の状態の色: 未作成は灰、下書きは黄、同意済・訓練済は緑（赤は使わない）", () => {
    expect(PLAN_TONES).toEqual({ none: "unknown", draft: "check", consented: "ok", trained: "ok" });
    for (const s of PLAN_STATUSES) expect(PLAN_TONES[s], s).not.toBe("urgent");
  });
});

describe("右に開く本人のページ（?open=）", () => {
  it("URL: 既定の並びは書かず、open を足す・外す", () => {
    expect(caseloadHref({})).toBe("/");
    expect(caseloadHref({ sort: "tier" })).toBe("/");
    expect(caseloadHref({ sort: "kana" })).toBe("/?sort=kana");
    expect(caseloadHref({ open: "p-01" })).toBe("/?open=p-01");
    expect(caseloadHref({ sort: "plan", open: "p-03" })).toBe("/?sort=plan&open=p-03");
    expect(closeHref("age")).toBe("/?sort=age");
    expect(closeHref("tier")).toBe("/");
  });

  it("閉じているとき行を押すと開く（履歴に足す）、開いているときは切り替える（置き換えるので戻るで閉じる）", () => {
    expect(rowLink("tier", null, "p-01")).toEqual({ href: "/?open=p-01", replace: false, current: false });
    expect(rowLink("tier", "p-01", "p-02")).toEqual({ href: "/?open=p-02", replace: true, current: false });
    expect(rowLink("kana", "p-02", "p-02")).toEqual({ href: "/?sort=kana&open=p-02", replace: true, current: true });
  });

  it("open は 1 つの id の形のときだけ読む", () => {
    expect(parseOpen("p-01")).toBe("p-01");
    expect(parseOpen(undefined)).toBeNull();
    expect(parseOpen("")).toBeNull();
    expect(parseOpen(["p-01", "p-02"])).toBeNull();
    expect(parseOpen("p-01/../x")).toBeNull();
    expect(parseOpen("a".repeat(65))).toBeNull();
  });
});
