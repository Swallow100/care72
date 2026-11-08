// T86 の 2（元の様式の上に台帳の値を置く紙）。架空の自治体（こもれび市）の白紙の様式で、
// 白紙の PDF → 頁の画像 → 読み取り（偽の client の返事）→ 位置の確かめ（人が 1 つ直して確認保存）→ 値を置いた紙を印刷した PDF の
// 頁の数と、PDF の字が欄の矩形の中にあることまで通す。本物の API は呼ばない。Chrome・BIZ UDP の書体・@napi-rs/canvas が無ければ印刷の所は飛ばす。
import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { chromePath, pdfPageCount } from "../../tools/print/chrome.ts";
import { pdfToJpegPages } from "../../tools/print/pdf-pages.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { moveBox } from "./box-edit.ts";
import { KOMOREBI_LAYOUT, komorebiBlankHtml, komorebiReadResult } from "./komorebi-form.fixture.ts";
import { pageReadReply } from "./form-read-fake.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { checkReadResult, type FieldBox, type FormMapping } from "./mapping.ts";
import { getMapping, loadCheckedMapping, saveCheckedMapping } from "./mapping-db.ts";
import { NONE, sub, t, unconfirmedPiece, value } from "./matsuyama.ts";
import {
  ANNEX_MARK,
  buildOverlaySheet,
  canOverlay,
  cellLines,
  FONT_MAX_PT,
  FONT_MIN_PT,
  fitText,
  imageBoxOf,
  textEm,
  wrapLine,
  type OverlaySheet as Sheet,
} from "./overlay-sheet.ts";
import { pageImageKey, type PageImage, type PageImageBucket } from "./page-images.ts";
import { FONT_PROBE, paperCss, paperPage, readRepoFile, seedRows } from "./print-harness.ts";
import { autoPrint, type PrintWindow } from "./print.ts";
import { formReadPost } from "./read-post.ts";
import { buildFormReadForm } from "./read-upload.ts";

const TODAY = "2026-11-04";
const OPTS = { today: TODAY, officeName: "デモ事業所" };
const rowsOf = (id: string) => seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
const A4_PAGE: PageImage = { page: 1, width: 1413, height: 2000, bytes: 1 };
const IMAGES: PageImage[] = [A4_PAGE, { ...A4_PAGE, page: 2 }];
const komorebi = (): FormMapping => checkReadResult(komorebiReadResult("mincho")).mapping;
const fieldOf = (m: FormMapping, label: string, section?: string) => m.fields.find((f) => f.label === label && (section === undefined || f.section === section))!;
const itemsOf = (s: Sheet, id: string) => s.pages.flatMap((p) => p.items.filter((i) => i.fieldId === id));

// ---------- 字の大きさと行 ----------

