// 書類の読み取りの揺れを数える口（T175）。同じ様式を読んだ 2 つの回（calls.jsonl の読み取りの答えと result.json の見直しの数）を比べる。
// 数と形だけを出す（値は記録に無い。欄の名前は様式に刷ってある字）。API は呼ばない。回のフォルダは読むだけ。
//
//   node tools/eval/forms/drift.ts <回のフォルダ A> <回のフォルダ B> [--forms=suita,kumamoto]
//
// 読み取りの差の分類（docs/progress/t175.md）:
//   名前（欄の名前だけ違う）・項目（当てた項目）・形（shape）・位置（box の重なりが 6 割未満）・選択肢（options）・片方だけの欄（分け方）
// 見直しの差: 要確認（重複・取込漏れ・下限ごと）と置けなかった欄の、様式ごとの差の絶対値の合計。
// `--drift-from=<回>`（tools/eval/forms/cli.ts）で回の結果に drift を残し、点数の表の forms.reviewDrift と守りで見る

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasSlot } from "../../../lib/forms/read-settle.ts";

export type DriftField = { page: number; section: string; label: string; shape: string; item: string | null; options: string[]; box: number[] | null };
export type ReadDiff = { a: number; b: number; same: number; onlyA: number; onlyB: number; label: number; item: number; shape: number; box: number; options: number };

type WirePage = { sections?: Array<{ name: string; fields: Array<Omit<DriftField, "page" | "section">> }> };

/** 記録の返事の字から、読み取りの答え（欄の並び）を様式ごとに頁の順で。選択肢の当ての答え（sections が無い）は飛ばす */
export function fieldsOfCalls(records: ReadonlyArray<{ input: string; stage: string; response?: { text: string } | null }>): Map<string, DriftField[]> {
  const out = new Map<string, DriftField[]>();
  const pages = new Map<string, number>();
  for (const r of records) {
    if (r.stage !== "form_read" || !r.response) continue;
    let read: WirePage;
    try {
      read = JSON.parse(r.response.text.replace(/^(?:\[(?:thinking|redacted_thinking)\])+/, "")) as WirePage;
    } catch {
      continue;
    }
    if (!read.sections) continue;
    const page = (pages.get(r.input) ?? 0) + 1;
    pages.set(r.input, page);
    const list = out.get(r.input) ?? [];
    for (const s of read.sections) for (const f of s.fields) list.push({ ...f, page, section: s.name });
    out.set(r.input, list);
  }
  return out;
}

/** 名前の表記の差を外す（空白・頭の番号・括弧の種類。段の見出しは名前に入れない） */
export function normLabel(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/^[0-9]+[\s.、)]+/, "")
    .replace(/[\s・、。:()「」【】[\]〔〕＊*※]/g, "");
}

const iou = (a: readonly number[] | null, b: readonly number[] | null): number => {
  if (!a || !b) return 0;
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a[2] * a[3] + b[2] * b[3] - i);
};

