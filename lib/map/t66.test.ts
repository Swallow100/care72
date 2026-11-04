// T66 右の面の地図（docs/tasks/T66.md の 3）。小さな地図のその場の拡大・縮小・移動の計算と画面、雨雲の濃さ（形は T96 で替えた）、
// 下の地図と重ねる層の濃さ、右の面の人数の帯（塗りの印・本文色の数・0 は灰）。
// 動き（ボタン・Ctrl＋ホイール・押したあとのホイール・ドラッグ）は手元の dev のブラウザで確かめた（docs/progress/t66.md）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidePane } from "../../components/list/SidePane.tsx";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { rank } from "../triage/index.ts";
import { FULL_ZOOM, JAPAN_BOUNDS, MAP_LIMITS, sameView, sideWheelTakes, stepZoom, toFrame, wheelZoom } from "./camera.ts";
import { demoOverlay, RAIN_FILL, RAIN_STREAK, RAIN_STYLE } from "./demo.ts";
import { BASE_SIZE, clampView, fitView, place, tilesFor, tileZoom, VIEW_H, VIEW_W, zoomAt, type View } from "./geo.ts";
import { BASE_LAYER, BASE_OPACITY, HAZARD_OPACITY } from "./layers.ts";
import { MAP_UI } from "./labels.ts";
import { buildSidePane, mapPins } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
const T0 = Date.parse("2026-11-05T09:00:00.000Z");
const results = rank(
  SEED_PEOPLE.map((p) => ({ person: toTriagePerson(p), signals: [] })),
  { now: new Date(T0 + 3.5 * 3_600_000).toISOString(), disasterAt: new Date(T0).toISOString(), outageAt: new Date(T0).toISOString() },
);
const pins = mapPins(rows, "tier");
const FIT: View = fitView(
  pins.map((p) => p.location),
  { minZ: 11, maxZ: 15, fallback: pins[0].location },
);

describe("小さな地図の拡大・縮小の計算", () => {
  it("画面の点 → 基準の枠（352×300）の点: 枠が画面で 2 倍に伸びていれば半分に、ずれは枠の左上から", () => {
    const rect = { left: 100, top: 50, width: VIEW_W * 2, height: VIEW_H * 2 };
    expect(toFrame({ x: 100, y: 50 }, rect)).toEqual({ x: 0, y: 0 });
    expect(toFrame({ x: 100 + VIEW_W, y: 50 + VIEW_H }, rect)).toEqual({ x: VIEW_W / 2, y: VIEW_H / 2 });
    // 375 の画面の右の面（幅 319px）でも、枠の右下は基準の右下
    const phone = { left: 28, top: 400, width: 319, height: (319 * VIEW_H) / VIEW_W };
    const br = toFrame({ x: 28 + 319, y: 400 + phone.height }, phone);
    expect(br.x).toBeCloseTo(VIEW_W, 6);
    expect(br.y).toBeCloseTo(VIEW_H, 6);
    // 全画面は枠の大きさのまま（比は 1）
    expect(toFrame({ x: 40, y: 30 }, { left: 0, top: 0, width: 1280, height: 800 }, { w: 1280, h: 800 })).toEqual({ x: 40, y: 30 });
  });

  it("ホイールは Ctrl・⌘ か地図を押したあとだけ地図に効かせ、ほかは画面の送りに渡す", () => {
    expect(sideWheelTakes({ ctrlKey: false, metaKey: false }, false)).toBe(false);
    expect(sideWheelTakes({ ctrlKey: true, metaKey: false }, false)).toBe(true);
    expect(sideWheelTakes({ ctrlKey: false, metaKey: true }, false)).toBe(true);
    expect(sideWheelTakes({ ctrlKey: false, metaKey: false }, true)).toBe(true);
  });

  it("ボタンの拡大は最初のズーム（12）から 1 段ずつ、真ん中の地点を据える。全体で最初に戻る", () => {
    expect(FIT.z).toBe(12);
    const inView = clampView(zoomAt(FIT, BASE_SIZE, stepZoom(FIT.z, 1)), BASE_SIZE, MAP_LIMITS);
    expect(inView.z).toBe(13);
    expect(inView.center.x / 2).toBeCloseTo(FIT.center.x, 6);
    expect(sameView(inView, FIT)).toBe(false);
    expect(sameView(FIT, { z: 12, center: { ...FIT.center } })).toBe(true);
  });

  it("Ctrl＋ホイールの拡大は、カーソルの下の地点が同じ所に残る（基準の枠の座標で）", () => {
    const rect = { left: 0, top: 0, width: 319, height: (319 * VIEW_H) / VIEW_W };
    const cursor = { x: 80, y: 60 };
    const at = toFrame(cursor, rect);
    const p = pins[0].location;
    // カーソルの下に山田のピンを置いた表示
    const before = place(FIT, p);
    const v0: View = {
      z: FIT.z,
      center: { x: FIT.center.x + ((before.left / 100) * VIEW_W - at.x), y: FIT.center.y + ((before.top / 100) * VIEW_H - at.y) },
    };
    const dz = wheelZoom({ deltaY: -100, deltaMode: 0, ctrlKey: true });
    const v1 = zoomAt(v0, BASE_SIZE, v0.z + dz, at);
    const after = place(v1, p);
    expect((after.left / 100) * VIEW_W).toBeCloseTo(at.x, 6);
    expect((after.top / 100) * VIEW_H).toBeCloseTo(at.y, 6);
    expect(v1.z).toBeGreaterThan(v0.z);
  });

  it("ズームは全画面と同じ 9〜18、真ん中は日本の周りに収める", () => {
    expect(MAP_LIMITS.range).toEqual(FULL_ZOOM);
    expect(MAP_LIMITS.bounds).toEqual(JAPAN_BOUNDS);
    expect(clampView({ z: 30, center: FIT.center }, BASE_SIZE, MAP_LIMITS).z).toBe(18);
    expect(clampView({ z: 3, center: FIT.center }, BASE_SIZE, MAP_LIMITS).z).toBe(9);
  });

  it("小数のズームのタイルは四捨五入の段で、淡色地図の範囲（5〜18）に収める", () => {
    const v = zoomAt(FIT, BASE_SIZE, 13.6);
    const tiles = tilesFor(v, BASE_SIZE, { range: BASE_LAYER });
    expect(new Set(tiles.map((t) => t.z))).toEqual(new Set([tileZoom(13.6, BASE_LAYER)]));
    expect(tileZoom(13.6, BASE_LAYER)).toBe(14);
    // 最初の表示は今までと同じタイル（範囲を渡しても整数のズームでは変わらない）
    expect(tilesFor(FIT, BASE_SIZE, { range: BASE_LAYER })).toEqual(tilesFor(FIT));
  });
});

