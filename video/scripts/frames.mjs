// 録画を静止画の連番（30fps の jpg）と音（wav）に分ける。
// node scripts/frames.mjs <録画のファイル> <番号> [始まりの秒] [終わりの秒]
//   例: node scripts/frames.mjs raw/R10-2.mp4 R10 12.5 95
// 出る物: assets/rec/<番号>-<回>/00001.jpg …（scan で public/footage/<番号>/ へ写る）、public/audio/app/<番号>.wav（録画に音があれば）
// 連番にするのは、Windows で OffthreadVideo が "No frame found" で止まることがあるため（README）。
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, capture, ffmpeg, run } from "./lib.mjs";

const [input, id, start, end] = process.argv.slice(2);
if (!input || !id || !/^R\d{2}$/.test(id)) {
  console.error("使い方: node scripts/frames.mjs <録画のファイル> <番号 R00> [始まりの秒] [終わりの秒]");
  process.exit(2);
}
const src = resolve(process.cwd(), input);
if (!existsSync(src)) {
  console.error(`録画が無い: ${src}`);
  process.exit(2);
}

const range = [];
if (start) range.push("-ss", start);
if (end) range.push("-to", end);

// 置き場は video/assets/rec/<番号>-<回>。回は今ある回の次（scan は一番大きい回を使うので、新しく撮った物が使われる）
const recRoot = join(ROOT, "assets", "rec");
mkdirSync(recRoot, { recursive: true });
const takes = readdirSync(recRoot)
  .map((n) => new RegExp(`^${id}-(\\d+)$`).exec(n))
  .filter(Boolean)
  .map((m) => Number(m[1]));
const outDir = join(recRoot, `${id}-${(takes.length ? Math.max(...takes) : 0) + 1}`);
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^\d{5}\.jpg$/.test(f)) rmSync(join(outDir, f));

const ff = ffmpeg();
// 映像: 30fps の jpg。大きさは録画のまま（編集で寄るので縮めない）。
// Remotion の ffmpeg には fps の filter が無いので、出力の -r と -fps_mode cfr で 30fps にそろえる
run(ff.cmd, [...ff.pre, "-hide_banner", "-loglevel", "error", ...range, "-i", src, "-r", "30", "-fps_mode", "cfr", "-q:v", "2", join(outDir, "%05d.jpg")]);

// 音: 48kHz の wav。録画に音が無ければ飛ばす
const audioDir = join(ROOT, "public", "audio", "app");
mkdirSync(audioDir, { recursive: true });
const a = capture(ff.cmd, [...ff.pre, "-hide_banner", "-loglevel", "error", "-y", ...range, "-i", src, "-vn", "-ac", "2", "-ar", "48000", join(audioDir, `${id}.wav`)]);
if (a.status !== 0) console.log("音は無かった（映像だけ）");

const n = readdirSync(outDir).filter((f) => /^\d{5}\.jpg$/.test(f)).length;
console.log(`${id}: ${n} 枚（${(n / 30).toFixed(1)} 秒）`);
run(process.execPath, [join(ROOT, "scripts", "scan.mjs")]);
