// T151 地図をドラッグと指で動かす・雨雲の凡例を小さく（docs/tasks/T151.md）。
// - 動かし方の数え（lib/map/drag.ts の MapDrag）: ドラッグで中心が動く、少しの動きは押したこと（ピンが開く・押して置く）、
//   動かしたあとの click は通さない、2 本の指はピンチ、画面の送りの中の地図はホイールと縦の指を押した後だけ
// - 全部の地図が同じ部品を使う（担当一覧の右の面と全画面・事業所の地域と本人の位置・避難経路の窓）
// - 避難経路の窓のドラッグ（始めの範囲に始めからの量）と段ごとの拡大・縮小
// - 雨の凡例: 色の帯と数字と時刻（訓練は「想定」）だけの小さな帯。気象庁の凡例の画像は読まない。出典は地図の下の出典の行
// 動き（実際のマウスのドラッグ・ホイール）は手元の dev のブラウザで確かめた（docs/progress/t151.md）。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseMap, FullMap } from "../../components/map/CaseMap.tsx";
import { NowcastLayer } from "../../components/map/NowcastLayer.tsx";
import { LEGEND_CHIP_W } from "../../components/map/RainScaleLegend.tsx";
import { RouteEditor } from "../../components/map/RouteMap.tsx";
import { LocationPick } from "../../components/person/LocationPick.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { HEAVY_RAIN_TRACK } from "../drill/rain.ts";
import { NOWC_SOURCE } from "../jma/nowcast.ts";
import { PLACE_LABELS } from "../labels.ts";
import { DRAG_SLOP, sideWheelTakes } from "./camera.ts";
import { demoOverlay } from "./demo.ts";
import { MapDrag, touchClass, wheelSteps } from "./drag.ts";
import { rainAnchor } from "./drill-rain.ts";
import { BASE_SIZE, fitView, panBy, project, unproject, type View } from "./geo.ts";
import { RAIN_STEPS } from "./rain-scale.ts";
import { panRouteBy, zoomRouteAt } from "./route-edit.ts";
import { ROUTE_FRAME } from "./route-image.ts";
import { mapPins } from "./side.ts";

