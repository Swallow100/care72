// フックで止める物（.claude/settings.json → tools/hooks/guard.mjs）。CLAUDE.md の「守ること」のフックの行と同じ一覧にする。
// 止める物を変えるときは、CLAUDE.md とこのファイルの両方を直し、rules.test.ts に止める例・通す例を足す。
//
// 止める物:
// - wrangler の手元でない命令（手元は dev・types・help・version と、--local を付けた d1 execute・d1 migrations apply|list・
//   r2 object・kv key|bulk、手元のファイルを作る d1 migrations create）。login・whoami・deploy・d1 create・r2 bucket create・
//   secret put・--remote は全部ここで止まる。opennextjs-cloudflare の deploy・upload・populateCache remote も
// - .env・.dev.vars（.env.local なども）を読む・書く命令と、Read・Write・Edit・Grep で開くこと。.example は通す
// - git push --force（-f・--force-with-lease・+refspec）、git rebase、git pull --rebase、git commit --amend、git reset --hard、
//   gh pr merge --rebase・--squash
//
// フックが見るのは Claude が打とうとした文字列だけ。npm run の中身は package.json の scripts を読んで同じ決まりで見るが、
// script のファイルの中（node x.mjs の x.mjs の中身など）は見ない。最後の守りで、すべての抜け道は塞がない。

import { parse, type Dialect, type SimpleCommand } from "./shell.ts";

export type Verdict = { block: false } | { block: true; reason: string };

export type JudgeOptions = {
  dialect?: Dialect;
  /** package.json の scripts。npm run x の中身を見るのに使う */
  scripts?: Readonly<Record<string, string>>;
};

