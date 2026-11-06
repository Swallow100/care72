// T169: 地図の避難所・避難先と、強く拡大したときの名前の読みやすさ。外へ出る物・出す段・2 種類の分け方・位置を作らないことを確かめる。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { CaseMap, FullMap } from "../../components/map/CaseMap.tsx";
import { PlaceMarks } from "../../components/map/PlaceMarks.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { labelWidth, LABEL_H, overlaps, pinSize } from "./cluster.ts";
import { project, type Size, type View } from "./geo.ts";
import { MAP_UI } from "./labels.ts";
import {
  clearShelterCache,
  fetchMapShelters,
  MAP_SHELTER_LAYERS,
  mergeMapShelters,
  SHELTER_CREDIT,
  SHELTER_MAP_ZOOM,
  SHELTER_NAME_ZOOM,
  shelterNameIds,
  shelterTilesForView,
  type MapShelter,
} from "./shelters.ts";
import { planPlaces } from "./side.ts";

const HOME = { lat: 33.84, lng: 132.765 };
const size: Size = { w: 1200, h: 700 };
const viewAt = (z: number): View => ({ z, center: project(HOME, z) });
const shelter = (name: string, lat = HOME.lat, lng = HOME.lng, more: Partial<MapShelter> = {}): MapShelter => ({
  id: `${name}@${lat},${lng}`,
  name,
  at: { lat, lng },
  disasters: [],
  shelter: true,
  welfare: false,
  ...more,
});
const dest = { id: "d", name: "架空小学校", at: { lat: HOME.lat + 0.001, lng: HOME.lng + 0.001 }, people: ["山田", "加藤"] };
const marks = (z: number, shelters: MapShelter[] = [shelter("架空公民館")], destinations = [dest]) =>
  renderToStaticMarkup(createElement(PlaceMarks, { view: viewAt(z), size, tz: z, shelters, destinations }));

describe("出す段", () => {
  it("引いた地図には避難所も避難先も出さない。強く拡大すると出る", () => {
    for (const z of [9, 11, 13, 14]) expect(marks(z), String(z)).toBe("");
    expect(SHELTER_MAP_ZOOM).toBeGreaterThanOrEqual(15);
    const html = marks(SHELTER_MAP_ZOOM);
    expect(html).toContain("data-map-shelter=");
    expect(html).toContain("data-map-dest=");
  });

  it("避難所の名前はもう 1 段寄ってから（15 は印と読み上げだけ）", () => {
    expect(marks(SHELTER_MAP_ZOOM)).not.toContain("data-map-shelter-name");
    expect(marks(SHELTER_MAP_ZOOM)).toContain('aria-label="避難所 架空公民館"');
    expect(marks(SHELTER_NAME_ZOOM)).toContain("data-map-shelter-name");
  });

  it("名前が重なる避難所は印だけ（先に置いた物が残る）", () => {
    const ids = shelterNameIds([
      { id: "a", x: 100, y: 100, name: "架空公民館" },
      { id: "b", x: 120, y: 105, name: "架空集会所" },
      { id: "c", x: 100, y: 200, name: "架空公園" },
    ]);
    expect([...ids]).toEqual(["a", "c"]);
  });
});

describe("2 種類を分ける", () => {
  it("計画の避難先は塗った旗と「避難先」・名前・人数、地図の避難所は白抜きの旗と種類の言葉", () => {
    const one = (html: string, attr: string) => html.split("<span ").filter((_, i, a) => a.slice(0, i + 1).join("").includes(attr));
    const html = marks(SHELTER_NAME_ZOOM);
    const at = html.indexOf("data-map-dest=");
    const a = html.slice(html.lastIndexOf("<span ", at));
    expect(a).toContain("fill-accent-fill");
    expect(a).toContain(MAP_UI.planDest);
    expect(a).toContain("架空小学校");
    expect(a).toContain("2 人");
    const b = html.slice(0, html.lastIndexOf("<span ", at));
    expect(b).toContain("fill-panel stroke-accent-fill");
    expect(b).toContain("避難所");
    expect(b).not.toContain("fill-accent-fill");
    expect(one(html, "data-map-dest").length).toBeGreaterThan(0);
  });

  it("種類の言葉: 指定避難所・福祉・指定緊急避難場所だけの所", () => {
    const html = marks(SHELTER_NAME_ZOOM, [
      shelter("架空A", HOME.lat, HOME.lng),
      shelter("架空B", HOME.lat + 0.002, HOME.lng, { shelter: false, welfare: true }),
      shelter("架空C", HOME.lat + 0.004, HOME.lng, { shelter: false, disasters: ["flood", "quake"] }),
    ]);
    expect(html).toContain('data-map-shelter="避難所"');
    expect(html).toContain('data-map-shelter="福祉"');
    expect(html).toContain('data-map-shelter="緊急避難"');
    expect(html).toContain('aria-label="緊急避難 洪水・地震 架空C"');
  });

  it("状態の 4 色を使わない。人のピンより下に重ね、押す物にしない（リンクでない）", () => {
    const html = marks(SHELTER_NAME_ZOOM);
    expect(html).not.toMatch(/state-(ok|urgent|check|unknown)/);
    expect(html).not.toContain("<a ");
    expect(html).toContain("z-index:4");
    expect(html).toContain("z-index:5");
  });

  it("計画の避難先と同じ名前の避難所は計画の方だけ", () => {
    const html = marks(SHELTER_NAME_ZOOM, [shelter("架空小学校", dest.at.lat, dest.at.lng)]);
    expect(html).not.toContain("data-map-shelter=");
    expect(html).toContain("data-map-dest=");
  });
});

