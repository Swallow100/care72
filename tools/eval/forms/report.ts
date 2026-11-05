// 評価の台（T107）の数の表。1 回の結果（result.json）から、全体・様式ごと・入れ方ごとの数を出し、前の回との差の md と 1 行の要約、
// 埋めた紙の一覧（filled/index.html）を作る。md には数だけを書く（中身の写し・原本・名前は書かない）。

import { mkdirSync, writeFileSync } from "node:fs";
import { reviewTotals } from "./review.ts";
import { join } from "node:path";
import { INPUT_KIND_LABELS, type InputKind } from "./inputs.ts";
import { PRICES_AS_OF } from "./record.ts";
import type { RunResult } from "./run.ts";
import { addLook, emptyLookScore, type LookScore } from "./look.ts";
import { emptyIntakeScore, emptyPaperScore, emptyReadScore, type IntakeScore, type PaperScore, type ReadScore } from "./score.ts";

const add = <T extends Record<string, number>>(a: T, b: T): T => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] ?? 0)])) as T;

export type Totals = {
  read: ReadScore;
  intake: IntakeScore;
  paper: PaperScore;
  /** 紙の見た目（T133。元の様式の上の紙の全部。正解の表の無い様式も） */
  look: LookScore;
  failures: Record<string, number>;
  inputs: number;
  inputsFailed: number;
  rawOverLimit: number;
  carryLoss: number;
};

export function totals(r: RunResult, filter: { form?: string; kind?: InputKind } = {}): Totals {
  const t: Totals = { read: emptyReadScore(), intake: emptyIntakeScore(), paper: emptyPaperScore(), look: emptyLookScore(), failures: {}, inputs: 0, inputsFailed: 0, rawOverLimit: 0, carryLoss: 0 };
  for (const f of r.forms) if (f.read && (!filter.form || f.id === filter.form) && !filter.kind) t.read = add(t.read, f.read);
  for (const i of r.inputs) {
    if (filter.kind && i.kind !== filter.kind) continue;
    if (filter.form) continue;
    t.inputs += 1;
    if (i.status === "failed") t.inputsFailed += 1;
    if (i.rawOverLimit) t.rawOverLimit += 1;
    t.carryLoss += i.carryLoss;
    if (i.intake) t.intake = add(t.intake, i.intake);
    for (const f of i.failures) t.failures[f] = (t.failures[f] ?? 0) + 1;
  }
  for (const p of r.papers) {
    if (filter.form && p.form !== filter.form) continue;
    if (filter.kind && p.kind !== filter.kind) continue;
    if (p.look) t.look = addLook(t.look, p.look);
    if (!p.score) continue;
    t.paper = add(t.paper, p.score);
  }
  return t;
}

