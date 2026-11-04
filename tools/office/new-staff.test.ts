import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { changeOwnPassword } from "../../lib/auth/password-change.ts";
import { isPasswordHash, verifyPassword } from "../../lib/auth/password.ts";
import { pageExit } from "../../lib/auth/phone-gate.ts";
import { login } from "../../lib/auth/principal.ts";
import { homePath } from "../../lib/auth/roles.ts";
import { staffActor } from "../../lib/custody/actor.ts";
import { loadStaffBoard } from "../../lib/custody/board.ts";
import { listShelters } from "../../lib/custody/search.ts";
import { d1FromSqlite, migratedSqlite } from "../../lib/db/test-d1.ts";
import { seedStatements } from "../../seed/sql.ts";
import { defaultStaffOutPath, newStaffSql, parseNewStaffArgs } from "./new-staff.ts";

const script = fileURLToPath(new URL("./new-staff.ts", import.meta.url));
const officeScript = fileURLToPath(new URL("./new-office.ts", import.meta.url));
const SECRET = "test-secret-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;

const tmp = () => mkdtempSync(join(tmpdir(), "t97-staff-"));
const BASE = ["--role", "medical", "--login-id", "kyugo1", "--display-name", "第1救護所"];

function run(path: string, args: string[]) {
  return spawnSync(process.execPath, [path, ...args], { encoding: "utf8", timeout: 60_000 });
}

/** 標準出力の「初期パスワード（今回だけ表示）: xxxx-xxxx-xxxx」から */
function passwordOf(stdout: string): string {
  const lines = stdout.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  const m = /^初期パスワード（今回だけ表示）: (\S+)$/.exec(lines[0]);
  expect(m).not.toBeNull();
  return m![1];
}

const sqlOf = (stderr: string) => readFileSync(/SQL: (.+\.sql)/.exec(stderr)![1], "utf8");

/** 種を入れた手元の D1（node:sqlite） */
function seeded() {
  const db = migratedSqlite();
  for (const s of seedStatements()) db.exec(s);
  return db;
}

