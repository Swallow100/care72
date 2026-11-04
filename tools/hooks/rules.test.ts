// フックで止める命令・通す命令の一覧（tools/hooks/rules.ts）。止める物を変えたら CLAUDE.md の「守ること」のフックの行も直す。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSecretPath, judgeCommand, judgeToolUse, typecheckTarget, type Verdict } from "./rules.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const SCRIPTS: Record<string, string> = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).scripts;

const bash = (command: string, scripts: Record<string, string> = SCRIPTS) => judgeCommand(command, { dialect: "bash", scripts });
const pwsh = (command: string) => judgeCommand(command, { dialect: "powershell", scripts: SCRIPTS });
const reason = (v: Verdict) => (v.block ? v.reason : "");

/** 止まる理由の頭の言葉 */
const WRANGLER = "wrangler でネットに出る命令は打たない";
const SECRET = "鍵のファイル（.env・.dev.vars）は読まない・書かない";
const HISTORY = "履歴を書き換えない";

describe("wrangler: 手元でない命令を止める（CLAUDE.md「動かし方」）", () => {
  it.each([
    "wrangler login",
    "wrangler whoami",
    "wrangler deploy",
    "wrangler d1 create care72",
    "wrangler r2 bucket create care72-recordings",
    "wrangler secret put ANTHROPIC_API_KEY",
    "wrangler secret list",
    "wrangler versions upload",
    "wrangler d1 list",
    "wrangler d1 execute DB --remote --command 'select 1'",
    "wrangler d1 execute DB --command 'select 1'",
    "wrangler d1 migrations apply DB",
    "wrangler dev --remote",
    "wrangler --config wrangler.jsonc deploy",
    "npx wrangler deploy",
    "npx -y wrangler@4.156.1 deploy",
    "npm exec wrangler -- deploy",
    "npm exec -- wrangler whoami",
    "pnpm wrangler deploy",
    "node_modules/.bin/wrangler secret put GEMINI_API_KEY",
    "node node_modules/wrangler/bin/wrangler.js deploy",
    "cd /c/Users/user/dev/care72 && wrangler deploy",
    "npm test; npx wrangler login",
    "FOO=1 wrangler deploy",
    "env CLOUDFLARE_ACCOUNT_ID=x wrangler deploy",
    "(wrangler deploy)",
    "true || wrangler deploy",
    "bash -c 'wrangler deploy'",
    'sh -lc "npx wrangler whoami"',
    "echo $(wrangler whoami)",
    "echo `wrangler whoami`",
    `node -e "require('child_process').execSync('npx wrangler deploy')"`,
    "npx opennextjs-cloudflare deploy",
    "opennextjs-cloudflare upload",
    "npx @opennextjs/cloudflare@1.20.15 deploy",
  ])("止める: %s", (command) => {
    expect(reason(bash(command))).toContain(WRANGLER);
  });

  it.each([
    "wrangler d1 execute DB --local --file=seed/generated/seed.sql",
    "wrangler d1 migrations apply DB --local",
    'npx wrangler d1 execute DB --local --command "select count(*) from people"',
    "wrangler d1 migrations create DB add_x",
    "wrangler dev",
    "wrangler types",
    "wrangler --version",
    "wrangler",
    "npx opennextjs-cloudflare build",
    "opennextjs-cloudflare preview",
  ])("通す: %s", (command) => {
    expect(bash(command)).toEqual({ block: false });
  });
});

describe("鍵のファイル: .env・.dev.vars を読む・書く命令を止める", () => {
  it.each([
    "cat .dev.vars",
    "cat ./.dev.vars",
    "cat /c/Users/user/dev/care72/.dev.vars",
    'cat "C:\\Users\\user\\dev\\care72\\.dev.vars"',
    "cat '.dev.vars'",
    "cat .de\\v.vars",
    "type .dev.vars",
    "head -n 3 .env",
    "cat .env.local",
    "less .dev.vars.review",
    "grep KEY .dev.vars",
    "cat .dev*",
    "cat .e?v",
    "cat {a.txt,.dev.vars}",
    "echo ANTHROPIC_API_KEY=x > .dev.vars",
    "echo x >> .dev.vars",
    "printf x 1> .env",
    "ls > .dev.vars",
    "cp .dev.vars.example .dev.vars",
    "git add .dev.vars",
    "node --env-file=.env server.js",
    "f=.dev.vars; cat $f",
    "cat $(echo .dev.vars)",
    "cat <<EOF > .dev.vars\nKEY=1\nEOF",
    "bash -c 'cat .dev.vars'",
    `node -e "console.log(require('fs').readFileSync('.dev.vars', 'utf8'))"`,
    `python -c "print(open('.env').read())"`,
    "node <<'EOF'\nconsole.log(require('fs').readFileSync('./.dev.vars', 'utf8'))\nEOF",
  ])("止める: %s", (command) => {
    expect(reason(bash(command))).toContain(SECRET);
  });

  it.each([
    "cat .dev.vars.example",
    "cp .dev.vars.example /tmp/vars.txt",
    "cat .env.example",
    "ls -la .dev.vars",
    "test -f .dev.vars && echo ある",
    "git check-ignore -v .dev.vars",
    "git status --short",
    "grep -rn process.env lib",
    `node -e "console.log(process.env.NODE_ENV)"`,
    "cat next-env.d.ts cloudflare-env.d.ts",
    "cat .gitignore .gitattributes",
    "ls -a .git*",
    'echo ".dev.vars は commit しない"',
    'git commit -m "フックで .dev.vars の cat と wrangler deploy を止める"',
  ])("通す: %s", (command) => {
    expect(bash(command)).toEqual({ block: false });
  });
});

