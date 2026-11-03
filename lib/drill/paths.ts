// 訓練の画面の URL。/drill は訓練記録の一覧と開始、/drill/<id> は訓練（進行中）か再生（終了・中断）。
// sort は左の表の並び（既定の優先は書かない）、step は再生で見る刻み、view は左の表の圧縮（compact）か全部の列（full）。

import { SORT_KEYS, type SortKey } from "../caseload.ts";

export const DRILL_PATH = "/drill";

/**
 * 左の表の見せ方。auto は幅で決める（1536px 未満は圧縮、以上は全部の列）。compact・full は押して選んだ物
 */
export type DrillView = "auto" | "compact" | "full";

export type DrillQuery = { sort?: SortKey; step?: number | null; view?: DrillView };

export function drillHref(id: string, q: DrillQuery = {}): string {
  const params = new URLSearchParams();
  if (q.sort && q.sort !== "tier") params.set("sort", q.sort);
  if (q.step !== undefined && q.step !== null) params.set("step", String(q.step));
  if (q.view && q.view !== "auto") params.set("view", q.view);
  const s = params.toString();
  return `${DRILL_PATH}/${encodeURIComponent(id)}${s ? `?${s}` : ""}`;
}

/** 訓練記録の紙面（T22）。print は開いてすぐ印刷の画面を出す（?print=1、components/ui/PrintButton の auto） */
export function reportHref(id: string, opts: { print?: boolean } = {}): string {
  return `${DRILL_PATH}/${encodeURIComponent(id)}/report${opts.print ? "?print=1" : ""}`;
}

export function parseSort(v: unknown): SortKey {
  return typeof v === "string" && (SORT_KEYS as readonly string[]).includes(v) ? (v as SortKey) : "tier";
}

/** 再生で見る刻み（0〜999 の整数だけ）。無ければ null（今の刻み） */
export function parseStep(v: unknown): number | null {
  return typeof v === "string" && /^\d{1,3}$/.test(v) ? Number(v) : null;
}

export function parseView(v: unknown): DrillView {
  return v === "compact" || v === "full" ? v : "auto";
}
