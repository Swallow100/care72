// 撮る前に画面を 1 枚ずつ見る（png）。録画ではない。手元だけで使い、出した png は commit しない（out/look/）。
// CARE72_CM_PASSWORD=… CARE72_JUDGE_PASSWORD=… node scripts/look.mjs <役 cm|family|self|medical> <道> [<道> …]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
import { launch, login, newPage, open, PC, PHONE } from "./record-lib.mjs";

const base = process.env.CARE72_BASE ?? "http://localhost:3073";
const [who, ...paths] = process.argv.slice(2);
const browser = await launch();
try {
  const phone = who === "family" || who === "self";
  const page = await newPage(browser, phone ? PHONE : PC);
  if (who === "cm") await login(page, base, "yamamoto", process.env.CARE72_CM_PASSWORD);
  else await login(page, base, "judge", process.env.CARE72_JUDGE_PASSWORD, who);
  const out = join(ROOT, "out", "look");
  mkdirSync(out, { recursive: true });
  for (const p of paths) {
    await open(page, base, p);
    const file = join(out, `${who}${p.replace(/[^a-z0-9]+/gi, "_")}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} finally {
  await browser.close();
}
