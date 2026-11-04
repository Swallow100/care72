// T100 経過と時刻の言い方を 1 か所に（lib/drill/time-text.ts）。連続の時計（T90）で時間が小数（6.1666…）になっても、
// 経過は「6 時間 10 分」（0 分は「6 時間」）、時刻は「11/4 22:10」で出す。10 分版の整数の時間は前と同じ文字。
// 画面・訓練記録の紙・監督と世界に渡す文を、偽の hooks なし（Claude を呼ばない）の訓練と、組み立てた入力で確かめる。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionLog } from "../../components/drill/ActionLog.tsx";
import { AiStopBand } from "../../components/drill/AiStopBand.tsx";
import { DamagePanel } from "../../components/drill/DamagePanel.tsx";
import { DrillBar } from "../../components/drill/DrillBar.tsx";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { DrillRowDetail } from "../../components/drill/DrillRowDetail.tsx";
import { Situation } from "../../components/drill/Situation.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { shortJst } from "../disaster/state.ts";
import { aiStopBand, aiStopParts, type AiStopBand as Band } from "./ai-stop.ts";
import { abandonDrill, actDrill, advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { sceneText } from "./director.ts";
import { extraWorldWords } from "./event-catalog.ts";
import { nowHour, simAt, type DirectorInput, type WorldInput } from "./engine.ts";
import { clockLabel, DRILL_LABELS, elapsedClockLabel, elapsedLabel, progressLabel } from "./labels.ts";
import { loadDrillRecord } from "./record.ts";
import { applyEvent, drillKindOf, EMPTY_WORLD, SCENARIOS, type WorldState } from "./scenarios.ts";
import { hourSpanText, hourText, minuteText, simTimeText } from "./time-text.ts";
import { loadDrillScreen, screenTimeText } from "./view.ts";
import { tickText as worldTickText, worldNow } from "./world-oneshot.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/** 小数の時間（「6.1666 時間」「6.2 時間」「3.5〜」）。時計の残り（ルールの表の「残り 1.5 時間」）は経過でないので除く */
const DECIMAL_HOURS = /\d\.\d+ ?(時間|〜)/;
const withoutClockLeft = (s: string) => s.replace(/残り \d+(\.\d+)? (時間|日)/g, "").replace(/\d+(\.\d+)? (時間|日)を超過/g, "");
/** renderToStaticMarkup の文字の区切り（<!-- -->）とタグを外した文字 */
const textOf = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");

/** 発災 11/4 16:00（日本の時刻） */
const T0 = "2026-11-04T07:00:00.000Z";
const H610 = 370 / 60;

describe("経過の言い方（minuteText・hourText）", () => {
  it("分のある時間は「6 時間 10 分」、0 分は「6 時間」", () => {
    expect(H610).toBe(6.166666666666667);
    expect(hourText(H610)).toBe("6 時間 10 分");
    expect(minuteText(370)).toBe("6 時間 10 分");
    expect(hourText(6)).toBe("6 時間");
    expect(minuteText(360)).toBe("6 時間");
    expect(hourText(0)).toBe("0 時間");
    expect(hourText(0.5)).toBe("0 時間 30 分");
    expect(hourText(1 + 25 / 60)).toBe("1 時間 25 分");
  });

  it("分に丸めて繰り上がる（59.6 分は 1 時間、5.9999 時間は 6 時間）", () => {
    expect(minuteText(59.6)).toBe("1 時間");
    expect(minuteText(119.5)).toBe("2 時間");
    expect(minuteText(125.4)).toBe("2 時間 5 分");
    expect(hourText(5.99999)).toBe("6 時間");
    expect(hourText(6.00001)).toBe("6 時間");
    expect(hourText(4.666666666666667)).toBe("4 時間 40 分");
    expect(hourText(8.916666666666666)).toBe("8 時間 55 分");
    // 引き算の誤差（0.16666666666666674）
    expect(hourText(6.166666666666667 - 6)).toBe("0 時間 10 分");
  });

  it("72 時間ちょうど（と、その手前の誤差）は「72 時間」", () => {
    expect(minuteText(72 * 60)).toBe("72 時間");
    expect(hourText(72)).toBe("72 時間");
    expect(minuteText(4319.6)).toBe("72 時間");
    expect(hourText(71 + 59.7 / 60)).toBe("72 時間");
    expect(hourText(71 + 50 / 60)).toBe("71 時間 50 分");
    expect(elapsedLabel(72)).toBe("経過 72 時間");
    expect(elapsedClockLabel(72 * 60)).toBe("経過 72 時間");
    expect(progressLabel(72, 72)).toBe("経過 72 / 72 時間");
    expect(hourSpanText(69, 72)).toBe("69〜72 時間");
    expect(hourSpanText(70 + 50 / 60, 72)).toBe("70 時間 50 分〜72 時間");
  });

  it("負は 0（時計の前の時刻を出さない）", () => {
    expect(minuteText(-5)).toBe("0 時間");
    expect(hourText(-0.0001)).toBe("0 時間");
  });

  it("labels.ts の clockLabel・elapsedLabel・progressLabel も同じ関数から", () => {
    for (const m of [0, 5, 59.6, 85, 180, 370, 4320]) expect(clockLabel(m)).toBe(minuteText(m));
    expect(elapsedLabel(H610)).toBe("経過 6 時間 10 分");
    expect(elapsedClockLabel(370)).toBe("経過 6 時間 10 分");
    expect(progressLabel(H610, 72)).toBe("経過 6 時間 10 分 / 72 時間");
    expect(DRILL_LABELS.hours).toBe("時間");
  });
});

describe("範囲の言い方（hourSpanText）", () => {
  it("両端が整数の時間なら前からの形「3〜12 時間」", () => {
    expect(hourSpanText(3, 12)).toBe("3〜12 時間");
    expect(hourSpanText(0, 72)).toBe("0〜72 時間");
    expect(hourSpanText(5.99999, 9.00001)).toBe("6〜9 時間");
  });

  it("どちらかに分があれば両端を「N 時間 M 分」", () => {
    expect(hourSpanText(6, H610)).toBe("6 時間〜6 時間 10 分");
    expect(hourSpanText(0.5, H610)).toBe("0 時間 30 分〜6 時間 10 分");
    expect(hourSpanText(3.5, 9)).toBe("3 時間 30 分〜9 時間");
  });
});

describe("時刻の言い方（simTimeText）", () => {
  it("発災の時刻から分を足した日本の時刻「11/4 22:10」", () => {
    expect(simTimeText(T0, 370)).toBe("11/4 22:10");
    expect(simTimeText(T0, H610 * 60)).toBe("11/4 22:10");
    expect(simTimeText(T0, 0)).toBe("11/4 16:00");
    // 日をまたぐ・72 時間ちょうど
    expect(simTimeText(T0, 8 * 60 + 10)).toBe("11/5 00:10");
    expect(simTimeText(T0, 72 * 60)).toBe("11/7 16:00");
    // 分に丸める（359.6 分は 6 時間）
    expect(simTimeText(T0, 359.6)).toBe("11/4 22:00");
  });

  it("開始の時刻が読めなければそのまま", () => {
    expect(simTimeText("not-a-date", 30)).toBe("not-a-date");
  });
});

describe("10 分版・前からの訓練の整数の時間は前と同じ文字", () => {
  // 想定の表の刻みの時刻（10 分版は 0・3・12・72）
  const hours = [...new Set([...SCENARIOS.short.hours, ...SCENARIOS.heavy_rain.hours, ...SCENARIOS.earthquake.hours])];

  it("経過・範囲・一覧・時刻（直す前の式と比べる）", () => {
    expect(SCENARIOS.short.hours).toEqual([0, 3, 12, 72]);
    for (const h of hours) {
      expect(elapsedLabel(h)).toBe(`${DRILL_LABELS.elapsed} ${h} ${DRILL_LABELS.hours}`);
      expect(hourText(h)).toBe(`${h} 時間`);
      expect(progressLabel(h, 72)).toBe(`${DRILL_LABELS.elapsed} ${h} / 72 ${DRILL_LABELS.hours}`);
      expect(simTimeText(T0, h * 60)).toBe(shortJst(simAt(T0, h)));
    }
    for (let i = 1; i < hours.length; i++) expect(hourSpanText(hours[i - 1], hours[i])).toBe(`${hours[i - 1]}〜${hours[i]} 時間`);
  });

  it("AI 停止の帯の経過（「経過 6 時間〜」「経過 6〜9 時間」）", () => {
    const b = (from: number, to: number | null): Band => ({ reason: "limit", from, to, resume: null, virtual: false, whole: false });
    expect(aiStopParts(b(6, null)).span).toBe("経過 6 時間〜");
    expect(aiStopParts(b(6, 6)).span).toBe("経過 6 時間");
    expect(aiStopParts(b(6, 9)).span).toBe("経過 6〜9 時間");
    expect(aiStopParts(b(12, 72)).span).toBe("経過 12〜72 時間");
  });

  it("被害状況の停電の時間（整数）", () => {
    const restored: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 3, restoredAt: 12 } };
    const now: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 3, restoredAt: null } };
    expect(textOf(renderToStaticMarkup(createElement(DamagePanel, { kind: "heavy_rain", world: restored, now: 12, names: {} })))).toContain("3〜12 時間");
    expect(textOf(renderToStaticMarkup(createElement(DamagePanel, { kind: "heavy_rain", world: now, now: 12, names: {} })))).toContain(" 9 時間 ");
  });
});

