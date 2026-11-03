// 作者が手で打つ道具（T72）: 気象庁の本物のフィードと直近の電文を取って lib/jma/fixtures/real/ に置く。
// エージェントは打たない（作業中は本物の気象庁に繋がない決まり。docs/tasks/T72.md）。打ち方は docs/progress/t72.md。
//
//   node tools/jma/fetch-fixtures.mjs
//
// 取る物（全部で 20 回ほど。1 秒ずつ空けて順に取る）:
// - 長期フィード extra_l.xml・eqvol_l.xml（毎時更新・数日分）から、種類ごと（VPWW53〜61・VXSE51〜53）に一番新しい電文と、
//   警報は愛媛県（…_380000.xml）の一番新しい電文を選んで data/ に置く
// - 選んだ entry だけを残したフィードを extra.xml・eqvol.xml に（頭と entry の文字は本物のまま。手元の道具とテストが読む形）
// - 雨雲の時刻の一覧 targetTimes_N1.json（旗 JMA_NOWCAST を on にする前に、形が lib/jma/nowcast.ts の読み方と合うか見る）
// 置いたあと: npx vitest run lib/jma（本物の電文が読めるかのテストが走る）、npm run jma:fetch-local（手元の D1 に写して /office で見る）。
// 本物の写しを commit するかは作者が決める（出典は気象庁防災情報XML）。

import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../../lib/jma/fixtures/real/", import.meta.url);
const FEEDS = {
  extra: "https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml",
  eqvol: "https://www.data.jma.go.jp/developer/xml/feed/eqvol_l.xml",
};
const TIMES = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
const WANTED = {
  extra: ["VPWW53", "VPWW54", "VPWW55", "VPWW56", "VPWW57", "VPWW58", "VPWW59", "VPWW60", "VPWW61"],
  eqvol: ["VXSE51", "VXSE52", "VXSE53"],
};
/** 警報は愛媛県（松山地方気象台の府県予報区）の物も 1 つ */
const LOCAL_SUFFIX = "_380000.xml";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** フィードの頭（最初の entry の前）と entry の文字（本物のまま）と、その URL・種類・時刻 */
function splitFeed(xml) {
  const first = xml.indexOf("<entry>");
  const head = first >= 0 ? xml.slice(0, first) : xml.replace(/<\/feed>\s*$/, "");
  const entries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((m) => {
    const raw = m[0];
    const href = /<link[^>]*type="application\/xml"[^>]*href="([^"]+)"/.exec(raw)?.[1] ?? /<id>([^<]+)<\/id>/.exec(raw)?.[1] ?? "";
    const updated = /<updated>([^<]+)<\/updated>/.exec(raw)?.[1] ?? "";
    const code = /_([A-Z]{4}\d{2})_[^/_]*\.xml$/.exec(href)?.[1] ?? null;
    return { raw, href, updated, code };
  });
  return { head, entries };
}

function pick(entries, codes) {
  const latest = (list) => list.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0];
  const out = new Map();
  for (const code of codes) {
    const all = entries.filter((e) => e.code === code);
    const top = latest([...all]);
    if (top) out.set(top.href, top);
    const local = latest(all.filter((e) => e.href.endsWith(LOCAL_SUFFIX)));
    if (local) out.set(local.href, local);
  }
  return [...out.values()];
}

mkdirSync(new URL("./data/", OUT), { recursive: true });
const at = new Date().toISOString();
const report = [];
for (const [feed, url] of Object.entries(FEEDS)) {
  const xml = await get(url);
  const { head, entries } = splitFeed(xml);
  const chosen = pick(entries, WANTED[feed]);
  for (const e of chosen) {
    await sleep(1000);
    try {
      writeFileSync(new URL(`./data/${e.href.split("/").pop()}`, OUT), await get(e.href));
      report.push(`${feed} ${e.code} ${e.updated} ${e.href.split("/").pop()}`);
    } catch (err) {
      report.push(`${feed} ${e.code} 取れない ${err.message}`);
    }
  }
  const note = `<!-- 気象庁防災情報XML の ${url} の写し（${at} に tools/jma/fetch-fixtures.mjs が取った）。entry は種類ごとに選んだ物だけ残した -->\n`;
  const body = head.replace(/^(<\?xml[^>]*\?>\s*)/, `$1${note}`) + chosen.map((e) => `  ${e.raw}\n`).join("") + "</feed>\n";
  writeFileSync(new URL(`./${feed}.xml`, OUT), body);
  await sleep(1000);
}
try {
  writeFileSync(new URL("./targetTimes_N1.json", OUT), await get(TIMES));
  report.push("targetTimes_N1.json");
} catch (err) {
  report.push(`targetTimes_N1.json 取れない ${err.message}`);
}
console.log(`置いた所: ${OUT.pathname}`);
for (const line of report) console.log(`  ${line}`);
console.log("次: npx vitest run lib/jma（本物が読めるか）→ npm run jma:fetch-local（手元の D1 に写す）");
