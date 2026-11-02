// 音の大きさを -14 LUFS（真のピーク -1.5 dBTP）にそろえる。ffmpeg の loudnorm を 2 回（測る → 合わせる）、最後にもう 1 回測る。
// node scripts/loudnorm.mjs <書き出した mp4> <出す mp4>
// 映像はそのまま写す（-c:v copy）。YouTube は -14 LUFS より大きい音を下げるので、ここで合わせておく。
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, capture, ffmpeg, run } from "./lib.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("使い方: node scripts/loudnorm.mjs <書き出した mp4> <出す mp4>");
  process.exit(2);
}
const src = resolve(ROOT, input);
const dst = resolve(ROOT, output);
if (!existsSync(src)) {
  console.error(`無い: ${src}`);
  process.exit(2);
}
const TARGET = "I=-14:TP=-1.5:LRA=11";
const ff = ffmpeg();

function measure(file) {
  const r = capture(ff.cmd, [...ff.pre, "-hide_banner", "-i", file, "-af", `loudnorm=${TARGET}:print_format=json`, "-f", "null", "-"]);
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const json = text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json);
  } catch {
    console.error("loudnorm の結果が読めない。ffmpeg に loudnorm が無いかもしれない（README の「音」）");
    console.error(text.slice(-800));
    process.exit(1);
  }
}

const m = measure(src);
console.log(`前: ${m.input_i} LUFS、ピーク ${m.input_tp} dBTP`);
const filter =
  `loudnorm=${TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
  `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
run(ff.cmd, [...ff.pre, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-af", filter, "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-ar", "48000", dst]);
const after = measure(dst);
console.log(`後: ${after.input_i} LUFS、ピーク ${after.input_tp} dBTP（目標 -14 LUFS、-1.5 dBTP 以下）`);
