// 雨雲（降水ナウキャスト）を旗の下で加工せず重ねる（docs/tasks/T72.md の 4）のテスト。気象庁には繋がない（偽の fetch と偽の Cache）。
// - 旗 off（既定）: route は何も取らずに 404、地図に雨雲の層を出さない
// - 時刻は一番新しい実況の 1 つだけ（予報の時刻・補間にしない）
// - タイルの route の守り: ズーム 5〜10、x・y の範囲、時刻は一覧にある物だけ（それ以外は 404）、ログインしていなければ 401
// - Cache の鍵は気象庁の URL、写しがあれば取りに行かない（時刻 2 分・タイル 5 分）

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { NowcastLayer } from "../../components/map/NowcastLayer.tsx";
import { BASE_SIZE, project } from "../map/geo.ts";
import { NOWCAST_LAYER } from "../map/layers.ts";
import { fixtureFetcher, fixtureText, SAMPLE_DIR } from "./fixture-fetch.ts";
import {
  latestTime,
  NOWC_SOURCE,
  NOWC_TILE_TTL,
  NOWC_TIMES_TTL,
  NOWC_TIMES_URL,
  nowcastOn,
  nowcTileUpstream,
  parseTimes,
  stampHm,
  tileParams,
  tileResponse,
  timesResponse,
  type CacheLike,
  type NowcContext,
} from "./nowcast.ts";

const TIMES = JSON.parse(fixtureText(SAMPLE_DIR, "targetTimes_N1.json") ?? "[]") as unknown;
const LATEST = { basetime: "20261103131000", validtime: "20261103131000" };

/** 偽の Cache（鍵は URL） */
function fakeCache() {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const cache: CacheLike = {
    match: async (r) => store.get(r.url)?.clone(),
    put: async (r, res) => {
      puts.push(r.url);
      store.set(r.url, res);
    },
  };
  return { cache, store, puts };
}

/** 気象庁の代わり（時刻の一覧は fixtures、タイルは 1 バイトの PNG もどき） */
function fakeJma(calls: string[]) {
  const base = fixtureFetcher(SAMPLE_DIR, { calls });
  return async (url: string, init?: RequestInit) =>
    url.endsWith(".png") ? (calls.push(url), new Response(new Uint8Array([137]), { status: 200 })) : base(url, init);
}

const ctx = (over: Partial<NowcContext> = {}, calls: string[] = []): NowcContext => ({
  on: true,
  authed: true,
  fetcher: fakeJma(calls),
  cache: null,
  ...over,
});

const tile = (over: Record<string, string> = {}) => ({ ...LATEST, z: "8", x: "222", y: "100", ...over });

