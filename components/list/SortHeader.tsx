import Link from "next/link";
import { caseloadHref, type SortKey } from "@/lib/caseload";
import { COLUMN_LABELS } from "@/lib/list/labels";
import { LinkPending } from "@/components/ui/LinkPending";
import { TH } from "@/components/ui/table";

/** 降順で並べる列（年齢は上の人から、ハザードは深い浸水から）。ほかは昇順 */
const DESCENDING: ReadonlySet<SortKey> = new Set<SortKey>(["age", "hazard", "state"]);

/**
 * 担当一覧の列の見出し。押すとその列で並べる（平時・発災時の表で同じ）。href は担当一覧の外で使うとき（訓練 T17）の行き先。
 * 見た目は表の部品の見出し（components/ui/table の TH）。className は足す物（幅・寄せ・省く幅）
 */
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
      className={`${TH} ${className}`.trim()}
      aria-sort={active ? (DESCENDING.has(k) ? "descending" : "ascending") : undefined}
    >
      <Link
        href={href ?? caseloadHref({ sort: k })}
        data-press
        className={`relative -mx-1 inline-block rounded px-1 ${active ? "font-bold text-ink underline underline-offset-4" : "font-normal text-muted"}`}
      >
        {label ?? COLUMN_LABELS[k]}
        <LinkPending />
      </Link>
    </th>
  );
}
