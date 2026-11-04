// T101 印刷の頁で、原本の枠の紙の欄の矩形と、様式9 のひな形の罫線が原本の値（lib/forms/frame-*.ts）の ±0.3mm にあること。
// headless Chrome の DOM で測る（print-pages.test.ts と同じ道具）。原本の頁の絵はリポジトリに無いので、下に敷く画像は白い PNG。
// 原本の枠の表と原本の罫線の照らし合わせは t101-original.test.ts（原本が手元にあるときだけ）。Chrome・BIZ UDP の書体が無ければ飛ばす。
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Form9Paper } from "../../components/forms/Form9Paper.tsx";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { chromePath, pdfPageCount } from "../../tools/print/chrome.ts";
import { kirokuFrameSheet, matsuyamaFrameSheet } from "./frame-build.ts";
import { FORM9_COL_X, FORM9_MARGIN_MM, FORM9_ROW_Y, FORM9_ROWS_PER_PAGE } from "./frame-form9.ts";
import { buildForm9, type Form9PersonInput } from "./form9.ts";
import { buildMatsuyamaSheet } from "./matsuyama.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import { ORIGINALS, type OriginalManifest } from "./originals.ts";
import type { OverlaySheet as Sheet } from "./overlay-sheet.ts";
import { FONT_PROBE, paperCss, paperPage, seedRows } from "./print-harness.ts";

const TODAY = "2026-11-04";
const OPTS = { today: TODAY, officeName: "デモ事業所" };
const TOL = 0.3;
/** 白い 1 画素の PNG（原本の頁の代わり。画像の箱は頁いっぱいに伸ばす） */
const WHITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const man = (id: "matsuyama" | "kiroku"): OriginalManifest => ({
  id,
  sha256: ORIGINALS[id].sha256,
  pages: ORIGINALS[id].usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-04T00:00:00.000Z",
});
const sheetHtml = (s: Sheet, kind: string, fill = true) =>
  renderToStaticMarkup(createElement(OverlaySheet, { sheet: s, imageSrc: () => WHITE, checked: "", fill, kind }));
const matsuyamaOf = (p: (typeof SEED_PEOPLE)[number]) => matsuyamaFrameSheet(buildMatsuyamaSheet(seedRows(p), OPTS), man("matsuyama"));
const kirokuOf = (p: (typeof SEED_PEOPLE)[number]) => {
  const r = buildMedicalSummary(seedRows(p), OPTS);
  return r.kind === "sheet" ? kirokuFrameSheet(r.sheet, man("kiroku")) : null;
};

type Rect = { x: number; y: number; w: number; h: number };
type Measured = { page: number; field: string; kind: string; rect: Rect };

const chrome = chromePath();

