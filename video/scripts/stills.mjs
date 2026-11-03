// 要所の静止画をまとめて書き出す（1 回の bundle で何枚も）。重なり・はみ出し・空いた所を目で見るため。
// node scripts/stills.mjs <出す場所> <秒> [秒 …]   例: node scripts/stills.mjs out/stills 3 29 36 115
// 動画の名前は Care72Ja（日本語の字幕だけ）。秒は小数でよい（30fps のコマに丸める）。
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, tmpEnv } from "./lib.mjs";

Object.assign(process.env, tmpEnv());
const { bundle } = await import("@remotion/bundler");
const { renderStill, selectComposition } = await import("@remotion/renderer");

const [outDir = "out/stills", ...secs] = process.argv.slice(2);
if (secs.length === 0) {
  console.error("使い方: node scripts/stills.mjs <出す場所> <秒> [秒 …]");
  process.exit(2);
}
const out = join(ROOT, outDir);
mkdirSync(out, { recursive: true });

const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: join(ROOT, "public") });
const composition = await selectComposition({ serveUrl, id: "Care72Ja", inputProps: { showEn: false } });
for (const s of secs) {
  const frame = Math.round(Number(s) * composition.fps);
  const file = join(out, `s${String(s).replace(".", "_").padStart(5, "0")}.png`);
  await renderStill({ serveUrl, composition, frame, output: file, inputProps: { showEn: false }, imageFormat: "png" });
  console.log(`${s} 秒 → ${file}`);
}
