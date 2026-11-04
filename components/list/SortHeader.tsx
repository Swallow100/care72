import Link from "next/link";
import { caseloadHref, defaultDir, type CaseloadFilter, type SortDir, type SortKey } from "@/lib/caseload";
import { COLUMN_LABELS } from "@/lib/list/labels";
import { OpenIcon, SortIcon } from "@/components/ui/Icon";
import { LinkPending } from "@/components/ui/LinkPending";
import { SORT_ICON, TH } from "@/components/ui/table";

/** 列の見出しの行き先。押している列はもう一度押すと向きが反転し、ほかの列はその列の既定の向き（T58）。絞込は持ち越す */
export function sortHeaderHref(k: SortKey, sort: SortKey, dir: SortDir, filter?: CaseloadFilter): string {
  const next: SortDir = k === sort ? (dir === "asc" ? "desc" : "asc") : defaultDir(k);
  return caseloadHref({ sort: k, dir: next, ...(filter ? { filter } : {}) });
}

/**
 * 担当一覧の列の見出し。押すとその列で並べ、押している列をもう一度押すと向きが反転する（平時・発災時の表で同じ）。
 * 既定の向きは年齢・ハザード・状態が降順、ほかは昇順（lib/caseload の defaultDir）。aria-sort は今の向き。
 * href は担当一覧の外で使うとき（訓練 T17）の行き先（そのときは向きを持たず、既定の向き）。
 * 見た目は表の部品の見出し（components/ui/table の TH）。className は足す物（幅・寄せ・省く幅）。
 * 押せる見出しには並べ替えの印（押していない列は上下の印、押している列は下線と向きの印）を付け、押せない見出し（印なし）と分ける（T66）
 */
export function SortHeader({
  k,
  sort,
  dir,
  filter,
  label,
  className = "",
  href,
  narrowWrap = false,
}: {
  k: SortKey;
  sort: SortKey;
  /** 今の並びの向き。無ければ列の既定 */
  dir?: SortDir;
  /** 今の絞込（行き先に持ち越す） */
  filter?: CaseloadFilter;
  label?: string;
  className?: string;
  href?: string;
  /** 640px 未満は見出しの言葉を 2 字ずつ折る（「連絡/順」。375 で番号の列が見出しの幅で広がり、理由が 1〜2 字ずつ折れていた。T78） */
  narrowWrap?: boolean;
}) {
  const active = k === sort;
  const now = href === undefined ? (dir ?? defaultDir(sort)) : defaultDir(sort);
  return (
    <th className={`${TH} ${className}`.trim()} aria-sort={active ? (now === "desc" ? "descending" : "ascending") : undefined}>
      <Link
        href={href ?? sortHeaderHref(k, sort, now, filter)}
        data-press
        className={`relative -mx-1 inline-block rounded px-1 whitespace-nowrap ${narrowWrap ? "max-sm:w-[calc(2em+0.5rem)] max-sm:whitespace-normal " : ""}outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${active ? "font-bold text-ink underline underline-offset-4" : "font-normal text-muted"}`}
      >
        {label ?? COLUMN_LABELS[k]}
        {/* 押している列は向きの印（下向きが降順）。訓練の表（href）は今まで通り出さない。押していない列は上下の印（押せる見出しの目印） */}
        {active && href === undefined && <OpenIcon aria-hidden className={`${SORT_ICON} ${now === "asc" ? "rotate-180" : ""}`} />}
        {!active && <SortIcon aria-hidden className={SORT_ICON} data-sortable />}
        <LinkPending />
      </Link>
    </th>
  );
}
