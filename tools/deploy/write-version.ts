// lib/version.ts（配信中の commit と build の時刻。/api/health が返す）を作る。docs/tasks/T41.md。
// npm の prebuild（opennextjs-cloudflare build が npm run build を呼ぶので配信の build でも流れる）・postinstall・predev・pretypecheck で流す。
// 生成物は commit しない（.gitignore）。git が無い・リポジトリの外なら commit は "unknown" で、止めない。
// 使い方: node tools/deploy/write-version.ts

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = fileURLToPath(new URL("../../lib/version.ts", import.meta.url));

/** 短い hash（7 字。tools/deploy/rebuild-remote.sh の確かめと同じ命令） */
function shortCommit(): string {
  try {
    const s = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{7,40}$/.test(s) ? s : "unknown";
  } catch {
    return "unknown";
  }
}

const commit = shortCommit();
const builtAt = new Date().toISOString();

writeFileSync(
  out,
  `// tools/deploy/write-version.ts が作る（commit しない）。/api/health が返す。\n` +
    `export const COMMIT = ${JSON.stringify(commit)};\n` +
    `export const BUILT_AT = ${JSON.stringify(builtAt)};\n`,
);
console.log(`lib/version.ts: ${commit} ${builtAt}`);