describe("計画の避難先は台帳の位置のある物だけ", () => {
  const row = (name: string, places: Array<{ name: string | null; at: { lat: number; lng: number } | null; which: 1 | 2 }>) => ({ name, destinationPlaces: places });

  it("位置が無ければ旗にせず数える。名前から位置を推し量らない", () => {
    const p = planPlaces([row("山田 ハナ", [{ name: "架空小学校", at: null, which: 1 }, { name: null, at: null, which: 2 }])]);
    expect(p).toEqual({ destinations: [], unplaced: 1 });
  });

  it("同じ名前で同じ位置は 1 つにして行く人を並べる。名前の無い位置は番号", () => {
    const at = { lat: 33.81, lng: 132.75 };
    const p = planPlaces([
      row("山田 ハナ", [{ name: "架空小学校", at, which: 1 }]),
      row("加藤 一郎", [{ name: "架空小学校", at, which: 1 }, { name: null, at: { lat: 33.82, lng: 132.76 }, which: 2 }]),
    ]);
    expect(p.unplaced).toBe(0);
    expect(p.destinations.map((d) => [d.name, d.people])).toEqual([
      ["架空小学校", ["山田", "加藤"]],
      ["避難先2", ["加藤"]],
    ]);
  });

  it("種の 10 人に作った位置を入れていない（種は避難先の位置が無く、数だけ出る）", () => {
    for (const p of SEED_PEOPLE) {
      expect(p.ledger.evacuation.destination1Location, p.person.id).toBeUndefined();
      expect(p.ledger.evacuation.destination2Location, p.person.id).toBeUndefined();
    }
  });
});

describe("読み方", () => {
  beforeEach(() => clearShelterCache());
  const feature = (name: string, lat: number, lng: number, props: Record<string, unknown> = {}) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { name, address: "架空の住所", remarks: "架空の備考", ...props },
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("外へ出るのは層とズーム 10 のタイルの z/x/y だけで、見出し・本文なし", async () => {
    const urls: string[] = [];
    const inits: Array<RequestInit | undefined> = [];
    const f = (async (u: string, init?: RequestInit) => {
      urls.push(u);
      inits.push(init);
      return json({ features: [] });
    }) as unknown as typeof fetch;
    const tiles = shelterTilesForView(viewAt(16), size);
    await fetchMapShelters({ tiles, fetch: f });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(4);
    expect(urls).toHaveLength(MAP_SHELTER_LAYERS.length * tiles.length);
    for (const u of urls) expect(u).toMatch(/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/(sih|sfh|skhb0[1245])\/10\/\d+\/\d+\.geojson$/);
    for (const i of inits) {
      expect(i?.headers).toBeUndefined();
      expect(i?.body).toBeUndefined();
    }
  });

  it("同じタイルは 1 度だけ読む（動かしても読み直しでも要求しない）。失敗した物は次に読み直す", async () => {
    let n = 0;
    const ok = (async () => (n++, json({ features: [] }))) as unknown as typeof fetch;
    const tiles = [{ x: 889, y: 409 }];
    await fetchMapShelters({ tiles, fetch: ok });
    await fetchMapShelters({ tiles, fetch: ok });
    expect(n).toBe(MAP_SHELTER_LAYERS.length);
    clearShelterCache();
    n = 0;
    const bad = (async () => (n++, new Response("", { status: 500 }))) as unknown as typeof fetch;
    expect(await fetchMapShelters({ tiles, fetch: bad })).toEqual({ ok: false });
    await fetchMapShelters({ tiles, fetch: bad });
    expect(n).toBe(MAP_SHELTER_LAYERS.length * 2);
  });

  it("層ごとの失敗は飛ばす。404 は空。同じ施設は 1 つで、住所・備考は持たない", async () => {
    const f = (async (u: string) => {
      if (u.includes("/sih/")) return json({ features: [feature("架空小学校", 33.8, 132.7)] });
      if (u.includes("/skhb04/")) return json({ features: [feature("架空小学校", 33.8001, 132.7001, { disaster4: 1 }), feature("架空公園", 33.81, 132.71, { disaster4: "1" })] });
      if (u.includes("/sfh/")) return new Response("", { status: 404 });
      throw new Error("読めない");
    }) as unknown as typeof fetch;
    const r = await fetchMapShelters({ tiles: [{ x: 889, y: 409 }], fetch: f });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.list.map((s) => [s.name, s.shelter, s.disasters])).toEqual([
      ["架空小学校", true, ["quake"]],
      ["架空公園", false, ["quake"]],
    ]);
    expect(JSON.stringify(r.list)).not.toContain("架空の住所");
    expect(JSON.stringify(r.list)).not.toContain("架空の備考");
  });

  it("同じ名前でも離れた所は別の施設", () => {
    const raw = { disasters: [], shelter: true, welfare: false };
    expect(mergeMapShelters([{ name: "架空公園", at: { lat: 33.8, lng: 132.7 }, ...raw }, { name: "架空公園", at: { lat: 33.9, lng: 132.8 }, ...raw }])).toHaveLength(2);
  });
});

