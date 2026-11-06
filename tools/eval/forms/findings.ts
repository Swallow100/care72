// 書類の台（T107）の指摘（T157）。1 回の結果（result.json の形）の数から、指摘の共通の形（tools/eval/findings.ts）を作る。
// 数え方（score.ts・look.ts・review.ts）は変えない。様式ごと・入れ方ごとに、原因の鍵（cause）と細かい場所（様式の id・入れ方）を分ける。
// 中身の写し（欄の値・見直しの所の名前と訳）は入れない。数と様式の id・入れ方の名前だけ。

import { causeCounts, findingId, writeFindings, type Accept, type Finding, type Severity } from "../findings.ts";
import { guardFindings } from "../guards.ts";
import { sharedMissOf, valuesOf } from "../scorecard-items.ts";
import type { RunResult } from "./run.ts";

export type FormsResultForFindings = Pick<RunResult, "run" | "mode" | "fakeStyle" | "forms" | "inputs" | "papers" | "calls" | "leaks">;

type Spec = { cause: string; rule: string; title: string; severity: Severity; screen: string; suspects: string[]; refs: (detail: string) => string[]; accept?: Accept };

const READ_FILES = ["lib/forms/form-read.ts", "lib/forms/mapping.ts"];
const PAPER_FILES = ["lib/forms/paper-fill.ts", "lib/forms/mapped-sheet.ts", "lib/forms/paper-slots.ts"];
const INTAKE_FILES = ["lib/intake/extract.ts", "lib/intake/read.ts"];
const LEAK_FILES = ["lib/pseudonym/index.ts", "lib/pseudonym/forms.ts", "lib/intake/extract.ts"];

const judgements = (stage: string) => (detail: string) => [`judgements.jsonl stage ${stage}（${detail}）`];
const steps = (stage: string) => (detail: string) => [`steps.jsonl stage ${stage}（${detail}）`];
const calls = () => ["calls.jsonl"];

