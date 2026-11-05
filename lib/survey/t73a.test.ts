// T73a: アンケートの表から offices への外部キーを外す（migrations/0021_survey_no_office_fk.sql）。
// 配信の作り直し（tools/deploy/rebuild-remote.sh の 前段 → drop → migrations → seed）を node:sqlite で再現し、
// 共有のリンクと答え（本物の答えの代わり。全部作り物）が残り、まだ答えられることを確かめる。

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite } from "../db/test-d1.ts";
import { demoResetStatements } from "../seed/reset.ts";
import { shareExpiresAt, SURVEY_MAX_ANSWERS } from "./share.ts";
import { loadSurveyOverview, lookupSurveyShare } from "./store.ts";
import { submitSurvey } from "./submit.ts";
import { MIN_FILL_SEC, newSurveyToken, openStamp } from "./token.ts";

const DIR = new URL("../../migrations/", import.meta.url);
const NAMES = readdirSync(DIR)
  .filter((n) => n.endsWith(".sql"))
  .sort();
const T73A = "0021_survey_no_office_fk.sql";
const sqlOf = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const SURVEY_TABLES = ["survey_links", "survey_answers", "survey_shares", "survey_responses"] as const;

/** 1 つの取引で流す（D1 の batch・migrations apply・--command と同じ。落ちたら巻き戻す） */
function tx(db: DatabaseSync, sql: string): void {
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * 0021 の前まで（今の本番の形: survey_shares・survey_links が offices を指す）に種を入れた DB。
 * 種は同意の AI 提供（0024、T74）を書くので 0024 は先に当てる（consents を建て直すだけで survey_ の表に触れない）。
 * 種は書類の見直しの表（0032、T136）と紙の手入れの表（0033、T135）も空にするので 0032・0033 も先に（新しい表を作るだけで survey_ の表に触れない）。
 * 種は連絡先のフリガナ・住所・携帯（0029、T117。T142 で種が書く）も書くので 0029 も先に（contacts に列を足すだけ）
 */
function beforeT73a(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  // 種はデモ事業所の情報と地域（0036、T148）も書くので 0036 も先に（offices に列を足すだけで survey の表に触れない）
  for (const name of NAMES.filter((n) => n < T73A || n.startsWith("0024_") || n.startsWith("0029_") || n.startsWith("0032_") || n.startsWith("0033_") || n.startsWith("0036_"))) tx(db, sqlOf(name));
  tx(db, seedStatements().join("\n"));
  return db;
}

/** rebuild-remote.sh の drop: survey_ 以外の表を sqlite_master から全部、逆順に 1 つの取引で落とす */
function dropAllButSurvey(db: DatabaseSync): void {
  const names = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'survey_%'",
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  tx(db, ["PRAGMA defer_foreign_keys = true;", ...names.reverse().map((t) => `DROP TABLE IF EXISTS "${t}";`)].join("\n"));
  const left = db
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'survey_%'")
    .get() as { n: number };
  expect(left.n).toBe(0);
}

/** rebuild-remote.sh の 前段（0021 を流す）→ drop → migrations を 0001 から 1 つずつ取引で → 種 */
function rebuild(db: DatabaseSync, { preDrop = true } = {}): void {
  if (preDrop) tx(db, sqlOf(T73A));
  dropAllButSurvey(db);
  for (const name of NAMES) tx(db, sqlOf(name));
  tx(db, seedStatements().join("\n"));
}

/** survey_ の 4 表の行を全部（順を決めて） */
function rows(db: DatabaseSync) {
  return Object.fromEntries(SURVEY_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));
}

/** survey_ の表と索引の形（sqlite_master の sql） */
function schema(db: DatabaseSync) {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name LIKE 'survey_%' ORDER BY type, name").all();
}

const fkTargets = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string; from: string; to: string }>).map((r) => `${r.from}→${r.table}.${r.to}`);

