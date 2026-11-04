import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compareLock,
  formatLock,
  hashMigration,
  LOCK_PATH,
  lockEntries,
  parseLock,
  readMigrations,
} from "./lock-migrations.ts";

const script = fileURLToPath(new URL("./lock-migrations.ts", import.meta.url));

describe("migrations の錠（T73 の 1）", () => {
  it("リポジトリの錠と今の migrations/ が合う（入った番号のファイルを書き換えていない）", () => {
    const lock = parseLock(readFileSync(LOCK_PATH, "utf8"));
    expect(lock.length).toBeGreaterThanOrEqual(14);
    expect(lock[0].file).toBe("0001_init.sql");
    expect(compareLock(lock, readMigrations())).toEqual([]);
  });

  it("node tools/deploy/lock-migrations.ts --check が通る", () => {
    const r = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8", timeout: 30_000 });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("錠どおり");
  });

  it("作る → 比べる → 1 文字変えると落ちる", () => {
    const dir = mkdtempSync(join(tmpdir(), "t73-lock-"));
    writeFileSync(join(dir, "0001_init.sql"), "CREATE TABLE a (id TEXT);\n");
    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (id TEXT);\n");
    writeFileSync(join(dir, "notes.txt"), "migration でない");
    const lock = parseLock(formatLock(readMigrations(dir)));
    expect(lock.map((e) => e.file)).toEqual(["0001_init.sql", "0002_b.sql"]);
    expect(compareLock(lock, readMigrations(dir))).toEqual([]);

    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (id TEXT);;\n");
    expect(compareLock(lock, readMigrations(dir))).toEqual(["0002 中身変更 0002_b.sql"]);
  });

  it("新しい番号は錠に無くてよい。消えた・名前が変わった・同じ番号が増えたは落ちる", () => {
    const base = lockEntries([
      { name: "0001_init.sql", text: "x" },
      { name: "0002_b.sql", text: "y" },
    ]);
    const added = lockEntries([
      { name: "0001_init.sql", text: "x" },
      { name: "0002_b.sql", text: "y" },
      { name: "0003_c.sql", text: "z" },
    ]);
    expect(compareLock(base, added)).toEqual([]);

    expect(compareLock(base, lockEntries([{ name: "0001_init.sql", text: "x" }]))).toEqual(["0002 消えた 0002_b.sql"]);
    expect(
      compareLock(base, lockEntries([{ name: "0001_init.sql", text: "x" }, { name: "0002_bb.sql", text: "y" }])),
    ).toEqual(["0002 名前変更 0002_b.sql → 0002_bb.sql"]);
    expect(
      compareLock(
        base,
        lockEntries([
          { name: "0001_init.sql", text: "x" },
          { name: "0002_b.sql", text: "y" },
          { name: "0002_z.sql", text: "w" },
        ]),
      ),
    ).toEqual(["0002 番号重複 0002_z.sql"]);
  });

  it("錠の最大より小さい新しい番号は落ちる（migration だけの配信は最後に、作り直しは番号の順に当て、当てる順が分かれる）", () => {
    const base = lockEntries([
      { name: "0001_init.sql", text: "x" },
      { name: "0003_c.sql", text: "z" },
      { name: "0010_j.sql", text: "j" },
    ]);
    // 空いた番号（0002・0009）を埋める新しい物は断る。数で比べる（0009 < 0010）
    expect(
      compareLock(base, [...base, ...lockEntries([{ name: "0002_b.sql", text: "y" }, { name: "0009_i.sql", text: "i" }])]),
    ).toEqual(["0002 最大より小さい番号 0002_b.sql（錠の最大 0010）", "0009 最大より小さい番号 0009_i.sql（錠の最大 0010）"]);
    // 最大より大きい物は今までどおり通る
    expect(compareLock(base, [...base, ...lockEntries([{ name: "0011_k.sql", text: "k" }])])).toEqual([]);
    // 錠が空なら比べる最大が無い
    expect(compareLock([], lockEntries([{ name: "0001_init.sql", text: "x" }]))).toEqual([]);
  });

  it("改行の CRLF と LF は同じ値", () => {
    expect(hashMigration("a\r\nb\r\n")).toBe(hashMigration("a\nb\n"));
    expect(hashMigration("a\nb\n")).not.toBe(hashMigration("a\nb"));
  });

  it("形の違う錠の行は読まない", () => {
    expect(() => parseLock("0001 0002_x.sql " + "0".repeat(64))).toThrow();
    expect(() => parseLock("0001 0001_x.sql abc")).toThrow();
    expect(parseLock("# 注\n\n0001 0001_x.sql " + "a".repeat(64) + "\n")).toHaveLength(1);
  });
});