export type HookInput = {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

const PASS: Verdict = { block: false };
const stop = (reason: string): Verdict => ({ block: true, reason });

export const REASONS = {
  wrangler: (what: string) =>
    `止めた: ${what}。wrangler でネットに出る命令は打たない（CLAUDE.md「動かし方」）。配信の手順の外で本物の資源を作ったり変えたりしない。手元は dev・types と --local を付けた d1・r2・kv だけ。配信は作者が手で打つ（docs/tasks/T27.md）`,
  secret: (what: string) =>
    `止めた: ${what}。鍵のファイル（.env・.dev.vars）は読まない・書かない（CLAUDE.md「守ること」）。鍵は人が手で入れる。鍵の有無は /api/health の ai で、項目は .dev.vars.example で見る`,
  history: (what: string) =>
    `止めた: ${what}。履歴を書き換えない（CLAUDE.md「守ること」）。直すときは新しい commit を足す。取り込みは merge commit で（docs/tasks/README.md）`,
  tooDeep: () => `止めた: 入れ子が深くて読み切れない命令。分けて打つ`,
} as const;

const MAX_DEPTH = 6;

// ---------------------------------------------------------------------------
// 鍵のファイル

const SECRET_NAME = /^\.(?:env|dev\.vars)(?:\.[^\\/]*)?$/i;
const EXAMPLE_NAME = /\.example$/i;
/** glob（.dev* など）が鍵のファイルに当たるかを見るための名前 */
const SECRET_SAMPLES = [".env", ".env.local", ".dev.vars", ".dev.vars.local"];

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (ch === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close > i) {
        re += `[${glob.slice(i + 1, close).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = close;
      } else re += "\\[";
    } else re += ch.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

/** 語が鍵のファイルを指すか（.env・.env.local・.dev.vars・パスの終わり・x=.env・{a,.env}・.dev* の glob） */
export function isSecretPath(token: string): boolean {
  const eq = token.indexOf("=");
  const values = eq > 0 ? [token, token.slice(eq + 1)] : [token];
  for (const value of values) {
    for (const part of value.split(/[,{}]/)) {
      const base = part.split(/[\\/]/).pop() ?? "";
      if (base === "" || EXAMPLE_NAME.test(base)) continue;
      if (SECRET_NAME.test(base)) return true;
      if (base.startsWith(".") && /[*?[]/.test(base) && SECRET_SAMPLES.some((s) => globToRegExp(base).test(s))) return true;
    }
  }
  return false;
}

/** ファイルの中身を読まない命令。鍵のファイルの名前があっても通す（リダイレクトは別に見る） */
const SECRET_SAFE = new Set(["ls", "dir", "test", "[", "test-path", "get-childitem", "gci"]);

/** node -e の中の JS など、シェルでない文の中を粗く見る */
const LOOSE_SECRET = /(?:^|[\s'"`(=,\\/])\.(?:env|dev\.vars)(?!\.example)(?=$|[\s'"`),;\\/.])/i;
const LOOSE_WRANGLER =
  /wrangler[\s"',[\]]+(?:login|whoami|deploy|publish|versions|secret|d1[\s"',]+create|r2[\s"',]+bucket[\s"',]+create)|wrangler[^\n]*--remote/i;

function looseCheck(code: string, where: string): Verdict {
  if (LOOSE_SECRET.test(code)) return stop(REASONS.secret(`${where} の中の鍵のファイル`));
  if (LOOSE_WRANGLER.test(code)) return stop(REASONS.wrangler(`${where} の中の wrangler`));
  return PASS;
}

// ---------------------------------------------------------------------------
// 命令の名前

/** 命令の名前: パスの終わり、小文字、.exe などを外す */
export function commandName(word: string): string {
  const base = (word.split(/[\\/]/).pop() ?? "").toLowerCase();
  return base.replace(/\.(?:exe|cmd|bat|ps1|js|mjs|cjs)$/, "");
}

/** 命令の前に付く物（VAR=x、env、sudo、if など）を外す */
function stripPrefix(words: string[]): string[] {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const name = commandName(w);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) i++;
    else if (["{", "}", "!", "then", "do", "else", "elif", "if", "while", "until", "time", "exec", "command", "builtin", "nohup"].includes(w)) i++;
    else if (name === "env" || name === "sudo") {
      i++;
      while (i < words.length && words[i].startsWith("-")) i++;
    } else break;
  }
  return words.slice(i);
}

const SHELLS: Readonly<Record<string, Dialect>> = {
  bash: "bash",
  sh: "bash",
  zsh: "bash",
  dash: "bash",
  ksh: "bash",
  pwsh: "powershell",
  powershell: "powershell",
  cmd: "powershell",
};

const INTERPRETERS = new Set(["node", "python", "python3", "py", "perl", "ruby", "deno", "bun", "tsx", "ts-node", "php"]);

/** bash -c '…'、powershell -Command …、cmd /c …、eval …、Invoke-Expression … の中の文 */
function nestedScript(name: string, args: string[]): { script: string; dialect: Dialect } | null {
  const dialect = SHELLS[name];
  if (dialect === "bash") {
    const at = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    return at >= 0 && at + 1 < args.length ? { script: args[at + 1], dialect } : null;
  }
  if (name === "cmd") {
    const at = args.findIndex((a) => /^\/[ck]$/i.test(a));
    return at >= 0 ? { script: args.slice(at + 1).join(" "), dialect } : null;
  }
  if (dialect === "powershell") {
    const enc = args.findIndex((a) => /^-(?:e|ec|en|enc|encodedcommand)$/i.test(a));
    if (enc >= 0 && enc + 1 < args.length) {
      return { script: Buffer.from(args[enc + 1], "base64").toString("utf16le"), dialect };
    }
    const at = args.findIndex((a) => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(a));
    return at >= 0 ? { script: args.slice(at + 1).join(" "), dialect } : null;
  }
  if (name === "eval") return { script: args.join(" "), dialect: "bash" };
  if (name === "invoke-expression" || name === "iex") {
    const rest = args[0] && /^-command$/i.test(args[0]) ? args.slice(1) : args;
    return { script: rest.join(" "), dialect: "powershell" };
  }
  return null;
}

/** node -e …、python -c … などのその場の文 */
function evalCode(name: string, args: string[]): string | null {
  const flags: Readonly<Record<string, string[]>> = {
    node: ["-e", "--eval", "-p", "--print", "-pe"],
    bun: ["-e", "--eval", "-p", "--print"],
    python: ["-c"],
    python3: ["-c"],
    py: ["-c"],
    perl: ["-e", "-E"],
    ruby: ["-e"],
    php: ["-r"],
  };
  if (name === "deno" && args[0] === "eval") return args[1] ?? "";
  const list = flags[name];
  if (!list) return null;
  const inline = args.find((a) => list.some((f) => f.startsWith("--") && a.startsWith(`${f}=`)));
  if (inline) return inline.slice(inline.indexOf("=") + 1);
  const at = args.findIndex((a) => list.includes(a));
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null;
}

// ---------------------------------------------------------------------------
// wrangler と OpenNext

const TOOLS = new Set(["wrangler", "opennextjs-cloudflare"]);

function packageBin(raw: string): string {
  const noVersion = raw.replace(/(.)@[^@/]*$/, "$1");
  if (noVersion.toLowerCase() === "@opennextjs/cloudflare") return "opennextjs-cloudflare";
  return commandName(noVersion);
}

/** npx wrangler …、npm exec wrangler …、pnpm wrangler … の中の道具と引数 */
function fromRunner(args: string[]): { tool: string; args: string[] } | null {
  let i = 0;
  while (i < args.length && (args[i].startsWith("-") || args[i] === "--")) {
    if (["-p", "--package", "-c", "--call"].includes(args[i])) i++;
    i++;
  }
  if (i >= args.length) return null;
  const tool = packageBin(args[i]);
  return TOOLS.has(tool) ? { tool, args: args.slice(i + 1).filter((a) => a !== "--") } : null;
}

function toolInvocation(name: string, args: string[]): { tool: string; args: string[] } | null {
  if (TOOLS.has(name)) return { tool: name, args };
  if (["npx", "pnpx", "bunx"].includes(name)) return fromRunner(args);
  if (name === "npm" && ["exec", "x"].includes(args[0])) return fromRunner(args.slice(1));
  if (["pnpm", "yarn", "bun"].includes(name)) {
    if (["exec", "dlx", "x"].includes(args[0])) return fromRunner(args.slice(1));
    if (args[0] && TOOLS.has(packageBin(args[0]))) return { tool: packageBin(args[0]), args: args.slice(1) };
  }
  if (name === "node" && args[0] && /(?:^|[\\/])wrangler[\\/]bin[\\/]wrangler\.js$/i.test(args[0])) {
    return { tool: "wrangler", args: args.slice(1) };
  }
  return null;
}

/** --local を付ければ手元の D1・R2・KV に向く命令 */
const LOCAL_WITH_FLAG: ReadonlyArray<ReadonlyArray<string>> = [
  ["d1", "execute"],
  ["d1", "migrations", "apply"],
  ["d1", "migrations", "list"],
  ["r2", "object"],
  ["kv", "key"],
  ["kv", "bulk"],
];
/** 付けなくても手元だけの命令 */
const LOCAL_ALWAYS: ReadonlyArray<ReadonlyArray<string>> = [["dev"], ["types"], ["help"], ["version"], ["d1", "migrations", "create"]];
/** 値を取るので、次の語を命令の名前と取り違えない */
const WRANGLER_VALUE_OPTS = new Set(["--config", "-c", "--env", "-e", "--cwd", "--env-file"]);

const startsWith = (pos: string[], head: ReadonlyArray<string>) => head.every((h, k) => pos[k] === h);

function judgeWrangler(args: string[]): Verdict {
  const shown = ["wrangler", ...args].join(" ");
  const flags: string[] = [];
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      flags.push(a);
      if (WRANGLER_VALUE_OPTS.has(a)) i++;
    } else pos.push(a);
  }
  if (flags.some((f) => /^--remote(?:=(?!false$)|$)/.test(f))) return stop(REASONS.wrangler(shown));
  if (pos.length === 0) return PASS; // wrangler だけ・--version・--help
  if (LOCAL_ALWAYS.some((h) => startsWith(pos, h))) return PASS;
  if (LOCAL_WITH_FLAG.some((h) => startsWith(pos, h)) && flags.includes("--local")) return PASS;
  return stop(REASONS.wrangler(shown));
}

