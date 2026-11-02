"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ケアマネの机の画面の切替。今の画面は文字の色と下線で示す（下地は敷かない）
const ITEMS = [
  { href: "/", label: "担当一覧", match: (path: string) => path === "/" || path.startsWith("/people") },
  { href: "/drill", label: "訓練記録", match: (path: string) => path.startsWith("/drill") },
  // 事業所（災害モードの切替・災害情報）と、その下の様式 9。様式 9 を開いているときは様式9 だけを光らせる
  { href: "/office", label: "事業所", match: (path: string) => path === "/office" },
  { href: "/office/form9", label: "様式9", match: (path: string) => path.startsWith("/office/form9") },
  // 松山市以外の様式の読取と対応表（T08）
  { href: "/forms/mapping", label: "様式対応", match: (path: string) => path.startsWith("/forms") },
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
