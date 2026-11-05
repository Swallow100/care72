"use client";

// 経過の 3 つのタブの切替（T105）。中身（発生・把握・対応）はサーバーで描いた物を受け取り、選んだ 1 つだけ見せる（ほかは hidden）。
// 押すと読み直さずにすぐ替わり、URL の ?log= を書き換える（読み直しても同じタブ）。見た目は components/ui/Tabs と同じ
// （今の物は本文色の太字と下の 1 本の線、ほかは灰の文字。下地を敷かない・ピル型にしない。見た目は tabClass・TabText の 1 か所、T128）。
// 押したときは灰色だけ（data-press）。
// T128: 上の帯の印・新着は経過の行の前の錨（#log-<タブ>-<鍵>、lib/drill/news.ts の logAnchorId）へ飛ぶ。錨は隠れたタブの中にあり
// hash だけでは送れないので、hash が変わったら（同じ印を 2 度押したときも）そのタブに替えてから行まで送る。行の印は :target（drill.css）。

import { useEffect, useState, type ReactNode } from "react";
import { tabOfAnchor } from "@/lib/drill/news";
import { tabClass, TabText } from "@/components/ui/Tabs";
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

  // 錨へ: タブを替えて、描き替えたあとに行まで送る
  useEffect(() => {
    const go = (hash: string) => {
      const t = tabOfAnchor(hash);
      if (!t) return;
      setTab(t);
      window.requestAnimationFrame(() => document.getElementById(hash.replace(/^#/, ""))?.scrollIntoView({ block: "center", behavior: "smooth" }));
    };
    const onHash = () => go(window.location.hash);
    // 同じ hash の印をもう一度押しても hashchange は来ないので、押したときにも見る
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href^='#log-']");
      if (a && a.getAttribute("href") === window.location.hash) go(window.location.hash);
    };
    if (window.location.hash) onHash();
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
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
              className={tabClass(on)}
              data-press
              data-log-tab={t.tab}
            >
              <TabText label={t.label} count={t.count} />
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
