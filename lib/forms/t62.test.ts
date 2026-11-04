// 書き出しの幅（docs/tasks/T62.md）: 担当一覧の CSV・受け持ちの CSV・本人の 1 枚の一括印刷。
// CSV の中身（BOM・CRLF・式の守り・列の数と順・画面と同じ行と順・発災時の列）、権限（401・403・404）、
// 受け持ちの CSV が同意の範囲の濾し（理由・医療が空）を守る、一括印刷の読み（飛ばした人・QR・並べた読みの時間）と頁数（printToPDF）。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。Claude は呼ばない（この作業は Claude を使わない）。
// 書き出した CSV・PDF はファイルに残さない（中身はメモリで確かめるだけ）。

import type { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OwnSheetBatch } from "../../components/forms/OwnSheetBatch.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { chromePath, pdfPageCount } from "../../tools/print/chrome.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload, type Caseload } from "../caseload.ts";
import { staffActor } from "../custody/actor.ts";
import { loadStaffBoard } from "../custody/board.ts";
import { parseStaffView, staffQueryOf, staffViewQuery, staffViewRows } from "../custody/staff-view.ts";
import { receive } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { COLOR_LABELS, stateLabel } from "../labels.ts";
import { listHref, listQueryOf, listView, type ListQuery } from "../list/view.ts";
import { issueQr, loadQrRow, qrState } from "../qr/store.ts";
import { caseloadColumns, caseloadCsvResponse } from "./caseload-csv.ts";
import { CSV_BOM, csvFileNames, csvText } from "./form9-csv.ts";
import { buildOwnSheetMedical } from "./medical-summary.ts";
import { buildOwnSheet } from "./own-sheet.ts";
import { loadOfficeSheetRows, loadOwnSheets, type OwnSheetItem } from "./own-sheets.ts";
import { loadPersonDocument } from "../consent/documents.ts";
import type { D1Database } from "@cloudflare/workers-types";
import { FONT_PROBE, paperCss, paperPage, readRepoFile, seedRows } from "./print-harness.ts";
import { staffCsvResponse, STAFF_COLUMNS } from "./staff-csv.ts";

const TODAY = "2026-11-03";
const DISASTER_AT = "2026-11-03T00:00:00.000Z";
const AT = "2026-11-03T01:00:00.000Z";
const NOW = "2026-11-03T02:00:00.000Z";
const SHELTER = "みどり小学校";
const SECRET = "test-secret-for-t62-0123456789abcdef";
const ORIGIN = "https://care72.app";
const PARTNER_PERSON = "p-partner-1";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  // 協力事業所の本人 1 人（デモ事業所の山本の範囲の外）と、別の医療班（受け持ちなし）
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, ledger)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01',
               '{"basic":{"address":{"city":"松山市","town":"ほしぞら町"}},"care":{},"medical":{"devices":[],"medications":[]},"evacuation":{"hazards":[]},"notes":[],"pending":[]}')`,
    )
    .run(PARTNER_PERSON);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-2', NULL, 'medical', '医療班 2')`).run();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
