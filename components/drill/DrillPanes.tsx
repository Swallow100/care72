"use client";

// 訓練の画面の対応（終わった訓練は採点）と経過の置き場所（docs/tasks/T128.md の 2）。中身はサーバーで描いた物を受け取る。
// - wide（表を圧縮した並び）は 1536px 以上で 2 つを並べた 2 列（切替を出さない）。それ未満と展開の並びは 1 列で、上の切替で 1 つだけ見せる
//   （1280px は 表・この欄・被害状況と地図 の 3 列。経過を対応の下に積むと送らないと見えないので、積まずに切り替える）
// - 経過の錨（#log-…。上の帯の印と新着が飛ぶ先）へ飛んだら、切り替えの並びでは経過に替える（行まで送るのは経過の切替 LogTabs）
// - 切替の見た目は components/ui/Tabs の tabClass（本文色の太字と下の 1 本の線。ピル型・下地なし）。押したときは灰色だけ
// - 片方が無い（終わって採点を読めない）ときは切替を出さず、ある方だけ

import { useEffect, useState, type ReactNode } from "react";
import { tabClass, TabText } from "@/components/ui/Tabs";
import { tabOfAnchor } from "@/lib/drill/news";
import { onActPick } from "./act-pick";

type Pane = "main" | "log";

export function DrillPanes({
  main,
  log,
  mainLabel,
  logLabel,
  logCount,
  wide,
  label,
}: {
  /** 対応（進行中）か採点（終わった訓練）。無ければ経過だけ */
  main: ReactNode | null;
  log: ReactNode;
  mainLabel: string;
  logLabel: string;
  /** 経過の行の数（切替の名前の横） */
  logCount?: number;
  /** 1536px 以上で 2 列に並べる（表を圧縮した並び） */
  wide: boolean;
  /** 切替の読み上げの名前 */
  label: string;
}) {
  const [pane, setPane] = useState<Pane>("main");

  useEffect(() => {
    const onHash = () => {
      if (tabOfAnchor(window.location.hash)) setPane("log");
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href^='#log-']");
      if (a) setPane("log");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // 対応の欄へ渡されたら（頼み事の印・候補・連絡先の行）、切り替えの並びでは対応に替える（T166。経過の中の印を押すと対応の欄が隠れたままだった）
  useEffect(() => onActPick(() => setPane("main")), []);

  if (main === null) return <div className="min-w-0 space-y-3">{log}</div>;
  const hide = (p: Pane) => (pane === p ? "" : `hidden ${wide ? "2xl:block" : ""}`);
  return (
    <div className={`grid min-w-0 items-start gap-3 ${wide ? "2xl:grid-cols-2" : ""}`} data-panes={pane} data-panes-wide={wide ? "" : undefined}>
      <div role="tablist" aria-label={label} className={`flex flex-wrap gap-1 text-sm ${wide ? "2xl:hidden" : ""}`} data-panes-tabs>
        {(
          [
            ["main", mainLabel, undefined],
            ["log", logLabel, logCount],
          ] as const
        ).map(([p, text, count]) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={tabClass(pane === p)}
            data-press
            data-pane-tab={p}
          >
            <TabText label={text} count={count} />
          </button>
        ))}
      </div>
      <div className={`min-w-0 space-y-3 ${hide("main")}`} data-pane="main">
        {main}
      </div>
      <div className={`min-w-0 space-y-3 ${hide("log")}`} data-pane="log">
        {log}
      </div>
    </div>
  );
}
