"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ケアマネの机の画面の切替。今の画面は文字の色と下線で示す（下地は敷かない）
const ITEMS = [
  { href: "/", label: "担当一覧", match: (path: string) => path === "/" || path.startsWith("/people") },
  { href: "/drill", label: "訓練記録", match: (path: string) => path.startsWith("/drill") },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="画面" className="flex gap-1 text-sm">
      {ITEMS.map((item) => {
        const active = item.match(path);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded px-2 py-1 ${active ? "text-ink underline underline-offset-4" : "text-muted"}`}
            data-press
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