function judgeOpenNext(args: string[]): Verdict {
  const pos = args.filter((a) => !a.startsWith("-"));
  if (pos[0] === "deploy" || pos[0] === "upload" || (pos[0] === "populateCache" && pos.includes("remote"))) {
    return stop(REASONS.wrangler(["opennextjs-cloudflare", ...args].join(" ")));
  }
  return PASS;
}

// ---------------------------------------------------------------------------
// npm run の中身

const NPM_LIFECYCLE: Readonly<Record<string, string>> = { test: "test", t: "test", tst: "test", start: "start", stop: "stop", restart: "restart" };

function scriptName(name: string, args: string[], scripts: Readonly<Record<string, string>>): string | null {
  const rest = args.filter((a) => !a.startsWith("-"));
  if (name === "npm") {
    if (["run", "run-script", "rum", "urn"].includes(rest[0])) return rest[1] ?? null;
    return NPM_LIFECYCLE[rest[0]] ?? null;
  }
  if (name === "pnpm" || name === "yarn" || name === "bun") {
    if (rest[0] === "run") return rest[1] ?? null;
    if (name !== "bun" && rest[0] && rest[0] in scripts) return rest[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// git と gh

const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);

function gitSubcommand(args: string[]): { sub: string; rest: string[] } {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    if (GIT_VALUE_OPTS.has(args[i])) i++;
    i++;
  }
  return { sub: args[i] ?? "", rest: args.slice(i + 1) };
}

function judgeGit(args: string[]): Verdict {
  const { sub, rest } = gitSubcommand(args);
  switch (sub) {
    case "push": {
      const forced = rest.find(
        (a) =>
          a === "--force" ||
          a.startsWith("--force-with-lease") ||
          a === "--force-if-includes" ||
          /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) ||
          (a.startsWith("+") && a.length > 1),
      );
      return forced ? stop(REASONS.history(`git push ${forced}`)) : PASS;
    }
    case "rebase":
      return stop(REASONS.history("git rebase"));
    case "pull": {
      const r = rest.find((a) => a === "--rebase" || a === "-r" || (a.startsWith("--rebase=") && a !== "--rebase=false"));
      return r ? stop(REASONS.history(`git pull ${r}`)) : PASS;
    }
    case "commit":
      return rest.includes("--amend") ? stop(REASONS.history("git commit --amend")) : PASS;
    case "reset":
      return rest.includes("--hard") ? stop(REASONS.history("git reset --hard")) : PASS;
    default:
      return PASS;
  }
}

