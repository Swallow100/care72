"use client";

// 右の面の「未確認」の 1 行（T96）。氏名は本人のページ（?open=）へ。「未確認 N」を押すと、何の欄が未確認かの一覧が行の下に開く。
// 「未確認 N」は言葉と数を黄の塗りの印に入れる（前の件数の横の棒と、数の前の黄の細い帯は何の印か伝わらなかった）。
// 開く形は書類の紙面の帯の「未確認 N」（T87）と同じ: 開く印＋塗りの印のボタン、一覧は閉じている間も描いて hidden（サーバーの描画と食い違わない）。

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { OpenIcon } from "@/components/ui/Icon";
import { StateTag } from "@/components/ui/Tag";
import type { ReviewItem } from "@/lib/map/side";

export function PendingRow({ item }: { item: ReviewItem }) {
  const [open, setOpen] = useState(false);
  const listId = `pending-fields-${item.id}`;
  return (
    <li className="rounded-md bg-panel2" data-pending-row={item.id}>
      <div className="flex items-center gap-2 pl-2 text-sm">
        <Link href={item.href} className="min-w-0 flex-1 truncate rounded-sm py-1" data-press="overlay" data-pending-name>
          {item.name}
        </Link>
        <Button
          kind="quiet"
          size="sm"
          icon={OpenIcon}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className={open ? "[&>svg]:rotate-180" : ""}
          data-pending-fold={item.pending}
        >
          <StateTag tone="check">
            未確認 <span className="tabular-nums">{item.pending}</span>
          </StateTag>
        </Button>
      </div>
      <p id={listId} hidden={!open} className="px-2 pb-1.5 text-xs" data-pending-list>
        {item.labels.join("・")}
      </p>
    </li>
  );
}