describe("履歴: force push・rebase・amend・reset --hard を止める（CLAUDE.md「守ること」）", () => {
  it.each([
    "git push --force",
    "git push -f origin main",
    "git push --force-with-lease origin main",
    "git push origin +main",
    "git push -uf origin task/t03",
    "git rebase main",
    "git rebase -i HEAD~3",
    "git pull --rebase",
    "git pull -r origin main",
    "git commit --amend -m x",
    "git commit --amend --no-edit",
    "git reset --hard HEAD~1",
    "git -C /c/Users/user/dev/care72 push --force",
    "git -c core.editor=true rebase main",
    "git add -A && git commit --amend",
    "gh pr merge --squash",
    "gh pr merge 12 --rebase --delete-branch",
  ])("止める: %s", (command) => {
    expect(reason(bash(command))).toContain(HISTORY);
  });

  it.each([
    "git push origin HEAD",
    "git push -u origin task/t03",
    "git pull --no-rebase",
    "git pull",
    'git commit -m "x" && git push origin HEAD',
    "git commit -F - <<'EOF'\nwrangler deploy と git push --force と cat .dev.vars を止める\nEOF",
    "git reset HEAD lib/labels.ts",
    "git log --oneline | head -5",
    "git worktree add ../care72-t03 -b task/t03 main",
    "gh pr create --fill",
    "gh pr merge --merge --delete-branch",
  ])("通す: %s", (command) => {
    expect(bash(command)).toEqual({ block: false });
  });
});

describe("npm run の中身も同じ決まりで見る", () => {
  // 配信の 3 つは作者が自分の端末で打つ（docs/tasks/T27.md）。エージェントからは止まる
  const AUTHOR_ONLY = ["db:migrate:remote", "db:seed:remote", "deploy"];

  it("package.json の scripts は、配信の 3 つのほかは全部通る", () => {
    for (const name of Object.keys(SCRIPTS).filter((n) => !AUTHOR_ONLY.includes(n))) {
      expect(bash(`npm run ${name}`), name).toEqual({ block: false });
    }
    expect(bash("npm test")).toEqual({ block: false });
    expect(bash("npm install")).toEqual({ block: false });
  });

  it("配信の 3 つ（remote の migration・種、deploy）は package.json にあり、止まる", () => {
    for (const name of AUTHOR_ONLY) {
      expect(SCRIPTS[name], name).toBeDefined();
      expect(reason(bash(`npm run ${name}`)), name).toContain(WRANGLER);
      expect(reason(pwsh(`npm run ${name}`)), name).toContain(WRANGLER);
    }
  });

  it("中身に配信があれば止める（pre・post と、npm run の入れ子も）", () => {
    expect(reason(bash("npm run deploy", { deploy: "opennextjs-cloudflare build && opennextjs-cloudflare deploy" }))).toContain(WRANGLER);
    expect(reason(bash("npm run dev", { predev: "wrangler login", dev: "next dev" }))).toContain(WRANGLER);
    expect(reason(bash("npm run a", { a: "npm run b", b: "wrangler whoami" }))).toContain(WRANGLER);
    expect(reason(bash("npm run show", { show: "cat .dev.vars" }))).toContain(SECRET);
  });

  it("自分を呼び続ける script は深さで止める", () => {
    expect(bash("npm run loop", { loop: "npm run loop" }).block).toBe(true);
  });
});

describe("PowerShell", () => {
  it.each([
    ["Get-Content .dev.vars", SECRET],
    ["gc .\\.dev.vars", SECRET],
    ["type .dev.vars", SECRET],
    ["Get-Content -Path C:\\Users\\user\\dev\\care72\\.dev.vars", SECRET],
    ["Get-Content .dev.vars.example, .env", SECRET],
    ["Set-Content .dev.vars 'KEY=x'", SECRET],
    ["'KEY=x' | Out-File .dev.vars", SECRET],
    ['"KEY=x" > .dev.vars', SECRET],
    ["Copy-Item .dev.vars.example .dev.vars", SECRET],
    ['Write-Output "$(Get-Content .env)"', SECRET],
    ["wrangler deploy", WRANGLER],
    ["& npx wrangler login", WRANGLER],
    ['cmd /c "wrangler deploy"', WRANGLER],
    ['powershell -NoProfile -Command "wrangler deploy"', WRANGLER],
    ["Invoke-Expression 'npx wrangler whoami'", WRANGLER],
    [`powershell -EncodedCommand ${Buffer.from("wrangler deploy", "utf16le").toString("base64")}`, WRANGLER],
    ["git push --force", HISTORY],
    ["git commit --amend", HISTORY],
  ])("止める: %s", (command, why) => {
    expect(reason(pwsh(command))).toContain(why);
  });

  it.each([
    "Get-Content .dev.vars.example",
    "Test-Path .dev.vars",
    "Get-ChildItem -Force",
    "npm run db:reset",
    'wrangler d1 execute DB --local --command "select 1"',
    'git commit -m "wrangler deploy を止める"',
    "git push origin HEAD",
    "Write-Output $env:NODE_ENV",
  ])("通す: %s", (command) => {
    expect(pwsh(command)).toEqual({ block: false });
  });
});

