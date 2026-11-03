// 事業所の画面の気象庁の欄（docs/tasks/T72.md の 2）のテスト。D1 は node:sqlite、気象庁は fixtures の作った見本（本物には繋がない）。
// - 今の状態（市町村と電文の種類ごとに一番新しい発表、解除と発表なしは出さない、新しい体系があればそれだけ）
// - 市の突き合わせ（事業所の市・利用者の市・違う市）と該当の人数（一覧から外した人は数えない）
// - 地震（直近 24 時間・市の観測点がある物・取消は出さない）
// - 取得の状態（失敗・古い・一度も無い → 未取得）
// - 画面: 名前・市町村・発表時刻のまま、平時で警報があるときだけ「切替」（自動では切り替えない）、安否の色を使わない、出典

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JmaAlertsView } from "../../components/office/JmaAlertsView.tsx";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { currentWarnings, EMPTY_ALERTS, fetchStatus, loadJmaAlerts, quakeLines, STALE_MINUTES, type JmaAlertsData } from "./alerts.ts";
import { fixtureFetcher, SAMPLE_DIR } from "./fixture-fetch.ts";
import { fetchJma } from "./run.ts";

const NOW = "2026-11-03T14:00:00.000Z";
const OFFICE = "office-demo";

let sqlite: DatabaseSync | undefined;
const db = () => d1FromSqlite(sqlite!);

beforeEach(async () => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  // デモ事業所の 10 人のうち 2 人を東温市・1 人を市なしに（種は全員松山市）
  sqlite.exec(`UPDATE people SET ledger = json_set(ledger, '$.basic.address.city', '東温市') WHERE id IN ('p-02', 'p-03')`);
  sqlite.exec(`UPDATE people SET ledger = json_remove(ledger, '$.basic.address') WHERE id = 'p-04'`);
  await fetchJma(db(), fixtureFetcher(SAMPLE_DIR), NOW);
});
afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

