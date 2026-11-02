"use client";

// 一覧から外した人の畳み（docs/tasks/T30.md）。担当一覧と事業所の担当の表の下に「外した人 N」を 1 行で置き、
// 「開く」で中身（名前・外した日・戻す）をページの流れのまま出す。初めは閉じている。既定の ▼ の印は使わない。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { OpenIcon } from "@/components/ui/Icon";
import { OFFICE_LABELS } from "@/lib/office/labels";

/** inPanel: 面（白）の中に置くときは面の中の灰色、地に置くときは面の白 */
export function UnlistedFold({ count, inPanel = false, children }: { count: number; inPanel?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div id="unlisted" className="mt-2">
      <div className={`flex items-center gap-3 rounded pr-1 pl-3 text-sm ${inPanel ? "bg-panel2" : "bg-panel"}`}>
        <h2 className="text-muted">
          {OFFICE_LABELS.unlisted} <span className="font-bold text-ink">{count}</span>
        </h2>
        <Button kind="quiet" size="sm" icon={OpenIcon} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="my-0.5 ml-auto">
          {open ? OFFICE_LABELS.close : OFFICE_LABELS.open}
        </Button>
      </div>
      {open && <div className="mt-px">{children}</div>}
    </div>
  );
}
