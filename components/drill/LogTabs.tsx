"use client";

// 経過の 3 つのタブの切替（T105）。中身（発生・把握・対応）はサーバーで描いた物を受け取り、選んだ 1 つだけ見せる（ほかは hidden）。
// 押すと読み直さずにすぐ替わり、URL の ?log= を書き換える（読み直しても同じタブ）。見た目は components/ui/Tabs と同じ
// （今の物は本文色の太字と下線、ほかは灰の文字。下地を敷かない・ピル型にしない）。押したときは灰色だけ（data-press）。

import { useState, type ReactNode } from "react";
import type { LogTab } from "@/lib/drill/timeline";

export type LogTabItem = { tab: LogTab; label: string; count: number };

export function LogTabs({
  label,
  items,
  initial,
  panels,
}: {
  label: string;
  items: ReadonlyArray<LogTabItem>;
  initial: LogTab;
  panels: Readonly<Record<LogTab, ReactNode>>;
}) {
  const [tab, setTab] = useState<LogTab>(initial);
  const pick = (next: LogTab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("log", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // URL を書き換えられなくても切替はできる
    }
  };
  return (
    <div data-log={tab}>
      <div role="tablist" aria-label={label} className="mb-1.5 flex flex-wrap gap-1 text-sm">
        {items.map((t) => {
          const on = t.tab === tab;
          return (
            <button
              key={t.tab}
              type="button"
              role="tab"
              id={`log-tab-${t.tab}`}
              aria-selected={on}
              aria-controls={`log-panel-${t.tab}`}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(t.tab)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                const i = items.findIndex((x) => x.tab === tab);
                const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
                pick(next.tab);
                document.getElementById(`log-tab-${next.tab}`)?.focus();
              }}
              className={`rounded px-2 py-1 ${on ? "font-bold text-ink underline decoration-2 underline-offset-[6px]" : "text-muted"}`}
              data-press
              data-log-tab={t.tab}
            >
              {t.label}
              <span className="ml-1 text-xs tabular-nums" data-log-count>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div key={t.tab} role="tabpanel" id={`log-panel-${t.tab}`} aria-labelledby={`log-tab-${t.tab}`} hidden={t.tab !== tab} data-log-panel={t.tab}>
          {panels[t.tab]}
        </div>
      ))}
    </div>
  );
}
