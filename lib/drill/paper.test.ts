// 訓練記録の紙面（T22）: 中身（概要・採点・講評・確認欄・対応履歴）、言葉、紙の CSS、?print=1、頁数（A4 縦）。
// 訓練は node:sqlite の D1 と種の 10 人で本物の道（開始 → 手 → 着信の応答・拒否 → 最後まで進める）で作る。Claude は呼ばない。
// 頁数は headless Chrome の印刷（printToPDF、CSS の @page）。Chrome・Edge か BIZ UDPゴシックが無ければ飛ばす（lib/forms/print-pages.test.ts と同じ）。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { seedStatements } from "../../seed/sql.ts";
import { chromePath, pdfPageCount } from "../../tools/print/chrome.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction } from "../db/types.ts";
import { FONT_PROBE, paperCss, paperPage, readRepoFile } from "../forms/print-harness.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { actionPost } from "./http.ts";
import { loadDrillRecord, type DrillRecord, type StoredReview } from "./record.ts";
import { loadCallRecords, respondCall } from "./responses.ts";
import { REVIEW_BANNED } from "./review.ts";
import { scoreView } from "./score-view.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

/** 大雨（d1）と、そのあとの 10 分版（d2、前回は d1）。訓練を回すのは重いので、全部のテストで 1 回だけ作って使い回す */
let rec1: DrillRecord;
let rec2: DrillRecord;

beforeAll(async () => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
  rec1 = await heavyRain("d1");
  expect(await startDrill(db, SCOPE, "short", "2026-11-06T01:00:00.000Z", {}, () => "d2")).toEqual({ ok: true, id: "d2" });
  await finish("d2");
  const r = await loadDrillRecord(db, SCOPE, "d2", "2026-11-06T02:00:00.000Z");
  if (r === null || r === "running") throw new Error("記録が無い");
  rec2 = r;
}, 120_000);
afterAll(() => sqlite.close());

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
const LATER = "2026-11-05T02:00:00.000Z";
const TODAY = "2026-11-05";

async function act(id: string, kind: DrillAction, person: string | null) {
  const row = (await loadDrillRow(db, DEMO.id, id))!;
  const n = stateOfRow(row).actions.length;
  const res = await actionPost(db, careManager(), id, { step: row.step, actions: n, kind, person, target: null }, START, { roll: () => 0 });
  expect(res.status).toBe(200);
}

async function finish(id: string) {
  for (;;) {
    const row = (await loadDrillRow(db, DEMO.id, id))!;
    if (row.status !== "running") return;
    expect((await advanceDrill(db, SCOPE, id, row.step, START)).ok).toBe(true);
  }
}

/** 大雨の訓練を 1 回（0 時間に 3 つの手と着信の応答・拒否、最後まで進める） */
async function heavyRain(id = "d1"): Promise<DrillRecord> {
  expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => id)).toEqual({ ok: true, id });
  await act(id, "call_person", "p-03");
  await act(id, "call_person", "p-01");
  await act(id, "report_city", null);
  const [c0, c1] = await loadCallRecords(db, id);
  await respondCall(db, SCOPE, id, c0.signal, "answer");
  await respondCall(db, SCOPE, id, c1.signal, "decline");
  await finish(id);
  const rec = await loadDrillRecord(db, SCOPE, id, LATER);
  if (rec === null || rec === "running") throw new Error("記録が無い");
  return rec;
}

const DONE: StoredReview = {
  state: "done",
  ai: {
    summary: "行政報告は早かった。次は停電の前に小林さんへ訪問依頼を。",
    findings: [
      { person: "p-02", kind: "reached", text: "停電の 1 時間のあと、小林さんへの手が無いまま時計が切れた。訪問依頼か受入依頼を。", basis: "nanbyo-tsuiho-2022" },
      { person: null, kind: "report", text: "行政報告は 20 分で届いた。", basis: null },
    ],
    model: "claude-opus-5-5",
    at: LATER,
  },
  edited: null,
};

const html = (rec: DrillRecord) => renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: "デモ事業所", today: TODAY }));