describe("地図の部品", () => {
  const pins = [{ id: "p", label: "山田", title: "山田 ハナ", location: HOME, href: "/?open=p", tone: null, state: null, layer: 0 }];
  const places = { destinations: [], unplaced: 3 };

  it("右の面の地図（places あり）に「避難所」の切替と、引いている間の「要拡大」、位置の無い避難先の数", () => {
    // 2 人が離れていて、初めの表示は引いた地図
    const far = [...pins, { ...pins[0], id: "q", location: { lat: HOME.lat + 0.1, lng: HOME.lng + 0.1 } }];
    const html = renderToStaticMarkup(createElement(CaseMap, { pins: far, layers: [], demo: null, unplaced: 0, places }));
    expect(html).toContain('data-toggle="shelter"');
    expect(html).toContain(MAP_UI.needZoom);
    expect(html).toContain('data-dest-unplaced="3"');
    // サーバーの描画では読まないので、印も出典も無い
    expect(html).not.toContain("data-map-shelter=");
    expect(html).not.toContain("data-shelter-source");
  });

  it("訓練の画面（places なし）には出さない", () => {
    const html = renderToStaticMarkup(createElement(CaseMap, { pins, layers: [], demo: null, unplaced: 0 }));
    expect(html).not.toContain('data-toggle="shelter"');
    expect(html).not.toContain("data-dest-unplaced");
  });

  it("出典は国土地理院と加工の旨・ご利用上の注意のリンク（描いている間だけ。部品の元で確かめる）", () => {
    expect(SHELTER_CREDIT.text).toContain("国土地理院");
    expect(SHELTER_CREDIT.text).toContain("加工して作成");
    const src = readFileSync(new URL("../../components/map/CaseMap.tsx", import.meta.url), "utf8");
    expect(src).toContain("shelters={shelters.list.length > 0}");
    expect(src).toContain("SHELTER_CREDIT.noticeHref");
  });

  it("リポジトリにデータを入れない（避難所の JSON・GeoJSON を import しない）", () => {
    const src = readFileSync(new URL("./shelters.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "\.\/.*\.(geo)?json"/);
  });
});

describe("名前の読みやすさ", () => {
  it("寄るほど字を大きく（地図の字に負けない）。全部のズームで段がある", () => {
    const fonts = [9, 11, 13, 14, 15, 16, 17, 18].map((z) => pinSize(z).font);
    expect(fonts).toEqual([...fonts].sort((a, b) => a - b));
    expect(pinSize(13).font).toBe(11);
    expect(pinSize(15).font).toBeGreaterThan(11);
    expect(pinSize(18).font).toBeGreaterThan(pinSize(15).font);
  });

  it("重なりの見積もりも字の大きさに合わせる", () => {
    const pin = { label: "山田", state: null };
    expect(labelWidth(pin, 15)).toBeGreaterThan(labelWidth(pin));
    const a = { id: "a", x: 0, y: 0, layer: 0, w: 40 };
    const b = { id: "b", x: 0, y: LABEL_H + 3, layer: 0, w: 40 };
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps({ ...a, h: 24 }, { ...b, h: 24 })).toBe(true);
  });

  it("全画面の地図のピンが今の段の大きさで描かれる（全画面の初めの表示は 1 人だと 15）。平時の名前に状態の赤を使わない", () => {
    const pins = [{ id: "p", label: "山田", title: "山田 ハナ", location: HOME, href: "/?open=p", tone: null, state: null, layer: 0 }];
    const choice = { on: new Set<never>(), toggle: () => {}, rainOn: false, toggleRain: () => {} };
    const html = renderToStaticMarkup(createElement(FullMap, { pins, demo: null, unplaced: 0, choice, onClose: () => {}, initialSize: size }));
    expect(html).toContain(`data-pin-font="${pinSize(15).font}"`);
    expect(html).not.toContain("bg-state-urgent");
  });
});
