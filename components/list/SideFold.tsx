"use client";

// 右の面の畳み（T14）。1024px 以上（lg）はいつも開き、狭い幅は 1 行に畳んで「開く」で広げる。
// 開け閉めは CSS（lg:block）と手元の状態だけで、サーバーの描画と食い違わない（初めは閉じている）。

import { useState } from "react";

export function SideFold({ title, summary, children }: { title: string; summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg bg-panel px-4 py-2 lg:hidden">
        <h2 className="font-bold">{title}</h2>
        <div className="min-w-0 flex-1 truncate text-sm">{summary}</div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded px-2 py-1 text-sm text-accent"
          data-press
          data-fold
        >
          {open ? "閉じる" : "開く"}
        </button>
      </div>
      <div className={`${open ? "mt-2 block" : "hidden"} lg:mt-0 lg:block`}>{children}</div>
    </div>
  );
}
