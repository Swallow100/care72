import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { Situation } from "../triage/index.ts";
import { entryPlace, form9Scope, insertRankEdit, loadForm9, loadSituation } from "./form9-db.ts";

const TODAY = "2026-11-02";
let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const principal = (p: Partial<Principal>): Principal => ({
  role: "care_manager",
  judge: false,
  admin: false,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});

describe("開ける人と範囲", () => {
  it("ケアマネの役（管理者・審査員を含む）だけ。範囲は事業所", () => {
    expect(form9Scope(principal({ admin: true }))).toEqual({ officeId: "office-demo" });
    expect(form9Scope(principal({ admin: false, judge: true, accountId: "acct-judge" }))).toEqual({ officeId: "office-demo" });
    expect(form9Scope(principal({ role: "medical", office: null, caseloadOf: null }))).toBeNull();
    expect(form9Scope(principal({ role: "family", personId: "p-01" }))).toBeNull();
    expect(form9Scope(principal({ role: "unselected" }))).toBeNull();
    expect(form9Scope(principal({ office: null }))).toBeNull();
    expect(form9Scope(null)).toBeNull();
  });

  it("災害モードの表（disaster_state、T09）に行が無ければ平時。災害モードの行は lib/disaster/disaster.test.ts", async () => {
    expect(await loadSituation(db, "office-demo")).toBeNull();
  });
});

describe("D1 から読む（平時）", () => {
  it("デモ事業所の 10 人が優先順位で並ぶ。協力事業所は空", async () => {
    const data = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: null });
    expect(data?.office).toEqual({ id: "office-demo", name: "デモ事業所" });
    expect(data?.sheet.mode).toBe("normal");
    expect(data?.sheet.rows.map((r) => r.id)).toEqual([
      "p-02",
      "p-01",
      "p-03",
      "p-06",
      "p-08",
      "p-05",
      "p-07",
      "p-04",
      "p-09",
      "p-10",
    ]);
    expect(data?.sheet.rows[0].cells.careManager).toBe("山本");
    const partner = await loadForm9(db, { officeId: "office-partner" }, { today: TODAY, situation: null });
    expect(partner?.sheet.rows).toEqual([]);
    expect(await loadForm9(db, { officeId: "office-none" }, { today: TODAY, situation: null })).toBeNull();
  });
});

describe("手直しの保存", () => {
  const base = {
    officeId: "office-demo",
    mode: "normal" as const,
    autoRank: 10,
    reason: "妻が入院中で夜は独り",
    setBy: "acct-yamamoto",
  };

  it("中村さんを 1 位に直すと、読み直しても 1 位で、理由と直した人が残る", async () => {
    expect(
      await insertRankEdit(db, { ...base, id: "e1", personId: "p-10", rank: 1, setAt: "2026-11-02T09:00:00.000Z" }),
    ).toBe(true);
    const data = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: null });
    expect(data?.sheet.rows[0]).toMatchObject({ id: "p-10", rank: 1, autoRank: 10 });
    expect(data?.sheet.rows[0].manual).toEqual({
      rank: 1,
      autoRank: 10,
      reason: "妻が入院中で夜は独り",
      by: "山本",
      at: "2026-11-02T09:00:00.000Z",
    });
  });

  it("直した記録は消さずに足す。「自動に戻す」で元の順位に戻り、前の理由は表に残る", async () => {
    await insertRankEdit(db, { ...base, id: "e1", personId: "p-10", rank: 1, setAt: "2026-11-02T09:00:00.000Z" });
    await insertRankEdit(db, { ...base, id: "e2", personId: "p-10", rank: null, autoRank: 10, reason: "", setAt: "2026-11-02T09:10:00.000Z" });
    const data = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: null });
    expect(data?.sheet.rows.at(-1)).toMatchObject({ id: "p-10", rank: 10, manual: null });
    const kept = sqlite.prepare("SELECT id, rank, reason FROM form9_rank_edits ORDER BY set_at").all();
    expect(kept).toEqual([
      { id: "e1", rank: 1, reason: "妻が入院中で夜は独り" },
      { id: "e2", rank: null, reason: "" },
    ]);
  });

  it("ほかの事業所の本人には足せない（事業所の壁）", async () => {
    sqlite.exec(
      `INSERT INTO people (id, office_id, name, kana) VALUES ('p-x', 'office-partner', '架空 太郎', 'カクウ タロウ');`,
    );
    expect(await insertRankEdit(db, { ...base, id: "e1", personId: "p-x", rank: 1, setAt: "2026-11-02T09:00:00.000Z" })).toBe(false);
    expect(await insertRankEdit(db, { ...base, id: "e2", personId: "p-none", rank: 1, setAt: "2026-11-02T09:00:00.000Z" })).toBe(false);
    expect(sqlite.prepare("SELECT count(*) AS n FROM form9_rank_edits").get()).toEqual({ n: 0 });
  });

  it("理由の無い手直しは表の CHECK でも止まる", () => {
    expect(() =>
      sqlite.exec(
        `INSERT INTO form9_rank_edits (id, office_id, person_id, mode, rank, auto_rank, reason, set_at)
         VALUES ('e1', 'office-demo', 'p-10', 'normal', 1, 10, '  ', '2026-11-02T09:00:00.000Z');`,
      ),
    ).toThrow();
  });

  it("種を入れ直すと手直しも消える（本人・事業所と一緒に）", async () => {
    await insertRankEdit(db, { ...base, id: "e1", personId: "p-10", rank: 1, setAt: "2026-11-02T09:00:00.000Z" });
    for (const s of seedStatements()) sqlite.exec(s);
    expect(sqlite.prepare("SELECT count(*) AS n FROM form9_rank_edits").get()).toEqual({ n: 0 });
  });
});

