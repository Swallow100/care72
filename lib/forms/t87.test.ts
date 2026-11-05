// T87: ヘッダーの「書類」、書類と様式を選んで出す一覧（/forms）、未確認の欄を数える関数（紙には刷らない）、?form= の様式の指定、一括印刷。
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DocumentMenu, DocumentPeople } from "../../components/forms/DocumentList.tsx";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { PaperBatch, type BatchPaper } from "../../components/forms/PaperBatch.tsx";
import { UnconfirmedFold } from "../../components/forms/UnconfirmedFold.tsx";
import { PaperBar } from "../../components/ui/PaperBar.tsx";
import { FormsTabs } from "../../components/ui/Tabs.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { chromePath, pdfPageCount } from "../../tools/print/chrome.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { PersonPageRows } from "../person.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { DOCUMENT_CATALOG, MATSUYAMA_ENTRY, type PlanFormId } from "./catalog.ts";
import {
  batchHref,
  buildPlanSheet,
  documentMenu,
  personDocRow,
  planRow,
  resolvePlanForm,
  selectDocument,
  type ResolvedPlanForm,
} from "./document-list.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { checkReadResult, type FormMapping, type MappingField } from "./mapping.ts";
import { insertReadMapping, saveCheckedMapping } from "./mapping-db.ts";
import { buildMatsuyamaSheet, MATSUYAMA_FIELDS, type Cell } from "./matsuyama.ts";
import { caoMapping, listPlanForms, savePlanForm, type PlanFormOption } from "./plan-form.ts";
import { FONT_PROBE, paperCss, paperPage, readRepoFile, seedRows } from "./print-harness.ts";
import {
  isUnconfirmedCell,
  mappedUnconfirmed,
  matsuyamaFieldName,
  matsuyamaUnconfirmed,
  unconfirmedText,
  unconfirmedView,
} from "./unconfirmed.ts";

const TODAY = "2026-11-04";
const OPTS = { today: TODAY, officeName: "デモ事業所" };
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const rowsOf = (id: string): PersonPageRows => seedRows(seed(id));
const IDS = SEED_PEOPLE.filter((p) => p.person.office_id === "office-demo").map((p) => p.person.id);
const HANDWRITE = MATSUYAMA_FIELDS.filter((f) => f.shape === "handwrite");