describe("事業所の気象庁の欄（読む）", () => {
  it("事業所と利用者の市の今の警報・注意報を、名前・市町村・状態・発表時刻・発表官署のまま。新しい体系があればそれだけ", async () => {
    const a = await loadJmaAlerts(db(), OFFICE, NOW);
    expect(a.rows.map((r) => [r.kind, r.areaName, r.status, r.issuedAt, r.officeName, r.typeCode, r.people, r.warning])).toEqual([
      ["レベル3大雨警報", "松山市", "発表", "2026-11-03T13:00:00.000Z", "松山地方気象台", "VPWW55", 7, true],
      ["雷注意報", "松山市", "継続", "2026-11-03T13:00:00.000Z", "松山地方気象台", "VPWW55", 7, false],
      ["大雨注意報", "東温市", "継続", "2026-11-03T13:00:00.000Z", "松山地方気象台", "VPWW55", 2, false],
    ]);
    expect(a.noCity).toBe(1);
    expect(a.fetch).toEqual({ ok: true, at: NOW });
  });

  it("一覧から外した人は数えない", async () => {
    sqlite!.exec(`UPDATE people SET unlisted_at = '${NOW}' WHERE id = 'p-03'`);
    const a = await loadJmaAlerts(db(), OFFICE, NOW);
    expect(a.rows.find((r) => r.areaName === "東温市")?.people).toBe(1);
  });

  it("協力事業所（利用者なし・市は松山市）は松山市の行だけ。該当 0 人", async () => {
    const a = await loadJmaAlerts(db(), "office-partner", NOW);
    expect(a.rows.map((r) => `${r.kind} ${r.areaName} ${r.people}`)).toEqual(["レベル3大雨警報 松山市 0", "雷注意報 松山市 0"]);
  });

  it("新しい発表で解除・発表なしになれば出さない（前の発表の行は残っても今の状態にしない）", async () => {
    const later = "2026-11-03T15:00:00.000Z";
    const entry = (id: string, code: string) =>
      sqlite!.exec(
        `INSERT INTO jma_entries (id, feed, type_code, title, updated_at, fetched_at) VALUES ('${id}', 'extra', '${code}', '', '${later}', '${later}')`,
      );
    const row = (id: string, code: string, area: string, areaCode: string, kind: string, status: string) =>
      sqlite!.exec(
        `INSERT INTO jma_warnings (entry_id, type_code, area_code, area_name, kind, status, issued_at, office_name, sort)
         VALUES ('${id}', '${code}', '${areaCode}', '${area}', '${kind}', '${status}', '${later}', '松山地方気象台', 0)`,
      );
    entry("e-new", "VPWW55");
    row("e-new", "VPWW55", "松山市", "3820100", "", "発表警報・注意報はなし");
    row("e-new", "VPWW55", "東温市", "3821500", "大雨注意報", "解除");
    const a = await loadJmaAlerts(db(), OFFICE, later);
    expect(a.rows).toEqual([]);
    expect(await sqlite!.prepare("SELECT count(*) AS n FROM jma_warnings WHERE type_code = 'VPWW55'").get()).toEqual({ n: 5 });
  });

  it("新しい体系の電文が無い市町村は VPWW54、それも無ければ VPWW53 で", () => {
    const w = (type_code: string, kind: string) => ({
      entry_id: `e-${type_code}`,
      type_code,
      area_code: "3820100",
      area_name: "松山市",
      kind,
      status: "発表",
      issued_at: "2026-11-03T13:00:00.000Z",
      office_name: "松山地方気象台",
      sort: 0,
      entry_updated: "2026-11-03T13:00:00.000Z",
    });
    expect(currentWarnings([w("VPWW53", "大雨警報"), w("VPWW54", "大雨警報")], ["松山市"]).map((r) => r.type_code)).toEqual(["VPWW54"]);
    expect(currentWarnings([w("VPWW53", "大雨警報")], ["松山市"]).map((r) => r.type_code)).toEqual(["VPWW53"]);
    expect(currentWarnings([w("VPWW53", "大雨警報"), w("VPWW55", "レベル3大雨警報")], ["松山市"]).map((r) => r.kind)).toEqual(["レベル3大雨警報"]);
    // 違う市は出さない
    expect(currentWarnings([w("VPWW55", "レベル3大雨警報")], ["東温市"])).toEqual([]);
  });

  it("区のある市: 「広島市」の事業所に「広島市中区」「広島市南区」の行（市の名前の前方一致）。府中市など違う市は出さない", async () => {
    sqlite!.exec(`UPDATE offices SET city = '広島市' WHERE id = 'office-partner'`);
    // 写すのは写す市に当たる行だけなので、市を変えたあとに写し直す
    sqlite!.exec("DELETE FROM jma_warnings; DELETE FROM jma_quake_points; DELETE FROM jma_quakes; DELETE FROM jma_entries;");
    await fetchJma(db(), fixtureFetcher(SAMPLE_DIR), NOW);
    const a = await loadJmaAlerts(db(), "office-partner", NOW);
    expect(a.rows.map((r) => `${r.kind} ${r.areaName}`)).toEqual(["強風注意報 広島市中区", "強風注意報 広島市南区"]);
    // 地震の電文の区は「広島中区」の形なので当てない（読み替えない）
    expect(a.quakes).toEqual([]);
  });

  it("地震: 直近 24 時間で市の観測点の震度がある物。市ごとに一番強い観測点の名前を添える", async () => {
    const a = await loadJmaAlerts(db(), OFFICE, NOW);
    expect(a.quakes).toEqual([
      {
        eventId: "20261103214800",
        at: "2026-11-03T12:48:00.000Z",
        hypocenter: "伊予灘",
        magnitude: "4.6",
        cities: [
          { city: "松山市", intensity: "4", point: "松山市北持田町＊" },
          { city: "東温市", intensity: "3", point: "東温市見奈良＊" },
        ],
      },
    ]);
    // 24 時間を過ぎたら出さない
    expect((await loadJmaAlerts(db(), OFFICE, "2026-11-04T12:49:00.000Z")).quakes).toEqual([]);
  });

  it("地震: 取消の続報が来たら出さない", async () => {
    const q = (await sqlite!.prepare("SELECT * FROM jma_quakes").all()) as never[];
    const p = (await sqlite!.prepare("SELECT * FROM jma_quake_points").all()) as never[];
    const cancel = {
      entry_id: "e-cancel",
      type_code: "VXSE53",
      event_id: "20261103214800",
      info_type: "取消",
      report_at: "2026-11-03T13:30:00.000Z",
      origin_at: null,
      hypocenter: null,
      magnitude: null,
      max_intensity: null,
    };
    expect(quakeLines(q, p, ["松山市"], NOW)).toHaveLength(1);
    expect(quakeLines([...q, cancel], p, ["松山市"], NOW)).toEqual([]);
  });

  it("取得の状態: 2 つとも取れて 20 分以内なら取得（古い方の時刻）。失敗・古い・一度も無いは未取得", () => {
    const at = (min: number) => new Date(Date.parse(NOW) - min * 60_000).toISOString();
    const s = (feed: "extra" | "eqvol", ok: 0 | 1, okAt: string | null) => ({ feed, ok, ok_at: okAt });
    expect(fetchStatus([s("extra", 1, at(1)), s("eqvol", 1, at(3))], NOW)).toEqual({ ok: true, at: at(3) });
    expect(fetchStatus([s("extra", 0, at(10)), s("eqvol", 1, at(3))], NOW)).toEqual({ ok: false, at: at(10) });
    expect(fetchStatus([s("extra", 1, at(STALE_MINUTES + 1)), s("eqvol", 1, at(1))], NOW).ok).toBe(false);
    expect(fetchStatus([s("eqvol", 1, at(1))], NOW)).toEqual({ ok: false, at: at(1) });
    expect(fetchStatus([], NOW)).toEqual({ ok: false, at: null });
  });

  it("表が空（cron がまだ）なら発表なしで未取得", async () => {
    sqlite!.exec("DELETE FROM jma_fetch_state; DELETE FROM jma_warnings; DELETE FROM jma_quake_points; DELETE FROM jma_quakes; DELETE FROM jma_entries;");
    const a = await loadJmaAlerts(db(), OFFICE, NOW);
    expect(a).toEqual({ ...EMPTY_ALERTS, noCity: 1 });
  });
});

