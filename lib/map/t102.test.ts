// T102 のテスト: 避難経路の地図（openrouteservice の経路、手で引く線、避難先の位置と経路地図の保存、紙の欄に入れる地図の画像）。
// 本物の openrouteservice は呼ばない（偽の fetch だけ）。保存は node:sqlite の D1 で往復する。
import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { RouteEditor, RouteMapPanel } from "../../components/map/RouteMap.tsx";
import { RouteSceneSvg } from "../../components/map/RouteSceneSvg.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { parseLedger } from "../db/ledger.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { GeoPoint, Ledger, RouteMap } from "../db/types.ts";
import { changeText } from "../intake/changes.ts";
import type { EditData } from "../intake/edit.ts";
import { intakePropsOf } from "../intake/props.ts";
import { saveIntake, SaveRequestSchema } from "../intake/save.ts";
import { loadPersonPage, type PersonPageRows } from "../person.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { project } from "./geo.ts";
import { fetchRoute, lineLength, modeOf, ORS_ATTRIBUTION, orsRequest, parseOrs, ROUTE_MAX_KM, simplifyLine, withinReach } from "./route.ts";
import { evacRoute, evacRouteResponse } from "./route-api.ts";
import {
  currentRoute,
  evacMapValue,
  fitRoute,
  panRoute,
  pickPoint,
  pointInFrame,
  routeChange,
  routeDraft,
  routeSummary,
  zoomRoute,
  ROUTE_VIA_MAX,
} from "./route-edit.ts";
import { GSI_ROUTE_CREDIT, ROUTE_FRAME, routeMapSvg, routeScene, routeSceneOf, sceneSvg } from "./route-image.ts";

const NOW = new Date("2026-11-04T13:00:00.000Z");
const KEY = "test-ors-key-0000";
const PID = "p-01";

/** デモ事業所の山本（種の人を開くケアマネ） */
const yamamoto: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});

async function rowsOf(id = PID): Promise<PersonPageRows> {
  return (await loadPersonPage(db, yamamoto, id))!;
}
async function editData(id = PID): Promise<EditData> {
  return intakePropsOf(await rowsOf(id), false).edit;
}
const ledgerOf = async (id = PID) => parseLedger((await rowsOf(id)).person.ledger);

/** 家（p-01 の種の位置）と、家から南東に約 1 km の避難先 */
const HOME: GeoPoint = { lat: 33.812, lng: 132.7487 };
const DEST: GeoPoint = { lat: 33.805, lng: 132.756 };

/** 偽の openrouteservice の返事（GeoJSON。座標は [経度, 緯度]） */
function orsGeoJson(coords: Array<[number, number]>, summary = { distance: 1234.5, duration: 987.6 }) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { summary } }],
  };
}

/** 呼ばれた要求を覚える偽の fetch */
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const ROAD: Array<[number, number]> = [
  [132.7488, 33.8121],
  [132.7495, 33.8115],
  [132.7502, 33.8108],
  [132.751, 33.8101],
  [132.7525, 33.8085],
  [132.754, 33.807],
  [132.7559, 33.8051],
];