export const SPECS = {
  formFailed: { cause: "forms:form.failed", rule: "form.failed", title: "様式を読めなかった", severity: "high", screen: "書類 > 様式の読み取り", suspects: ["lib/forms/form-read.ts", "lib/forms/read-upload.ts"], refs: steps("form") },
  readWrong: { cause: "forms:read.wrong", rule: "read.wrong", title: "様式の読み取りで欄の項目が外れた", severity: "mid", screen: "書類 > 様式の読み取り", suspects: READ_FILES, refs: judgements("read") },
  readMiss: { cause: "forms:read.miss", rule: "read.miss", title: "様式の読み取りで欄・項目の取りこぼし", severity: "mid", screen: "書類 > 様式の読み取り", suspects: READ_FILES, refs: judgements("read") },
  paperWrong: { cause: "forms:paper.wrong", rule: "paper.wrong", title: "紙の欄に違う字・余分な字", severity: "mid", screen: "書類 > 紙", suspects: PAPER_FILES, refs: judgements("paper") },
  paperMiss: { cause: "forms:paper.miss", rule: "paper.miss", title: "紙の欄の取りこぼし", severity: "mid", screen: "書類 > 紙", suspects: PAPER_FILES, refs: judgements("paper") },
  paperAnnex: { cause: "forms:paper.annex", rule: "paper.annex", title: "紙の欄に収まらず別紙", severity: "low", screen: "書類 > 紙（別紙）", suspects: ["lib/forms/paper-text.ts", "lib/forms/paper-slots.ts"], refs: judgements("paper") },
  lookOverlap: { cause: "forms:look.overlap", rule: "look.overlap", title: "紙の字が印刷の字・枠・隣の欄に掛かる", severity: "low", screen: "書類 > 紙", suspects: ["lib/forms/paper-slots.ts", "lib/forms/overlay-check.ts"], refs: steps("paper.look") },
  lookUnplaced: { cause: "forms:look.unplaced", rule: "look.unplaced", title: "紙に置けなかった欄", severity: "low", screen: "書類 > 紙", suspects: ["lib/forms/paper-slots.ts", "lib/forms/option-values.ts"], refs: steps("paper.look") },
  lookBlanks: { cause: "forms:look.blanks", rule: "look.blanks", title: "台帳に値があるのに紙が空欄", severity: "low", screen: "書類 > 紙", suspects: ["lib/forms/paper-fill.ts", "lib/forms/option-values.ts"], refs: steps("paper.look") },
  lookMasks: { cause: "forms:look.masks", rule: "look.masks", title: "紙に伏字・仮の言い方が残った", severity: "mid", screen: "書類 > 紙", suspects: ["lib/forms/paper-fill.ts", "lib/pseudonym/forms.ts"], refs: steps("paper.look") },
  // T160: 日付の欄・選ぶ欄の当て・連絡先（置けなかった欄・要修正の中の種類）
  dateFix: { cause: "forms:date.fix", rule: "date.fix", title: "日付の欄の要修正（年月日の空きに分けず・欄に無い元号など）", severity: "mid", screen: "書類 > 紙の見直し", suspects: ["lib/forms/split-parts.ts", "lib/forms/overlay-sheet.ts", "lib/forms/mapped-sheet.ts"], refs: steps("paper.review") },
  dateUnplaced: { cause: "forms:date.unplaced", rule: "date.unplaced", title: "日付の欄を紙に置けなかった", severity: "mid", screen: "書類 > 紙", suspects: ["lib/forms/split-parts.ts", "lib/forms/overlay-sheet.ts"], refs: steps("paper.look") },
  optionPicked: { cause: "forms:option.unplaced", rule: "option.unplaced", title: "選ぶ欄で台帳の値に当てたのに紙に印が無い", severity: "mid", screen: "書類 > 紙", suspects: ["lib/forms/option-values.ts", "lib/forms/option-ai.ts", "lib/forms/mapped-sheet.ts"], refs: steps("paper.look") },
  contactUnplaced: { cause: "forms:contact.unplaced", rule: "contact.unplaced", title: "緊急連絡先・支援者の欄を紙に置けなかった", severity: "mid", screen: "書類 > 紙", suspects: ["lib/forms/mapped-sheet.ts", "lib/forms/overlay-sheet.ts"], refs: steps("paper.look") },
  reviewFix: { cause: "forms:review.fix", rule: "review.fix", title: "紙の見直しの要修正（決まり）", severity: "mid", screen: "書類 > 紙の見直し", suspects: ["lib/forms/review.ts"], refs: steps("paper.review") },
  reviewAiFailed: { cause: "forms:review.ai_failed", rule: "review.ai_failed", title: "紙の AI の照合の失敗", severity: "mid", screen: "書類 > 紙の見直し", suspects: ["lib/forms/review-ai.ts", "lib/forms/review-compose.ts"], refs: steps("paper.review") },
  inputFailed: { cause: "forms:input.failed", rule: "input.failed", title: "入力の失敗", severity: "mid", screen: "本人のページ > AI 入力", suspects: ["lib/intake/http.ts", ...INTAKE_FILES], refs: steps("input") },
  intakeWrong: { cause: "forms:intake.wrong", rule: "intake.wrong", title: "入力の読み取りの外れ", severity: "mid", screen: "本人のページ > AI 入力", suspects: INTAKE_FILES, refs: judgements("intake") },
  intakeMiss: { cause: "forms:intake.miss", rule: "intake.miss", title: "入力の読み取りの取りこぼし", severity: "mid", screen: "本人のページ > AI 入力", suspects: INTAKE_FILES, refs: judgements("intake") },
  intakeMasked: { cause: "forms:intake.masked", rule: "intake.masked", title: "台帳に伏せ字が残った", severity: "mid", screen: "本人のページ > AI 入力", suspects: ["lib/intake/extract.ts", "lib/pseudonym/index.ts"], refs: judgements("intake") },
  leakStrong: { cause: "forms:leak.strong", rule: "leak.strong", title: "送った文に氏名・電話・町名", severity: "high", screen: "（Claude に送る中身）", suspects: LEAK_FILES, refs: calls, accept: { item: "forms.leaks", op: "<=", value: 0 } },
  leakBirth: { cause: "forms:leak.birth", rule: "leak.birth", title: "送った文に生年月日", severity: "high", screen: "（Claude に送る中身）", suspects: ["lib/pseudonym/birth.ts", ...LEAK_FILES], refs: calls, accept: { item: "forms.birthLeaks", op: "<=", value: 0 } },
  leakImage: { cause: "forms:leak.image", rule: "leak.image", title: "送った画像の塗りが黒くない", severity: "high", screen: "（Claude に送る画像）", suspects: ["lib/intake/read.ts", "lib/forms/review-compose.ts"], refs: calls, accept: { item: "forms.imagesNotRedacted", op: "<=", value: 0 } },
  // 一覧の様式で、2 つ目の事業所が共有の対応表を写せなかった（T161。1 つ目に読めない頁があり共有に入れなかった物は決めどおりなので数えない）
  sharedMiss: {
    cause: "forms:catalog.shared_miss",
    rule: "catalog.shared_miss",
    title: "一覧の様式の対応表を別の事業所が写せず AI を呼び直す",
    severity: "mid",
    screen: "書類 > 様式の読み取り（一覧の様式）",
    suspects: ["lib/forms/read-post.ts", "lib/forms/shared-mapping.ts"],
    refs: steps("form.shared"),
    accept: { item: "forms.sharedMiss", op: "<=", value: 0 },
  },
  truncated: { cause: "forms:calls.truncated", rule: "calls.truncated", title: "AI の返事が出力の上限で切れた", severity: "mid", screen: "書類 > 様式の読み取り", suspects: ["lib/forms/form-read.ts", "lib/claude/call.ts"], refs: calls },
} satisfies Record<string, Spec>;

