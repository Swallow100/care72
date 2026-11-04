// T106 避難経路の地図の印刷（headless Chrome）。地図は欄の枠に収まる、前からの紙面は地図を入れても 2 頁、
// 欄の中の SVG の地理院タイルを印刷の頁が読んで PDF に刷る（<img> の data: にすると読まれない）。
// タイルはネットに出さず、要求を受けて小さな PNG を返す（何を読んだかを数える）。原本の頁は白い 1 画素の PNG。
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { chromePath, pdfPageCount } from "../../tools/print/chrome.ts";
import { parseLedger } from "../db/ledger.ts";
import type { GeoPoint, Ledger, RouteMap } from "../db/types.ts";
import { fitRoute } from "../map/route-edit.ts";
import { PaperBatch } from "../../components/forms/PaperBatch.tsx";
import { matsuyamaBatchPaper } from "./batch.ts";
import { matsuyamaFrameSheet, ROUTE_MAP_ANNEX_MM, routeMapFor } from "./frame-build.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import { buildMatsuyamaSheet, t, value, type MatsuyamaSheet as Sheet } from "./matsuyama.ts";
import { ORIGINALS, type OriginalManifest } from "./originals.ts";
import { FONT_PROBE, paperCss, paperPage, readRepoFile, seedRows } from "./print-harness.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const TOL = 0.3;
const WHITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
/** タイルの代わり（2×2 の灰色の PNG） */
const TILE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGM4AQYMEAoAQa4JYQOnncMAAAAASUVORK5CYII=", "base64");
const TILE_HOST = "https://cyberjapandata.gsi.go.jp/";
const man: OriginalManifest = {
  id: "matsuyama",
  sha256: ORIGINALS.matsuyama.sha256,
  pages: ORIGINALS.matsuyama.usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-05T00:00:00.000Z",
};
const DEST: GeoPoint = { lat: 33.805, lng: 132.756 };

function withRoute(i: number): Ledger {
  const base = parseLedger(seedRows(SEED_PEOPLE[i]).person.ledger);
  const home = base.basic.location!;
  const mid = { lat: (home.lat + DEST.lat) / 2, lng: home.lng };
  const map: RouteMap = { to: 1, mode: "foot", source: "hand", line: [home, mid, DEST], via: [mid], distanceM: 1500, view: fitRoute([home, DEST], home) };
  return { ...base, evacuation: { ...base.evacuation, destination1Location: DEST, routeMap: map } };
}
const sheetOf = (i: number): Sheet => buildMatsuyamaSheet(seedRows(SEED_PEOPLE[i]), OPTS);
/** 半分の人は避難経路の文あり（欄の上を文に使う形も見る） */
const withText = (s: Sheet, i: number): Sheet => (i % 2 === 0 ? { ...s, cells: { ...s.cells, "route.text": value([t("南の道から公民館へ")]) } } : s);

