// 評価の台（T107）の紙の見直し（T136）。埋めた紙ごとに、決まりの見直しの数（種類ごと）と、AI の照合（偽の client なら台が決めた答え）を数える。
// アプリと同じ部品（lib/forms/review.ts・review-ai.ts）を通す。照合の絵は Chrome があればアプリと同じ描き方（塗った後）で描き、
// 無ければ元の様式の空の頁を送る（偽の回の道の確かめ用。本物の回は Chrome のある端末で回す）。
// 偽の答え: noisy は塗った欄・一覧に無い id・ふつうの欄を 1 つずつ挙げる（台は、塗った欄と知らない id を捨てて 1 件残るかを見る）。gold は挙げない。

import type { AskJsonContext } from "../../../lib/claude/call.ts";
import { pseudonymInputOf } from "../../../lib/intake/extract.ts";
import type { PersonPageRows } from "../../../lib/person.ts";
import { pseudonymize } from "../../../lib/pseudonym/index.ts";
import { composePlan, paintCounts, paintedFields, reviewGroups, reviewList, runAiReview, type ReviewListRow, type ReviewReply } from "../../../lib/forms/review-ai.ts";
import { mappedSubject, reviewCount, ruleReview, sheetHash, type ReviewFinding } from "../../../lib/forms/review.ts";
import type { FakeClient, FakeStyle } from "./fake.ts";
import type { Sheets } from "./paper.ts";
import type { Renderer } from "./render.ts";

/** dups は重複の所（T140。欄の名前となぜ。値は書かない） */
export type RuleCounts = { fix: number; check: number; note: number; kinds: Record<string, number>; dups?: Array<{ label: string; why: string }> };
export type AiReviewResult = {
  status: "ok" | "failed";
  /** 使った AI の所（塗った欄と知らない id を捨てたあと） */
  found: number;
  kinds: Record<string, number>;
  /** 塗った欄の数・頁ごとの塗る四角の数 */
  painted: number;
  paints: number[];
  /** 送った絵: composed（塗った後の絵）・blank（空の頁。Chrome が無い） */
  images: "composed" | "blank";
  error?: string;
  /** 照合で使った所の 1 つずつ（欄・種類・重さ・再考で直せそうか）。台の記録用 */
  detail?: Array<Pick<ReviewFinding, "id" | "field" | "label" | "kind" | "level" | "page" | "redo">>;
};
export type PaperReview = { rule: RuleCounts; ai: AiReviewResult | null; /** 照合の所（再考の頼みに使う。記録には detail だけ） */ findings?: ReviewFinding[] };

function countKinds(fs: readonly ReviewFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fs) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

export function ruleCounts(sheets: Sheets): RuleCounts | null {
  if (!sheets.overlay) return null;
  const fs = ruleReview(mappedSubject(sheets.mapped, sheets.overlay));
  const dups = fs.filter((f) => f.kind === "duplicate" || f.kind === "date").map((f) => ({ label: f.label, why: f.why }));
  return {
    fix: fs.filter((f) => f.level === "fix").length,
    check: fs.filter((f) => f.level === "check").length,
    note: fs.filter((f) => f.level === "note").length,
    kinds: countKinds(fs),
    ...(dups.length > 0 ? { dups } : {}),
  };
}

/** 偽の照合の答え（台の数え方の確かめ用） */
export function fakeReviewAnswer(rows: readonly ReviewListRow[], style: FakeStyle): ReviewReply {
  if (style === "gold") return { findings: [] };
  const painted = rows.find((r) => r.painted);
  const plain = rows.find((r) => !r.painted);
  return {
    findings: [
      ...(painted ? [{ id: painted.rid, kind: "unreadable" as const, where: "黒い所", why: "塗った欄（捨てる）" }] : []),
      { id: "r9999", kind: "misplaced" as const, where: "-", why: "一覧に無い id（捨てる）" },
      ...(plain ? [{ id: plain.rid, kind: "misplaced" as const, where: "隣の欄", why: "偽の答え" }] : []),
    ],
  };
}

/** 紙 1 枚の見直し。AI の照合は review のときだけ（本物の回は費用がかかる） */
export async function reviewPaper(args: {
  sheets: Sheets;
  rows: PersonPageRows;
  today: string;
  review: boolean;
  ctx: AskJsonContext;
  fake: FakeClient | null;
  fakeStyle: FakeStyle;
  seed: string;
  /** 頁の画像（data: の URL）と、空の頁の JPEG */
  pageHref: (page: number) => string;
  blankPage: (page: number) => Uint8Array | null;
  renderer: Renderer | null;
}): Promise<PaperReview | null> {
  const rule = ruleCounts(args.sheets);
  if (!rule || !args.sheets.overlay) return null;
  if (!args.review) return { rule, ai: null };
  const subject = mappedSubject(args.sheets.mapped, args.sheets.overlay);
  const { key } = pseudonymize([pseudonymInputOf(args.rows)], { on: args.today });
  const painted = paintedFields(subject, key);
  const plan = composePlan(subject, painted, key, await sheetHash(args.sheets.overlay), args.pageHref);
  const list = reviewList(subject, painted);
  let images: Uint8Array[];
  let kind: AiReviewResult["images"] = "blank";
  if (args.renderer) {
    images = [];
    for (const p of plan.pages) images.push((await args.renderer.compose(p, '"BIZ UDPGothic", "BIZ UDPMincho", sans-serif')).bytes);
    kind = "composed";
  } else {
    images = plan.pages.map((p) => args.blankPage(p.page)).filter((b): b is Uint8Array => b !== null);
  }
  const base = { painted: painted.size, paints: paintCounts(plan), images: kind };
  // 5 頁からは 4 頁ずつに分けて呼ぶ（T146）ので、偽の答えを呼ぶ回の数だけ積む（頁の外の行は捨てられる）
  const answer = fakeReviewAnswer(list, args.fakeStyle);
  for (let i = 0; i < reviewGroups(images.length).length; i++) args.fake?.expect({ kind: "review", answer }, args.seed);
  try {
    const { findings } = await runAiReview(args.ctx, { subject, rows: list, images, key });
    const detail = findings.map((f) => ({ id: f.id, field: f.field, label: f.label, kind: f.kind, level: f.level, page: f.page, ...(f.redo ? { redo: true } : {}) }));
    return { rule, ai: { status: "ok", found: findings.length, kinds: countKinds(findings), ...base, detail }, findings };
  } catch (e) {
    args.fake?.drain();
    return { rule, ai: { status: "failed", found: 0, kinds: {}, ...base, error: e instanceof Error ? e.name : "error" } };
  }
}

/** 回の見直しの合計（report の 1 行） */
export function reviewTotals(papers: ReadonlyArray<{ review?: PaperReview | null }>): { papers: number; fix: number; check: number; ai: number; aiFailed: number; aiFound: number } {
  const rs = papers.map((p) => p.review).filter((r): r is PaperReview => !!r);
  return {
    papers: rs.length,
    fix: rs.reduce((n, r) => n + r.rule.fix, 0),
    check: rs.reduce((n, r) => n + r.rule.check, 0),
    ai: rs.filter((r) => r.ai).length,
    aiFailed: rs.filter((r) => r.ai?.status === "failed").length,
    aiFound: rs.reduce((n, r) => n + (r.ai?.found ?? 0), 0),
  };
}

export { reviewCount };