describe("未確認の欄を数える（松山市の計画書）", () => {
  it("種の人: 紙で未確認と刷る欄を全部、1 欄 1 つで数える。手書きの欄・同意の無い範囲・値のある欄は数えない", () => {
    for (const id of IDS) {
      const sheet = buildMatsuyamaSheet(rowsOf(id), OPTS);
      const s = matsuyamaUnconfirmed(sheet);
      const names = new Set(s.fields.map((f) => f.name));
      expect(s.count, id).toBe(s.fields.length);
      expect(s.count, id).toBeGreaterThan(0);
      for (const def of MATSUYAMA_FIELDS) {
        const cell = (sheet.cells as Record<string, Cell>)[def.key];
        const counted = names.has(matsuyamaFieldName(def));
        if (def.shape === "handwrite") expect(counted, `${id} ${def.key}`).toBe(false);
        else expect(counted, `${id} ${def.key}`).toBe(isUnconfirmedCell(cell));
      }
    }
  });

  it("手で書く欄（番号・自署・代理人・市受付印）は数えない", () => {
    expect(HANDWRITE.map((f) => f.key)).toEqual(["head.number", "sign.self", "sign.proxy", "city.stamp"]);
    const names = matsuyamaUnconfirmed(buildMatsuyamaSheet(rowsOf("p-01"), OPTS)).fields.map((f) => f.name);
    for (const f of HANDWRITE) expect(names).not.toContain(matsuyamaFieldName(f));
  });

  it("欄の名前は欄ごとに違う（同じ名前の欄には段、避難場所の手段・時間にはその避難場所を添える）", () => {
    const names = MATSUYAMA_FIELDS.filter((f) => f.shape !== "handwrite").map(matsuyamaFieldName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["近親者 フリガナ", "実施者1 フリガナ", "実施者2 同意", "事前避難場所 手段", "最寄りの避難場所 時間", "住居 種別", "地域 その他", "特記 その他", "かかりつけ医・薬局"]) {
      expect(names).toContain(n);
    }
    // 様式の飾り（【】・※・末尾の：・（複数選択可））は名前に残さない
    for (const n of names) expect(n).not.toMatch(/[【】※]|：$|（複数選択可）/);
  });

  it("手書き（台帳に置き場の無い欄・手で印を付ける欄）と未入力を分ける。値の中の未確認は所の名前、pending の理由を添える", () => {
    const s = matsuyamaUnconfirmed(buildMatsuyamaSheet(rowsOf("p-01"), OPTS));
    const by = (n: string) => s.fields.find((f) => f.name === n)!;
    // T117: 近親者のフリガナ・最寄りの避難場所は台帳に置き場ができた（未入力）。手書きは引用の印だけ
    expect(by("近親者 フリガナ").noSource).toBe(false);
    expect(by("最寄りの避難場所").noSource).toBe(false);
    expect(s.hand?.map((f) => f.name)).toEqual(["まつやま総合防災マップからの引用"]);
    expect(by("かかりつけ医・薬局").noSource).toBe(false);
    // 薬の欄は値があり、中の用量・残りが未確認
    expect(by("医薬品情報").parts).toEqual(expect.arrayContaining(["用量", "残り"]));
    expect(unconfirmedText(by("医薬品情報"))).toMatch(/^医薬品情報（.*用量.*）$/);
    // 台帳の pending（不明）の欄は理由を添える
    const reasoned = s.fields.filter((f) => f.reason !== null && f.parts.length === 0);
    expect(reasoned.length).toBeGreaterThan(0);
    for (const f of reasoned) expect(unconfirmedText(f)).toMatch(/（(不明|未聴取|無回答)）$/);
    const v = unconfirmedView(s);
    // 未確認は台帳に置き場のある欄（問い ＋ 未入力）、手書きは別に数える（T117）
    expect(v.count).toBe((v.ask ?? []).length + v.blank.length);
    expect(v.blank).toContain("近親者 フリガナ");
    expect(v.noSource).toEqual(["まつやま総合防災マップからの引用"]);
  });

  it("同意の無い範囲（省略）は数えない: 支援者提供の無い人は実施者の欄を数えない", () => {
    const sheet = buildMatsuyamaSheet(rowsOf("p-07"), OPTS);
    expect(sheet.withheld).toContain("supporters");
    const names = matsuyamaUnconfirmed(sheet).fields.map((f) => f.name);
    expect(names.filter((n) => n.startsWith("実施者"))).toEqual([]);
  });

  it("字に「未確認」とあっても未確認の印の無い値は数えない。なし・手書き・省略も数えない", () => {
    expect(isUnconfirmedCell({ kind: "value", lines: [[{ text: "残りの日数は未確認" }]] })).toBe(false);
    expect(isUnconfirmedCell({ kind: "none" })).toBe(false);
    expect(isUnconfirmedCell({ kind: "handwrite" })).toBe(false);
    expect(isUnconfirmedCell({ kind: "withheld", consent: "supporters" })).toBe(false);
    expect(isUnconfirmedCell({ kind: "unconfirmed" })).toBe(true);
    expect(isUnconfirmedCell({ kind: "choice", options: [{ label: "徒歩", on: false }], unconfirmed: {} })).toBe(true);
    expect(isUnconfirmedCell({ kind: "value", lines: [[{ text: "用量", sub: true }, { text: "未確認", unconfirmed: true }]] })).toBe(true);
  });
});

describe("未確認の欄を数える（対応表の紙: 内閣府の様式例・事業所の対応表）", () => {
  it("内閣府: 差し込みの帯の未確認と同じ欄が同じ順。対応なしは項目の無い欄", () => {
    for (const id of IDS) {
      const sheet = buildMappedSheet(rowsOf(id), caoMapping(), OPTS);
      const s = mappedUnconfirmed(sheet);
      expect(s.fields.map((f) => f.name), id).toEqual(sheet.unconfirmed);
      expect(s.fields.filter((f) => f.noSource).map((f) => f.name), id).toEqual(sheet.unmapped);
    }
  });

  it("手で書く欄は数えない（対応表に署名の欄を足しても数は同じ）", () => {
    const m = caoMapping();
    const sign: MappingField = { ...m.fields[0], id: "f-sign", label: "署名", shape: "handwrite", item: null, options: [] };
    const withSign: FormMapping = { ...m, fields: [...m.fields, sign] };
    const a = mappedUnconfirmed(buildMappedSheet(rowsOf("p-01"), m, OPTS));
    const b = mappedUnconfirmed(buildMappedSheet(rowsOf("p-01"), withSign, OPTS));
    expect(b.count).toBe(a.count);
    expect(b.fields.map((f) => f.name)).not.toContain(`${sign.section} 署名`.trim());
  });
});

