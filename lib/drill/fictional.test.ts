// 訓練の人の「架空」の印（T48、アドバイザーの返事: 訓練の 10 人には「AI が演じる架空の人」と表示する）。
// 種の 10 人で大雨の訓練を最後まで進め（Claude は呼ばない。想定の表の固定の安否）、左の表・状況・訓練記録の紙面に
// 10 人全員の印が付くこと、画面の上の 1 行の文を確かめる。着信の画面（IncomingCall）は読み込み後に描くので、手元の画面で見た（docs/progress/t48.md）。

import type { DatabaseSync } from "node:sqlite";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { FictionalMark, FictionalNote } from "../../components/drill/Fictional.tsx";
import { Situation } from "../../components/drill/Situation.tsx";
import { DisasterTable } from "../../components/list/DisasterTable.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill } from "./db.ts";
import { FICTION_LABELS } from "./labels.ts";
import { loadDrillRecord } from "./record.ts";
import { loadDrillScreen, type DrillScreen } from "./view.ts";

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
const ID = "drill-fiction";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
let screen: DrillScreen;

beforeAll(async () => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
  expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID)).toEqual({ ok: true, id: ID });
  for (;;) {
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    if (row.status !== "running") break;
    expect((await advanceDrill(db, SCOPE, ID, row.step, START)).ok).toBe(true);
  }
  screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
}, 120_000);
afterAll(() => sqlite.close());

const marks = (html: string) => html.match(/data-fictional(?![-\w])/g)?.length ?? 0;
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("訓練の人の「架空」の印", () => {
  it("左の表: 10 人全員の名前のそばに「架空」（読み上げは「AI が演じる架空の人」）", () => {
    expect(screen.rows).toHaveLength(SEED_PEOPLE.length);
    const html = renderToStaticMarkup(
      createElement(DisasterTable, {
        rows: screen.rows,
        sort: "state",
        slots: { sortHref: () => "#", nameHref: () => null, nameMark: () => createElement(FictionalMark), detail: () => null },
      }),
    );
    expect(marks(html)).toBe(10);
    expect(html).toContain(`aria-label="${FICTION_LABELS.title}"`);
    expect(html).toContain(`>${FICTION_LABELS.mark}<`);
  });

  it("担当一覧（本番）の表は slots の印が無ければ出さない", () => {
    const html = renderToStaticMarkup(createElement(DisasterTable, { rows: screen.rows, sort: "state" }));
    expect(marks(html)).toBe(0);
  });

  it("状況: 本人役・家族役の安否の行（吹き出しの元）は全部、名前のそばに印", () => {
    const html = renderToStaticMarkup(createElement(Situation, { ticks: screen.ticks, names: screen.names, startedAt: screen.drill.started_at }));
    const turns = [...html.matchAll(/<li[^>]*data-turn="([^"]+)"[\s\S]*?<\/li>/g)];
    expect(turns.length).toBeGreaterThan(0);
    for (const t of turns) expect(marks(t[0]), t[1]).toBe(1);
    // 大雨の筋で連絡のあった人（10 人のうち 8 人）は全員、どの行にも印
    expect(new Set(turns.map((t) => t[1])).size).toBeGreaterThanOrEqual(8);
  });

  it("画面の上の 1 行と、訓練記録の紙面の参加者の欄", async () => {
    expect(text(renderToStaticMarkup(createElement(Fragment, null, createElement(FictionalNote))))).toBe(
      `${FICTION_LABELS.mark}${FICTION_LABELS.note}`,
    );
    const rec = await loadDrillRecord(db, SCOPE, ID, "2026-11-05T02:00:00.000Z");
    if (rec === null || rec === "running") throw new Error("記録が無い");
    const paper = renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: "デモ事業所", today: "2026-11-05" }));
    expect(text(paper)).toContain(FICTION_LABELS.title);
  });
});