describe("Read・Write・Edit・Grep のパス", () => {
  const at = (p: string) => `${ROOT}\\${p}`;
  it.each([
    ["Read", "file_path", at(".dev.vars")],
    ["Read", "file_path", "/c/Users/user/dev/care72/.env"],
    ["Write", "file_path", at(".dev.vars")],
    ["Edit", "file_path", at(".env.local")],
    ["NotebookEdit", "notebook_path", at(".env")],
    ["Grep", "path", ".dev.vars"],
  ])("止める: %s %s", (tool, key, p) => {
    expect(reason(judgeToolUse({ tool_name: tool, tool_input: { [key]: p } }))).toContain(SECRET);
  });

  it.each([
    ["Read", "file_path", at(".dev.vars.example")],
    ["Read", "file_path", at("lib\\claude\\client.ts")],
    ["Edit", "file_path", at("cloudflare-env.d.ts")],
    ["Grep", "path", "lib"],
    ["Glob", "pattern", "**/*.ts"],
  ])("通す: %s %s", (tool, key, p) => {
    expect(judgeToolUse({ tool_name: tool, tool_input: { [key]: p } })).toEqual({ block: false });
  });

  it("isSecretPath は名前がちょうど合う物だけ", () => {
    expect([".env", ".env.production", ".dev.vars", "a/.dev.vars", "KEY=.env"].map(isSecretPath)).toEqual([true, true, true, true, true]);
    expect([".env.example", ".dev.vars.example", ".envrc", "next-env.d.ts", "process.env", "env", ""].map(isSecretPath)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("PostToolUse: 型の検査を流すファイル", () => {
  const root = "C:\\Users\\user\\dev\\care72";
  const target = (tool: string, file: string, r = root) => typecheckTarget({ tool_name: tool, tool_input: { file_path: file } }, r);

  it("リポジトリの中の .ts・.tsx を Write・Edit したときだけ", () => {
    expect(target("Write", `${root}\\lib\\x.ts`)).toBe("lib/x.ts");
    expect(target("Edit", `${root}\\app\\page.tsx`)).toBe("app/page.tsx");
    expect(target("Edit", `${root}\\cloudflare-env.d.ts`)).toBe("cloudflare-env.d.ts");
    expect(target("Write", `${root}\\README.md`)).toBeNull();
    expect(target("Read", `${root}\\lib\\x.ts`)).toBeNull();
    expect(target("Write", "C:\\Users\\user\\AppData\\Local\\Temp\\x.ts")).toBeNull();
    expect(target("Write", `${root}\\node_modules\\x\\index.ts`)).toBeNull();
  });

  it("パスの書き方（Git Bash の /c/、大文字・小文字）が違っても同じ", () => {
    expect(target("Write", `${root}\\lib\\x.ts`, "/c/Users/user/dev/care72")).toBe("lib/x.ts");
    expect(target("Write", "C:/Users/user/dev/care72/lib/x.ts", "c:\\users\\user\\dev\\care72")).toBe("lib/x.ts");
  });
});

describe("フックの script を node で動かす（Claude Code が渡す形の入力）", () => {
  const run = (script: string, input: unknown) =>
    spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
      input: typeof input === "string" ? input : JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    });
  const pre = (tool_name: string, command: string) =>
    run("./guard.mjs", { hook_event_name: "PreToolUse", tool_name, tool_input: { command }, cwd: ROOT });

  it("wrangler deploy は 2 で終わり、理由を stderr に", () => {
    const r = pre("Bash", "npx wrangler deploy");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(WRANGLER);
  });

  it(".dev.vars の cat も 2", () => {
    const r = pre("Bash", "cat .dev.vars");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(SECRET);
  });

  it("PowerShell の Get-Content も 2", () => {
    expect(pre("PowerShell", "Get-Content .dev.vars").status).toBe(2);
  });

  it("ふつうの命令は 0 で、何も書かない", () => {
    const r = pre("Bash", "npm test && git push origin HEAD");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("読めない入力は通さない（2）", () => {
    expect(run("./guard.mjs", "not json").status).toBe(2);
  });

  it("型の検査のフックは .ts でなければすぐ 0", () => {
    const r = run("./typecheck.mjs", { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: `${ROOT}\\README.md` } });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
});
