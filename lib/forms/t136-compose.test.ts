// T136 AI の照合に送る頁の絵（lib/forms/review-compose.ts の composePage）を headless Chrome で描いて、ピクセルで確かめる。
// 人が塗る取り込み（T52）と違い、塗る所は決まりで決まるので、塗りが効いていないと気付かない。塗る四角の中が全部黒いこと・
// 塗る四角の下に字を描いても字が残らないこと・塗らない欄の字は描くこと・JPEG に付け足しが無いことを見る。
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath } from "../../tools/print/chrome.ts";
import { hasJpegMetadata, isJpeg } from "../redact/jpeg.ts";
import type { ComposePage } from "./review-ai.ts";
import { pageOps } from "./review-compose.ts";

const chrome = chromePath();

describe.skipIf(!chrome)("照合の頁の絵（headless Chrome）", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL("./review-compose.ts", import.meta.url))],
      bundle: true,
      format: "iife",
      globalName: "RC",
      platform: "browser",
      write: false,
      logLevel: "silent",
    });
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
    await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("塗る四角の中は全部黒く（下に字があっても）、塗らない字は描く。JPEG は付け足しなし", async () => {
    // 塗る四角の下にもわざと字を置く（描く物に塗る欄の字は入らないが、入っても残らないことを見る）
    const secretBox = { x: 0.1, y: 0.1, w: 0.4, h: 0.05 };
    const plainBox = { x: 0.1, y: 0.3, w: 0.4, h: 0.05 };
    const plan: Omit<ComposePage, "href"> = {
      page: 1,
      landscape: false,
      image: { x: 0, y: 0, w: 210, h: 297 },
      draws: [
        { kind: "text", box: secretBox, lines: ["山田 太郎 090-0000-0001"], fontPt: 10.5, top: false },
        { kind: "text", box: plainBox, lines: ["要介護3 歩行 一部"], fontPt: 10.5, top: false },
        { kind: "mark", box: { x: 0.6, y: 0.3, w: 0.02, h: 0.014 }, mark: "check" },
      ],
      paints: [secretBox],
    };
    const ops = pageOps(plan);
    const got = await page.evaluate(async (p) => {
      // 下に敷く空の頁（白に罫線）
      const bg = document.createElement("canvas");
      bg.width = 420;
      bg.height = 594;
      const g = bg.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 420, 594);
      g.fillStyle = "#888";
      g.fillRect(0, 297, 420, 2);
      const href = bg.toDataURL("image/png");
      const { blob, paints } = await (window as unknown as { RC: typeof import("./review-compose.ts") }).RC.composePage({ ...p, href }, '"BIZ UDPGothic", "Yu Gothic UI", sans-serif');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const lum = (x: number, y: number) => {
        const i = (Math.floor(y) * c.width + Math.floor(x)) * 4;
        return (data[i] + data[i + 1] + data[i + 2]) / 3;
      };
      const stats = (r: { x: number; y: number; w: number; h: number }) => {
        let max = 0;
        let dark = 0;
        let n = 0;
        for (let y = Math.ceil(r.y); y < r.y + r.h; y++) {
          for (let x = Math.ceil(r.x); x < r.x + r.w; x++) {
            const l = lum(x, y);
            max = Math.max(max, l);
            if (l < 100) dark++;
            n++;
          }
        }
        return { max, dark, n };
      };
      return { w: c.width, h: c.height, paints, bytes: Array.from(bytes), secret: stats({ x: p.secretPx.x, y: p.secretPx.y, w: p.secretPx.w, h: p.secretPx.h }), plain: stats(p.plainPx) };
    }, { ...plan, secretPx: ops.paints[0], plainPx: ops.texts[1].clip });
    expect(got.w).toBe(ops.w);
    expect(got.paints).toBe(1);
    // 塗る四角の中は全部黒（JPEG のにじみを見て 40 まで）
    expect(got.secret.max).toBeLessThan(40);
    // 塗らない欄の字は描いてある（暗い点がある）が、全部は黒くない
    expect(got.plain.dark).toBeGreaterThan(20);
    expect(got.plain.dark).toBeLessThan(got.plain.n * 0.6);
    const bytes = new Uint8Array(got.bytes);
    expect(isJpeg(bytes)).toBe(true);
    expect(hasJpegMetadata(bytes)).toBe(false);
  }, 60_000);
});
