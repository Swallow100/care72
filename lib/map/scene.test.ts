// 災害の種類から地図の場面へ（docs/tasks/T60.md）。場面は lib/disaster/state.ts の DISASTER_SCENE の 1 つの表で引く。
// 台風・土砂は大雨の場面（警戒レベルが効く）、津波は地震の場面、その他は場面なし（雨雲・震度を出さず、ピン・ハザード・避難所は今まで通り）。
// 右の面・地図・全画面の地図が場面なしで落ちないこと。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidePane } from "../../components/list/SidePane.tsx";
import { FullMap } from "../../components/map/CaseMap.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { DISASTER_KINDS } from "../db/types.ts";
import { DISASTER_SCENE } from "../disaster/state.ts";
import type { TriageSignal } from "../triage/index.ts";
import { buildSidePane, sideDisasterOf } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));

const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const signals = new Map<string, TriageSignal[]>([
  ["p-01", [{ color: "red", source: "self", at: at(0.5), injured: null, canMove: null, classes: ["unknown"] }]],
  ["p-03", [{ color: "green", source: "family", at: at(-1) }]],
]);
const situation = { now: at(3.5), disasterAt: at(-2), outageAt: at(0), outageTowns: null };
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02", { situation, signals });

const pane = (kind: (typeof DISASTER_KINDS)[number], alertLevel: 3 | 4 | 5 | null = 4, drill = false) =>
  buildSidePane(rows, {
    sort: "tier",
    disaster: sideDisasterOf(rows, { kind, alertLevel }, drill ? { rain: { scenario: "heavy_rain", hour: 3 } } : {}),
  });

describe("場面の表から地図へ", () => {
  it("大雨・台風・土砂は大雨の場面（警戒レベルが名前に効き、訓練の雨の段にも効く。平時の担当一覧は雨を描かない）", () => {
    for (const kind of ["heavy_rain", "typhoon", "landslide"] as const) {
      expect(sideDisasterOf(rows, { kind, alertLevel: 4 })?.scene, kind).toEqual({ kind: "heavy_rain", level: 4 });
      const d = pane(kind, 5).demo!;
      expect(d.title, kind).toBe("大雨 レベル 5");
      expect(d.rain).toEqual([]);
      // 訓練の雨の段（降水量 mm/h の下の境。T116）: レベル 3 は 10〜20 まで、5 は表の 3 時間の芯（30〜50）まで
      const steps = (level: 3 | 5) => [...new Set(pane(kind, level, true).demo!.rain.map((b) => b.min))].sort((a, b) => a - b);
      expect(steps(5)).toEqual([0, 1, 5, 10, 20, 30]);
      expect(steps(3)).toEqual([0, 1, 5, 10]);
      expect(pane(kind, null).demo?.title).toBe("大雨");
    }
  });

  it("地震・津波は地震の場面（震度の印）", () => {
    for (const kind of ["earthquake", "tsunami"] as const) {
      expect(sideDisasterOf(rows, { kind, alertLevel: null })?.scene, kind).toEqual({ kind: "earthquake" });
      expect(pane(kind).demo?.quake?.intensity).toBe("6強");
    }
  });

  it("その他は場面なし: 雨雲・震度の層を出さず、発災時の面（ピンの色・状態ごとの人数・ハザード・避難先）は出る", () => {
    const side = sideDisasterOf(rows, { kind: "other", alertLevel: 4 });
    expect(side?.scene).toBeNull();
    const data = pane("other");
    expect(data.mode).toBe("disaster");
    expect(data.demo).toBeNull();
    expect(data.states?.reduce((n, s) => n + s.count, 0)).toBe(rows.length);
    expect(data.pins.every((p) => p.tone !== null)).toBe(true);
    expect(data.hazards.length).toBeGreaterThan(0);
    expect(data.destinations.length).toBeGreaterThan(0);

    const html = renderToStaticMarkup(createElement(SidePane, { data }));
    expect(html).toContain("data-pin");
    expect(html).not.toContain('data-demo="label"');
    expect(html).not.toContain('data-demo="rain"');
    expect(html).not.toContain('data-demo="quake"');
    // 平時の面の既定の層（浸水・土砂）のまま。台風の訓練の雨にはデモの印
    const rain = renderToStaticMarkup(createElement(SidePane, { data: pane("typhoon", 4, true) }));
    expect(rain).toContain('data-demo="label"');
  });

  it("全画面の地図も場面なしで落ちない（デモの印を出さない）", () => {
    const data = pane("other");
    const choice = { on: new Set(["flood"] as const), toggle: () => {}, rainOn: true, toggleRain: () => {} };
    const html = renderToStaticMarkup(
      createElement(FullMap, {
        pins: data.pins,
        demo: data.demo,
        unplaced: data.unplaced,
        choice,
        onClose: () => {},
        initialSize: { w: 1280, h: 800 },
      }),
    );
    expect(html).toContain("data-pin");
    expect(html).not.toContain('data-demo="label"');
  });

  it("どの災害の種類でも右の面が作れる。平時は平時の面", () => {
    for (const kind of DISASTER_KINDS) {
      const data = pane(kind);
      expect(data.mode, kind).toBe(kind === "normal" ? "normal" : "disaster");
      expect(Boolean(data.demo), kind).toBe(DISASTER_SCENE[kind] !== null);
    }
  });
});
