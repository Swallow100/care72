// T128 の 2 つ目: 上の帯の段の表（lib/drill/strip.ts）、区域の出来事の対象（lib/drill/area-targets.ts）、新着の決め（lib/drill/news.ts）と、
// 帯・被害状況・経過・対応と経過の並び・新着の描き。Claude は呼ばない。D1 も使わない（経過の行は固定の刻みと手から）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DamagePanel } from "../../components/drill/DamagePanel.tsx";
import { DrillLog } from "../../components/drill/DrillLog.tsx";
import { DrillPanes } from "../../components/drill/DrillPanes.tsx";
import { NewsBar } from "../../components/drill/NewsBar.tsx";
import { newsItemsOf, rowLine, StripRows } from "../../components/drill/StripRows.tsx";
import { ExpandRow } from "../../components/list/ExpandRow.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { timeBaseOf } from "./act-time.ts";
import { areaTargetOf, familyName, FLOOD_TARGET_DEPTH_M, targetText, type AreaPerson } from "./area-targets.ts";
import type { ActionRecord, ActionResult, DrillIncident, DrillTurn, Tick } from "./engine.ts";
import { NO_CALL } from "./event-catalog.ts";
import { BAND_LABELS } from "./labels.ts";
import { newsShown, NEWS_SHOW, parseSeen, splitNews, tabOfAnchor, type NewsItem } from "./news.ts";
import { inOutageArea } from "./persona.ts";
import { EMPTY_WORLD, type WorldChange, type WorldEventKind, type WorldState } from "./scenarios.ts";
import { buildStrip, clusterMarks, clusterTone, INCIDENT_LANE, incidentLane, logAnchorId, markOf, STRIP_LABELS, STRIP_ORDER, worsened } from "./strip.ts";
import { buildDrillLog } from "./timeline.ts";
import { bandsOf } from "./view.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/** 日本の 13:44 に発災 */
const START = "2026-11-05T04:44:00.000Z";
const BASE = timeBaseOf(START, false);

const inc = (over: Partial<DrillIncident> & Pick<DrillIncident, "change" | "text" | "at">): DrillIncident => ({ actor: "world", ai: false, ...over });
const turn = (over: Partial<DrillTurn> & Pick<DrillTurn, "person" | "at">): DrillTurn => ({
  color: "green",
  source: "agent",
  whereNow: "home",
  injured: null,
  atHome: null,
  canMove: null,
  hasMedicine: null,
  saying: null,
  doing: null,
  ai: false,
  ...over,
});
const tick = (step: number, hour: number, incidents: DrillIncident[], turns: DrillTurn[] = []): Tick => ({
  step,
  hour,
  incidents,
  turns,
  world: EMPTY_WORLD,
  finished: false,
});
function result(over: Partial<ActionResult> & Pick<ActionResult, "status" | "atMinute">): ActionResult {
  return { ok: true, because: null, text: "", ai: false, speech: null, speechAi: false, pickup: null, cleared: [], staff: 0, crossed: [], ...over };
}
function action(id: string, person: string | null, atMinute: number, r: ActionResult | null): ActionRecord {
  return {
    id,
    kind: "call_person",
    person,
    target: null,
    callee: "self",
    calleeLabel: null,
    at: atMinute / 60,
    atMinute,
    endMinute: atMinute + 10,
    minutes: 10,
    step: 0,
    before: { person: null, marks: {}, staff: 2, phone: "ok", roadClosed: false },
    result: r,
  };
}

/** 種の 10 人の台帳のハザードと町（view.ts の area と同じ作り） */
const PEOPLE: AreaPerson[] = SEED_PEOPLE.map((p) => ({
  id: p.person.id,
  hazards: p.ledger.evacuation.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null })),
  town: p.ledger.basic.address?.town ?? null,
}));
const NAMES: Record<string, string> = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, p.person.name]));
const withHazard = (kind: string, min = 0) =>
  PEOPLE.filter((p) => p.hazards.some((h) => h.kind === kind && (min <= 0 || (h.depthM ?? 0) >= min))).map((p) => p.id);