// ---------- D1（種の事業所と、ほかの事業所） ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const principal = { role: "care_manager", judge: false, admin: false, accountId: "acct-yamamoto", displayName: "山本", office: { id: "office-demo", name: "デモ事業所", kind: "demo" }, caseloadOf: "acct-yamamoto", personId: null, contactId: null } as const;

/** 内閣府の読み取りの形の対応表を 1 つ入れる（checked なら確かめた物） */
async function addMapping(id: string, officeId: string, checked: boolean): Promise<string> {
  const mapping = checkReadResult(CAO_FORM_READ).mapping;
  await insertReadMapping(db, { id, officeId, hash: createHash("sha256").update(id).digest("hex"), kind: "pdf", mapping, model: "test", by: "acct-yamamoto", at: "2026-11-04T00:00:00.000Z" });
  if (checked) {
    const r = await saveCheckedMapping(db, { officeId, id, version: 1, mapping, by: "acct-yamamoto", at: "2026-11-04T01:00:00.000Z" });
    expect(r.ok).toBe(true);
  }
  return id;
}

describe("書類の一覧の様式（?form=）", () => {
  it("計画書は松山市・内閣府・確かめた対応表（下書きは出さない）。使用様式に既定の印", async () => {
    await addMapping("map-ok", "office-demo", true);
    await addMapping("map-draft", "office-demo", false);
    const options = await listPlanForms(db, "office-demo");
    const sel = selectDocument(options, "matsuyama", {})!;
    expect(sel).toMatchObject({ doc: "plan", form: { id: "matsuyama" } });
    const menu = documentMenu(options, "matsuyama", sel);
    // T147: 事業所が足した様式は上に「追加済」の印で、元からある様式はその下
    expect(menu.plan.map((m) => m.key)).toEqual(["mapping:map-ok", "matsuyama", "cao"]);
    expect(menu.plan.map((m) => m.mark ?? null)).toEqual(["added", null, null]);
    expect(menu.plan.filter((m) => m.isDefault).map((m) => m.key)).toEqual(["matsuyama"]);
    expect(menu.plan.filter((m) => m.current).map((m) => m.key)).toEqual(["matsuyama"]);
    expect(menu.plan[0].href).toBe("/forms?form=mapping%3Amap-ok");
    expect(menu.person.map((m) => m.key)).toEqual(["medical", "own", "qr", "phone"]);
  });

  it("?form= で使用様式でない様式を選べる。使用様式を内閣府にすると、何も選ばないときと既定の印は内閣府", async () => {
    await addMapping("map-ok", "office-demo", true);
    const options = await listPlanForms(db, "office-demo");
    expect(selectDocument(options, "matsuyama", { form: "mapping:map-ok" })).toMatchObject({ doc: "plan", form: { id: "mapping:map-ok" } });
    expect(selectDocument(options, "matsuyama", { form: "cao" })).toMatchObject({ doc: "plan", form: { id: "cao" } });
    expect((await savePlanForm(db, principal, "cao")).ok).toBe(true);
    const current: PlanFormId = "cao";
    const sel = selectDocument(options, current, {})!;
    expect(sel).toMatchObject({ doc: "plan", form: { id: "cao" } });
    expect(documentMenu(options, current, sel).plan.filter((m) => m.isDefault).map((m) => m.key)).toEqual(["cao"]);
    // 一覧で別の様式を選んでも、使用様式（事業所の保存）は変わらない
    selectDocument(options, current, { form: "matsuyama" });
    expect(sqlite.prepare("SELECT plan_form FROM offices WHERE id = 'office-demo'").get()).toEqual({ plan_form: "cao" });
  });

  it("候補に無い様式は null（頁は 404）: ほかの事業所の確かめた対応表・下書き・知らない値。?doc= は本人ごとの書類だけ", async () => {
    await addMapping("map-draft", "office-demo", false);
    await addMapping("map-partner", "office-partner", true);
    const options = await listPlanForms(db, "office-demo");
    for (const form of ["mapping:map-partner", "mapping:map-draft", "mapping:gone", "tokyo", "", ["cao", "matsuyama"]]) {
      expect(selectDocument(options, "matsuyama", { form }), String(form)).toBeNull();
    }
    expect(selectDocument(options, "matsuyama", { doc: "medical" })).toMatchObject({ doc: "medical", entry: { id: "medical" } });
    expect(selectDocument(options, "matsuyama", { doc: "plan" })).toMatchObject({ doc: "plan", form: { id: "matsuyama" } });
    expect(selectDocument(options, "matsuyama", { doc: "form9" })).toBeNull();
    expect(selectDocument(options, "matsuyama", { doc: "x" })).toBeNull();
    // ほかの事業所の候補には出る（壁は事業所ごと）
    expect((await listPlanForms(db, "office-partner")).map((o) => o.id)).toContain("mapping:map-partner");
  });

  it("様式の中身を読むのも事業所の中だけ（ほかの事業所の対応表の id を渡しても null）", async () => {
    await addMapping("map-partner", "office-partner", true);
    const [partner] = (await listPlanForms(db, "office-partner")).filter((o) => o.id === "mapping:map-partner");
    expect(await resolvePlanForm(db, "office-demo", partner)).toBeNull();
    expect(await resolvePlanForm(db, "office-partner", partner)).toMatchObject({ kind: "mapped", mappingId: "map-partner" });
    const cao = (await listPlanForms(db, "office-demo")).find((o) => o.id === "cao")!;
    expect(await resolvePlanForm(db, "office-demo", cao)).toMatchObject({ kind: "mapped", mappingId: "builtin-cao", stored: null });
  });
});

