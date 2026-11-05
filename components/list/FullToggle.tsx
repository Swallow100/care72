"use client";

// 行の詳細の「全部」の開け閉め（docs/tasks/T132.md）。中身（台帳の平時の情報の全部）はサーバーで描いて受け取り、
// ここは開け閉めだけを持つ（行の開け閉めの ExpandRow と同じ形）。1 分ごとの読み直しでも開いたまま。
// 押したときは灰色だけ（data-press）。選んだ印の下地は敷かない。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AllIcon, OpenIcon } from "@/components/ui/Icon";
import { FULL_LABELS } from "@/lib/labels";

export function FullToggle({ id, children }: { id: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = `row-full-${id}`;
  return (
    <div className="space-y-2" data-full={open ? "open" : "closed"}>
      <Button
        size="sm"
        icon={open ? undefined : AllIcon}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-full-toggle
      >
        {open ? FULL_LABELS.close : FULL_LABELS.open}
        <OpenIcon aria-hidden className={`size-3.5 shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div id={bodyId} data-full-body>
          {children}
        </div>
      )}
    </div>
  );
}