// 地震の 0 時間: 地震・津波（避難）・停電（全域）・電話（通話不可）、p-03 の緑（本人のボタン）、p-08 の赤。
// 1 時間: 道路の通行止め、避難所の開設、持ち出し忘れ（非公表）。2 時間: p-02 の家族の連絡（電話の形の着信）。手: 0:20〜0:30 本人電話（出た）
const QUAKE_TICKS: Tick[] = [
  tick(
    0,
    0,
    [
      inc({ change: { kind: "quake", intensity: "6強" }, text: "南海トラフ 震度 6強", at: 0 }),
      inc({ change: { kind: "tsunami", state: "evacuate" }, text: "津波警報、沿岸に避難指示", at: 0 }),
      inc({ change: { kind: "outage", area: { scope: "office" } }, text: "停電 全域", at: 0 }),
      inc({ change: { kind: "phone", state: "down" }, text: `電話 ${NO_CALL}`, at: 0 }),
    ],
    [turn({ person: "p-03", at: 0, saying: "家にいます" }), turn({ person: "p-08", at: 0, color: "red", saying: "足が痛い" })],
  ),
  tick(1, 1, [
    inc({ change: { kind: "road", id: "rd-3", label: "沿岸の道", open: false }, text: "沿岸の道 通行止", at: 1 }),
    inc({ change: { kind: "shelter", id: "sh-2", label: "高台の集会所", state: "open" }, text: "高台の集会所 開設", at: 1 }),
    inc({ change: { kind: "supply_left" }, text: "栄養剤の持ち出し忘れ", person: "p-06", at: 1, actor: "director" }),
  ]),
  tick(2, 2, [], [turn({ person: "p-02", at: 2, source: "family", saying: "電池が心配" })]),
];
const QUAKE_ACTIONS: ActionRecord[] = [action("a1", "p-03", 20, result({ status: "connected", speech: "大丈夫", atMinute: 30 }))];

// ---------- 1. 上の帯の段 ----------

