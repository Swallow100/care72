"use client";

// 一覧から外した人の畳み（docs/tasks/T30.md）。担当一覧と事業所の担当の表の下に「外した人 N」を 1 行で置き、
// 「開く」で中身（名前・外した日・戻す）を出す。初めは閉じている。既定の ▼ の印は使わない。

import { useState } from "react";
import { OFFICE_LABELS } from "@/lib/office/labels";

export function UnlistedFold({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div id="unlisted" className="mt-2">
      <div className="flex items-center gap-3 rounded-md bg-panel px-3 py-1.5 text-sm">
        <h2 className="text-muted">
          {OFFICE_LABELS.unlisted} <span className="font-bold text-ink tabular-nums">{count}</span>
        </h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded px-2 py-0.5 text-accent"
          data-press
        >
          {open ? OFFICE_LABELS.close : OFFICE_LABELS.open}
        </button>
      </div>
      {open && <div className="mt-0.5">{children}</div>}
    </div>
  );
}
