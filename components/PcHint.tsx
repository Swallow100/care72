"use client";

// 「PC 推奨」の 1 行（T124 の追加）。審査員には PC で触ってもらう。
// ケアマネ・事業所・行政・医療班の画面（表の画面）を狭い幅（768px 未満。Tailwind の md の手前）で開いたときだけ、ヘッダーの下に小さく出す。
// 本人・家族のスマホの頁には出さない（AppHeader が lib/auth/roles.ts の showsPcHint で役を見る）。
// 「閉じる」で消え、端末に覚える（localStorage。読めない・書けない端末では、その画面の間だけ消える）。
// 覚えた端末で一瞬出ないよう、描いた直後は隠し、端末の記録を読んでから出す。説明文は置かない。
// ログインの画面には閉じない 1 語（lib/ui/labels.ts の PC_HINT_LABELS.hint）を app/login/page.tsx が置く。

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/Icon";
import { PC_HINT_LABELS } from "@/lib/ui/labels";

/** 閉じたことを覚える端末の鍵 */
export const PC_HINT_STORAGE_KEY = "care72.pcHint.closed";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function PcHint() {
  // 描いた直後は隠す（端末の記録を読むまで）
  const [closed, setClosed] = useState(true);
  useEffect(() => {
    try {
      setClosed(storage()?.getItem(PC_HINT_STORAGE_KEY) === "1");
    } catch {
      setClosed(false);
    }
  }, []);

  const close = () => {
    setClosed(true);
    try {
      storage()?.setItem(PC_HINT_STORAGE_KEY, "1");
    } catch {
      // 覚えられない端末は、この画面の間だけ消える
    }
  };

  return (
    <div
      role="status"
      className={`mx-auto max-w-[90rem] items-center justify-between gap-2 px-4 pb-1 text-xs text-muted ${closed ? "hidden" : "flex md:hidden"}`}
      data-closed={closed ? "" : undefined}
      data-pc-hint
    >
      <span className="font-bold text-ink">{PC_HINT_LABELS.hint}</span>
      <Button kind="quiet" size="sm" icon={CloseIcon} onClick={close} data-pc-hint-close>
        {PC_HINT_LABELS.close}
      </Button>
    </div>
  );
}