describe("上の帯の段の表（lib/drill/strip.ts）", () => {
  it("段の並びは 災害・帯の段（BAND_LABELS の並び）・道路施設・避難所・本人・連絡・対応。名前は 2〜4 字", () => {
    expect(STRIP_ORDER).toEqual(["disaster", ...Object.keys(BAND_LABELS), "infra", "shelter", "person", "contact", "act"]);
    for (const l of STRIP_ORDER) {
      expect([...STRIP_LABELS[l]].length).toBeGreaterThanOrEqual(2);
      expect([...STRIP_LABELS[l]].length).toBeLessThanOrEqual(4);
    }
  });

  it("状況の種類ごとの段（全部の種類を持つ）。情報は話題で、世界の 1 文は本人が付けば本人", () => {
    const kinds = Object.keys(INCIDENT_LANE) as WorldEventKind[];
    expect(kinds).toContain("tsunami");
    expect(incidentLane({ change: { kind: "tsunami", state: "evacuate" } })).toBe("disaster");
    expect(incidentLane({ change: { kind: "outage", area: { scope: "office" } } })).toBe("outage");
    expect(incidentLane({ change: { kind: "phone", state: "down" } })).toBe("phone");
    expect(incidentLane({ change: { kind: "road", id: "r", label: "道", open: false } })).toBe("infra");
    expect(incidentLane({ change: { kind: "note", topic: "water_station" } })).toBe("shelter");
    expect(incidentLane({ change: { kind: "note", topic: "landslide_warn" } })).toBe("disaster");
    expect(incidentLane({ change: { kind: "note", topic: "self_outage" } })).toBe("act");
    expect(incidentLane({ change: { kind: "narration", room: "", via: "room" }, person: "p-01" })).toBe("person");
    expect(incidentLane({ change: { kind: "narration", room: "", via: "room" } })).toBe("disaster");
    expect(incidentLane({ change: { kind: "ai_stop", stopped: ["persona"] } })).toBeNull();
    expect(incidentLane({ change: { kind: "schedule", at: 60, by: "director", then: { kind: "arrival", role: "staff" } } })).toBeNull();
  });

  it("悪くなった状況は要確認の色、解除・復旧・開設は本文色・灰", () => {
    expect(worsened({ kind: "tsunami", state: "evacuate" })).toBe(true);
    expect(worsened({ kind: "tsunami", state: "lifted" })).toBe(false);
    expect(worsened({ kind: "road", id: "r", label: "道", open: false })).toBe(true);
    expect(worsened({ kind: "road", id: "r", label: "道", open: true })).toBe(false);
    expect(worsened({ kind: "shelter", id: "s", label: "所", state: "open" })).toBe(false);
    expect(worsened({ kind: "shelter", id: "s", label: "所", state: "full" })).toBe(true);
    expect(worsened({ kind: "outage_restored" })).toBe(false);
    expect(worsened({ kind: "alert", level: null })).toBe(false);
  });

  it("経過の行から段を作る。進行中は本人に起きたこと（非公表）を出さない。緑の安否は印にしない（赤と着信だけ）。空の段は出さない", () => {
    const running = buildDrillLog(QUAKE_TICKS, QUAKE_ACTIONS, { finished: false });
    const bands = bandsOf(QUAKE_TICKS);
    const lanes = buildStrip(running, [...new Set(bands.map((b) => b.kind))]);
    expect(lanes.map((l) => l.lane)).toEqual(["disaster", "outage", "phone", "infra", "shelter", "contact", "act"]);
    const contact = lanes.find((l) => l.lane === "contact")!;
    // p-08 の赤と、p-02 の家族からの連絡（電話の形の着信）。p-03 の緑（本人のボタン）は印にしない
    expect(contact.marks.map((m) => (m.row.source === "signal" ? m.row.t.person : null))).toEqual(["p-08", "p-02"]);
    expect(contact.marks.map((m) => m.tone)).toEqual(["urgent", "call"]);
    // 公表の状況は発生と把握の両方にあるが印は 1 つ、押すと発生のタブ
    const disaster = lanes.find((l) => l.lane === "disaster")!;
    expect(disaster.marks.map((m) => m.tab)).toEqual(["occur", "occur"]);
    // 手は始まりから終わり
    const act = lanes.find((l) => l.lane === "act")!.marks[0];
    expect([act.minute, act.end, act.tab]).toEqual([20, 30, "act"]);
    // 終わった訓練は本人の段（持ち出し忘れ）も出す
    const done = buildStrip(buildDrillLog(QUAKE_TICKS, QUAKE_ACTIONS, { finished: true }), ["outage", "phone"]);
    expect(done.map((l) => l.lane)).toContain("person");
  });

  it("近い印は 1 つにまとめる（60 分の内）。まとめた色は強い方", () => {
    const log = buildDrillLog(QUAKE_TICKS, QUAKE_ACTIONS, { finished: true });
    const disaster = log.occur.flatMap((r) => {
      const m = markOf(r);
      return m && m.lane === "disaster" ? [m] : [];
    });
    const c = clusterMarks(disaster);
    expect(c).toHaveLength(1);
    expect(c[0].marks).toHaveLength(2);
    expect(clusterTone(c[0])).toBe("check");
    expect(clusterMarks([...disaster, { ...disaster[0], key: "x", minute: 200 }])).toHaveLength(2);
  });

  it("錨の id とタブ（帯の印・新着の href と経過の行の前の錨が同じ）", () => {
    expect(logAnchorId("occur", "i-0-1")).toBe("log-occur-i-0-1");
    expect(tabOfAnchor("#log-know-s-2-0")).toBe("know");
    expect(tabOfAnchor("#log-act-a-a1")).toBe("act");
    expect(tabOfAnchor("#row-p-01")).toBeNull();
  });

  it("帯の描き: 段の名前・今の様子・印の href と title（時刻・種類・文・対象）。帯の段は帯の棒", () => {
    const log = buildDrillLog(QUAKE_TICKS, QUAKE_ACTIONS, { finished: false });
    const bands = bandsOf(QUAKE_TICKS);
    const world: WorldState = {
      ...EMPTY_WORLD,
      quake: "6強",
      tsunami: "evacuate",
      outage: { area: { scope: "office" }, since: 0, restoredAt: null },
      phone: "down",
    };
    const html = renderToStaticMarkup(
      createElement(StripRows, { lanes: buildStrip(log, ["outage", "phone"]), bands, last: 72, now: 2, world, names: NAMES, people: PEOPLE, base: BASE }),
    );
    expect(html).toContain('data-strip-lane="disaster"');
    expect(html).toContain('data-band="outage"');
    // 0 時間の地震と津波は 1 つにまとめ、押すと新しい方（津波）へ
    expect(html).toContain('href="#log-occur-i-0-1"');
    expect(html).toContain('data-count="2"');
    expect(html).toContain('href="#log-act-a-a1"');
    // 津波の印の title に対象（津波のハザードの人）、停電の今の様子
    expect(html).toContain(`津波警報、沿岸に避難指示 対象 1 人 ${familyName(NAMES["p-08"])}`);
    expect(html).toContain("停電中");
    expect(html).toContain(NO_CALL);
    expect(html).not.toMatch(/gradient|shadow-/);
  });
});

// ---------- 4. 区域の出来事の対象 ----------

