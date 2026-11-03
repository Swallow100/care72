import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { login } from "../../lib/auth/principal.ts";
import { isPasswordHash, verifyPassword } from "../../lib/auth/password.ts";
import { d1FromSqlite, migratedSqlite } from "../../lib/db/test-d1.ts";
import { seedStatements } from "../../seed/sql.ts";
import { defaultPlanForm, newOfficeSql, parseNewOfficeArgs } from "./new-office.ts";

const script = fileURLToPath(new URL("./new-office.ts", import.meta.url));
const SECRET = "test-secret-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;

const tmp = () => mkdtempSync(join(tmpdir(), "t73-office-"));
const BASE = ["--name", "架空居宅介護支援", "--city", "今治市", "--login-id", "sato", "--display-name", "佐藤"];

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 60_000 });
}

/** 標準出力の「初期パスワード（今回だけ表示）: xxxx-xxxx-xxxx」から */
function passwordOf(stdout: string): string {
  const lines = stdout.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  const m = /^初期パスワード（今回だけ表示）: (\S+)$/.exec(lines[0]);
  expect(m).not.toBeNull();
  return m![1];
}

describe("事業所と最初の管理者を作る道具: 引数（T73 の 3）", () => {
  it("そろえて読む。id は office-<英数字 8 桁>、様式は市から", () => {
    const r = parseNewOfficeArgs(["--name", " 架空　居宅 ", "--city", "今治市", "--login-id", " ＳＡＴＯ ", "--display-name", "佐藤　花子"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("架空 居宅");
    expect(r.value.loginId).toBe("sato");
    expect(r.value.displayName).toBe("佐藤 花子");
    expect(r.value.officeId).toMatch(/^office-[0-9a-f]{8}$/);
    expect(r.value.planForm).toBe("cao");
    expect(r.value.out).toBeNull();
  });

  it("様式の既定: 松山市は松山市の様式、ほかは内閣府の様式例。--plan-form で選べる", () => {
    expect(defaultPlanForm("松山市")).toBe("matsuyama");
    expect(defaultPlanForm("今治市")).toBe("cao");
    const m = parseNewOfficeArgs([...BASE.slice(0, 2), "--city", "松山市", ...BASE.slice(4)]);
    expect(m.ok && m.value.planForm).toBe("matsuyama");
    const c = parseNewOfficeArgs([...BASE, "--plan-form", "matsuyama"]);
    expect(c.ok && c.value.planForm).toBe("matsuyama");
    const id = parseNewOfficeArgs([...BASE, "--id", "office-imabari1"]);
    expect(id.ok && id.value.officeId).toBe("office-imabari1");
  });

  it("断る: 足りない・市なし・予約の ID・短い ID・長い名前・空の名前・種の ID・種の事業所・形の違う id・知らない様式・知らない旗", () => {
    const bad: Array<[string, string[]]> = [
      ["足りない", ["--name", "架空"]],
      ["市なし", [...BASE.slice(0, 2), "--city", " ", ...BASE.slice(4)]],
      ["予約", [...BASE.slice(0, 4), "--login-id", "JUDGE", ...BASE.slice(6)]],
      ["短い ID", [...BASE.slice(0, 4), "--login-id", "ab", ...BASE.slice(6)]],
      ["種の ID", [...BASE.slice(0, 4), "--login-id", "yamamoto", ...BASE.slice(6)]],
      ["長い名前", [...BASE.slice(0, 6), "--display-name", "あ".repeat(21)]],
      ["空の名前", [...BASE.slice(0, 6), "--display-name", "　"]],
      ["事業所名なし", ["--name", "", ...BASE.slice(2)]],
      ["長い事業所名", ["--name", "あ".repeat(41), ...BASE.slice(2)]],
      ["改行", ["--name", "架空\n居宅", ...BASE.slice(2)]],
      ["種の事業所", [...BASE, "--id", "office-demo"]],
      ["協力事業所", [...BASE, "--id", "office-partner"]],
      ["形の違う id", [...BASE, "--id", "imabari"]],
      ["知らない様式", [...BASE, "--plan-form", "mapping:x"]],
      ["知らない旗", [...BASE, "--admin", "0"]],
    ];
    for (const [what, args] of bad) {
      const r = parseNewOfficeArgs(args);
      expect(r.ok, what).toBe(false);
    }
  });

  it("出力先にリポジトリの中は断る", () => {
    const inside = fileURLToPath(new URL("../../new-office.sql", import.meta.url));
    expect(parseNewOfficeArgs([...BASE, "--out", inside]).ok).toBe(false);
    expect(parseNewOfficeArgs([...BASE, "--out", join(tmp(), "a.sql")]).ok).toBe(true);
  });

  it("SQL の文の形（事業所 regular と、care_manager の管理者）", () => {
    const sql = newOfficeSql({
      officeId: "office-abcd1234",
      name: "架空の'居宅'",
      city: "今治市",
      planForm: "cao",
      loginId: "sato",
      displayName: "佐藤",
      accountId: "acct-x",
      passwordHash: "pbkdf2-sha256:1:AAAAAAAAAAA:BBBB",
      at: "2026-11-04T00:00:00.000Z",
    });
    expect(sql.split("\n").filter(Boolean)).toEqual([
      "INSERT INTO offices (id, name, kind, city, plan_form, created_at) VALUES ('office-abcd1234', '架空の''居宅''', 'regular', '今治市', 'cao', '2026-11-04T00:00:00.000Z');",
      "INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at) VALUES ('acct-x', 'office-abcd1234', 'care_manager', 1, '佐藤', 'sato', 'pbkdf2-sha256:1:AAAAAAAAAAA:BBBB', '2026-11-04T00:00:00.000Z');",
    ]);
    // 先頭が -- の注だと wrangler の --command で旗と読まれることがある（T73a）
    expect(sql.startsWith("--")).toBe(false);
  });
});

describe("事業所と最初の管理者を作る道具: 動かす", () => {
  it("SQL のファイルと初期パスワードの 1 回の表示。平文は SQL にも標準エラーにも無く、ハッシュで入れて login で入れる", async () => {
    const out = join(tmp(), "new-office.sql");
    const r = run([...BASE, "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    const password = passwordOf(r.stdout);
    expect(password).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);

    const sql = readFileSync(out, "utf8");
    expect(sql).not.toContain(password);
    expect(r.stderr).not.toContain(password);
    expect(r.stderr).toContain(out.replaceAll("\\", "/"));
    expect(r.stderr).toContain("--command=");
    const hash = /'(pbkdf2-sha256:[^']+)'/.exec(sql)?.[1] ?? "";
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword(password, hash)).toBe(true);

    // node:sqlite に migrations と種を入れて、SQL を流す
    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    const before = (db.prepare("SELECT count(*) AS n FROM offices").get() as { n: number }).n;
    db.exec(sql);
    const offices = db.prepare("SELECT id, name, kind, city, plan_form FROM offices WHERE id NOT IN ('office-demo', 'office-partner', 'office-unaffiliated')").all();
    expect(offices).toHaveLength(1);
    expect((db.prepare("SELECT count(*) AS n FROM offices").get() as { n: number }).n).toBe(before + 1);
    expect(offices[0]).toMatchObject({ name: "架空居宅介護支援", kind: "regular", city: "今治市", plan_form: "cao" });
    const accounts = db.prepare("SELECT office_id, role, is_office_admin, display_name, login_id, disabled_at FROM accounts WHERE login_id = 'sato'").all();
    expect(accounts).toEqual([
      { office_id: offices[0].id, role: "care_manager", is_office_admin: 1, display_name: "佐藤", login_id: "sato", disabled_at: null },
    ]);

    const res = await login(d1FromSqlite(db), {}, SECRET, { loginId: "sato", password }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.principal.role).toBe("care_manager");
    expect(res.principal.admin).toBe(true);
    expect(res.principal.office).toMatchObject({ id: offices[0].id, kind: "regular" });
    expect((await login(d1FromSqlite(db), {}, SECRET, { loginId: "sato", password: "wrong-pass-0000" }, NOW)).ok).toBe(false);
  });

  it("同じ ID の 2 つ目は UNIQUE で落ち、取引の中なら事業所も入らない（D1 の --command は 1 つの取引）", () => {
    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    const first = run([...BASE, "--out", join(tmp(), "1.sql")]);
    const second = run([...BASE, "--name", "別の事業所", "--out", join(tmp(), "2.sql")]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const sqlOf = (stderr: string) => readFileSync(/SQL: (.+\.sql)/.exec(stderr)![1], "utf8");
    db.exec(sqlOf(first.stderr));
    const count = () => (db.prepare("SELECT count(*) AS n FROM offices").get() as { n: number }).n;
    const n = count();
    db.exec("BEGIN");
    expect(() => db.exec(sqlOf(second.stderr))).toThrow(/UNIQUE/);
    db.exec("ROLLBACK");
    expect(count()).toBe(n);
  });

  it("出力先が既にあれば上書きせず、パスワードも出さない。引数が違えば何も書かない", () => {
    const out = join(tmp(), "exists.sql");
    writeFileSync(out, "前の物");
    const r = run([...BASE, "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("上書きしない");
    expect(readFileSync(out, "utf8")).toBe("前の物");

    const bad = run([...BASE.slice(0, 4), "--login-id", "judge", ...BASE.slice(6), "--out", join(tmp(), "x.sql")]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe("");
  });
});