const sum = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0);

/** 1 回の結果の指摘 */
export function formsFindings(r: FormsResultForFindings): Finding[] {
  const out: Finding[] = [];
  const base = r.mode === "real" ? "node --env-file=<鍵のファイル> tools/eval/forms/cli.ts --real" : r.mode === "replay" ? `npm run eval:forms -- --replay=<前の回のフォルダ>` : `npm run eval:forms --${r.fakeStyle === "gold" ? " --gold" : ""}`;
  const push = (spec: Spec, count: number, detail: string | null, flags: string) => {
    if (count <= 0) return;
    out.push({
      id: findingId(spec.cause, detail),
      bench: "forms",
      cause: spec.cause,
      rule: spec.rule,
      title: spec.title,
      where: { screen: spec.screen, ...(detail ? { file: detail } : {}), refs: spec.refs(detail ?? "全部") },
      severity: spec.severity,
      count,
      repro: [`${base}${flags}`, `回のフォルダ ${r.run} の ${spec.refs(detail ?? "全部").join("・")} を見る`],
      suspects: spec.suspects,
      accept: spec.accept ?? { item: `count:${spec.cause}`, op: "<=", value: 0 },
      firstSeen: r.run,
    });
  };

  for (const f of r.forms) {
    const flags = ` --forms=${f.id}`;
    if (f.status === "failed") push(SPECS.formFailed, 1, `様式 ${f.id}`, flags);
    if (f.read) {
      push(SPECS.readWrong, f.read.wrong, `様式 ${f.id}`, flags);
      push(SPECS.readMiss, f.read.missItem + f.read.missField, `様式 ${f.id}`, flags);
    }
    const ps = r.papers.filter((p) => p.form === f.id);
    const scores = ps.map((p) => p.score).filter((x): x is NonNullable<typeof x> => !!x);
    push(SPECS.paperWrong, sum(scores.map((s) => s.wrong + s.extra)), `様式 ${f.id}`, flags);
    push(SPECS.paperMiss, sum(scores.map((s) => s.miss)), `様式 ${f.id}`, flags);
    push(SPECS.paperAnnex, sum(scores.map((s) => s.annexOverflow + s.annexUnplaced)), `様式 ${f.id}`, flags);
    const looks = ps.map((p) => p.look).filter((x): x is NonNullable<typeof x> => !!x);
    push(SPECS.lookOverlap, sum(looks.map((l) => l.overlap + l.outside + l.neighbor)), `様式 ${f.id}`, flags);
    push(SPECS.lookUnplaced, sum(looks.map((l) => l.unplaced)), `様式 ${f.id}`, flags);
    push(SPECS.lookBlanks, sum(looks.map((l) => l.blanks)), `様式 ${f.id}`, flags);
    push(SPECS.lookMasks, sum(looks.map((l) => l.masks)), `様式 ${f.id}`, flags);
    push(SPECS.dateUnplaced, sum(looks.map((l) => l.unplacedDate ?? 0)), `様式 ${f.id}`, flags);
    push(SPECS.optionPicked, sum(looks.map((l) => l.unplacedPicked ?? 0)), `様式 ${f.id}`, flags);
    push(SPECS.contactUnplaced, sum(looks.map((l) => l.unplacedContact ?? 0)), `様式 ${f.id}`, flags);
    const reviews = ps.map((p) => p.review).filter((x): x is NonNullable<typeof x> => !!x);
    push(SPECS.reviewFix, sum(reviews.map((x) => x.rule.fix)), `様式 ${f.id}`, `${flags} --review`);
    push(SPECS.dateFix, sum(reviews.map((x) => x.rule.kinds.date ?? 0)), `様式 ${f.id}`, `${flags} --review`);
    push(SPECS.reviewAiFailed, reviews.filter((x) => x.ai?.status === "failed").length, `様式 ${f.id}`, `${flags} --review`);
    if (sharedMissOf(f)) push(SPECS.sharedMiss, 1, `様式 ${f.id}（${f.catalog?.sharedWhy ?? "訳なし"}）`, flags);
  }

  // 入力の失敗は理由ごと、読み取りの外れは入れ方ごと（予算で飛ばした物は失敗に数えない）
  const failures = new Map<string, string[]>();
  for (const i of r.inputs) for (const why of i.failures) if (why !== "budget") failures.set(why, [...(failures.get(why) ?? []), i.id]);
  for (const [why, ids] of failures) push(SPECS.inputFailed, ids.length, `理由 ${why}`, ` --inputs=${[...new Set(ids)].join(",")}`);
  const kinds = [...new Set(r.inputs.map((i) => i.kind))];
  for (const kind of kinds) {
    const xs = r.inputs.filter((i) => i.kind === kind && i.intake).map((i) => i.intake!);
    const flags = ` --inputs=${kind}-`;
    push(SPECS.intakeWrong, sum(xs.map((x) => x.wrong)), `入れ方 ${kind}`, flags);
    push(SPECS.intakeMiss, sum(xs.map((x) => x.miss)), `入れ方 ${kind}`, flags);
    push(SPECS.intakeMasked, sum(xs.map((x) => x.masked)), `入れ方 ${kind}`, flags);
  }

  push(SPECS.leakStrong, r.leaks.strongHits, null, "");
  push(SPECS.leakBirth, r.leaks.birthHits, null, "");
  push(SPECS.leakImage, r.leaks.imagesNotRedacted, null, "");
  push(SPECS.truncated, r.calls.truncated ?? 0, null, "");
  return out;
}

/** 回の findings.json を書く（指摘と、守り〔tools/eval/guards.ts〕の外れ）。root は回の置き場（初めて出た回を前の回から引き継ぐ） */
export function writeFormsFindings(r: FormsResultForFindings & { dir: string }, root: string): { path: string; findings: number; guarded: number } {
  const found = formsFindings(r);
  const client = r.mode;
  const guarded = guardFindings({
    bench: "forms",
    run: r.run,
    values: valuesOf({ bench: "forms", run: r.run, client, data: r }),
    counts: causeCounts(found),
    repro: [r.mode === "real" ? "node --env-file=<鍵のファイル> tools/eval/forms/cli.ts --real" : "npm run eval:forms"],
  });
  const path = writeFindings(r.dir, { bench: "forms", run: r.run, client, findings: [...found, ...guarded] }, { root });
  return { path, findings: found.length + guarded.length, guarded: guarded.length };
}