describe("小数の時間（連続の時計）", () => {
  it("AI 停止の帯は分まで", () => {
    const b = (from: number, to: number | null): Band => ({ reason: "cap", from, to, resume: null, virtual: false, whole: false });
    expect(aiStopParts(b(H610, null)).span).toBe("経過 6 時間 10 分〜");
    expect(aiStopParts(b(H610, H610)).span).toBe("経過 6 時間 10 分");
    expect(aiStopParts(b(3.5, 9)).span).toBe("経過 3 時間 30 分〜9 時間");
  });

  it("被害状況の停電（停電中の長さ・復旧までの範囲）", () => {
    const now: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0.5, restoredAt: null } };
    const restored: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0.5, restoredAt: H610 } };
    const a = textOf(renderToStaticMarkup(createElement(DamagePanel, { kind: "heavy_rain", world: now, now: H610, names: {} })));
    expect(a).toContain("5 時間 40 分");
    expect(a).not.toMatch(DECIMAL_HOURS);
    const b = textOf(renderToStaticMarkup(createElement(DamagePanel, { kind: "heavy_rain", world: restored, now: 9, names: {} })));
    expect(b).toContain("0 時間 30 分〜6 時間 10 分");
    expect(b).not.toMatch(DECIMAL_HOURS);
  });

  it("状況の見出しと出来事の時刻", () => {
    const world = applyEvent(EMPTY_WORLD, { change: { kind: "outage", area: { scope: "office" } }, text: "停電" }, 4.5);
    const ticks = [
      { step: 0, hour: 0, incidents: [], turns: [], world: EMPTY_WORLD, finished: false },
      {
        step: 1,
        hour: H610,
        incidents: [{ change: { kind: "outage" as const, area: { scope: "office" as const } }, text: "停電", at: 4.5, actor: "world" as const, ai: false }],
        turns: [],
        world,
        finished: false,
      },
    ];
    const html = textOf(renderToStaticMarkup(createElement(Situation, { ticks, names: {}, startedAt: T0 })));
    expect(html).toContain("経過 6 時間 10 分");
    expect(html).toContain("11/4 22:10");
    expect(html).toContain("4 時間 30 分");
    expect(html).toContain("経過 0 時間");
    expect(html).toContain("11/4 16:00");
    expect(html).not.toMatch(DECIMAL_HOURS);
  });

  it("監督に渡す文（時刻・停電・予定）", () => {
    const world: WorldState = { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0.5, restoredAt: null } };
    const dir: DirectorInput = { scenario: "heavy_rain", step: 2, hour: H610, world, incidents: [], participants: [], people: {}, actions: [] };
    const text = sceneText(dir, new Map(), 72);
    expect(text).toContain("発災から 6 時間 10 分");
    expect(text).toContain("停電中（0 時間 30 分から");
    const back = sceneText({ ...dir, world: { ...world, outage: { area: { scope: "office" }, since: 0.5, restoredAt: H610 } } }, new Map(), 72);
    expect(back).toContain("停電 復旧（6 時間 10 分）");
    expect(text + back).not.toMatch(DECIMAL_HOURS);
    // 整数の時間は前と同じ文
    const whole = sceneText({ ...dir, hour: 6, world: { ...world, outage: { area: { scope: "office" }, since: 3, restoredAt: null } } }, new Map(), 72);
    expect(whole).toContain("発災から 6 時間（72 時間まで）");
    expect(whole).toContain("停電中（3 時間から");
  });

  it("世界に渡す文（時刻・本人たちの連絡・停電・手の時刻）", () => {
    const key = { people: [{ alias: "A さん", personId: "p-01", name: "x" }], contacts: [], rules: [], secrets: [] };
    const input = {
      scenario: "virtual",
      step: 3,
      hour: H610,
      world: { ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0.5, restoredAt: H610 } },
      incidents: [],
      participants: ["p-01"],
      people: { "p-01": { color: "red", source: "agent", whereNow: null, at: 5 + 50 / 60, saying: null, doing: null } },
      actions: [{ id: "a1", kind: "call_person", person: "p-01", target: null, at: 5.5, atMinute: 330, step: 2, result: { ok: true } }],
      hints: { reached: [], clocks: [] },
      session: null,
      minute: 370,
    } as unknown as WorldInput;
    const text = worldTickText(input, { key } as never, 5, 72);
    expect(text).toContain("発災から 6 時間 10 分（72 時間まで）");
    expect(text).toContain("A さん: 5 時間 50 分に");
    expect(worldNow(input.world)).toContain("停電 復旧（6 時間 10 分）");
    expect(text).toContain("- 5 時間 30 分: ");
    expect(text).not.toMatch(DECIMAL_HOURS);
    // 手の時刻の 0 分は「6 時間」（「6 時間 0 分」と書かない）
    const whole = worldTickText({ ...input, actions: [{ ...input.actions[0], atMinute: 360, at: 6 }] } as WorldInput, { key } as never, 5, 72);
    expect(whole).toContain("- 6 時間: ");
  });

  it("世界の履歴（部屋の文）と本人役に渡す印の時刻", () => {
    const narration = { change: { kind: "narration", room: "街の様子", via: "room" }, text: "街の様子" } as never;
    const w = applyEvent(EMPTY_WORLD, narration, H610);
    expect(w.story?.at(-1)).toBe("6 時間 10 分: 街の様子");
    expect(applyEvent(EMPTY_WORLD, narration, 6).story?.at(-1)).toBe("6 時間: 街の様子");
    const marked: WorldState = { ...EMPTY_WORLD, marks: { "p-01": { helperAway: H610 } } };
    expect(extraWorldWords(marked, "p-01")).toContain("介護事業所が休みで、ヘルパーが来られない（6 時間 10 分から）");
  });
});