describe("openrouteservice に送る物（T102 の 2）", () => {
  it("送るのは家と避難先の 2 点の座標（経度・緯度の順）と手段（URL の profile）だけ。鍵は見出し", () => {
    const { url, init } = orsRequest(HOME, DEST, "foot", KEY);
    expect(url).toBe("https://api.openrouteservice.org/v2/directions/foot-walking/geojson");
    expect(orsRequest(HOME, DEST, "car", KEY).url).toBe("https://api.openrouteservice.org/v2/directions/driving-car/geojson");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      coordinates: [
        [HOME.lng, HOME.lat],
        [DEST.lng, DEST.lat],
      ],
      instructions: false,
    });
    expect(init.headers).toEqual({ Authorization: KEY, "Content-Type": "application/json", Accept: "application/geo+json, application/json" });
  });

  it("サーバーの入口: 家は台帳から読み、外へ出る URL・見出し・本文に氏名・カナ・町名・避難先の名前・連絡先が入らない", async () => {
    const rows = await rowsOf();
    const ledger = parseLedger(rows.person.ledger);
    const { f, calls } = fakeFetch(200, orsGeoJson(ROAD));
    const r = await evacRoute(db, yamamoto, { personId: PID, to: DEST, mode: modeOf(ledger.evacuation.transport) }, KEY, f);
    expect(r).toMatchObject({ ok: true, distanceM: 1235, durationS: 988 });
    expect(calls).toHaveLength(1);
    const sent = calls[0].url + JSON.stringify(calls[0].init.headers) + String(calls[0].init.body);
    // 種の人の文字（氏名・カナ・町名・避難先・手段・連絡先の名前と電話）
    const words = [
      rows.person.name,
      rows.person.kana,
      ...rows.person.name.split(" "),
      ledger.basic.address?.town,
      ledger.basic.address?.city,
      ledger.evacuation.destination1,
      ledger.evacuation.transport,
      ...rows.contacts.flatMap((c) => [c.name, c.phone, c.relation]),
    ].filter((w): w is string => typeof w === "string" && w.trim() !== "");
    expect(words.length).toBeGreaterThan(5);
    for (const w of words) expect(sent).not.toContain(w);
    expect(sent).not.toContain(PID);
    // 種の「娘の車」は車
    expect(calls[0].url).toContain("/driving-car/");
    // 本文は座標と instructions だけ。家は台帳の位置
    expect(Object.keys(JSON.parse(String(calls[0].init.body)))).toEqual(["coordinates", "instructions"]);
    expect(JSON.parse(String(calls[0].init.body)).coordinates[0]).toEqual([ledger.basic.location!.lng, ledger.basic.location!.lat]);
  });

  it("返事の [経度, 緯度] を { lat, lng } に戻し、長さと時間は返事の要約から", () => {
    const r = parseOrs(200, orsGeoJson(ROAD));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line[0]).toEqual({ lat: 33.8121, lng: 132.7488 });
    expect(r.line.at(-1)).toEqual({ lat: 33.8051, lng: 132.7559 });
    expect(r.distanceM).toBe(1235);
    expect(r.durationS).toBe(988);
  });

  it("鍵が無ければ外へ要求しない。失敗は投げずに理由の印（上限・経路なし・失敗・時間切れ・形の違い）", async () => {
    const none = fakeFetch(200, orsGeoJson(ROAD));
    expect(await fetchRoute({ key: undefined, from: HOME, to: DEST, mode: "foot", fetch: none.f })).toEqual({ ok: false, error: "no_key" });
    expect(await fetchRoute({ key: "  ", from: HOME, to: DEST, mode: "foot", fetch: none.f })).toEqual({ ok: false, error: "no_key" });
    expect(none.calls).toHaveLength(0);
    const run = (status: number, body: unknown) => fetchRoute({ key: KEY, from: HOME, to: DEST, mode: "foot", fetch: fakeFetch(status, body).f });
    expect(await run(429, { error: "Rate limit exceeded" })).toEqual({ ok: false, error: "limit" });
    expect(await run(403, { error: "Quota exceeded" })).toEqual({ ok: false, error: "limit" });
    expect(await run(404, { error: { code: 2010, message: "Could not find routable point" } })).toEqual({ ok: false, error: "no_route" });
    expect(await run(404, { error: { code: 2009, message: "Route could not be found" } })).toEqual({ ok: false, error: "no_route" });
    expect(await run(500, { error: { code: 2099, message: "Unknown" } })).toEqual({ ok: false, error: "failed" });
    expect(await run(200, { features: [] })).toEqual({ ok: false, error: "failed" });
    expect(await run(200, "not json")).toEqual({ ok: false, error: "failed" });
    const thrown = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await fetchRoute({ key: KEY, from: HOME, to: DEST, mode: "foot", fetch: thrown })).toEqual({ ok: false, error: "failed" });
  });

  it("応答は理由の印と画面の言葉だけ（外の返事の文・鍵を返さない）。失敗の経路は 200", async () => {
    const res = evacRouteResponse({ ok: false, error: "limit" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "limit", label: "上限到達" });
    expect((await evacRouteResponse({ ok: false, error: "no_key" }).json()).label).toBe("自動不可");
    expect(evacRouteResponse({ ok: false, error: "forbidden" }).status).toBe(403);
    const ok = evacRouteResponse({ ok: true, line: [HOME, DEST], distanceM: 10, durationS: 5 });
    expect(JSON.stringify(await ok.json())).not.toContain(KEY);
  });

  it("サーバーの断り: ケアマネの役だけ・事業所の外の人は該当なし・家の位置が無い・避難先が遠すぎは外へ要求しない", async () => {
    const { f, calls } = fakeFetch(200, orsGeoJson(ROAD));
    expect(await evacRoute(db, { ...yamamoto, role: "medical" }, { personId: PID, to: DEST, mode: "foot" }, KEY, f)).toEqual({ ok: false, error: "forbidden" });
    const other: Principal = { ...yamamoto, office: { id: "office-partner", name: "協力事業所", kind: "regular" }, accountId: "acct-x", caseloadOf: "acct-x" };
    expect(await evacRoute(db, other, { personId: PID, to: DEST, mode: "foot" }, KEY, f)).toEqual({ ok: false, error: "not_found" });
    const far = { lat: HOME.lat + (ROUTE_MAX_KM + 1) / 111, lng: HOME.lng };
    expect(withinReach(HOME, far)).toBe(false);
    expect(await evacRoute(db, yamamoto, { personId: PID, to: far, mode: "foot" }, KEY, f)).toEqual({ ok: false, error: "too_far" });
    // 家の位置を外した人
    const l = await ledgerOf();
    delete l.basic.location;
    sqlite.prepare("UPDATE people SET ledger = ?1 WHERE id = ?2").run(JSON.stringify(l), PID);
    expect(await evacRoute(db, yamamoto, { personId: PID, to: DEST, mode: "foot" }, KEY, f)).toEqual({ ok: false, error: "no_home" });
    expect(calls).toHaveLength(0);
  });

  it("手段: 車（娘の車・家族の車）は車、徒歩・車いす・分からないは徒歩", () => {
    expect(modeOf("娘の車")).toBe("car");
    expect(modeOf("家族の車")).toBe("car");
    expect(modeOf("徒歩")).toBe("foot");
    expect(modeOf("車いす")).toBe("foot");
    expect(modeOf("車椅子で家族が押す")).toBe("foot");
    expect(modeOf("訪問看護と夫")).toBe("foot");
    expect(modeOf(undefined)).toBe("foot");
  });

  it("線は間引いて 5 桁に丸め、両端は残す。点の上限を超えれば許す離れを広げる", () => {
    const straight = Array.from({ length: 101 }, (_, i) => ({ lat: 33.8 + i * 0.0001, lng: 132.75 + i * 0.0001 }));
    expect(simplifyLine(straight)).toEqual([straight[0], straight[100]].map((p) => ({ lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 })));
    const zigzag = Array.from({ length: 1000 }, (_, i) => ({ lat: 33.8 + i * 0.0001, lng: 132.75 + (i % 2) * 0.001 }));
    const out = simplifyLine(zigzag, 3, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out[0]).toEqual(zigzag[0]);
    expect(out.at(-1)).toEqual({ lat: 33.8999, lng: 132.751 });
  });
});

