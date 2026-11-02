import Link from "next/link";
import { caseloadHref, type SortKey } from "@/lib/caseload";
import { COLUMN_LABELS } from "@/lib/list/labels";

/** 降順で並べる列（年齢は上の人から、ハザードは深い浸水から）。ほかは昇順 */
const DESCENDING: ReadonlySet<SortKey> = new Set<SortKey>(["age", "hazard", "state"]);

/** 担当一覧の列の見出し。押すとその列で並べる（平時・発災時の表で同じ）。href は担当一覧の外で使うとき（訓練 T17）の行き先 */
export function SortHeader({
  k,
  sort,
  label,
  className = "",
  href,
}: {
  k: SortKey;
  sort: SortKey;
  label?: string;
  className?: string;
  href?: string;
}) {
  const active = k === sort;
  return (
    <th
      className={`px-2 py-2 font-normal ${className}`}
      aria-sort={active ? (DESCENDING.has(k) ? "descending" : "ascending") : undefined}
    >
      <Link
        href={href ?? caseloadHref({ sort: k })}
        data-press
        className={`rounded px-1 py-0.5 ${active ? "text-ink underline underline-offset-4" : "text-muted"}`}
      >
        {label ?? COLUMN_LABELS[k]}
      </Link>
    </th>
  );
}
