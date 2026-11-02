"use client";

// 長い区分の畳み（事業所の経過など）。初めは新しい順に first 件だけ出し、「全 N 件」で残りをページの流れのまま開く。
// 区分の中で送る箱（max-h と overflow）は作らない（送るのは画面全体の縦 1 本）。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { OpenIcon } from "@/components/ui/Icon";

export function MoreFold({ items, first, className = "" }: { items: React.ReactNode[]; first: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, first);
  return (
    <>
      <ol className={className}>{shown}</ol>
      {items.length > first && (
        <Button kind="quiet" size="sm" icon={OpenIcon} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-1 -ml-2">
          {open ? "畳む" : `全 ${items.length} 件`}
        </Button>
      )}
    </>
  );
}
