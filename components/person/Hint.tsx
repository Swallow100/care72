"use client";

// 文字に触れた時だけ出す添え（T143）。本人のページの見る方の画面で、時計の「出典 説明書」「確認日 2026-11-02」「手元の量 未確認」のような
// 添えを常には出さず、PC はカーソルを合わせた時、狭い幅（指）は押した時に出す。キーボードは焦点が来た時。
// 添えの言葉は lib/ledger-words.ts（T132）の物をそのまま受ける。窓の形は components/ui/Menu の一覧と同じ（面の地と薄い影）。
// 文字の下に点の線を引いて、触れると添えがあることを示す（色は変えない）。

import { useId, useState } from "react";

export function Hint({ hint, children, className = "" }: { hint: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="group/hint relative inline-flex" data-hint-host>
      <button
        type="button"
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={`cursor-help rounded-sm text-left underline decoration-muted decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${className}`}
        data-hint={open ? "open" : ""}
      >
        {children}
      </button>
      <span
        id={id}
        role="tooltip"
        className={`absolute top-full left-0 z-30 mt-1 w-max max-w-64 rounded bg-panel px-2 py-1 text-xs font-normal whitespace-normal text-ink shadow-[0_2px_8px_rgb(0_0_0/0.18)] group-hover/hint:block group-focus-within/hint:block dark:bg-panel2 dark:shadow-[0_2px_10px_rgb(0_0_0/0.6)] ${open ? "block" : "hidden"}`}
        data-hint-text
      >
        {hint}
      </span>
    </span>
  );
}
