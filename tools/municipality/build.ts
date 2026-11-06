// 全国の市区町村の表（lib/municipality/*-data.ts）を、公的な表から作る（T154）。
//
//   node tools/municipality/build.ts --dir <元のファイルを置くフォルダ> [--fetch]
//
// 元（取りに行くのは公式のドメインだけ。--fetch のときだけ取る。元のファイルはリポジトリに入れない）:
// - 総務省「全国地方公共団体コード」の Excel（団体コード 6 桁・都道府県名・市区町村名・カナ。1 枚目は団体、2 枚目は政令指定都市の区）
// - 気象庁「予報区等の表」area.json（警報・注意報の市町村等〔class20〕と、まとめた地域〔class15〕・一次細分区域〔class10〕・府県予報区）
// - 気象庁「予報区等 GIS データ」の 市町村等（気象警報等）の shapefile（区域の形。代表の点と範囲を作るだけに使い、形そのものは表に入れない）
// 出典・取った日・利用の条件・行数は docs/sources/municipalities.md。作った表は lib/municipality/names-data.ts（画面でも読む）と
// geo-data.ts（サーバーだけ）。
//
// 結び方: 気象庁の市町村等のコード（7 桁）の頭の 5 桁 = 団体コードの頭の 5 桁（検査数字を除いた物）。分かれた市（浜松市南部・北部）は
// 1 つの団体に 2 つ。政令指定都市の市の行は、市そのもののコードが無ければ区のコードを全部持つ（区ごとに発表する市）。
// 区の行は、区のコードが無ければ市のコードを持つ（市で 1 つに発表する市）。
// 代表の点: 団体の区域の主な面（一番大きな面の 1 割より大きな面。小さな島は外す）の重心。面の外に出たら、重心の緯度で一番広く面を横切る所の真ん中。
// 範囲: 主な面の南西・北東の角。

import { inflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "../../lib/ooxml/zip.ts";
import { descendants, kid, kids, parseXml, textOf, attr, type XNode } from "../../lib/ooxml/xml.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const SOURCES = {
  soumu: { url: "https://www.soumu.go.jp/main_content/000925835.xlsx", file: "soumu-code.xlsx" },
  area: { url: "https://www.jma.go.jp/bosai/common/const/area.json", file: "area.json" },
  gis: { url: "https://www.data.jma.go.jp/developer/gis/20260226_AreaInformationCity_weather_GIS.zip", file: "jma-city-gis.zip" },
} as const;

const OFFICIAL = /^https:\/\/(www\.soumu\.go\.jp|www\.jma\.go\.jp|www\.data\.jma\.go\.jp)\//;

// ---------- 取る ----------

async function fetchAll(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const s of Object.values(SOURCES)) {
    if (!OFFICIAL.test(s.url)) throw new Error(`公式のドメインでない: ${s.url}`);
    const path = join(dir, s.file);
    if (existsSync(path)) continue;
    const res = await fetch(s.url, { redirect: "error", headers: { "user-agent": "care72-municipality-table" } });
    if (!res.ok) throw new Error(`${s.url}: ${res.status}`);
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
    console.log(`取った ${s.url}`);
  }
}

// ---------- 総務省の Excel ----------

type SoumuRow = { code: string; pref: string; name: string; kana: string; ward: boolean };

/** si の字（ふりがなの rPh は外す） */
function siText(si: XNode): string {
  const direct = kid(si, "t");
  if (direct) return textOf(direct);
  return kids(si, "r")
    .map((r) => textOf(kid(r, "t")))
    .join("");
}

const toHiragana = (s: string) => s.normalize("NFKC").replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

