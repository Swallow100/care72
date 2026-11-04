// 端末の記録（term.cast）を xterm.js に流し、1/30 秒ごとに撮って 30fps の連番（00001.jpg …、1920×1080）にする。
// node video/scripts/term/render.mjs <term.cast> <連番のフォルダ> [--name R20] [--from 秒|@印] [--to 秒|@印] [--cut 始..終,始..終]
//   秒は記録の始めからの秒。@印 は記録の印の名前（lib.mjs の mark）。@印+0.5・@印-1 のように足し引きできる
//   --cut は待つだけの所を切る（その間の出力は xterm に流すが、コマは作らない。record-lib.mjs の一時止めと同じ）
// 描くのは記録の文字そのもの。文字や動きを足さない。色は下の THEME（白地。S7 は白地の段）
import { existsSync, linkSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, relative, resolve } from "node:path";
import { launch } from "../record-lib.mjs";
import { HERE, VIDEO, loadCast, privateLines } from "./lib.mjs";

/** 白地の端末の色。青は編集の濃い青（#1453c8）、赤・緑はアプリの至急・無事と同じ値 */
export const THEME = {
  background: "#ffffff",
  foreground: "#1c2433",
  cursor: "#1c2433",
  cursorAccent: "#ffffff",
  selectionBackground: "#cfdcf5",
  black: "#1c2433",
  red: "#c0292b",
  green: "#1d7a45",
  yellow: "#8a5a00",
  blue: "#1453c8",
  magenta: "#8a3fb8",
  cyan: "#0e6f86",
  white: "#6b7280",
  brightBlack: "#6b7280",
  brightRed: "#d1393b",
  brightGreen: "#23924f",
  brightYellow: "#9c6a00",
  brightBlue: "#3a72de",
  brightMagenta: "#9b4fcf",
  brightCyan: "#0f8aa8",
  brightWhite: "#8a919c",
};

/**
 * 字。英数字は Cascadia Mono。日本語は Yu Gothic Medium を升 2 つの幅にそろえた別名（care72-cjk、setup で作る）。
 * 揃えないと日本語の 1 字ごとに隙間が空く（升は 0.586em、日本語は 1em）。罫線は canvas の描き手が升いっぱいに描く
 */
export const FONT = '"Cascadia Mono", "care72-cjk", "MS Gothic", "Segoe UI Symbol", monospace';
const CJK_SRC = 'local("Yu Gothic Medium"), local("YuGothic-Medium"), local("Meiryo")';
// 全角の字（xterm が升 2 つにする物）だけ。… や ─ のような幅のあいまいな字は升 1 つなので入れない
const CJK_RANGE = "U+2E80-2FFF, U+3000-303F, U+3040-30FF, U+3100-31FF, U+3200-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF01-FF60, U+FFE0-FFE6";
/** CSS の窓（1.5 倍で 1920×1080）と、端末の外の余白 */
const VIEW = { width: 1280, height: 720, pad: 18 };
const FPS = 30;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

/** 「12.5」「@印」「@印+0.5」を秒に */
function when(expr, marks) {
  const m = /^(@([^+]+?)|(-?\d+(?:\.\d+)?))([+-]\d+(?:\.\d+)?)?$/.exec(expr.trim());
  if (!m) throw new Error(`秒が読めない: ${expr}`);
  let t;
  if (m[2]) {
    const hit = marks.find((x) => x.label === m[2]);
    if (!hit) throw new Error(`印が無い: ${m[2]}（ある印: ${marks.map((x) => x.label).join("・")}）`);
    t = hit.t;
  } else t = Number(m[3]);
  return t + (m[4] ? Number(m[4]) : 0);
}

/** 描く間（記録の秒）。from〜to から cut を抜く */
function intervals(from, to, cuts) {
  let parts = [[from, to]];
  for (const [a, b] of cuts.sort((x, y) => x[0] - y[0])) {
    parts = parts.flatMap(([s, e]) => {
      if (b <= s || a >= e) return [[s, e]];
      const keep = [];
      if (a > s) keep.push([s, a]);
      if (b < e) keep.push([b, e]);
      return keep;
    });
  }
  return parts.filter(([s, e]) => e - s > 1e-6);
}

