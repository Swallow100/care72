// 訓練の幅（T59）の画面: 開始の設定（閉じたまま）・早送りの間・メモの欄・取消と取消不可・夜間発災の時刻・訓練記録の「取消 N」とメモ。
// 描くだけ（renderToStaticMarkup）。訓練は node:sqlite の D1 と種の 10 人で本物の道で作る。Claude は呼ばない。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionLog } from "../../components/drill/ActionLog.tsx";
import { ActionPanel } from "../../components/drill/ActionPanel.tsx";
import { DrillBar } from "../../components/drill/DrillBar.tsx";
import { DrillControls } from "../../components/drill/DrillControls.tsx";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { StartButtons } from "../../components/drill/StartButtons.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { actDrill, advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow, undoDrill } from "./db.ts";
import { shortJst } from "../disaster/state.ts";
import { lastStep, nowHour } from "./engine.ts";
import { nightTimeLabel } from "./night.ts";
import { loadDrillRecord } from "./record.ts";
import { SCENARIO_ORDER } from "./scenarios.ts";
import { loadDrillScreen, screenTimeText } from "./view.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

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
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-ui";
const MEMO = "停電の地区から先";

const row = async () => (await loadDrillRow(db, DEMO.id, ID))!;
async function doAct(kind: "visit" | "call_person", person: string, memo?: string) {
  const r = await row();
  return actDrill(db, SCOPE, ID, { step: r.step, actions: stateOfRow(r).actions.length }, { kind, person, target: null, ...(memo ? { memo } : {}) }, START, {
    roll: () => 0,
  });
}

describe("開始の設定", () => {
  it("閉じたまま（既定）: 設定のボタンだけで、参加者・職員・夜間発災の欄は無い。想定のボタンは大雨・地震・仮想の並び（10 分版は T124 で外した）", () => {
    const html = renderToStaticMarkup(
      createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people: [{ id: "p-01", name: "山田 太郎" }] }),
    );
    expect(html).toContain("data-start-settings");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-start-options");
    expect(html).not.toContain("<details");
    expect(html).not.toContain('data-scenario="short"');
    expect([...html.matchAll(/data-scenario="([a-z_]+)"/g)].map((m) => m[1])).toEqual(["heavy_rain", "earthquake", "virtual"]);
  });
});

describe("早送りの間とメモの欄", () => {
  it("早送り（T128 から自動進行）の間は決まった 2.5 秒。間の選択は外し、何をくり返すかと間は title に", () => {
    const html = renderToStaticMarkup(createElement(DrillControls, { id: ID, step: 0, done: false }));
    expect(html).not.toContain('data-action="fast-interval"');
    expect(html).toContain('data-action="fast"');
    expect(html).toMatch(/title="進める 2\.5 秒ごと"/);
  });

  it("対応の欄にメモ（100 字まで）。焦点の枠つき", () => {
    const html = renderToStaticMarkup(createElement(ActionPanel, { drillId: ID, step: 0, actions: 0, people: [], contacts: {} }));
    expect(html).toContain("data-act-memo-input");
    expect(html).toContain('maxLength="100"');
    expect(html).toContain("focus-visible:outline-solid");
  });
});

describe("取消・取消不可・メモの行", () => {
  it("最後の手が刻みを越えなければ「取消」、取り消すと手が消える。越えた手は「取消不可」", async () => {
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID)).toEqual({ ok: true, id: ID });
    await doAct("call_person", "p-01", MEMO);
    let s = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(s.undoable).toBe("a1");
    const undo = { drillId: ID, step: s.drill.step, actions: s.state.actions.length, act: s.undoable };
    let html = renderToStaticMarkup(createElement(ActionLog, { actions: s.state.actions, hours: s.hours, current: s.shown, names: s.names, undo }));
    expect(html).toContain('data-undo="a1"');
    expect(html).toContain("data-act-memo-text");
    expect(html).toContain(MEMO);
    // 再生（undo を渡さない）には取消を出さない
    html = renderToStaticMarkup(createElement(ActionLog, { actions: s.state.actions, hours: s.hours, current: s.shown, names: s.names }));
    expect(html).not.toContain("data-undo");

    // 刻みを越える手のあとは取消不可
    await doAct("visit", "p-03");
    await doAct("visit", "p-05");
    s = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(s.undoable).toBeNull();
    html = renderToStaticMarkup(
      createElement(ActionLog, {
        actions: s.state.actions,
        hours: s.hours,
        current: s.shown,
        names: s.names,
        undo: { drillId: ID, step: s.drill.step, actions: s.state.actions.length, act: s.undoable },
      }),
    );
    expect(html).toContain("data-undo-locked");
    expect(html).toContain("取消不可");
    expect(html).not.toContain("data-undo=");
  });
});

