import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migratedSqlite } from "./db/test-d1.ts";
import { SEED_PEOPLE } from "../seed/people.ts";
import { seedStatements } from "../seed/sql.ts";
import { clockCheckEntry, selfReportMarkEntry, type MarkAuthor, type NewTimelineEntry } from "./ledger-marks.ts";

const CM: MarkAuthor = { id: "acct-yamamoto", role: "care_manager" };
const AT = "2026-11-03T01:00:00.000Z";
const tanakaDialysis = { ...SEED_PEOPLE[2].clocks[0], person_id: "p-03" };

function seededDb(): DatabaseSync {
  // migrations を全部流す（種の入れ直しは 0002 以降の表も空にするので、0001 だけでは通らない）
  const db = migratedSqlite();
  for (const s of seedStatements()) db.exec(s);
  return db;
}

function insert(db: DatabaseSync, e: NewTimelineEntry): void {
  const cols = Object.keys(e) as Array<keyof NewTimelineEntry>;
  db.prepare(`INSERT INTO timeline_entries (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
    ...cols.map((c) => e[c]),
  );
}

describe("人が付ける欄の経過", () => {
  it("時計の頼り先の確認: 何を・前と後・誰が・いつを残す", () => {
    const e = clockCheckEntry({ id: "t-1", clock: tanakaDialysis, to: "confirmed", by: CM, at: AT });
    expect(e).toMatchObject({
      person_id: "p-03",
      author_id: "acct-yamamoto",
      author_role: "care_manager",
      kind: "clock_check",
      body: "透析 次の回まで 透析先 確認済",
      occurred_at: AT,
    });
    expect(JSON.parse(e.payload!)).toEqual({ clockId: "k-03-1", dependsOn: "dialysis_center", from: "unconfirmed", to: "confirmed" });
  });

  it("本人の報告を当てにしない印: 付けた・外した", () => {
    const on = selfReportMarkEntry({ id: "t-2", personId: "p-04", from: false, to: true, by: CM, at: AT });
    expect(on).toMatchObject({ kind: "self_report_mark", body: "本人の報告を当てにしない印を付けた", occurred_at: AT });
    expect(JSON.parse(on.payload!)).toEqual({ from: false, to: true });
    const off = selfReportMarkEntry({ id: "t-3", personId: "p-04", from: true, to: false, by: CM, at: AT });
    expect(off.body).toBe("本人の報告を当てにしない印を外した");
  });

  it("書けるのは人の役だけ（system・本人・家族の役では作れない）", () => {
    for (const role of ["system", "self", "family"]) {
      const by = { id: "x", role } as unknown as MarkAuthor;
      expect(() => clockCheckEntry({ id: "t", clock: tanakaDialysis, to: "confirmed", by, at: AT })).toThrow();
      expect(() => selfReportMarkEntry({ id: "t", personId: "p-04", from: false, to: true, by, at: AT })).toThrow();
    }
    const medical: MarkAuthor = { id: "acct-x", role: "medical" };
    expect(() => selfReportMarkEntry({ id: "t", personId: "p-04", from: false, to: true, by: medical, at: AT })).not.toThrow();
  });

  it("頼り先の無い時計には確認を付けない", () => {
    const oxygen = { ...SEED_PEOPLE[0].clocks[0], person_id: "p-01" };
    expect(oxygen.depends_on).toBeNull();
    expect(() => clockCheckEntry({ id: "t", clock: oxygen, to: "confirmed", by: CM, at: AT })).toThrow();
  });

  it("経過の表の CHECK を通る", () => {
    const db = seededDb();
    insert(db, clockCheckEntry({ id: "t-1", clock: tanakaDialysis, to: "confirmed", by: CM, at: AT }));
    insert(db, selfReportMarkEntry({ id: "t-2", personId: "p-04", from: false, to: true, by: CM, at: AT }));
    const kinds = db.prepare("SELECT kind FROM timeline_entries ORDER BY id").all() as Array<{ kind: string }>;
    expect(kinds.map((r) => r.kind)).toEqual(["clock_check", "self_report_mark"]);
    db.close();
  });
});
