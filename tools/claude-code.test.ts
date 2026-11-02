// Claude Code の設定（.claude/settings.json のフックと .claude/skills）が、リポジトリの中の物とそろっているか。
// フックそのものの決まりは tools/hooks/rules.test.ts。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "./mcp/care72-local/tools.ts";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p: string) => readFileSync(root(p), "utf8").replaceAll("\r\n", "\n");

type Hook = { type: string; command: string; timeout?: number };
type Group = { matcher: string; hooks: Hook[] };
type Settings = { hooks: Record<string, Group[]>; enabledMcpjsonServers?: string[] };

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

/** SKILL.md の頭の --- から --- まで（key: value の 1 行ずつ） */
function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  const [, head = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) ?? [];
  const fields: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const m = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return { fields, body };
}

/** Claude Code の公式の文書（skills）にある項目の名前。違う名前は黙って無視されるので、ここで止める */
const SKILL_FIELDS = ["name", "description", "argument-hint", "disable-model-invocation", "user-invocable", "allowed-tools", "model"];

describe(".claude/skills", () => {
  const dirs = readdirSync(root(".claude/skills"));
  const scripts = Object.keys(JSON.parse(read("package.json")).scripts);

  it("triage-rule と task の 2 つ", () => {
    expect(dirs.sort()).toEqual(["task", "triage-rule"]);
  });

  it.each(dirs)("%s: 1 行目が ---、名前はフォルダの名前、説明は 1,536 字まで、知らない項目なし", (dir) => {
    const text = read(`.claude/skills/${dir}/SKILL.md`);
    expect(text.startsWith("---\n")).toBe(true);
    const { fields, body } = frontmatter(text);
    expect(fields.name).toBe(dir);
    expect(fields.description.length).toBeGreaterThan(20);
    expect(fields.description.length).toBeLessThanOrEqual(1536);
    for (const key of Object.keys(fields)) expect(SKILL_FIELDS, key).toContain(key);
    expect(body).toContain("$ARGUMENTS");
    expect(body).toContain("## 確かめ方");
  });

  it.each(dirs)("%s: 書いてあるファイルと npm run の名前が本当にある", (dir) => {
    const text = read(`.claude/skills/${dir}/SKILL.md`);
    const paths = [...text.matchAll(/\b(?:lib|docs|seed|tools|app)\/[\w./-]*\w/g)].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(existsSync(root(p)), p).toBe(true);
    for (const [, name] of text.matchAll(/npm run ([\w:-]+)/g)) expect(scripts, name).toContain(name);
  });
});

type McpConfig = { mcpServers: Record<string, { type?: string; command: string; args?: string[] }> };
const mcpConfig: McpConfig = JSON.parse(read(".mcp.json"));

describe(".mcp.json の MCP サーバー", () => {
  it("手元の care72-local の 1 つだけ（stdio、node でリポジトリの中の script）", () => {
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["care72-local"]);
    const s = mcpConfig.mcpServers["care72-local"];
    expect(s.type).toBe("stdio");
    expect(s.command).toBe("node");
    // プロジェクトの .mcp.json では ${CLAUDE_PROJECT_DIR} は既定の値つきで書く（Claude Code の MCP の文書）
    const [script] = s.args ?? [];
    const m = /^\$\{CLAUDE_PROJECT_DIR:-\.\}\/(.+)$/.exec(script ?? "");
    expect(m, script).not.toBeNull();
    expect(existsSync(root(m![1])), m![1]).toBe(true);
  });

  it("鍵・ネットの URL を渡さない（env も url も無い）", () => {
    const raw = read(".mcp.json");
    expect(raw).not.toMatch(/"env"|"url"|"headers"|https?:/);
  });

  it(".claude/settings.json で care72-local を使う許可（ほかのサーバーは許さない）", () => {
    expect(settings.enabledMcpjsonServers).toEqual(["care72-local"]);
  });
});

/** Claude Code の公式の文書（sub-agents）にあるサブエージェントの頭の項目。違う名前は黙って無視されるので、ここで止める */
const AGENT_FIELDS = [
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "permissionMode",
  "maxTurns",
  "effort",
  "color",
  "skills",
  "mcpServers",
  "hooks",
  "memory",
  "background",
  "isolation",
  "initialPrompt",
  "autoCompactWindow",
  "omitClaudeMd",
  "experimental",
];

/** 目的ごとのモデル（docs/CLAUDE_CODE.md）。医療の文は opus、画面の決まりの照合は sonnet、数の多いペルソナの出力は haiku */
const AGENT_MODELS: Readonly<Record<string, string>> = {
  "medical-reviewer": "opus",
  "screen-checker": "sonnet",
  "persona-tester": "haiku",
};

/** 見直し役は読むだけ。書く道具（Write・Edit・Bash など）は渡さない */
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

describe(".claude/agents", () => {
  const files = readdirSync(root(".claude/agents")).filter((f) => f.endsWith(".md"));
  const agents = files.map((f) => ({ file: f, ...frontmatter(read(`.claude/agents/${f}`)) }));

  it("medical-reviewer・persona-tester・screen-checker の 3 つ", () => {
    expect(files.sort()).toEqual(["medical-reviewer.md", "persona-tester.md", "screen-checker.md"]);
  });

  it.each(agents)("$file: 名前はファイルの名前、知らない項目なし、モデルは目的のとおり", ({ file, fields }) => {
    const name = file.replace(/\.md$/, "");
    expect(fields.name).toBe(name);
    for (const key of Object.keys(fields)) expect(AGENT_FIELDS, key).toContain(key);
    expect(fields.model).toBe(AGENT_MODELS[name]);
  });

  it.each(agents)("$file: 説明は YAML で読める 1 行（「: 」「 #」を含まない）", ({ fields }) => {
    expect(fields.description.length).toBeGreaterThan(40);
    expect(fields.description).not.toMatch(/: | #/);
  });

  it.each(agents)("$file: 道具は読むだけ（Read・Grep・Glob と手元の MCP の名前）", ({ fields }) => {
    const tools = fields.tools.split(",").map((t) => t.trim());
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) expect(READ_ONLY_TOOLS.includes(t) || t.startsWith("mcp__care72-local__"), t).toBe(true);
  });

  it.each(agents)("$file: MCP の道具の名前は .mcp.json のサーバーに本当にある", ({ fields }) => {
    const mcp = fields.tools
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.startsWith("mcp__"));
    for (const t of mcp) {
      const [, server, name] = /^mcp__(.+?)__(.+)$/.exec(t) ?? [];
      expect(Object.keys(mcpConfig.mcpServers), t).toContain(server);
      expect(TOOL_NAMES, t).toContain(name);
    }
  });

  it.each(agents)("$file: 返す物の節があり、書いてあるファイルが本当にある", ({ file, body }) => {
    expect(body).toContain("## 返す物");
    const text = read(`.claude/agents/${file}`);
    const paths = [...text.matchAll(/\b(?:lib|docs|seed|tools|app)\/[\w./-]*\w/g)].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(existsSync(root(p)), p).toBe(true);
  });
});
