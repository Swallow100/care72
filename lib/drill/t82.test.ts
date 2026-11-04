// T82（朝の見直し 11/4 の「正しさ」低 10）: 同じケアマネの進行中（T70 の mineRunningSql）は開始者を IS で比べていたので、
// accountId が null のとき、開始者 NULL の訓練を自分の物と見ていた。= で比べる（NULL は誰の物でもない）。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { runningDrillId } from "./db.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const running = (id: string, startedBy: string | null, participants: string[] = []) =>
  sqlite.exec(
    `INSERT INTO drills (id, office_id, scenario, status, world, started_by, started_at)
     VALUES ('${id}', 'office-demo', 'short', 'running', '${JSON.stringify({ participants })}', ${startedBy ? `'${startedBy}'` : "NULL"}, '2026-11-04T00:00:00.000Z')`,
  );

/** 担当の人がいないケアマネ（参加者の筋では当たらない） */
const NOBODY = "acct-nobody";

describe("開始者の比べ方（T82）", () => {
  it("accountId が null でも、開始者 NULL の訓練を自分の物と見ない", async () => {
    running("d-null", null);
    expect(await runningDrillId(db, "office-demo", { scope: { accountId: null, careManagerId: NOBODY } })).toBeNull();
  });

  it("開始者が同じなら自分の物、違えば違う（今までどおり）", async () => {
    running("d-yamamoto", "acct-yamamoto");
    expect(await runningDrillId(db, "office-demo", { scope: { accountId: "acct-yamamoto", careManagerId: NOBODY } })).toBe("d-yamamoto");
    expect(await runningDrillId(db, "office-demo", { scope: { accountId: "acct-judge", careManagerId: NOBODY } })).toBeNull();
    expect(await runningDrillId(db, "office-demo", { scope: { accountId: null, careManagerId: NOBODY } })).toBeNull();
  });

  it("開始者 NULL でも、自分の担当一覧の人が参加していれば自分の物（参加者の筋は今までどおり）", async () => {
    running("d-null", null, ["p-01"]);
    expect(await runningDrillId(db, "office-demo", { scope: { accountId: null, careManagerId: "acct-yamamoto" } })).toBe("d-null");
  });
});
