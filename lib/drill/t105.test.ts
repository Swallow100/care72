// T105: 経過の 3 つのタブ（発生・把握・対応）の分け方の表、訓練の途中に本人に起きたことを出さない／終わってから出す、
// 把握の遅れ・未把握、3 つのタブの描き、訓練記録の見比べ、電話の言い方（通話不可）。
// 訓練は node:sqlite の D1 と種の 10 人で本物の道（開始 → 手 → 最後まで進める）でも作る。Claude は呼ばない。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DamagePanel } from "../../components/drill/DamagePanel.tsx";
import { DrillLog } from "../../components/drill/DrillLog.tsx";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction } from "../db/types.ts";
import type { PseudonymKey } from "../pseudonym/index.ts";
import { ACTION_STATUS_LABELS } from "./actions.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import type { ActionRecord, ActionResult, DrillIncident, DrillTurn, Tick } from "./engine.ts";
import { EVENT_CATALOG, EVENT_LABELS, INJECT_TEXTS, markLabels, markWords, NO_CALL } from "./event-catalog.ts";
import { actionPost } from "./http.ts";
import { EVENT_KIND_LABELS, LOG_LABELS, MARK_LABELS, PHONE_LABELS } from "./labels.ts";
import { loadDrillRecord, type DrillRecord } from "./record.ts";
import { RESULT_WORDS, REVIEW_SYSTEM, WASTE_WORDS } from "./review.ts";
import { EMPTY_WORLD, type WorldEventKind, type WorldState } from "./scenarios.ts";
import { factWords, WASTE_LABELS } from "./score-labels.ts";
import { knownOf } from "./score.ts";
import {
  awareCounts,
  awareText,
  buildDrillLog,
  DEFAULT_LOG_TAB,
  INCIDENT_REACH,
  incidentReach,
  LOG_ROUTE,
  LOG_SOURCES,
  MARK_REACH,
  parseLogTab,
  scheduledPublic,
  arrivalPublic,
  tabsOf,
} from "./timeline.ts";
import { worldIncidents } from "./world-apply.ts";
import { decideWorldReply, WORLD_REPLY_LABELS } from "./world-reply.ts";

// ---------- 作る道具 ----------

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
  return {
    ok: true,
    because: null,
    text: "",
    ai: false,
    speech: null,
    speechAi: false,
    pickup: null,
    cleared: [],
    staff: 0,
    crossed: [],
    ...over,
  };
}