describe("D1 から読む（発災時、信号の表を読む口）", () => {
  const situation: Situation = {
    disasterAt: "2026-11-03T00:00:00Z",
    outageAt: "2026-11-03T01:00:00Z",
    now: "2026-11-03T05:00:00Z",
  };
  const signal = (id: string, person: string, color: string, source: string, at: string, extra = "") =>
    sqlite.exec(
      `INSERT INTO signals (id, person_id, color, source, occurred_at${extra ? ", " + extra.split("=")[0] : ""})
       VALUES ('${id}', '${person}', '${color}', '${source}', '${at}'${extra ? ", " + extra.split("=")[1] : ""});`,
    );

  it("訓練の信号と発災の前の信号を使わず、色と順位で並べ、結果と避難所の名前を入れる", async () => {
    signal("s1", "p-01", "red", "family", "2026-11-03T03:00:00.000Z", "can_move=0");
    signal("s2", "p-03", "green", "family", "2026-11-03T02:00:00.000Z", "where_now='home'");
    signal("s3", "p-10", "green", "family", "2026-11-03T04:10:00.000Z", "where_now='home'");
    signal("s4", "p-07", "red", "self", "2026-11-02T08:00:00.000Z"); // 発災の前
    signal("s5", "p-09", "red", "self", "2026-11-03T06:00:00.000Z"); // 今より後
    sqlite.exec(
      `INSERT INTO drills (id, office_id, scenario, status, started_at) VALUES ('d1', 'office-demo', 'heavy_rain', 'running', '2026-11-03T00:00:00.000Z');
       INSERT INTO signals (id, person_id, drill_id, color, source, occurred_at) VALUES ('s6', 'p-05', 'd1', 'red', 'agent', '2026-11-03T03:00:00.000Z');
       INSERT INTO timeline_entries (id, person_id, author_role, kind, body, payload, occurred_at)
         VALUES ('t1', 'p-08', 'medical', 'arrived_shelter', NULL, '{"shelter":"うみなり高台の集会所"}', '2026-11-03T04:30:00.000Z');
       INSERT INTO timeline_entries (id, person_id, author_role, kind, body, occurred_at)
         VALUES ('t2', 'p-02', 'medical', 'transported', '病院へ', '2026-11-03T04:50:00.000Z');
       INSERT INTO timeline_entries (id, person_id, author_role, kind, body, occurred_at)
         VALUES ('t3', 'p-06', 'care_manager', 'note', 'かわなぎ小学校', '2026-11-03T04:50:00.000Z');`,
    );
    const data = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation });
    const sheet = data!.sheet;
    expect(sheet.mode).toBe("disaster");
    const byId = new Map(sheet.rows.map((r) => [r.id, r]));
    expect(sheet.rows.slice(0, 3).map((r) => [r.id, r.color])).toEqual([
      ["p-01", "red"], // 家族が「動けない」
      ["p-02", "red"], // 呼吸器の電池を超過
      ["p-03", "yellow"], // 透析先 未確認
    ]);
    expect(byId.get("p-07")?.color).toBe("gray"); // 発災の前の赤は使わない
    expect(byId.get("p-09")?.color).toBe("gray"); // 今より後の赤は使わない
    expect(byId.get("p-05")?.color).toBe("gray"); // 訓練の赤は使わない
    expect(byId.get("p-01")?.cells.result).toBe("「無事じゃない」 動けない （家族）");
    expect(byId.get("p-08")?.result).toMatchObject({ label: "到着", location: "shelter", place: "うみなり高台の集会所" });
    expect(byId.get("p-02")?.result).toMatchObject({ label: "搬送", location: "transported" });
    expect(byId.get("p-06")?.result).toMatchObject({ label: "未確認" }); // 自由文（note）は結果に使わない
    expect(byId.get("p-10")?.cells.checkedAt).toBe("2026-11-03 13:10");
  });

  it("経過の避難所の名前: payload の shelter、無ければ到着・受入の本文", () => {
    expect(entryPlace({ kind: "arrived_shelter", body: "そらみ台小学校", payload: null })).toBe("そらみ台小学校");
    expect(entryPlace({ kind: "received", body: null, payload: '{"shelter":"みずほし公民館"}' })).toBe("みずほし公民館");
    expect(entryPlace({ kind: "transported", body: "病院へ", payload: null })).toBeNull();
    expect(entryPlace({ kind: "arrived_shelter", body: null, payload: "{壊れた" })).toBeNull();
  });
});
