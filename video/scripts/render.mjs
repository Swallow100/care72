// 書き出し。一時フォルダを video/.tmp に向けてから Remotion を呼ぶ。
// node scripts/render.mjs still [動画の名前] [コマ] [出す場所]   1 コマの静止画（png）
// node scripts/render.mjs video [動画の名前] [出す場所]          動画（mp4、h264、1920×1080、30fps）
// 動画の名前は Care72（英語の字幕つき）か Care72Ja。音の大きさは書き出しのあと scripts/loudnorm.mjs で -14 LUFS に。
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, run } from "./lib.mjs";

const [mode, comp = "Care72", ...rest] = process.argv.slice(2);
mkdirSync(join(ROOT, "out"), { recursive: true });

if (mode === "still") {
  const frame = rest[0] ?? "0";
  const out = rest[1] ?? `out/${comp}-${frame}.png`;
  run("npx", ["remotion", "still", "src/index.ts", comp, out, `--frame=${frame}`, "--image-format=png"]);
} else if (mode === "video") {
  // 出す場所のあとの引数は Remotion にそのまま渡す（例: --frames=0-89 で頭の 3 秒だけ）
  const out = rest[0] ?? `out/${comp}.mp4`;
  run("npx", ["remotion", "render", "src/index.ts", comp, out, "--codec=h264", "--audio-codec=aac", "--audio-bitrate=320k", ...rest.slice(1)]);
  console.log(`次: node scripts/loudnorm.mjs ${out} out/${comp}-final.mp4`);
} else {
  console.error("使い方: node scripts/render.mjs still [動画の名前] [コマ] [出す場所] / node scripts/render.mjs video [動画の名前] [出す場所]");
  process.exit(2);
}
