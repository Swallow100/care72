// scripts の共通の道具: video/ の場所、一時フォルダを video/.tmp に向けた環境、命令の流し方、ffmpeg の呼び方。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

/**
 * 一時フォルダを video/.tmp に向けた環境。
 * Windows の %TEMP% は C: にあり、書き出しの一時の静止画で C: が埋まる。ストレージ センサーが途中で %TEMP% を消すこともある。
 */
export function tmpEnv() {
  const tmp = join(ROOT, ".tmp");
  mkdirSync(tmp, { recursive: true });
  return { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
}

/** Windows の npx は .cmd なので shell が要る。shell のときは空白などを含む引数を引用符で囲む */
function prepare(cmd, args) {
  const shell = isWin && cmd === "npx";
  if (!shell) return { cmd, args, shell };
  // npx.cmd は batch なので、= , ; も引数の区切りに読まれる（fps=30 が fps と 30 に割れた）。これらを含む引数も囲む
  const quote = (a) => (/[\s"&|<>^()=,;]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  return { cmd, args: args.map(quote), shell };
}

/** 命令を流す（出力はそのまま見せる）。失敗したら止める */
export function run(cmd, args) {
  const p = prepare(cmd, args);
  const r = spawnSync(p.cmd, p.args, { stdio: "inherit", cwd: ROOT, env: tmpEnv(), shell: p.shell });
  if (r.status !== 0) {
    console.error(`失敗: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

/** 命令を流して出力を受け取る（止めない） */
export function capture(cmd, args) {
  const p = prepare(cmd, args);
  return spawnSync(p.cmd, p.args, { cwd: ROOT, env: tmpEnv(), encoding: "utf8", shell: p.shell });
}

/**
 * ffmpeg の呼び方。順に: 環境変数 FFMPEG、PATH の ffmpeg、Remotion の部品に入っている ffmpeg（直に呼ぶ）、npx remotion ffmpeg。
 * Remotion の ffmpeg は機能を絞った物なので、loudnorm が無ければ PATH に ffmpeg を入れる（README の「音」）。
 */
export function ffmpeg() {
  const own = process.env.FFMPEG || "ffmpeg";
  if (spawnSync(own, ["-version"], { stdio: "ignore" }).status === 0) return { cmd: own, pre: [] };
  const scope = join(ROOT, "node_modules", "@remotion");
  if (existsSync(scope)) {
    for (const dir of readdirSync(scope)) {
      if (!dir.startsWith("compositor-")) continue;
      const exe = join(scope, dir, isWin ? "ffmpeg.exe" : "ffmpeg");
      if (existsSync(exe) && spawnSync(exe, ["-version"], { stdio: "ignore" }).status === 0) return { cmd: exe, pre: [] };
    }
  }
  return { cmd: "npx", pre: ["remotion", "ffmpeg"] };
}
