// T124（docs/tasks/T124.md）: 訓練の 10 分版を開始の画面と開始の API から外した。
// 開始の画面は大雨想定・地震想定・仮想の 3 つで、どれも連続の時計（T90）と手の決まり（T110）。進め方の 1 行で短く一通り試す道を見せる。
// 前からある 10 分版の記録（D1 の行）は、一覧・訓練記録の表・再生・紙・講評の入力で今までどおり読める。進行中の 10 分版も最後まで進められる。
// 前からある記録は、T124 の前と同じ形を lib の startDrill（開始の API の内側。本番で呼ぶのは startPost だけ）で作る。Claude は呼ばない。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { DrillRecordTable } from "../../components/drill/DrillRecordTable.tsx";
import { startBody, StartButtons } from "../../components/drill/StartButtons.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { DRILL_SCENARIOS } from "../db/types.ts";
import { drillScope, listDrills, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { listGet, replayGet, startPost, stepPost } from "./http.ts";
import { DRILL_API_LABELS, SCENARIO_LABELS, T124_LABELS } from "./labels.ts";
import { loadDrillRecord, reviewContextOf } from "./record.ts";
import { reviewText } from "./review.ts";
import { isStartScenario, SCENARIO_ORDER, SCENARIOS } from "./scenarios.ts";

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
const careManager = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
/** 審査員のケアマネの役（山本の担当一覧、書き手は審査員） */
const judge = (): Principal => careManager({ judge: true, admin: false, accountId: "acct-judge", displayName: "山本" });
const SCOPE = drillScope(careManager())!;
const START = "2026-11-05T01:00:00.000Z";
const LATER = "2026-11-05T02:00:00.000Z";
const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

/** 前からある 10 分版の訓練（T124 の前に始めた物と同じ形）を最後まで回す */
async function oldShort(id: string, at = START): Promise<void> {
  expect(await startDrill(db, SCOPE, "short", at, {}, () => id)).toEqual({ ok: true, id });
  for (let step = 0; step < SCENARIOS.short.hours.length - 1; step++) {
    const r = await json(await stepPost(db, careManager(), id, { step }, at));
    expect(r.status).toBe(200);
  }
}

describe("開始の画面（components/drill/StartButtons）", () => {
  const people = [
    { id: "p-01", name: "架空 一", canPress: true },
    { id: "p-02", name: "架空 二", canPress: true },
  ];
  const draw = () => renderToStaticMarkup(createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people, ai: { kind: "ready", remaining: 200, limit: 200 } }));

  it("始められる想定は大雨・地震・仮想の 3 つ。10 分版のボタンと見込みは無く、主の操作の色は先頭の地震想定だけ", () => {
    expect(SCENARIO_ORDER).toEqual(["earthquake", "heavy_rain", "virtual"]);
    expect(DRILL_SCENARIOS.filter(isStartScenario)).toEqual(["earthquake", "heavy_rain", "virtual"]);
    expect(isStartScenario("short")).toBe(false);
    const html = draw();
    expect([...html.matchAll(/data-scenario="([a-z_]+)"/g)].map((m) => m[1])).toEqual(["earthquake", "heavy_rain", "virtual"]);
    expect(html).not.toContain(SCENARIO_LABELS.short);
    expect(html).not.toContain('data-estimate-scenario="short"');
    // 主の操作の色（bg-accent-fill）は地震想定のボタンだけ
    const buttons = [...html.matchAll(/<button[^>]*data-scenario="([a-z_]+)"[^>]*>/g)];
    expect(buttons.filter((m) => m[0].includes("bg-accent-fill")).map((m) => m[1])).toEqual(["earthquake"]);
  });

  it("進め方の 1 行は出さない（T184。切り替えでなく説明で、押せそうに見えて読み違えた）", () => {
    const html = draw();
    expect(html).not.toContain("data-start-pace");
    expect(html.replace(/<[^>]+>/g, "")).not.toContain(T124_LABELS.pace);
  });

  it("押すと送る物: どの想定も連続の時計と手の決まり。設定で選んだ物はそのまま足す", () => {
    for (const s of SCENARIO_ORDER) expect(startBody(s)).toEqual({ scenario: s, options: { clock: true, terms: true } });
    expect(startBody("heavy_rain", { participants: ["p-01"], night: true })).toEqual({
      scenario: "heavy_rain",
      options: { participants: ["p-01"], night: true, clock: true, terms: true },
    });
  });
});