describe("事業所の気象庁の欄（画面）", () => {
  const render = (data: JmaAlertsData, disaster = false) =>
    renderToStaticMarkup(createElement(JmaAlertsView, { data, disaster, switchHref: "#mode-buttons" }));

  it("名前・市町村・状態・発表時刻・発表官署・該当の人数をそのまま。出典の 1 行", async () => {
    const html = render(await loadJmaAlerts(db(), OFFICE, NOW));
    expect(html).toContain("レベル3大雨警報");
    expect(html).toContain("松山市");
    expect(html).toContain("11/3 22:00 松山地方気象台");
    expect(html).toMatch(/該当 <span[^>]*>7<\/span> 人/);
    expect(html).toContain("23:00 取得");
    expect(html).toContain("出典：気象庁ホームページ（");
    expect(html).toContain('href="https://www.jma.go.jp/bosai/warning/"');
    expect(html).toContain("）、気象庁防災情報XML");
    // 地震は観測点の名前を添える
    expect(html).toContain("伊予灘");
    expect(html).toContain("M4.6");
    expect(html).toContain("松山市 震度4<span");
    expect(html).toContain("（松山市北持田町＊）");
    expect(html).toContain("市未入力 1 人");
  });

  it("平時で警報（注意報でない物）があるときだけ「切替」を赤で。押すと同じ画面の切替のボタンへ送るだけ", async () => {
    const data = await loadJmaAlerts(db(), OFFICE, NOW);
    const calm = render(data, false);
    expect(calm).toMatch(/<a href="#mode-buttons"[^>]*class="[^"]*text-danger[^"]*"[^>]*data-jma-switch[^>]*>切替<\/a>/);
    // 災害モードでは出さない
    expect(render(data, true)).not.toContain("data-jma-switch");
    // 注意報だけでも出さない
    expect(render({ ...data, rows: data.rows.filter((r) => !r.warning) }, false)).not.toContain("data-jma-switch");
  });

  it("安否の 4 色・医療の言葉を使わない。押せる物は焦点の枠を持つ", async () => {
    const html = render(await loadJmaAlerts(db(), OFFICE, NOW));
    expect(html).not.toMatch(/state-(ok|urgent|check|unknown)|tone-check/);
    for (const w of ["診断", "判定", "重症", "緊急度", "危険度"]) expect(html).not.toContain(w);
    for (const a of html.match(/<a [^>]*>/g) ?? []) expect(a).toContain("focus-visible:outline-solid");
  });

  it("取れていなければ「未取得」と最後に取れた時刻、発表が無ければ「発表なし」", () => {
    const html = render({ ...EMPTY_ALERTS, fetch: { ok: false, at: "2026-11-03T12:00:00.000Z" } });
    expect(html).toContain("未取得 11/3 21:00");
    expect(html).toContain("警報・注意報 発表なし");
    expect(render(EMPTY_ALERTS)).toContain("未取得 —");
  });
});
