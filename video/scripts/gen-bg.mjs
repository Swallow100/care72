// 背景の生成動画（docs/video/BACKGROUND.md の B01…）を fal.ai の Seedance で作る。指示文は BACKGROUND.md の表の物と、共通の禁止の文。
// FAL_KEY=… node scripts/gen-bg.mjs <ID> [秒 10] [解像度 480p] [--from <静止画>] [--model 2.5]
//   例: node scripts/gen-bg.mjs B03 10 480p --from assets/bg/frames/B03-2.png
//   --from があれば、その静止画（gen-frame.mjs で作って選んだ物）を最初のコマにして動かす（image-to-video）。無ければ文だけから（text-to-video）
// 鍵は環境変数で受けるだけで、ファイル・記録に書かない。できた物は assets/bg/<ID>.mp4（commit しない）。
// 前の <ID>.mp4 は assets/bg/old/ へ退ける（<ID>-1.mp4・<ID>-2.mp4 は bg.mjs がつなぐ 2 本の印なので、作り直しには使わない）。
// 作ったあと node scripts/bg.mjs でぼかした連番にし、npm run scan。使った物は MATERIALS.md の「生成画像・生成動画」に書く。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const from = opt("--from");
const version = opt("--model") ?? "2.5";
const [id, seconds = "10", resolution = "480p"] = args;
const key = process.env.FAL_KEY;
if (!id || !key) {
  console.error("使い方: FAL_KEY=… node scripts/gen-bg.mjs <ID> [秒] [解像度] [--from <静止画>] [--model 2.5]");
  process.exit(2);
}
const MODEL = `bytedance/seedance-${version}/${from ? "image-to-video" : "text-to-video"}`;

const doc = readFileSync(join(ROOT, "..", "docs", "video", "BACKGROUND.md"), "utf8");
const common = /共通の禁止を付ける:\s*```\s*([\s\S]*?)```/.exec(doc)?.[1].trim();
const row = doc.split("\n").find((l) => l.startsWith(`| ${id} |`));
const own = row && /`([^`]+)`\s*\|\s*$/.exec(row)?.[1];
if (!common || !own) throw new Error(`BACKGROUND.md に ${id} の指示文か共通の禁止が無い`);
const prompt = `${own} ${common}`;

const head = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
const input = { prompt, resolution, duration: String(seconds), generate_audio: false };
if (from) {
  // 静止画は data URI で渡す（fal は data URI を受ける。PNG 1 枚は 3 MB 前後で、上限の 30 MB に収まる）
  const file = resolve(ROOT, from);
  input.image_url = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
} else {
  input.aspect_ratio = "16:9";
}
const sent = await fetch(`https://queue.fal.run/${MODEL}`, { method: "POST", headers: head, body: JSON.stringify(input) });
if (!sent.ok) throw new Error(`送れない: ${sent.status} ${await sent.text()}`);
const job = await sent.json();
console.log(`${id}: 受付 ${job.request_id}（${MODEL}、${resolution}・${seconds} 秒${from ? `、${from} から` : ""}）`);

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
const file = join(store, `${id}.mp4`);
mkdirSync(join(store, "old"), { recursive: true });
for (const ext of [".mp4", ".json"]) {
  const prev = file.replace(/\.mp4$/, ext);
  if (existsSync(prev)) renameSync(prev, join(store, "old", `${id}-${Date.now()}${ext}`));
}
writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
// 作り直すときのために、指示文・設定・種（seed）を横に残す（鍵と静止画の中身は入れない）
const record = { model: MODEL, input: { ...input, image_url: from ? from : undefined }, seed: out.seed, request: job.request_id, made: new Date().toISOString() };
writeFileSync(file.replace(/\.mp4$/, ".json"), JSON.stringify(record, null, 2) + "\n");
console.log(`${id}: → ${file}（seed ${out.seed}）`);
