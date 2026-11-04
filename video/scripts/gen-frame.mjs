// 背景の生成動画（docs/video/BACKGROUND.md の B01…）の見た目を、先に静止画で決める（GPT Image 2、fal.ai）。
// 選んだ静止画から動画にすると、8 本の光・色・寄り方がそろう（gen-bg.mjs は文だけから作る）。
// FAL_KEY=… node scripts/gen-frame.mjs [ID …] [--n 2]     ID を省くと表の全部。例: node scripts/gen-frame.mjs B03 B07 --n 2
// 鍵は環境変数で受けるだけ。できた物は assets/bg/frames/<ID>-<n>.png と、指示文を書いた .json（commit しない）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const MODEL = "openai/gpt-image-2";
const args = process.argv.slice(2);
const nAt = args.indexOf("--n");
const count = nAt >= 0 ? Number(args[nAt + 1]) : 2;
const ids = args.filter((a, i) => !a.startsWith("--") && !(nAt >= 0 && i === nAt + 1));
const key = process.env.FAL_KEY;
if (!key) {
  console.error("使い方: FAL_KEY=… node scripts/gen-frame.mjs [ID …] [--n 2]");
  process.exit(2);
}

const doc = readFileSync(join(ROOT, "..", "docs", "video", "BACKGROUND.md"), "utf8");
const common = /共通の禁止を付ける:\s*```\s*([\s\S]*?)```/.exec(doc)?.[1].trim();
const rows = doc
  .split("\n")
  .map((l) => /^\| (B\d{2}) \|.*`([^`]+)`\s*\|\s*$/.exec(l))
  .filter(Boolean)
  .map((m) => ({ id: m[1], own: m[2] }));
if (!common || rows.length === 0) throw new Error("BACKGROUND.md の表か共通の禁止が読めない");
// 静止画の見た目（8 本で同じ）。写真の作りにし、作り物の光り方・彩度を避ける
const look = "Photorealistic documentary photograph taken in Japan, natural available light, muted colors, shallow depth of field, 35mm lens, no dramatic lighting, no glow.";

const out = join(ROOT, "assets", "bg", "frames");
mkdirSync(out, { recursive: true });
const head = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
const todo = ids.length ? rows.filter((r) => ids.includes(r.id)) : rows;

await Promise.all(
  todo.map(async ({ id, own }) => {
    // カメラの動きの言葉は静止画では要らないので落とす（「Slow …」「Camera …」「Static camera …」の文）
    const still = own.replace(/\s*(?:Slow|Static|Camera|Gentle camera)[^.]*\./g, "").trim();
    const prompt = `${look} ${still} ${common}`;
    const input = { prompt, image_size: "landscape_16_9", quality: "medium", num_images: count, output_format: "png" };
    const r = await fetch(`https://fal.run/${MODEL}`, { method: "POST", headers: head, body: JSON.stringify(input) });
    if (!r.ok) throw new Error(`${id}: ${r.status} ${await r.text()}`);
    const res = await r.json();
    for (const [i, img] of (res.images ?? []).entries()) {
      const file = join(out, `${id}-${i + 1}.png`);
      writeFileSync(file, Buffer.from(await (await fetch(img.url)).arrayBuffer()));
      console.log(`${id}: → ${file}`);
    }
    writeFileSync(join(out, `${id}.json`), JSON.stringify({ model: MODEL, input, made: new Date().toISOString() }, null, 2) + "\n");
  }),
);
