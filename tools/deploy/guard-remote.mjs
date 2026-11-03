// 作り直しの前の守り。使い方: node tools/deploy/guard-remote.mjs [--local]
// tools/deploy/rebuild-remote.sh が drop の前（前段の前）に流す。本物の事業所のデータがあれば終了コード 1 で止める。
// 消してよいときだけ ALLOW_DATA_LOSS=1 を付ける（数を出して続ける）。数が読めないときは ALLOW_DATA_LOSS=1 でも止める。
// 中身は tools/deploy/guard.ts（node が型を外してそのまま読む）。行の中身は読まず、数だけを出す。
// 既定は remote の D1（care72）。--local は手元の D1 で試すとき。
//
// wrangler は node で直に呼ぶ（npx は Windows で cmd.exe を通り、引数の SQL の引用符と長さで落ちることがある。前段と同じ理由）

import { spawnSync } from "node:child_process";
import { runGuard } from "./guard.ts";

const target = process.argv.includes("--local") ? "--local" : "--remote";

/** @param {string} sql */
function query(sql) {
  const r = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "care72", target, "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`wrangler ${r.status}: ${`${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim()}`);
  return r.stdout;
}

const d = await runGuard(query, process.env);
for (const line of d.lines) console.log(line);
process.exit(d.ok ? 0 : 1);
