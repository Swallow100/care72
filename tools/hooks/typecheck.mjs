// PostToolUse のフック（.claude/settings.json）。Write・Edit で .ts・.tsx を書いたあとに、リポジトリ全体の型の検査を流す。
// npm run typecheck と同じ tsc --noEmit を、npm を通さず node で直接呼ぶ（npm の起動の分だけ速い。11/2 に測って 8〜9 秒）。
// 誤りがあれば先頭の 30 行を stderr に書いて 2 で終わる。Claude Code はそれを Claude に見せる（書いた物は戻らない）。
// どのファイルで流すかは tools/hooks/rules.ts の typecheckTarget。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { typecheckTarget } from "./rules.ts";

const SHOWN_LINES = 30;
const LIMIT_MS = 50_000;

let input;
try {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const target = typecheckTarget(input, projectDir);
if (!target) process.exit(0);

const tsc = join(projectDir, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tsc)) {
  process.stderr.write("型の検査を飛ばした: node_modules に typescript が無い（npm install を先に）\n");
  process.exit(1);
}

const r = spawnSync(process.execPath, [tsc, "--noEmit", "--pretty", "false"], {
  cwd: projectDir,
  encoding: "utf8",
  timeout: LIMIT_MS,
});
if (r.error) {
  process.stderr.write(`型の検査が ${LIMIT_MS / 1000} 秒で終わらなかった（${r.error.message}）。npm run typecheck を手で流す\n`);
  process.exit(1);
}
if (r.status === 0) process.exit(0);

const lines = `${r.stdout}${r.stderr}`.split(/\r?\n/).filter((l) => l.trim() !== "");
const errors = lines.filter((l) => /error TS\d+/.test(l)).length;
const out = [`型の検査（tsc --noEmit、${target} を書いたあと）で誤り ${errors} 件。直してから続ける:`, ...lines.slice(0, SHOWN_LINES)];
if (lines.length > SHOWN_LINES) out.push(`…ほか ${lines.length - SHOWN_LINES} 行（npm run typecheck で全部）`);
process.stderr.write(`${out.join("\n")}\n`);
process.exit(2);
