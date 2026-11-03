// 雨雲・震度のデモの絵はデモ事業所だけ、地図の真ん中は事業所の中心（docs/tasks/T72.md の 3）のテスト。
// - sideDisasterOf: デモ事業所は今まで通りの場面、デモでない事業所（regular・unaffiliated）は場面なし（雨雲・震度のデモの帯を出さない）。
//   事業所を渡さない（訓練の画面。場面は筋書きの物）は今まで通り
// - 地図の真ん中（ピンが無いとき）: 事業所の中心 → 無ければ松山市の市街（FALLBACK）

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidePane } from "../../components/list/SidePane.tsx";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { OFFICE_KINDS } from "../db/types.ts";
import type { TriageSignal } from "../triage/index.ts";
import { DEFAULT_CENTER } from "./center.ts";
import { project, TILE } from "./geo.ts";
import { buildSidePane, sideDisasterOf } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const signals = new Map<string, TriageSignal[]>([["p-01", [{ color: "red", source: "self", at: at(0.5), injured: null, canMove: null, classes: ["unknown"] }]]]);
const situation = { now: at(3.5), disasterAt: at(-2), outageAt: at(0), outageTowns: null };
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02", { situation, signals });

describe("デモの絵はデモ事業所だけ", () => {
  it("デモ事業所と、事業所を渡さない訓練の画面は今まで通りの場面。デモでない事業所は場面なし", () => {
    expect(OFFICE_KINDS).toEqual(["demo", "regular", "unaffiliated"]);
    expect(sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: 4 }, { office: "demo" })?.scene).toEqual({ kind: "heavy_rain", level: 4 });
    expect(sideDisasterOf(rows, { kind: "earthquake", alertLevel: null }, { office: "demo" })?.scene).toEqual({ kind: "earthquake" });
    expect(sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: 4 })?.scene).toEqual({ kind: "heavy_rain", level: 4 });
    for (const office of ["regular", "unaffiliated"] as const) {
      for (const kind of ["heavy_rain", "earthquake", "tsunami", "typhoon"] as const) {
        const side = sideDisasterOf(rows, { kind, alertLevel: 4 }, { office });
        expect(side?.scene, `${office} ${kind}`).toBeNull();
        // 発災時の面（ピンの色・連絡の順）はそのまま
        expect(side?.results.length).toBe(rows.length);
      }
    }
    expect(sideDisasterOf(rows, { kind: "normal", alertLevel: null }, { office: "regular" })).toBeNull();
  });

  it("本物の事業所の右の面: デモの帯（雨雲・震度 6 強・想定値）を出さない", () => {
    const html = (office: "demo" | "regular") =>
      renderToStaticMarkup(
        createElement(SidePane, {
          data: buildSidePane(rows, { sort: "tier", disaster: sideDisasterOf(rows, { kind: "earthquake", alertLevel: null }, { office }) }),
        }),
      );
    expect(html("demo")).toContain('data-demo="label"');
    expect(html("demo")).toContain("6強");
    expect(html("regular")).not.toContain('data-demo="label"');
    expect(html("regular")).not.toContain("6強");
    expect(html("regular")).not.toContain("想定値");
  });

  it("担当一覧の画面は事業所の種類を渡す（デモでない事業所に場面を作らない）", () => {
    const src = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/sideDisasterOf\(all, data\.disaster, \{ office: principal\.office\?\.kind \?\? "regular" \}\)/);
  });
});

describe("地図の真ん中（ピンが無いとき）", () => {
  /** 描いた下の地図のタイルの番号 */
  const tiles = (html: string) =>
    [...html.matchAll(/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/(\d+)\/(\d+)\/(\d+)\.png[^>]*data-layer="base"/g)].map((m) => `${m[1]}/${m[2]}/${m[3]}`);
  const tileOf = (p: { lat: number; lng: number }, z: number) => {
    const w = project(p, z);
    return `${z}/${Math.floor(w.x / TILE)}/${Math.floor(w.y / TILE)}`;
  };
  const render = (center?: { lat: number; lng: number }) =>
    renderToStaticMarkup(createElement(CaseMap, { pins: [], layers: [], demo: null, unplaced: 3, ...(center ? { center } : {}) }));

  it("事業所の中心があればそこ、無ければ松山市の市街", () => {
    const hiroshima = { lat: 34.3963, lng: 132.4596 };
    expect(tiles(render(hiroshima))).toContain(tileOf(hiroshima, 11));
    expect(tiles(render(hiroshima))).not.toContain(tileOf(DEFAULT_CENTER, 11));
    expect(tiles(render())).toContain(tileOf(DEFAULT_CENTER, 11));
  });

  it("ピンがあればピンが全部入る所（中心は使わない）", () => {
    const pin = { id: "p-01", label: "山田", title: "山田", location: { lat: 33.84, lng: 132.77 }, href: "/?open=p-01", tone: null, state: null, layer: 0 };
    const html = renderToStaticMarkup(createElement(CaseMap, { pins: [pin], layers: [], demo: null, unplaced: 0, center: { lat: 34.3963, lng: 132.4596 } }));
    expect(tiles(html).some((t) => t.startsWith("15/"))).toBe(true);
  });
});
