// Claude Code の設定（.claude/settings.json のフック）が、リポジトリの中の物とそろっているか。
// フックそのものの決まりは tools/hooks/rules.test.ts。

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p: string) => readFileSync(root(p), "utf8").replaceAll("\r\n", "\n");

type Hook = { type: string; command: string; timeout?: number };
type Group = { matcher: string; hooks: Hook[] };
type Settings = { hooks: Record<string, Group[]> };

const settings: Settings = JSON.parse(read(".claude/settings.json"));

/** command の中の ${CLAUDE_PROJECT_DIR}/… の script */
const scriptOf = (h: Hook) => /"\$\{CLAUDE_PROJECT_DIR\}\/([^"]+)"/.exec(h.command)?.[1];

describe(".claude/settings.json のフック", () => {
  it("使う event は PreToolUse と PostToolUse だけ", () => {
    expect(Object.keys(settings.hooks).sort()).toEqual(["PostToolUse", "PreToolUse"]);
  });

  it("PreToolUse は Bash・PowerShell と、ファイルを開く道具で guard.mjs", () => {
    const [group] = settings.hooks.PreToolUse;
    expect(group.matcher.split("|")).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Read", "Write", "Edit", "Grep"]));
    expect(group.hooks.map(scriptOf)).toEqual(["tools/hooks/guard.mjs"]);
  });

  it("PostToolUse は Write・Edit で typecheck.mjs", () => {
    const [group] = settings.hooks.PostToolUse;
    expect(group.matcher.split("|").sort()).toEqual(["Edit", "Write"]);
    expect(group.hooks.map(scriptOf)).toEqual(["tools/hooks/typecheck.mjs"]);
  });

  it("どの command も node で、${CLAUDE_PROJECT_DIR} を引用符で包んで、ある script を指す", () => {
    for (const groups of Object.values(settings.hooks)) {
      for (const h of groups.flatMap((g) => g.hooks)) {
        expect(h.type).toBe("command");
        expect(h.command.startsWith("node ")).toBe(true);
        const script = scriptOf(h);
        expect(script, h.command).toBeDefined();
        expect(existsSync(root(script!)), script).toBe(true);
        expect(h.timeout).toBeGreaterThan(0);
      }
    }
  });

  it("止める物は CLAUDE.md の「守ること」のフックの行と tools/hooks/rules.ts の頭の一覧の両方にある", () => {
    const claudeLine = read("CLAUDE.md")
      .split("\n")
      .find((l) => l.includes("tools/hooks/guard.mjs"));
    const rulesHead = read("tools/hooks/rules.ts").split("\nimport ")[0];
    expect(claudeLine).toBeDefined();
    for (const word of [
      "login",
      "whoami",
      "deploy",
      "d1 create",
      "r2 bucket create",
      "secret put",
      "--remote",
      "opennextjs-cloudflare",
      ".env",
      ".dev.vars",
      ".example",
      "push --force",
      "rebase",
      "pull --rebase",
      "commit --amend",
      "reset --hard",
      "gh pr merge",
      "squash",
    ]) {
      expect(claudeLine, word).toContain(word);
      expect(rulesHead, word).toContain(word);
    }
  });
});
