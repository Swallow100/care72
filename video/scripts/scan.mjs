// public の下の素材を数えて public/assets.json に書く（録画の連番の枚数と、音のファイルの一覧）。
// 編集の枠（src/assets.ts）はこれを読み、無い素材は仮の面で描く。
// node scripts/scan.mjs
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROOT } from "./lib.mjs";
import { SCENES } from "../src/timeline.ts";

const pub = join(ROOT, "public");
const footage = {};
const footageDir = join(pub, "footage");
if (existsSync(footageDir)) {
  for (const id of readdirSync(footageDir)) {
    const dir = join(footageDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const n = readdirSync(dir).filter((f) => /^\d{5}\.jpg$/.test(f)).length;
    if (n > 0) footage[id] = n;
  }
}

const audio = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(wav|mp3|m4a)$/i.test(name)) audio.push(relative(pub, p).split(sep).join("/"));
  }
}
walk(join(pub, "audio"));

writeFileSync(join(pub, "assets.json"), JSON.stringify({ footage, audio }, null, 2) + "\n");

// 足りない録画を出す
const wanted = new Set();
for (const s of SCENES) for (const sh of s.shots) for (const id of [sh.footage, ...(sh.footages ?? [])]) if (id) wanted.add(id);
const missing = [...wanted].filter((id) => !footage[id]).sort();
console.log(`録画 ${Object.keys(footage).length} 本、音 ${audio.length} 本を public/assets.json に書いた`);
console.log(missing.length ? `まだ無い録画: ${missing.join(" ")}` : "録画は全部ある");