describe("医療班・行政のアカウントを作る道具: 引数（T97）", () => {
  it("そろえて読む。役は medical と government", () => {
    const r = parseNewStaffArgs(["--role", "government", "--login-id", " ＳＨＩ-01 ", "--display-name", "市　防災課"]);
    expect(r).toEqual({
      ok: true,
      value: { action: "create", role: "government", loginId: "shi-01", displayName: "市 防災課", out: null },
    });
    const m = parseNewStaffArgs(BASE);
    expect(m.ok && m.value.action === "create" && m.value.role).toBe("medical");
  });

  it("変える動き: --reissue・--disable・--enable は ID だけ", () => {
    for (const action of ["reissue", "disable", "enable"] as const) {
      const r = parseNewStaffArgs([`--${action}`, "--login-id", "KYUGO1"]);
      expect(r, action).toEqual({ ok: true, value: { action, loginId: "kyugo1", out: null } });
    }
  });

  it("断る: 役なし・ケアマネ・審査員・知らない役・予約の ID・種の ID・短い ID・長い名前・空の名前・制御文字・動き 2 つ・動きに名前・知らない旗", () => {
    const bad: Array<[string, string[]]> = [
      ["役なし", BASE.slice(2)],
      ["ケアマネ", ["--role", "care_manager", ...BASE.slice(2)]],
      ["審査員", ["--role", "judge", ...BASE.slice(2)]],
      ["知らない役", ["--role", "self", ...BASE.slice(2)]],
      ["ID なし", [...BASE.slice(0, 2), ...BASE.slice(4)]],
      ["予約", [...BASE.slice(0, 2), "--login-id", "JUDGE", ...BASE.slice(4)]],
      ["種の ID", [...BASE.slice(0, 2), "--login-id", "yamamoto", ...BASE.slice(4)]],
      ["短い ID", [...BASE.slice(0, 2), "--login-id", "ab", ...BASE.slice(4)]],
      ["名前なし", BASE.slice(0, 4)],
      ["長い名前", [...BASE.slice(0, 4), "--display-name", "あ".repeat(21)]],
      ["空の名前", [...BASE.slice(0, 4), "--display-name", "　"]],
      ["制御文字", [...BASE.slice(0, 4), "--display-name", "第1\u0007救護所"]],
      ["動き 2 つ", ["--reissue", "--disable", "--login-id", "kyugo1"]],
      ["動きに役", ["--reissue", "--role", "medical", "--login-id", "kyugo1"]],
      ["動きに名前", ["--disable", "--display-name", "x", "--login-id", "kyugo1"]],
      ["動きに種の ID", ["--reissue", "--login-id", "yamamoto"]],
      ["動きに予約", ["--disable", "--login-id", "judge"]],
      ["動きに ID なし", ["--enable"]],
      ["知らない旗", [...BASE, "--admin"]],
      ["位置の引数", [...BASE, "x"]],
    ];
    for (const [what, args] of bad) expect(parseNewStaffArgs(args).ok, what).toBe(false);
  });

  it("出力先にリポジトリの中は断る。既定はホームの下で動きごとの名前", () => {
    const inside = fileURLToPath(new URL("../../new-staff.sql", import.meta.url));
    expect(parseNewStaffArgs([...BASE, "--out", inside]).ok).toBe(false);
    expect(parseNewStaffArgs(["--reissue", "--login-id", "kyugo1", "--out", inside]).ok).toBe(false);
    expect(parseNewStaffArgs([...BASE, "--out", join(tmp(), "a.sql")]).ok).toBe(true);
    const at = new Date(2026, 10, 4, 9, 5, 7);
    expect(defaultStaffOutPath("create", at, "/home/x").replaceAll("\\", "/")).toMatch(/\/home\/x\/care72-staff-new-20261104-090507\.sql$/);
    expect(defaultStaffOutPath("disable", at, "/home/x").replaceAll("\\", "/")).toMatch(/care72-staff-disable-20261104-090507\.sql$/);
  });

  it("SQL の文の形: 作るは事業所なし（NULL）・管理者でない 1 行、変える動きは事業所なしの医療班・行政の行だけ", () => {
    const o = { accountId: "acct-x", passwordHash: "pbkdf2-sha256:1:AAAAAAAAAAA:BBBB", at: "2026-11-04T00:00:00.000Z" };
    const create = newStaffSql({ action: "create", role: "medical", loginId: "kyugo1", displayName: "第1'救護所'", out: null }, o);
    expect(create).toBe(
      "INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at) VALUES ('acct-x', NULL, 'medical', 0, '第1''救護所''', 'kyugo1', 'pbkdf2-sha256:1:AAAAAAAAAAA:BBBB', '2026-11-04T00:00:00.000Z');\n",
    );
    const where = "login_id = 'kyugo1' AND office_id IS NULL AND role IN ('medical', 'government')";
    expect(newStaffSql({ action: "reissue", loginId: "kyugo1", out: null }, o)).toBe(
      `UPDATE accounts SET password_hash = 'pbkdf2-sha256:1:AAAAAAAAAAA:BBBB' WHERE ${where};\n`,
    );
    expect(newStaffSql({ action: "disable", loginId: "kyugo1", out: null }, { ...o, passwordHash: null })).toBe(
      `UPDATE accounts SET disabled_at = '2026-11-04T00:00:00.000Z' WHERE ${where} AND disabled_at IS NULL;\n`,
    );
    expect(newStaffSql({ action: "enable", loginId: "kyugo1", out: null }, { ...o, passwordHash: null })).toBe(
      `UPDATE accounts SET disabled_at = NULL WHERE ${where} AND disabled_at IS NOT NULL;\n`,
    );
    // 先頭が -- の注だと wrangler の --command で旗と読まれることがある（T73a）。1 文だけ
    for (const sql of [create]) {
      expect(sql.startsWith("--")).toBe(false);
      expect(sql.trimEnd().split("\n")).toHaveLength(1);
    }
    expect(() => newStaffSql({ action: "create", role: "medical", loginId: "kyugo1", displayName: "x", out: null }, { ...o, passwordHash: null })).toThrow();
  });
});

