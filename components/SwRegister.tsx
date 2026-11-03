"use client";

// Service Worker（public/sw.js）を入れる（T71）。無い端末は何もしない。
// 画面の中の移り（Next の Link・?open= の行）は ?_rsc= の読み込みで HTML が SW を通らないので、
// 頁が変わるたびと頁が隠れるとき（電話の画面へ移るなど）に「今の頁を写して」と SW に知らせる。
// 写すかどうか（写す頁か・前の写しから間があるか）は SW が決める。
//
// 古い SW の始末: SW_ENABLED を false にして配信すると、開いた端末で SW を外し、写しと部品を全部消す。
// SW の中身を変えるときは lib/offline/sw-core.js の CACHE_VERSION を上げる（activate で前の版の写しを消す）。

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { CACHE_PREFIX, KEEP_MESSAGE } from "@/lib/offline/labels";

export const SW_ENABLED = true;

/** 手元の next dev は部品の中身が同じ名前のまま変わるので、SW に部品も network-first にさせる */
const SW_URL = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";

export function SwRegister() {
  return (
    <Suspense fallback={null}>
      <Keeper />
    </Suspense>
  );
}

function Keeper() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return;
    if (!SW_ENABLED) {
      void removeAll(sw);
      return;
    }
    sw.register(SW_URL, { scope: "/", updateViaCache: "none" }).catch(() => {
      // 入らない端末（プライベートの窓など）は今までどおり
    });
    const onHide = () => {
      if (document.visibilityState === "hidden") keep(sw);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (sw && SW_ENABLED) keep(sw);
  }, [pathname, search]);

  return null;
}

function keep(sw: ServiceWorkerContainer) {
  if (!navigator.onLine) return;
  const url = window.location.href;
  sw.ready.then((reg) => reg.active?.postMessage({ type: KEEP_MESSAGE, url })).catch(() => {});
}

async function removeAll(sw: ServiceWorkerContainer) {
  try {
    for (const r of await sw.getRegistrations()) await r.unregister();
    for (const n of await caches.keys()) if (n.startsWith(CACHE_PREFIX)) await caches.delete(n);
  } catch {
    // 外せなければ次に開いたときにもう一度
  }
}