/** 表の行: 名前と、数（今の回・前の回） */
type Metric = { label: string; get: (r: RunResult) => number | null; unit?: string; digits?: number };

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export const METRICS: Metric[] = [
  { label: "様式 正解の欄", get: (r) => totals(r).read.goldFields },
  { label: "様式 当たり（別解を含む）", get: (r) => totals(r).read.hit + totals(r).read.alt },
  { label: "様式 当たりの率", get: (r) => pct(totals(r).read.hit + totals(r).read.alt, totals(r).read.goldFields), unit: "%" },
  { label: "様式 外れ", get: (r) => totals(r).read.wrong },
  { label: "様式 取りこぼし（項目）", get: (r) => totals(r).read.missItem },
  { label: "様式 欄の読み落とし", get: (r) => totals(r).read.missField },
  { label: "様式 余分な欄", get: (r) => totals(r).read.extraField },
  { label: "様式 台帳に無い項目名", get: (r) => totals(r).read.rejected },
  { label: "様式 位置違い", get: (r) => totals(r).read.boxMiss },
  { label: "様式 位置なし", get: (r) => totals(r).read.boxNone },
  { label: "入力 正解の変更", get: (r) => totals(r).intake.expected },
  { label: "入力 当たり", get: (r) => totals(r).intake.hit },
  { label: "入力 当たりの率", get: (r) => pct(totals(r).intake.hit, totals(r).intake.expected), unit: "%" },
  { label: "入力 外れ", get: (r) => totals(r).intake.wrong },
  { label: "入力 取りこぼし", get: (r) => totals(r).intake.miss },
  { label: "入力 余分", get: (r) => totals(r).intake.extra },
  { label: "入力 伏せ字の残り", get: (r) => totals(r).intake.masked },
  { label: "入力 形の合わない値", get: (r) => totals(r).intake.dropped },
  { label: "入力 道で運べない値", get: (r) => totals(r).carryLoss },
  { label: "紙 字のある欄（正解）", get: (r) => totals(r).paper.filled },
  { label: "紙 当たり", get: (r) => totals(r).paper.hit },
  { label: "紙 当たりの率", get: (r) => pct(totals(r).paper.hit, totals(r).paper.filled), unit: "%" },
  { label: "紙 取りこぼし", get: (r) => totals(r).paper.miss },
  { label: "紙 置き間違い（違う字）", get: (r) => totals(r).paper.wrong },
  { label: "紙 置き間違い（余分な字）", get: (r) => totals(r).paper.extra },
  { label: "紙 場所違い", get: (r) => totals(r).paper.boxMiss },
  { label: "紙 別紙（収まらない）", get: (r) => totals(r).paper.annexOverflow },
  { label: "紙 別紙（場所なし）", get: (r) => totals(r).paper.annexUnplaced },
  { label: "紙 未確認の差（正解と）", get: (r) => totals(r).paper.unconfirmedDiff },
  { label: "紙 未記入の数え漏れ", get: (r) => totals(r).paper.uncountedBlank },
  // T133: 紙の見た目（元の様式の上の紙の全部。正解の表の無い様式も、全部の入力）
  { label: "見た目 置いた字", get: (r) => totals(r).look.texts },
  { label: "見た目 重なり（印刷の字と）", get: (r) => totals(r).look.overlap },
  { label: "見た目 はみ出し（欄の枠の外）", get: (r) => totals(r).look.outside },
  { label: "見た目 隣の欄の枠に掛かる", get: (r) => totals(r).look.neighbor },
  { label: "見た目 ずらした字（欄の枠の中）", get: (r) => totals(r).look.shifted },
  { label: "見た目 置けなかった欄", get: (r) => totals(r).look.unplaced },
  // T140: 置けなかった訳
  { label: "見た目 置けなかった欄 うち選択肢に無い", get: (r) => totals(r).look.unplacedOption ?? 0 },
  { label: "見た目 置けなかった欄 うち空きに収まらない", get: (r) => totals(r).look.unplacedRoom ?? 0 },
  { label: "見た目 置けなかった欄 うち□の場所なし", get: (r) => totals(r).look.unplacedBox ?? 0 },
  { label: "見た目 台帳あり空欄", get: (r) => totals(r).look.blanks },
  { label: "見た目 台帳あり空欄 うち選択肢に合わない値", get: (r) => totals(r).look.blanksChoice },
  { label: "見た目 伏字・仮の言い方", get: (r) => totals(r).look.masks },
  { label: "見た目 印刷の字の位置のある頁", get: (r) => totals(r).look.inkPages },
  { label: "送った文の氏名・電話・町名", get: (r) => r.leaks.strongHits },
  { label: "送った文の生年月日", get: (r) => r.leaks.birthHits },
  { label: "送った文の姓・名だけ", get: (r) => r.leaks.weakHits },
  { label: "送った入力の画像（絵・PDF の頁。様式の頁は除く）", get: (r) => r.leaks.images },
  { label: "送った入力の画像 塗りが黒くない", get: (r) => r.leaks.imagesNotRedacted },
  { label: "入力の数", get: (r) => totals(r).inputs },
  { label: "入力の失敗（全部）", get: (r) => totals(r).inputsFailed },
  { label: "入力の失敗 形式（HEIC など）", get: (r) => totals(r).failures.type ?? 0 },
  { label: "入力の失敗 HEIC を描けない（T120。ブラウザが描ければ JPEG に直す）", get: (r) => totals(r).failures.heic ?? 0 },
  { label: "入力の失敗 長すぎる文", get: (r) => totals(r).failures.too_long ?? 0 },
  { label: "入力の失敗 大きさ（縮めても 5 MB 超）", get: (r) => totals(r).failures.too_large ?? 0 },
  { label: "入力の失敗 AI", get: (r) => Object.entries(totals(r).failures).filter(([k]) => k.startsWith("ai_")).reduce((n, [, v]) => n + v, 0) },
  { label: "入力の生のファイルが 5 MB 超", get: (r) => totals(r).rawOverLimit },
  { label: "AI の呼び出し", get: (r) => r.calls.calls },
  { label: "AI の失敗", get: (r) => r.calls.failed },
  // T131: 出力の上限で切れた呼び出し（失敗に数える。様式の読み取りは拾えた欄を残して続きを頼む）と、様式の読み取りの 1 回の出力の最大
  { label: "AI の失敗 うち出力の上限で切れた", get: (r) => r.calls.truncated ?? null },
  { label: "様式の読み取り 1 回の出力の最大（token）", get: (r) => r.calls.formReadMaxOutput ?? null },
  { label: "AI の送り直しのあった呼び出し", get: (r) => r.calls.retried },
  { label: "AI の時間（秒）", get: (r) => Math.round(r.calls.durationMs / 100) / 10 },
  { label: "入力トークン", get: (r) => r.calls.inputTokens },
  { label: "出力トークン", get: (r) => r.calls.outputTokens },
  { label: "費用の見積もり（USD）", get: (r) => Math.round(r.calls.costUsd * 10000) / 10000, digits: 4 },
  // T136: 紙の見直し（決まりの見直しの要修正・要確認の数、AI の照合で使った所の数と失敗）
  { label: "見直し 要修正（決まり）", get: (r) => (r.papers.some((p) => p.review) ? reviewTotals(r.papers).fix : null) },
  { label: "見直し 要確認（決まり）", get: (r) => (r.papers.some((p) => p.review) ? reviewTotals(r.papers).check : null) },
  { label: "見直し AI の照合の紙", get: (r) => (r.papers.some((p) => p.review) ? reviewTotals(r.papers).ai : null) },
  { label: "見直し AI の所（使った物）", get: (r) => (r.papers.some((p) => p.review) ? reviewTotals(r.papers).aiFound : null) },
  { label: "見直し AI の照合の失敗", get: (r) => (r.papers.some((p) => p.review) ? reviewTotals(r.papers).aiFailed : null) },
];

