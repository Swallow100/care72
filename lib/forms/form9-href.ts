// 様式 9 の画面の URL と並び替え。URL だけで並びと手直しの欄を開け閉めする（画面は Server Component のまま）。

import { RANK_FORM_ERROR_LABELS, type Form9Row, type RankFormError } from "./form9.ts";

export const FORM9_PATH = "/office/form9";
export const FORM9_CSV_PATH = "/office/form9/csv";
export const FORM9_RANK_PATH = "/office/form9/rank";

export const FORM9_SORTS = ["rank", "kana", "area", "manager"] as const;
export type Form9Sort = (typeof FORM9_SORTS)[number];

export const FORM9_SORT_LABELS: Record<Form9Sort, string> = { rank: "順位", kana: "氏名", area: "地域", manager: "担当" };

export function parseSort(v: unknown): Form9Sort {
  return typeof v === "string" && (FORM9_SORTS as readonly string[]).includes(v) ? (v as Form9Sort) : "rank";
}

const PERSON_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 手直しの欄を開く本人。1 つの id の形のときだけ（表に居なければ開かない） */
export function parseEdit(v: unknown): string | null {
  return typeof v === "string" && PERSON_ID.test(v) ? v : null;
}

export function parseError(v: unknown): RankFormError | null {
  return typeof v === "string" && Object.hasOwn(RANK_FORM_ERROR_LABELS, v) ? (v as RankFormError) : null;
}

/** 画面の URL。既定の並び（順位）は書かない */
export function form9Href(q: { sort?: Form9Sort; edit?: string | null; error?: RankFormError | null }): string {
  const params = new URLSearchParams();
  if (q.sort && q.sort !== "rank") params.set("sort", q.sort);
  if (q.edit) params.set("edit", q.edit);
  if (q.error) params.set("error", q.error);
  const s = params.toString();
  return s ? `${FORM9_PATH}?${s}` : FORM9_PATH;
}

/** 画面の並び替え。どの並びでも、同じなら順位の順。CSV はいつも順位の順 */
export function sortRows(rows: ReadonlyArray<Form9Row>, sort: Form9Sort): Form9Row[] {
  const text = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "ja");
  const primary: Record<Form9Sort, (a: Form9Row, b: Form9Row) => number> = {
    rank: () => 0,
    kana: (a, b) => a.kana.localeCompare(b.kana, "ja"),
    area: (a, b) => text(a.town, b.town),
    manager: (a, b) => text(a.careManager, b.careManager),
  };
  return [...rows].sort((a, b) => primary[sort](a, b) || a.rank - b.rank);
}
