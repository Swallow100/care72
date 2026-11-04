"use client";

// 紙面の画面の上の帯（components/ui/PaperBar の中。印刷で消える）の「未確認 N」（T87）。押すと欄の一覧を開く。紙には刷らない。
// 帯は「未確認 N」（台帳に置き場のある欄）と「手書き M」（台帳に置き場の無い欄・手で印を付ける欄）。T117。
// 一覧は 問い（本人のページの問いで埋められる）・未入力（台帳に置き場はあるが今の問いに無い）・手書き に分ける（lib/forms/unconfirmed.ts）。
// 一覧はいつも描いておき、閉じている間は hidden（サーバーの描画と食い違わない）。帯の折り返しの最後の行に出す（order-last）。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { OpenIcon } from "@/components/ui/Icon";
import { StateTag } from "@/components/ui/Tag";
import { UNCONFIRMED_LABELS as L, type UnconfirmedView } from "@/lib/forms/unconfirmed";

export function UnconfirmedFold({ view, id = "unconfirmed-fields" }: { view: UnconfirmedView; id?: string }) {
  const [open, setOpen] = useState(false);
  if (view.count === 0 && view.noSource.length === 0) return null;
  const groups = [
    { key: "ask", label: L.ask, items: view.ask ?? [] },
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
        {view.count > 0 && (
          <StateTag tone="check">
            {L.unconfirmed} <span className="tabular-nums">{view.count}</span>
          </StateTag>
        )}
        {view.noSource.length > 0 && (
          <span className="text-xs text-muted" data-unconfirmed-hand={view.noSource.length}>
            {L.noSource} <span className="font-bold text-ink tabular-nums">{view.noSource.length}</span>
          </span>
        )}
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
