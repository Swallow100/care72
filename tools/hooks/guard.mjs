// PreToolUse のフック（.claude/settings.json）。Bash・PowerShell の命令と、Read・Write・Edit・NotebookEdit・Grep のパスを見る。
// 止める物なら理由を stderr に書いて 2 で終わる。Claude Code はその理由を Claude に返し、道具は動かない。
// 決まりは tools/hooks/rules.ts（node の型の取り除きで .ts をそのまま読む）。
// 入力が読めない・中で落ちたときも 2 で終わる（通さない側に倒す）。node が起動できないときは止められない（docs/CLAUDE_CODE.md）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { judgeToolUse } from "./rules.ts";

function scriptsOf(dir) {
  try {
    const scripts = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts;
    return scripts && typeof scripts === "object" ? scripts : {};
  } catch {
    return {};
  }
}

try {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const verdict = judgeToolUse(input, { scripts: scriptsOf(projectDir) });
  if (verdict.block) {
    process.stderr.write(`${verdict.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
} catch (e) {
  process.stderr.write(`止めた: フックの中で誤り（${e instanceof Error ? e.message : String(e)}）。読めない入力は通さない側に倒した\n`);
  process.exit(2);
}
