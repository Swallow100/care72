// そのまま記録する道具（asciinema の rec と同じ形）。作者が自分の端末（Windows Terminal など）で打ち、
// 中の疑似端末（大きさは固定）に流れた文字を記録して、終わったら shoot.mjs と同じ形の連番に描く。
// Claude Code の画面（R21〜R23）を撮るため。打つのも答えを選ぶのも作者で、この道具は何も打たない。
//
//   node video/scripts/term/rec.mjs R21 --claude          … 中で claude を起こす（claude.mjs と同じ版・引数・IS_DEMO）。/exit で終わる
//   node video/scripts/term/rec.mjs R20                   … 中で bash を起こす（プロンプトは「care72 $」）。exit で終わる
//   node video/scripts/term/rec.mjs R2x -- <命令> <引数>… … 中で任意の命令
//   ほか: --take 1（回）、--cols 90 --rows 24（中の大きさ）、--no-render（記録だけ）、--dir <フォルダ>（置き場の外へ。試し用）
//
// 撮っている間の操作: F12（か Ctrl+\）で印（描く始まり）。中の命令には送らない。印が 1 つ以上あれば、1 つ目の印の 0.5 秒前から描く。
// 印が無ければ記録の頭から描くので、あとで render.mjs を --from で流し直す（text.mjs で秒ごとの画面を見て決める）。
// 外の端末は中より大きくしておく（90×24 なら 100×30 以上）。小さいと外の表示が崩れる（記録は崩れない）。
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { CLAUDE_SIZE, claudeArgs, findClaude } from "./claude.mjs";
import { BASH, PS1, REC, REPO, childEnv, loadCast } from "./lib.mjs";
import { render } from "./render.mjs";

const require = createRequire(import.meta.url);
const pty = require("@lydell/node-pty");

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const own = dash >= 0 ? argv.slice(0, dash) : argv;
const opt = (name, def) => (own.includes(name) ? own[own.indexOf(name) + 1] : def);
const id = own.find((a) => /^R\d{2}$/.test(a));
if (!id) {
  console.error("使い方: node video/scripts/term/rec.mjs R21 [--claude] [--take 1] [--cols 90 --rows 24] [--no-render] [-- 命令 引数…]");
  process.exit(2);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("端末（Windows Terminal など）から起こす。入出力を管へつないだままでは使えない");
  process.exit(2);
}
const useClaude = own.includes("--claude");
const cols = Number(opt("--cols", useClaude ? String(CLAUDE_SIZE.cols) : "80"));
const rows = Number(opt("--rows", useClaude ? String(CLAUDE_SIZE.rows) : "20"));
const take = opt("--take", "1");

let file = BASH;
let args = ["--noprofile", "--norc", "-i"];
let env = childEnv({ PS1 });
if (dash >= 0) {
  [file, ...args] = argv.slice(dash + 1);
} else if (useClaude) {
  const exe = findClaude();
  if (!exe) {
    console.error("claude.exe が見つからない（CLAUDE_EXE で場所を渡すか、-- の後に命令を書いて起こす）");
    process.exit(2);
  }
  file = exe;
  args = claudeArgs();
  env = childEnv({ IS_DEMO: "1" });
}

if ((process.stdout.columns ?? 0) < cols || (process.stdout.rows ?? 0) < rows) {
  console.error(`外の端末が ${process.stdout.columns}×${process.stdout.rows} で、中（${cols}×${rows}）より小さい。窓を広げるか字を小さくしてから起こす`);
  process.exit(2);
}

// --dir は試しに撮るとき用（置き場の外へ）
const dir = own.includes("--dir") ? resolve(opt("--dir")) : join(REC, `${id}-${take}`);
const cast = join(dir, "term.cast");
const events = [];
const t0 = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - t0) / 1e9;

process.stdout.write("\x1b[2J\x1b[H");
const p = pty.spawn(file, args, { name: "xterm-256color", cols, rows, cwd: REPO, env, useConpty: true });
p.onData((d) => {
  events.push([now(), "o", d]);
  // 中の ConPTY が外の端末に「Windows のキー入力の形（win32-input-mode）」を求める列は外へ映さない（記録には残す）。
  // 映すと外の端末のキーが ESC[vk;sc;uc;kd;cs;rc_ の形で届き、F12 の印が見分けにくくなる。中はふつうの形の入力も読める
  process.stdout.write(d.replace(/\x1b\[\?9001[hl]/g, ""));
});
process.stdin.setRawMode(true);
process.stdin.resume();
// 印のキー: F12 と Ctrl+\。ふつうの形（ESC[24~・0x1c）と、Windows のキー入力の形（vk 123 の F12、uc 28 の Ctrl+\）の両方
const MARK_KEYS = [/\x1b\[24~/g, /\x1c/g, /\x1b\[123;\d+;\d+;1;\d+;\d+_/g, /\x1b\[\d+;\d+;28;1;\d+;\d+_/g];
const MARK_UP = [/\x1b\[123;\d+;\d+;0;\d+;\d+_/g, /\x1b\[\d+;\d+;28;0;\d+;\d+_/g];
process.stdin.on("data", (buf) => {
  let s = buf.toString("utf8");
  for (const re of MARK_KEYS) {
    const n = (s.match(re) ?? []).length;
    for (let i = 0; i < n; i++) {
      events.push([now(), "m", `mark${events.filter(([, k]) => k === "m").length + 1}`]);
      process.stdout.write("\x07");
    }
    s = s.replace(re, "");
  }
  for (const re of MARK_UP) s = s.replace(re, "");
  if (s) {
    events.push([now(), "i", s]);
    p.write(s);
  }
});

p.onExit(async () => {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  mkdirSync(dir, { recursive: true });
  const head = { version: 2, width: cols, height: rows, timestamp: Math.floor(Date.now() / 1000), title: id, env: { TERM: "xterm-256color" } };
  writeFileSync(cast, `${JSON.stringify(head)}\n${events.map(([t, k, d]) => JSON.stringify([Math.round(t * 1e6) / 1e6, k, d])).join("\n")}\n`);
  process.stdout.write(`\x1b[0m\r\n記録 ${cast}（${events.length} 件、${now().toFixed(1)} 秒）\r\n`);
  if (own.includes("--no-render")) process.exit(0);
  const marks = loadCast(cast).events.filter(([, k]) => k === "m");
  const from = marks.length ? `@${marks[0][2]}-0.5` : undefined;
  await render({ cast, out: dir, name: id, from });
  console.log(`確かめる: node video/scripts/sheet.mjs ${dir}`);
  process.exit(0);
});
