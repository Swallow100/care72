// 疑うファイルの候補（docs/tasks/T156.md）。画面の道から app の page.tsx を、押した物の名前・分かりにくい言葉から
// その字を持つ言葉の表（lib の labels.ts）と部品（components）を探す。repo の中だけを読む。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function walk(dir: string, pick: (f: string) => boolean, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, pick, out);
    else if (pick(p)) out.push(p);
  }
  return out;
}

const rel = (root: string, p: string) => relative(root, p).split(sep).join("/");

export type SuspectIndex = {
  /** 道 → app の page.tsx */
  route(path: string): string | null;
  /** 字 → その字を持つファイル（言葉の表を先に、多くて limit） */
  word(text: string, limit?: number): string[];
  /** 道と名前から、候補をまとめて（重なりを除く） */
  of(path: string, names: ReadonlyArray<string | null | undefined>, limit?: number): string[];
};

export function suspectIndex(root: string = REPO): SuspectIndex {
  const pages = walk(join(root, "app"), (f) => f.endsWith(`${sep}page.tsx`)).map((f) => {
    const r = rel(root, f);
    const segs = r.replace(/^app\//, "").replace(/\/?page\.tsx$/, "");
    const pattern = segs === "" ? "^/$" : `^/${segs.split("/").map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}/?$`;
    // 固定の段が多い道を先に（/people/new が /people/[id] より先）
    const fixed = segs.split("/").filter((s) => s && !s.startsWith("[")).length;
    return { file: r, re: new RegExp(pattern), fixed };
  });
  pages.sort((a, b) => b.fixed - a.fixed);
  const texts = [
    ...walk(join(root, "lib"), (f) => /labels\.ts$/.test(f)),
    ...walk(join(root, "components"), (f) => f.endsWith(".tsx")),
    ...walk(join(root, "app"), (f) => f.endsWith(".tsx")),
  ].map((f) => {
    let body = "";
    try {
      body = readFileSync(f, "utf8");
    } catch {
      body = "";
    }
    return { file: rel(root, f), body, label: /labels\.ts$/.test(f) };
  });
  const route = (path: string): string | null => {
    const p = path.split(/[?#]/)[0] || "/";
    return pages.find((x) => x.re.test(p))?.file ?? null;
  };
  const word = (text: string, limit = 3): string[] => {
    const w = text.trim();
    if (w.length < 2) return [];
    const quoted = [`"${w}"`, `'${w}'`, `>${w}<`, `\`${w}\``];
    const hits = texts.filter((t) => quoted.some((q) => t.body.includes(q)));
    hits.sort((a, b) => Number(b.label) - Number(a.label));
    return hits.slice(0, limit).map((h) => h.file);
  };
  const of = (path: string, names: ReadonlyArray<string | null | undefined>, limit = 6): string[] => {
    const out: string[] = [];
    const r = route(path);
    if (r) out.push(r);
    for (const n of names) {
      if (!n) continue;
      // 名前の頭の語（「伊藤 フミ 担当」→「担当」も見る）
      for (const w of [n, ...n.split(/\s+/).slice(-1)]) for (const f of word(w)) if (!out.includes(f)) out.push(f);
    }
    return out.slice(0, limit);
  };
  return { route, word, of };
}