function judgeGh(args: string[]): Verdict {
  const pos = args.filter((a) => !a.startsWith("-"));
  if (pos[0] !== "pr" || pos[1] !== "merge") return PASS;
  const how = args.find((a) => ["--rebase", "-r", "--squash", "-s"].includes(a));
  return how ? stop(REASONS.history(`gh pr merge ${how}`)) : PASS;
}

// ---------------------------------------------------------------------------
// まとめ

const first = (verdicts: Iterable<Verdict>): Verdict => {
  for (const v of verdicts) if (v.block) return v;
  return PASS;
};

function* judgeSimple(c: SimpleCommand, opts: JudgeOptions, depth: number): Generator<Verdict> {
  for (const r of c.redirects) {
    if (isSecretPath(r)) yield stop(REASONS.secret(`${r} への出し入れ`));
  }

  const words = stripPrefix(c.words);
  const name = words.length > 0 ? commandName(words[0]) : "";
  const args = words.slice(1);

  const safe = SECRET_SAFE.has(name) || (name === "git" && gitSubcommand(args).sub === "check-ignore");
  if (!safe) {
    const hit = c.words.find(isSecretPath);
    if (hit) yield stop(REASONS.secret(name ? `${name} で ${hit}` : hit));
  }
  if (name === "") return;

  const nested = nestedScript(name, args);
  if (nested) yield judgeCommand(nested.script, { ...opts, dialect: nested.dialect }, depth + 1);

  for (const body of c.heredocs) {
    const dialect = SHELLS[name];
    if (dialect) yield judgeCommand(body, { ...opts, dialect }, depth + 1);
    else if (INTERPRETERS.has(name)) yield looseCheck(body, `${name} に渡す文`);
  }

  const code = evalCode(name, args);
  if (code !== null) yield looseCheck(code, `${name} のその場の文`);

  const tool = toolInvocation(name, args);
  if (tool?.tool === "wrangler") yield judgeWrangler(tool.args);
  if (tool?.tool === "opennextjs-cloudflare") yield judgeOpenNext(tool.args);

  const scripts = opts.scripts ?? {};
  const script = scriptName(name, args, scripts);
  if (script) {
    for (const s of [`pre${script}`, script, `post${script}`]) {
      const body = scripts[s];
      if (typeof body === "string") yield judgeCommand(body, { ...opts, dialect: "bash" }, depth + 1);
    }
  }

  if (name === "git") yield judgeGit(args);
  if (name === "gh") yield judgeGh(args);
}