describe.skipIf(!chrome)("印刷の頁で測る（headless Chrome）", () => {
  let browser: Browser;
  let page: Page;
  let fontOk = false;
  const css = paperCss();

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true });
    page = await browser.newPage();
    await page.setContent(paperPage("<p>字</p>", css));
    fontOk = await page.evaluate(FONT_PROBE);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  /** 紙の頁ごとに、頁の左上からの mm で、画像の箱・字・印・塗り・画像の矩形 */
  async function measureOverlay(body: string): Promise<{ boxes: Rect[]; items: Measured[] }> {
    await page.setContent(paperPage(body, css), { waitUntil: "load" });
    await page.emulateMediaType("print");
    const got = await page.evaluate(() => {
      const mm = (px: number) => (px * 25.4) / 96;
      const sections = [...document.querySelectorAll<HTMLElement>("section.paper.overlay")];
      const rel = (el: Element, base: DOMRect) => {
        const r = el.getBoundingClientRect();
        return { x: mm(r.left - base.left), y: mm(r.top - base.top), w: mm(r.width), h: mm(r.height) };
      };
      return {
        boxes: sections.map((s) => rel(s.querySelector(".ov-img")!, s.getBoundingClientRect())),
        items: sections.flatMap((s) => {
          const base = s.getBoundingClientRect();
          const pageNo = Number(s.dataset.page);
          return [...s.querySelectorAll<HTMLElement | SVGElement>(".ov-text, .ov-mark, .ov-fill, .ov-pic")].map((el) => ({
            page: pageNo,
            field: el.getAttribute("data-field") ?? el.getAttribute("data-fill-keys") ?? "",
            kind: el.getAttribute("class") ?? "",
            rect: rel(el, base),
          }));
        }),
      };
    });
    await page.emulateMediaType(undefined);
    return got;
  }

  /** 紙の中身の矩形（比 × 頁の mm）。字・印・画像は fieldId、塗りは欄の id */
  function expected(s: Sheet): Measured[] {
    return s.pages.flatMap((p) => {
      const mmOf = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x * p.image.w, y: b.y * p.image.h, w: b.w * p.image.w, h: b.h * p.image.h });
      return [
        ...p.fills.map((f) => ({ page: p.page, field: f.keys.join(" "), kind: "ov-fill", rect: mmOf(f.box) })),
        ...p.items.map((it) => ({ page: p.page, field: it.fieldId, kind: it.kind, rect: mmOf(it.box) })),
      ];
    });
  }

  const near = (a: Rect, b: Rect) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));

  it("計画書・医療要約: 原本の頁の箱は頁いっぱい、欄の字・印・塗りの矩形は枠の表の ±0.3mm。種の 10 人で同じ欄は同じ所", async (ctx) => {
    if (!fontOk) ctx.skip();
    const seen = new Map<string, Rect>();
    for (const p of SEED_PEOPLE) {
      for (const [kind, s] of [
        ["matsuyama", matsuyamaOf(p)],
        ["kiroku", kirokuOf(p)],
      ] as const) {
        if (!s) continue;
        const got = await measureOverlay(sheetHtml(s, kind));
        const pageMm = ORIGINALS[kind].pageMm;
        for (const b of got.boxes) expect(near(b, { x: 0, y: 0, w: pageMm.w, h: pageMm.h }), `${p.person.id} ${kind} 頁の箱`).toBeLessThanOrEqual(TOL);
        const want = expected(s);
        expect(got.items).toHaveLength(want.length);
        want.forEach((w, i) => {
          const g = got.items[i];
          expect(near(g.rect, w.rect), `${p.person.id} ${kind} ${w.field}`).toBeLessThanOrEqual(TOL);
          // 同じ欄（字・印・塗り）は人によって動かない（避難経路の文は地図の有無で上を使うので外す）
          const key = `${kind}:${w.page}:${w.kind}:${w.field}`;
          if (w.field.startsWith("route.text") || w.field === "notes") return;
          const prev = seen.get(key);
          if (prev) expect(near(prev, g.rect), key).toBeLessThanOrEqual(0.01);
          else seen.set(key, g.rect);
        });
      }
    }
  }, 300_000);

  it("計画書は原本と同じ 2 頁。別紙があればその分だけ足す（印刷の PDF の頁の数）", async (ctx) => {
    if (!fontOk) ctx.skip();
    for (const p of SEED_PEOPLE.slice(0, 4)) {
      const s = matsuyamaOf(p);
      await page.setContent(paperPage(sheetHtml(s, "matsuyama", false), css), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const n = pdfPageCount(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      expect(n, p.person.id).toBe(2 + (s.annex.length > 0 ? 1 : 0));
    }
  }, 120_000);

  it("様式9: ひな形の罫線（表の列と行の境）は Excel の列幅・行の高さの位置の ±0.3mm。10 人の値で行の高さが変わらない", async (ctx) => {
    if (!fontOk) ctx.skip();
    const sheet = buildForm9(
      SEED_PEOPLE.map((p): Form9PersonInput => ({ person: { ...p.person, ledger: JSON.stringify(p.ledger) }, careManager: "山本", contacts: p.contacts, clocks: p.clocks })),
      { today: TODAY },
    );
    const body = renderToStaticMarkup(createElement(Form9Paper, { sheet, office: "デモ事業所", date: "令和8年11月4日", order: "平時", report: null, fill: true }));
    await page.setContent(paperPage(body, css), { waitUntil: "load" });
    await page.emulateMediaType("print");
    const got = await page.evaluate(() => {
      const mm = (px: number) => (px * 25.4) / 96;
      const sec = document.querySelector<HTMLElement>("section.form9-sheet")!;
      const base = sec.getBoundingClientRect();
      const rows = [...sec.querySelectorAll("table.f9-grid tr")].map((tr) => {
        const r = tr.getBoundingClientRect();
        return { top: mm(r.top - base.top), bottom: mm(r.bottom - base.top) };
      });
      const firstBody = sec.querySelector("table.f9-grid tbody tr")!;
      const cols = [...firstBody.querySelectorAll("td")].map((td) => {
        const r = td.getBoundingClientRect();
        return { left: mm(r.left - base.left), right: mm(r.right - base.left) };
      });
      const fills = sec.querySelectorAll(".f9-fill").length;
      // 罫線（線の中心）
      const lines = [...sec.querySelectorAll<SVGLineElement>("line[data-line]")].map((l) => {
        const r = l.getBoundingClientRect();
        return { id: l.dataset.line!, cx: mm(r.left + r.width / 2 - base.left), cy: mm(r.top + r.height / 2 - base.top) };
      });
      return { rows, cols, fills, lines, width: mm(base.width), height: mm(base.height) };
    });
    await page.emulateMediaType(undefined);
    // 内容の箱（@page form9-sheet の余白の内側）はひな形の余白の内側
    expect(got.width).toBeCloseTo(297 - FORM9_MARGIN_MM.left * 2, 0);
    // 列: B〜M の左右の線（頁の内容の箱の左からの位置 = Excel の位置 − 左の余白）
    expect(got.cols).toHaveLength(12);
    got.cols.forEach((c, i) => {
      expect(Math.abs(c.left - (FORM9_COL_X[i + 1] - FORM9_MARGIN_MM.left)), `列 ${i} 左`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(c.right - (FORM9_COL_X[i + 2] - FORM9_MARGIN_MM.left)), `列 ${i} 右`).toBeLessThanOrEqual(TOL);
    });
    // 行: 5・6 行目（見出し）と 7〜26 行目（値）の上下の線
    expect(got.rows).toHaveLength(2 + FORM9_ROWS_PER_PAGE);
    got.rows.forEach((r, i) => {
      expect(Math.abs(r.top - (FORM9_ROW_Y[4 + i] - FORM9_MARGIN_MM.top)), `行 ${5 + i} 上`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(r.bottom - (FORM9_ROW_Y[5 + i] - FORM9_MARGIN_MM.top)), `行 ${5 + i} 下`).toBeLessThanOrEqual(TOL);
    });
    expect(got.fills).toBeGreaterThan(0);
    // 罫線の線の中心: 垂直線は列の境、水平線は行の境
    const COLS = "ABCDEFGHIJKLMN";
    for (const l of got.lines) {
      if (l.id.startsWith("v")) expect(Math.abs(l.cx - (FORM9_COL_X[COLS.indexOf(l.id[1])] - FORM9_MARGIN_MM.left)), l.id).toBeLessThanOrEqual(TOL);
      else expect(Math.abs(l.cy - (FORM9_ROW_Y[Number(l.id.slice(1).split("-")[0]) - 1] - FORM9_MARGIN_MM.top)), l.id).toBeLessThanOrEqual(TOL);
    }
    expect(got.lines.length).toBe(13 + 22 + 2);
  }, 120_000);
});
