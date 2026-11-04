// 評価の台（T107）の様式の置き場（リポジトリの外、既定 C:\Users\choco\dev\care72-eval-corpus\forms\<市町村>\）。読むだけ。
// 市町村のフォルダに manifest.json（市町村・URL・ファイル名・頁数）があればその並び、無ければフォルダの中のファイル。
// 原本の中身は台の外に出さない（回のフォルダの埋めた紙と、送った画像だけ。どちらもリポジトリの外）。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { GoldForm } from "./gold.ts";

export type CorpusFile = { city: string; path: string; fileName: string; url: string | null; pages: number | null; sha256: string; bytes: number };

const pick = (o: Record<string, unknown>, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== "");

/** manifest.json の 1 行（キーの名前の揺れを受ける） */
function entriesOf(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["files", "forms", "items", "entries", "様式"]) if (Array.isArray(o[k])) return entriesOf(o[k]);
  }
  return [];
}

export function readCorpus(root: string | null): { files: CorpusFile[]; cities: string[]; missing: boolean } {
  if (!root || !existsSync(root)) return { files: [], cities: [], missing: true };
  const files: CorpusFile[] = [];
  const cities: string[] = [];
  for (const city of readdirSync(root).sort()) {
    const dir = join(root, city);
    if (!statSync(dir).isDirectory()) continue;
    cities.push(city);
    const manifestPath = join(dir, "manifest.json");
    let listed: Array<{ fileName: string; url: string | null; pages: number | null; city: string }> = [];
    if (existsSync(manifestPath)) {
      try {
        listed = entriesOf(JSON.parse(readFileSync(manifestPath, "utf8"))).map((e) => ({
          fileName: String(pick(e, ["fileName", "file", "filename", "name", "ファイル名", "path"]) ?? ""),
          url: (pick(e, ["url", "URL", "source"]) as string | undefined) ?? null,
          pages: Number(pick(e, ["pages", "頁数", "pageCount"])) || null,
          city: String(pick(e, ["city", "市町村", "municipality"]) ?? city),
        }));
      } catch {
        listed = [];
      }
    }
    if (listed.length === 0)
      listed = readdirSync(dir)
        .filter((f) => f !== "manifest.json" && statSync(join(dir, f)).isFile())
        .sort()
        .map((fileName) => ({ fileName, url: null, pages: null, city }));
    for (const e of listed) {
      const path = join(dir, basename(e.fileName));
      if (!e.fileName || !existsSync(path)) continue;
      const buf = readFileSync(path);
      files.push({ city: e.city, path, fileName: basename(e.fileName), url: e.url, pages: e.pages, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length });
    }
  }
  return { files, cities, missing: false };
}

/** 置き場のファイルが正解の表の様式か（ハッシュ → URL → ファイル名の順） */
export function goldOf(file: CorpusFile, forms: readonly GoldForm[]): GoldForm | null {
  for (const f of forms) {
    if (f.source.kind !== "corpus") continue;
    if (f.source.sha256 && f.source.sha256 === file.sha256) return f;
  }
  for (const f of forms) {
    if (f.source.kind !== "corpus") continue;
    if (f.source.url && file.url && f.source.url === file.url) return f;
  }
  for (const f of forms) {
    if (f.source.kind !== "corpus") continue;
    if (f.source.fileName && f.source.fileName.test(file.fileName) && (!f.city || f.city === file.city)) return f;
  }
  return null;
}
