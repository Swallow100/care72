// 画面の中の切替（書類・様式9・様式追加など）。Link の並び。今の物は文字の色（本文色）と太字と下線で示し、下地は敷かない。
// 押してから次の画面が出るまで灰色を残す（LinkPending）。

import Link from "next/link";
import { LinkPending } from "./LinkPending";

export type TabItem = { href: string; label: string; current: boolean };

export function Tabs({ items, label }: { items: ReadonlyArray<TabItem>; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 text-sm">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.current ? "page" : undefined}
          className={`relative rounded px-2 py-1 ${t.current ? "font-bold text-ink underline decoration-2 underline-offset-[6px]" : "text-muted"}`}
          data-press
        >
          {t.label}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}

/**
 * 書類の切替（ヘッダーの「書類」の下の 3 つ。T87）。/forms（書類の一覧）・/office/form9・/forms/mapping（様式追加。前の「様式対応」、URL は同じ）
 * ・/forms/mapping/[id] の上に置く
 */
export function FormsTabs({ current }: { current: "list" | "form9" | "mapping" }) {
  return (
    <Tabs
      label="書類"
      items={[
        { href: "/forms", label: "書類", current: current === "list" },
        { href: "/office/form9", label: "様式9", current: current === "form9" },
        { href: "/forms/mapping", label: "様式追加", current: current === "mapping" },
      ]}
    />
  );
}