describe("旗", () => {
  it("JMA_NOWCAST が \"on\" のときだけ。既定（無い・空・ほかの値）は off", () => {
    expect(nowcastOn({ JMA_NOWCAST: "on" })).toBe(true);
    for (const v of [undefined, "", "ON", "true", "1"]) expect(nowcastOn({ JMA_NOWCAST: v })).toBe(false);
    expect(nowcastOn(null)).toBe(false);
  });

  it("旗が off なら route は何も取らずに 404（ログインしていても）", async () => {
    const calls: string[] = [];
    expect((await timesResponse(ctx({ on: false }, calls))).status).toBe(404);
    expect((await tileResponse(tile(), ctx({ on: false }, calls))).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("旗は wrangler.jsonc の vars に書かない（ダッシュボードで入れる）。手元は .dev.vars.example に空の 1 行", () => {
    expect(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")).not.toContain("JMA_NOWCAST");
    expect(readFileSync(new URL("../../.dev.vars.example", import.meta.url), "utf8")).toMatch(/^JMA_NOWCAST=$/m);
  });

  it("route は旗を先に見る（off ならログインも見ない）", () => {
    for (const p of ["../../app/api/jma/nowc/times/route.ts", "../../app/api/jma/nowc/tile/[basetime]/[validtime]/[z]/[x]/[y]/route.ts"]) {
      const src = readFileSync(new URL(p, import.meta.url), "utf8");
      expect(src.indexOf("nowcastOn(env)")).toBeGreaterThan(0);
      expect(src.indexOf("nowcastOn(env)")).toBeLessThan(src.indexOf("principalFromRequest(request)"));
    }
  });
});

describe("時刻", () => {
  it("一覧から一番新しい実況（basetime と validtime が同じ物）の 1 つだけ。予報の時刻は使わない", () => {
    const times = parseTimes(TIMES);
    expect(times).toHaveLength(3);
    expect(latestTime(times)).toEqual(LATEST);
    expect(latestTime([{ basetime: "20261103131000", validtime: "20261103132000" }])).toBeNull();
    expect(parseTimes({ not: "array" })).toEqual([]);
    expect(parseTimes([{ basetime: "x", validtime: "y" }, { basetime: "20261103131000", validtime: "20261103131000", elements: ["other"] }])).toEqual([]);
    expect(stampHm("20261103131000")).toBe("22:10");
  });

  it("GET times: ログインしていなければ 401、していれば { basetime, validtime } の 1 つ", async () => {
    expect((await timesResponse(ctx({ authed: false }))).status).toBe(401);
    const res = await timesResponse(ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(LATEST);
  });

  it("時刻の一覧が取れなければ 503", async () => {
    expect((await timesResponse(ctx({ fetcher: async () => new Response("", { status: 500 }) }))).status).toBe(503);
    expect((await timesResponse(ctx({ fetcher: async () => new Response("<html>", { status: 200 }) }))).status).toBe(503);
  });
});

describe("タイルの route の守り", () => {
  it("ズーム 5〜10・x と y はその段の範囲の整数・時刻は 14 桁。それ以外は null", () => {
    expect(tileParams(tile())).toEqual({ ...LATEST, z: 8, x: 222, y: 100 });
    for (const bad of [
      tile({ z: "4" }),
      tile({ z: "11" }),
      tile({ z: "8", x: "256" }),
      tile({ y: "-1" }),
      tile({ x: "1.5" }),
      tile({ basetime: "2026110313100" }),
      tile({ validtime: "../../x" }),
      { ...tile(), z: undefined },
    ]) {
      expect(tileParams(bad)).toBeNull();
    }
  });

  it("範囲外・一覧に無い時刻は 404（気象庁のタイルを取りに行かない）。ログインしていなければ 401", async () => {
    const calls: string[] = [];
    expect((await tileResponse(tile({ z: "12" }), ctx({}, calls))).status).toBe(404);
    expect((await tileResponse(tile({ basetime: "20261103120000", validtime: "20261103120000" }), ctx({}, calls))).status).toBe(404);
    expect(calls.some((u) => u.endsWith(".png"))).toBe(false);
    expect((await tileResponse(tile(), ctx({ authed: false }))).status).toBe(401);
  });

  it("一覧にある時刻なら気象庁のタイルをそのまま PNG で返す（URL の形は実況の none）", async () => {
    const calls: string[] = [];
    const res = await tileResponse(tile(), ctx({}, calls));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137]));
    const url = nowcTileUpstream(LATEST, 8, 222, 100);
    expect(url).toBe("https://www.jma.go.jp/bosai/jmatile/data/nowc/20261103131000/none/20261103131000/surf/hrpns/8/222/100.png");
    expect(calls).toContain(url);
  });

  it("Cache の鍵は気象庁の URL。写しがあれば取りに行かない（時刻 2 分・タイル 5 分）", async () => {
    const { cache, puts, store } = fakeCache();
    const calls: string[] = [];
    await tileResponse(tile(), ctx({ cache }, calls));
    const url = nowcTileUpstream(LATEST, 8, 222, 100);
    expect(puts).toEqual([NOWC_TIMES_URL, url]);
    expect(store.get(NOWC_TIMES_URL)?.headers.get("Cache-Control")).toBe(`public, max-age=${NOWC_TIMES_TTL}`);
    expect(store.get(url)?.headers.get("Cache-Control")).toBe(`public, max-age=${NOWC_TILE_TTL}`);
    const again: string[] = [];
    expect((await tileResponse(tile(), ctx({ cache }, again))).status).toBe(200);
    expect((await timesResponse(ctx({ cache }, again))).status).toBe(200);
    expect(again).toEqual([]);
  });
});

describe("地図に重ねる", () => {
  const view = { z: 12, center: project({ lat: 33.84, lng: 132.765 }, 12) };

  it("タイルは Workers の route から（気象庁を直接読まない）。段は 10 まで、不透明度を付けない。右下に凡例・時刻・出典", () => {
    const html = renderToStaticMarkup(createElement(NowcastLayer, { time: LATEST, view, size: BASE_SIZE }));
    const srcs = [...html.matchAll(/<img src="([^"]+)"[^>]*data-layer="nowcast"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((s) => s.startsWith(`/api/jma/nowc/tile/${LATEST.basetime}/${LATEST.validtime}/10/`))).toBe(true);
    expect(html).not.toMatch(/data-layer="nowcast"[^>]*opacity|opacity[^>]*data-layer="nowcast"/);
    expect(html).toContain("22:10 時点");
    expect(html).toContain(NOWC_SOURCE.text);
    expect(NOWC_SOURCE.text).toBe("雨雲：気象庁ホームページ（https://www.jma.go.jp/bosai/nowc/）／背景：地理院タイル");
    expect(NOWCAST_LAYER.attribution.href).toBe(NOWC_SOURCE.href);
  });

  it("旗 off（既定）・デモ事業所では地図に雨雲の層も切替も出さない", () => {
    const html = renderToStaticMarkup(createElement(CaseMap, { pins: [], layers: [], demo: null, unplaced: 0 }));
    expect(html).not.toContain('data-layer="nowcast"');
    expect(html).not.toContain('data-toggle="rain"');
    // 時刻が届くまで（サーバーの描画では読まない）は旗が on でも何も出さない
    const on = renderToStaticMarkup(createElement(CaseMap, { pins: [], layers: [], demo: null, unplaced: 0, nowcast: true }));
    expect(on).not.toContain('data-layer="nowcast"');
  });

  it("担当一覧はデモでない事業所で旗が on のときだけ雨雲を渡す", () => {
    const src = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
    expect(src).toContain('nowcast: nowcastOn(env) && principal.office.kind !== "demo"');
  });
});
