"use client";

// 右の面の畳み（T14）。1024px 以上（lg）はいつも開き、狭い幅は 1 行に畳んで「開く」で広げる。
// 開け閉めは CSS（lg:block）と手元の状態だけで、サーバーの描画と食い違わない（初めは閉じている）。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { OpenIcon } from "@/components/ui/Icon";

export function SideFold({ title, summary, children }: { title: string; summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2 lg:hidden">
        <h2 className="text-[1rem] leading-6 font-bold">{title}</h2>
        <div className="min-w-0 flex-1 truncate text-sm">{summary}</div>
        <Button
          kind="plain"
          size="sm"
          icon={OpenIcon}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={open ? "[&>svg]:rotate-180" : ""}
          data-fold
        >
          {open ? "閉じる" : "開く"}
        </Button>
      </div>
      <div className={`${open ? "mt-2 block" : "hidden"} lg:mt-0 lg:block`}>{children}</div>
    </div>
  );
}
