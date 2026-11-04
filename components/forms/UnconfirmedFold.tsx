"use client";

// 紙面の画面の上の帯（components/ui/PaperBar の中。印刷で消える）の「未確認 N」（T87）。押すと欄の一覧を開く。紙には刷らない。
// 一覧は 未入力（台帳に項目はあるが値が無い。本人のページで直せる）と 対応なし（台帳に項目の無い欄）に分ける（lib/forms/unconfirmed.ts）。
// 一覧はいつも描いておき、閉じている間は hidden（サーバーの描画と食い違わない）。帯の折り返しの最後の行に出す（order-last）。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { OpenIcon } from "@/components/ui/Icon";
import { StateTag } from "@/components/ui/Tag";
import { UNCONFIRMED_LABELS as L, type UnconfirmedView } from "@/lib/forms/unconfirmed";

export function UnconfirmedFold({ view, id = "unconfirmed-fields" }: { view: UnconfirmedView; id?: string }) {
  const [open, setOpen] = useState(false);
  if (view.count === 0) return null;
  const groups = [
    { key: "blank", label: L.blank, items: view.blank },
    { key: "noSource", label: L.noSource, items: view.noSource },
  ].filter((g) => g.items.length > 0);
  return (
    <>
      <Button
        kind="quiet"
        size="sm"
        icon={OpenIcon}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`-mx-2 ${open ? "[&>svg]:rotate-180" : ""}`}
        data-unconfirmed-fold={view.count}
      >
        <StateTag tone="check">
          {L.unconfirmed} <span className="tabular-nums">{view.count}</span>
        </StateTag>
      </Button>
      <dl
        id={id}
        hidden={!open}
        className="order-last grid basis-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-panel px-3 py-2 text-sm"
        data-unconfirmed-list
      >
        {groups.map((g) => (
          <div key={g.key} className="contents" data-unconfirmed-group={g.key}>
            <dt className="pt-px text-xs whitespace-nowrap text-muted">
              {g.label} <span className="font-bold text-ink tabular-nums">{g.items.length}</span>
            </dt>
            <dd>{g.items.join("・")}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