describe("医療班・行政のアカウントを作る道具: 動かす", () => {
  it("SQL のファイルと初期パスワードの 1 回の表示。平文は SQL にも標準エラーにも無く、入れると医療班で入れて受入一覧が開く", async () => {
    const out = join(tmp(), "new-staff.sql");
    const r = run(script, [...BASE, "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    const password = passwordOf(r.stdout);
    expect(password).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);

    const sql = readFileSync(out, "utf8");
    expect(sql).not.toContain(password);
    expect(r.stderr).not.toContain(password);
    expect(r.stderr).toContain(out.replaceAll("\\", "/"));
    expect(r.stderr).toContain("--command=");
    expect(r.stderr).not.toContain("--file");
    const hash = /'(pbkdf2-sha256:[^']+)'/.exec(sql)?.[1] ?? "";
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword(password, hash)).toBe(true);

    const db = seeded();
    const before = (db.prepare("SELECT count(*) AS n FROM offices").get() as { n: number }).n;
    db.exec(sql);
    expect((db.prepare("SELECT count(*) AS n FROM offices").get() as { n: number }).n).toBe(before);
    const rows = db.prepare("SELECT office_id, role, is_office_admin, display_name, login_id, disabled_at, judge_made FROM accounts WHERE login_id = 'kyugo1'").all();
    expect(rows).toEqual([
      { office_id: null, role: "medical", is_office_admin: 0, display_name: "第1救護所", login_id: "kyugo1", disabled_at: null, judge_made: 0 },
    ]);

    const res = await login(d1FromSqlite(db), {}, SECRET, { loginId: "kyugo1", password }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.principal;
    expect(p).toMatchObject({ role: "medical", admin: false, office: null, judge: false, judgeMade: false, caseloadOf: null, displayName: "第1救護所" });
    expect(res.path).toBe("/staff");
    expect(homePath(p.role)).toBe("/staff");
    // 受入一覧（/staff）の入口の守りを通り、担当一覧・事業所の画面へは送り返される
    expect(pageExit("staff", p, null)).toBeNull();
    expect(pageExit("caseload", p, null)).toBe("/staff");
    expect(pageExit("drill", p, null)).toBe("/staff");
    // 受入一覧の中身（受け持ち 0 人・避難所の一覧）を読める。壁の外（審査員の印なし）
    const actor = staffActor(p);
    expect(actor).toMatchObject({ role: "medical", accountId: p.accountId, walled: false, judge: false });
    const board = await loadStaffBoard(d1FromSqlite(db), actor!, "2026-11-04", "2026-11-04T00:00:00.000Z");
    expect(board.rows).toEqual([]);
    await expect(listShelters(d1FromSqlite(db), actor!)).resolves.toBeInstanceOf(Array);

    expect((await login(d1FromSqlite(db), {}, SECRET, { loginId: "kyugo1", password: "wrong-pass-0000" }, NOW)).ok).toBe(false);
  });

  it("行政も同じ形で入れる", async () => {
    const r = run(script, ["--role", "government", "--login-id", "shi-bosai", "--display-name", "市 防災課", "--out", join(tmp(), "g.sql")]);
    expect(r.status, r.stderr).toBe(0);
    const db = seeded();
    db.exec(sqlOf(r.stderr));
    const res = await login(d1FromSqlite(db), {}, SECRET, { loginId: "shi-bosai", password: passwordOf(r.stdout) }, NOW);
    expect(res.ok && res.principal.role).toBe("government");
    expect(res.ok && res.principal.office).toBeNull();
    expect(res.ok && res.path).toBe("/staff");
  });

  it("入った人は自分のパスワードを変えられる（事業所の経過には書かない）", async () => {
    const r = run(script, [...BASE, "--out", join(tmp(), "p.sql")]);
    const password = passwordOf(r.stdout);
    const db = seeded();
    db.exec(sqlOf(r.stderr));
    const d1 = d1FromSqlite(db);
    const res = await login(d1, {}, SECRET, { loginId: "kyugo1", password }, NOW);
    if (!res.ok) throw new Error("ログインできない");
    const timeline = () => (db.prepare("SELECT count(*) AS n FROM office_timeline_entries").get() as { n: number }).n;
    const n = timeline();
    const next = "kyugo-new-pass-01";
    const changed = await changeOwnPassword(d1, {}, SECRET, res.principal, { current: password, next }, NOW, { iterations: 1000 });
    expect(changed.ok).toBe(true);
    expect(timeline()).toBe(n);
    expect((await login(d1, {}, SECRET, { loginId: "kyugo1", password }, NOW)).ok).toBe(false);
    expect((await login(d1, {}, SECRET, { loginId: "kyugo1", password: next }, NOW)).ok).toBe(true);
  });

  it("再発行・停止・再開: 医療班・行政の行だけを変え、ケアマネの行には効かない", async () => {
    const db = seeded();
    const d1 = d1FromSqlite(db);
    const created = run(script, [...BASE, "--out", join(tmp(), "c.sql")]);
    const first = passwordOf(created.stdout);
    db.exec(sqlOf(created.stderr));

    // 再発行: 新しいパスワードで入れ、前のは通らない
    const re = run(script, ["--reissue", "--login-id", "kyugo1", "--out", join(tmp(), "r.sql")]);
    expect(re.status, re.stderr).toBe(0);
    const second = passwordOf(re.stdout);
    expect(second).not.toBe(first);
    const reSql = sqlOf(re.stderr);
    expect(reSql).not.toContain(second);
    expect(re.stderr).not.toContain(second);
    db.exec(reSql);
    expect((await login(d1, {}, SECRET, { loginId: "kyugo1", password: first }, NOW)).ok).toBe(false);
    expect((await login(d1, {}, SECRET, { loginId: "kyugo1", password: second }, NOW)).ok).toBe(true);

    // 停止: ログインできない。標準出力には何も出さない
    const off = run(script, ["--disable", "--login-id", "kyugo1", "--out", join(tmp(), "d.sql")]);
    expect(off.status, off.stderr).toBe(0);
    expect(off.stdout).toBe("");
    db.exec(sqlOf(off.stderr));
    expect((await login(d1, {}, SECRET, { loginId: "kyugo1", password: second }, NOW)).ok).toBe(false);

    // 再開: また入れる
    const on = run(script, ["--enable", "--login-id", "kyugo1", "--out", join(tmp(), "e.sql")]);
    expect(on.status, on.stderr).toBe(0);
    expect(on.stdout).toBe("");
    db.exec(sqlOf(on.stderr));
    expect((await login(d1, {}, SECRET, { loginId: "kyugo1", password: second }, NOW)).ok).toBe(true);

    // ケアマネ（new-office.ts の管理者）の ID で再発行・停止しても変わらない
    const office = run(officeScript, ["--name", "架空居宅介護支援", "--city", "今治市", "--login-id", "sato", "--display-name", "佐藤", "--out", join(tmp(), "o.sql")]);
    expect(office.status, office.stderr).toBe(0);
    const cmPassword = passwordOf(office.stdout);
    db.exec(sqlOf(office.stderr));
    const cmRow = () => db.prepare("SELECT password_hash, disabled_at FROM accounts WHERE login_id = 'sato'").get();
    const beforeRow = cmRow();
    for (const action of ["--reissue", "--disable"]) {
      const x = run(script, [action, "--login-id", "sato", "--out", join(tmp(), `x${action}.sql`)]);
      expect(x.status, x.stderr).toBe(0);
      db.exec(sqlOf(x.stderr));
    }
    expect(cmRow()).toEqual(beforeRow);
    expect((await login(d1, {}, SECRET, { loginId: "sato", password: cmPassword }, NOW)).ok).toBe(true);
  });

  it("同じ ID の 2 つ目は UNIQUE で落ち、何も入らない", () => {
    const db = seeded();
    const first = run(script, [...BASE, "--out", join(tmp(), "1.sql")]);
    const second = run(script, ["--role", "government", "--login-id", "kyugo1", "--display-name", "別", "--out", join(tmp(), "2.sql")]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    db.exec(sqlOf(first.stderr));
    const count = () => (db.prepare("SELECT count(*) AS n FROM accounts").get() as { n: number }).n;
    const n = count();
    expect(() => db.exec(sqlOf(second.stderr))).toThrow(/UNIQUE/);
    expect(count()).toBe(n);
  });

  it("出力先が既にあれば上書きせず、パスワードも出さない。引数が違えば何も書かない", () => {
    const out = join(tmp(), "exists.sql");
    writeFileSync(out, "前の物");
    const r = run(script, [...BASE, "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("上書きしない");
    expect(readFileSync(out, "utf8")).toBe("前の物");

    const bad = run(script, ["--role", "care_manager", ...BASE.slice(2), "--out", join(tmp(), "x.sql")]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe("");
  });
});