describe("避難先の位置と経路地図の保存（T102 の 1・3）", () => {
  it("種の人は経路地図が無く、手段は台帳の「手段」から。避難先の位置を置くと手入力の線（家 → 避難先）", async () => {
    const d0 = routeDraft(await ledgerOf(), HOME);
    expect(d0).toMatchObject({ to: 1, mode: "car", dest: { 1: null, 2: null }, via: [], auto: null, tool: "dest" });
    expect(currentRoute(d0, HOME)).toBeNull();
    const d1 = pickPoint(d0, DEST);
    const r = currentRoute(d1, HOME)!;
    expect(r).toMatchObject({ to: 1, mode: "car", source: "hand", line: [HOME, DEST], via: [] });
    expect(r.distanceM).toBe(Math.round(lineLength([HOME, DEST])));
  });

  it("保存して読み戻す（版が上がり、経過に「避難先1 位置・経路地図」）。同じ値なら送らない", async () => {
    const data = await editData();
    let d = pickPoint(routeDraft(data.ledger, HOME), DEST);
    d = pickPoint({ ...d, tool: "via" }, { lat: 33.809, lng: 132.75 });
    const change = routeChange(data.ledger, d)!;
    expect(change.t).toBe("evacMap");
    expect(changeText(change)).toMatch(/^経路地図 車 \d+ m 手入力$|^経路地図 車 1\.\d km 手入力$/);
    const req = SaveRequestSchema.parse({ personId: PID, version: data.version, ai: null, edit: true, changes: [change] });
    const r = await saveIntake(db, yamamoto, req, NOW);
    expect(r).toMatchObject({ ok: true, version: data.version + 1, fields: expect.arrayContaining(["evacuation.destination1Location", "evacuation.routeMap"]) });
    const l = await ledgerOf();
    expect(l.evacuation.destination1Location).toEqual(DEST);
    expect(l.evacuation.routeMap).toMatchObject({ to: 1, mode: "car", source: "hand", via: [{ lat: 33.809, lng: 132.75 }], line: [HOME, { lat: 33.809, lng: 132.75 }, DEST] });
    expect(l.evacuation.routeMap!.view.z).toBeGreaterThanOrEqual(9);
    const body = sqlite
      .prepare("SELECT body FROM timeline_entries WHERE person_id = ?1 AND body LIKE 'ケアマネが直した%' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(PID) as { body: string };
    expect(body.body).toBe("ケアマネが直した: 避難先1 位置・経路地図");
    // 読み戻した下書きは保存した形。そのままなら送らない
    const back = await editData();
    const d2 = routeDraft(back.ledger, HOME);
    expect(d2).toMatchObject({ to: 1, mode: "car", via: [{ lat: 33.809, lng: 132.75 }], tool: "via" });
    expect(routeChange(back.ledger, d2)).toBeNull();
    // 文字の経路（台帳の route）はそのまま
    expect(l.evacuation.route).toBe((parseLedger((await rowsOf()).person.ledger)).evacuation.route);
  });

  it("openrouteservice の線で保存すると ors。避難先を動かすか経由点を足すと手入力の線に戻る", async () => {
    const data = await editData();
    const line = (parseOrs(200, orsGeoJson(ROAD)) as { ok: true; line: GeoPoint[] }).line;
    const d = { ...pickPoint(routeDraft(data.ledger, HOME), DEST), auto: { to: 1 as const, mode: "car" as const, dest: DEST, line, distanceM: 1235, durationS: 988 } };
    expect(currentRoute(d, HOME)).toMatchObject({ source: "ors", line, distanceM: 1235, durationS: 988 });
    expect(routeSummary(currentRoute(d, HOME)!)).toBe("車 1.2 km 約 16 分 自動");
    const v = evacMapValue(d, HOME);
    const r = await saveIntake(db, yamamoto, SaveRequestSchema.parse({ personId: PID, version: data.version, ai: null, edit: true, changes: [{ t: "evacMap", value: v }] }), NOW);
    expect(r).toMatchObject({ ok: true });
    const saved = (await ledgerOf()).evacuation.routeMap!;
    expect(saved).toMatchObject({ source: "ors", via: [], durationS: 988 });
    // 読み戻すと ors の線のまま
    const back = routeDraft(await ledgerOf(), HOME);
    expect(currentRoute(back, HOME)?.source).toBe("ors");
    // 避難先を動かす・経由点・手段を変えると手入力
    expect(currentRoute({ ...back, tool: "dest", ...pickPoint({ ...back, tool: "dest" }, { lat: 33.806, lng: 132.757 }) }, HOME)?.source).toBe("hand");
    expect(currentRoute(pickPoint(back, { lat: 33.81, lng: 132.751 }), HOME)?.source).toBe("hand");
    expect(currentRoute({ ...back, mode: "foot" }, HOME)?.source).toBe("hand");
  });

  it("手で直すときだけ（AI の分け方に混ざると断る）。行き先の避難先の位置が無い経路・点の上限の外は形で断る", async () => {
    const data = await editData();
    const d = pickPoint(routeDraft(data.ledger, HOME), DEST);
    const value = evacMapValue(d, HOME);
    expect(SaveRequestSchema.safeParse({ personId: PID, version: 1, ai: null, changes: [{ t: "evacMap", value }] }).success).toBe(false);
    expect(SaveRequestSchema.safeParse({ personId: PID, version: 1, ai: { model: "claude-sonnet-5-5" }, edit: true, changes: [{ t: "evacMap", value }] }).success).toBe(false);
    expect(SaveRequestSchema.safeParse({ personId: PID, version: 1, ai: null, edit: true, changes: [{ t: "evacMap", value: { ...value, dest1: null } }] }).success).toBe(false);
    const tooMany = { ...value, route: { ...value.route!, via: Array.from({ length: ROUTE_VIA_MAX + 1 }, () => DEST) } };
    expect(SaveRequestSchema.safeParse({ personId: PID, version: 1, ai: null, edit: true, changes: [{ t: "evacMap", value: tooMany }] }).success).toBe(false);
    expect(await saveIntake(db, yamamoto, { personId: PID, version: data.version, ai: null, edit: false, changes: [{ t: "evacMap", value }] } as never, NOW)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("避難先の位置と経路地図は Claude に渡す形（仮名化の出力）に無い", async () => {
    const data = await editData();
    const d = pickPoint(pickPoint(routeDraft(data.ledger, HOME), DEST), { lat: 33.81111, lng: 132.75222 });
    await saveIntake(db, yamamoto, SaveRequestSchema.parse({ personId: PID, version: data.version, ai: null, edit: true, changes: [routeChange(data.ledger, { ...d, tool: "via" })!] }), NOW);
    const rows = await rowsOf();
    const l = parseLedger(rows.person.ledger);
    expect(l.evacuation.destination1Location).toBeDefined();
    const { payload } = pseudonymize([{ person: rows.person, ledger: l, contacts: [...rows.contacts], clocks: [...rows.clocks] }]);
    const sent = JSON.stringify(payload);
    for (const s of [String(DEST.lat), String(DEST.lng), "33.81111", "132.75222", "routeMap", "destination1Location"]) expect(sent).not.toContain(s);
  });
});

describe("範囲の直し（T102 の 3）", () => {
  const v = { center: HOME, z: 15 };
  it("左は西が見える向き・上は北。枠の 4 分の 1 ずつ。拡大・縮小は 9〜18 の整数", () => {
    expect(panRoute(v, "left").center.lng).toBeLessThan(HOME.lng);
    expect(panRoute(v, "right").center.lng).toBeGreaterThan(HOME.lng);
    expect(panRoute(v, "up").center.lat).toBeGreaterThan(HOME.lat);
    expect(panRoute(v, "down").center.lat).toBeLessThan(HOME.lat);
    const dx = project(panRoute(v, "right").center, 15).x - project(HOME, 15).x;
    expect(dx).toBeCloseTo(ROUTE_FRAME.w / 4, 0);
    expect(zoomRoute(v, 1).z).toBe(16);
    expect(zoomRoute({ center: HOME, z: 18 }, 1).z).toBe(18);
    expect(zoomRoute({ center: HOME, z: 9 }, -1).z).toBe(9);
    expect(pointInFrame(v, 0.5, 0.5)).toEqual(HOME);
  });

  it("全体: 家と避難先と線が枠（余白の内）に入るいちばん大きいズーム", () => {
    const f = fitRoute([HOME, DEST], HOME);
    const inFrame = (p: GeoPoint) => {
      const c = project(f.center, f.z);
      const q = project(p, f.z);
      return Math.abs(q.x - c.x) <= ROUTE_FRAME.w / 2 && Math.abs(q.y - c.y) <= ROUTE_FRAME.h / 2;
    };
    expect(inFrame(HOME) && inFrame(DEST)).toBe(true);
    // 1 段拡大すると、どちらかが枠の外
    const bigger = { ...f, z: f.z + 1 };
    const c2 = project(bigger.center, bigger.z);
    const out2 = [HOME, DEST].some((p) => {
      const q = project(p, bigger.z);
      return Math.abs(q.x - c2.x) > ROUTE_FRAME.w / 2 - 24 || Math.abs(q.y - c2.y) > ROUTE_FRAME.h / 2 - 30;
    });
    expect(out2).toBe(true);
    expect(fitRoute([HOME], DEST)).toEqual({ center: HOME, z: 16 });
  });
});

/** 経路地図のある台帳 */
function withRoute(source: "ors" | "hand", base: Ledger): Ledger {
  const line = source === "ors" ? ROAD.map(([lng, lat]) => ({ lat, lng })) : [HOME, { lat: 33.809, lng: 132.75 }, DEST];
  const map: RouteMap = {
    to: 1,
    mode: "foot",
    source,
    line,
    via: source === "hand" ? [{ lat: 33.809, lng: 132.75 }] : [],
    distanceM: 1234,
    ...(source === "ors" ? { durationS: 900 } : {}),
    view: fitRoute([HOME, DEST], HOME),
  };
  return { ...base, basic: { ...base.basic, location: HOME }, evacuation: { ...base.evacuation, destination1Location: DEST, routeMap: map } };
}

describe("紙の欄に入れる地図の画像（T102 の 4）", () => {
  it("経路地図か家の位置が無ければ null（紙は文字の経路だけ）", async () => {
    const l = await ledgerOf();
    expect(routeMapSvg(l, { w: 180, h: 70 })).toBeNull();
    const noHome = withRoute("hand", l);
    delete noHome.basic.location;
    expect(routeMapSvg(noHome, { w: 180, h: 70 })).toBeNull();
  });

  it("地理院タイルの上に線と家・避難先の印。出典（地理院タイル）はいつも、openrouteservice の表記は自動の線だけ。名前・住所の文字は無い", async () => {
    const l = await ledgerOf();
    const rows = await rowsOf();
    const hand = routeMapSvg(withRoute("hand", l), { w: 180, h: 70 })!;
    const ors = routeMapSvg(withRoute("ors", l), { w: 180, h: 70 })!;
    for (const svg of [hand, ors]) {
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+" width="180mm" height="70mm"/);
      expect(svg).toContain("https://cyberjapandata.gsi.go.jp/xyz/pale/");
      expect(svg).toContain(GSI_ROUTE_CREDIT.text);
      expect(svg).toContain('data-route-pin="home"');
      expect(svg).toContain('data-route-pin="dest"');
      expect(svg).toContain(">家</text>");
      expect(svg).toContain(">避難先1</text>");
      for (const w of [rows.person.name, rows.person.kana, l.basic.address?.town, l.evacuation.destination1]) if (w) expect(svg).not.toContain(w);
    }
    expect(ors).toContain(ORS_ATTRIBUTION.text.replace("&", "&amp;"));
    expect(hand).not.toContain("openrouteservice");
    expect(hand).toContain("data-route-via");
    expect(ors).not.toContain("data-route-via");
  });

  it("欄の縦横の比が違えば、保存した範囲が全部入るように広げる（縮めて切らない）", async () => {
    const l = withRoute("ors", await ledgerOf());
    const wide = routeSceneOf(l, { w: 400, h: 100 })!;
    expect(wide.h).toBe(ROUTE_FRAME.h);
    expect(wide.w).toBe(ROUTE_FRAME.h * 4);
    const tall = routeSceneOf(l, { w: 100, h: 100 })!;
    expect(tall.w).toBe(ROUTE_FRAME.w);
    expect(tall.h).toBe(ROUTE_FRAME.w);
    // タイルが枠を覆う
    for (const s of [wide, tall]) {
      const minX = Math.min(...s.tiles.map((t) => t.x));
      const minY = Math.min(...s.tiles.map((t) => t.y));
      const maxX = Math.max(...s.tiles.map((t) => t.x + t.size));
      const maxY = Math.max(...s.tiles.map((t) => t.y + t.size));
      expect(minX).toBeLessThanOrEqual(0);
      expect(minY).toBeLessThanOrEqual(0);
      expect(maxX).toBeGreaterThanOrEqual(s.w);
      expect(maxY).toBeGreaterThanOrEqual(s.h);
      // 家と避難先が枠の中
      for (const p of [s.home!, s.dest!]) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(s.w);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(s.h);
      }
    }
    // 自動の線は道の上から始まるので、家と避難先から線の端までも結ぶ
    expect(wide.line.length).toBe(ROAD.length + 2);
    // detail 1 はタイルの段が 1 つ細かい
    const z = l.evacuation.routeMap!.view.z;
    expect(routeSceneOf(l, { w: 180, h: 70 }, 1)!.tiles[0].href).toContain(`/pale/${z + 1}/`);
  });

  it("画面の絵（RouteSceneSvg）と紙の文字列は同じ線とタイル", async () => {
    const l = withRoute("ors", await ledgerOf());
    const scene = routeSceneOf(l, ROUTE_FRAME)!;
    const screen = renderToStaticMarkup(createElement(RouteSceneSvg, { scene, label: "避難経路" }));
    const paper = sceneSvg(scene, ROUTE_FRAME, "px");
    const pointsOf = (s: string) => s.match(/data-route-line[^>]*|points="([^"]+)"[^>]*data-route-line/)?.[0] ?? "";
    const pts = scene.line.map((p) => `${p.x},${p.y}`).join(" ");
    expect(screen).toContain(`points="${pts}"`);
    expect(paper).toContain(`points="${pts}"`);
    expect(pointsOf(screen)).not.toBe("");
    for (const t of scene.tiles) {
      expect(screen).toContain(t.href);
      expect(paper).toContain(t.href);
    }
    expect(screen).toContain(ORS_ATTRIBUTION.text.replace("&", "&amp;"));
    // 状態の 4 色を使わない（操作の色 1 色）
    expect(screen).not.toMatch(/state-(ok|urgent|check|unknown)/);
    expect(paper).toContain("#116bdf");
    expect(paper).not.toMatch(/gradient|filter|feGaussianBlur/i);
  });

  it("経路地図の点の組み立て（routeScene）は避難先の無い下書きで線を引かない", () => {
    const s = routeScene({
      map: { to: 1, mode: "foot", source: "hand", line: [], via: [], distanceM: 0, view: { center: HOME, z: 15 } },
      home: HOME,
      dest: null,
      size: ROUTE_FRAME,
    });
    expect(s.line).toEqual([]);
    expect(s.home).not.toBeNull();
    expect(s.dest).toBeNull();
  });
});

describe("本人のページの経路地図の行と窓（T102 の 3）", () => {
  it("経路地図が無い人は「未作成」と開くボタン。ある人は小さな絵と要約", async () => {
    const data = await editData();
    const html = renderToStaticMarkup(createElement(RouteMapPanel, { data }));
    expect(html).toContain('data-field="evacuation.routeMap"');
    expect(html).toContain("未作成");
    expect(html).toContain("data-route-open");
    expect(html).not.toContain("data-route-map");
    const html2 = renderToStaticMarkup(createElement(RouteMapPanel, { data: { ...data, ledger: withRoute("ors", data.ledger) } }));
    expect(html2).toContain("data-route-map");
    expect(html2).toContain("徒歩 1.2 km 約 15 分 自動");
  });

  it("窓: 避難先 1・2、手段、置く物、左・右・上・下・拡大・縮小・全体、経路作成・経由削除、保存・取消と出典", async () => {
    const data = await editData();
    const html = renderToStaticMarkup(createElement(RouteEditor, { data, onClose: () => {} }));
    for (const w of ["避難経路", "避難先1", "避難先2", "徒歩", "車", "経由点", "左", "右", "上", "下", "拡大", "縮小", "全体", "経路作成", "経由削除", "保存", "取消", "地理院タイル"]) {
      expect(html).toContain(w);
    }
    // 種の人は避難先の位置が無いので、状態は「位置未設定」で経路作成は押せない
    expect(html).toContain("位置未設定");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-route-make/);
    // 避難先 1 の名前を選択の横に
    expect(html).toContain(data.ledger.evacuation.destination1!);
    expect(html).toContain("data-route-surface");
  });
});
