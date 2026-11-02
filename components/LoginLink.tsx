"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ゲストのヘッダーのログイン。ログインの画面の上では出さない（同じ物が 2 つ並ばないように）
export function LoginLink() {
  const path = usePathname() ?? "/";
  if (path.startsWith("/login")) return null;
  return (
    <Link href="/login" className="rounded-md bg-accent px-3 py-1.5 font-bold text-on-accent" data-press="overlay">
      ログイン
    </Link>
  );
}