describe("字の大きさと行（見積もり）", () => {
  it("全角 1・半角 0.8（M・W は 1）。英数字の並び（電話）は割らず、行頭の句読点は前の行へ", () => {
    expect(textEm("山田 ハナ")).toBeCloseTo(4.36);
    expect(textEm("090-0000-0001")).toBeCloseTo(10.4);
    expect(textEm("MW")).toBe(2);
    expect(wrapLine("電話 090-0000-0011", 11)).toEqual(["電話", "090-0000-0011"]);
    expect(wrapLine("予備ボンベ、薬", 5)).toEqual(["予備ボンベ、", "薬"]);
    // 1 行より長い英数字の並びだけ字ごとに
    expect(wrapLine("abcdefghij", 4)).toEqual(["abcde", "fghij"]);
  });

  it("矩形に収まる大きさ: 短い値は 10.5pt、長い値は縮めて折る、6pt でも収まらなければ null（別紙）", () => {
    const one = fitText(["山田 ハナ"], 130, 10)!;
    expect(one).toEqual({ lines: ["山田 ハナ"], fontPt: FONT_MAX_PT, top: false });
    const long = fitText(["持出品 予備ボンベ・薬・お薬手帳・眼鏡・入れ歯・杖・充電器・保険証の写し・連絡先の紙"], 60, 10)!;
    expect(long.fontPt).toBeLessThan(FONT_MAX_PT);
    expect(long.fontPt).toBeGreaterThanOrEqual(FONT_MIN_PT);
    expect(long.lines.length).toBeGreaterThan(1);
    expect(fitText(["あ".repeat(200)], 30, 5)).toBeNull();
    // 高い矩形（3 行より高い）は上から
    expect(fitText(["特記"], 130, 35)!.top).toBe(true);
  });

  it("欄の値を字に: 未確認の言葉は落とし、添えだけの行は括弧、なしは「なし」、未確認・省略・手書きは空ける", () => {
    expect(cellLines(value([t("娘")], [sub("連絡順 1"), sub("車あり")]))).toEqual(["娘", "（連絡順 1・車あり）"]);
    expect(cellLines(value([unconfirmedPiece(), sub("同居")]))).toEqual(["（同居）"]);
    expect(cellLines(value([t("84"), t("歳")]))).toEqual(["84歳"]);
    expect(cellLines(value([t("090-0000-0011"), sub("電話")]), true)).toEqual(["090-0000-0011"]);
    expect(cellLines(value([t("090-0000-0011"), sub("携帯")]), true)).toEqual(["090-0000-0011 携帯"]);
    expect(cellLines(NONE)).toEqual(["なし"]);
    expect(cellLines({ kind: "unconfirmed" })).toEqual([]);
    expect(cellLines({ kind: "withheld", consent: "supporters" })).toEqual([]);
    expect(cellLines({ kind: "handwrite" })).toEqual([]);
    expect(cellLines({ kind: "choice", options: [{ label: "男", on: false }, { label: "女", on: true }] })).toEqual(["女"]);
  });

  it("頁の画像は A4 に縦横の比を保って真ん中。横長は A4 横", () => {
    expect(imageBoxOf({ width: 1413, height: 2000 })).toMatchObject({ landscape: false, w: expect.closeTo(209.83, 1), h: 297 });
    const land = imageBoxOf({ width: 2000, height: 1413 });
    expect(land).toMatchObject({ landscape: true, w: 297 });
    const photo = imageBoxOf({ width: 1000, height: 1000 });
    expect(photo).toMatchObject({ x: 0, w: 210, h: 210, y: 43.5 });
  });
});

// ---------- 紙面の中身 ----------