const fmt = (v: number | null, m?: Metric) => (v === null ? "-" : `${m?.digits ? v.toFixed(m.digits) : v}${m?.unit ?? ""}`);
const diff = (a: number | null, b: number | null) => {
  if (a === null || b === null) return "-";
  const d = Math.round((a - b) * 10000) / 10000;
  return d === 0 ? "0" : d > 0 ? `+${d}` : `${d}`;
};

/** 1 行の要約（前の回との差を括弧に） */
export function oneLine(r: RunResult, prev: RunResult | null): string {
  const t = totals(r);
  const p = prev ? totals(prev) : null;
  const d = (a: number, b: number | undefined) => (b === undefined ? "" : a - b === 0 ? "(±0)" : `(${a - b > 0 ? "+" : ""}${a - b})`);
  const readHit = t.read.hit + t.read.alt;
  const paperWrong = t.paper.wrong + t.paper.extra;
  return [
    `${r.run}${r.mode === "fake" ? `（偽 ${r.fakeStyle}）` : ""}`,
    `様式 当${readHit}/${t.read.goldFields}${d(readHit, p ? p.read.hit + p.read.alt : undefined)} 外${t.read.wrong}${d(t.read.wrong, p?.read.wrong)} 漏${t.read.missItem + t.read.missField}${d(t.read.missItem + t.read.missField, p ? p.read.missItem + p.read.missField : undefined)}`,
    `入力 当${t.intake.hit}/${t.intake.expected}${d(t.intake.hit, p?.intake.hit)} 外${t.intake.wrong} 漏${t.intake.miss}`,
    `紙 当${t.paper.hit}/${t.paper.filled}${d(t.paper.hit, p?.paper.hit)} 置違${paperWrong}${d(paperWrong, p ? p.paper.wrong + p.paper.extra : undefined)} 別紙${t.paper.annexOverflow + t.paper.annexUnplaced}`,
    `見 重${t.look.overlap}${d(t.look.overlap, p?.look.overlap)} 出${t.look.outside} 隣${t.look.neighbor} 空${t.look.blanks}${d(t.look.blanks, p?.look.blanks)} 置けず${t.look.unplaced} 伏${t.look.masks}`,
    ...(r.papers.some((p) => p.review) ? [`見直し 修${reviewTotals(r.papers).fix} 確${reviewTotals(r.papers).check} AI${reviewTotals(r.papers).aiFound}`] : []),
    `漏洩 ${r.leaks.strongHits}`,
    `失敗 ${t.inputsFailed}`,
    `呼出 ${r.calls.calls}回 ${Math.round(r.calls.durationMs / 1000)}秒 $${r.calls.costUsd.toFixed(3)}`,
    prev ? `前回 ${prev.run}` : "前回なし",
  ].join(" | ");
}

