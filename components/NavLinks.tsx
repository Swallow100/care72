"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/ui/LinkPending";

// ケアマネの机の画面の切替。今の画面は本文の色と下線で示す（下地は敷かない）。押してから移るまで灰色を残す。
// 狭い幅でも 1 行のまま（字を折り返さない）
const ITEMS = [
  { href: "/", label: "担当一覧", match: (path: string) => path === "/" || path.startsWith("/people") },
  { href: "/drill", label: "訓練", match: (path: string) => path.startsWith("/drill") },
  // 事業所（災害モードの切替・災害情報・担当の割当・ケアマネ）
  { href: "/office", label: "事業所", match: (path: string) => path === "/office" },
  // 様式 9 と、松山市以外の様式の読取と対応表（T08）。2 つの切替は各画面の上に
  { href: "/office/form9", label: "様式", match: (path: string) => path.startsWith("/office/form9") || path.startsWith("/forms") },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="画面" className="flex items-center gap-0.5 text-sm">
      {ITEMS.map((item) => {
        const active = item.match(path);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative inline-flex h-8 items-center rounded px-2 whitespace-nowrap ${
              active ? "font-bold text-ink underline decoration-2 underline-offset-[6px]" : "text-muted"
            }`}
            data-press
          >
            {item.label}
            <LinkPending />
          </Link>
        );
      })}
    </nav>
  );
}
