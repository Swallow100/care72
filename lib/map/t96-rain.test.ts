// T96 雨雲の見た目（docs/tasks/T96.md の 1）。
// T96 は濃い墨の長い斜線（T66）を、淡い青灰の面と短い雨の筋に替えた。T116 で、訓練の雨は 1 時間の降水量の段ごとの色（気象庁の
// 降水ナウキャストと同じ 8 段と色）に替えた（本物の雨雲と同じ読み方。docs/DECISIONS.md「地図と災害の情報」）。
// ここには T96 の意図のうち今も効く物（雨雲に見える・長い線や破線の縁が無い・描くたびに変わらない・凡例の言葉とデモの印）を残す。
// 段の色と凡例の細かい所は lib/map/t116.test.ts。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseMap } from "../../components/map/CaseMap.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import { HEAVY_RAIN_TRACK } from "../drill/rain.ts";
import { demoOverlay } from "./demo.ts";
import { rainAnchor } from "./drill-rain.ts";
import { RAIN_STEPS } from "./rain-scale.ts";
import { mapPins } from "./side.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
const pins = mapPins(rows, "tier");

describe("雨雲の描き（components/map/CaseMap.tsx の Rain）", () => {
  // 雨雲は訓練の筋書きの雨（T103。いちばん強い 3 時間）
  const svgOf = (level: 3 | 4 | 5) => {
    const demo = demoOverlay({ kind: "heavy_rain", level, drill: { track: HEAVY_RAIN_TRACK, hour: 3, anchor: rainAnchor(pins.map((p) => p.location)) } });
    const html = renderToStaticMarkup(createElement(CaseMap, { pins, layers: ["flood"], demo, unplaced: 0 }));
    return { html, demo, rain: html.match(/<svg[^>]*data-demo="rain"[\s\S]*?<\/svg>/)?.[0] ?? "" };
  };

  it("輪ごとに段の色の塗り。斜線（回した長い線）・破線の縁・雨の筋のくり返しは無い", () => {
    const { html, demo, rain } = svgOf(5);
    expect(rain).not.toBe("");
    expect([...rain.matchAll(/data-rain-step="\d+"/g)]).toHaveLength(demo.rain.length);
    expect(rain).not.toContain("stroke-dasharray");
    expect(rain).not.toContain("rotate(");
    expect(rain).not.toContain("<pattern");
    expect(rain).not.toContain("<line");
    // 描くたびに変わらない（サーバーと手元の描画が食い違わない）
    expect(svgOf(5).rain).toBe(rain);
    // 凡例の言葉とデモの印はそのまま
    expect(html).toContain('data-demo="label"');
    expect(html).toContain("大雨 レベル 5");
    expect(html).toContain("想定値");
  });

  it("レベル 3 は 10〜20 の段まで（それより強い段の色は描かない）", () => {
    const { rain } = svgOf(3);
    expect(rain).toContain('data-rain-step="10"');
    for (const s of RAIN_STEPS.filter((x) => x.min >= 20)) expect(rain).not.toContain(`data-rain-step="${s.min}"`);
  });
});
