// migrations の錠（docs/tasks/T73.md の 1）。docs/deploy/migrations.lock に、番号ごとのファイル名と SHA-256 を持つ。
// 使い方: node tools/deploy/lock-migrations.ts（錠を作り直す）、node tools/deploy/lock-migrations.ts --check（今の migrations/ と比べる）
//
// migration だけ当てる配信（tools/deploy/migrate-remote.sh）は、d1_migrations に無い番号だけを当てる。
// だから入った番号のファイルを書き換えても本番には届かず、手元（db:fresh）と本番の表の形が黙って食い違う。
// 錠にある番号のファイルが変わった・消えた・名前が変わった・同じ番号のファイルが増えたら落ちる。新しい番号は錠に無くてよい。
// 錠を作り直すのは、本番がまだ当てていない番号を直したときだけ。commit のメッセージに理由を書く。
// 改行は LF にそろえて計る（.gitattributes は eol=lf だが、core.autocrlf の checkout でも同じ値にするため）。

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type LockEntry = { number: string; file: string; sha256: string };

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MIGRATIONS_DIR = resolve(ROOT, "migrations");
export const LOCK_PATH = resolve(ROOT, "docs/deploy/migrations.lock");

/** wrangler の migrations の名前（0001_init.sql）。番号は頭の数字 */
const MIGRATION_NAME = /^(\d+)_[^\s]+\.sql$/;

const HEADER = [
  "# migrations の錠。node tools/deploy/lock-migrations.ts で作る（手で直さない。作り直すときは commit に理由）",
  "# 番号 ファイル SHA-256（改行を LF にそろえて計る）。ここにある番号のファイルは書き換えない（tools/deploy/migrate-remote.sh）",
];

/** 改行を LF にそろえた SHA-256 */
export function hashMigration(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** ファイル（名前と中身）から錠の行。migration の名前でない物は外す。名前の順 */
export function lockEntries(files: ReadonlyArray<{ name: string; text: string }>): LockEntry[] {
  return files
    .flatMap((f) => {
      const m = MIGRATION_NAME.exec(f.name);
      return m ? [{ number: m[1], file: f.name, sha256: hashMigration(f.text) }] : [];
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function readMigrations(dir: string = MIGRATIONS_DIR): LockEntry[] {
  return lockEntries(
    readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .map((name) => ({ name, text: readFileSync(resolve(dir, name), "utf8") })),
  );
}

export function formatLock(entries: readonly LockEntry[]): string {
  return [...HEADER, ...entries.map((e) => `${e.number} ${e.file} ${e.sha256}`)].join("\n") + "\n";
}

/** 錠の文を読む。# の行と空の行は飛ばす。形の違う行があれば投げる */
export function parseLock(text: string): LockEntry[] {
  const out: LockEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\d+) (\S+) ([0-9a-f]{64})$/.exec(line);
    if (!m || MIGRATION_NAME.exec(m[2])?.[1] !== m[1]) throw new Error(`錠の行が読めない: ${line}`);
    out.push({ number: m[1], file: m[2], sha256: m[3] });
  }
  return out;
}

/** 錠と今の migrations を比べる。違いの 1 行ずつ（無ければ空）。錠に無い新しい番号は違いにしない */
export function compareLock(lock: readonly LockEntry[], current: readonly LockEntry[]): string[] {
  const problems: string[] = [];
  for (const l of lock) {
    const same = current.filter((c) => c.number === l.number);
    const file = same.find((c) => c.file === l.file);
    if (!file) {
      problems.push(same.length ? `${l.number} 名前変更 ${l.file} → ${same.map((c) => c.file).join(" ")}` : `${l.number} 消えた ${l.file}`);
      continue;
    }
    if (file.sha256 !== l.sha256) problems.push(`${l.number} 中身変更 ${l.file}`);
    for (const extra of same.filter((c) => c.file !== l.file)) problems.push(`${l.number} 番号重複 ${extra.file}`);
  }
  return problems;
}

function main(): void {
  const current = readMigrations();
  if (process.argv.includes("--check")) {
    let lock: LockEntry[];
    try {
      lock = parseLock(readFileSync(LOCK_PATH, "utf8"));
    } catch (e) {
      process.stderr.write(`錠が読めない: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    }
    const problems = compareLock(lock, current);
    for (const p of problems) process.stdout.write(`  ${p}\n`);
    const added = current.filter((c) => !lock.some((l) => l.number === c.number)).map((c) => c.file);
    process.stdout.write(problems.length ? "錠と違う\n" : `錠どおり（${lock.length} 本${added.length ? `、新しい ${added.join(" ")}` : ""}）\n`);
    process.exit(problems.length ? 1 : 0);
  }
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  writeFileSync(LOCK_PATH, formatLock(current));
  process.stdout.write(`錠を作った: ${current.length} 本（${current[0]?.file ?? "-"} 〜 ${current.at(-1)?.file ?? "-"}）\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
