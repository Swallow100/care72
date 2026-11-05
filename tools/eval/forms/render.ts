// 評価の台（T107）の Chrome（headless、puppeteer-core。tools/print/chrome.ts の探し方）。
// - 入力の絵（手書き風・写真風）と PDF、架空の様式の白紙の PDF を HTML から作る。伏せる所（data-secret）の場所を頁の比で返す
// - 埋めた紙の HTML を PDF と 1 頁目の PNG にする
// Chrome が無い端末では null（絵・PDF・紙の入力は飛ばし、飛ばした数を記録する）。

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { chromePath } from "../../print/chrome.ts";
import type { ComposePage } from "../../../lib/forms/review-ai.ts";

/** 照合の絵の描き方（lib/forms/review-compose.ts を 1 つの script に。初めの 1 回だけ作る） */
let composeScript: Promise<string> | null = null;
function composeBundle(): Promise<string> {
  composeScript ??= (async () => {
    const { build } = await import("esbuild");
    const entry = new URL("../../../lib/forms/review-compose.ts", import.meta.url);
    const r = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, format: "iife", globalName: "RC", platform: "browser", write: false, logLevel: "silent" });
    return r.outputFiles[0].text;
  })();
  return composeScript;
}

/** 頁の比の矩形（左上 0・右下 1） */
export type Ratio = { x: number; y: number; w: number; h: number };

export type Renderer = {
  /** 絵（JPEG）。secrets は伏せる所の場所 */
  image(html: string, o: { width: number; height: number; quality: number }): Promise<{ bytes: Uint8Array; secrets: Ratio[] }>;
  /** 印刷の PDF。secrets は頁ごと */
  pdf(html: string): Promise<{ bytes: Uint8Array; secrets: Ratio[][] }>;
  /** 紙の HTML を PDF と 1 頁目の PNG（png は無ければ作らない）。別紙の頁があればその PNG も（T141。別紙の見た目を確かめる） */
  paper(html: string, o: { png: boolean }): Promise<{ pdf: Uint8Array; png: Uint8Array | null; annexPng?: Uint8Array | null }>;
  /**
   * 紙の AI の照合（T136）に送る頁の絵。アプリと同じ描き方（lib/forms/review-compose.ts の composePage）をこの頁で動かす。
   * href は頁の画像の data: の URL。塗った後の JPEG（付け足しなし）と塗った数
   */
  compose(page: ComposePage, family: string): Promise<{ bytes: Uint8Array; paints: number }>;
  close(): Promise<void>;
};

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
  });
}

export async function launchRenderer(): Promise<Renderer | null> {
  const exe = chromePath();
  if (!exe) return null;
  const browser: Browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--font-render-hinting=none"] });
  const page = await browser.newPage();
  return {
    async image(html, o) {
      await page.setViewport({ width: o.width, height: o.height, deviceScaleFactor: 1 });
      await page.emulateMediaType("screen");
      await page.setContent(html, { waitUntil: "load" });
      await settle(page);
      const secrets = await page.evaluate(
        (w: number, h: number) =>
          [...document.querySelectorAll("[data-secret]")].map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left / w, y: r.top / h, w: r.width / w, h: r.height / h };
          }),
        o.width,
        o.height,
      );
      const bytes = await page.screenshot({ type: "jpeg", quality: o.quality, clip: { x: 0, y: 0, width: o.width, height: o.height } });
      return { bytes: new Uint8Array(bytes), secrets };
    },
    async pdf(html) {
      await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
      await page.emulateMediaType("print");
      await page.setContent(html, { waitUntil: "load" });
      await settle(page);
      const secrets = await page.evaluate(() =>
        [...document.querySelectorAll("section.pg")].map((sec) => {
          const s = sec.getBoundingClientRect();
          return [...sec.querySelectorAll("[data-secret]")].map((el) => {
            const r = el.getBoundingClientRect();
            return { x: (r.left - s.left) / s.width, y: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height };
          });
        }),
      );
      const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false });
      return { bytes: new Uint8Array(bytes), secrets };
    },
    async paper(html, o) {
      await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
      await page.emulateMediaType("print");
      await page.setContent(html, { waitUntil: "load" });
      await settle(page);
      const pdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false }));
      let png: Uint8Array | null = null;
      let annexPng: Uint8Array | null = null;
      if (o.png) {
        const first = await page.$("section.paper");
        if (first) png = new Uint8Array(await first.screenshot({ type: "png" }));
        const annex = await page.$("section.paper[data-annex]");
        if (annex) annexPng = new Uint8Array(await annex.screenshot({ type: "png" }));
      }
      return { pdf, png, annexPng };
    },
    async compose(plan, family) {
      await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
      await page.emulateMediaType("screen");
      await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>`, { waitUntil: "load" });
      await page.addScriptTag({ content: await composeBundle() });
      const got = await page.evaluate(
        async (p, fam) => {
          const rc = (window as unknown as { RC: { composePage: (x: unknown, f: string) => Promise<{ blob: Blob; paints: number }> } }).RC;
          const { blob, paints } = await rc.composePage(p, fam);
          return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), paints };
        },
        plan,
        family,
      );
      return { bytes: new Uint8Array(got.bytes), paints: got.paints };
    },
    async close() {
      // Windows では browser.close() が数分かかることがある（後片付けの待ち）。5 秒で切り、残りは止める
      await Promise.race([browser.close().catch(() => undefined), new Promise((ok) => setTimeout(ok, 5000))]);
      browser.process()?.kill();
    },
  };
}

/** JPEG の頭に端末の付け足し（EXIF の APP1、機種名だけ）を足す。スマホの写真の形（ブラウザの黒塗りが外す物） */
export function withExif(jpeg: Uint8Array): Uint8Array {
  const make = new TextEncoder().encode("EvalPhone\0");
  // TIFF（II、IFD 1 つ、Make 1 項目）
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + make.length);
  const dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00], 0);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, 0x010f, true);
  dv.setUint16(12, 2, true);
  dv.setUint32(14, make.length, true);
  dv.setUint32(18, 8 + 2 + 12 + 4, true);
  dv.setUint32(22, 0, true);
  tiff.set(make, 26);
  const body = new Uint8Array([...new TextEncoder().encode("Exif\0\0"), ...tiff]);
  const seg = new Uint8Array(4 + body.length);
  seg.set([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff], 0);
  seg.set(body, 4);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

/** HEIC の形の頭（ISO の ftyp heic）と中身の代わり。ブラウザ（Chrome）は開けない形 */
export function heicBytes(seed: number): Uint8Array {
  const head = [0x00, 0x00, 0x00, 0x18, ..."ftypheic".split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ..."mif1heic".split("").map((c) => c.charCodeAt(0))];
  const out = new Uint8Array(4096);
  out.set(head, 0);
  let a = seed >>> 0;
  for (let i = head.length; i < out.length; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    out[i] = a >>> 24;
  }
  return out;
}
