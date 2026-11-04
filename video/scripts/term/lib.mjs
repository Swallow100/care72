// 端末の録画（R20〜R24）の道具の共通の所。
// 本物の命令を疑似端末（ConPTY、@lydell/node-pty）で流し、出た文字を時刻つきで記録する（asciicast v2 の形の term.cast）。
// 描くのは render.mjs（記録をそのまま xterm.js に流して 1/30 秒ごとに撮る）。画面を描き直さない・文字を足さない。
// 待つだけの所（テストの実行中、Claude の考え中）は描くときに切る（record-lib.mjs の一時止めと同じ扱い）。
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pty = require("@lydell/node-pty");
const { Terminal } = require("@xterm/headless");
const { Unicode11Addon } = require("@xterm/addon-unicode11");

export const HERE = dirname(fileURLToPath(import.meta.url));
/** video/ */
export const VIDEO = resolve(HERE, "..", "..");
/** リポジトリ（worktree）の根 */
export const REPO = resolve(VIDEO, "..");
/** 録画の置き場（video/assets/rec、commit しない） */
export const REC = join(VIDEO, "assets", "rec");

export const BASH = "C:/Program Files/Git/bin/bash.exe";

/** 端末の大きさ。1280×720 の窓（1.5 倍で 1920×1080）に 20pt 前後の字（26px ほど）で入る大きさ */
export const SIZE = { cols: 80, rows: 20 };

/**
 * プロンプト。ユーザー名・フォルダの道を出さない（docs/video/SHOOTING.md の端末）。
 * 「care72」だけを青で（xterm の青は render.mjs の色の表で #1453c8）
 */
export const PS1 = "\\[\\e[34m\\]care72\\[\\e[0m\\] $ ";

/**
 * 子の端末に渡す環境。この道具を起こしたセッションの CLAUDE・ANTHROPIC・MCP の変数は渡さない
 * （入れ子の Claude Code と取り違えない・アカウントの値を持ち込まない）。履歴は書かない、git の pager は使わない
 */
export function childEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC|MCP_)/i.test(k)) continue;
    env[k] = v;
  }
  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "ja_JP.UTF-8",
    LC_ALL: "ja_JP.UTF-8",
    GIT_PAGER: "cat",
    PAGER: "cat",
    HISTFILE: "",
    DISABLE_AUTOUPDATER: "1",
    ...extra,
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 疑似端末 1 つ。出た文字を記録し、手元の xterm（画面の文字を見るため）にも流す */
export class Session {
  /**
   * live に term.cast の道を渡すと、出た文字を 1 件ずつ書き足す（途中で止められても、そこまでの記録が残る）
   */
  constructor({ file = BASH, args = ["--noprofile", "--norc", "-i"], cwd = REPO, cols = SIZE.cols, rows = SIZE.rows, env = childEnv({ PS1 }), title = "", live = null } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.events = []; // [秒, "o"|"i"|"m", 文字]
    this.title = title;
    this.live = live;
    if (live) {
      mkdirSync(dirname(live), { recursive: true });
      writeFileSync(live, `${JSON.stringify(this.head())}\n`);
    }
    this.term = new Terminal({ cols, rows, scrollback: 20000, allowProposedApi: true });
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = "11";
    this.lastOutput = 0;
    this.t0 = process.hrtime.bigint();
    this.exited = false;
    this.p = pty.spawn(file, args, { name: "xterm-256color", cols, rows, cwd, env, useConpty: true });
    this.p.onData((d) => {
      const t = this.now();
      this.push([t, "o", d]);
      this.lastOutput = t;
      this.term.write(d);
    });
    this.p.onExit(() => {
      this.exited = true;
    });
  }

  head() {
    return { version: 2, width: this.cols, height: this.rows, timestamp: Math.floor(Date.now() / 1000), title: this.title, env: { TERM: "xterm-256color" } };
  }

  push(ev) {
    this.events.push(ev);
    if (this.live) appendFileSync(this.live, `${JSON.stringify([Math.round(ev[0] * 1e6) / 1e6, ev[1], ev[2]])}\n`);
  }

  /** 始めからの秒 */
  now() {
    return Number(process.hrtime.bigint() - this.t0) / 1e9;
  }

  write(s) {
    this.push([this.now(), "i", s]);
    this.p.write(s);
  }

