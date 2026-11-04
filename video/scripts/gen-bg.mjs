// 背景の生成動画（docs/video/BACKGROUND.md の B01…）を fal.ai の Seedance 2.0 で作る。指示文は BACKGROUND.md の表の物と、共通の禁止の文。
// FAL_KEY=… node scripts/gen-bg.mjs <ID> [秒 10] [解像度 720p]     例: node scripts/gen-bg.mjs B03 10 720p
// 鍵は環境変数で受けるだけで、ファイル・記録に書かない。できた物は assets/bg/<ID>.mp4（commit しない）。同じ ID があれば <ID>-2.mp4 … にする。
// 作ったあと node scripts/bg.mjs でぼかした連番にし、npm run scan。使った物は MATERIALS.md の「生成画像・生成動画」に書く。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const MODEL = "bytedance/seedance-2.0/text-to-video";
const [id, seconds = "10", resolution = "720p"] = process.argv.slice(2);
const key = process.env.FAL_KEY;
if (!id || !key) {
  console.error("使い方: FAL_KEY=… node scripts/gen-bg.mjs <ID> [秒] [解像度]");
  process.exit(2);
}

const doc = readFileSync(join(ROOT, "..", "docs", "video", "BACKGROUND.md"), "utf8");
const common = /共通の禁止を付ける:\s*```\s*([\s\S]*?)```/.exec(doc)?.[1].trim();
const row = doc.split("\n").find((l) => l.startsWith(`| ${id} |`));
const own = row && /`([^`]+)`\s*\|\s*$/.exec(row)?.[1];
if (!common || !own) throw new Error(`BACKGROUND.md に ${id} の指示文か共通の禁止が無い`);
const prompt = `${own} ${common}`;

const head = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
const input = { prompt, resolution, duration: String(seconds), aspect_ratio: "16:9", generate_audio: false };
const sent = await fetch(`https://queue.fal.run/${MODEL}`, { method: "POST", headers: head, body: JSON.stringify(input) });
if (!sent.ok) throw new Error(`送れない: ${sent.status} ${await sent.text()}`);
const job = await sent.json();
console.log(`${id}: 受付 ${job.request_id}（${resolution}・${seconds} 秒）`);

// 待つ（数分かかる）。5 秒ごとに状態を見る
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await (await fetch(job.status_url, { headers: head })).json();
  if (st.status === "COMPLETED") break;
  if (st.status !== "IN_QUEUE" && st.status !== "IN_PROGRESS") throw new Error(`止まった: ${JSON.stringify(st)}`);
}
const out = await (await fetch(job.response_url, { headers: head })).json();
const url = out.video?.url;
if (!url) throw new Error(`動画が無い: ${JSON.stringify(out)}`);

const store = join(ROOT, "assets", "bg");
mkdirSync(store, { recursive: true });
let file = join(store, `${id}.mp4`);
for (let n = 2; existsSync(file); n++) file = join(store, `${id}-${n}.mp4`);
writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
// 作り直すときのために、指示文・設定・種（seed）を横に残す（鍵は入れない）
writeFileSync(file.replace(/\.mp4$/, ".json"), JSON.stringify({ model: MODEL, input, seed: out.seed, request: job.request_id, made: new Date().toISOString() }, null, 2) + "\n");
console.log(`${id}: → ${file}（seed ${out.seed}）`);
