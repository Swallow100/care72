// 地図の出典の行の「位置は架空」（docs/tasks/T114.md の 1）。デモ事業所（種の架空の位置）だけに出し、本物の事業所
// （tools/office/new-office.ts で作った事業所。台帳の位置は人が地図で置いた本物の位置）には出さない。
// 担当一覧の右の面（components/list/SidePane.tsx）・全画面（FullMap）・訓練の画面（CaseMap を直に）の 3 か所。
// 出典（地理院タイル・ハザードマップポータルサイト）はどちらでも出す。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidePane, type SideMapOptions } from "../../components/list/SidePane.tsx";
import { CaseMap, FullMap } from "../../components/map/CaseMap.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { sortCaseload, toCaseloadRows } from "../caseload.ts";
import { BASE_LAYER } from "./layers.ts";
import { buildSidePane, mapPins } from "./side.ts";

const MARK = "位置は架空";
const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = sortCaseload(toCaseloadRows(people, clocks, contacts, "2026-11-02"), "tier");
const data = buildSidePane(rows, { sort: "tier" });
const pins = mapPins(rows, "tier");
const choice = { on: new Set(["flood"] as const), toggle: () => {}, rainOn: true, toggleRain: () => {} };

const side = (map?: SideMapOptions) => renderToStaticMarkup(createElement(SidePane, map ? { data, map } : { data }));
/** 出典の行（figcaption）だけ */
const caption = (html: string) => html.match(/<figcaption[^>]*data-attribution[^>]*>[\s\S]*?<\/figcaption>/g) ?? [];

describe("地図の出典の行の「位置は架空」", () => {
  it("デモ事業所（fictional）の右の面: 出典の行に出典と「位置は架空」", () => {
    const html = side({ center: null, nowcast: false, fictional: true });
    const [c] = caption(html);
    expect(c).toContain(BASE_LAYER.attribution.href);
    expect(c).toContain(MARK);
  });

  it("本物の事業所の右の面: 出典は出すが「位置は架空」は出さない", () => {
    const html = side({ center: { lat: 34.07, lng: 132.99 }, nowcast: false, fictional: false });
    const [c] = caption(html);
    expect(c).toContain(BASE_LAYER.attribution.href);
    expect(c).toContain(">地理院タイル</a>");
    expect(html).not.toContain(MARK);
  });

  it("地図の選び方を渡さない（読めなかった）ときも出さない（本物の事業所の地図に架空と書かない側に倒す）", () => {
    expect(side()).not.toContain(MARK);
    expect(caption(side()).length).toBe(1);
  });

  it("CaseMap を直に描く（訓練の画面）: 既定は出さず、fictional のときだけ出す", () => {
    const plain = renderToStaticMarkup(createElement(CaseMap, { pins, layers: ["flood"], demo: null, unplaced: 0 }));
    expect(caption(plain)).toHaveLength(1);
    expect(plain).not.toContain(MARK);
    const demo = renderToStaticMarkup(createElement(CaseMap, { pins, layers: ["flood"], demo: null, unplaced: 0, fictional: true }));
    expect(caption(demo)[0]).toContain(MARK);
  });

  it("全画面も小さな地図と同じ: 本物の事業所は出さず、デモ事業所は出す", () => {
    const size = { w: 1280, h: 800 };
    const real = renderToStaticMarkup(createElement(FullMap, { pins, demo: null, unplaced: 0, choice, onClose: () => {}, initialSize: size }));
    expect(caption(real)[0]).toContain(BASE_LAYER.attribution.href);
    expect(real).not.toContain(MARK);
    const demo = renderToStaticMarkup(
      createElement(FullMap, { pins, demo: null, unplaced: 0, choice, fictional: true, onClose: () => {}, initialSize: size }),
    );
    expect(caption(demo)[0]).toContain(MARK);
  });

  it("画面の入口: 担当一覧と訓練の画面は、事業所の種類がデモのときだけ fictional を渡す", () => {
    const list = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
    expect(list).toMatch(/fictional: false/);
    expect(list).toMatch(/fictional: principal\.office\.kind === "demo"/);
    const drill = readFileSync(new URL("../../app/drill/[id]/page.tsx", import.meta.url), "utf8");
    expect(drill).toMatch(/fictional=\{principal\.office\?\.kind === "demo"\}/);
  });
});