describe("小さな地図の画面", () => {
  const html = renderToStaticMarkup(createElement(CaseMap, { pins, layers: ["flood"], demo: null, unplaced: 0 }));

  it("縮小・拡大・全体（アイコンと文字）と全画面が 1 行。最初は全体を押せない。<dialog> はまだ作らない", () => {
    const tools = html.match(/<div[^>]*data-map-tools[^>]*>[\s\S]*?data-map-open[\s\S]*?<\/button><\/div>/)?.[0] ?? "";
    expect(tools).not.toBe("");
    for (const [attr, word] of [
      ['data-map-zoom="out"', MAP_UI.zoomOut],
      ['data-map-zoom="in"', MAP_UI.zoomIn],
      ["data-map-fit", MAP_UI.fit],
      ["data-map-open", MAP_UI.full],
    ]) {
      expect(tools).toMatch(new RegExp(`<button[^>]*${attr}[^>]*><svg[^>]*aria-hidden="true"[\\s\\S]*?${word}</button>`));
    }
    expect(tools).toMatch(/<button[^>]*disabled=""[^>]*data-map-fit/);
    expect(tools).not.toMatch(/<button[^>]*disabled=""[^>]*data-map-zoom="in"/);
    expect(html).not.toContain("<dialog");
  });

  it("新しい押せる物（ボタンと地図の枠）はキーで移ったときの枠（outline-solid）を持つ", () => {
    for (const attr of ['data-map-zoom="out"', 'data-map-zoom="in"', "data-map-fit", "data-map-open"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*focus-visible:outline-solid[^>]*${attr}`));
    }
    const frame = html.match(/<div tabindex="0" aria-label="地図" class="([^"]*)"[^>]*data-map-side/);
    expect(frame).not.toBeNull();
    expect(frame![1]).toContain("focus-visible:outline-solid");
    // 指 1 本は画面の送り（地図の枠は縦の送りを止めない）
    expect(frame![1]).toContain("touch-pan-y");
    expect(frame![1]).not.toContain("touch-none");
  });

  it("最初のズームは今までと同じ（ピンが全部入る 12）で、ピンは全員", () => {
    expect(html).toMatch(/data-zoom="12" data-tile-zoom="12" data-map-side/);
    expect([...html.matchAll(/data-pin="/g)].length).toBe(pins.length);
  });
});

describe("地図の見やすさ（雨雲・下の地図・層）", () => {
  // 雨雲の形（斜線 → 淡い青灰の面と短い筋）は T96 で替えた。ここには T66 の意図（強いほど詰む・ライトとダークで同じ色・デモの印）だけを残す。
  // 形の細かい所は lib/map/t96-rain.test.ts
  it("雨雲は強いほど筋を詰めて太く。弱でも筋がある", () => {
    const s = [RAIN_STYLE[1], RAIN_STYLE[2], RAIN_STYLE[3]];
    const density = (x: (typeof s)[number]) => x.streaks / (x.tile * x.tile);
    for (let i = 1; i < s.length; i++) {
      expect(density(s[i])).toBeGreaterThan(density(s[i - 1]));
      expect(s[i].width).toBeGreaterThanOrEqual(s[i - 1].width);
    }
    expect(RAIN_STYLE[1].streaks).toBeGreaterThan(0);
    expect(RAIN_FILL).toMatch(/^#[0-9a-f]{6}$/);
    expect(RAIN_STREAK).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("雨雲の色はライトとダークで同じ値（下の地図はダークでも明るいので、本文色〔currentColor〕や CSS 変数にしない）", () => {
    const html = renderToStaticMarkup(
      createElement(CaseMap, { pins, layers: ["flood"], demo: demoOverlay({ kind: "heavy_rain", level: 5 }), unplaced: 0 }),
    );
    const rain = html.match(/<svg[^>]*data-demo="rain"[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(rain).not.toBe("");
    expect(rain).not.toContain("currentColor");
    expect(rain).not.toContain("var(");
    expect(rain).toContain(`stroke="${RAIN_STREAK}"`);
    expect(rain).toContain(`fill="${RAIN_FILL}"`);
    expect([...rain.matchAll(/<pattern /g)].length).toBe(3);
    // デモの印は消さない
    expect(html).toContain('data-demo="label"');
    expect(html).toContain("想定値");
  });

  it("下の地図はライトだけ少し薄く、重ねる層は前（0.6）より強い", () => {
    expect(BASE_OPACITY).toBeGreaterThan(0.5);
    expect(BASE_OPACITY).toBeLessThan(1);
    expect(HAZARD_OPACITY).toBeGreaterThan(0.6);
    const html = renderToStaticMarkup(createElement(CaseMap, { pins, layers: ["flood"], demo: null, unplaced: 0 }));
    const base = html.match(/<img[^>]*data-layer="base"[^>]*>/)?.[0] ?? "";
    expect(base).toContain("opacity-(--map-base-opacity)");
    expect(base).toContain("dark:opacity-100");
    expect(base).toContain(`--map-base-opacity:${BASE_OPACITY}`);
  });
});

describe("右の面の人数の帯（T66 の 2）", () => {
  const html = renderToStaticMarkup(
    createElement(SidePane, { data: buildSidePane(rows, { sort: "tier", disaster: { results, scene: { kind: "heavy_rain", level: 4 } } }) }),
  );
  const band = (html.match(/<dl[^>]*data-states[\s\S]*?<\/dl>/g) ?? []).at(-1) ?? "";

  it("1 人以上の状態は言葉を塗りの印に、数は本文色。0 の状態は印も数も灰（不明の塗りの灰は使わない）", () => {
    expect(band).not.toBe("");
    const items = [...band.matchAll(/<div[^>]*data-color="([a-z]+)"[^>]*>([\s\S]*?)<\/div>/g)];
    expect(items.map((m) => m[1])).toEqual(["red", "yellow", "gray", "green"]);
    const counts = Object.fromEntries(results.map((r) => [r.color, 0]));
    for (const r of results) counts[r.color] = (counts[r.color] ?? 0) + 1;
    for (const [, color, body] of items) {
      const n = Number(body.match(/<dd[^>]*>(\d+)<\/dd>/)![1]);
      expect(n).toBe(counts[color] ?? 0);
      const dd = body.match(/<dd class="([^"]*)"/)![1];
      expect(dd).not.toMatch(/text-state-/);
      if (n > 0) {
        expect(body).toMatch(/<span class="[^"]*bg-state-[a-z]+-fill[^"]*" data-tone="[a-z]+">/);
        expect(dd).not.toContain("text-muted");
      } else {
        expect(body).toContain("data-zero");
        expect(body).not.toMatch(/bg-state-/);
        expect(dd).toContain("text-muted");
      }
    }
    // 無事 0 人の筋（停電で連絡なし）でも、灰の印で並びは 4 つのまま
    expect(counts.green ?? 0).toBe(0);
  });

  it("ハザードの内訳も塗りの印と本文色の数（赤の文字・黄の細い帯の文字にしない）", () => {
    const hz = html.match(/<ul[^>]*data-hazards[\s\S]*?<\/ul>/)?.[0] ?? "";
    const states = [...hz.matchAll(/data-hazard-state="([a-z]+)"[^>]*>([\s\S]*?)<\/span><\/span>/g)];
    expect(states.length).toBeGreaterThan(0);
    for (const [, , body] of states) {
      expect(body).toMatch(/bg-state-[a-z]+-fill/);
      expect(body).not.toMatch(/text-state-|tone-check/);
    }
  });
});
