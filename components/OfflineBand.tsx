"use client";

// 写しと通信なしの帯（T71）。ヘッダーの下に、要るときだけ出す（無ければ何も描かない）。
// - 写し: Service Worker（public/sw.js）が写しを返した頁は </head> の前に <meta name="care72-cached-at"> を持つ。
//   それを読んで「写し 11/4 09:12」（黄の塗りの印に本文色の時刻。黄は文字に使わない）と「読み直す」
// - 通信なし: navigator.onLine が false の間、灰の塗りの印
// - 保留: 端末に貯めた通話の記録の数（components/CallQueue.tsx。ケアマネの役だけ）
// 写しの頁でも、つながって画面の中で移る・読み直す（router.refresh）と中身はネットの物になるので、
// URL か stamp（layout が描くたびの時刻）が変わったら写しの印を外す。本人・家族のスマホの頁は大きな字（font-ud）。印刷には出さない。

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useCallQueue } from "@/components/CallQueue";
import { Button } from "@/components/ui/Button";
import { RetryIcon } from "@/components/ui/Icon";
import { StateTag } from "@/components/ui/Tag";
import { CACHED_AT_META, copyTime, isPhonePath, OFFLINE_LABELS } from "@/lib/offline/labels";

export function OfflineBand({ stamp }: { stamp: string }) {
  return (
    <Suspense fallback={null}>
      <Band stamp={stamp} />
    </Suspense>
  );
}

function Band({ stamp }: { stamp: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const queue = useCallQueue();
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /** 頁を開いたときの stamp と URL。変われば中身はネットの物 */
  const first = useRef<string | null>(null);
  const where = `${stamp} ${pathname}?${search}`;

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${CACHED_AT_META}"]`);
    if (first.current === null) {
      first.current = where;
      setCachedAt(meta?.content || null);
    } else if (first.current !== where) {
      meta?.remove();
      setCachedAt(null);
    }
  }, [where]);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const pending = queue?.items.length ?? 0;
  if (!cachedAt && !offline && pending === 0) return null;
  const phone = isPhonePath(pathname);
  return (
    <div role="status" className={`mt-px bg-panel print:hidden ${phone ? "font-ud text-lg" : "text-sm"}`} data-offline-band>
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
        {cachedAt && (
          <span className="inline-flex items-center gap-1.5" data-cached-at={cachedAt}>
            <StateTag tone="check" size={phone ? "md" : "sm"}>
              {OFFLINE_LABELS.copy}
            </StateTag>
            <span className="font-bold tabular-nums">{copyTime(cachedAt)}</span>
          </span>
        )}
        {offline && (
          <span data-offline>
            <StateTag tone="unknown" size={phone ? "md" : "sm"}>
              {OFFLINE_LABELS.offline}
            </StateTag>
          </span>
        )}
        {pending > 0 && (
          <span className="text-muted tabular-nums" data-pending-calls={pending}>
            {OFFLINE_LABELS.pending} {pending}
          </span>
        )}
        {cachedAt && (
          <Button size={phone ? "lg" : "sm"} icon={RetryIcon} onClick={() => window.location.reload()} data-offline-reload>
            {OFFLINE_LABELS.reload}
          </Button>
        )}
      </div>
    </div>
  );
}
