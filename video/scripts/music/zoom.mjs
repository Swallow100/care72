// 書き出した WAV の一部の大きさを細かく見る。node scripts/music/zoom.mjs <id> <から秒> <まで秒> [刻みミリ秒]
// 例: node scripts/music/zoom.mjs A-piano 31.8 33.2 20 → 20 ms ごとの RMS とピーク（dBFS）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib.mjs";

const [id, a, b, stepMs = "20"] = process.argv.slice(2);
const buf = readFileSync(join(ROOT, "out", "music", `${id}.wav`));
const SR = buf.readUInt32LE(24);
const data = 44;
const frames = (buf.length - data) / 6;
const read = (i, ch) => {
  const o = data + i * 6 + ch * 3;
  let v = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
  if (v & 0x800000) v -= 0x1000000;
  return v / 8388608;
};
const step = Math.round((Number(stepMs) / 1000) * SR);
for (let s = Math.round(Number(a) * SR); s < Math.min(frames, Math.round(Number(b) * SR)); s += step) {
  let sum = 0, peak = 0;
  for (let i = s; i < s + step && i < frames; i++) {
    const l = read(i, 0), r = read(i, 1);
    sum += l * l + r * r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const rms = 10 * Math.log10(sum / (2 * step) + 1e-20);
  const bar = "#".repeat(Math.max(0, Math.round((rms + 60) / 1.5)));
  console.log(`${(s / SR).toFixed(3)}  rms ${rms.toFixed(1).padStart(6)}  peak ${(20 * Math.log10(peak + 1e-12)).toFixed(1).padStart(6)}  ${bar}`);
}