describe("訓練記録の紙面（中身）", () => {
  it("概要・採点（数字 4 つと前回）・内訳・講評・確認欄・対応履歴の順。講評が無ければ「講評なし」", async () => {
    const rec = rec1;
    const m = html(rec);
    const order = ["summary", "score", "review", "confirm", "history"].map((b) => m.indexOf(`data-block="${b}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(m).toContain('data-paper-root="true"');
    // 数字 4 つ（紙は数字と単位を詰める）
    expect([...m.matchAll(/data-score-key="(\w+)"/g)].map((x) => x[1])).toEqual(["order", "report", "form9", "reached"]);
    expect(m).toContain("2/10");
    expect(m).toContain("20分");
    // 条件到達: 小林（人工呼吸器 内蔵電池）
    expect(m).toMatch(/data-detail="reached"[\s\S]*小林[\s\S]*人工呼吸器 内蔵電池 3時間を超過/);
    // 着信の応答・拒否
    expect(m).toContain("応答 1・拒否 1");
    // 講評なし（鍵なしで作っていない）
    expect(m).toContain('data-review-none="true">講評なし');
    // 対応履歴: 経過 0 時間に本人電話 2 つと行政報告、着信 2 件
    expect(m).toMatch(/data-hour="0"[\s\S]*本人電話[\s\S]*本人電話[\s\S]*行政報告/);
    expect((m.match(/data-call="answer"/g) ?? []).length).toBe(1);
    expect((m.match(/data-call="decline"/g) ?? []).length).toBe(1);
    // 年 1 回の訓練の記録の体裁: 事業所・実施日（和暦）・実施者・確認欄
    expect(m).toContain("事業所 デモ事業所");
    expect(m).toContain("実施日 令和8年11月5日");
    expect(m).toMatch(/管理者[\s\S]*確認日[\s\S]*印/);
  });

  it("講評があれば AI の印・指摘・出典（登録簿の発行元と年、確認前は未確認）。直した物は修正済", async () => {
    const rec = rec1;
    const m = html({ ...rec, review: DONE });
    expect(m).toMatch(/講評 <span class="drill-ai">AI<\/span>/);
    expect(m).toContain("行政報告は早かった。");
    expect(m).toMatch(/data-finding="reached"[\s\S]*小林 トシ[\s\S]*難病/);
    expect(m).not.toContain("修正済");
    const edited: StoredReview = { ...DONE, edited: { summary: "次は訪問依頼を先に。", findings: [], by: "山本", at: LATER } } as StoredReview;
    const e = html({ ...rec, review: edited });
    expect(e).toContain("修正済");
    expect(e).toContain("次は訪問依頼を先に。");
    expect(e).not.toContain("行政報告は早かった。");
  });

  it("前回があれば並べる（同じ事業所・同じ災害の前の訓練）", () => {
    const rec = rec2;
    expect(rec1.previous).toBeNull();
    const v = scoreView(rec.score, rec.screen.names, rec.previous);
    expect(v.rows.map((r) => [r.key, r.now, r.prev])).toEqual([
      ["order", "0/10", "2/10"],
      ["report", "未報告", "0 時間 20 分"],
      ["form9", "3", "3"],
      ["reached", String(rec.score.reached.length), "1"],
    ]);
    expect(html(rec)).toMatch(/前回[\s\S]*令和8年11月5日 大雨の想定/);
  });

  it("紙と画面の言葉に「死亡」「関連死」「診断」「判定」「重症」が無い", async () => {
    const rec = rec1;
    for (const m of [html(rec), html({ ...rec, review: DONE })]) {
      const text = m.replace(/<[^>]+>/g, " ");
      expect(text).not.toMatch(/死亡|関連死|診断|判定|重症/);
      expect(text).not.toMatch(REVIEW_BANNED);
    }
  });
});

describe("訓練記録の紙面（CSS と印刷の道）", () => {
  const css = readRepoFile("components/drill/drill-paper.css");

  it("A4 縦の名前付きの頁（drill-record）で、名前の無い @page を書かない。角の丸み・影・字間を使わない", () => {
    expect(css).toMatch(/@page drill-record \{\s*size: A4 portrait;\s*margin: 20mm 18mm;/);
    expect(css).not.toMatch(/@page\s*\{/);
    expect(css).not.toMatch(/border-radius|box-shadow|linear-gradient|radial-gradient/);
    expect(css).not.toMatch(/letter-spacing:(?!\s*0[;\s])/);
    expect(css).not.toMatch(/overflow-wrap:\s*anywhere|word-break:\s*break-all/);
  });

  it("?print=1 を受けて印刷のボタンの auto に渡す。訓練の画面と一覧から ?print=1 で開く", () => {
    const page = readRepoFile("app/drill/[id]/report/page.tsx");
    expect(page).toContain("wantsPrint((await searchParams).print)");
    expect(page).toContain("autoPrint={autoPrint}");
    expect(page).toContain('import "@/components/forms/paper.css"');
    expect(readRepoFile("app/drill/[id]/page.tsx")).toContain("reportHref(id, { print: true })");
    expect(readRepoFile("app/drill/page.tsx")).toContain("reportHref(d.id, { print: true })");
  });
});

const chrome = chromePath();

describe.skipIf(!chrome)("訓練記録の紙面の印刷（headless Chrome の printToPDF）", () => {
  let browser: Browser;
  let page: Page;
  let fontOk = false;
  const css = paperCss() + "\n" + readRepoFile("components/drill/drill-paper.css");

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
    await page.setContent(paperPage("<p>書体</p>", css));
    fontOk = (await page.evaluate(FONT_PROBE)) === true;
  }, 180_000);

  // 全部のテストを並べて走らせると Chrome を閉じるのに 10 秒を超えることがある
  afterAll(async () => {
    await browser?.close();
  }, 60_000);

  async function pdfOf(body: string): Promise<Uint8Array> {
    await page.emulateMediaType(undefined);
    await page.setContent(paperPage(body, css), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return page.pdf({ preferCSSPageSize: true, printBackground: true });
  }

  it("大雨の訓練（講評つき）は A4 縦で 2〜4 頁。上の帯と画面だけの操作は紙に出ない", async (ctx) => {
    if (!fontOk) ctx.skip();
    const rec = rec1;
    const pdf = await pdfOf(html({ ...rec, review: DONE }));
    const n = pdfPageCount(pdf);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
    const boxes = [...Buffer.from(pdf).toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)];
    expect(boxes.length).toBe(n);
    for (const b of boxes) {
      expect(Math.round(Number(b[1]))).toBe(595);
      expect(Math.round(Number(b[2]))).toBe(842);
    }
    await page.emulateMediaType("print");
    const shown = await page.evaluate(() => ({
      header: document.querySelector('[data-test="app-header"]')!.checkVisibility(),
      bar: document.querySelector('[data-test="screen-bar"]')!.checkVisibility(),
      paper: document.querySelector('[data-sheet="drill-record"]')!.checkVisibility(),
    }));
    await page.emulateMediaType(undefined);
    expect(shown).toEqual({ header: false, bar: false, paper: true });
  }, 120_000);
});