describe("区域の出来事の対象（lib/drill/area-targets.ts、T125 の関数までの仮）", () => {
  const t = (c: WorldChange) => areaTargetOf(c, PEOPLE);

  it("津波の避難は津波のハザードの人。解除は対象なし", () => {
    expect(withHazard("tsunami")).toEqual(["p-08"]);
    expect(t({ kind: "tsunami", state: "evacuate" })).toEqual({ persons: ["p-08"], office: null });
    expect(t({ kind: "tsunami", state: "lifted" })).toBeNull();
  });

  it("警戒レベルは浸水か土砂のハザードの人、川の氾濫は浸水 3 m 以上、土砂の警戒は土砂の人", () => {
    expect(t({ kind: "alert", level: 4 })!.persons.sort()).toEqual([...new Set([...withHazard("flood"), ...withHazard("landslide")])].sort());
    expect(t({ kind: "alert", level: null })).toBeNull();
    expect(t({ kind: "flood" })!.persons).toEqual(withHazard("flood", FLOOD_TARGET_DEPTH_M));
    expect(t({ kind: "note", topic: "landslide_warn" })!.persons).toEqual(withHazard("landslide"));
    expect(t({ kind: "note", topic: "water_station" })).toBeNull();
    expect(t({ kind: "quake", intensity: "6強" })).toBeNull();
  });

  it("停電は範囲に入る人（lib/drill/persona.ts の inOutageArea と同じ答え）。全域は事業所も対象", () => {
    const areas = [
      { scope: "office" as const },
      { scope: "hazard" as const, hazard: "flood" as const, minDepthM: 3 },
      { scope: "towns" as const, towns: ["かわなぎ町"] },
    ];
    for (const area of areas) {
      const got = t({ kind: "outage", area })!;
      const want = PEOPLE.filter((p) => inOutageArea(area, p.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null })), p.town)).map((p) => p.id);
      expect(got.persons).toEqual(want);
      expect(got.office).toBe(area.scope === "office" ? true : null);
    }
  });

  it("町の出来事は出来事の持つ人", () => {
    expect(t({ kind: "town_flood", town: "かわなぎ町", depthM: 3, persons: ["p-02", "p-01"] })!.persons).toEqual(["p-01", "p-02"]);
  });

  it("対象の 1 行: 人数・姓（3 人まで）・他 N 人・全員・事業所（分からなければ出さない）", () => {
    expect(familyName("伊藤 フミ")).toBe("伊藤");
    expect(targetText({ persons: ["p-08"], office: null }, NAMES, 10)).toBe(`対象 1 人 ${familyName(NAMES["p-08"])}`);
    const four = ["p-01", "p-02", "p-03", "p-04"];
    expect(targetText({ persons: four, office: false }, NAMES, 10)).toBe(
      `対象 4 人 ${four.slice(0, 3).map((p) => familyName(NAMES[p])).join("・")} 他 1 人 事業所 対象外`,
    );
    expect(targetText({ persons: PEOPLE.map((p) => p.id), office: true }, NAMES, 10)).toBe("対象 10 人 全員 事業所 対象");
    expect(targetText({ persons: [], office: null }, NAMES, 10)).toBe("対象 0 人");
  });

  it("被害状況の行に対象。人は左の表の行へ（#row-<id>）、事業所が分からなければ事業所を出さない", () => {
    const world: WorldState = { ...EMPTY_WORLD, quake: "6強", tsunami: "evacuate", outage: { area: { scope: "office" }, since: 0, restoredAt: null } };
    const html = renderToStaticMarkup(createElement(DamagePanel, { kind: "earthquake", world, now: 1, names: NAMES, people: PEOPLE }));
    const tsunami = html.slice(html.indexOf('data-world="tsunami"'), html.indexOf('data-world="outage"'));
    expect(tsunami).toContain('data-targets="1"');
    expect(tsunami).toContain('href="#row-p-08"');
    expect(tsunami).not.toContain("data-targets-office");
    expect(tsunami).not.toContain("事業所");
    const outage = html.slice(html.indexOf('data-world="outage"'), html.indexOf('data-world="phone"'));
    expect(outage).toContain('data-targets-office="true"');
    expect(outage).toContain("全員");
    // people を渡さない所（前からの呼び方）は前のまま
    expect(renderToStaticMarkup(createElement(DamagePanel, { kind: "earthquake", world, now: 1, names: NAMES }))).not.toContain("data-targets");
  });

  it("表の行に錨（#row-<id>）", () => {
    const row = createElement(ExpandRow, { id: "p-01", cols: 2, head: "至急", cells: null, detail: null, label: "山田", cellClass: "" });
    const html = renderToStaticMarkup(createElement("table", null, createElement("tbody", null, row)));
    expect(html).toContain('id="row-p-01"');
  });
});

// ---------- 2・3. 経過の置き場所と新着 ----------