/** 山本（デモ事業所のケアマネ） */
const yamamoto = (p: Partial<Principal> = {}): Principal => ({
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
/** 審査員のケアマネの役（山本の担当を見る） */
const judgeCm = () => yamamoto({ judge: true, admin: false, accountId: "acct-judge", displayName: null });
/** 審査員の医療班の役 */
const judgeMedical = () => yamamoto({ role: "medical", judge: true, admin: false, accountId: "acct-judge", displayName: null, caseloadOf: null });
const medical2 = () => yamamoto({ role: "medical", admin: false, accountId: "acct-med-2", displayName: "医療班 2", office: null, caseloadOf: null });
const family = () => yamamoto({ role: "family", admin: false, accountId: null, caseloadOf: null, personId: "p-01", contactId: "c-01-1" });
const unselected = () => yamamoto({ role: "unselected", judge: true, admin: false, accountId: "acct-judge", caseloadOf: null });

const AT_NOW = { today: TODAY, now: NOW };

function heavyRain() {
  sqlite
    .prepare(
      `INSERT INTO disaster_state (office_id, kind, started_at, started_by, outage_scope, version, updated_by, updated_at)
       VALUES ('office-demo', 'heavy_rain', ?, 'acct-yamamoto', 'none', 1, 'acct-yamamoto', ?)`,
    )
    .run(DISASTER_AT, DISASTER_AT);
}

/** CSV を行と欄に（"" の囲みと "" の中の "" を読む） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function csvOf(res: Response): Promise<{ raw: string; rows: string[][] }> {
  // res.text() は先頭の BOM を落とすので、バイトで読む（先頭が EF BB BF）
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const raw = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  expect(raw.startsWith(CSV_BOM)).toBe(true);
  return { raw, rows: parseCsv(raw.slice(CSV_BOM.length)) };
}

const params = (q: string) => new URLSearchParams(q);
const caseload = async (): Promise<Caseload> =>
  (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW))!;

const NORMAL_HEADERS = ["組", "氏名", "カナ", "年齢", "介護度", "医療", "ハザード", "支援者", "避難計画", "未確認", "地区"];

describe("CSV の共通の道（様式 9 の csvText・csvFileNames）", () => {
  it("名前の頭を渡せる。渡さなければ様式 9 のまま", () => {
    expect(csvFileNames("2026-11-03T05:07:00.000Z")).toEqual({ ascii: "form9-20261103-1407.csv", utf8: "様式9_20261103-1407.csv" });
    expect(csvFileNames("2026-11-03T05:07:00.000Z", { ascii: "caseload", utf8: "担当一覧" })).toEqual({
      ascii: "caseload-20261103-1407.csv",
      utf8: "担当一覧_20261103-1407.csv",
    });
  });

  it("csvText: BOM・CRLF・式の守り・囲み", () => {
    expect(csvText([["a", "=1+1"], ['x,"y"']])).toBe(`${CSV_BOM}a,'=1+1\r\n"x,""y"""\r\n`);
  });
});

describe("担当一覧の CSV（/caseload/csv）", () => {
  it("平時: 上の 2 行・空行・見出し 11 列・画面と同じ 10 行が同じ順。BOM・CRLF・no-store・ファイル名", async () => {
    const res = await caseloadCsvResponse(db, yamamoto(), params(""), AT_NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const disposition = res.headers.get("Content-Disposition")!;
    expect(disposition).toContain('filename="caseload-20261103-1100.csv"');
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("担当一覧_20261103-1100.csv")}`);
    const { raw, rows } = await csvOf(res);
    // 行の終わりは CRLF だけ（LF だけの行が無い）
    expect(raw.endsWith("\r\n")).toBe(true);
    expect(raw.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    expect(rows[0]).toEqual(["担当一覧"]);
    expect(rows[1]).toEqual(["事業所名：デモ事業所", "担当：山本", "作成：2026年11月3日", "並び：組", "絞込：なし"]);
    expect(rows[2]).toEqual([""]);
    expect(rows[3]).toEqual(NORMAL_HEADERS);
    const body = rows.slice(4);
    for (const r of body) expect(r).toHaveLength(NORMAL_HEADERS.length);
    const screen = listView(await caseload(), {});
    expect(body.map((r) => r[1])).toEqual(screen.rows.map((r) => r.name));
    expect(body).toHaveLength(10);
    // 組は骨格の段（T78 で平時の「連絡順」から改名）、カナ・避難計画・未確認・地区は行の値
    const first = screen.rows[0];
    expect(body[0][0]).toBe(String(first.tier));
    expect(body[0][2]).toBe(first.kana);
    expect(body[0][9]).toBe(String(first.pending));
    expect(body[0][10]).toBe(first.town ?? "");
  });

  it("絞込と並び: URL の query を担当一覧と同じ読み方で受け、今 画面に出ている行をその順で書く", async () => {
    const data = await caseload();
    const queries = ["sort=age&dir=asc", "mark=oxygen", "q=やまだ", "sort=hazard&area=ほしぞら町", "sort=kana&dir=desc&mark=dialysis"];
    for (const q of queries) {
      const { rows } = await csvOf(await caseloadCsvResponse(db, yamamoto(), params(q), AT_NOW));
      const screen = listView(data, listQueryOf(params(q)));
      expect(rows.slice(4).map((r) => r[1]), q).toEqual(screen.rows.map((r) => r.name));
    }
    const { rows } = await csvOf(await caseloadCsvResponse(db, yamamoto(), params("sort=age&dir=asc&mark=oxygen"), AT_NOW));
    expect(rows[1].slice(3)).toEqual(["並び：年齢・介護度 昇順", "絞込：酸素"]);
    expect(rows.length - 4).toBeLessThan(10);
  });

  it("平時は色の絞込と発災時だけの並びを効かせない（画面と同じ）。同じ名前の 2 つの値は画面と同じく効かない", async () => {
    const base = (await csvOf(await caseloadCsvResponse(db, yamamoto(), params(""), AT_NOW))).rows;
    for (const q of ["color=red", "sort=state", "sort=remain", "sort=contact", "mark=oxygen&mark=dialysis"]) {
      const { rows } = await csvOf(await caseloadCsvResponse(db, yamamoto(), params(q), AT_NOW));
      expect(rows.slice(4), q).toEqual(base.slice(4));
    }
    expect(listQueryOf(params("mark=a&mark=b&q=x"))).toEqual({ mark: ["a", "b"], q: "x" } satisfies ListQuery);
  });

  it("発災時: 連絡順（画面と同じ番号）・状態・理由・組（骨格の段）、末尾に 残り・最終連絡。連絡順は絞っても元の番号", async () => {
    heavyRain();
    const data = await caseload();
    const head = ["連絡順", "状態", "理由", "組", ...NORMAL_HEADERS.slice(1), "残り", "最終連絡"];
    expect(caseloadColumns(true).map((c) => c.header)).toEqual(head);
    // 2 つの番号は別の見出し（同じ名前の列が無い）
    expect(new Set(head).size).toBe(head.length);
    const { rows } = await csvOf(await caseloadCsvResponse(db, yamamoto(), params(""), AT_NOW));
    expect(rows[3]).toEqual(head);
    const screen = listView(data, {});
    const body = rows.slice(4);
    expect(body.map((r) => r[4])).toEqual(screen.rows.map((r) => r.name));
    body.forEach((r, i) => {
      const s = screen.rows[i];
      expect(r).toHaveLength(16);
      // 連絡順は発災時の表の「連絡順」の列（DisasterTable の data-rank）と同じ rank
      expect(r[0]).toBe(String(s.rank));
      expect(r[1]).toBe(stateLabel(s.triage!));
      expect(r[2]).toBe(s.triage!.reason);
      expect(r[3]).toBe(String(s.tier));
      expect(r[14]).toBe(s.remain ? `${s.remain.text} ${s.remain.label}` : "");
      expect(r[15]).toBe(s.lastContact ? `${s.lastContact.when} ${s.lastContact.source}` : "連絡なし");
    });
    // 既定の並びはルールの表の順（連絡順 1, 2, 3…）。山田 ハナは画面も CSV も 1
    expect(body.map((r) => Number(r[0]))).toEqual(body.map((_, i) => i + 1));
    expect(body.find((r) => r[4] === "山田 ハナ")![0]).toBe(String(screen.rows.find((r) => r.id === "p-01")!.rank));

    // 色で絞る: 連絡順は絞る前の番号のまま。2 行目に絞込の言葉
    const color = screen.rows[screen.rows.length - 1].triage!.color;
    const filtered = await csvOf(await caseloadCsvResponse(db, yamamoto(), params(`color=${color}`), AT_NOW));
    const want = listView(data, { color });
    expect(filtered.rows.slice(4).map((r) => r[0])).toEqual(want.rows.map((r) => String(r.rank)));
    expect(filtered.rows[1][4]).toBe(`絞込：${COLOR_LABELS[color]}`);
    expect(want.rows.length).toBeLessThan(10);
  });

  it("式の守り: = で始まる欄は ' を付け、「,」「\"」を含む欄は囲む", async () => {
    sqlite.prepare(`UPDATE people SET name = '=HYPERLINK("x","y")' WHERE id = 'p-01'`).run();
    const { raw, rows } = await csvOf(await caseloadCsvResponse(db, yamamoto(), params(""), AT_NOW));
    expect(raw).toContain(`"'=HYPERLINK(""x"",""y"")"`);
    expect(rows.slice(4).some((r) => r[1] === `'=HYPERLINK("x","y")`)).toBe(true);
  });

  it("権限: ログインなし 401、ケアマネの役でなければ 403、担当が無ければ 404。審査員のケアマネの役は山本の担当", async () => {
    const status = async (p: Principal | null) => (await caseloadCsvResponse(db, p, params(""), AT_NOW)).status;
    expect(await status(null)).toBe(401);
    expect(await (await caseloadCsvResponse(db, null, params(""), AT_NOW)).json()).toMatchObject({ error: "login_required" });
    expect(await status(judgeMedical())).toBe(403);
    expect(await status(family())).toBe(403);
    expect(await status(unselected())).toBe(403);
    expect(await status(yamamoto({ caseloadOf: null }))).toBe(403);
    expect(await status(yamamoto({ caseloadOf: "acct-nobody" }))).toBe(404);
    expect(await status(yamamoto({ office: { id: "office-partner", name: "協力事業所", kind: "regular" } }))).toBe(404);
    const judge = await caseloadCsvResponse(db, judgeCm(), params(""), AT_NOW);
    expect(judge.status).toBe(200);
    expect((await csvOf(judge)).rows.slice(4)).toHaveLength(10);
  });
});

describe("受け持ちの CSV（/staff/csv）", () => {
  const actor = (p: Principal = judgeMedical()) => staffActor(p)!;

  it("loadStaffBoard の行をそのまま表の順で。列 14。同意の無い人は理由・医療・薬・機器・残りが空（濾しを守る）", async () => {
    heavyRain();
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    await receive(db, actor(), { personId: "p-02", shelter: SHELTER, via: "qr" }, AT);
    // 審査員はほかの事業所の人を受け入れられない（T81）。T81 の前に開いた受け持ち（壁の無い受入）も表と CSV に出さない
    expect(await receive(db, actor(), { personId: PARTNER_PERSON, shelter: "そらみ台小学校", via: "shelter" }, AT)).toEqual({ ok: false, error: "not_found" });
    await receive(db, { ...actor(), walled: false }, { personId: PARTNER_PERSON, shelter: "そらみ台小学校", via: "shelter" }, AT);
    // 別の医療班の受け持ちは入らない
    await receive(db, actor(medical2()), { personId: "p-03", shelter: SHELTER, via: "search" }, AT);
    expect(sqlite.prepare(`UPDATE consents SET status = 'refused' WHERE person_id = 'p-01' AND kind = 'medical'`).run().changes).toBe(1);

    const res = await staffCsvResponse(db, judgeMedical(), params(""), AT_NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toContain('filename="staff-20261103-1100.csv"');
    const { rows } = await csvOf(res);
    expect(rows[0]).toEqual(["受入一覧"]);
    expect(rows[1]).toEqual(["受入者：審査員", "作成：2026年11月3日", "並び：連絡順", "絞込：なし", "2 人"]);
    const headers = ["連絡順", "状態", "理由", "氏名", "カナ", "年齢", "医療", "薬", "機器", "残り", "避難所", "経路", "受入時刻", "所属"];
    expect(rows[3]).toEqual(headers);
    expect(STAFF_COLUMNS.map((c) => c.header)).toEqual(headers);
    const board = await loadStaffBoard(db, actor(), TODAY, NOW);
    const body = rows.slice(4);
    expect(body.map((r) => r[3])).toEqual(board.rows.map((r) => r.name));
    expect(body.map((r) => r[0])).toEqual(["1", "2"]);
    for (const r of body) expect(r).toHaveLength(14);

    const yamada = body.find((r) => r[3] === "山田 ハナ")!;
    expect(yamada.slice(6, 10)).toEqual(["", "", "", ""]);
    expect(yamada[2]).toBe("");
    expect(yamada[1]).toBe(stateLabel(board.rows.find((r) => r.personId === "p-01")!));
    // 同意のある人は理由と医療が入る（行の値をそのまま）
    const p02 = board.rows.find((r) => r.personId === "p-02")!;
    const row02 = body.find((r) => r[3] === p02.name)!;
    expect(row02[2]).toBe(p02.reason);
    expect(row02[8]).toBe(p02.devices.join("・"));
    expect(row02[11]).toBe("QR");
    expect(row02[12]).toBe(p02.receivedWhen);
    expect(board.rows.filter((r) => r.personId !== "p-01").some((r) => r.reason !== "")).toBe(true);
    expect(row02[13]).toBe("デモ事業所");
    expect(body.some((r) => r[3] === "架空 太郎")).toBe(false);
    expect(body.some((r) => r[3] === SEED_PEOPLE.find((p) => p.person.id === "p-03")!.person.name)).toBe(false);
  });

  it("権限: ログインなし 401、医療班・行政でなければ 403。受け持ちが無ければ見出しだけ", async () => {
    expect((await staffCsvResponse(db, null, params(""), AT_NOW)).status).toBe(401);
    expect((await staffCsvResponse(db, yamamoto(), params(""), AT_NOW)).status).toBe(403);
    expect((await staffCsvResponse(db, family(), params(""), AT_NOW)).status).toBe(403);
    expect((await staffCsvResponse(db, unselected(), params(""), AT_NOW)).status).toBe(403);
    const gov = await staffCsvResponse(db, yamamoto({ role: "government", admin: false, accountId: "acct-med-2", office: null, caseloadOf: null }), params(""), AT_NOW);
    expect(gov.status).toBe(200);
    const { rows } = await csvOf(gov);
    expect(rows).toHaveLength(4);
    expect(rows[1][4]).toBe("0 人");
  });

  it("表の絞込（避難所・状態・氏名）と並びを URL の query で受け、表と同じ行と順を書く。連絡順は絞る前の番号", async () => {
    heavyRain();
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    await receive(db, actor(), { personId: "p-02", shelter: SHELTER, via: "qr" }, AT);
    await receive(db, actor(), { personId: "p-04", shelter: "そらみ台小学校", via: "search" }, AT);
    await receive(db, actor(), { personId: PARTNER_PERSON, shelter: "そらみ台小学校", via: "shelter" }, AT);
    const board = await loadStaffBoard(db, actor(), TODAY, NOW);
    const color = board.rows[0].color;
    const queries = [
      "",
      "shelter=" + encodeURIComponent(SHELTER),
      "color=" + color,
      "q=" + encodeURIComponent("かくう"),
      "sort=age",
      "sort=kana&shelter=" + encodeURIComponent("そらみ台小学校"),
      // 無い避難所は全部に戻す（表と同じ）。同じ名前の 2 つの値は効かない
      "shelter=" + encodeURIComponent("無い学校"),
      "color=red&color=green",
    ];
    for (const q of queries) {
      const { rows } = await csvOf(await staffCsvResponse(db, judgeMedical(), params(q), AT_NOW));
      const want = staffViewRows(board.rows, board.shelters, parseStaffView(staffQueryOf(params(q))));
      expect(rows.slice(4).map((r) => r[3]), q).toEqual(want.map((r) => r.name));
      expect(rows.slice(4).map((r) => r[0]), q).toEqual(want.map((r) => String(r.rank)));
      expect(rows[1][4], q).toBe(`${want.length} 人`);
    }
    const one = await csvOf(await staffCsvResponse(db, judgeMedical(), params("sort=age&q=" + encodeURIComponent("やまだ")), AT_NOW));
    expect(one.rows.slice(4).map((r) => r[3])).toEqual(["山田 ハナ"]);
    expect(one.rows[1].slice(2, 4)).toEqual(["並び：年齢", "絞込：検索 やまだ"]);
    const shelter = await csvOf(await staffCsvResponse(db, judgeMedical(), params("color=" + color + "&shelter=" + encodeURIComponent(SHELTER)), AT_NOW));
    expect(shelter.rows[1][3]).toBe(`絞込：${SHELTER}・${COLOR_LABELS[color]}`);
  });

  it("表の絞込の URL: 既定は書かない、形の違う物は無かったことに、読んで書くと同じ", () => {
    expect(staffViewQuery(parseStaffView({}))).toBe("");
    expect(parseStaffView({ color: "blue", sort: "name", shelter: ["a", "b"], q: "  ヤマ  " })).toEqual({ shelter: "", color: "", q: "ヤマ", sort: "rank" });
    const v = parseStaffView({ shelter: SHELTER, color: "red", q: "やま", sort: "received" });
    expect(parseStaffView(Object.fromEntries(new URLSearchParams(staffViewQuery(v))))).toEqual(v);
    expect(parseStaffView({ q: "あ".repeat(60) }).q).toHaveLength(40);
  });
});

describe("本人の 1 枚の一括印刷の読み（/caseload/own-sheets）", () => {
  const opts = (o: Partial<Parameters<typeof loadOwnSheets>[3]> = {}) => ({
    today: TODAY,
    officeName: "デモ事業所",
    secret: SECRET,
    origin: ORIGIN,
    nowSec: Math.floor(Date.parse(NOW) / 1000),
    ...o,
  });

  it("担当一覧と同じ行の順に人数分。1 人ずつ本人の 1 枚の頁と同じ紙。10 人の読みを並べて測る", async () => {
    const view = listView(await caseload(), {});
    const ids = view.rows.map((r) => r.id);
    const t0 = performance.now();
    const batch = await loadOwnSheets(db, yamamoto(), ids, opts());
    const ms = performance.now() - t0;
    console.info(`[T62] 一括印刷の読み 10 人 ${ms.toFixed(0)} ms（node:sqlite。本物の D1 の往復時間ではない）`);
    expect(batch.items.map((x) => x.personId)).toEqual(ids);
    expect(batch.skipped).toBe(0);
    const rows = seedRows(SEED_PEOPLE.find((p) => p.person.id === ids[0])!);
    expect(batch.items[0].sheet.name).toBe(buildOwnSheet(rows, { today: TODAY, officeName: "デモ事業所" }).name);
    // 未確認のある人（紙で「ケアマネジャーと 決めます」と出る所のある人）
    expect(batch.unconfirmed).toEqual(batch.items.filter((x) => x.sheet.open.some((o) => o.kind === "decide")).map((x) => x.sheet.name));
    // QR はまだ作っていない（未作成の枠）
    expect(batch.items.every((x) => x.qr.status === "none" && x.qr.url === null)).toBe(true);
    expect(ms).toBeLessThan(10_000);
  });

  it("QR は 1 人の頁と同じ（有効なら今の版の /q/ の URL、元の分からないときは刷らない）", async () => {
    await issueQr(db, "p-01", NOW);
    const batch = await loadOwnSheets(db, yamamoto(), ["p-01", "p-02"], opts());
    expect(batch.items[0].qr.status).toBe("active");
    expect(batch.items[0].qr.url).toMatch(new RegExp(`^${ORIGIN}/q/`));
    expect(batch.items[0].qr.expiresAt).not.toBeNull();
    expect(batch.items[1].qr.status).toBe("none");
    const noOrigin = await loadOwnSheets(db, yamamoto(), ["p-01"], opts({ origin: null }));
    expect(noOrigin.items[0].qr).toMatchObject({ status: "active", url: null });
  });

  it("範囲の外（別の事業所・無い id）と、本人の 1 枚が同意の範囲に無い役は飛ばして数える", async () => {
    const batch = await loadOwnSheets(db, yamamoto(), ["p-01", PARTNER_PERSON, "p-none", "p-02"], opts());
    expect(batch.items.map((x) => x.personId)).toEqual(["p-01", "p-02"]);
    expect(batch.skipped).toBe(2);
    // 医療班は受け入れた人の本人のページは開けるが、本人の 1 枚は範囲に無い（頁の入口はケアマネの役だけ。ここは読みの守り）
    await receive(db, staffActor(judgeMedical())!, { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    const med = await loadOwnSheets(db, judgeMedical(), ["p-01", "p-02"], opts());
    expect(med).toMatchObject({ items: [], skipped: 2 });
  });
});

/** D1 の往復を数える（batch 1 回・文 1 つずつの first/all/run を 1 回と数える） */
function counting(inner: D1Database): { db: D1Database; calls: () => number } {
  let n = 0;
  // batch には包む前の文を渡す（手元の D1 の代わりは文の物で SQL を覚えている）
  const orig = new WeakMap<object, object>();
  const wrap = (stmt: ReturnType<D1Database["prepare"]>): ReturnType<D1Database["prepare"]> => {
    const proxy = new Proxy(stmt, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (k === "bind") return (...args: unknown[]) => wrap((v as (...a: unknown[]) => typeof stmt).apply(t, args));
        if (k === "first" || k === "all" || k === "run" || k === "raw")
          return (...args: unknown[]) => {
            n++;
            return (v as (...a: unknown[]) => unknown).apply(t, args);
          };
        return v;
      },
    });
    orig.set(proxy, stmt);
    return proxy;
  };
  const db = new Proxy(inner, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k === "prepare") return (sql: string) => wrap(t.prepare(sql));
      if (k === "batch")
        return (stmts: unknown[]) => {
          n++;
          return t.batch(stmts.map((x) => orig.get(x as object) ?? x) as never);
        };
      return v;
    },
  });
  return { db, calls: () => n };
}

