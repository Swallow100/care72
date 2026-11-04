// 背景の生成動画（docs/video/BACKGROUND.md の B01…）を、ぼかした静止画の連番にする。
// node scripts/bg.mjs            assets/bg/ の B01.mp4 … を全部（B07-1.mp4・B07-2.mp4 はつないで B07 に）
// 書き出しのたびに 1920px の絵を CSS でぼかすと重いので、ここで一度だけぼかしておく。
// Remotion の ffmpeg には gblur の filter が無いことがあるので、160px に縮めてから 1920px に戻してぼかす。色を抜くのと青をかけるのは編集の側（Video.tsx の Backdrop）。
// 置いたあと npm run scan を流すと assets.json に載る。
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, ffmpeg, run } from "./lib.mjs";

const store = join(ROOT, "assets", "bg");
if (!existsSync(store)) {
  console.log("assets/bg がありません（docs/video/BACKGROUND.md の置き場）");
  process.exit(0);
}
const groups = {};
for (const name of readdirSync(store).sort()) {
  const m = /^(B\d{2})(?:-(\d+))?\.(mp4|mov|webm)$/i.exec(name);
  if (!m) continue;
  (groups[m[1]] ??= []).push(join(store, name));
}
const ff = ffmpeg();
for (const [id, files] of Object.entries(groups)) {
  const out = join(ROOT, "public", "bg", id);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const inputs = files.flatMap((f) => ["-i", f]);
  const blur = "scale=160:90:flags=area,scale=1920:1080:flags=bicubic";
  const filter =
    files.length === 1
      ? `[0:v]${blur}[v]`
      : `${files.map((_, i) => `[${i}:v]scale=1920:1080,setsar=1[s${i}]`).join(";")};${files.map((_, i) => `[s${i}]`).join("")}concat=n=${files.length}:v=1:a=0,${blur}[v]`;
  run(ff.cmd, [...ff.pre, "-y", ...inputs, "-filter_complex", filter, "-map", "[v]", "-r", "30", "-fps_mode", "cfr", "-q:v", "4", join(out, "%05d.jpg")]);
  console.log(`${id}: ${files.length} 本 → public/bg/${id}`);
}