/** シェルの命令の文字列を見る */
export function judgeCommand(command: string, opts: JudgeOptions = {}, depth = 0): Verdict {
  if (depth > MAX_DEPTH) return stop(REASONS.tooDeep());
  const { commands, substitutions } = parse(command, opts.dialect ?? "bash");
  for (const s of substitutions) {
    const v = judgeCommand(s, opts, depth + 1);
    if (v.block) return v;
  }
  for (const c of commands) {
    const v = first(judgeSimple(c, opts, depth));
    if (v.block) return v;
  }
  return PASS;
}

/** PreToolUse のフックに来た 1 回の道具の呼び出しを見る */
export function judgeToolUse(input: HookInput, opts: Omit<JudgeOptions, "dialect"> = {}): Verdict {
  const tool = input.tool_name ?? "";
  const ti = input.tool_input ?? {};
  if (tool === "Bash" || tool === "PowerShell") {
    const command = typeof ti.command === "string" ? ti.command : "";
    return judgeCommand(command, { ...opts, dialect: tool === "PowerShell" ? "powershell" : "bash" });
  }
  for (const key of ["file_path", "notebook_path", "path"]) {
    const p = ti[key];
    if (typeof p === "string" && isSecretPath(p)) return stop(REASONS.secret(`${tool} で ${p}`));
  }
  return PASS;
}

// ---------------------------------------------------------------------------
// PostToolUse: 型の検査を流すか

/** \ を / に、Git Bash の /c/ を c:/ に。Windows のパスは大文字・小文字を分けないので、比べるときは小文字で */
const toSlash = (p: string) =>
  p
    .replaceAll("\\", "/")
    .replace(/^\/([a-zA-Z])\//, "$1:/")
    .replace(/\/+$/, "");

/** Write・Edit で .ts・.tsx を書いたら、そのファイルのリポジトリの中のパス。型の検査が要らなければ null */
export function typecheckTarget(input: HookInput, projectDir: string): string | null {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return null;
  const p = input.tool_input?.file_path;
  if (typeof p !== "string" || !/\.[mc]?tsx?$/i.test(p)) return null;
  const file = toSlash(p);
  const root = toSlash(projectDir);
  const absolute = /^[a-zA-Z]:\//.test(file) || file.startsWith("/");
  let rel: string;
  if (!absolute) rel = file.replace(/^\.\//, "");
  else if (file.toLowerCase().startsWith(`${root.toLowerCase()}/`)) rel = file.slice(root.length + 1);
  else return null;
  if (/^(?:node_modules|\.next|\.open-next|\.wrangler)\//i.test(rel)) return null;
  return rel;
}