const MATSUYAMA: ResolvedPlanForm = { id: "matsuyama", entry: MATSUYAMA_ENTRY, kind: "matsuyama" };
const CAO = (o: PlanFormOption): ResolvedPlanForm => ({ id: o.id, entry: o.entry, kind: "mapped", mappingId: "builtin-cao", mapping: caoMapping(), stored: null });

describe("人ごとの行", () => {
  it("計画書: 紙面の頁・印刷の窓・未確認の数（1 人の頁の帯と同じ数え方）", async () => {
    const r = planRow(rowsOf("p-01"), MATSUYAMA, OPTS);
    expect(r.href).toBe("/people/p-01/forms/matsuyama");
    expect(r.printHref).toBe("/people/p-01/forms/matsuyama?print=1");
    expect(r.unconfirmed!.count).toBe(matsuyamaUnconfirmed(buildMatsuyamaSheet(rowsOf("p-01"), OPTS)).count);
    const cao = (await listPlanForms(db, "office-demo")).find((o) => o.id === "cao")!;
    const c = planRow(rowsOf("p-01"), CAO(cao), OPTS);
    expect(c.href).toBe("/people/p-01/forms/mapped/builtin-cao");
    // 帯の未確認は台帳に置き場のある欄。対応の無い欄は手書き（T117 の問い 4）として別に数える
    expect(c.unconfirmed!.count + c.unconfirmed!.noSource.length).toBe(buildMappedSheet(rowsOf("p-01"), caoMapping(), OPTS).unconfirmed.length);
    expect(buildPlanSheet(rowsOf("p-01"), CAO(cao), OPTS).kind).toBe("mapped");
  });

  it("医療要約: 医療班提供の同意が無い人は出せない理由（印刷なし）。同意のある人は未確認の数", () => {
    const refused = personDocRow("medical", rowsOf("p-09"), OPTS);
    expect(refused.blocked).toEqual({ kind: "refused", reason: "医療班提供 不同意" });
    expect(refused.printHref).toBeNull();
    expect(refused.href).toBe("/people/p-09/forms/medical");
    const rows = rowsOf("p-01");
    const unasked = personDocRow("medical", { ...rows, consents: rows.consents.filter((c) => c.kind !== "medical") }, OPTS);
    expect(unasked.blocked).toEqual({ kind: "unconfirmed", reason: "医療班提供 未確認" });
    const ok = personDocRow("medical", rows, OPTS);
    expect(ok.blocked).toBeNull();
    expect(ok.printHref).toBe("/people/p-01/forms/medical?print=1");
    expect(ok.unconfirmed!.count).toBe(ok.unconfirmed!.blank.length);
    // QR・スマホ入口は数えない
    expect(personDocRow("qr", rows, OPTS).unconfirmed).toBeNull();
    expect(personDocRow("phone", rows, OPTS).href).toBe("/people/p-01/phone");
  });

  it("一括印刷の道: 計画書は様式つき、医療要約、本人の 1 枚は担当一覧の一括。QR・スマホ入口は 1 人ずつ", async () => {
    const options = await listPlanForms(db, "office-demo");
    expect(batchHref(selectDocument(options, "matsuyama", { form: "cao" })!)).toBe("/forms/batch?form=cao&print=1");
    expect(batchHref(selectDocument(options, "matsuyama", { doc: "medical" })!)).toBe("/forms/batch?doc=medical&print=1");
    expect(batchHref(selectDocument(options, "matsuyama", { doc: "own" })!)).toBe("/caseload/own-sheets?print=1");
    expect(batchHref(selectDocument(options, "matsuyama", { doc: "qr" })!)).toBeNull();
    expect(batchHref(selectDocument(options, "matsuyama", { doc: "phone" })!)).toBeNull();
  });
});