function page(css, xterm, unicode, canvas) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}
html,body{margin:0;width:100%;height:100%;background:${THEME.background};overflow:hidden}
#wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.xterm .xterm-viewport{overflow:hidden !important;background:${THEME.background} !important}
</style></head><body><div id="wrap"><div id="term"></div></div>
<script>${xterm}</script><script>${unicode}</script><script>${canvas}</script>
<script>
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
window.setup = async (o) => {
  const term = new Terminal({
    cols: o.cols, rows: o.rows, fontFamily: '"Cascadia Mono", monospace', fontSize: 40, lineHeight: o.lineHeight,
    theme: o.theme, cursorBlink: false, cursorStyle: "block", cursorInactiveStyle: "block",
    allowProposedApi: true, scrollback: 20000, disableStdin: true, drawBoldTextInBrightColors: false, customGlyphs: true,
  });
  term.loadAddon(new Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = "11";
  term.open(document.getElementById("term"));
  term.loadAddon(new CanvasAddon.CanvasAddon());
  await document.fonts.ready;
  const dims = () => term._core._renderService.dimensions.css.cell;
  // 字の大きさを変えたあと、升の大きさが落ち着くまで待つ
  const settle = async () => {
    let prev = "";
    for (let i = 0; i < 40; i++) {
      await raf2();
      const c = dims();
      const key = c.width + "x" + c.height;
      if (key === prev && c.width > 0) return { width: c.width, height: c.height };
      prev = key;
    }
    const c = dims();
    return { width: c.width, height: c.height };
  };
  // 字の大きさを、cols×rows が窓（余白の内側）に入る一番大きい物にする
  let c = await settle();
  let size = Math.floor(Math.min(o.maxW / ((o.cols * c.width) / 40), o.maxH / ((o.rows * c.height) / 40)) * 4) / 4 + 0.5;
  for (; size > 8; size -= 0.25) {
    term.options.fontSize = size;
    c = await settle();
    if (c.width * o.cols <= o.maxW && c.height * o.rows <= o.maxH) break;
  }
  // 日本語の字を升 2 つの幅に（size-adjust で Yu Gothic を升の幅の 2 倍に大きくした別名）
  const factor = (2 * c.width) / size;
  const face = new FontFace("care72-cjk", o.cjkSrc, { sizeAdjust: (factor * 100).toFixed(3) + "%", unicodeRange: o.cjkRange });
  await face.load();
  document.fonts.add(face);
  term.options.fontFamily = o.font;
  c = await settle();
  term.focus();
  window.term = term;
  return { fontSize: size, cellW: c.width, cellH: c.height, cjk: factor };
};
window.feed = async (s) => {
  await new Promise((r) => window.term.write(s, r));
  await raf2();
};
window.visible = () => {
  const b = window.term.buffer.active;
  const out = [];
  for (let i = b.viewportY; i < b.viewportY + window.term.rows; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
  return out;
};
</script></body></html>`;
}

export async function render({ cast, out, name, from, to, cut = "", lineHeight = 1.12 }) {
  const { header, events } = loadCast(cast);
  const marks = events.filter(([, k]) => k === "m").map(([t, , label]) => ({ t, label }));
  const output = events.filter(([, k]) => k === "o");
  const last = events.length ? events.at(-1)[0] : 0;
  const start = from ? when(from, marks) : 0;
  const end = to ? when(to, marks) : last;
  // 切る間。終わりが始まりより前になる物（短い答えで印が近いとき）は切らない
  const cuts = cut
    ? cut
        .split(",")
        .map((r) => {
          const [a, b] = r.split("..");
          return [when(a, marks), when(b, marks)];
        })
        .filter(([a, b]) => b > a)
    : [];
  const parts = intervals(start, end, cuts);
  if (parts.length === 0) throw new Error("描く間が無い（--from・--to・--cut を見直す）");

  const mod = (p) => readFileSync(join(HERE, "node_modules", p), "utf8");
  const html = page(
    mod("@xterm/xterm/css/xterm.css"),
    mod("@xterm/xterm/lib/xterm.js"),
    mod("@xterm/addon-unicode11/lib/addon-unicode11.js"),
    mod("@xterm/addon-canvas/lib/addon-canvas.js"),
  );

  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (/^\d{5}\.jpg$/.test(f) || f === "markers.json") rmSync(join(out, f));

  const browser = await launch();
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1.5 });
    await tab.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await tab.setContent(html, { waitUntil: "load" });
    const fit = await tab.evaluate(
      (o) => window.setup(o),
      {
        cols: header.width,
        rows: header.height,
        font: FONT,
        cjkSrc: CJK_SRC,
        cjkRange: CJK_RANGE,
        lineHeight,
        theme: THEME,
        maxW: VIEW.width - VIEW.pad * 2,
        maxH: VIEW.height - VIEW.pad * 2,
      },
    );
    console.log(
      `${header.width}×${header.height}、字 ${fit.fontSize}px（1.5 倍で ${(fit.fontSize * 1.5).toFixed(1)}px、${((fit.fontSize * 72) / 96).toFixed(1)}pt）、升 ${fit.cellW.toFixed(2)}×${fit.cellH.toFixed(2)}、日本語 ${(fit.cjk * 100).toFixed(1)}%`,
    );

    let j = 0; // 次に流す出力
    const feedUntil = async (t) => {
      let s = "";
      while (j < output.length && output[j][0] <= t) s += output[j++][2];
      if (s) await tab.evaluate((x) => window.feed(x), s);
      return s.length > 0;
    };

    let n = 0;
    let prev = null;
    let leaked = null;
    const outMarks = [];
    let offset = 0; // 連番の中の秒
    await feedUntil(parts[0][0]);
    for (const [a, b] of parts) {
      for (const m of marks) if (m.t >= a && m.t < b) outMarks.push({ label: m.label, at: Math.round((offset + m.t - a) * 10) / 10 });
      const count = Math.round((b - a) * FPS);
      for (let k = 0; k < count; k++) {
        const changed = await feedUntil(a + k / FPS);
        n++;
        const file = join(out, `${String(n).padStart(5, "0")}.jpg`);
        if (!changed && prev) {
          try {
            linkSync(prev, file);
          } catch {
            copyFileSync(prev, file);
          }
        } else {
          await tab.screenshot({ path: file, type: "jpeg", quality: 90 });
          prev = file;
          // 映っている文字に、ユーザー名の入った道・ログインの名前・メールの形が無いか
          const bad = privateLines(await tab.evaluate(() => window.visible()));
          if (bad.length && !leaked) leaked = { frame: n, at: (n - 1) / FPS, lines: bad };
        }
      }
      offset += count / FPS;
    }
    if (leaked) {
      for (const f of readdirSync(out)) if (/^\d{5}\.jpg$/.test(f)) rmSync(join(out, f));
      const user = (() => {
        try {
          return userInfo().username;
        } catch {
          return "";
        }
      })();
      const mask = (t) => (user ? t.split(user).join("<名前>") : t).trim().slice(0, 90);
      throw new Error(
        `映してはいけない物が ${leaked.at.toFixed(2)} 秒（${leaked.frame} コマ目）の画面にある。連番は消した（記録 ${cast} は残す）。` +
          `text.mjs で見て、--from・--cut で避けて描き直す:\n` +
          leaked.lines.map((l) => `  ${l.row} 行目: ${mask(l.text)}`).join("\n"),
      );
    }
    const markers = {
      name: name ?? header.title ?? "",
      seconds: Math.round((n / FPS) * 100) / 100,
      marks: outMarks,
      taps: [],
      // 記録のどこを描いたか（描き直すとき用）。秒は term.cast の始めから
      source: { cast: relative(VIDEO, resolve(cast)).split("\\").join("/"), parts: parts.map(([s, e]) => [Math.round(s * 100) / 100, Math.round(e * 100) / 100]) },
    };
    writeFileSync(join(out, "markers.json"), JSON.stringify(markers, null, 2) + "\n");
    console.log(`${markers.name}: ${n} 枚（${(n / FPS).toFixed(1)} 秒）→ ${out}`);
    return markers;
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/term/render.mjs")) {
  const args = parseArgs(process.argv.slice(2));
  const [cast, out] = args._;
  if (!cast || !out || !existsSync(cast)) {
    console.error("使い方: node video/scripts/term/render.mjs <term.cast> <連番のフォルダ> [--name R20] [--from 秒|@印] [--to 秒|@印] [--cut 始..終,…]");
    process.exit(2);
  }
  await render({ cast, out: resolve(out), name: args.name, from: args.from, to: args.to, cut: args.cut });
}