// ---------- 本物の道（node:sqlite の D1 と種の 10 人、Claude を呼ばない）----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const SCOPE = drillScope({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
} as Principal)!;
const ID = "drill-t100";

async function act(kind: "visit" | "call_person", person: string) {
  const r = (await loadDrillRow(db, DEMO.id, ID))!;
  const res = await actDrill(db, SCOPE, ID, { step: r.step, actions: stateOfRow(r).actions.length }, { kind, person, target: null }, T0, { roll: () => 0 });
  expect(res).toMatchObject({ ok: true });
}
async function advance(to: { minutes: 30 | 60 | 180 } | { next: true }) {
  const r = (await loadDrillRow(db, DEMO.id, ID))!;
  expect(await advanceDrill(db, SCOPE, ID, r.step, T0, {}, to)).toMatchObject({ ok: true });
}

describe("訓練の画面と紙面（連続の時計の訓練）", () => {
  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
  });
  afterEach(() => sqlite.close());

  it("状況・被害状況・履歴・安否・AI 停止の帯・72 時間の棒・訓練記録の紙に小数の時間が出ない", async () => {
    expect(await startDrill(db, SCOPE, "heavy_rain", T0, {}, () => ID, { clock: true })).toEqual({ ok: true, id: ID });
    await act("visit", "p-04"); // 40 分
    await advance({ minutes: 30 }); // 70 分
    await act("call_person", "p-02");
    await advance({ next: true });
    await advance({ minutes: 60 });
    await act("visit", "p-04");
    await advance({ minutes: 180 });
    await advance({ next: true });

    const s = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(s.clock).toBe(true);
    expect(s.hours.some((h) => !Number.isInteger(h))).toBe(true);
    // 上の大きな経過と時刻
    expect(elapsedClockLabel(s.state.minute)).toBe(`経過 ${minuteText(s.state.minute)}`);
    expect(screenTimeText(s)).toBe(simTimeText(T0, s.state.minute));
    expect(screenTimeText(s)).toMatch(/^11\/[45] \d{2}:\d{2}$/);

    const screen = [
      renderToStaticMarkup(createElement(Situation, { ticks: s.ticks, names: s.names, startedAt: s.drill.started_at })),
      renderToStaticMarkup(createElement(DamagePanel, { kind: drillKindOf(s.drill.scenario, s.state.world), world: s.state.world, now: s.state.hour, names: s.names })),
      renderToStaticMarkup(createElement(ActionLog, { actions: s.state.actions, hours: s.hours, current: s.shown, names: s.names, refused: s.refused })),
      renderToStaticMarkup(createElement(DrillBar, { hours: s.hours, last: s.last, now: nowHour(s.state), bands: s.bands, reached: s.drill.step, clock: true, hrefOf: (i: number) => `/drill/${ID}?step=${i}` })),
      ...s.rows.flatMap((r) => (r.detail ? [renderToStaticMarkup(createElement(DrillRowDetail, { detail: r.detail, startedAt: s.drill.started_at, aiSignals: s.aiSignals, heard: s.heard }))] : [])),
    ].join("\n");
    const text = withoutClockLeft(textOf(screen));
    expect(text).not.toMatch(DECIMAL_HOURS);
    // 区切り 70 分の見出しと時刻、訪問で聞いた安否（40 分）
    expect(text).toContain("経過 1 時間 10 分");
    expect(text).toContain("11/4 17:10");
    expect(text).toContain("0 時間 40 分");
    // 棒の区切りの印の読み上げも分まで
    expect(screen).toContain('aria-label="経過 1 時間 10 分"');

    // 中断して訓練記録の紙（対応履歴の見出し・状況の時刻）
    expect(await abandonDrill(db, SCOPE, ID, "2026-11-04T09:00:00.000Z")).toEqual({ ok: true });
    const rec = await loadDrillRecord(db, SCOPE, ID, "2026-11-04T09:00:00.000Z");
    if (rec === null || rec === "running") throw new Error("記録が無い");
    const paper = textOf(renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: DEMO.name, today: "2026-11-04" })));
    expect(withoutClockLeft(paper)).not.toMatch(DECIMAL_HOURS);
    // 紙面は数と単位を詰める（lib/forms/paper-text）。区切り 0〜70 分の見出し
    expect(paper).toContain("経過 0時間〜1時間10分");
    const band = aiStopBand(rec.screen.ticks, { virtual: false, running: false, now: null, clock: true });
    if (band) expect(textOf(renderToStaticMarkup(createElement(AiStopBand, { band })))).not.toMatch(DECIMAL_HOURS);
  });
});