describe("画面（renderToStaticMarkup）", () => {
  it("帯の未確認: 数と、未入力・手書きの欄の一覧（閉じている間は hidden）。帯は印刷で消える（screen-only）", () => {
    const view = unconfirmedView(matsuyamaUnconfirmed(buildMatsuyamaSheet(rowsOf("p-01"), OPTS)));
    const bar = renderToStaticMarkup(
      createElement(PaperBar, { back: "/people/p-01", title: "計画書", children: createElement(UnconfirmedFold, { view }) }),
    );
    expect(bar).toMatch(/^<div class="screen-only /);
    expect(bar).toContain(`data-unconfirmed-fold="${view.count}"`);
    expect(bar).toContain('aria-expanded="false"');
    expect(bar).toMatch(/<dl id="unconfirmed-fields" hidden=""/);
    expect(bar).toContain(`未確認 <span class="tabular-nums">${view.count}</span>`);
    expect(bar).toContain("近親者 フリガナ");
    expect(bar).toContain('data-unconfirmed-group="blank"');
    expect(bar).toContain('data-unconfirmed-group="noSource"');
    // 未確認の無い紙面では何も出さない
    expect(bar).toContain(`data-unconfirmed-hand="${view.noSource.length}"`);
    expect(renderToStaticMarkup(createElement(UnconfirmedFold, { view: { count: 0, blank: [], noSource: [] } }))).toBe("");
    // 紙面（印刷する所）には数も欄の一覧も無い
    const paper = renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(rowsOf("p-01"), OPTS) }));
    expect(paper).not.toContain("data-unconfirmed-fold");
    expect(paper).not.toContain("近親者 フリガナ");
  });

  it("紙面の頁の帯は数える関数を使う（松山市・対応表）", () => {
    const m = readRepoFile("app/people/[id]/forms/matsuyama/page.tsx");
    expect(m).toContain("<UnconfirmedFold view={unconfirmed} />");
    expect(m).toContain("matsuyamaUnconfirmed(sheet, askable)");
    const p = readRepoFile("app/people/[id]/forms/mapped/[mappingId]/page.tsx");
    expect(p).toContain("<UnconfirmedFold view={unconfirmedView(mappedUnconfirmed(sheet))} />");
  });

  it("ヘッダーは「書類」（/forms）、中の切替は 書類・様式9・様式追加（様式追加の URL は前の様式対応のまま）", () => {
    const nav = readRepoFile("components/NavLinks.tsx");
    expect(nav).toContain('{ href: "/forms", label: "書類"');
    expect(nav).not.toMatch(/label: "様式"/);
    const tabs = renderToStaticMarkup(createElement(FormsTabs, { current: "list" }));
    expect([...tabs.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]])).toEqual([
      ["/forms", "書類"],
      ["/office/form9", "様式9"],
      ["/forms/mapping", "様式追加"],
    ]);
    expect(tabs).toMatch(/aria-current="page"[^>]*href="\/forms"/);
    expect(readRepoFile("app/forms/mapping/page.tsx")).toContain("{FORMS_LIST_LABELS.add}");
  });

  it("書類の一覧: 選んだ様式に下線、既定の印、様式追加、一括印刷、人ごとの未確認と同意で出せない理由", async () => {
    await addMapping("map-ok", "office-demo", true);
    const options = await listPlanForms(db, "office-demo");
    const sel = selectDocument(options, "matsuyama", { form: "cao" })!;
    const menu = documentMenu(options, "matsuyama", sel);
    const html = renderToStaticMarkup(createElement(DocumentMenu, { ...menu, office: [] }));
    expect(html).toMatch(/aria-current="page"[^>]*data-menu-item="cao"/);
    expect(html).toMatch(/data-menu-item="matsuyama"[\s\S]*?既定[\s\S]*?data-menu-item="cao"/);
    expect(html).toContain('href="/forms/mapping"');
    expect(html).toContain("様式追加");

    const rows = IDS.slice(0, 3).map((id) => planRow(rowsOf(id), CAO(options.find((o) => o.id === "cao")!), OPTS));
    const people = renderToStaticMarkup(createElement(DocumentPeople, { entry: sel.doc === "plan" ? sel.form.entry : MATSUYAMA_ENTRY, isDefault: false, rows, batch: batchHref(sel), counted: true }));
    expect(people).toContain('href="/forms/batch?form=cao&amp;print=1"');
    for (const r of rows) {
      expect(people).toContain(`data-person-row="${r.id}"`);
      expect(people).toContain(`data-unconfirmed-count="${r.unconfirmed!.count}"`);
      expect(people).toContain(`href="${r.printHref!.replace("&", "&amp;")}"`);
    }
    const med = renderToStaticMarkup(
      createElement(DocumentPeople, { entry: DOCUMENT_CATALOG.medical, isDefault: false, rows: [personDocRow("medical", rowsOf("p-09"), OPTS)], batch: null, counted: true }),
    );
    expect(med).toContain('data-blocked="refused"');
    expect(med).toContain("医療班提供 不同意");
    expect(med).not.toContain("data-print-link");
  });

  it("一括印刷: 人数分の紙面が渡した順。人の間で頁を割る CSS（最後の人のあとは割らない）", () => {
    const papers: BatchPaper[] = ["p-01", "p-02", "p-03"].map((id) => ({ kind: "matsuyama", personId: id, sheet: buildMatsuyamaSheet(rowsOf(id), OPTS) }));
    const html = renderToStaticMarkup(createElement(PaperBatch, { papers }));
    expect(html).toContain('data-paper-batch="3"');
    expect([...html.matchAll(/data-paper-root="true" data-sheet="matsuyama" data-person="([^"]+)"/g)].map((m) => m[1])).toEqual(["p-01", "p-02", "p-03"]);
    const css = readRepoFile("components/forms/paper-batch.css");
    expect(css).toMatch(/@media print \{\s*\.paper-batch > \.paper-scroll:not\(:last-child\) \.paper:last-child \{\s*break-after: page;/);
    const page = readRepoFile("app/forms/batch/page.tsx");
    expect(page).toContain('import "@/components/forms/paper-batch.css";');
    expect(page).toContain('requirePage("caseload")');
    expect(page).toContain("listView(data, {})");
    // 印刷の PDF の名前に氏名を入れない
    expect(page).toContain('export const metadata: Metadata = { title: "書類一括" };');
  });
});

const chrome = chromePath();

describe.skipIf(!chrome)("一括印刷の頁数（headless Chrome の printToPDF）", () => {
  let browser: Browser;
  let page: Page;
  let fontOk = false;
  const css = paperCss() + "\n" + readRepoFile("components/forms/paper-batch.css");

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
    await page.setContent(paperPage("<p>書体</p>", css));
    fontOk = (await page.evaluate(FONT_PROBE)) === true;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("計画書（松山市）を 3 人で 6 頁（1 人 2 頁、人の境で割れ、最後に空の頁が無い）", async (ctx) => {
    if (!fontOk) ctx.skip();
    const papers: BatchPaper[] = IDS.slice(0, 3).map((id) => ({ kind: "matsuyama", personId: id, sheet: buildMatsuyamaSheet(rowsOf(id), OPTS) }));
    await page.setContent(paperPage(renderToStaticMarkup(createElement(PaperBatch, { papers })), css), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    expect(pdfPageCount(await page.pdf({ preferCSSPageSize: true, printBackground: true }))).toBe(6);
    await page.emulateMediaType("print");
    const breaks = await page.evaluate(() => [...document.querySelectorAll(".paper-batch .paper")].map((el) => getComputedStyle(el).breakAfter));
    await page.emulateMediaType(undefined);
    expect(breaks).toEqual(["page", "page", "page", "page", "page", "auto"]);
  }, 120_000);
});