describe("夜間発災の時刻", () => {
  it("夜間発災の訓練だけ、72 時間の棒の下に時刻の行（発災 2 時・今 何時）", () => {
    const base = { hours: [0, 1, 3], last: 72, now: 3, bands: [], reached: 2 };
    expect(renderToStaticMarkup(createElement(DrillBar, { ...base, night: true }))).toContain('data-night-clock="5"');
    expect(renderToStaticMarkup(createElement(DrillBar, base))).not.toContain("data-night-clock");
  });
});

describe("経過の下の時刻", () => {
  it("夜間発災は訓練の中の時刻（深夜 2 時＋経過）で、棒の「今 N 時」と同じ時。started_at はずらさない", async () => {
    expect(nightTimeLabel(0)).toBe("2:00");
    expect(nightTimeLabel(85)).toBe("3:25");
    expect(nightTimeLabel(22 * 60 + 5)).toBe("0:05");
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID, { night: true })).toEqual({ ok: true, id: ID });
    await doAct("visit", "p-04"); // 40 分
    const s = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(s.drill.started_at).toBe(START);
    expect(screenTimeText(s)).toBe("2:40");
    const bar = renderToStaticMarkup(createElement(DrillBar, { hours: s.hours, last: s.last, now: nowHour(s.state), bands: s.bands, reached: s.drill.step, night: true }));
    expect(bar).toContain(`data-night-clock="${screenTimeText(s).split(":")[0]}"`);
  });

  it("選ばなければ今まで通り開始からの実の日時", async () => {
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID)).toEqual({ ok: true, id: ID });
    const s = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screenTimeText(s)).toBe(shortJst(s.situation.now));
  });
});

describe("訓練記録の紙面", () => {
  it("取消の数・選んだ物・手のメモ。何も選ばず取り消さなければ出さない", async () => {
    expect(await startDrill(db, SCOPE, "short", START, {}, () => ID, { staff: 1, night: true })).toEqual({ ok: true, id: ID });
    await doAct("call_person", "p-02");
    let r = await row();
    expect(await undoDrill(db, SCOPE, ID, { step: r.step, actions: 1 })).toMatchObject({ ok: true });
    await doAct("call_person", "p-01", MEMO);
    while ((r = await row()).step < lastStep("short")) await advanceDrill(db, SCOPE, ID, r.step, START);
    const rec = await loadDrillRecord(db, SCOPE, ID, "2026-11-05T02:00:00.000Z");
    if (rec === null || rec === "running") throw new Error("記録が無い");
    const html = renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: DEMO.name, today: "2026-11-05" }));
    expect(html).toContain('data-undone="1"');
    expect(html).toContain("data-settings");
    expect(html).toContain("夜間発災");
    expect(html).toContain('data-memo="a2"');
    expect(html).toContain(MEMO);

    // 何も選ばず取り消さない訓練
    sqlite.exec("DELETE FROM drills");
    expect(await startDrill(db, SCOPE, "short", START, {}, () => "plain")).toEqual({ ok: true, id: "plain" });
    let p = (await loadDrillRow(db, DEMO.id, "plain"))!;
    while (p.step < lastStep("short")) {
      await advanceDrill(db, SCOPE, "plain", p.step, START);
      p = (await loadDrillRow(db, DEMO.id, "plain"))!;
    }
    const plain = await loadDrillRecord(db, SCOPE, "plain", "2026-11-05T02:00:00.000Z");
    if (plain === null || plain === "running") throw new Error("記録が無い");
    const h2 = renderToStaticMarkup(createElement(DrillPaper, { record: plain, office: DEMO.name, today: "2026-11-05" }));
    expect(h2).not.toContain("data-undone");
    expect(h2).not.toContain("data-settings");
    expect(h2).not.toContain("data-memo");
  });
});
