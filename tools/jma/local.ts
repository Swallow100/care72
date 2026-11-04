// npm run jma:fetch-local: fixtures の XML を手元の D1（.wrangler/state、--local と同じ所）に写す（T72）。本物の気象庁には繋がない。
// 手元の next dev では cron が動かないので、事業所の画面（/office）の警報・地震の欄はこれで確かめる。
// - 使う fixtures: lib/jma/fixtures/real/（作者が tools/jma/fetch-fixtures.mjs で取った本物）があればそれ、無ければ作った見本（sample/）
// - 写す前に手元の jma_ の表を空にする（何度流しても同じになる）。写し方は配信の cron と同じ（lib/jma/run.ts の fetchJma）
// - 時刻は今（--now=2026-11-03T14:00:00Z で変えられる）。見本の電文は 2026-11-03 の物なので、地震の「直近 24 時間」から外れたら --now で戻す
// 先に npm run db:reset（表と種の 10 人）。wrangler の getPlatformProxy で手元の模擬だけを使う（remoteBindings: false、cf.json も取らない）。

import type { D1Database } from "@cloudflare/workers-types";
import { fixtureDir, fixtureFetcher, REAL_DIR } from "../../lib/jma/fixture-fetch.ts";
import { fetchJma } from "../../lib/jma/run.ts";

// wrangler を読む前に、外へ出る物（cf.json の取得・利用の統計）を止める
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
process.env.WRANGLER_SEND_METRICS = "false";
const { getPlatformProxy } = await import("wrangler");

const arg = process.argv.find((a) => a.startsWith("--now="));
const now = arg ? new Date(arg.slice("--now=".length)).toISOString() : new Date().toISOString();
const dir = fixtureDir();

const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({ remoteBindings: false, envFiles: [] });
try {
  await env.DB.batch(
    ["jma_quake_points", "jma_quakes", "jma_warnings", "jma_entries", "jma_fetch_state"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  const runs = await fetchJma(env.DB, fixtureFetcher(dir), now);
  console.log(`fixtures: ${dir.href === REAL_DIR.href ? "本物の写し（real）" : "作った見本（sample）"}  時刻: ${now}`);
  for (const r of runs) {
    console.log(`  ${r.feed}: ${r.status} 写 ${r.stored}（読めない ${r.unreadable}） 取れない ${r.failed} 残 ${r.deferred}${r.note ? ` ${r.note}` : ""}`);
  }
  const n = await env.DB.prepare("SELECT (SELECT count(*) FROM jma_warnings) AS w, (SELECT count(*) FROM jma_quakes) AS q, (SELECT count(*) FROM jma_quake_points) AS p").first<{
    w: number;
    q: number;
    p: number;
  }>();
  console.log(`  警報・注意報の行 ${n?.w ?? 0}、地震 ${n?.q ?? 0}、観測点 ${n?.p ?? 0}`);
} finally {
  await dispose();
}
