// 気象庁の防災情報 XML を取って写す（docs/tasks/T72.md の 1）のテスト。本物の気象庁には繋がない（fixtures の作った見本と偽の fetch）。
// - フィード（Atom）・警報（VPWW55・54・53）・地震（VXSE51・52・53）を読む。名前・状態・時刻・市町村は電文のまま
// - 市の突き合わせ（同じ市・区のある市・違う市）
// - 写す 1 回: 事業所と利用者の市の行だけ、同じ電文は 2 回写さない、304 で何もしない、壊れた電文は記録して飛ばす、
//   取れなかった電文は次の回に、上限、7 日で消える、訓練の電文は写さない
// - cron の文字（wrangler.jsonc と同じ、ほかの cron では何もしない）

import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { DAILY_RESET_CRON } from "../seed/cron.ts";
import { JMA_FETCH_CRON, scheduledJmaFetch } from "./cron.ts";
import {
  FETCH_NOTES,
  fetchFeed,
  fetchText,
  jmaUrlAllowed,
  MAX_BODY_BYTES,
  MAX_ENTRIES_PER_RUN,
  MAX_REDIRECTS,
  parseFeed,
  pickNew,
  typeCodeOf,
  type FeedEntry,
  type Fetcher,
} from "./feed.ts";
import { fixtureFetcher, fixtureText, REAL_DIR, SAMPLE_DIR } from "./fixture-fetch.ts";
import { intensityLabel, isQuakeCode, isWarningCode, isWarningKind, JMA_FEED_URLS, magnitudeLabel, priorityOf } from "./labels.ts";
import { cityOf, sameCity, uniqueCities } from "./match.ts";
import { parseQuake } from "./quake.ts";
import { fetchJma, toStored } from "./run.ts";
import { RETAIN_DAYS, relevantCities } from "./store.ts";
import { isMunicipalityWarning, parseWarning } from "./warning.ts";

const DATA = "https://www.data.jma.go.jp/developer/xml/data/";
const VPWW55 = `${DATA}20261103130000_0_VPWW55_380000.xml`;
const VPWW54 = `${DATA}20261103130000_0_VPWW54_380000.xml`;
const VPWW53 = `${DATA}20261103130000_0_VPWW53_380000.xml`;
const VPWW54_HIROSHIMA = `${DATA}20261103125500_0_VPWW54_340000.xml`;
const VXSE53 = `${DATA}20261103125200_0_VXSE53_010000.xml`;
const VXSE52 = `${DATA}20261103125100_0_VXSE52_010000.xml`;
const VXSE51 = `${DATA}20261103124930_0_VXSE51_010000.xml`;

const sample = (name: string) => {
  const t = fixtureText(SAMPLE_DIR, name);
  if (t === null) throw new Error(`fixtures が無い: ${name}`);
  return t;
};
const data = (url: string) => sample(`data/${url.split("/").pop()}`);

/** 取る時刻（見本の電文の 1 時間ほどあと） */
const NOW = "2026-11-03T14:00:00.000Z";

describe("作った見本", () => {
  it("どの fixtures も頭に「作った見本。本物の電文ではない」", () => {
    for (const name of ["extra.xml", "eqvol.xml", ...[VPWW55, VPWW54, VPWW53, VPWW54_HIROSHIMA, VXSE53, VXSE52, VXSE51].map((u) => `data/${u.split("/").pop()}`)]) {
      expect(sample(name).slice(0, 200), name).toContain("作った見本。本物の電文ではない");
    }
  });
});

