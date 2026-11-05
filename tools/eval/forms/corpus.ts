// 評価の台（T107）の様式の置き場（リポジトリの外、既定 C:\Users\choco\dev\care72-eval-corpus\forms\）。読むだけ。
// 置き場の manifest.json（files: 市町村・フォルダ・様式の名前・役割〔様式本体・記載例・手引き〕・URL・ファイル）があればその並び、
// 無ければ市町村のフォルダの中のファイル（市町村のフォルダの manifest.json も読む）。
// 様式として読むのは役割が「様式本体」の物だけ（記載例は値が書いてあり、手引きは様式でない）。ほかは数だけ残す。
// 原本の中身は台の外に出さない（回のフォルダの埋めた紙と、送った画像だけ。どちらもリポジトリの外）。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { GoldForm } from "./gold.ts";

export type CorpusFile = {
  /** 台の中の id（フォルダとファイル名から。英数字と - だけ） */
  id: string;
  city: string;
  dir: string;
  path: string;
  fileName: string;
  formName: string | null;
  role: string | null;
  url: string | null;
  pages: number | null;
  sha256: string;
  bytes: number;
};

const str = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
};

/** manifest.json の行（キーの名前の揺れを受ける） */
function entriesOf(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["files", "forms", "items", "entries", "様式"]) if (Array.isArray(o[k])) return entriesOf(o[k]);
  }
  return [];
}

const idOf = (dir: string, fileName: string) => `${dir}-${basename(fileName, extname(fileName))}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);

function fileOf(root: string, e: Record<string, unknown>, fallbackDir: string): CorpusFile | null {
  const rel = str(e, ["file", "fileName", "filename", "path", "ファイル名", "name"]);
  if (!rel) return null;
  const dir = str(e, ["dir", "folder"]) ?? fallbackDir;
  // file は置き場の親からの道（forms/<dir>/<名前>）のことがある。名前だけを使い、フォルダは dir
  const fileName = basename(rel);
  const path = join(root, dir, fileName);
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return {
    id: idOf(dir, fileName),
    city: str(e, ["municipality", "city", "市町村"]) ?? dir,
    dir,
    path,
    fileName,
    formName: str(e, ["formName", "title", "様式"]),
    role: str(e, ["role", "役割"]),
    url: str(e, ["url", "URL", "source"]),
    pages: Number(e.pages ?? e["頁数"] ?? e.pageCount) || null,
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

export type Corpus = {
  /** 様式として読む物（役割が様式本体か、役割の書いていない物） */
  files: CorpusFile[];
  /** 読まない物（記載例・手引きなど）の数 */
  excluded: number;
  cities: string[];
  missing: boolean;
};

/** 様式として読むか（役割の無い物は読む） */
export const isFormBody = (f: Pick<CorpusFile, "role">) => f.role === null || f.role.includes("様式本体") || f.role === "様式";

export function readCorpus(root: string | null): Corpus {
  if (!root || !existsSync(root)) return { files: [], excluded: 0, cities: [], missing: true };
  const all: CorpusFile[] = [];
  const seen = new Set<string>();
  const push = (f: CorpusFile | null) => {
    if (f && !seen.has(f.path)) {
      seen.add(f.path);
      all.push(f);
    }
  };
  for (const e of entriesOf(readJson(join(root, "manifest.json")))) push(fileOf(root, e, ""));
  for (const dir of readdirSync(root).sort()) {
    const full = join(root, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const e of entriesOf(readJson(join(full, "manifest.json")))) push(fileOf(root, e, dir));
    for (const name of readdirSync(full).sort()) {
      if (name === "manifest.json" || !statSync(join(full, name)).isFile()) continue;
      if (seen.has(join(full, name))) continue;
      push(fileOf(root, { file: name }, dir));
    }
  }
  const files = distinctIds(all.filter(isFormBody));
  return { files, excluded: all.length - files.length, cities: [...new Set(all.map((f) => f.city))].sort(), missing: false };
}

/**
 * 同じフォルダに同じ名前の PDF と Excel があると id（フォルダとファイル名の拡張子なし）が重なる（T120。評価の 1 回目の 15）。
 * 重なった物だけ拡張子を足して分ける（重ならない id は前の回と比べられるよう変えない）
 */
export function distinctIds(files: readonly CorpusFile[]): CorpusFile[] {
  const count = new Map<string, number>();
  for (const f of files) count.set(f.id, (count.get(f.id) ?? 0) + 1);
  return files.map((f) => ((count.get(f.id) ?? 0) > 1 ? { ...f, id: `${f.id}-${extname(f.fileName).slice(1).toLowerCase() || "x"}`.slice(0, 64) } : f));
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