describe("元の様式の上に置く紙（buildOverlaySheet）", () => {
  it("頁は頁の画像の数。字は欄の矩形に、性別は選んだ □ にレ点、医療機器は □ にレ点。手書き・未確認は空ける", () => {
    const m = komorebi();
    const s = buildOverlaySheet(buildMappedSheet(rowsOf("p-01"), m, OPTS), IMAGES, m.typeface);
    expect(s.pages).toHaveLength(2);
    expect(s.typeface).toBe("mincho");
    const name = itemsOf(s, fieldOf(m, "氏名", "本人").id)[0];
    expect(name).toMatchObject({ kind: "text", lines: ["山田 ハナ"], fontPt: FONT_MAX_PT, box: fieldOf(m, "氏名", "本人").box });
    expect(itemsOf(s, fieldOf(m, "電話番号").id)[0]).toMatchObject({ lines: ["090-0000-0001"] });
    const sex = fieldOf(m, "性別");
    expect(itemsOf(s, sex.id)).toEqual([{ kind: "mark", fieldId: sex.id, box: sex.optionBoxes![1], mark: "check" }]);
    const dev = fieldOf(m, "医療機器を使っている");
    expect(itemsOf(s, dev.id)).toEqual([{ kind: "mark", fieldId: dev.id, box: dev.box, mark: "check" }]);
    expect(itemsOf(s, fieldOf(m, "本人署名").id)).toEqual([]);
    expect(itemsOf(s, fieldOf(m, "市受付印").id)).toEqual([]);
    // 2 頁の欄は 2 頁に
    expect(s.pages[1].items.map((i) => i.fieldId)).toContain(fieldOf(m, "避難先").id);
    expect(s.annex).toEqual([]);
  });

  it("収まらない値は欄に「別紙」と書き、別紙に欄の名前と値。場所の無い欄の値も別紙へ（値を落とさない）", () => {
    const m = komorebi();
    const notes = fieldOf(m, "特記事項");
    const kana = fieldOf(m, "フリガナ");
    const small: FieldBox = { x: 0.3, y: 0.25, w: 0.04, h: 0.012 };
    const changed = { ...m, fields: m.fields.map((f) => (f.id === notes.id ? { ...f, box: small } : f.id === kana.id ? { ...f, box: null } : f)) };
    const s = buildOverlaySheet(buildMappedSheet(rowsOf("p-01"), changed, OPTS), IMAGES);
    expect(itemsOf(s, notes.id)[0]).toMatchObject({ kind: "text", lines: [ANNEX_MARK] });
    expect(s.annex.map((r) => [r.label, r.reason])).toEqual([
      ["本人 フリガナ", "unplaced"],
      ["特記事項", "overflow"],
    ]);
    expect(s.annex[1].lines.join("")).toContain("持出品");
  });

  it("同意の無い範囲は空ける（避難支援者の値を刷らない）。選択肢の □ の場所が無ければ選んだ言葉を欄に書く", () => {
    const m = komorebi();
    const rows = rowsOf("p-01");
    const refused = { ...rows, consents: rows.consents.map((c) => (c.kind === "supporters" ? { ...c, status: "refused" as const } : c)) };
    const s = buildOverlaySheet(buildMappedSheet(refused, m, OPTS), IMAGES);
    expect(itemsOf(s, fieldOf(m, "氏名", "避難支援者").id)).toEqual([]);
    expect(s.withheld).toContain("supporters");
    expect(JSON.stringify(s.pages)).not.toContain("森 恵子（避難支援者）");
    const sex = fieldOf(m, "性別");
    const noOpt = { ...m, fields: m.fields.map((f) => (f.id === sex.id ? { ...f, optionBoxes: undefined } : f)) };
    const s2 = buildOverlaySheet(buildMappedSheet(rows, noOpt, OPTS), IMAGES);
    expect(itemsOf(s2, sex.id)[0]).toMatchObject({ kind: "text", lines: ["女"] });
  });

  it("元の様式の上にできるのは頁の画像があり場所のある欄があるときだけ（前の対応表・内閣府の様式例は 2 列の紙）", () => {
    const m = komorebi();
    expect(canOverlay(m.fields, IMAGES)).toBe(true);
    expect(canOverlay(m.fields, null)).toBe(false);
    expect(canOverlay(m.fields.map((f) => ({ ...f, box: null })), IMAGES)).toBe(false);
  });

  it("紙面: 頁ごとに頁の画像を下に敷き、値を矩形の比の位置に。様式に無い頁の下の文書名は刷らない。太字なし", () => {
    const m = komorebi();
    const s = buildOverlaySheet(buildMappedSheet(rowsOf("p-01"), m, OPTS), IMAGES, "mincho");
    const html = renderToStaticMarkup(createElement(OverlaySheet, { sheet: s, imageSrc: (p) => `/img/${p}.jpg`, checked: "2026-11-04 山本" }));
    expect(html.match(/class="paper overlay  mincho"/g)).toHaveLength(2);
    expect(html).toContain('src="/img/1.jpg"');
    expect(html).toContain('src="/img/2.jpg"');
    expect(html).toMatch(/left:30\.000%;top:19\.500%;width:62\.000%;height:3\.500%;font-size:10\.5pt" data-field="f3"/);
    expect(html).toContain('data-mark="check"');
    expect(html).not.toContain("data-paper-foot");
    expect(html).not.toMatch(/<b[\s>]|<strong|font-bold|font-weight/);
    // 別紙があれば最後に 1 枚（前からの 2 列の形と頁の下の端）
    const annex = { ...s, annex: [{ fieldId: "f9", label: "特記事項", lines: ["長い値"], reason: "overflow" as const }] };
    const withAnnex = renderToStaticMarkup(createElement(OverlaySheet, { sheet: annex, imageSrc: () => "x", checked: "" }));
    expect(withAnnex).toContain('data-annex="1"');
    expect(withAnnex).toContain('data-paper-foot="1/1"');
  });

  it("紙面の CSS: 余白なしの A4（横長は名前付きの A4 横の頁）、字は黒で太くしない、印は塗らない線", () => {
    const css = readRepoFile("components/forms/overlay-paper.css");
    expect(css).toMatch(/@page overlay-land \{\s*size: A4 landscape;\s*margin: 0;/);
    expect(css).toMatch(/\.paper\.overlay \{[^}]*padding: 0;/);
    expect(css).not.toMatch(/font-weight:\s*(bold|[6-9]00)/);
    expect(css).toMatch(/\.ov-mark \{[^}]*fill: none;[^}]*stroke: #000;/);
    // 矩形の内側の空きは見積もり（lib/forms/overlay-sheet.ts の PAD_X_MM・PAD_Y_MM）と同じ
    expect(css).toMatch(/\.ov-text \{[^}]*padding: 0\.5mm 0\.8mm;/);
    const lib = readRepoFile("lib/forms/overlay-sheet.ts");
    expect(lib).toContain("const PAD_X_MM = 0.8;");
    expect(lib).toContain("const PAD_Y_MM = 0.5;");
  });

  it("差し込みのページ: 頁の画像と場所があれば元の様式の上の紙、?view=list で前からの 2 列。印刷の窓は画像を読み終えてから", async () => {
    const page = readRepoFile("app/people/[id]/forms/mapped/[mappingId]/page.tsx");
    expect(page).toContain("canOverlay(mapping.fields, images)");
    expect(page).toContain("<OverlaySheet");
    expect(page).toContain('sp.view === "list"');
    let decoded = false;
    const calls: string[] = [];
    const win: PrintWindow = {
      location: { href: "https://care72.app/people/p-01/forms/mapped/fm-1?print=1" },
      history: { replaceState: () => calls.push("replace") },
      document: {
        fonts: { ready: Promise.resolve() },
        images: [
          { complete: true },
          {
            complete: false,
            decode: async () => {
              await new Promise((r) => setTimeout(r, 5));
              decoded = true;
            },
          },
        ],
      },
      print: () => calls.push(decoded ? "print-after-image" : "print-before-image"),
    };
    expect(await autoPrint(win)).toBe(true);
    expect(calls).toEqual(["replace", "print-after-image"]);
  });
});

// ---------- 白紙の様式から印刷まで ----------

type Message = Anthropic.Beta.Messages.BetaMessage;

const chrome = chromePath();

describe.skipIf(!chrome)("架空の様式で通す: 白紙の PDF → 頁の画像 → 読み取り（偽の client）→ 位置の確かめ → 値を置いた PDF", () => {
  let browser: Browser;
  let page: Page;
  let ready = false;
  let sqlite: DatabaseSync;
  let db: ReturnType<typeof d1FromSqlite>;
  let blankPages: Uint8Array[] | null = null;
  const objects = new Map<string, Uint8Array>();
  const bucket: PageImageBucket = {
    put: async (key, v) => void objects.set(key, v),
    get: async (key) => (objects.has(key) ? { body: objects.get(key)!, size: objects.get(key)!.length } : null),
  };

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
    await page.setContent(paperPage("<p>書体</p>", paperCss()));
    const fontOk = (await page.evaluate(FONT_PROBE)) === true;
    // 白紙の様式を印刷して PDF に（架空の様式の HTML。値は何も書かない）
    await page.setContent(komorebiBlankHtml(), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const blankPdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(pdfPageCount(blankPdf)).toBe(2);
    // ブラウザの黒塗りの画面と同じく pdf.js で頁を画像に（@napi-rs/canvas が無ければ飛ばす）
    blankPages = await pdfToJpegPages(blankPdf);
    ready = fontOk && blankPages !== null;
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });
  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
    objects.clear();
  });
  afterEach(() => sqlite.close());

  /** 読み取り（偽の client が架空の様式の返事）→ 下書き。返事の住所の場所はわざと 1.2% 下にずらす（人が直す所） */
  async function read(): Promise<string> {
    const answer = komorebiReadResult("mincho");
    answer.fields = answer.fields.map((f) => (f.label === "住所" && f.box ? { ...f, box: { ...f.box, y: f.box.y + 0.012 } } : f));
    const claude: ClaudeClient = {
      beta: {
        messages: {
          create: async (params) =>
            ({
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: OPUS,
              content: [{ type: "text", text: pageReadReply(answer, params), citations: null }],
              stop_reason: "end_turn",
              stop_details: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            }) as unknown as Message,
        },
      },
    };
    const aiContext = async (): Promise<AskJsonContext> => ({
      env: { ANTHROPIC_API_KEY: "dummy" },
      usage: d1UsageStore(db),
      office: { id: "office-demo", kind: "demo" },
      now: () => new Date("2026-11-04T06:00:00.000Z"),
      claude,
    });
    const form = buildFormReadForm(
      blankPages!.map((bytes, i) => ({ blob: new Blob([bytes as BlobPart], { type: "image/jpeg" }), meta: { source: "pdf" as const, page: i + 1, redacted: 0 }, bare: true })),
    );
    const res = await formReadPost({ db, bucket, aiContext, newId: () => "fm-komorebi" }, { officeId: "office-demo", accountId: "acct-yamamoto" }, form);
    expect(res.status).toBe(200);
    return "fm-komorebi";
  }

  /** 人が位置を確かめる: 住所の枠を上へ 1.2% 戻し、確認保存 */
  async function confirm(id: string, edit: (m: FormMapping) => FormMapping = (m) => m) {
    const draft = (await getMapping(db, "office-demo", id))!;
    const addr = fieldOf(draft.mapping, "住所");
    expect(addr.box!.y).toBeCloseTo(0.312);
    const fixed = { ...draft.mapping, fields: draft.mapping.fields.map((f) => (f.id === addr.id ? { ...f, box: moveBox(f.box!, 0, -0.012) } : f)) };
    const saved = await saveCheckedMapping(db, { officeId: "office-demo", id, version: draft.version, mapping: edit(fixed), by: "acct-yamamoto", at: "2026-11-04T06:10:00.000Z" });
    expect(saved.ok).toBe(true);
    return (await loadCheckedMapping(db, "office-demo", id))!;
  }

  /** 値を置いた紙を印刷した PDF と、紙面の中身 */
  async function printOverlay(id: string, personId: string, typeface?: "gothic" | "mincho") {
    const stored = (await loadCheckedMapping(db, "office-demo", id))!;
    const sheet = buildOverlaySheet(buildMappedSheet(rowsOf(personId), stored.mapping, OPTS), stored.pageImages!, typeface ?? stored.mapping.typeface);
    const src = (p: number) => `data:image/jpeg;base64,${Buffer.from(objects.get(pageImageKey("office-demo", id, p))!).toString("base64")}`;
    const body = renderToStaticMarkup(createElement(OverlaySheet, { sheet, imageSrc: src, checked: "2026-11-04 山本" }));
    await page.setContent(paperPage(body, paperCss()), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    return { sheet, pdf };
  }

  /** PDF の字の並び（頁ごとに、左下を原点の pt で、字の左端・右端・下端の基準線） */
  async function pdfTexts(pdf: Uint8Array) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: pdf.slice(), disableFontFace: true }).promise;
    const out: Array<{ page: number; str: string; x: number; y: number; w: number; pageH: number }> = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      const pageH = p.getViewport({ scale: 1 }).height;
      const tc = await p.getTextContent();
      for (const it of tc.items) {
        if (!("str" in it) || it.str.trim() === "") continue;
        out.push({ page: n, str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, pageH });
      }
    }
    await doc.cleanup();
    return out;
  }

  const MM_PT = 72 / 25.4;

  it("頁の数は元の様式と同じ 2。PDF の字は全部、その頁の欄の矩形の中", async (ctx) => {
    if (!ready) ctx.skip();
    const id = await read();
    // 頁の画像は R2 の置き場に 2 枚、AI の場所は下書きに
    expect([...objects.keys()].sort()).toEqual([pageImageKey("office-demo", id, 1), pageImageKey("office-demo", id, 2)]);
    await confirm(id);
    const { sheet, pdf } = await printOverlay(id, "p-01");
    expect(sheet.annex).toEqual([]);
    expect(pdfPageCount(pdf)).toBe(2);

    const texts = await pdfTexts(pdf);
    expect(texts.length).toBeGreaterThan(10);
    const boxesPt = sheet.pages.flatMap((p) =>
      p.items
        .filter((i) => i.kind === "text")
        .map((i) => ({
          page: p.page,
          field: i.fieldId,
          left: (p.image.x + i.box.x * p.image.w) * MM_PT,
          right: (p.image.x + (i.box.x + i.box.w) * p.image.w) * MM_PT,
          top: (p.image.y + i.box.y * p.image.h) * MM_PT,
          bottom: (p.image.y + (i.box.y + i.box.h) * p.image.h) * MM_PT,
        })),
    );
    const inBox = (t: (typeof texts)[number]) => {
      const fromTop = t.pageH - t.y;
      return boxesPt.find((b) => b.page === t.page && t.x >= b.left - 0.5 && t.x + t.w <= b.right + 0.5 && fromTop >= b.top - 0.5 && fromTop <= b.bottom + 0.5);
    };
    const outside = texts.filter((t) => !inBox(t)).map((t) => `${t.page}頁 ${t.str}`);
    expect(outside).toEqual([]);
    // 欄ごとの字（頁と欄が合う）
    const m = (await loadCheckedMapping(db, "office-demo", id))!.mapping;
    const textIn = (label: string, section?: string) =>
      texts
        .filter((t) => inBox(t)?.field === fieldOf(m, label, section).id)
        .map((t) => t.str)
        .join("");
    expect(textIn("氏名", "本人")).toBe("山田 ハナ");
    expect(textIn("電話番号")).toBe("090-0000-0001");
    expect(textIn("住所")).toContain("市坪西町");
    expect(textIn("避難先")).toBe("福音小学校");
    expect(texts.find((t) => t.str.includes("福音小学校"))!.page).toBe(2);
  }, 120_000);

  it("種の 10 人とも、明朝でもゴシックでも、字は欄の矩形からはみ出さない（字の幅の見積もりが実際の書体より狭くない）。別紙が無ければ 2 頁", async (ctx) => {
    if (!ready) ctx.skip();
    const id = await read();
    await confirm(id);
    const over: string[] = [];
    for (const [p, typeface] of SEED_PEOPLE.flatMap((x) => (["mincho", "gothic"] as const).map((t) => [x, t] as const))) {
      const { sheet, pdf } = await printOverlay(id, p.person.id, typeface);
      expect(pdfPageCount(pdf), p.person.id).toBe(sheet.pages.length + (sheet.annex.length > 0 ? 1 : 0));
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".ov-text")]
          .filter((t) => {
            // 行の字の幅（Range）が行の箱（矩形の内側）より広い、か、行の合計が矩形より高い
            const wide = [...t.querySelectorAll<HTMLElement>(".ov-ln")].some((l) => {
              const r = document.createRange();
              r.selectNodeContents(l);
              return r.getBoundingClientRect().width > l.clientWidth + 0.5;
            });
            return wide || t.scrollHeight > t.clientHeight + 1;
          })
          .map((t) => t.dataset.field),
      );
      over.push(...bad.map((f) => `${p.person.id} ${typeface} ${f}`));
    }
    expect(over).toEqual([]);
  }, 300_000);

  it("収まらない値は欄に「別紙」、最後に別紙の頁（元の 2 頁 + 1）", async (ctx) => {
    if (!ready) ctx.skip();
    const id = await read();
    const notes = KOMOREBI_LAYOUT.find((f) => f.label === "特記事項")!;
    await confirm(id, (m) => ({ ...m, fields: m.fields.map((f) => (f.label === notes.label ? { ...f, box: { x: 0.3, y: 0.25, w: 0.05, h: 0.012 } } : f)) }));
    const { sheet, pdf } = await printOverlay(id, "p-01");
    expect(sheet.annex.map((r) => r.label)).toEqual(["特記事項"]);
    expect(pdfPageCount(pdf)).toBe(3);
    const texts = await pdfTexts(pdf);
    expect(texts.some((t) => t.page === 2 && t.str === ANNEX_MARK)).toBe(true);
    expect(texts.filter((t) => t.page === 3).map((t) => t.str).join("")).toContain("持出品");
  }, 120_000);
});