async function readSoumu(path: string): Promise<SoumuRow[]> {
  const zip = readZip(new Uint8Array(readFileSync(path)));
  const sst = parseXml((await zip.text("xl/sharedStrings.xml")) ?? "<sst/>");
  const strs = descendants(sst, "si").map(siText);
  const sheet = async (n: number) => {
    const x = await zip.text(`xl/worksheets/sheet${n}.xml`);
    if (!x) throw new Error(`sheet${n} が無い`);
    return descendants(parseXml(x), "row").map((r) =>
      descendants(r, "c").map((c) => {
        const v = textOf(kid(c, "v"));
        return attr(c, "t") === "s" ? (strs[Number(v)] ?? "") : attr(c, "t") === "inlineStr" ? textOf(kid(c, "is")) : v;
      }),
    );
  };
  const out = new Map<string, SoumuRow>();
  const take = (cells: string[], ward: boolean) => {
    const [code, pref, name, , kana] = cells.map((c) => (c ?? "").trim());
    if (!/^\d{6}$/.test(code) || !name) return; // 見出しと都道府県の行（市区町村名が空）
    if (out.has(code)) return; // 2 枚目の政令指定都市そのものの行は 1 枚目と同じ
    out.set(code, { code, pref, name: name.normalize("NFC"), kana: toHiragana(kana ?? ""), ward });
  };
  for (const r of await sheet(1)) take(r, false);
  for (const r of await sheet(2)) take(r, true);
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

// ---------- 気象庁の area.json ----------

type AreaJson = {
  offices: Record<string, { name: string }>;
  class10s: Record<string, { name: string; parent: string }>;
  class15s: Record<string, { name: string; parent: string }>;
  class20s: Record<string, { name: string; kana?: string; parent: string }>;
};

// ---------- zip（大きな GIS の zip。lib/ooxml/zip.ts は 64 MB までなので、ここで central directory を読む） ----------

function unzipEntries(bytes: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip の終わりが無い");
  const count = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  const td = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) throw new Error("zip の目録が壊れている");
    const method = bytes.readUInt16LE(p + 10);
    const csize = bytes.readUInt32LE(p + 20);
    const nlen = bytes.readUInt16LE(p + 28);
    const xlen = bytes.readUInt16LE(p + 30);
    const clen = bytes.readUInt16LE(p + 32);
    const local = bytes.readUInt32LE(p + 42);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    const lnlen = bytes.readUInt16LE(local + 26);
    const lxlen = bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    out.set(name, method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : Buffer.alloc(0));
  }
  return out;
}

// ---------- shapefile ----------

type Ring = { pts: Float64Array; area: number; cx: number; cy: number; s: number; w: number; n: number; e: number };
type Shape = { code: string; rings: Ring[] };

function ringOf(pts: Float64Array): Ring {
  let a = 0;
  let cx = 0;
  let cy = 0;
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  const k = pts.length / 2;
  for (let i = 0; i < k; i++) {
    const x0 = pts[2 * i];
    const y0 = pts[2 * i + 1];
    const x1 = pts[2 * ((i + 1) % k)];
    const y1 = pts[2 * ((i + 1) % k) + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
    if (y0 < s) s = y0;
    if (y0 > n) n = y0;
    if (x0 < w) w = x0;
    if (x0 > e) e = x0;
  }
  a /= 2;
  return { pts, area: a, cx: a === 0 ? pts[0] : cx / (6 * a), cy: a === 0 ? pts[1] : cy / (6 * a), s, w, n, e };
}

function readShapes(shp: Buffer, dbf: Buffer): Shape[] {
  const n = dbf.readUInt32LE(4);
  const hl = dbf.readUInt16LE(8);
  const rl = dbf.readUInt16LE(10);
  const fields: Array<{ name: string; len: number }> = [];
  for (let o = 32; dbf[o] !== 0x0d; o += 32) fields.push({ name: dbf.subarray(o, o + 11).toString("latin1").replace(/\0.*$/, ""), len: dbf[o + 16] });
  const codeAt = fields.findIndex((f) => f.name === "regioncode");
  if (codeAt < 0) throw new Error("dbf に regioncode が無い");
  const off = fields.slice(0, codeAt).reduce((s, f) => s + f.len, 1);
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = hl + i * rl + off;
    codes.push(dbf.subarray(at, at + fields[codeAt].len).toString("utf8").trim());
  }
  const shapes: Shape[] = [];
  let p = 100;
  let i = 0;
  while (p + 8 <= shp.length) {
    const len = shp.readInt32BE(p + 4) * 2;
    const c = p + 8;
    const type = shp.readInt32LE(c);
    if (type === 5 || type === 15 || type === 25) {
      const parts = shp.readInt32LE(c + 36);
      const points = shp.readInt32LE(c + 40);
      const starts: number[] = [];
      for (let j = 0; j < parts; j++) starts.push(shp.readInt32LE(c + 44 + 4 * j));
      starts.push(points);
      const base = c + 44 + 4 * parts;
      const rings: Ring[] = [];
      for (let j = 0; j < parts; j++) {
        const pts = new Float64Array((starts[j + 1] - starts[j]) * 2);
        for (let q = 0; q < pts.length; q++) pts[q] = shp.readDoubleLE(base + 8 * (2 * starts[j]) + 8 * q);
        if (pts.length >= 6) rings.push(ringOf(pts));
      }
      if (codes[i]) shapes.push({ code: codes[i], rings });
    }
    p = c + len;
    i++;
  }
  return shapes;
}