  /** 1 字ずつ打つ（人の速さに近い間で） */
  async type(text, { cps = 14, jitter = 0.35 } = {}) {
    for (const ch of text) {
      this.write(ch);
      const base = 1000 / cps;
      await sleep(base * (1 - jitter + Math.random() * jitter * 2));
    }
  }

  async enter() {
    this.write("\r");
  }

  /** 名前つきの印（描くときの始まり・終わりの目安） */
  mark(label) {
    const t = this.now();
    this.push([t, "m", label]);
    console.log(`  ${t.toFixed(2)} 秒 ${label}`);
  }

  /** いまの画面（見えている行）の文字 */
  screen() {
    const b = this.term.buffer.active;
    const lines = [];
    for (let i = b.baseY; i < b.baseY + this.rows; i++) lines.push(b.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n");
  }

  /** 始めからの全部の行（流れて見えなくなった行も） */
  allText() {
    const b = this.term.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n");
  }

  /** 画面に re が出るまで待つ */
  async waitFor(re, { timeout = 60_000, all = false } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      // headless の xterm は書き込みを後で処理するので、少し待ってから見る
      await sleep(100);
      const text = all ? this.allText() : this.screen();
      if (re.test(text)) return text;
      if (this.exited) break;
    }
    throw new Error(`待っても出ない: ${re}\n--- 画面 ---\n${this.screen()}`);
  }

  /** 出力が ms のあいだ止まるまで待つ */
  async idle(ms, { timeout = 600_000 } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      await sleep(100);
      if (this.now() - this.lastOutput >= ms / 1000) return;
    }
    throw new Error(`出力が止まらない（${timeout / 1000} 秒）`);
  }

  /** プロンプトが戻るまで待つ（最後の行が「care72 $」で、出力が止まっている） */
  async prompt({ timeout = 600_000 } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      await sleep(150);
      const lines = this.screen().split("\n").filter((l) => l.trim() !== "");
      const last = lines.at(-1) ?? "";
      if (/^care72 \$\s*$/.test(last) && this.now() - this.lastOutput > 0.4) return;
      if (this.exited) throw new Error("端末が閉じた");
    }
    throw new Error(`プロンプトが戻らない\n--- 画面 ---\n${this.screen()}`);
  }

  kill() {
    try {
      this.p.kill();
    } catch {
      // 閉じていれば何もしない
    }
  }

  /** asciicast v2 の形で書く（1 行目が頭、2 行目からが [秒, 種類, 文字]） */
  save(file) {
    mkdirSync(dirname(file), { recursive: true });
    const body = this.events.map(([t, k, d]) => JSON.stringify([Math.round(t * 1e6) / 1e6, k, d])).join("\n");
    writeFileSync(file, `${JSON.stringify(this.head())}\n${body}\n`);
    console.log(`記録 ${file}（${this.events.length} 件、${this.now().toFixed(1)} 秒）`);
  }
}

/** term.cast を読む */
export function loadCast(file) {
  const [head, ...rest] = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const header = JSON.parse(head);
  const events = rest.map((l) => JSON.parse(l));
  return { header, events };
}

/** 記録の出力を手元の xterm に流し、流れて見えなくなった行も含めて全部の行を返す */
export async function castLines(file) {
  const { header, events } = loadCast(file);
  const term = new Terminal({ cols: header.width, rows: header.height, scrollback: 50000, allowProposedApi: true });
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  for (const [, kind, data] of events) if (kind === "o") await new Promise((r) => term.write(data, r));
  const b = term.buffer.active;
  const lines = [];
  for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? "");
  return lines;
}

/**
 * 映してはいけない物（ユーザー名の入った道・ログインの名前・メールの形）を含む行。
 * Claude Code はフックの誤りの行にフックの命令（道が展開されることがある）を出すので、描く前にこれで見る
 */
export function privateLines(lines) {
  const user = (() => {
    try {
      return userInfo().username;
    } catch {
      return "";
    }
  })();
  // メールは「@ の後ろが英字で始まり、英字の TLD で終わる」形だけ（npm の care72@0.1.0 を取り違えない）
  const res = [/[A-Za-z]:[\\/]Users[\\/]/i, /[\w.+-]+@[A-Za-z][\w-]*(\.[\w-]+)*\.[A-Za-z]{2,}\b/];
  if (user.length >= 3) res.push(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  return lines.map((text, i) => ({ row: i + 1, text })).filter(({ text }) => res.some((re) => re.test(text)));
}