const fetchSpy = vi.fn(() => {
  throw new Error("テストから外へ出ない");
});
beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
afterAll(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
const pins = mapPins(rows, "tier");
const FIT: View = fitView(
  pins.map((p) => p.location),
  { minZ: 11, maxZ: 15, fallback: pins[0].location },
);
const NOWC_TIME = { basetime: "20261105172000", validtime: "20261105172000" };

describe("ドラッグで動かす（lib/map/drag.ts）", () => {
  it("マウスで引くと、引いた分だけ地図が動き中心が逆へ（右下へ引けば西・北が見える）。押した直後の小さな動きも最初の移動に入る", () => {
    const d = new MapDrag();
    expect(d.down(1, { x: 100, y: 100 }, "mouse")).toBe(true);
    // DRAG_SLOP より小さい動きはまだ押しただけ
    expect(d.move(1, { x: 102, y: 101 })).toEqual({ type: "none" });
    const s1 = d.move(1, { x: 160, y: 130 });
    expect(s1).toEqual({ type: "pan", dx: 60, dy: 30, total: { x: 60, y: 30 }, fresh: true });
    const s2 = d.move(1, { x: 170, y: 140 });
    expect(s2).toEqual({ type: "pan", dx: 10, dy: 10, total: { x: 70, y: 40 }, fresh: false });
    let v = FIT;
    for (const s of [s1, s2]) if (s.type === "pan") v = panBy(v, s.dx, s.dy);
    expect(v.center.x).toBeCloseTo(FIT.center.x - 70);
    expect(v.center.y).toBeCloseTo(FIT.center.y - 40);
    const before = unproject(FIT.center, FIT.z);
    const after = unproject(v.center, v.z);
    expect(after.lng).toBeLessThan(before.lng);
    expect(after.lat).toBeGreaterThan(before.lat);
    expect(d.moving).toBe(true);
    expect(d.up(1, "mouse")).toEqual({ tap: false });
  });

  it("引いたあとの click はピンにも押して置くボタンにも通さない（1 回だけ。次の押しはまた通る）", () => {
    const d = new MapDrag();
    d.down(1, { x: 10, y: 10 }, "mouse");
    d.move(1, { x: 10 + DRAG_SLOP + 1, y: 10 });
    d.up(1, "mouse");
    expect(d.takeClick()).toBe(false);
    // キーの Enter など、押していない click は通る
    expect(d.takeClick()).toBe(true);
    d.down(2, { x: 10, y: 10 }, "mouse");
    d.up(2, "mouse");
    expect(d.takeClick()).toBe(true);
  });

  it("押しただけ（DRAG_SLOP の中で離した）はピンを押したこと: 地図は動かず click が通る（その人を開く・その所に置く）", () => {
    for (const kind of ["mouse", "touch", "pen"]) {
      const d = new MapDrag();
      d.down(7, { x: 50, y: 50 }, kind);
      expect(d.move(7, { x: 50 + DRAG_SLOP - 1, y: 50 })).toEqual({ type: "none" });
      expect(d.up(7, kind)).toEqual({ tap: true });
      expect(d.takeClick()).toBe(true);
    }
  });

  it("指 1 本のなぞりでも動く（全部の地図）。2 本目の指はピンチで、押したことにしない。1 本離して続けても飛ばない", () => {
    const d = new MapDrag();
    d.down(1, { x: 100, y: 100 }, "touch");
    const pan = d.move(1, { x: 80, y: 100 });
    expect(pan.type).toBe("pan");
    d.down(2, { x: 200, y: 100 }, "touch");
    const pinch = d.move(2, { x: 240, y: 100 });
    expect(pinch).toEqual({ type: "pinch", before: [{ x: 80, y: 100 }, { x: 200, y: 100 }], after: [{ x: 80, y: 100 }, { x: 240, y: 100 }] });
    d.up(2, "touch");
    // 残った指の今の点から数え直す（離した指の分だけ飛ばない）
    const after = d.move(1, { x: 90, y: 100 });
    expect(after).toEqual({ type: "pan", dx: 10, dy: 0, total: { x: 10, y: 0 }, fresh: true });
    d.up(1, "touch");
    expect(d.takeClick()).toBe(false);
  });

  it("マウスの左以外のボタンは数えない（右の押しで地図を動かさない）。押していない動きは何もしない", () => {
    const d = new MapDrag();
    expect(d.down(1, { x: 0, y: 0 }, "mouse", 2)).toBe(false);
    expect(d.move(1, { x: 50, y: 50 })).toEqual({ type: "none" });
    expect(d.active).toBe(false);
  });
});

describe("画面の送りの中の地図（ホイールと縦の指は押した後だけ）", () => {
  it("マウス・ペンは押した時、指は押して離した時に armed。外へ出る・焦点が外れる・ブラウザが画面の送りに使った指で外れる", () => {
    const d = new MapDrag();
    expect(d.armed).toBe(false);
    d.down(1, { x: 0, y: 0 }, "mouse");
    expect(d.armed).toBe(true);
    d.up(1, "mouse");
    d.disarm();
    expect(d.armed).toBe(false);
    // 指は置いただけではまだ（縦に送れば画面が送れる）
    d.down(2, { x: 0, y: 0 }, "touch");
    expect(d.armed).toBe(false);
    d.up(2, "touch");
    expect(d.armed).toBe(true);
    // 画面の送りに使われた指（pointercancel）で外れる
    d.down(3, { x: 0, y: 0 }, "touch");
    d.cancel(3);
    expect(d.armed).toBe(false);
  });

  it("ホイール: Ctrl（⌘）か押した後だけ地図に（ほかは画面の送り）", () => {
    expect(sideWheelTakes({ ctrlKey: false, metaKey: false }, false)).toBe(false);
    expect(sideWheelTakes({ ctrlKey: true, metaKey: false }, false)).toBe(true);
    expect(sideWheelTakes({ ctrlKey: false, metaKey: true }, false)).toBe(true);
    expect(sideWheelTakes({ ctrlKey: false, metaKey: false }, true)).toBe(true);
  });

  it("指: 押す前は縦の送りを画面に（pan-y。横に動かした指は地図）、押した後は全部地図に。全画面はいつも地図に", () => {
    expect(touchClass(true, false)).toBe("touch-pan-y");
    expect(touchClass(true, true)).toBe("touch-none");
    expect(touchClass(false, false)).toBe("touch-none");
    expect(touchClass(false, true)).toBe("touch-none");
  });

  it("段ごとの拡大・縮小（避難経路の窓）: ホイールの量をためて 1 段ずつ。向きが変われば数え直す", () => {
    let acc = 0;
    const steps: number[] = [];
    for (const dz of [0.4, 0.4, 0.4, 0.4, 0.4]) {
      const r = wheelSteps(acc, dz);
      acc = r.acc;
      steps.push(r.steps);
    }
    expect(steps).toEqual([0, 0, 1, 0, 1]);
    const back = wheelSteps(0.8, -0.3);
    expect(back.steps).toBe(0);
    expect(back.acc).toBeCloseTo(-0.3);
    expect(wheelSteps(0, -1).steps).toBe(-1);
  });
});

describe("全部の地図が同じ動かし方の部品を使う", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  it("担当一覧の右の面・訓練（CaseMap）、全画面（FullMap）、事業所の地域と本人の位置（LocationPick）、避難経路の窓（RouteEditor）が useMapDrag を使う", () => {
    for (const f of ["../../components/map/CaseMap.tsx", "../../components/person/LocationPick.tsx", "../../components/map/RouteMap.tsx"]) {
      expect(src(f), f).toMatch(/useMapDrag\(/);
    }
    // 前の作り（CaseMap の中だけの指とホイールの部品）は残っていない
    expect(src("../../components/map/CaseMap.tsx")).not.toMatch(/function useMapPointer|function useMapWheel/);
  });

  it("小さな地図の枠: 押す前は touch-pan-y（縦の送りは画面）。全画面の枠は touch-none", () => {
    const side = renderToStaticMarkup(createElement(CaseMap, { pins, layers: [], demo: null, unplaced: 0 }));
    const frame = side.match(/<div tabindex="0" aria-label="地図" class="([^"]*)"[^>]*data-map-side/);
    expect(frame![1]).toContain("touch-pan-y");
    expect(frame![1]).toContain("cursor-grab");
    const full = renderToStaticMarkup(
      createElement(FullMap, {
        pins,
        demo: null,
        unplaced: 0,
        choice: { on: new Set<never>(), toggle: () => {}, rainOn: true, toggleRain: () => {} },
        onClose: () => {},
        initialSize: { w: 1200, h: 700 },
      }),
    );
    expect(full).toMatch(/class="[^"]*cursor-grab touch-none[^"]*"/);
  });

  it("位置を置く地図: 枠がドラッグを受け、押す所のボタンは押せる。見るだけ（管理者でない）は押す所を置かず、枠に焦点が来る", () => {
    const center = { lat: 33.84, lng: 132.765 };
    const edit = renderToStaticMarkup(createElement(LocationPick, { value: null, onChange: () => {}, center, label: PLACE_LABELS.center }));
    expect(edit).toMatch(/<div class="[^"]*touch-pan-y[^"]*"[^>]*data-location-map/);
    expect(edit).toMatch(/<button type="button" aria-label="中心 設定" class="[^"]*cursor-crosshair[^"]*"[^>]*data-location-surface/);
    expect(edit).not.toMatch(/data-location-surface[^>]*disabled|disabled=""[^>]*data-location-surface/);
    for (const w of [PLACE_LABELS.zoomIn, PLACE_LABELS.zoomOut]) expect(edit).toContain(w);
    const view = renderToStaticMarkup(createElement(LocationPick, { value: center, onChange: () => {}, center, label: PLACE_LABELS.center, readOnly: true }));
    expect(view).not.toContain("data-location-surface");
    expect(view).toMatch(/<div tabindex="0" aria-label="中心" class="[^"]*cursor-grab[^"]*focus-visible:outline-solid[^"]*"[^>]*data-location-map/);
  });
});

