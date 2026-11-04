// 書き出した WAV で、強調の窓の端の谷を計り直し、report.json に書く。node scripts/music/edges.mjs [A-piano ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib.mjs";
import { Stereo, WINDOWS } from "./lib/core.mjs";
import { windowEdges } from "./lib/output.mjs";

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["A-piano", "B-pulse", "C-ambient", "D-phase"];
for (const id of ids) {
  const wav = join(ROOT, "out", "music", `${id}.wav`);
  if (!existsSync(wav)) continue;
  const buf = readFileSync(wav);
  const n = (buf.length - 44) / 6;
  const st = new Stereo(n);
  for (let i = 0, o = 44; i < n; i++) {
    for (const ch of [st.L, st.R]) {
      let v = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      ch[i] = v / 8388608;
      o += 3;
    }
  }
  const edges = windowEdges(st, WINDOWS);
  const rp = join(ROOT, "out", "music", `${id}.report.json`);
  if (existsSync(rp)) {
    const rep = JSON.parse(readFileSync(rp, "utf8"));
    rep.windowEdges = edges;
    writeFileSync(rp, `${JSON.stringify(rep, null, 1)}\n`);
  }
  console.log(`${id}: ${edges.map((e) => `${e.window[0]} 秒 ${e.startDb} dB・${e.window[1]} 秒 ${e.endDb} dB`).join("、")}`);
}