type Rect = { x: number; y: number; w: number; h: number };
const near = (a: Rect, b: Rect) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
/** PDF の中の画像の数（画像の物 /Subtype /Image を数える） */
const pdfImages = (pdf: Uint8Array) => (Buffer.from(pdf).toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;

const chrome = chromePath();

describe.skipIf(!chrome)("避難経路の地図の印刷（headless Chrome）", () => {
  let browser: Browser;
  let page: Page;
  let fontOk = false;
  const tiles: string[] = [];
  // 一括印刷の人の間の頁の割り方（ページが読む paper-batch.css）も
  const css = [paperCss(), readRepoFile("components/forms/paper-batch.css")].join("\n");

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
    // 人ごとに読んだタイルを数えるので、前の人のタイルを使い回さない
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
      const url = req.url();
      if (url.startsWith(TILE_HOST)) {
        tiles.push(url);
        void req.respond({ status: 200, contentType: "image/png", body: TILE_PNG });
      } else if (url.startsWith("http")) void req.abort();
      else void req.continue();
    });
    await page.setContent(paperPage("<p>字</p>", css));
    fontOk = Boolean(await page.evaluate(FONT_PROBE));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function load(body: string) {
    tiles.length = 0;
    await page.emulateMediaType(undefined);
    // setContent は同じ文書に書き直すので、前の人の読んだタイルが文書の中に残る。新しい文書から
    await page.goto("about:blank");
    await page.setContent(paperPage(body, css), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
  }
  const pdf = () => page.pdf({ preferCSSPageSize: true, printBackground: true });

  it("原本の枠の紙: 地図は避難経路の欄の矩形 ±0.3mm、SVG は箱いっぱい、タイルを読んで PDF に刷る", async (ctx) => {
    if (!fontOk) ctx.skip();
    const slot = MATSUYAMA_FRAME.slots.find((s) => s.kind === "image")!;
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const sheet = withText(sheetOf(i), i);
      const framed = matsuyamaFrameSheet(sheet, man, { routeMap: routeMapFor(withRoute(i)) });
      const pic = framed.pages.flatMap((p) => p.items).find((it) => it.kind === "image")!;
      const body = renderToStaticMarkup(createElement(OverlaySheet, { sheet: framed, imageSrc: () => WHITE, checked: "", kind: "matsuyama" }));
      await load(body);
      await page.emulateMediaType("print");
      const got = await page.evaluate(() => {
        const mm = (px: number) => (px * 25.4) / 96;
        const sec = document.querySelector<HTMLElement>('section.paper.overlay[data-page="2"]')!;
        const base = sec.getBoundingClientRect();
        const rel = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: mm(r.left - base.left), y: mm(r.top - base.top), w: mm(r.width), h: mm(r.height) };
        };
        const div = sec.querySelector(".ov-pic")!;
        return { div: rel(div), svg: rel(div.querySelector("svg")!), images: div.querySelectorAll("svg image").length };
      });
      const p2 = MATSUYAMA_FRAME.pages.find((p) => p.page === 2)!;
      const want = { x: pic.box.x * p2.w, y: pic.box.y * p2.h, w: pic.box.w * p2.w, h: pic.box.h * p2.h };
      const id = SEED_PEOPLE[i].person.id;
      expect(near(got.div, want), `${id} 地図の箱`).toBeLessThanOrEqual(TOL);
      expect(near(got.svg, got.div), `${id} SVG`).toBeLessThanOrEqual(0.05);
      // 欄（枠の表の矩形）の中
      expect(got.div.x, id).toBeGreaterThanOrEqual(slot.box.x - TOL);
      expect(got.div.y, id).toBeGreaterThanOrEqual(slot.box.y - TOL);
      expect(got.div.x + got.div.w, id).toBeLessThanOrEqual(slot.box.x + slot.box.w + TOL);
      expect(got.div.y + got.div.h, id).toBeLessThanOrEqual(slot.box.y + slot.box.h + TOL);
      // 欄の中の SVG のタイルを頁が読む（同じ URL は 1 回）
      expect(got.images, id).toBeGreaterThan(0);
      expect(new Set(tiles).size, id).toBe(got.images);
      await page.emulateMediaType(undefined);
    }
    // PDF に刷る: 地図のある紙は無い紙より画像が多い
    const framed = (map: boolean) =>
      renderToStaticMarkup(
        createElement(OverlaySheet, {
          sheet: matsuyamaFrameSheet(sheetOf(0), man, { routeMap: map ? routeMapFor(withRoute(0)) : null }),
          imageSrc: () => WHITE,
          checked: "",
          kind: "matsuyama",
        }),
      );
    await load(framed(false));
    const without = await pdf();
    await load(framed(true));
    const withMap = await pdf();
    expect(pdfImages(withMap)).toBeGreaterThan(pdfImages(without));
    expect(pdfPageCount(withMap)).toBe(pdfPageCount(without));
  }, 300_000);

  /** 前からの紙面の 2 頁の段の位置（頁の左上からの mm）と、別紙の地図の箱 */
  async function legacy(sheet: Sheet, map: boolean) {
    await load(renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet, routeMap: map ? routeMapFor(withRoute(0)) : null })));
    await page.emulateMediaType("print");
    const m = await page.evaluate(() => {
      const mm = (px: number) => (px * 25.4) / 96;
      const two = document.querySelector<HTMLElement>('section.paper[data-page="2"]')!;
      const base = two.getBoundingClientRect();
      const blocks = [...two.querySelectorAll<HTMLElement>("[data-block]")].map((b) => {
        const r = b.getBoundingClientRect();
        return { block: b.dataset.block!, y: mm(r.top - base.top), h: mm(r.height) };
      });
      const annex = document.querySelector<HTMLElement>('section.paper[data-annex="route-map"]');
      const box = annex?.querySelector(".route-map");
      const svg = box?.querySelector("svg");
      const ar = annex?.getBoundingClientRect();
      const rel = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: mm(r.left - ar!.left), y: mm(r.top - ar!.top), w: mm(r.width), h: mm(r.height) };
      };
      return {
        blocks,
        twoH: mm(two.scrollHeight),
        mark: two.querySelector('[data-annex-mark="route-map"]')?.textContent ?? null,
        annexH: ar ? mm(annex!.scrollHeight) : null,
        box: box ? rel(box) : null,
        svg: svg ? rel(svg) : null,
        images: annex?.querySelectorAll("svg image").length ?? 0,
      };
    });
    await page.emulateMediaType(undefined);
    return m;
  }

  it("前からの紙面: 2 頁に地図の場所が無いので、段に「地図 別紙」（段の高さは変わらない）、地図は別紙の 1 頁（2 ＋ 1 頁）", async (ctx) => {
    if (!fontOk) ctx.skip();
    const pages: Record<string, number> = {};
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const id = SEED_PEOPLE[i].person.id;
      const sheet = withText(sheetOf(i), i);
      const before = await legacy(sheet, false);
      const after = await legacy(sheet, true);
      expect(after.mark, id).toBe("地図 別紙");
      // 2 頁の段は地図の有無で動かない（「地図 別紙」で行を増やさない）
      expect(after.blocks.map((b) => b.block), id).toEqual(before.blocks.map((b) => b.block));
      after.blocks.forEach((b, j) => {
        expect(Math.abs(b.y - before.blocks[j].y) + Math.abs(b.h - before.blocks[j].h), `${id} ${b.block}`).toBeLessThan(0.05);
      });
      expect(after.twoH, id).toBeLessThanOrEqual(297.2);
      // 別紙: 地図は段の幅いっぱい・86.6mm、頁の中
      expect(after.box!.w, id).toBeGreaterThan(ROUTE_MAP_ANNEX_MM.w - TOL);
      expect(after.box!.w, id).toBeLessThan(ROUTE_MAP_ANNEX_MM.w + TOL);
      expect(after.box!.h, id).toBeCloseTo(ROUTE_MAP_ANNEX_MM.h, 1);
      expect(near(after.svg!, after.box!), id).toBeLessThan(0.05);
      expect(after.annexH, id).toBeLessThanOrEqual(297.2);
      expect(after.images, id).toBeGreaterThan(0);
      expect(tiles.length, id).toBeGreaterThan(0);
      pages[id] = pdfPageCount(await pdf());
    }
    expect(pages).toEqual(Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, 3])));
    // PDF に地図のタイルを刷る（地図のある紙は無い紙より画像が多い）
    await load(renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet: sheetOf(0) })));
    const without = await pdf();
    await load(renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet: sheetOf(0), routeMap: routeMapFor(withRoute(0)) })));
    const withMap = await pdf();
    expect(pdfImages(withMap)).toBeGreaterThan(pdfImages(without));
    expect(pdfPageCount(without)).toBe(2);
  }, 300_000);

  it("一括印刷: 前からの紙面の人と原本の枠の紙の人を並べても、人の間で頁を割る（別紙のあとも）", async (ctx) => {
    if (!fontOk) ctx.skip();
    const two = (manifest: OriginalManifest | null) =>
      renderToStaticMarkup(
        createElement(PaperBatch, {
          papers: [0, 1, 2].map((i) =>
            matsuyamaBatchPaper({
              personId: SEED_PEOPLE[i].person.id,
              sheet: sheetOf(i),
              ledger: i === 2 ? parseLedger(seedRows(SEED_PEOPLE[i]).person.ledger) : withRoute(i),
              manifest,
              fill: false,
            }),
          ),
        }),
      );
    // 前からの紙面: 地図のある 2 人は 2 ＋ 別紙 1、無い人は 2
    await load(two(null));
    expect(pdfPageCount(await pdf())).toBe(3 + 3 + 2);
    // 原本の枠の紙: 地図は欄の中なので 2 頁ずつ（別紙の欄が無ければ）
    const framed = [0, 1, 2].map((i) => matsuyamaFrameSheet(sheetOf(i), man, { routeMap: routeMapFor(withRoute(i)) }));
    await load(two(man).replaceAll("/api/forms/originals/matsuyama/pages/1", WHITE).replaceAll("/api/forms/originals/matsuyama/pages/2", WHITE));
    expect(pdfPageCount(await pdf())).toBe(framed.reduce((n, s) => n + 2 + (s.annex.length > 0 ? 1 : 0), 0));
  }, 300_000);
});