/** 点が面の中か（偶奇の決まり。穴も外になる） */
function inside(x: number, y: number, rings: readonly Ring[]): boolean {
  let hit = false;
  for (const r of rings) {
    const k = r.pts.length / 2;
    for (let i = 0, j = k - 1; i < k; j = i++) {
      const xi = r.pts[2 * i];
      const yi = r.pts[2 * i + 1];
      const xj = r.pts[2 * j];
      const yj = r.pts[2 * j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** 緯度 y で面を横切る区間のうち一番広い所の真ん中（無ければ null） */
function widestAt(y: number, rings: readonly Ring[]): number | null {
  const xs: number[] = [];
  for (const r of rings) {
    const k = r.pts.length / 2;
    for (let i = 0, j = k - 1; i < k; j = i++) {
      const yi = r.pts[2 * i + 1];
      const yj = r.pts[2 * j + 1];
      if (yi > y !== yj > y) xs.push(((r.pts[2 * j] - r.pts[2 * i]) * (y - yi)) / (yj - yi) + r.pts[2 * i]);
    }
  }
  xs.sort((a, b) => a - b);
  let best: number | null = null;
  let width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > width) {
      width = xs[i + 1] - xs[i];
      best = (xs[i] + xs[i + 1]) / 2;
    }
  }
  return best;
}

export type Geo = { lat: number; lng: number; s: number; w: number; n: number; e: number };

/** 面の集まりから代表の点と範囲（主な面: 一番大きな面の 1 割より大きな面） */
export function geoOf(rings: readonly Ring[]): Geo | null {
  if (rings.length === 0) return null;
  // 外の輪の向き（一番大きな輪の符号）。穴は逆の向き
  const big = rings.reduce((m, r) => (Math.abs(r.area) > Math.abs(m.area) ? r : m));
  const sign = Math.sign(big.area);
  const outer = rings.filter((r) => Math.sign(r.area) === sign);
  const main = outer.filter((r) => Math.abs(r.area) >= Math.abs(big.area) * 0.1);
  let a = 0;
  let x = 0;
  let y = 0;
  for (const r of main) {
    a += Math.abs(r.area);
    x += r.cx * Math.abs(r.area);
    y += r.cy * Math.abs(r.area);
  }
  x /= a;
  y /= a;
  if (!inside(x, y, rings)) {
    const mid = widestAt(y, rings);
    if (mid !== null) x = mid;
    else {
      y = big.cy;
      x = widestAt(y, rings) ?? big.cx;
    }
  }
  return {
    lat: y,
    lng: x,
    s: Math.min(...main.map((r) => r.s)),
    w: Math.min(...main.map((r) => r.w)),
    n: Math.max(...main.map((r) => r.n)),
    e: Math.max(...main.map((r) => r.e)),
  };
}

// ---------- 組み立て ----------

export type Built = {
  code: string;
  pref: string;
  name: string;
  kana: string;
  /** 政令指定都市の区の、市の団体コード（ほかは ""） */
  parent: string;
  class20s: string[];
  class15s: string[];
  class10s: string[];
  offices: string[];
  geo: Geo | null;
};

export function build(soumu: readonly SoumuRow[], area: AreaJson, shapes: readonly Shape[]): { rows: Built[]; report: string[] } {
  const report: string[] = [];
  const byStem = new Map<string, string[]>();
  for (const c of Object.keys(area.class20s).sort()) {
    const stem = c.slice(0, 5);
    byStem.set(stem, [...(byStem.get(stem) ?? []), c]);
  }
  const ringsOf = new Map<string, Ring[]>();
  for (const s of shapes) ringsOf.set(s.code, [...(ringsOf.get(s.code) ?? []), ...s.rings]);

  // 政令指定都市の区の親: 2 枚目で区の前にある市（名前が市の名前で始まる）
  const cities = soumu.filter((r) => !r.ward);
  const parentOf = (w: SoumuRow) => cities.find((c) => c.pref === w.pref && w.name.startsWith(c.name) && w.name !== c.name && c.code.slice(0, 3) === w.code.slice(0, 3))?.code ?? "";

  const rows: Built[] = [];
  for (const r of soumu) {
    const parent = r.ward ? parentOf(r) : "";
    let class20s = byStem.get(r.code.slice(0, 5)) ?? [];
    if (class20s.length === 0 && parent) class20s = byStem.get(parent.slice(0, 5)) ?? [];
    if (class20s.length === 0 && !r.ward) {
      // 区ごとに発表する政令指定都市: 区の行のコードを全部
      const wards = soumu.filter((w) => w.ward && parentOf(w) === r.code);
      class20s = wards.flatMap((w) => byStem.get(w.code.slice(0, 5)) ?? []);
    }
    const uniq = (xs: string[]) => [...new Set(xs)];
    const class15s = uniq(class20s.map((c) => area.class20s[c].parent));
    const class10s = uniq(class15s.map((c) => area.class15s[c]?.parent ?? "").filter(Boolean));
    const offices = uniq(class10s.map((c) => area.class10s[c]?.parent ?? "").filter(Boolean));
    const geo = geoOf(class20s.flatMap((c) => ringsOf.get(c) ?? []));
    if (class20s.length === 0) report.push(`気象庁の市町村等なし: ${r.code} ${r.pref}${r.name}`);
    else if (!geo) report.push(`形なし: ${r.code} ${r.pref}${r.name}`);
    rows.push({ code: r.code, pref: r.pref, name: r.name, kana: r.kana, parent, class20s, class15s, class10s, offices, geo });
  }
  const used = new Set(rows.flatMap((r) => r.class20s));
  for (const c of Object.keys(area.class20s)) if (!used.has(c)) report.push(`団体に当たらない市町村等: ${c} ${area.class20s[c].name}`);
  return { rows, report };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function render(rows: readonly Built[], date: string): { names: string; geo: string } {
  const head = (what: string) =>
    [
      `// 生成物（tools/municipality/build.ts が作る。手で直さない）。${what}`,
      "// 出典: 総務省「全国地方公共団体コード」（令和6年1月1日現在）、気象庁「予報区等の表」（area.json）・「予報区等GISデータ」（市町村等〔気象警報等〕）を加工して作成。",
      `// 取った日: ${date}。条件と行数は docs/sources/municipalities.md。`,
      "",
    ].join("\n");
  const esc = (s: string) => s.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
  const names = rows.map((r) => [r.code, r.name, r.kana, r.parent].join("\t")).join("\n");
  const geo = rows
    .filter((r) => r.geo)
    .map((r) => {
      const g = r.geo!;
      return [r.code, r4(g.lat), r4(g.lng), r4(g.s), r4(g.w), r4(g.n), r4(g.e), r.class20s.join(","), r.class15s.join(","), r.class10s.join(","), r.offices.join(",")].join("\t");
    })
    .join("\n");
  return {
    names: `${head("団体コード・市区町村名・よみ・政令指定都市の区の市（画面でも読む）")}export const MUNICIPALITY_NAMES_TSV = \`${esc(names)}\`;\n\nexport const MUNICIPALITY_SOURCE_DATE = "${date}";\n`,
    geo: `${head("団体コード・代表の緯度経度・範囲（南・西・北・東）・気象庁の市町村等・まとめた地域・一次細分区域・府県予報区（サーバーだけ）")}export const MUNICIPALITY_GEO_TSV = \`${esc(geo)}\`;\n`,
  };
}

// ---------- 走らせる ----------

async function main() {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const dir = arg("--dir");
  if (!dir) throw new Error("--dir <元のファイルのフォルダ> が要る");
  if (process.argv.includes("--fetch")) await fetchAll(dir);
  const soumu = await readSoumu(join(dir, SOURCES.soumu.file));
  const area = JSON.parse(readFileSync(join(dir, SOURCES.area.file), "utf8")) as AreaJson;
  const files = unzipEntries(readFileSync(join(dir, SOURCES.gis.file)), (n) => /\.(shp|dbf)$/i.test(n));
  const shp = [...files].find(([n]) => /\.shp$/i.test(n))?.[1];
  const dbf = [...files].find(([n]) => /\.dbf$/i.test(n))?.[1];
  if (!shp || !dbf) throw new Error("GIS の zip に shp・dbf が無い");
  const shapes = readShapes(shp, dbf);
  const { rows, report } = build(soumu, area, shapes);
  const date = arg("--date") ?? new Date().toISOString().slice(0, 10);
  const out = render(rows, date);
  writeFileSync(join(ROOT, "lib/municipality/names-data.ts"), out.names);
  writeFileSync(join(ROOT, "lib/municipality/geo-data.ts"), out.geo);
  console.log(`団体 ${rows.length}（区 ${rows.filter((r) => r.parent).length}）、形 ${rows.filter((r) => r.geo).length}、気象庁の市町村等 ${Object.keys(area.class20s).length}`);
  for (const l of report) console.log(l);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
