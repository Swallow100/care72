// 担当一覧の「今 画面に出ている行」を 1 か所で決める（T62）。担当一覧（app/page.tsx）・CSV（/caseload/csv）・
// 本人の 1 枚の一括印刷（/caseload/own-sheets）が同じ関数を呼ぶので、3 つの行と順は必ず同じになる。
// 並び（sort・dir）と絞込（color・area・mark・q）の読み方は lib/list/query.ts、並べ方と絞り方は lib/caseload.ts のまま。
// 平時は発災時だけの並び（状態・残り・最終連絡）を連絡順に戻し、色の絞込を効かせない（画面と同じ）。

import { DISASTER_SORT_KEYS, filterCaseload, sortCaseload, type Caseload, type CaseloadRow } from "../caseload.ts";
import type { ClockCategory } from "../db/types.ts";
import { COLOR_LABELS, DEPENDENCE_MARKS } from "../labels.ts";
import { COLUMN_LABELS, FILTER_LABELS } from "./labels.ts";
import {
  caseloadHref,
  defaultDir,
  filterActive,
  isSortKey,
  parseDir,
  parseFilter,
  type CaseloadFilter,
  type SortDir,
  type SortKey,
} from "./query.ts";

/** URL の query（Next の searchParams と同じ形。同じ名前が 2 つ以上なら配列） */
export type ListQuery = Partial<Record<"sort" | "dir" | "color" | "area" | "mark" | "q", string | string[]>>;

export type ListViewResult = {
  /** 効いている並び（平時は発災時だけの並びを連絡順に戻したあと） */
  key: SortKey;
  dir: SortDir;
  /** 効いている絞込（平時は色を外したあと） */
  filter: CaseloadFilter;
  /** 並べたあと、絞る前の行（上の人数と右の面） */
  all: CaseloadRow[];
  /** 画面に出ている行（並べて絞ったあと） */
  rows: CaseloadRow[];
};

/** 担当一覧の並びと絞込を当てる。画面・CSV・一括印刷が呼ぶ */
export function listView(data: Pick<Caseload, "rows" | "situation">, q: ListQuery): ListViewResult {
  const disaster = data.situation !== null;
  const asked: SortKey = isSortKey(q.sort) ? q.sort : "tier";
  // 発災時だけの列（状態・残り・最終連絡）の並びは、平時は連絡順に戻す
  const key: SortKey = !disaster && DISASTER_SORT_KEYS.includes(asked) ? "tier" : asked;
  const dir = parseDir(q.dir, key);
  // 色は発災時だけ。絞っても連絡順の番号は絞る前のまま（toCaseloadRows で振った rank）
  const askedFilter = parseFilter(q);
  const filter: CaseloadFilter = disaster ? askedFilter : { ...askedFilter, color: null };
  const all = sortCaseload(data.rows, key, dir);
  return { key, dir, filter, all, rows: filterCaseload(all, filter) };
}

/** route の URL の query を Next の searchParams と同じ形に（同じ名前が 2 つ以上なら配列。画面と同じく効かない） */
export function listQueryOf(params: URLSearchParams): ListQuery {
  const out: ListQuery = {};
  for (const k of ["sort", "dir", "color", "area", "mark", "q"] as const) {
    const all = params.getAll(k);
    if (all.length === 1) out[k] = all[0];
    else if (all.length > 1) out[k] = all;
  }
  return out;
}

/** 並びと絞込を別の道に持ち越す（担当一覧の URL と同じ書き方。右に開く本人は持ち越さない） */
export function listHref(path: string, view: { key: SortKey; dir: SortDir; filter: CaseloadFilter }, extra: Record<string, string> = {}): string {
  const list = caseloadHref({ sort: view.key, dir: view.dir, filter: view.filter });
  const params = new URLSearchParams(extra);
  for (const [k, v] of new URLSearchParams(list.includes("?") ? list.slice(list.indexOf("?") + 1) : "")) params.append(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

const MARK_LABELS: ReadonlyMap<ClockCategory, string> = new Map(DEPENDENCE_MARKS.map(([c, l]) => [c, l]));

/** 並びの言葉（「並び：連絡順」「並び：年齢・介護度 昇順」）。向きは列の既定と違うときだけ */
export function sortWords(view: { key: SortKey; dir: SortDir }): string {
  const turned = view.dir !== defaultDir(view.key) ? ` ${view.dir === "asc" ? "昇順" : "降順"}` : "";
  return `並び：${COLUMN_LABELS[view.key]}${turned}`;
}

/** 絞込の言葉（「絞込：至急・ほしぞら町・酸素・検索 ヤマ」）。絞っていなければ「絞込：なし」 */
export function filterWords(f: CaseloadFilter): string {
  if (!filterActive(f)) return `${FILTER_LABELS.title}：${FILTER_LABELS.none}`;
  const parts = [
    f.color ? COLOR_LABELS[f.color] : null,
    f.area,
    f.mark ? (MARK_LABELS.get(f.mark) ?? f.mark) : null,
    f.q ? `${FILTER_LABELS.search} ${f.q}` : null,
  ].filter((x): x is string => Boolean(x));
  return `${FILTER_LABELS.title}：${parts.join("・")}`;
}