describe("避難経路の窓のドラッグ（lib/map/route-edit.ts）", () => {
  const base = { center: { lat: 33.84, lng: 132.765 }, z: 15 };

  it("右へ引けば真ん中は西へ。動くたびに始めの範囲に始めからの量を当てるので、細かく動かしても 1 回で動かしたのと同じ所", () => {
    const once = panRouteBy(base, 120, -60);
    expect(once.z).toBe(15);
    expect(once.center.lng).toBeLessThan(base.center.lng);
    expect(once.center.lat).toBeLessThan(base.center.lat);
    let last = base;
    for (let i = 1; i <= 40; i++) last = panRouteBy(base, i * 3, i * -1.5);
    expect(last).toEqual(once);
    // 動かした量は枠の px（ROUTE_FRAME）で、ズーム 15 の世界の px と同じ
    const c0 = project(base.center, 15);
    const c1 = project(once.center, 15);
    expect(c0.x - c1.x).toBeCloseTo(120, 0);
  });

  it("真ん中は日本の周りに収める", () => {
    const far = panRouteBy({ center: { lat: 33.84, lng: 132.765 }, z: 9 }, -1e6, 0);
    expect(far.center.lng).toBeLessThanOrEqual(154);
  });

  it("ホイール・2 本の指の拡大は段（整数）ごとで、カーソルの下の地点が残る", () => {
    const at = { x: ROUTE_FRAME.w * 0.75, y: ROUTE_FRAME.h * 0.25 };
    const under = (v: typeof base) => {
      const c = project(v.center, v.z);
      return unproject({ x: c.x + at.x - ROUTE_FRAME.w / 2, y: c.y + at.y - ROUTE_FRAME.h / 2 }, v.z);
    };
    const z16 = zoomRouteAt(base, 1, at);
    expect(z16.z).toBe(16);
    expect(under(z16).lat).toBeCloseTo(under(base).lat, 4);
    expect(under(z16).lng).toBeCloseTo(under(base).lng, 4);
    expect(zoomRouteAt({ ...base, z: 18 }, 1, at)).toEqual({ ...base, z: 18 });
  });
});