describe("新着と経過の置き場所", () => {
  const item = (key: string, minute: number): NewsItem => ({ key, tab: "occur", minute, at: "", text: key });
  const items = [item("i-0-0", 0), item("i-0-1", 0), item("s-1-0", 60), item("i-1-0", 60)];

  it("初めて開いた訓練（見た記録が無い）は新着なしで全部を見たことに", () => {
    expect(splitNews(items, null)).toEqual({ fresh: [], seen: items.map((x) => x.key) });
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen("壊れた")).toBeNull();
    expect(parseSeen(JSON.stringify(["a", 1]))).toEqual(new Set(["a"]));
  });

  it("見た集合に無い行が新着（新しい順）。出したら見たことに", () => {
    const r = splitNews(items, new Set(["i-0-0", "i-0-1"]));
    expect(r.fresh.map((x) => x.key)).toEqual(["s-1-0", "i-1-0"]);
    expect(new Set(r.seen)).toEqual(new Set(items.map((x) => x.key)));
    expect(splitNews(items, new Set(r.seen)).fresh).toEqual([]);
  });

  it("並べるのは 3 件と「他 N 件」", () => {
    const many = Array.from({ length: 5 }, (_, i) => item(`k${i}`, i));
    expect(NEWS_SHOW).toBe(3);
    expect(newsShown(many)).toEqual({ shown: many.slice(0, 3), rest: 2 });
  });

  it("新着の候補は経過の発生・把握の行（公表の状況は 1 つ、手は入れない）。文は短い 1 行と訓練の中の時刻", () => {
    const log = buildDrillLog(QUAKE_TICKS, QUAKE_ACTIONS, { finished: false });
    const ctx = { names: NAMES, people: PEOPLE, base: BASE };
    const news = newsItemsOf(log, ctx);
    const keys = news.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.some((k) => k.startsWith("a-"))).toBe(false);
    expect(keys).toContain("h-a1");
    const tsunami = news.find((x) => x.key === "i-0-1")!;
    expect(tsunami.at).toBe("13:44");
    expect(tsunami.text).toBe(rowLine(log.occur.find((r) => r.key === "i-0-1")!, ctx));
    expect(tsunami.text).toContain("対象 1 人");
    // 進行中に出さない行（持ち出し忘れ）は候補にも入らない
    expect(news.some((x) => x.text.includes("持ち出し忘れ"))).toBe(false);
  });

  it("サーバーの描きでは新着を出さない（端末の見た記録で決める）", () => {
    expect(renderToStaticMarkup(createElement(NewsBar, { drillId: "d1", items }))).toBe("");
  });

  it("経過の行の前に錨（id は logAnchorId）、まとまりの見出しに隠した新着の印、対応の時刻は訓練の中の時刻", () => {
    const html = renderToStaticMarkup(
      createElement(DrillLog, { ticks: QUAKE_TICKS, actions: QUAKE_ACTIONS, names: NAMES, startedAt: START, finished: false, initial: "occur" }),
    );
    expect(html).toContain('id="log-occur-i-0-1"');
    expect(html).toContain('id="log-know-s-0-1"');
    expect(html).toContain('id="log-act-a-a1"');
    expect(html).toMatch(/<li id="log-occur-i-0-0" aria-hidden="true" class="[^"]*absolute[^"]*h-0/);
    expect(html).toContain('data-new-for="i-0-0 i-0-1 i-0-2 i-0-3"');
    expect(html).toContain("14:04〜14:14");
    expect(html).toContain("所要 10 分");
  });

  it("対応と経過: 1536px 以上は 2 列（切替は隠す）、それ未満は切替。片方が無ければ経過だけ", () => {
    const wide = renderToStaticMarkup(
      createElement(DrillPanes, { main: "M", log: "L", mainLabel: "対応", logLabel: "経過", logCount: 3, wide: true, label: "対応切替" }),
    );
    expect(wide).toContain("2xl:grid-cols-2");
    expect(wide).toMatch(/role="tablist"[^>]*class="[^"]*2xl:hidden/);
    expect(wide).toMatch(/class="[^"]*hidden 2xl:block[^"]*" data-pane="log"/);
    expect(wide).toMatch(/経過 <span[^>]*data-tab-count[^>]*>3<\/span>/);
    const narrow = renderToStaticMarkup(createElement(DrillPanes, { main: "M", log: "L", mainLabel: "対応", logLabel: "経過", wide: false, label: "対応切替" }));
    expect(narrow).not.toContain("2xl:");
    const only = renderToStaticMarkup(createElement(DrillPanes, { main: null, log: "L", mainLabel: "採点", logLabel: "経過", wide: true, label: "対応切替" }));
    expect(only).not.toContain("tablist");
    expect(only).toContain("L");
  });
});