describe("フィード（Atom）", () => {
  it("entry ごとに id・title・updated（UTC）・電文の URL・種類を出す", () => {
    const entries = parseFeed(sample("extra.xml"));
    expect(entries).toHaveLength(5);
    expect(entries[1]).toEqual({
      id: VPWW55,
      title: "気象警報・注意報",
      updated: "2026-11-03T13:00:00.000Z",
      url: VPWW55,
      typeCode: "VPWW55",
    });
    expect(entries.map((e) => e.typeCode)).toEqual(["VPFD51", "VPWW55", "VPWW54", "VPWW53", "VPWW54"]);
    expect(parseFeed(sample("eqvol.xml")).map((e) => e.typeCode)).toEqual(["VXSE53", "VXSE52", "VXSE51", "VFVO56"]);
  });

  it("entry が 1 つでも配列で読む。壊れたフィードは投げる", () => {
    const one = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>${VXSE53}</id><title>震源・震度に関する情報</title><updated>2026-11-03T12:52:00Z</updated><link type="application/xml" href="${VXSE53}"/></entry></feed>`;
    expect(parseFeed(one).map((e) => e.typeCode)).toEqual(["VXSE53"]);
    expect(() => parseFeed("<feed><entry></feed>")).toThrow();
  });

  it("種類は電文の URL の中の文字から", () => {
    expect(typeCodeOf(VPWW54)).toBe("VPWW54");
    expect(typeCodeOf(`${DATA}20261103125200_0_VXSE53_010000.xml`)).toBe("VXSE53");
    expect(typeCodeOf("https://example.invalid/feed.xml")).toBeNull();
  });

  it("取る電文は警報・注意報と地震だけ。新しい体系 → VPWW54 → VPWW53、地震は震源・震度 → 震源 → 震度速報。上限を超えた分は次の回に", () => {
    expect(["VPWW55", "VPWW61", "VPWW54", "VPWW53", "VXSE53", "VXSE51"].map(priorityOf)).toEqual([0, 0, 1, 2, 0, 2]);
    expect(["VPFD51", "VFVO56", "VXWW50", null].map(priorityOf)).toEqual([null, null, null, null]);
    const entries = parseFeed(sample("extra.xml"));
    const all = pickNew(entries, new Set(), 10);
    expect(all.take.map((e) => e.typeCode)).toEqual(["VPWW55", "VPWW54", "VPWW54", "VPWW53"]);
    // VPWW54 の 2 つは古い順（広島 12:55 → 愛媛 13:00）
    expect(all.take[1].id).toBe(VPWW54_HIROSHIMA);
    expect(all.deferred).toBe(0);
    const two = pickNew(entries, new Set([VPWW55]), 2);
    expect(two.take.map((e) => e.id)).toEqual([VPWW54_HIROSHIMA, VPWW54]);
    expect(two.deferred).toBe(1);
    expect(MAX_ENTRIES_PER_RUN).toBeLessThanOrEqual(48);
  });
});

describe("取りに行く所と大きさ（見直しの安全 低）", () => {
  it("取りに行くのは https の気象庁の置き場（data.jma.go.jp・xml.kishou.go.jp とその下）だけ", () => {
    for (const ok of [JMA_FEED_URLS.extra, JMA_FEED_URLS.eqvol, VPWW55, "https://data.jma.go.jp/x.xml", "https://xml.kishou.go.jp/data/a.xml"]) {
      expect(jmaUrlAllowed(ok), ok).toBe(true);
    }
    for (const ng of [
      "http://www.data.jma.go.jp/developer/xml/data/a.xml",
      "https://www.jma.go.jp/bosai/warning/",
      "https://data.jma.go.jp.example.com/a.xml",
      "https://evildata.jma.go.jp/a.xml",
      "https://www.data.jma.go.jp:8443/a.xml",
      "https://u:p@www.data.jma.go.jp/a.xml",
      "https://169.254.169.254/latest",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(jmaUrlAllowed(ng), ng).toBe(false);
    }
  });

  it("フィードに載った外の URL の電文は取らない（数えない・次の回にも残さない）", () => {
    const outside: FeedEntry = { id: "x", title: "気象警報・注意報", updated: "2026-11-03T13:00:00.000Z", url: "https://example.com/20261103130000_0_VPWW54_380000.xml", typeCode: "VPWW54" };
    const entries = [...parseFeed(sample("extra.xml")), outside];
    const r = pickNew(entries, new Set(), 10);
    expect(r.take.map((e) => e.url)).not.toContain(outside.url);
    expect(r.take).toHaveLength(4);
    expect(r.deferred).toBe(0);
  });

  it("外の URL は取りに行かない。移りは redirect: manual で受け、移った先も確かめて上限の回までたどる", async () => {
    const calls: Array<{ url: string; redirect?: RequestRedirect }> = [];
    const routes: Record<string, () => Response> = {
      [VPWW55]: () => new Response(null, { status: 302, headers: { Location: "/developer/xml/data/moved.xml" } }),
      [`${DATA}moved.xml`]: () => new Response("<Report/>", { status: 200 }),
      [VPWW54]: () => new Response(null, { status: 301, headers: { Location: "https://example.com/x.xml" } }),
    };
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, redirect: init?.redirect });
      return routes[url]?.() ?? new Response(null, { status: 302, headers: { Location: `${url}x` } });
    };
    expect(await fetchText(VPWW55, fetcher)).toEqual({ ok: true, text: "<Report/>" });
    expect(calls.map((c) => c.redirect)).toEqual(["manual", "manual"]);
    calls.length = 0;
    expect(await fetchText(VPWW54, fetcher)).toEqual({ ok: false, note: FETCH_NOTES.host });
    expect(calls.map((c) => c.url)).toEqual([VPWW54]);
    calls.length = 0;
    expect(await fetchText("https://example.com/a.xml", fetcher)).toEqual({ ok: false, note: FETCH_NOTES.host });
    expect(calls).toEqual([]);
    expect(await fetchFeed("https://example.com/feed.xml", null, fetcher)).toEqual({ kind: "error", note: FETCH_NOTES.host });
    expect(calls).toEqual([]);
    // 移りが続けば MAX_REDIRECTS 回で止める
    expect(await fetchText(VPWW53, fetcher)).toEqual({ ok: false, note: FETCH_NOTES.redirects });
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("本文は 2MB まで。Content-Length が超えれば読まず、無い物も読みながら数えて切る。304 はそのまま", async () => {
    expect(MAX_BODY_BYTES).toBe(2 * 1024 * 1024);
    const big = "あ".repeat(Math.ceil(MAX_BODY_BYTES / 3) + 1);
    let pulled = 0;
    const stream = () =>
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulled++;
          c.enqueue(new Uint8Array(512 * 1024).fill(0x41));
          if (pulled > 20) c.close();
        },
      });
    const fetcher: Fetcher = async (url) => {
      if (url === VPWW55) return new Response(big, { status: 200 });
      if (url === VPWW54) return new Response("x", { status: 200, headers: { "Content-Length": String(MAX_BODY_BYTES + 1) } });
      if (url === VPWW53) return new Response(stream(), { status: 200 });
      if (url === JMA_FEED_URLS.extra) return new Response(big, { status: 200 });
      if (url === JMA_FEED_URLS.eqvol) return new Response(null, { status: 304 });
      return new Response(sample("extra.xml"), { status: 200 });
    };
    expect(await fetchText(VPWW55, fetcher)).toEqual({ ok: false, note: FETCH_NOTES.large });
    expect(await fetchText(VPWW54, fetcher)).toEqual({ ok: false, note: FETCH_NOTES.large });
    expect(await fetchText(VPWW53, fetcher)).toEqual({ ok: false, note: FETCH_NOTES.large });
    // 上限の少しあとで読むのを止める（全部は読まない）
    expect(pulled).toBeLessThanOrEqual(6);
    expect(await fetchFeed(JMA_FEED_URLS.extra, null, fetcher)).toEqual({ kind: "error", note: FETCH_NOTES.large });
    expect(await fetchFeed(JMA_FEED_URLS.eqvol, "Tue, 03 Nov 2026 13:00:00 GMT", fetcher)).toEqual({ kind: "not_modified" });
    const ok = await fetchText(VXSE53, fetcher);
    expect(ok.ok && ok.text).toBe(sample("extra.xml"));
  });
});

describe("警報・注意報の電文", () => {
  it("VPWW55（新しい体系の見本）: 市町村ごとに正式な名前・状態のまま。発表の無い市町村は名前の無い 1 行", () => {
    const r = parseWarning(data(VPWW55));
    expect(r).toMatchObject({ status: "通常", infoType: "発表", issuedAt: "2026-11-03T13:00:00.000Z", officeName: "松山地方気象台" });
    expect(r.items).toEqual([
      { areaCode: "3820100", areaName: "松山市", kind: "レベル3大雨警報", status: "発表", sort: 0 },
      { areaCode: "3820100", areaName: "松山市", kind: "雷注意報", status: "継続", sort: 1 },
      { areaCode: "3821500", areaName: "東温市", kind: "大雨注意報", status: "継続", sort: 0 },
      { areaCode: "3821000", areaName: "伊予市", kind: "大雨注意報", status: "解除", sort: 0 },
      { areaCode: "3820200", areaName: "今治市", kind: "", status: "発表警報・注意報はなし", sort: 0 },
    ]);
  });

  it("VPWW54・VPWW53（経過措置）も同じ読み方。府県・一次細分・まとめた地域の区分は読まない", () => {
    const old = parseWarning(data(VPWW54));
    expect(old.items.map((i) => `${i.areaName} ${i.kind} ${i.status}`)).toEqual([
      "松山市 大雨警報 発表",
      "松山市 雷注意報 継続",
      "東温市 大雨注意報 継続",
      "今治市  発表警報・注意報はなし",
    ]);
    expect(parseWarning(data(VPWW53)).items.map((i) => `${i.areaName} ${i.kind}`)).toEqual(["松山市 大雨警報", "松山市 雷注意報", "東温市 大雨注意報"]);
    expect(isMunicipalityWarning("気象警報・注意報（市町村等）")).toBe(true);
    expect(isMunicipalityWarning("気象警報・注意報（市町村等をまとめた地域等）")).toBe(false);
    expect(isMunicipalityWarning("気象警報・注意報（府県予報区等）")).toBe(false);
  });

  it("読めない電文は投げる（壊れた XML・市町村の区分が無い・時刻が無い）", () => {
    expect(() => parseWarning("<Report><Control>")).toThrow();
    expect(() => parseWarning(data(VXSE53))).toThrow();
    expect(() => parseWarning(data(VPWW54).replace(/<ReportDateTime>[^<]*<\/ReportDateTime>/, ""))).toThrow();
  });

  it("警報（注意報でない物）の見分け: 名前に「警報」があり「注意報」が無い", () => {
    expect(["大雨警報", "レベル3大雨警報", "大雨特別警報", "暴風警報"].every(isWarningKind)).toBe(true);
    expect(["大雨注意報", "雷注意報", ""].some(isWarningKind)).toBe(false);
  });
});

describe("地震の電文", () => {
  it("VXSE53: 発生時刻・震源・規模・最大震度と観測点ごと（市町村・観測点・震度）を電文のまま", () => {
    const q = parseQuake(data(VXSE53));
    expect(q).toMatchObject({
      status: "通常",
      infoType: "発表",
      eventId: "20261103214800",
      reportAt: "2026-11-03T12:52:00.000Z",
      originAt: "2026-11-03T12:48:00.000Z",
      hypocenter: "伊予灘",
      magnitude: "4.6",
      maxIntensity: "4",
    });
    expect(q.points).toEqual([
      { areaName: "松山市", pointName: "松山市北持田町＊", intensity: "4" },
      { areaName: "松山市", pointName: "松山市富久町", intensity: "3" },
      { areaName: "東温市", pointName: "東温市見奈良＊", intensity: "3" },
      { areaName: "今治市", pointName: "今治市南宝来町＊", intensity: "2" },
      { areaName: "広島中区", pointName: "広島中区上八丁堀", intensity: "2" },
    ]);
  });

  it("VXSE52 は震源だけ、VXSE51 は最大震度だけ（観測点なし）", () => {
    expect(parseQuake(data(VXSE52))).toMatchObject({ hypocenter: "伊予灘", magnitude: "4.6", maxIntensity: null, points: [] });
    expect(parseQuake(data(VXSE51))).toMatchObject({ originAt: null, hypocenter: null, magnitude: null, maxIntensity: "4", points: [] });
  });

  it("震度・規模の表記は気象庁の呼び方（5- → 5弱）。数でない規模は M不明", () => {
    expect(["4", "5-", "5+", "6-", "6+", "7"].map(intensityLabel)).toEqual(["震度4", "震度5弱", "震度5強", "震度6弱", "震度6強", "震度7"]);
    expect(magnitudeLabel("4.6")).toBe("M4.6");
    expect(magnitudeLabel("NaN")).toBe("M不明");
    expect(magnitudeLabel(null)).toBe("M不明");
  });

  it("警報の電文は地震として読めない", () => {
    expect(() => parseQuake(data(VPWW54))).toThrow();
  });
});

describe("市の突き合わせ", () => {
  it("同じ市・区のある市（前方一致）・違う市", () => {
    expect(sameCity("松山市", "松山市")).toBe(true);
    expect(sameCity(" 松山市 ", "松山市")).toBe(true);
    expect(sameCity("広島市", "広島市中区")).toBe(true);
    expect(sameCity("松山市", "東温市")).toBe(false);
    // 前方一致は「市」の後ろが区のときだけ（似た名前に広げない）
    expect(sameCity("大和市", "大和高田市")).toBe(false);
    expect(sameCity("広島市", "広島市中区北部")).toBe(false);
    // 地震の電文の区の書き方（市を抜いた「広島中区」）には当てない（それ以上の読み替えはしない）
    expect(sameCity("広島市", "広島中区")).toBe(false);
    expect(sameCity("", "松山市")).toBe(false);
    expect(cityOf(["松山市", "東温市"], "東温市")).toBe("東温市");
    expect(cityOf(["松山市"], "今治市")).toBeNull();
    expect(uniqueCities(["松山市", " 松山市", null, "", "東温市"])).toEqual(["松山市", "東温市"]);
  });
});

// ---------- 写す 1 回（node:sqlite） ----------

let sqlite: DatabaseSync | undefined;

function seeded(): DatabaseSync {
  const db = migratedSqlite();
  for (const s of seedStatements()) db.exec(s);
  // 1 人だけ東温市に（利用者の住所の市も写す市に入る）
  db.exec(`UPDATE people SET ledger = json_set(ledger, '$.basic.address.city', '東温市') WHERE id = 'p-02'`);
  return db;
}

beforeEach(() => {
  sqlite = seeded();
});
afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

const rows = <T>(sql: string): T[] => sqlite!.prepare(sql).all() as T[];
const count = (table: string) => (sqlite!.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("写す 1 回", () => {
  it("写す市は事業所の市と、一覧から外していない利用者の住所の市", async () => {
    expect(await relevantCities(d1FromSqlite(sqlite!))).toEqual(["松山市", "東温市"]);
    sqlite!.exec(`UPDATE people SET unlisted_at = '${NOW}' WHERE id = 'p-02'`);
    expect(await relevantCities(d1FromSqlite(sqlite!))).toEqual(["松山市"]);
  });

  it("地震 → 警報の順に取り、対象の電文だけ。写すのは事業所と利用者の市の行だけ（広島・今治・伊予は写さない）", async () => {
    const calls: string[] = [];
    const runs = await fetchJma(d1FromSqlite(sqlite!), fixtureFetcher(SAMPLE_DIR, { calls }), NOW);
    expect(runs.map((r) => [r.feed, r.status, r.stored, r.unreadable, r.failed, r.deferred])).toEqual([
      ["eqvol", "ok", 3, 0, 0, 0],
      ["extra", "ok", 4, 0, 0, 0],
    ]);
    expect(calls[0]).toBe(JMA_FEED_URLS.eqvol);
    expect(calls).toContain(JMA_FEED_URLS.extra);
    // 対象外（府県天気予報・噴火）は取りに行かない
    expect(calls.some((u) => u.includes("VPFD51") || u.includes("VFVO56"))).toBe(false);
    expect(count("jma_entries")).toBe(7);
    const w = rows<{ type_code: string; area_name: string; kind: string; status: string }>(
      "SELECT type_code, area_name, kind, status FROM jma_warnings ORDER BY type_code DESC, area_name, sort",
    );
    expect(w.map((r) => `${r.type_code} ${r.area_name} ${r.kind} ${r.status}`)).toEqual([
      "VPWW55 東温市 大雨注意報 継続",
      "VPWW55 松山市 レベル3大雨警報 発表",
      "VPWW55 松山市 雷注意報 継続",
      "VPWW54 東温市 大雨注意報 継続",
      "VPWW54 松山市 大雨警報 発表",
      "VPWW54 松山市 雷注意報 継続",
      "VPWW53 東温市 大雨注意報 継続",
      "VPWW53 松山市 大雨警報 発表",
      "VPWW53 松山市 雷注意報 継続",
    ]);
    expect(rows<{ issued_at: string; office_name: string }>("SELECT DISTINCT issued_at, office_name FROM jma_warnings")).toEqual([
      { issued_at: "2026-11-03T13:00:00.000Z", office_name: "松山地方気象台" },
    ]);
    expect(count("jma_quakes")).toBe(3);
    expect(rows<{ point_name: string }>("SELECT point_name FROM jma_quake_points ORDER BY point_name").map((r) => r.point_name)).toEqual([
      "東温市見奈良＊",
      "松山市北持田町＊",
      "松山市富久町",
    ]);
    const state = rows<{ feed: string; ok: number; ok_at: string; note: string | null }>("SELECT feed, ok, ok_at, note FROM jma_fetch_state ORDER BY feed");
    expect(state).toEqual([
      { feed: "eqvol", ok: 1, ok_at: NOW, note: null },
      { feed: "extra", ok: 1, ok_at: NOW, note: null },
    ]);
  });

  it("同じ電文は 2 回写さない（2 回目はフィードだけ取る）", async () => {
    const db = d1FromSqlite(sqlite!);
    await fetchJma(db, fixtureFetcher(SAMPLE_DIR), NOW);
    const before = [count("jma_entries"), count("jma_warnings"), count("jma_quakes"), count("jma_quake_points")];
    const calls: string[] = [];
    const runs = await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { calls }), "2026-11-03T14:05:00.000Z");
    expect(runs.map((r) => r.stored)).toEqual([0, 0]);
    expect(calls).toEqual([JMA_FEED_URLS.eqvol, JMA_FEED_URLS.extra]);
    expect([count("jma_entries"), count("jma_warnings"), count("jma_quakes"), count("jma_quake_points")]).toEqual(before);
  });

  it("前回の Last-Modified を If-Modified-Since に付け、304 なら何もしない（取れたに数える）", async () => {
    const db = d1FromSqlite(sqlite!);
    const lm = "Tue, 03 Nov 2026 13:05:00 GMT";
    await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { lastModified: lm }), NOW);
    expect(rows<{ last_modified: string }>("SELECT last_modified FROM jma_fetch_state").map((r) => r.last_modified)).toEqual([lm, lm]);
    const calls: string[] = [];
    const later = "2026-11-03T14:05:00.000Z";
    const runs = await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { lastModified: lm, calls }), later);
    expect(runs.map((r) => r.status)).toEqual(["not_modified", "not_modified"]);
    expect(calls).toEqual([JMA_FEED_URLS.eqvol, JMA_FEED_URLS.extra]);
    expect(rows<{ ok: number; ok_at: string }>("SELECT ok, ok_at FROM jma_fetch_state")).toEqual([
      { ok: 1, ok_at: later },
      { ok: 1, ok_at: later },
    ]);
  });

  it("壊れた電文は記録に 1 行（note）残して飛ばし、次の回も取らない。ほかの電文は写す", async () => {
    const db = d1FromSqlite(sqlite!);
    const broken = (u: string) => (u === VPWW54 ? new Response("<Report><Control>", { status: 200 }) : null);
    const runs = await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { override: broken }), NOW);
    expect(runs[1]).toMatchObject({ stored: 4, unreadable: 1 });
    const e = rows<{ note: string | null }>(`SELECT note FROM jma_entries WHERE id = '${VPWW54}'`)[0];
    expect(e.note).toMatch(/^読めない: /);
    expect(count("jma_warnings")).toBe(6);
    const calls: string[] = [];
    await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { calls }), "2026-11-03T14:05:00.000Z");
    expect(calls).not.toContain(VPWW54);
  });

  it("取れなかった電文（HTTP 500）は記録せず、Last-Modified を前のまま残して次の回にまた取る", async () => {
    const db = d1FromSqlite(sqlite!);
    const lm = "Tue, 03 Nov 2026 13:05:00 GMT";
    const down = (u: string) => (u === VXSE53 ? new Response("", { status: 500 }) : null);
    const runs = await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { lastModified: lm, override: down }), NOW);
    expect(runs[0]).toMatchObject({ stored: 2, failed: 1, note: "残り 1 件" });
    expect(rows<{ last_modified: string | null }>("SELECT last_modified FROM jma_fetch_state WHERE feed = 'eqvol'")[0].last_modified).toBeNull();
    const calls: string[] = [];
    await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { lastModified: lm, calls }), "2026-11-03T14:05:00.000Z");
    expect(calls).toContain(VXSE53);
    expect(count("jma_quakes")).toBe(3);
  });

  it("フィードが取れない・読めないときは状態に失敗を残す（前に取れた時刻は残す）", async () => {
    const db = d1FromSqlite(sqlite!);
    await fetchJma(db, fixtureFetcher(SAMPLE_DIR), NOW);
    const down = (u: string) => (u === JMA_FEED_URLS.extra ? new Response("", { status: 503 }) : u === JMA_FEED_URLS.eqvol ? new Response("<feed>", { status: 200 }) : null);
    const later = "2026-11-03T14:05:00.000Z";
    const runs = await fetchJma(db, fixtureFetcher(SAMPLE_DIR, { override: down }), later);
    expect(runs.map((r) => r.status)).toEqual(["error", "error"]);
    const state = rows<{ feed: string; ok: number; ok_at: string; fetched_at: string; note: string }>("SELECT feed, ok, ok_at, fetched_at, note FROM jma_fetch_state ORDER BY feed");
    expect(state.map((s) => [s.feed, s.ok, s.ok_at, s.fetched_at])).toEqual([
      ["eqvol", 0, NOW, later],
      ["extra", 0, NOW, later],
    ]);
    expect(state[0].note).toMatch(/^フィードが読めない/);
    expect(state[1].note).toBe("HTTP 503");
  });

  it("投げる fetch（時間切れなど）も失敗として残す", async () => {
    const runs = await fetchJma(d1FromSqlite(sqlite!), async () => {
      throw new Error("timed out");
    }, NOW);
    expect(runs.map((r) => [r.status, r.note])).toEqual([
      ["error", "Error: timed out"],
      ["error", "Error: timed out"],
    ]);
  });

  it("訓練・試験の電文は写さない（記録だけ）", async () => {
    const drill = (u: string) => (u === VPWW55 ? new Response(data(VPWW55).replace("<Status>通常</Status>", "<Status>訓練</Status>"), { status: 200 }) : null);
    await fetchJma(d1FromSqlite(sqlite!), fixtureFetcher(SAMPLE_DIR, { override: drill }), NOW);
    expect(rows<{ note: string }>(`SELECT note FROM jma_entries WHERE id = '${VPWW55}'`)[0].note).toBe("訓練の電文");
    expect(count("jma_warnings")).toBe(6);
    expect(rows<{ n: number }>("SELECT count(*) AS n FROM jma_warnings WHERE type_code = 'VPWW55'")[0].n).toBe(0);
  });

  it("1 回の電文の上限を 2 つのフィードで分ける（地震が先）", async () => {
    const entry = (i: number): FeedEntry => ({
      id: `${DATA}2026110312${String(i).padStart(4, "0")}_0_VXSE53_010000.xml`,
      title: "震源・震度に関する情報",
      updated: `2026-11-03T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
      url: `${DATA}2026110312${String(i).padStart(4, "0")}_0_VXSE53_010000.xml`,
      typeCode: "VXSE53",
    });
    const many = Array.from({ length: MAX_ENTRIES_PER_RUN + 5 }, (_, i) => entry(i));
    const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${many
      .map((e) => `<entry><id>${e.id}</id><title>${e.title}</title><updated>${e.updated}</updated><link type="application/xml" href="${e.url}"/></entry>`)
      .join("")}</feed>`;
    const override = (u: string) =>
      u === JMA_FEED_URLS.eqvol ? new Response(feed, { status: 200 }) : u.includes("VXSE53") ? new Response(data(VXSE53), { status: 200 }) : null;
    const calls: string[] = [];
    const runs = await fetchJma(d1FromSqlite(sqlite!), fixtureFetcher(SAMPLE_DIR, { override, calls }), NOW);
    expect(runs[0]).toMatchObject({ stored: MAX_ENTRIES_PER_RUN, deferred: 5 });
    // 警報は上限を使い切ったので次の回に（フィードは取る）
    expect(runs[1]).toMatchObject({ stored: 0, deferred: 4 });
    expect(calls.filter((u) => u.startsWith(DATA))).toHaveLength(MAX_ENTRIES_PER_RUN);
  });

  it("7 日より古い電文と子の行は取るたびに消える", async () => {
    const db = d1FromSqlite(sqlite!);
    await fetchJma(db, fixtureFetcher(SAMPLE_DIR), NOW);
    expect(count("jma_entries")).toBe(7);
    const later = new Date(Date.parse("2026-11-03T13:00:00.000Z") + RETAIN_DAYS * 86_400_000 + 60_000).toISOString();
    await fetchJma(db, async () => new Response(null, { status: 304 }), later);
    // 地震（12:49〜12:52）と警報（12:55〜13:00）は 7 日と 1 分前より古い
    expect([count("jma_entries"), count("jma_warnings"), count("jma_quakes"), count("jma_quake_points")]).toEqual([0, 0, 0, 0]);
  });

  it("取消の地震は記録に残し（取消の印）、取消の警報は写さない", () => {
    const e = (url: string): FeedEntry => ({ id: url, title: "", updated: "2026-11-03T13:00:00.000Z", url, typeCode: typeCodeOf(url) });
    const quake = toStored("eqvol", e(VXSE53), data(VXSE53).replace("<InfoType>発表</InfoType>", "<InfoType>取消</InfoType>"), NOW, ["松山市"]);
    expect(quake.quake?.info_type).toBe("取消");
    const warn = toStored("extra", e(VPWW54), data(VPWW54).replace("<InfoType>発表</InfoType>", "<InfoType>取消</InfoType>"), NOW, ["松山市"]);
    expect(warn).toMatchObject({ warnings: [], entry: { note: "取消" } });
  });
});

// 作者が tools/jma/fetch-fixtures.mjs で本物を取ったときだけ走る（無ければ飛ばす）。本物の電文の形がこの読み方で読めるか
describe.runIf(existsSync(new URL("./extra.xml", REAL_DIR)))("本物の写し（lib/jma/fixtures/real）", () => {
  it("フィードが読め、置いた電文が全部読める（警報は市町村の行が 1 つ以上、地震は識別と時刻）", () => {
    for (const feed of ["extra", "eqvol"] as const) {
      const entries = parseFeed(fixtureText(REAL_DIR, `${feed}.xml`) ?? "");
      expect(entries.length, feed).toBeGreaterThan(0);
    }
    const files = readdirSync(new URL("./data/", REAL_DIR));
    expect(files.length).toBeGreaterThan(0);
    const failed: string[] = [];
    for (const name of files) {
      const xml = fixtureText(REAL_DIR, `data/${name}`) ?? "";
      const code = typeCodeOf(name) ?? "";
      try {
        if (isWarningCode(code)) expect(parseWarning(xml).items.length).toBeGreaterThan(0);
        else if (isQuakeCode(code)) expect(parseQuake(xml).eventId).not.toBe("");
      } catch (e) {
        failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(failed).toEqual([]);
  });
});

describe("cron", () => {
  it("wrangler.jsonc の triggers に 5 分ごとと毎日 4 時が並ぶ", () => {
    const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const crons = text.match(/"crons":\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(crons).toContain(`"${JMA_FETCH_CRON}"`);
    expect(crons).toContain(`"${DAILY_RESET_CRON}"`);
    expect(JMA_FETCH_CRON).toBe("*/5 * * * *");
    const worker = readFileSync(new URL("../../worker.ts", import.meta.url), "utf8");
    expect(worker).toContain("scheduledJmaFetch(env, controller.cron, controller.scheduledTime)");
  });

  it("5 分ごとの物だけ取る。毎日 4 時の cron では何もしない（fetch を呼ばない）", async () => {
    const env = { DB: d1FromSqlite(sqlite!) };
    const calls: string[] = [];
    const fetcher = fixtureFetcher(SAMPLE_DIR, { calls });
    expect(await scheduledJmaFetch(env, DAILY_RESET_CRON, Date.parse(NOW), fetcher)).toBeNull();
    expect(calls).toEqual([]);
    const runs = await scheduledJmaFetch(env, JMA_FETCH_CRON, Date.parse(NOW), fetcher);
    expect(runs?.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(rows<{ fetched_at: string }>("SELECT DISTINCT fetched_at FROM jma_entries")).toEqual([{ fetched_at: NOW }]);
  });
});
