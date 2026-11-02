// 画面の中の切替（様式9・様式対応など）。Link の並び。今の物は文字の色（本文色）と太字と下線で示し、下地は敷かない。
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

/** 様式の切替（ヘッダーの「様式」の下の 2 つ）。/office/form9・/forms/mapping・/forms/mapping/[id] の上に置く */
export function FormsTabs({ current }: { current: "form9" | "mapping" }) {
  return (
    <Tabs
      label="様式"
      items={[
        { href: "/office/form9", label: "様式9", current: current === "form9" },
        { href: "/forms/mapping", label: "様式対応", current: current === "mapping" },
      ]}
    />
  );
}
