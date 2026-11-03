// ホーム画面に追加の印（public/icon-192.png・icon-512.png）を app/icon.svg から描く（T44）。手元で 1 回だけ回し、PNG を commit する。
// 使い方: node tools/icons/render-icons.mjs（Chrome の場所は CHROME で変えられる）。
// ホーム画面の印は透けると iPhone が黒く塗るので、白の地に輪を置く（輪は 72% の大きさで、角を丸められても欠けない）。
// 「72」の字は画面と同じ M PLUS 2 で描く（Google Fonts から読み、読めるまで待つ）。

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../../", import.meta.url));
const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const svg = (await readFile(`${root}app/icon.svg`, "utf8")).replace(/<!--[\s\S]*?-->/g, "");

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage();
  for (const size of [192, 512]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+2:wght@700&display=block">
<style>html,body{margin:0;width:${size}px;height:${size}px;background:#ffffff;display:grid;place-items:center}
svg{width:${Math.round(size * 0.72)}px;height:${Math.round(size * 0.72)}px}</style>
</head><body>${svg}</body></html>`,
      { waitUntil: "load" },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${root}public/icon-${size}.png`, omitBackground: false });
    console.log(`public/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
