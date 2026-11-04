import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migratedSqlite } from "../../lib/db/test-d1.ts";
import { SEED_ACCOUNTS, SEED_OFFICES } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import {
  COUNT_SQL,
  countSql,
  decideGuard,
  GUARD_TABLES,
  parseWranglerJson,
  runGuard,
  TABLES_SQL,
  type GuardCounts,
} from "./guard.ts";

/** wrangler d1 execute --json の形で返す（前に知らせの行を付けて、読み方も確かめる） */
function fakeWrangler(db: DatabaseSync) {
  const seen: string[] = [];
  const query = (sql: string) => {
    seen.push(sql);
    const results = db.prepare(sql).all();
    return `▲ [WARNING] 版の案内\n${JSON.stringify([{ results, success: true, meta: { duration: 1 } }], null, 2)}\n`;
  };
  return { query, seen };
}

function seeded(): DatabaseSync {
  const db = migratedSqlite();
  for (const s of seedStatements()) db.exec(s);
  return db;
}

/** 本物の事業所を 1 つ（事業所・管理者・利用者・訓練を 1 行ずつ） */
function addRealOffice(db: DatabaseSync) {
  db.exec(`INSERT INTO offices (id, name, kind, city) VALUES ('office-real0001', '本物の事業所', 'regular', '今治市');
    INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id) VALUES ('acct-real', 'office-real0001', 'care_manager', 1, '佐藤', 'sato');
    INSERT INTO people (id, office_id, care_manager_id, name, kana) VALUES ('p-real', 'office-real0001', 'acct-real', '架空 太郎', 'カクウ タロウ');
    INSERT INTO drills (id, office_id, scenario, status, started_at) VALUES ('d-real', 'office-real0001', 'short', 'finished', '2026-11-04T00:00:00Z');`);
}

const counts = (o: Partial<GuardCounts> = {}): GuardCounts => ({ people: 0, accounts: 0, offices: 0, drills: 0, ...o });

describe("作り直しの守り: 判定（T73 の 2）", () => {
  it("全部 0 なら続ける", () => {
    const d = decideGuard(counts(), false);
    expect(d.ok).toBe(true);
    expect(d.lines[0]).toBe("本物データなし");
  });

  it("どれか 1 つでも 0 でなければ止める。ALLOW_DATA_LOSS=1 なら数を出して続ける", () => {
    for (const t of GUARD_TABLES) {
      const stop = decideGuard(counts({ [t]: 2 }), false);
      expect(stop.ok, t).toBe(false);
      expect(stop.lines[0]).toBe("本物データあり 停止");
      expect(stop.lines.join("\n")).toContain(" 2");
      const go = decideGuard(counts({ [t]: 2 }), true);
      expect(go.ok, t).toBe(true);
      expect(go.lines[0]).toContain("続行");
      expect(go.lines.join("\n")).toContain(" 2");
    }
  });

  it("数が読めなければ ALLOW_DATA_LOSS=1 でも止める", () => {
    expect(decideGuard(null, false).ok).toBe(false);
    expect(decideGuard(null, true).ok).toBe(false);
    expect(decideGuard(null, true, "wrangler 1").lines).toEqual(["数が読めない 停止", "  wrangler 1"]);
  });
});