describe("一括印刷のまとめ読み（D1 の batch・IN）", () => {
  const opts = { today: TODAY, officeName: "デモ事業所", secret: SECRET, origin: ORIGIN, nowSec: Math.floor(Date.parse(NOW) / 1000) };

  it("人数に関わらず D1 の往復は 1 回（10 人でも 1 人でも）。前は 1 人 3 回", async () => {
    const ids = listView(await caseload(), {}).rows.map((r) => r.id);
    for (const n of [1, 3, 10]) {
      const c = counting(db);
      const batch = await loadOwnSheets(c.db, yamamoto(), ids.slice(0, n), opts);
      expect(batch.items).toHaveLength(n);
      expect(c.calls(), `${n} 人`).toBe(1);
    }
    // 0 人は読まない
    const none = counting(db);
    expect(await loadOwnSheets(none.db, yamamoto(), [], opts)).toEqual({ items: [], skipped: 0, unconfirmed: [] });
    expect(none.calls()).toBe(0);
  });

  it("まとめ読みの紙は 1 人の頁の道（loadPersonDocument）と同じ（表・裏の要約・QR）", async () => {
    // QR の期限の日数（T64 の qr_ttl_days）もまとめ読みで同じに読む
    await issueQr(db, "p-03", NOW, 30);
    await issueQr(db, "p-05", NOW);
    sqlite.prepare(`UPDATE consents SET status = 'refused' WHERE person_id = 'p-02' AND kind = 'supporters'`).run();
    const ids = SEED_PEOPLE.map((p) => p.person.id);
    const batch = await loadOwnSheets(db, yamamoto(), ids, opts);
    expect(batch.items).toHaveLength(10);
    for (const item of batch.items) {
      const one = (await loadPersonDocument(db, yamamoto(), item.personId, "own"))!;
      const o = { today: TODAY, officeName: "デモ事業所" };
      expect(item.sheet, item.personId).toEqual(buildOwnSheet(one.rows, o));
      expect(item.medical, item.personId).toEqual(buildOwnSheetMedical(one.rows, o));
    }
    for (const id of ["p-03", "p-05", "p-01"]) {
      const want = qrState((await loadQrRow(db, id))!, opts.nowSec);
      expect(batch.items.find((x) => x.personId === id)!.qr, id).toMatchObject({ status: want.status, expiresAt: want.expiresAt });
    }
    expect(batch.items.find((x) => x.personId === "p-03")!.qr.expiresAt).toBe(new Date(Date.parse(NOW) + 30 * 86_400_000).toISOString());
  });

  it("壁: 別の事業所の本人・無い id は読まない（連絡先・同意・時計も事業所の中だけ）", async () => {
    const read = await loadOfficeSheetRows(db, "office-demo", ["p-01", PARTNER_PERSON, "p-none"]);
    expect([...read.keys()]).toEqual(["p-01"]);
    sqlite
      .prepare(`INSERT INTO contacts (id, person_id, kind, relation, name, phone) VALUES ('c-pt-9', ?, 'family', '娘', '架空 花子', '090-0000-0099')`)
      .run(PARTNER_PERSON);
    const partner = await loadOfficeSheetRows(db, "office-partner", ["p-01", PARTNER_PERSON]);
    expect([...partner.keys()]).toEqual([PARTNER_PERSON]);
    expect(partner.get(PARTNER_PERSON)!.rows.contacts.map((c) => c.id)).toEqual(["c-pt-9"]);
  });

  it("本人の 1 枚と裏の要約は経過と提供の記録を読まない（まとめ読みは読まないので、読むようになったらここで落とす）", () => {
    for (const f of ["lib/forms/own-sheet.ts", "lib/forms/medical-summary.ts"]) {
      expect(readRepoFile(f), f).not.toMatch(/timeline|provisions/);
    }
  });
});