const T0 = new Date("2026-11-04T01:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const SECRET = "test-secret-for-survey-source-hash-0123456789";
const ANSWERS = { role: "a", experience: "c", q1: "b", q2: "d", q3: "b", q4: ["f", "b"], q5: "書く時間が取れない", q7: "c", q8: "b", q9: "a", quote: "a" };
/** T42 の 1 人 1 本のリンク（今は作る道が無いので行を直に入れる） */
const LEGACY = "l".repeat(43);

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

async function send(token: string, sec: number, answers: Record<string, unknown> = ANSWERS) {
  return submitSurvey(db, {
    token,
    contentType: "application/json",
    body: JSON.stringify({ opened: await openStamp(token, T0, SECRET), answers }),
    ip: "203.0.113.5",
    now: at(MIN_FILL_SEC + sec),
    secret: SECRET,
    turnstile: null,
  });
}

/** 山本の共有のリンクと答え 2 件、審査員のリンクと答え 1 件、T42 のリンクと答え 1 件 */
async function fill(): Promise<{ real: string; judge: string }> {
  // 0021 の前の本番の形の DB なので、行はそのころの作り方（1 本ずつ INSERT。T81 の 1 日の本数の数えは accounts.judge_made〔0025〕を読むので使えない）
  const made = (memo: string, createdBy: string, createdRole: "care_manager" | "judge") => {
    const token = newSurveyToken();
    sqlite
      .prepare(
        `INSERT INTO survey_shares (token, office_id, memo, created_by, created_role, created_at, expires_at, max_answers)
         VALUES (?, 'office-demo', ?, ?, ?, ?, ?, ?)`,
      )
      .run(token, memo, createdBy, createdRole, T0.toISOString(), shareExpiresAt(T0, createdRole === "judge"), SURVEY_MAX_ANSWERS);
    return token;
  };
  const real = made("紙の QR", "acct-yamamoto", "care_manager");
  const judge = made("試し", "acct-judge", "judge");
  expect((await send(real, 30)).status).toBe(200);
  expect((await send(real, 40, { ...ANSWERS, q1: "a", comment: "応援しています" })).status).toBe(200);
  expect((await send(judge, 50)).status).toBe(200);
  sqlite.exec(`INSERT INTO survey_links (token, office_id, memo, created_by, created_role, created_at, opened_at, used_at, expires_at)
    VALUES ('${LEGACY}', 'office-demo', 'ケアマネ A', 'acct-yamamoto', 'care_manager', '2026-11-03T01:00:00.000Z', '2026-11-03T02:00:00.000Z', '2026-11-03T02:05:00.000Z', '2026-11-17T01:00:00.000Z');
    INSERT INTO survey_answers (token, role, experience, q1, q2, q3, q4, q5, q6, q7, q7_reason, quote, source_hash, submitted_at)
    VALUES ('${LEGACY}', 'a', 'b', 'c', 'd', 'bcf', '時間', 'a', 'b', 'c', '理由', 'b', 'hash', '2026-11-03T02:05:00.000Z');`);
  return { real, judge };
}

beforeEach(() => {
  sqlite = beforeT73a();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

describe("T73a: 今の形（0016 まで）", () => {
  it("リンクがあると、配信の drop が取引の終わりに外部キーで落ちる。巻き戻るので行は残る", async () => {
    await fill();
    const before = rows(sqlite);
    expect(() => dropAllButSurvey(sqlite)).toThrow(/FOREIGN KEY constraint failed/);
    expect(rows(sqlite)).toEqual(before);
    expect(fkTargets(sqlite, "survey_shares")).toEqual(["office_id→offices.id"]);
  });
});

describe("T73a: 0021 で offices への外部キーを外す", () => {
  it("行はそのまま、offices への外部キーだけ外れ、survey_ どうしの外部キーと索引は残る（1 文ずつ流しても通る）", async () => {
    await fill();
    const before = rows(sqlite);
    // lib/db/test-d1.ts の migratedSqlite と同じ流し方（取引なし。PRAGMA defer_foreign_keys は文ごとに切れる）
    sqlite.exec(sqlOf(T73A));
    expect(rows(sqlite)).toEqual(before);
    expect(fkTargets(sqlite, "survey_shares")).toEqual([]);
    expect(fkTargets(sqlite, "survey_links")).toEqual([]);
    expect(fkTargets(sqlite, "survey_responses")).toEqual(["token→survey_shares.token"]);
    expect(fkTargets(sqlite, "survey_answers")).toEqual(["token→survey_links.token"]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const indexes = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' AND tbl_name LIKE 'survey_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    expect(indexes).toEqual(["survey_attempts_source", "survey_links_office", "survey_responses_token", "survey_shares_office"]);
    // 退けた表は残らない
    expect(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%_old'").get()).toEqual({ n: 0 });
    // survey_ どうしの外部キーは効く（無いリンクへの答えは入らない）
    expect(() => sqlite.exec(`INSERT INTO survey_responses (token, source_hash, submitted_at) VALUES ('${"x".repeat(43)}', 'h', 't')`)).toThrow(/FOREIGN KEY/);
    // 配信の drop（offices を含む survey_ 以外の全部）が通り、行は残る
    expect(() => dropAllButSurvey(sqlite)).not.toThrow();
    expect(rows(sqlite)).toEqual(before);
  });

  it("1 つの取引で流しても通り、何度流しても行と形が同じ（二重にならない）", async () => {
    await fill();
    const before = rows(sqlite);
    tx(sqlite, sqlOf(T73A));
    const once = schema(sqlite);
    tx(sqlite, sqlOf(T73A));
    tx(sqlite, sqlOf(T73A));
    expect(rows(sqlite)).toEqual(before);
    expect(schema(sqlite)).toEqual(once);
  });

  it("答えが 1 件も無くても通る", () => {
    tx(sqlite, sqlOf(T73A));
    tx(sqlite, sqlOf(T73A));
    for (const t of SURVEY_TABLES) expect(sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
  });
});

describe("T73a: 配信の作り直し（前段 → drop → migrations → 種）", () => {
  it("リンクと答えが残り、事業所の画面に出て、まだ答えられる。もう一度作り直しても同じ", async () => {
    const { real } = await fill();
    const before = rows(sqlite);

    rebuild(sqlite);
    expect(rows(sqlite)).toEqual(before);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(fkTargets(sqlite, "survey_shares")).toEqual([]);
    expect(fkTargets(sqlite, "survey_links")).toEqual([]);
    // 事業所の id は種の固定なので、作り直したあとも同じ事業所を指す
    expect(sqlite.prepare("SELECT s.token FROM survey_shares s JOIN offices o ON o.id = s.office_id WHERE o.id = 'office-demo' ORDER BY s.token").all()).toHaveLength(2);
    const shape = schema(sqlite);

    // 事業所の画面（/office）: 山本のリンクと答え 2 件
    const view = await loadSurveyOverview(db, "office-demo", { walled: false, admin: true, accountId: "acct-yamamoto" }, at(100).toISOString());
    expect(view.shares.find((s) => s.token === real)).toMatchObject({ state: "open", answers: 2 });
    expect(view.answers.filter((a) => !a.judge).map((a) => a.id)).toEqual(["W001", "W002"]);
    // 答える頁（/survey/<token>）: まだ受け付け、3 件目が入る
    expect(await lookupSurveyShare(db, real, at(100).toISOString())).toMatchObject({ kind: "open", answers: 2 });
    expect((await send(real, 60, { ...ANSWERS, q1: "c" })).status).toBe(200);
    // T42 のリンクは受付終了のまま残る
    expect(await lookupSurveyShare(db, LEGACY, at(100).toISOString())).toEqual({ kind: "closed" });
    const three = rows(sqlite);
    expect(three.survey_responses).toHaveLength(4);

    // もう一度（前段なし: 外部キーが外れたあとは、前段が無くても drop が通る）
    rebuild(sqlite, { preDrop: false });
    expect(rows(sqlite)).toEqual(three);
    expect(schema(sqlite)).toEqual(shape);
    rebuild(sqlite);
    expect(rows(sqlite)).toEqual(three);
    expect(schema(sqlite)).toEqual(shape);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("毎朝 4 時の戻しは、作り直しのあとも審査員のリンクと答えだけを消し、山本の物を残す", async () => {
    const { real, judge } = await fill();
    rebuild(sqlite);
    const now = at(3600).toISOString();
    tx(sqlite, demoResetStatements(now).join("\n"));
    const tokens = (sqlite.prepare("SELECT token FROM survey_shares ORDER BY token").all() as Array<{ token: string }>).map((r) => r.token);
    expect(tokens).toEqual([real]);
    expect(tokens).not.toContain(judge);
    expect(sqlite.prepare("SELECT count(*) AS n FROM survey_responses WHERE token = ?").get(real)).toEqual({ n: 2 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM survey_answers").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