describe("作り直しの守り: 問い（node:sqlite に migrations と種）", () => {
  it("種だけなら 4 つとも 0 で続ける", async () => {
    const { query, seen } = fakeWrangler(seeded());
    const d = await runGuard(query, {});
    expect(d.ok).toBe(true);
    expect(d.lines).toEqual(["本物データなし", "  利用者（デモ事業所の外） 0", "  アカウント（種の外） 0", "  事業所（種の外） 0", "  訓練（デモ事業所の外） 0"]);
    expect(seen[0]).toBe(TABLES_SQL);
  });

  it("本物の事業所が 1 つあれば止める（4 つとも 1）。ALLOW_DATA_LOSS=1 だけ続ける", async () => {
    const db = seeded();
    addRealOffice(db);
    const stop = await runGuard(fakeWrangler(db).query, {});
    expect(stop.ok).toBe(false);
    expect(stop.lines.slice(0, 5)).toEqual([
      "本物データあり 停止",
      "  利用者（デモ事業所の外） 1",
      "  アカウント（種の外） 1",
      "  事業所（種の外） 1",
      "  訓練（デモ事業所の外） 1",
    ]);
    expect((await runGuard(fakeWrangler(db).query, { ALLOW_DATA_LOSS: "true" })).ok).toBe(false);
    expect((await runGuard(fakeWrangler(db).query, { ALLOW_DATA_LOSS: "1" })).ok).toBe(true);
  });

  it("デモ事業所の中で増えた利用者・訓練は数えない（毎朝 4 時に種に戻る物）", async () => {
    const db = seeded();
    db.exec(`INSERT INTO people (id, office_id, care_manager_id, name, kana) VALUES ('p-judge', 'office-demo', 'acct-yamamoto', '架空 花子', 'カクウ ハナコ');
      INSERT INTO drills (id, office_id, scenario, status, started_at) VALUES ('d-demo', 'office-demo', 'short', 'running', '2026-11-04T00:00:00Z');`);
    expect((await runGuard(fakeWrangler(db).query, {})).ok).toBe(true);
  });

  it("協力事業所・所属なしの利用者は数える（デモ事業所の外）", async () => {
    const db = seeded();
    db.exec(`INSERT INTO people (id, office_id, name, kana) VALUES ('p-site', 'office-unaffiliated', '架空 次郎', 'カクウ ジロウ');`);
    const d = await runGuard(fakeWrangler(db).query, {});
    expect(d.ok).toBe(false);
    expect(d.lines).toContain("  利用者（デモ事業所の外） 1");
  });

  it("表がまだ無い D1 は 0 と数えて続ける。表が一部だけでも読める", async () => {
    const empty = await runGuard(fakeWrangler(new DatabaseSync(":memory:")).query, {});
    expect(empty.ok).toBe(true);

    const part = new DatabaseSync(":memory:");
    part.exec("CREATE TABLE offices (id TEXT PRIMARY KEY); INSERT INTO offices VALUES ('office-demo'), ('office-x');");
    const d = await runGuard(fakeWrangler(part).query, {});
    expect(d.ok).toBe(false);
    expect(d.lines).toContain("  事業所（種の外） 1");
  });

  it("wrangler が落ちた・JSON が読めない・数の形が違うときは、ALLOW_DATA_LOSS=1 でも止める", async () => {
    const env = { ALLOW_DATA_LOSS: "1" };
    const thrown = await runGuard(() => {
      throw new Error("wrangler 1: Authentication error\napi token: xxxxx");
    }, env);
    expect(thrown.ok).toBe(false);
    expect(thrown.lines.join("\n")).not.toMatch(/token/i);

    expect((await runGuard(() => "読めない", env)).ok).toBe(false);
    expect((await runGuard(() => JSON.stringify([{ success: false, results: [] }]), env)).ok).toBe(false);

    let n = 0;
    const badCount = () => (n++ === 0 ? JSON.stringify([{ success: true, results: [] }]) : JSON.stringify([{ success: true, results: [{ people: "x" }] }]));
    expect((await runGuard(badCount, env)).lines[0]).toBe("数が読めない 停止");
  });

  it("数え方は種の id から作り、survey_ の表に触れない", () => {
    for (const a of SEED_ACCOUNTS) expect(COUNT_SQL.accounts).toContain(`'${a.id}'`);
    for (const o of SEED_OFFICES) expect(COUNT_SQL.offices).toContain(`'${o.id}'`);
    const all = [TABLES_SQL, countSql(new Set(GUARD_TABLES)), ...Object.values(COUNT_SQL)].join("\n");
    expect(all).not.toMatch(/survey_/i);
    expect(all).not.toMatch(/\b(DELETE|DROP|UPDATE|INSERT)\b/i);
  });
});

describe("parseWranglerJson", () => {
  it("前に知らせがあっても読む。[ を含む知らせも飛ばす", () => {
    const body = JSON.stringify([{ results: [{ n: 3 }], success: true }]);
    expect(parseWranglerJson(body)).toEqual([{ n: 3 }]);
    expect(parseWranglerJson(`[版の案内] 新しい版\n${body}`)).toEqual([{ n: 3 }]);
    expect(parseWranglerJson("")).toBeNull();
    expect(parseWranglerJson("[]")).toBeNull();
  });
});
