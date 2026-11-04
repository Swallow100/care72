// 記録（term.cast）のある秒の画面を文字で出す。描く前に、映る文字（名前・道・鍵）を確かめるため。
// node video/scripts/term/text.mjs <term.cast> [--at 秒|@印] [--all] [--marks]
//   --all は流れて見えなくなった行も全部、--marks は印の一覧
import { createRequire } from "node:module";
import { loadCast } from "./lib.mjs";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless");
const { Unicode11Addon } = require("@xterm/addon-unicode11");

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--at");
const at = argv.includes("--at") ? argv[argv.indexOf("--at") + 1] : null;
const { header, events } = loadCast(file);
const marks = events.filter(([, k]) => k === "m").map(([t, , label]) => ({ t, label }));
if (argv.includes("--marks")) {
  for (const m of marks) console.log(`${m.t.toFixed(2)}\t${m.label}`);
  process.exit(0);
}
let t = Infinity;
if (at) {
  const m = /^(@([^+]+?)|(-?\d+(?:\.\d+)?))([+-]\d+(?:\.\d+)?)?$/.exec(at);
  t = (m[2] ? marks.find((x) => x.label === m[2]).t : Number(m[3])) + (m[4] ? Number(m[4]) : 0);
}
const term = new Terminal({ cols: header.width, rows: header.height, scrollback: 50000, allowProposedApi: true });
term.loadAddon(new Unicode11Addon());
term.unicode.activeVersion = "11";
for (const [time, kind, data] of events) {
  if (kind !== "o" || time > t) continue;
  await new Promise((r) => term.write(data, r));
}
const b = term.buffer.active;
const from = argv.includes("--all") ? 0 : b.baseY;
const to = argv.includes("--all") ? b.length : b.baseY + header.height;
const lines = [];
for (let i = from; i < to; i++) lines.push(b.getLine(i)?.translateToString(true) ?? "");
console.log(lines.join("\n"));