/** 前の回との差の md（数だけ） */
export function diffMarkdown(r: RunResult, prev: RunResult | null): string {
  const lines: string[] = [];
  lines.push(`# 書類の AI の評価（${r.run}）`);
  lines.push("");
  lines.push(`T107 の台（npm run eval:forms）の 1 回の数。中身・原本・名前は書かない（記録と埋めた紙はリポジトリの外の回のフォルダ）。`);
  lines.push("");
  lines.push(`- 回: ${r.run}（${r.mode === "fake" ? `偽の client ${r.fakeStyle}。数は台の確かめ用で AI の力ではない` : r.mode === "replay" ? `数え直し（${r.replayOf ?? ""} の本物の返事を今のコードで。API は呼ばない）` : "本物の API"}）`);
  lines.push(`- 前の回: ${prev ? prev.run : "なし"}`);
  lines.push(`- 入力の作り方の版: ${r.genVersion}、紙の日付: ${r.today}、Chrome: ${r.renderer ? "あり" : "なし"}、埋めた紙: ${r.paper === "none" ? "刷らない（数だけ）" : (r.paper ?? "all")}`);
  lines.push(`- 様式の置き場: ${r.corpus.missing ? "なし" : `様式本体 ${r.corpus.files} 件（${r.corpus.cities.length} 市町村）、記載例・手引きなど読まない物 ${r.corpus.excluded} 件`}`);
  lines.push(`- 費用は ${PRICES_AS_OF} 時点の単価の見積もり（ai_calls のトークンから）`);
  lines.push("");
  lines.push("## 全体");
  lines.push("");
  lines.push("| 数 | 今回 | 前回 | 差 |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const m of METRICS) {
    const a = m.get(r);
    const b = prev ? m.get(prev) : null;
    lines.push(`| ${m.label} | ${fmt(a, m)} | ${fmt(b, m)} | ${diff(a, b)} |`);
  }
  lines.push("");
  lines.push("## 様式ごと");
  lines.push("");
  lines.push("| 様式 | 状態 | 読めた欄 | 項目あり | 正解の欄 | 当たり | 外れ | 取りこぼし | 読み落とし | 余分 | 位置違い | 紙 当たり | 紙 取りこぼし | 紙 置き間違い | 別紙 | 重なり | はみ出し | 隣の欄 | 台帳あり空欄 | 置けず |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const f of r.forms) {
    const t = totals(r, { form: f.id });
    const rd = f.read;
    lines.push(
      `| ${f.id} | ${f.status === "ok" ? `済${f.unread?.length ? `（未読 ${f.unread.join("・")}頁）` : ""}${f.partial?.length ? `（一部 ${f.partial.join("・")}頁）` : ""}` : `${f.status === "skipped" ? "飛ばし" : "失敗"}（${f.reason ?? ""}）`} | ${f.fields ?? "-"} | ${f.mapped ?? "-"} | ${rd?.goldFields ?? "-"} | ${rd ? rd.hit + rd.alt : "-"} | ${rd?.wrong ?? "-"} | ${rd?.missItem ?? "-"} | ${rd?.missField ?? "-"} | ${rd?.extraField ?? "-"} | ${rd?.boxMiss ?? "-"} | ${t.paper.hit}/${t.paper.filled} | ${t.paper.miss} | ${t.paper.wrong + t.paper.extra} | ${t.paper.annexOverflow + t.paper.annexUnplaced} | ${t.look.overlap} | ${t.look.outside} | ${t.look.neighbor} | ${t.look.blanks} | ${t.look.unplaced} |`,
    );
  }
  lines.push("");
  lines.push("## 入れ方ごと");
  lines.push("");
  lines.push("| 入れ方 | 入力 | 失敗 | 変更の当たり | 外れ | 取りこぼし | 余分 | 伏せ字 | 紙 当たり | 紙 取りこぼし | 紙 置き間違い |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const kind of Object.keys(INPUT_KIND_LABELS) as InputKind[]) {
    if (!r.inputs.some((i) => i.kind === kind)) continue;
    const t = totals(r, { kind });
    lines.push(
      `| ${INPUT_KIND_LABELS[kind]} | ${t.inputs} | ${t.inputsFailed} | ${t.intake.hit}/${t.intake.expected} | ${t.intake.wrong} | ${t.intake.miss} | ${t.intake.extra} | ${t.intake.masked} | ${t.paper.hit}/${t.paper.filled} | ${t.paper.miss} | ${t.paper.wrong + t.paper.extra} |`,
    );
  }
  lines.push("");
  lines.push("## 前の回との差（1 行）");
  lines.push("");
  lines.push(oneLine(r, prev));
  lines.push("");
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 埋めた紙の一覧（回のフォルダの filled/index.html。リポジトリの外） */
export function writeIndex(r: RunResult): string {
  const dir = join(r.dir, "filled");
  mkdirSync(dir, { recursive: true });
  const kindOf = new Map(r.inputs.map((i) => [i.id, i]));
  // 数も紙も無い組（正解の表の無い様式の、刷らなかった入力）は出さない
  const rows = r.papers
    .filter((p) => p.score || p.files.pdf || p.files.png)
    .map((p) => {
      const s = p.score;
      const inp = kindOf.get(p.input);
      const link = (href: string | undefined, label: string) => (href ? `<a href="${esc(href)}">${label}</a>` : "");
      const thumb = (href: string | undefined) => (href ? `<a href="${esc(href)}"><img src="${esc(href)}" alt="" loading="lazy"></a>` : "");
      return `<tr><td>${esc(p.form)}</td><td>${esc(p.input)}</td><td>${esc(INPUT_KIND_LABELS[p.kind])}${inp && inp.status !== "ok" ? `<br><small>${esc(inp.status)} ${esc(inp.failures.join(" "))}</small>` : ""}</td>
<td class="n">${s ? `${s.hit}/${s.filled}` : "-"}</td><td class="n">${s ? s.miss : "-"}</td><td class="n">${s ? s.wrong + s.extra : "-"}</td><td class="n">${s ? s.boxMiss : "-"}</td><td class="n">${s ? s.annexOverflow + s.annexUnplaced : "-"}</td><td class="n">${s ? s.unconfirmedActual : "-"}</td>
<td>${link(p.files.pdf, "PDF")} ${link(p.files.fillPdf, "色付け")}</td><td class="th">${thumb(p.files.png)}</td><td class="th">${thumb(p.files.fillPng)}</td></tr>`;
    })
    .join("\n");
  const formRows = r.forms
    .map((f) => `<tr><td>${esc(f.id)}</td><td>${esc(f.title)}</td><td>${f.status === "ok" ? "済" : esc(`${f.status} ${f.reason ?? ""}`)}</td><td class="n">${f.read ? `${f.read.hit + f.read.alt}/${f.read.goldFields}` : "-"}</td><td class="n">${f.read?.wrong ?? "-"}</td><td class="n">${f.read ? f.read.missItem + f.read.missField : "-"}</td><td class="n">${f.read?.extraField ?? "-"}</td><td class="n">${f.read?.boxMiss ?? "-"}</td></tr>`)
    .join("\n");
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>埋めた紙 ${esc(r.run)}</title><style>
:root { --base: #f1f2f4; --panel: #fff; --text: #1d1f23; --muted: #5d636e; --line: #e3e5e9; }
body { margin: 0; padding: 16px; background: var(--base); color: var(--text); font: 13px/1.5 "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif; }
h1 { font-size: 17px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 20px 0 6px; }
p { margin: 0 0 8px; color: var(--muted); }
table { border-collapse: collapse; background: var(--panel); width: 100%; }
th, td { padding: 4px 8px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
th { font-weight: 600; color: var(--muted); }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
td.th img { width: 120px; height: auto; display: block; background: #fff; }
a { color: #1f5fbf; }
</style></head><body>
<h1>埋めた紙 ${esc(r.run)}</h1>
<p>${r.mode === "fake" ? `偽の client（${esc(r.fakeStyle ?? "")}）の回。数は台の確かめ用` : "本物の API の回"}。当たりは正解の紙と同じ字の欄の数 / 正解に字のある欄の数</p>
<h2>様式</h2>
<table><thead><tr><th>様式</th><th>題</th><th>状態</th><th>当たり</th><th>外れ</th><th>取りこぼし</th><th>余分</th><th>位置違い</th></tr></thead><tbody>${formRows}</tbody></table>
<h2>入力 × 様式</h2>
<table><thead><tr><th>様式</th><th>入力</th><th>入れ方</th><th>当たり</th><th>取りこぼし</th><th>置き間違い</th><th>場所違い</th><th>別紙</th><th>未確認</th><th>紙</th><th>色なし</th><th>色付け</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
  const path = join(dir, "index.html");
  writeFileSync(path, html, "utf8");
  return path;
}
