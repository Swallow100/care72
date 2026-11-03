// 録画の連番から等間隔に何コマか抜き、1 枚の一覧（png）にする。撮れた録画に実名・ID・パスワード・ほかのプロジェクトが
// 映っていないかを 1 本ずつ見るため（docs/video/SHOOTING.md「撮ったあと」）。出す物は out/sheet/（commit しない）。
// node scripts/sheet.mjs <連番のフォルダ> [枚数 12]
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ROOT } from "./lib.mjs";
import { launch } from "./record-lib.mjs";

const [dirArg, countArg = "12"] = process.argv.slice(2);
if (!dirArg) {
  console.error("使い方: node scripts/sheet.mjs <連番のフォルダ> [枚数]");
  process.exit(2);
}
const dir = resolve(process.cwd(), dirArg);
const frames = readdirSync(dir).filter((f) => /^\d{5}\.jpg$/.test(f)).sort();
const count = Math.min(Number(countArg), frames.length);
const picks = Array.from({ length: count }, (_, i) => frames[Math.round((i * (frames.length - 1)) / Math.max(1, count - 1))]);
const cells = picks
  .map((f) => {
    const sec = ((Number(f.slice(0, 5)) - 1) / 30).toFixed(1);
    return `<figure><img src="data:image/jpeg;base64,${readFileSync(join(dir, f)).toString("base64")}"><figcaption>${sec} 秒</figcaption></figure>`;
  })
  .join("");
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px;width:1908px}
figure{margin:0}img{width:100%;display:block;border:1px solid #ccc}figcaption{padding:2px 0}
</style>${cells}`;
const out = join(ROOT, "out", "sheet");
mkdirSync(out, { recursive: true });
const file = join(out, `${basename(dir)}.png`);
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 600 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: file, fullPage: true });
} finally {
  await browser.close();
}
console.log(`${file}（${count} コマ / ${frames.length}）`);