describe("開始の API（startPost）", () => {
  it("10 分版の開始は入力不正（400）で断り、行を作らない。設定を付けても・審査員の役でも同じ", async () => {
    for (const p of [careManager(), judge()]) {
      for (const body of [{ scenario: "short" }, { scenario: "short", options: { clock: true, terms: true } }, { scenario: "short", options: { participants: ["p-01"] } }]) {
        const r = await json(await startPost(db, p, body, START));
        expect(r).toEqual({ status: 400, body: { ok: false, error: "invalid", label: DRILL_API_LABELS.invalid } });
      }
    }
    expect(count("SELECT count(*) AS n FROM drills")).toBe(0);
  });

  it("大雨・地震・仮想は開始の画面と同じ送り方で始まり、連続の時計の訓練になる", async () => {
    for (const s of SCENARIO_ORDER) {
      const r = await json(await startPost(db, careManager(), startBody(s), START));
      expect(r.status).toBe(200);
      const id = r.body.id as string;
      const state = stateOfRow((await loadDrillRow(db, DEMO.id, id))!);
      expect(state.scenario).toBe(s);
      expect(state.options).toMatchObject({ clock: true, terms: true });
      // 次の想定を始められるよう中断（進行中はケアマネごとに 1 つ）
      sqlite.exec(`UPDATE drills SET status = 'abandoned', finished_at = '${START}' WHERE id = '${id}'`);
    }
  });
});

describe("前からある 10 分版の記録", () => {
  it("一覧（API と訓練記録の表）に「10 分版」のまま出て、再生・紙・講評の入力で読める", async () => {
    await oldShort("old-short");
    const list = await json(await listGet(db, careManager(), LATER));
    expect(list.body.drills).toMatchObject([{ id: "old-short", scenario: "short", status: "finished", last: 72 }]);
    const items = await listDrills(db, DEMO.id, 50, LATER);
    const table = renderToStaticMarkup(createElement(DrillRecordTable, { items }));
    expect(table).toContain(SCENARIO_LABELS.short);

    // 再生: 4 刻み（0・3・12・72 時間）を 0 から順に
    for (const [step, hour] of SCENARIOS.short.hours.entries()) {
      const r = await json(await replayGet(db, careManager(), "old-short", String(step)));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, shown: step, hour, drill: { scenario: "short", status: "finished" } });
    }

    // 紙（訓練記録）と講評の入力
    const rec = await loadDrillRecord(db, SCOPE, "old-short", LATER);
    if (rec === null || rec === "running") throw new Error("記録が無い");
    const paper = renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: "デモ事業所", today: "2026-11-05" }));
    // 紙は字の間の空きを詰める（「10分版（72時間）」）
    expect(paper).toContain(`<dt>想定</dt><dd>${SCENARIO_LABELS.short.replaceAll(" ", "")}（72時間）</dd>`);
    expect(reviewText(reviewContextOf(rec), new Map())).toContain(`（${SCENARIO_LABELS.short}）`);
  });

  it("T124 の前に始めて進行中の 10 分版は、開始の画面が無くても最後まで進められる（刻みの道のまま）", async () => {
    expect(await startDrill(db, SCOPE, "short", START, {}, () => "running-short")).toEqual({ ok: true, id: "running-short" });
    const list = await json(await listGet(db, careManager(), START));
    expect(list.body.drills).toMatchObject([{ id: "running-short", scenario: "short", status: "running", step: 0, hour: 0 }]);
    const hours: number[] = [];
    for (let step = 0; step < SCENARIOS.short.hours.length - 1; step++) {
      const r = await json(await stepPost(db, careManager(), "running-short", { step }, START));
      hours.push(r.body.hour as number);
    }
    expect(hours).toEqual([3, 12, 72]);
    expect((await loadDrillRow(db, DEMO.id, "running-short"))!.status).toBe("finished");
  });

  it("D1 に直に残った 10 分版の行（種の外の事業所の物と同じ形）も一覧から落ちない", async () => {
    sqlite.exec(
      `INSERT INTO drills (id, office_id, scenario, status, started_by, started_at, finished_at) VALUES ('raw-short', 'office-demo', 'short', 'finished', 'acct-yamamoto', '${START}', '${START}')`,
    );
    const list = await json(await listGet(db, careManager(), LATER));
    expect((list.body.drills as Array<{ id: string; scenario: string }>).map((d) => [d.id, d.scenario])).toEqual([["raw-short", "short"]]);
  });
});
