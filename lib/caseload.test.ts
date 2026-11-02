import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../seed/people.ts";
import { sortCaseload, toCaseloadRows } from "./caseload.ts";

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

  it("緊急度の順に並べると、骨格の順・同じならカナの順", () => {
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
});
