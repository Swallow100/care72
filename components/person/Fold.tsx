"use client";

// 本人のページの経過と変更履歴の畳み（T143）。見出しの右に「3 件」（押すと開く、開いたら「畳む」）、閉じた時は最後の 1 行（summary）だけ。
// 中身はいつも描いておき、閉じている間は hidden（サーバーの描画と食い違わない。components/forms/UnconfirmedFold と同じ形）。
// 区分の中で送る箱は作らない（開いた中身はページの流れのまま。送るのは画面全体の縦 1 本）。<details> は使わない（既定の▼を出さない）。
// between は見出しと中身の間にいつも出す物（経過の書き足しの欄。T24 のまま、畳んでも出す）。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { OpenIcon } from "@/components/ui/Icon";
import { FOLD_LABELS } from "@/lib/timeline/labels";

export function Fold({
  id,
  head,
  count,
  summary,
  between = null,
  defaultOpen = false,
  children,
  name,
}: {
  /** 中身の id（aria-controls） */
  id: string;
  /** 見出し（h2・h3） */
  head: React.ReactNode;
  count: number;
  /** 閉じた時の最後の 1 行 */
  summary: React.ReactNode;
  between?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  /** 確かめの印（data-fold） */
  name: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-fold={name} data-open={open ? "" : undefined}>
      <div className="flex flex-wrap items-center gap-x-2">
        {head}
        {count > 0 && (
          <Button
            kind="quiet"
            size="sm"
            icon={OpenIcon}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((v) => !v)}
            className={`-my-1 ${open ? "[&>svg]:rotate-180" : ""}`}
            data-fold-toggle={name}
          >
            <span className="tabular-nums">{open ? FOLD_LABELS.close : FOLD_LABELS.count(count)}</span>
          </Button>
        )}
      </div>
      {between}
      {!open && summary}
      <div id={id} hidden={!open} className="mt-1.5">
        {children}
      </div>
    </div>
  );
}