describe("入口と頁の作り（ファイルを読む）", () => {
  it("route は lib の関数を呼ぶだけ。頁はケアマネの役、listView、?print=1 で印刷の窓、題に氏名を入れない", () => {
    expect(readRepoFile("app/caseload/csv/route.ts")).toContain("caseloadCsvResponse(env.DB, principal, new URL(request.url).searchParams");
    expect(readRepoFile("app/staff/csv/route.ts")).toContain("staffCsvResponse(env.DB, principal,");
    const page = readRepoFile("app/caseload/own-sheets/page.tsx");
    expect(page).toContain('requirePage("caseload")');
    expect(page).toContain("listView(data, q)");
    expect(page).toContain("autoPrint={any && wantsPrint(q.print)}");
    expect(page).toContain("export const metadata: Metadata = { title: DOCUMENT_LABELS.own };");
    expect(page).toContain('import "@/components/forms/own-batch.css";');
    expect(page).toContain("<OwnSheetBatch items={batch.items} />");
    // Claude を呼ばない
    for (const f of ["lib/forms/caseload-csv.ts", "lib/forms/staff-csv.ts", "lib/forms/own-sheets.ts", "app/caseload/own-sheets/page.tsx"]) {
      expect(readRepoFile(f), f).not.toMatch(/askJson|lib\/claude/);
    }
  });

  it("担当一覧は画面・CSV・一括印刷が同じ listView。書き出しの 2 つは絞込の帯の右端の 1 か所（T78）、今の query を持ち越す", async () => {
    const list = readRepoFile("app/page.tsx");
    expect(list).toContain("listView(data, q)");
    expect(list).toContain("listHref(CASELOAD_CSV_PATH, view)");
    expect(list).toContain('listHref(OWN_SHEETS_PATH, view, { print: "1" })');
    expect(list.match(/<ExportButtons view=\{lv\} \/>/g)).toHaveLength(1);
    expect(list).toContain("filterBar(<ExportButtons view={lv} />)");
    expect(readRepoFile("components/list/FilterBar.tsx")).toContain("data-filter-actions");
    // 受け持ち: 見出しの CSV出力は URL の絞込と並びを持ち越す。表は絞込と並びを URL に書き、CSV と同じ関数で行を決める
    const staff = readRepoFile("app/staff/page.tsx");
    // 見出しの行の右の 1 か所（T99 から自分のパスワードの変更と並べる囲み StaffPassword の中。右寄せは囲みが持つ）
    expect(staff.match(/<StaffCsvLink\b/g)).toHaveLength(1);
    expect(staff).toMatch(/<StaffPassword [^>]*>\s*<StaffCsvLink \/>/);
    expect(staff).toContain("view={parseStaffView(q)}");
    const link = readRepoFile("components/staff/StaffCsvLink.tsx");
    expect(link).toContain("useSearchParams()");
    expect(link).toContain("STAFF_CSV_PATH}?");
    const table = readRepoFile("components/staff/StaffTable.tsx");
    expect(table).toContain("staffViewRows(rows, shelters,");
    // data は null（Next の状態の物を渡すと useSearchParams が付いてこず、CSV出力の href が古いまま。手元の dev で確かめた）
    expect(table).toContain("window.history.replaceState(null, ");

    const view = listView(await caseload(), { sort: "age", dir: "asc", mark: "oxygen", q: "山" });
    expect(listHref("/caseload/csv", view)).toBe(`/caseload/csv?sort=age&dir=asc&mark=oxygen&q=${encodeURIComponent("山")}`);
    expect(listHref("/caseload/own-sheets", view, { print: "1" })).toBe(
      `/caseload/own-sheets?print=1&sort=age&dir=asc&mark=oxygen&q=${encodeURIComponent("山")}`,
    );
    expect(listHref("/caseload/csv", listView(await caseload(), {}))).toBe("/caseload/csv");
  });

  it("人の間の割り: 最後の人の裏のあとは割らない（paper.css の .paper:last-child より強い選び方）", () => {
    const css = readRepoFile("components/forms/own-batch.css");
    expect(css).toMatch(/@media print \{\s*\.own-batch > \.paper-scroll:not\(:last-child\) \.paper:last-child \{\s*break-after: page;/);
  });
});

/** 種の 1 人の本人の 1 枚（D1 を使わない。QR は有効の見本） */
function itemOf(id: string): OwnSheetItem {
  const rows = seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
  const opts = { today: TODAY, officeName: "デモ事業所" };
  return {
    personId: id,
    sheet: buildOwnSheet(rows, opts),
    medical: buildOwnSheetMedical(rows, opts),
    qr: { status: "active", url: `${ORIGIN}/q/${"x".repeat(160)}`, expiresAt: "2027-02-01T00:00:00.000Z" },
  };
}
const batchHtml = (ids: string[]) => renderToStaticMarkup(createElement(OwnSheetBatch, { items: ids.map(itemOf) }));
const IDS = SEED_PEOPLE.map((p) => p.person.id);

describe("一括印刷の紙面（Chrome なしで読む）", () => {
  it("人数分の紙面が渡した順に並び、頁の下の端は 1 人ずつ 1/2・2/2", () => {
    const html = batchHtml(IDS.slice(0, 3));
    expect([...html.matchAll(/data-sheet="own" data-person="([^"]+)"/g)].map((m) => m[1])).toEqual(IDS.slice(0, 3));
    expect([...html.matchAll(/data-paper-foot="(\d+\/\d+)"/g)].map((m) => m[1])).toEqual(["1/2", "2/2", "1/2", "2/2", "1/2", "2/2"]);
    expect(html).toContain('data-own-batch="3"');
  });
});

const chrome = chromePath();

describe.skipIf(!chrome)("一括印刷の頁数（headless Chrome の printToPDF）", () => {
  let browser: Browser;
  let page: Page;
  let fontOk = false;
  const css = paperCss() + "\n" + readRepoFile("components/forms/own-batch.css");

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
    await page.setContent(paperPage("<p>書体</p>", css));
    fontOk = (await page.evaluate(FONT_PROBE)) === true;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function pages(body: string): Promise<number> {
    await page.setContent(paperPage(body, css), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return pdfPageCount(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  }

  it("種の 3 人で 6 頁、10 人で 20 頁（1 人 2 頁、人の境で割れ、最後に空の頁が無い）", async (ctx) => {
    if (!fontOk) ctx.skip();
    const t0 = performance.now();
    expect(await pages(batchHtml(IDS.slice(0, 3)))).toBe(6);
    expect(await pages(batchHtml(IDS))).toBe(20);
    console.info(`[T62] 一括印刷の PDF 3 人・10 人 ${(performance.now() - t0).toFixed(0)} ms`);
  }, 120_000);

  it("1 人だけでも 2 頁（最後の人の裏のあとに空の頁を作らない）", async (ctx) => {
    if (!fontOk) ctx.skip();
    expect(await pages(batchHtml(["p-01"]))).toBe(2);
  }, 60_000);

  it("印刷の CSS で、人の裏のあとは break-after: page、最後の人の裏だけ auto（紙が 297mm に満ちていなくても割れる）", async () => {
    // 紙は min-height 297mm なので、割りの指定が無くても頁数は 2N になる（頁数だけでは割りの指定を確かめられない）。計算した値で見る
    await page.emulateMediaType("print");
    await page.setContent(paperPage(batchHtml(IDS.slice(0, 3)), css), { waitUntil: "load" });
    const breaks = await page.evaluate(() =>
      [...document.querySelectorAll(".own-batch .paper")].map((el) => getComputedStyle(el).breakAfter),
    );
    await page.emulateMediaType(undefined);
    expect(breaks).toEqual(["page", "page", "page", "page", "page", "auto"]);
  }, 60_000);
});
