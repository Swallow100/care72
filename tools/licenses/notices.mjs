// THIRD_PARTY_NOTICES.md の依存の表を、package-lock.json と node_modules の各 package.json・LICENSE から作り直す。
// 表は <!-- deps:start --> と <!-- deps:end --> の間だけ書き換える（書体・地図・データ・動画の節は手で書く）。
// 使い方: npm ci のあとに `npm run docs:notices`。入るのはこの端末に入った物（OS ごとの任意の依存は端末で変わる）。

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(ROOT, "THIRD_PARTY_NOTICES.md");

/** LICENSE に著作権の行が無く、配った物の頭に書いてある物 */
const HOLDER_FROM_SOURCE = {
  "@google/genai": "Copyright 2025 Google LLC",
  "pdfjs-dist": "Copyright 2024 Mozilla Foundation",
};

function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(" OR ");
  return "";
}

const COPYRIGHT_LINE =
  /^(copyright\s*(\(c\)|©)?\s*(\d{4}|\(c\)|©)|copyright\s+(\(c\)|©)|copyright\s+[A-Z][\w.,&' -]+(inc|llc|ltd|corporation|corp|authors|contributors)\b|\(c\)\s*\d{4}|©\s*\d{4})/i;
const PLACEHOLDER = /copyright notice|<year>|\[yyyy\]|\{yyyy\}|\[year\]|\[name of copyright owner\]/i;

function repoOf(pkg) {
  const r = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const m = r && /github\.com[/:]([^/]+\/[^/.#]+)/.exec(r);
  return m ? `github.com/${m[1]}` : "";
}

function holderOf(dir, name, pkg) {
  if (HOLDER_FROM_SOURCE[name]) return HOLDER_FROM_SOURCE[name];
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f));
  } catch {}
  for (const f of files) {
    let text = "";
    try {
      text = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    const hits = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => COPYRIGHT_LINE.test(l) && !PLACEHOLDER.test(l));
    if (hits.length) return hits.slice(0, 2).join(" / ");
  }
  const a = pkg.author;
  if (typeof a === "string" && a.trim()) return a.replace(/\s*<[^>]*>/g, "").replace(/\s*\([^)]*\)/g, "").trim();
  if (a?.name) return a.name;
  const repo = repoOf(pkg);
  return repo ? `（記載なし。${repo}）` : "（記載なし）";
}

const cell = (s) => String(s).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();

function collect() {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const pj = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const direct = new Set([...Object.keys(pj.dependencies ?? {}), ...Object.keys(pj.devDependencies ?? {})]);
  const rows = new Map();
  for (const [path, meta] of Object.entries(lock.packages)) {
    if (!path.startsWith("node_modules/") || meta.link) continue;
    const dir = join(ROOT, path);
    const file = join(dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const row = {
      name,
      version: pkg.version,
      license: licenseOf(pkg) || meta.license || "（記載なし）",
      holder: holderOf(dir, name, pkg),
      dev: Boolean(meta.dev),
      direct: direct.has(name) && (path === `node_modules/${name}`),
    };
    rows.set(`${row.dev ? "d" : "p"}:${name}@${row.version}`, row);
  }
  const sort = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
  const all = [...rows.values()];
  return { prod: all.filter((r) => !r.dev).sort(sort), dev: all.filter((r) => r.dev).sort(sort) };
}

function table(rows) {
  const out = ["| 名前 | 版 | ライセンス | 著作権者 |", "| --- | --- | --- | --- |"];
  for (const r of rows) out.push(`| ${cell(r.direct ? `**${r.name}**` : r.name)} | ${cell(r.version)} | ${cell(r.license)} | ${cell(r.holder)} |`);
  return out.join("\n");
}

function counts(rows) {
  const c = new Map();
  for (const r of rows) c.set(r.license, (c.get(r.license) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join("・");
}

export function render() {
  const { prod, dev } = collect();
  return [
    "<!-- deps:start -->",
    "<!-- この間は tools/licenses/notices.mjs が書く。手で直さない -->",
    "",
    `### 配信と build に使う依存（package.json の dependencies とその依存、${prod.length} 件）`,
    "",
    `内訳: ${counts(prod)}。太字は package.json に直接書いた物。`,
    "",
    table(prod),
    "",
    `### 開発の道具（devDependencies だけが使う物、${dev.length} 件）`,
    "",
    `内訳: ${counts(dev)}。配信の Worker には入らない（tailwindcss が作った CSS だけは配信に入る）。`,
    "",
    table(dev),
    "",
    "<!-- deps:end -->",
  ].join("\n");
}

const text = readFileSync(FILE, "utf8");
const start = text.indexOf("<!-- deps:start -->");
const end = text.indexOf("<!-- deps:end -->");
if (start < 0 || end < 0) throw new Error("THIRD_PARTY_NOTICES.md に <!-- deps:start --> と <!-- deps:end --> が無い");
writeFileSync(FILE, text.slice(0, start) + render() + text.slice(end + "<!-- deps:end -->".length));
console.log("書いた: THIRD_PARTY_NOTICES.md");