/** 2 回の読み取りの欄を、同じ頁で名前と位置の近い順に組にして差を数える */
export function diffReads(a: readonly DriftField[], b: readonly DriftField[]): ReadDiff {
  const out: ReadDiff = { a: a.length, b: b.length, same: 0, onlyA: 0, onlyB: 0, label: 0, item: 0, shape: 0, box: 0, options: 0 };
  const used = new Set<number>();
  for (const x of a) {
    let best = -1;
    let bestScore = 0;
    b.forEach((y, i) => {
      if (used.has(i) || y.page !== x.page) return;
      const score = iou(x.box, y.box) + (normLabel(x.label) === normLabel(y.label) ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0 || bestScore < 0.15) {
      out.onlyA += 1;
      continue;
    }
    used.add(best);
    const y = b[best];
    const flags = {
      label: normLabel(x.label) !== normLabel(y.label),
      item: x.item !== y.item,
      shape: x.shape !== y.shape,
      box: iou(x.box, y.box) < 0.6,
      options: x.options.map(normLabel).join("\u0000") !== y.options.map(normLabel).join("\u0000"),
    };
    for (const [k, v] of Object.entries(flags) as Array<[keyof typeof flags, boolean]>) if (v) out[k] += 1;
    if (!Object.values(flags).some(Boolean)) out.same += 1;
  }
  out.onlyB = b.length - used.size;
  return out;
}

/** 見直しの数の要る分だけの回の形 */
export type DriftPaper = {
  form: string;
  look?: { unplaced?: number } | null;
  review?: { rule: { check: number; kinds: Record<string, number> } } | null;
};
export type FormCounts = { check: number; duplicate: number; carried: number; small: number; unplaced: number };

export function countsByForm(papers: readonly DriftPaper[]): Map<string, FormCounts> {
  const out = new Map<string, FormCounts>();
  for (const p of papers) {
    const c = out.get(p.form) ?? { check: 0, duplicate: 0, carried: 0, small: 0, unplaced: 0 };
    c.check += p.review?.rule.check ?? 0;
    c.duplicate += p.review?.rule.kinds.duplicate ?? 0;
    c.carried += p.review?.rule.kinds.carried ?? 0;
    c.small += p.review?.rule.kinds.small ?? 0;
    c.unplaced += p.look?.unplaced ?? 0;
    out.set(p.form, c);
  }
  return out;
}

export type ReviewDrift = FormCounts;

/** 2 回の様式ごとの数の差の絶対値の合計。どちらかの回に無い様式は比べない */
export function reviewDrift(a: readonly DriftPaper[], b: readonly DriftPaper[], forms?: readonly string[]): ReviewDrift {
  const ca = countsByForm(a);
  const cb = countsByForm(b);
  const out: ReviewDrift = { check: 0, duplicate: 0, carried: 0, small: 0, unplaced: 0 };
  for (const [form, x] of ca) {
    const y = cb.get(form);
    if (!y || (forms && !forms.some((f) => form.includes(f)))) continue;
    for (const k of Object.keys(out) as Array<keyof ReviewDrift>) out[k] += Math.abs(x[k] - y[k]);
  }
  return out;
}

/**
 * 回の結果に残す差（T176）。比べる元が数え直しの回なら同じコードの読み取りの差。本物の回と比べるとコードの差が混ざるので sameCode を false にし、
 * 点数の表と守りの数に入れない（評価の 10 回目は、比べる元の取り方で 2,178 と 591 の 2 つの数が並んだ）
 */
export function driftOf(from: string, other: { mode?: string; papers: readonly DriftPaper[] }, papers: readonly DriftPaper[]): { from: string; sameCode: boolean } & ReviewDrift {
  return { from, sameCode: other.mode === "replay", ...reviewDrift(other.papers, papers) };
}

/**
 * 読み取りの答えのうち、同じ頁の □・選ぶ欄と同じ項目を当てた字の欄の数（T176）。slot はそのうち名前に空きのある物。
 * 答えそのものの数で、読み取りの文の効き目はここに出る（後の決まりで外す前。r9 と r10 で 21 と 41）
 */
export function parentItemFields(fields: readonly DriftField[]): { all: number; slot: number } {
  const kids = fields.filter((f) => (f.shape === "text" || f.shape === "lines") && f.item && fields.some((g) => g !== f && g.page === f.page && g.item === f.item && (g.shape === "choice" || g.shape === "check")));
  return { all: kids.length, slot: kids.filter((f) => hasSlot(f.label)).length };
}

export type DriftRun = { calls: Map<string, DriftField[]>; papers: readonly DriftPaper[] };

export function loadRun(dir: string): DriftRun {
  const callsPath = join(dir, "calls.jsonl");
  const calls = existsSync(callsPath)
    ? fieldsOfCalls(
        readFileSync(callsPath, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { input: string; stage: string; response?: { text: string } | null }),
      )
    : new Map<string, DriftField[]>();
  const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")) as { papers: DriftPaper[] };
  return { calls, papers: result.papers };
}

/** 比べた表の md（数と様式の id だけ） */
export function driftMarkdown(a: DriftRun, b: DriftRun, forms?: readonly string[]): string {
  const ca = countsByForm(a.papers);
  const cb = countsByForm(b.papers);
  const ids = [...cb.keys()].filter((id) => ca.has(id) && (!forms || forms.some((f) => id.includes(f))));
  const lines = [
    "| 様式 | 欄 A・B | 同じ | 片方だけ A・B | 名前 | 項目 | 形 | 位置 | 選択肢 | 要確認 A・B | 重複 | 取込漏れ | 下限 | 置けず |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |",
  ];
  for (const id of ids) {
    const d = diffReads(a.calls.get(id) ?? [], b.calls.get(id) ?? []);
    const x = ca.get(id)!;
    const y = cb.get(id)!;
    const pair = (k: keyof FormCounts) => `${x[k]}・${y[k]}`;
    lines.push(`| ${id} | ${d.a}・${d.b} | ${d.same} | ${d.onlyA}・${d.onlyB} | ${d.label} | ${d.item} | ${d.shape} | ${d.box} | ${d.options} | ${pair("check")} | ${pair("duplicate")} | ${pair("carried")} | ${pair("small")} | ${pair("unplaced")} |`);
  }
  const t = reviewDrift(a.papers, b.papers, forms);
  const kids = (r: DriftRun) => ids.map((id) => parentItemFields(r.calls.get(id) ?? [])).reduce((s, x) => ({ all: s.all + x.all, slot: s.slot + x.slot }), { all: 0, slot: 0 });
  const [ka, kb] = [kids(a), kids(b)];
  lines.push("", `差の絶対値の合計: 要確認 ${t.check}・重複 ${t.duplicate}・取込漏れ ${t.carried}・下限 ${t.small}・置けず ${t.unplaced}`);
  lines.push(`親と同じ項目の字の欄（答えの数。A・B）: ${ka.all}・${kb.all}、うち名前に空き ${ka.slot}・${kb.slot}`);
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dirs = args.filter((x) => !x.startsWith("--"));
  const forms = args.find((x) => x.startsWith("--forms="))?.slice("--forms=".length).split(",");
  if (dirs.length !== 2) {
    console.error("使い方: node tools/eval/forms/drift.ts <回のフォルダ A> <回のフォルダ B> [--forms=a,b]");
    process.exit(2);
  }
  console.log(driftMarkdown(loadRun(dirs[0]), loadRun(dirs[1]), forms));
}
