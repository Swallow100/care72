import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ageOn } from "../lib/age.ts";
import { SEED_PEOPLE, seedConsents } from "./people.ts";
import { seedStatements } from "./sql.ts";

const SEED_DAY = "2026-11-02";

describe("種のデータ（架空の 10 人）", () => {
  it("docs/SPEC.md の表の 10 人で、11 人目は入れない", () => {
    expect(SEED_PEOPLE.map((p) => p.person.name)).toEqual([
      "山田 ハナ",
      "小林 トシ",
      "田中 茂",
      "佐藤 キミ",
      "伊藤 フミ",
      "高橋 ユキ",
      "加藤 正",
      "井上 誠",
      "渡辺 清",
      "中村 勇",
    ]);
  });

  it("年齢は表のとおり（2026-11-02 で）", () => {
    const ages = SEED_PEOPLE.map((p) => ageOn(p.person.birth_date!, SEED_DAY));
    expect(ages).toEqual([84, 86, 79, 88, 89, 91, 78, 76, 82, 80]);
  });

  it("電話は全部 090-0000-00NN で、重ならない", () => {
    const phones = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => c.phone)).filter(
      (v): v is string => v !== null,
    );
    expect(phones.length).toBeGreaterThan(0);
    for (const ph of phones) expect(ph).toMatch(/^090-0000-00\d\d$/);
    expect(new Set(phones).size).toBe(phones.length);
  });

  it("住所は町名までで、番地の数字を持たない", () => {
    for (const p of SEED_PEOPLE) {
      const a = p.ledger.basic.address;
      expect(a, p.person.name).toBeDefined();
      expect(a!.town).not.toMatch(/[0-9０-９]/);
      expect(Object.keys(a!).sort()).toEqual(["city", "town"]);
    }
  });

  it("同意の違いは 7（支援者への提供）と 9（医療班への提供）だけ", () => {
    const refused = SEED_PEOPLE.flatMap((p) =>
      seedConsents(p)
        .filter((c) => c.status !== "granted")
        .map((c) => `${p.person.id}:${c.kind}`),
    );
    expect(refused).toEqual(["p-07:supporters", "p-09:medical"]);
    for (const p of SEED_PEOPLE) expect(seedConsents(p)).toHaveLength(4);
  });

  it("人が付ける欄: 3 田中の透析の時計は頼り先 透析先・未確認、4 佐藤に本人の報告を当てにしない印。ほかは無い", () => {
    const checks = SEED_PEOPLE.flatMap((p) =>
      p.clocks.filter((k) => k.depends_on !== null || k.depends_check !== null).map((k) => [p.person.id, k.id, k.depends_on, k.depends_check]),
    );
    expect(checks).toEqual([["p-03", "k-03-1", "dialysis_center", "unconfirmed"]]);
    const marked = SEED_PEOPLE.filter((p) => p.person.self_report_unreliable === 1).map((p) => p.person.id);
    expect(marked).toEqual(["p-04"]);
  });

  it("頼り先と確認は両方あるか、両方無いか（SQL の CHECK）", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
    for (const s of seedStatements()) db.exec(s);
    const put = (id: string, dependsOn: string | null, check: string | null) =>
      db
        .prepare(
          `INSERT INTO clocks (id, person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check)
           VALUES (?, 'p-08', 'supply', 'insulin', 'x', 4, 'day', 'outage', ?, ?)`,
        )
        .run(id, dependsOn, check);
    expect(() => put("k-x1", "refrigeration", null)).toThrow();
    expect(() => put("k-x2", null, "unconfirmed")).toThrow();
    expect(() => put("k-x3", "refrigeration", "maybe")).toThrow();
    expect(() => put("k-x4", "refrigeration", "confirmed")).not.toThrow();
    db.close();
  });

  it("migration と種の SQL が SQLite で通る（外部キーと CHECK を含めて）", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
    for (const s of seedStatements()) db.exec(s);
    const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(count("people")).toBe(10);
    expect(count("consents")).toBe(40);
    expect(count("contacts")).toBe(SEED_PEOPLE.reduce((n, p) => n + p.contacts.length, 0));
    expect(count("clocks")).toBe(SEED_PEOPLE.reduce((n, p) => n + p.clocks.length, 0));
    // 2 回流しても同じ（最初に空にする）
    for (const s of seedStatements()) db.exec(s);
    expect(count("people")).toBe(10);
    db.close();
  });
});
