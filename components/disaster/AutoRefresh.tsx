"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 災害モードの間、画面を 1 分ごとに読み直す（サーバーで今の時刻からルールの表を当て直す）。
// 長い処理を 1 要求で回さず、読み直しのたびに 1 回ずつ計算する。画面が隠れている間は読み直さない。
// router.refresh は client の部品の状態（入れる欄の文字など）を残したまま、サーバーの部品だけを描き直す。
// 通信が無い間は読み直さない（T71）。読み直しが落ちると Next は頁を開き直し、開いた行が閉じて写しに替わる。
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    }, seconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  return null;
}