describe("雨の凡例は小さな帯（色の帯と数字と時刻だけ）", () => {
  const legendOf = (h: string) => h.match(/<div[^>]*data-rain-legend[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  const nowcast = renderToStaticMarkup(createElement(NowcastLayer, { time: NOWC_TIME, view: FIT, size: BASE_SIZE }));

  it("本物の雨雲: 右下に「02:20 時点」と mm/h、8 段の色の帯（左が弱い）、段の境の値。気象庁の凡例の画像も出典の長い文も枠の中に無い", () => {
    const legend = legendOf(nowcast);
    expect(legend).not.toBe("");
    expect(legend).toContain('data-rain-legend="nowcast"');
    expect(legend).toMatch(/class="[^"]*absolute right-1 bottom-1[^"]*"/);
    expect(legend).toContain(">02:20 時点<");
    expect(legend).toContain("mm/h");
    const chips = [...legend.matchAll(/data-rain-legend-step="(\d+)" style="background:(#[0-9a-f]{6})/g)].map((m) => [Number(m[1]), m[2]]);
    expect(chips).toEqual(RAIN_STEPS.map((s) => [s.min, s.color]));
    const bounds = [...legend.matchAll(/data-rain-legend-bound="(\d+)"[^>]*>(\d+)</g)].map((m) => Number(m[2]));
    expect(bounds).toEqual([1, 5, 10, 20, 30, 50, 80]);
    // 前の白い四角の中身（気象庁の凡例の画像、出典の 1 文）は無い。ブラウザは気象庁を直接読まない
    expect(nowcast).not.toContain("jma.go.jp");
    expect(nowcast).not.toContain(NOWC_SOURCE.text);
    expect(legend).not.toContain("<img");
    expect(legend).not.toContain("<a ");
  });

  it("大きさ: 帯の幅は 8 段 × 15px（小さな地図の基準の幅 352px の 3 分の 1 ほど）、行は見出し・色・数字の 3 つ、字は 10px", () => {
    expect(LEGEND_CHIP_W * RAIN_STEPS.length).toBeLessThanOrEqual(BASE_SIZE.w * 0.36);
    const legend = legendOf(nowcast);
    const inner = legend.replace(/^<div[^>]*>/, "").replace(/<\/div>$/, "");
    expect([...inner.matchAll(/<div /g)]).toHaveLength(3);
    expect(legend).toMatch(/class="[^"]*text-\[10px\][^"]*"/);
    expect(legend).not.toMatch(/max-w-\[60%\]|max-h-24/);
  });

  it("訓練の雨も同じ部品で、見出しは「想定」（「気象庁」の語は出さない）", () => {
    const anchor = rainAnchor(pins.map((p) => p.location));
    const h = renderToStaticMarkup(
      createElement(CaseMap, { pins, layers: [], demo: demoOverlay({ kind: "heavy_rain", level: 4, drill: { track: HEAVY_RAIN_TRACK, hour: 3, anchor } }), unplaced: 0 }),
    );
    const legend = legendOf(h);
    expect(legend).toContain('data-rain-legend="drill"');
    expect(legend).toContain(">想定<");
    expect(legend).toContain("mm/h");
    expect(h).not.toContain("気象庁");
  });

  it("出典は地図の下の出典の行に、気象庁の文のまま（雨雲を重ねているときだけ。地理院タイルも残る）", () => {
    const choice = (rainOn: boolean) => ({ on: new Set<never>(), toggle: () => {}, rainOn, toggleRain: () => {}, nowcast: NOWC_TIME });
    const full = (rainOn: boolean) =>
      renderToStaticMarkup(createElement(FullMap, { pins, demo: null, unplaced: 0, choice: choice(rainOn), onClose: () => {}, initialSize: { w: 1200, h: 700 } }));
    const on = full(true);
    const caption = on.match(/<figcaption[^>]*data-attribution[\s\S]*?<\/figcaption>/)?.[0] ?? "";
    expect(caption).toContain("地理院タイル");
    expect(caption).toContain(NOWC_SOURCE.text);
    expect(caption).toContain(`href="${NOWC_SOURCE.href}"`);
    expect(on).toContain('data-rain-legend="nowcast"');
    // 雨雲を外せば凡例も出典の行の雨雲も消える（地理院タイルは残る）
    const off = full(false);
    expect(off).not.toContain("data-rain-legend");
    expect(off).not.toContain(NOWC_SOURCE.text);
    expect(off).toContain("地理院タイル");
  });
});