function action(id: string, kind: DrillAction, person: string | null, atMinute: number, r: ActionResult | null): ActionRecord {
  return {
    id,
    kind,
    person,
    target: null,
    callee: kind === "call_person" ? "self" : null,
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

// 0 時間: 警戒レベル（公表）と伊藤の言う事。2.5 時間: 栄養剤の持ち出し忘れ（佐藤、非公表）。3 時間: 家の電話の通話不可（高橋、公表）・
// 帰宅希望（田中、非公表）・家族の帰宅困難（鈴木、非公表）・AI 停止の印（出さない）と、佐藤の言う事・田中のする事（言う事なし）。
// 3 時間 25 分: 伊藤の言う事（鈴木への電話の途中）。
// 手: 3 時間 20 分に鈴木へ本人電話（通話不可。言葉は届かない）、3 時間 30 分に田中へ本人電話（出た。言う事）
const TICKS: Tick[] = [
  tick(0, 0, [inc({ change: { kind: "alert", level: 3 }, text: "警戒レベル 3", at: 0 })], [turn({ person: "p-01", at: 0, saying: "家にいます" })]),
  tick(
    1,
    3,
    [
      inc({ change: { kind: "supply_left" }, text: "家族が栄養剤を持ち出し忘れた", person: "p-06", at: 2.5, actor: "director" }),
      inc({ change: { kind: "line_down" }, text: `家の電話 ${NO_CALL}`, person: "p-02", at: 3, actor: "director", ai: true }),
      inc({ change: { kind: "going_home" }, text: "本人が家に帰ろうとする", person: "p-07", at: 3, actor: "director" }),
      inc({ change: { kind: "mark", mark: "familyAway" }, text: "家族 帰宅困難", person: "p-03", at: 3, actor: "director", ai: true, inject: "family_stranded" }),
      inc({ change: { kind: "ai_stop", stopped: ["persona"] }, text: "本人役 停止", at: 3 }),
    ],
    [
      turn({ person: "p-06", at: 3, saying: "避難所に着きました", source: "family" }),
      turn({ person: "p-07", at: 3, doing: "避難を渋る", ai: true }),
      turn({ person: "p-01", at: 205 / 60, saying: "停電しています" }),
    ],
  ),
];
const ACTIONS: ActionRecord[] = [
  action("a1", "call_person", "p-03", 200, result({ ok: false, status: "noLine", because: `家の電話 ${NO_CALL}`, atMinute: 210 })),
  action("a2", "call_person", "p-07", 210, result({ status: "ringing", speech: "わしは家に帰る", speechAi: true, pickup: "answers", atMinute: 220 })),
];

const keysOf = (rows: ReadonlyArray<{ source: string; key: string }>) => rows.map((r) => `${r.source}:${r.key}`);

// ---------- 分け方の表 ----------

describe("行の分け方の表（記録の種類 → タブ）", () => {
  it("状況・する事は発生、安否・手の返事で届いた事は把握、手は対応。公表の状況は把握にも", () => {
    // T127: 着信への応答・拒否（call）は対応、着信の往復で掛けてきた人の言った事（reply）は把握
    expect(LOG_SOURCES).toEqual(["incident", "doing", "signal", "heard", "action", "call", "reply"]);
    expect(LOG_ROUTE).toEqual({
      incident: ["occur"],
      doing: ["occur"],
      signal: ["know"],
      heard: ["know"],
      action: ["act"],
      call: ["act"],
      reply: ["know"],
    });
    expect(tabsOf("incident", "public")).toEqual(["occur", "know"]);
    expect(tabsOf("incident", "private")).toEqual(["occur"]);
    expect(tabsOf("doing")).toEqual(["occur"]);
    expect(tabsOf("signal")).toEqual(["know"]);
    expect(tabsOf("action")).toEqual(["act"]);
  });

  it("状況の種類ごとの届き方。採点の knownOf が分かっていた事実に数える物（電話・施設・道・家の電話・訪問看護）は公表", () => {
    for (const k of ["phone", "facility", "road", "line_down", "nurse_away"] as WorldEventKind[]) expect(INCIDENT_REACH[k], k).toBe("public");
    for (const k of ["alert", "quake", "tsunami", "flood", "outage", "outage_restored", "water", "shelter", "note", "town_flood"] as WorldEventKind[]) {
      expect(INCIDENT_REACH[k], k).toBe("public");
    }
    for (const k of ["supply_left", "going_home", "mark", "check"] as WorldEventKind[]) expect(INCIDENT_REACH[k], k).toBe("private");
    expect(INCIDENT_REACH.ai_stop).toBe("none");
    expect(INCIDENT_REACH.world_note).toBe("none");
    // 本人の付いた予定（業者の巡回）は非公表、付かない予定（復旧の見込み）は公表。世界の 1 文も同じ
    const sched = { kind: "schedule", at: 600, by: "director", then: { kind: "arrival", role: "vendor" } } as const;
    expect(incidentReach({ change: sched, person: "p-02" })).toBe("private");
    expect(incidentReach({ change: sched })).toBe("public");
    expect(incidentReach({ change: { kind: "narration", room: "", via: "room" } })).toBe("public");
    expect(incidentReach({ change: { kind: "narration", room: "", via: "room" }, person: "p-01" })).toBe("private");
    // 被害状況の個別の印も同じ考え（家の電話・訪問看護・浸水・断水は公表）
    expect(Object.entries(MARK_REACH).filter(([, v]) => v === "public").map(([k]) => k).sort()).toEqual(["flooded", "lineDown", "nurseAway", "waterOut"]);
    expect(scheduledPublic({ by: "director", person: "p-02" })).toBe(false);
    expect(scheduledPublic({ by: "action", person: "p-02" })).toBe(true);
    expect(scheduledPublic({ by: "director" })).toBe(true);
    expect(arrivalPublic({ from: "a3" })).toBe(true);
    expect(arrivalPublic({ from: "director" })).toBe(false);
  });

  it("採点の knownOf と食い違わない: 家の電話の通話不可の印は、手の前の事実（空振りの元）にも、把握のタブ（公表）にも入る", () => {
    // 手の前の電話（before.phone）は本人の家の電話（家の電話の印を含む。scenarios.ts の phoneOf）
    const k = knownOf({ person: "p-02", step: 1, before: { person: null, marks: { lineDown: 3 }, staff: 2, phone: "down", roadClosed: false } });
    expect(k.homeLine).toBe("down");
    const log = buildDrillLog(TICKS, [], { finished: false });
    expect(log.know.some((r) => r.source === "incident" && r.e.change.kind === "line_down")).toBe(true);
  });

  it("タブの ?log= の読み方。既定は把握", () => {
    expect(DEFAULT_LOG_TAB).toBe("know");
    expect(parseLogTab("occur")).toBe("occur");
    expect(parseLogTab("act")).toBe("act");
    expect(parseLogTab("x")).toBe("know");
    expect(parseLogTab(undefined)).toBe("know");
  });
});

// ---------- 途中は出さない、終わってから出す ----------

describe("訓練の途中の発生と、終わってからの見比べ", () => {
  it("途中: 発生は公表の物だけ（本人に起きたこと・する事を出さない）。把握は公表の状況・安否・手の返事。AI 停止の印はどこにも出さない", () => {
    const log = buildDrillLog(TICKS, ACTIONS, { finished: false });
    expect(keysOf(log.occur)).toEqual(["incident:i-0-0", "incident:i-1-1"]);
    expect(log.hidden).toBe(4);
    expect(keysOf(log.know)).toEqual([
      "incident:i-0-0",
      "signal:s-0-0",
      "incident:i-1-1",
      "signal:s-1-0",
      "signal:s-1-1",
      "signal:s-1-2",
      "heard:h-a1",
      "heard:h-a2",
    ]);
    expect(keysOf(log.act)).toEqual(["action:a-a1", "action:a-a2"]);
    const kinds = [...log.occur, ...log.know].flatMap((r) => (r.source === "incident" ? [r.e.change.kind] : []));
    expect(kinds).not.toContain("ai_stop");
    expect(kinds).not.toContain("supply_left");
  });

  it("終わり: 発生に全部（古い順）。把握の時刻は、その人から言葉が届いた最初の時刻。届かなければ未把握", () => {
    const log = buildDrillLog(TICKS, ACTIONS, { finished: true });
    expect(log.hidden).toBe(0);
    expect(keysOf(log.occur)).toEqual(["incident:i-0-0", "incident:i-1-0", "incident:i-1-1", "incident:i-1-2", "incident:i-1-3", "doing:d-1-1"]);
    // 公表は起きた時
    expect(log.aware["i-0-0"]).toEqual({ at: 0, via: "public", from: null, lag: 0, mark: null });
    expect(log.aware["i-1-1"]).toMatchObject({ at: 180, via: "public", lag: 0, mark: null });
    // 佐藤の持ち出し忘れ（2.5 時間）は 3 時間の家族の言う事で把握。30 分の遅れ
    expect(log.aware["i-1-0"]).toEqual({ at: 180, via: "signal", from: "s-1-0", lag: 30, mark: "late" });
    // 田中の帰宅希望とする事は、3 時間 40 分に電話に出た言う事で把握（安否に言う事が無いので安否では把握しない）
    expect(log.aware["i-1-2"]).toEqual({ at: 220, via: "heard", from: "h-a2", lag: 40, mark: "late" });
    expect(log.aware["d-1-1"]).toMatchObject({ at: 220, via: "heard", mark: "late" });
    // 鈴木の家族の帰宅困難: 電話は通話不可で言葉が届かない → 未把握
    expect(log.aware["i-1-3"]).toEqual({ at: null, via: null, from: null, lag: null, mark: "never" });
    const counts = awareCounts(log);
    expect(counts).toEqual({ total: 6, publicCount: 2, late: 3, never: 1 });
    expect(awareText(counts)).toBe("発生 6・公表 2・遅れ 3・未把握 1");
  });

  it("起きる前の言葉では把握しない（同じ分は把握）", () => {
    const ticks = [
      tick(0, 0, [], [turn({ person: "p-06", at: 1, saying: "はい" })]),
      tick(1, 2, [inc({ change: { kind: "supply_left" }, text: "持ち出し忘れ", person: "p-06", at: 2 })], [turn({ person: "p-06", at: 2, saying: "忘れた" })]),
    ];
    const log = buildDrillLog(ticks, [], { finished: true });
    expect(log.aware["i-1-0"]).toEqual({ at: 120, via: "signal", from: "s-1-0", lag: 0, mark: null });
  });
});

// ---------- 3 つのタブの描き ----------

const NAMES = { "p-01": "伊藤 フミ", "p-02": "高橋 一郎", "p-03": "鈴木 花子", "p-06": "佐藤 次郎", "p-07": "田中 三郎" };
const START = "2026-11-05T01:00:00.000Z";

function renderLog(finished: boolean, initial: "occur" | "know" | "act" = "know") {
  return renderToStaticMarkup(createElement(DrillLog, { ticks: TICKS, actions: ACTIONS, names: NAMES, startedAt: START, finished, initial }));
}

function panelOf(html: string, tab: string): string {
  const start = html.indexOf(`data-log-panel="${tab}"`);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("data-log-panel=", start + 10);
  return html.slice(start, end === -1 ? undefined : end);
}

describe("3 つのタブの描き", () => {
  it("タブは 発生・把握・対応（数つき）。選んだタブだけ見せ、ほかは hidden。ピル型・下地なし", () => {
    const html = renderLog(false);
    expect(html).toContain('role="tablist"');
    expect(html).toContain(`aria-label="${LOG_LABELS.tabs}"`);
    // T128: 名前と数の間は空白 1 つ（下の線を 1 本にするため。components/ui/Tabs の TabText）
    const tabs = [...html.matchAll(/data-log-tab="(\w+)"[^>]*>([^<]+?) ?<span[^>]*>(\d+)</g)].map((m) => [m[1], m[2], Number(m[3])]);
    expect(tabs).toEqual([
      ["occur", "出来事", 2],
      ["know", "把握", 8],
      ["act", "対応", 2],
    ]);
    expect(html).toMatch(/aria-selected="true"[^>]*data-log-tab="know"/);
    expect(html).toMatch(/hidden="" data-log-panel="occur"/);
    expect(html).toMatch(/hidden="" data-log-panel="act"/);
    expect(html).not.toMatch(/hidden="" data-log-panel="know"/);
    expect(html).not.toContain("rounded-full");
    expect(html).not.toMatch(/data-log-tab[^>]*bg-/);
  });

  it("途中: 発生に本人に起きたことを出さず「非公表分 終了後表示」。把握に安否（する事なし）・着信・手の返事（言う事・事実）", () => {
    const html = renderLog(false);
    const occur = panelOf(html, "occur");
    expect(occur).toContain("警戒レベル 3");
    expect(occur).toContain(`家の電話 ${NO_CALL}`);
    expect(occur).not.toContain("持ち出し忘れ");
    expect(occur).not.toContain("帰宅");
    expect(occur).not.toContain("避難を渋る");
    expect(occur).toContain(LOG_LABELS.hidden);
    expect(occur).not.toContain("data-aware");
    const know = panelOf(html, "know");
    expect(know).toContain("家にいます");
    expect(know).toContain("避難所に着きました");
    expect(know).not.toContain("避難を渋る");
    expect(know).toContain('data-heard="a1"');
    expect(know).toContain(`家の電話 ${NO_CALL}`);
    expect(know).toContain("わしは家に帰る");
    expect(know).not.toContain("持ち出し忘れ");
    // 新しい順（3 時間 40 分の電話の返事が先、0 時間が最後）
    const minutes = [...know.matchAll(/data-log-minute="(\d+)"/g)].map((m) => Number(m[1]));
    expect(minutes).toEqual([220, 210, 205, 180, 0]);
    // 3 時間 20 分〜30 分の鈴木への電話の途中に来た伊藤の言う事は、見出しに「対応中」。電話の終わりの分（返事）は途中でない
    const heading = (m: number) => know.match(new RegExp(`data-log-minute="${m}"><h3[^>]*>([\\s\\S]*?)</h3>`))?.[1] ?? "";
    expect(heading(205)).toContain("対応中 本人電話 鈴木 花子");
    expect(heading(210)).not.toContain("対応中");
    expect(heading(180)).not.toContain("対応中");
    const act = panelOf(html, "act");
    expect(act).toContain("data-action-log");
    expect([...act.matchAll(/data-act="(a\d)"/g)].map((m) => m[1])).toEqual(["a2", "a1"]);
  });

  it("終わり: 発生に全部、遅れと未把握の印（太字の文字、状態の色なし）。非公表の注は出さない", () => {
    const html = renderLog(true, "occur");
    expect(html).toMatch(/aria-selected="true"[^>]*data-log-tab="occur"/);
    const occur = panelOf(html, "occur");
    expect(occur).toContain("家族が栄養剤を持ち出し忘れた");
    expect(occur).toContain("避難を渋る");
    expect(occur).toContain(`${LOG_LABELS.doing}`);
    expect(occur).not.toContain(LOG_LABELS.hidden);
    expect([...occur.matchAll(/data-aware="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]])).toEqual([
      ["late", "遅れ 0 時間 40 分"],
      ["never", "未把握"],
      ["late", "遅れ 0 時間 40 分"],
      ["late", "遅れ 0 時間 30 分"],
    ]);
    expect(occur).not.toMatch(/data-aware="[^"]+" class="[^"]*(state|tone)/);
    // AI の物（監督・本人役）は AI の印
    expect((occur.match(/data-ai-mark|>AI</g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------- 電話の言い方 ----------

describe("電話の言い方（不通 → 通話不可）", () => {
  it("被害状況・状況・手の返事・本人ごとの印・出来事の表の言葉が「通話不可」", () => {
    expect(NO_CALL).toBe("通話不可");
    // 世界の電話の down は通話の規制（T125。全部は止まらない）。家の電話の不通は「通話不可」のまま
    expect(PHONE_LABELS.down).toBe("規制");
    expect(WORLD_REPLY_LABELS.noLine).toBe("通話不可");
    expect(ACTION_STATUS_LABELS.noLine).toBe("通話不可");
    expect(MARK_LABELS.lineDown).toBe("通話不可");
    expect(markLabels.lineDown).toBe("通話不可");
    expect(markWords.lineDown).toBe("家の電話で通話できない");
    expect(INJECT_TEXTS.line_down).toBe("家の電話 通話不可");
    expect(EVENT_LABELS.line_down).toBe("通話不可");
    expect(EVENT_LABELS.mobile_down).toBe("電波不通");
    expect(EVENT_CATALOG.line_down.build({ person: "p-02" }, 3, null)).toEqual([{ change: { kind: "line_down" }, text: "家の電話 通話不可", person: "p-02" }]);
    expect(EVENT_CATALOG.mobile_down.build({ person: null }, 3, 2).map((p) => p.text)).toEqual(["携帯 電波不通", "携帯 電波 回復見込 2 時間後"]);
    expect(EVENT_KIND_LABELS.line_down).toBe("電話");
  });

  it("画面と AI に渡す言葉の表に「不通」が残っていない", () => {
    const words = [
      ...Object.values(PHONE_LABELS),
      ...Object.values(WORLD_REPLY_LABELS),
      ...Object.values(ACTION_STATUS_LABELS),
      ...Object.values(markLabels),
      ...Object.values(markWords),
      ...Object.values(INJECT_TEXTS),
      ...Object.values(EVENT_LABELS),
      ...Object.values(EVENT_CATALOG).map((r) => r.words),
      ...Object.values(WASTE_LABELS),
      ...Object.values(WASTE_WORDS),
      ...Object.values(RESULT_WORDS),
      REVIEW_SYSTEM,
    ];
    // 「電波不通」（T125。携帯の基地局の止まり）は電話の不通と別の段なので残す
    for (const w of words) expect(w.replaceAll("電波不通", "")).not.toContain("不通");
  });

  it("世界の返事の事実と、採点・講評の事実の言葉が同じ（返事の形と表の言葉をそろえる）", () => {
    const w = (over: Partial<WorldState>): WorldState => ({ ...EMPTY_WORLD, ...over });
    expect(decideWorldReply({ action: "call_person", person: "p-02", callee: "self", world: w({ marks: { "p-02": { lineDown: 3 } } }), hour: 3 }, 0)).toMatchObject({
      status: "noLine",
      because: "家の電話 通話不可",
    });
    // 通話の規制（T125）は全部を止めない。家族の携帯は全域の電波不通で届かない
    expect(decideWorldReply({ action: "call_contact", person: "p-02", callee: "family", world: w({ phone: "down" }), hour: 3 }, 0)).toMatchObject({ status: "ringing" });
    expect(decideWorldReply({ action: "call_contact", person: "p-02", callee: "family", world: w({ radio: "down" }), hour: 3 }, 0)).toMatchObject({
      status: "noLine",
      because: "携帯 電波不通",
    });
    expect(decideWorldReply({ action: "report_city", person: null, world: w({ phone: "down" }), hour: 3 }, 0.9)).toMatchObject({ status: "noLine" });
    // 手の前の電話は本人の家の電話。家の電話の印なら「家の電話 通話不可」、世界の電話の規制は「電話 規制」
    const before = { person: null, marks: { lineDown: 3 }, staff: 1, phone: "down" as const, roadClosed: false };
    const tickWorld = (phone: "ok" | "down") => [{ step: 0, world: { phone, facilities: [] } }];
    expect(factWords(knownOf({ person: "p-02", step: 0, before }, tickWorld("down")), "call_contact")).toContain("電話 規制");
    expect(factWords(knownOf({ person: "p-02", step: 0, before }, tickWorld("ok")), "call_person")).toContain("家の電話 通話不可");
    expect(WASTE_WORDS.phone).toBe("家の電話 通話不可");
    expect(WASTE_LABELS.phone).toBe("通話不可");
    expect(RESULT_WORDS.noLine).toBe("通話不可");
    expect(REVIEW_SYSTEM).toContain("- 家の電話 通話不可:");
    expect(REVIEW_SYSTEM).toContain("- 電話 規制:");
  });

  it("世界（AI）の返す電話の値は、前の「不通」・「通話不可」・「規制」も down として読み、画面の文は「電話 規制」（T125）", () => {
    const ctx = { key: { people: [] } as unknown as PseudonymKey, facts: new Map(), ended: new Set<string>(), hour: 6, via: "room" as const };
    for (const value of ["down", "不通", "通話不可", "規制"]) {
      const out = worldIncidents({ narration: "", events: [{ kind: "phone", town: "", target: "", name: "", value }], farewells: [] }, ctx);
      expect(out.filter((e) => e.change.kind === "phone").map((e) => [e.change, e.text]), value).toEqual([[{ kind: "phone", state: "down" }, "電話 規制"]]);
    }
  });

  it("被害状況の電話は「規制」（T125）。途中は本人の非公表の印を出さず、終わると出す", () => {
    const world: WorldState = { ...EMPTY_WORLD, phone: "down", marks: { "p-02": { lineDown: 3 }, "p-06": { supplyLeft: 2 } } };
    const run = renderToStaticMarkup(createElement(DamagePanel, { kind: "heavy_rain", world, now: 3, names: NAMES, hidePrivate: true }));
    expect(run).toMatch(/data-world="phone"[^>]*><span[^>]*>規制</);
    expect(run).not.toContain("不通");
    expect(run).toContain("高橋 一郎");
    expect(run).not.toContain("佐藤 次郎");
    const done = renderToStaticMarkup(createElement(DamagePanel, { kind: "heavy_rain", world, now: 3, names: NAMES }));
    expect(done).toContain("佐藤 次郎");
    expect(done).toContain("持ち出し忘れ");
  });
});

// ---------- 本物の道（D1）: 大雨の訓練を最後まで ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
let rec: DrillRecord;

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const careManager = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});
const SCOPE = drillScope(careManager())!;

async function act(id: string, kind: DrillAction, person: string | null) {
  const row = (await loadDrillRow(db, DEMO.id, id))!;
  const n = stateOfRow(row).actions.length;
  const res = await actionPost(db, careManager(), id, { step: row.step, actions: n, kind, person, target: null }, START, { roll: () => 0 });
  expect(res.status).toBe(200);
}

describe("本物の道（大雨の想定、偽の hooks なし）", () => {
  beforeAll(async () => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "d105")).toEqual({ ok: true, id: "d105" });
    await act("d105", "call_person", "p-03");
    await act("d105", "visit", "p-01");
    for (;;) {
      const row = (await loadDrillRow(db, DEMO.id, "d105"))!;
      if (row.status !== "running") break;
      expect((await advanceDrill(db, SCOPE, "d105", row.step, START)).ok).toBe(true);
    }
    const r = await loadDrillRecord(db, SCOPE, "d105", "2026-11-05T02:00:00.000Z");
    if (r === null || r === "running") throw new Error("記録が無い");
    rec = r;
  }, 120_000);
  afterAll(() => sqlite?.close());

  it("想定の表の持ち出し忘れ（佐藤、6 時間）とする事は、途中は発生に出ず、終わると出る。透析施設の休止は公表", () => {
    const { ticks, state } = rec.screen;
    const running = buildDrillLog(ticks, state.actions, { finished: false });
    const done = buildDrillLog(ticks, state.actions, { finished: true });
    const supply = (rows: typeof done.occur) => rows.filter((r) => r.source === "incident" && r.e.change.kind === "supply_left");
    expect(supply(running.occur)).toHaveLength(0);
    expect(supply(done.occur)).toHaveLength(1);
    expect(running.occur.some((r) => r.source === "doing")).toBe(false);
    expect(done.occur.filter((r) => r.source === "doing").map((r) => (r.source === "doing" ? r.t.doing : ""))).toEqual(
      expect.arrayContaining(["4 問の途中で止まった", "避難を渋る"]),
    );
    const dialysis = done.occur.find((r) => r.source === "incident" && r.e.change.kind === "facility");
    expect(dialysis && done.aware[dialysis.key]).toMatchObject({ via: "public", lag: 0, mark: null });
    expect(running.know.some((r) => r.source === "incident" && r.e.change.kind === "facility")).toBe(true);
    // 手は対応だけ、時刻の順
    expect(done.act.map((r) => (r.source === "action" ? r.a.kind : ""))).toEqual(["call_person", "visit"]);
  });

  it("訓練記録の紙に「発生と把握」の表と、採点の内訳の下に同じ形の数の 1 行", () => {
    const html = renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: "デモ事業所", today: "2026-11-05" }));
    const done = buildDrillLog(rec.screen.ticks, rec.screen.state.actions, { finished: true });
    const line = awareText(awareCounts(done)).replace(/ /g, "");
    expect(html).toContain('data-block="compare"');
    expect(html).toMatch(/data-detail="aware">[^<]*発生/);
    // 紙は数と単位を詰める（paperText）
    expect(html.replace(/ /g, "")).toContain(line);
    expect((html.match(/data-occur=/g) ?? []).length).toBe(done.occur.length);
    expect(html).toContain("持ち出し");
    expect(html).toMatch(/data-aware="(late|never)"/);
    expect(html).not.toContain("不通");
  });
});
