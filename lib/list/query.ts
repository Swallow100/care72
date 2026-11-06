// 担当一覧の URL の query（並び・向き・絞込・右に開く本人）。D1 を使わない所で、絞込の帯（components/list/FilterBar.tsx、
// ブラウザ）もここを読む。lib/caseload.ts が同じ物を出し直す（読む側はどちらからでもよい）。
// 並びと絞込は URL の query だけで持つ（/?sort=age&dir=asc&color=red&area=…&mark=oxygen&q=…&open=p-01）。T58

import type { ClockCategory } from "../db/types.ts";
import { DEPENDENCE_MARKS } from "../labels.ts";
import type { Color } from "../triage/index.ts";

/** 並びの鍵。列の見出しの順（発災時の 状態・優先・氏名・残り・最終連絡・年齢・医療・ハザード・支援者・計画） */
export const SORT_KEYS = ["state", "tier", "kana", "remain", "contact", "age", "medical", "hazard", "supporter", "plan"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && (SORT_KEYS as readonly string[]).includes(v);
}

export type SortDir = "asc" | "desc";

/** 既定で降順の列（年齢は上の人から、ハザードは深い浸水から、状態は悪い色から）。ほかは昇順 */
const DESCENDING: ReadonlySet<SortKey> = new Set<SortKey>(["age", "hazard", "state"]);

/** 列の既定の向き */
export function defaultDir(k: SortKey): SortDir {
  return DESCENDING.has(k) ? "desc" : "asc";
}

/** URL の dir を読む。無い・形が違えば列の既定 */
export function parseDir(v: unknown, k: SortKey): SortDir {
  return v === "asc" || v === "desc" ? v : defaultDir(k);
}

/** 絞込。色は発災時だけ（平時は行に色が無いので効かせない） */
export type CaseloadFilter = {
  /** 状態の色 */
  color: Color | null;
  /** 地区（台帳の町名） */
  area: string | null;
  /** 医療の印の区分 */
  mark: ClockCategory | null;
  /** 氏名・カナの部分一致 */
  q: string;
};

export const NO_FILTER: CaseloadFilter = { color: null, area: null, mark: null, q: "" };

/** 地区・検索の文の長さの上限（字） */
export const MAX_FILTER_TEXT = 40;

const COLORS: ReadonlyArray<string> = ["red", "yellow", "gray", "green"];
const MARK_KEYS: ReadonlySet<string> = new Set(DEPENDENCE_MARKS.map(([c]) => c));
const one = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** URL の絞込を読む。形が違う物は無かったことに */
export function parseFilter(q: { color?: unknown; area?: unknown; mark?: unknown; q?: unknown }): CaseloadFilter {
  const color = one(q.color);
  const mark = one(q.mark);
  return {
    color: color && COLORS.includes(color) ? (color as Color) : null,
    area: one(q.area)?.trim().slice(0, MAX_FILTER_TEXT) || null,
    mark: mark && MARK_KEYS.has(mark) ? (mark as ClockCategory) : null,
    q: (one(q.q) ?? "").trim().slice(0, MAX_FILTER_TEXT),
  };
}

/** 絞っているか */
export function filterActive(f: CaseloadFilter): boolean {
  return f.color !== null || f.area !== null || f.mark !== null || f.q !== "";
}

/** 並びの向きと絞込（行のリンク・閉じる・列の見出しが持ち越す物） */
export type ListView = { dir?: SortDir; filter?: CaseloadFilter };

/**
 * 担当一覧の URL。sort は並び（既定の優先は書かない）、dir は向き（列の既定なら書かない）、
 * color・area・mark・q は絞込（無ければ書かない）、open は右に開く本人、field は開いた本人のページで紫にする欄（T169）
 */
export function caseloadHref(q: { sort?: SortKey; open?: string | null; field?: string | null } & ListView): string {
  const params = new URLSearchParams();
  const sort = q.sort ?? "tier";
  if (sort !== "tier") params.set("sort", sort);
  if (q.dir && q.dir !== defaultDir(sort)) params.set("dir", q.dir);
  const f = q.filter;
  if (f?.color) params.set("color", f.color);
  if (f?.area) params.set("area", f.area);
  if (f?.mark) params.set("mark", f.mark);
  if (f?.q) params.set("q", f.q);
  if (q.open) params.set("open", q.open);
  if (q.open && q.field) params.set("field", q.field);
  const s = params.toString();
  return s ? `/?${s}` : "/";
}
