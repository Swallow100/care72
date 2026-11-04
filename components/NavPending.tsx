"use client";

// 画面を移る途中の印。リンクを押してから次の画面が出るまで、押した物に送信のボタン（components/ui/SubmitButton.tsx）と
// 同じ灰色（data-pending）を残し、150ms たっても移らなければ画面の上の端に操作の色の細い帯を出す（読み上げは「読込中」）。
// 次の画面が数秒かかるとき（電波の弱いスマホ・手元の開発のサーバー）、押しても何も変わらず反応しないと見えないように。
// HTML のフォームの送信（サーバーが 303 で移す）も、ほかの部品が止めなければ帯を出す（ボタンの灰色は SubmitButton が持つ）。
// 解くのは URL が変わったとき・戻る（bfcache）で戻ったとき・15 秒たっても移らないとき。帯は動きを減らす設定なら止めて出す。印刷には出さない。
// どのリンクで出すかは lib/ui/nav-pending.ts。

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { NAV_BAR_DELAY_MS, NAV_WAIT_LABEL, NAV_WAIT_MAX_MS, startsNavigation } from "@/lib/ui/nav-pending";

export function NavPending() {
  return (
    <Suspense fallback={null}>
      <Pending />
    </Suspense>
  );
}

function Pending() {
  const where = `${usePathname()}?${useSearchParams().toString()}`;
  const [waiting, setWaiting] = useState(false);
  const [bar, setBar] = useState(false);
  /** 灰色を残している a */
  const held = useRef<HTMLElement | null>(null);
  const timers = useRef<number[]>([]);
  const slider = useRef<HTMLDivElement>(null);

  const clear = useRef(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    held.current?.removeAttribute("data-pending");
    held.current?.removeAttribute("aria-busy");
    held.current = null;
    setWaiting(false);
    setBar(false);
  }).current;

  // URL が変わったら次の画面が出た
  useEffect(() => {
    clear();
  }, [where, clear]);

  useEffect(() => {
    const start = (el: HTMLElement | null) => {
      clear();
      if (el) {
        el.setAttribute("data-pending", "");
        el.setAttribute("aria-busy", "true");
        held.current = el;
      }
      setWaiting(true);
      timers.current.push(
        window.setTimeout(() => setBar(true), NAV_BAR_DELAY_MS),
        window.setTimeout(clear, NAV_WAIT_MAX_MS),
      );
    };
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!el) return;
      const anchor = { href: el.getAttribute("href") ?? "", target: el.target, download: el.hasAttribute("download") };
      if (startsNavigation(e, anchor, window.location.href)) start(el);
    };
    const onSubmit = (e: SubmitEvent) => {
      // ほかの部品の受け手（fetch で送る物・確認の窓）が止めたかは、受け手が済んでから見る
      window.setTimeout(() => {
        const form = e.target instanceof HTMLFormElement ? e.target : null;
        if (!e.defaultPrevented && form && (form.target === "" || form.target === "_self")) start(null);
      }, 0);
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) clear();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
      clear();
    };
  }, [clear]);

  // 帯の動き: 操作の色の短い帯が左から右へ流れ続ける。動きを減らす設定と animate の無い環境では止めて出す
  useEffect(() => {
    const el = slider.current;
    if (!bar || !el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof el.animate !== "function") return;
    const run = el.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(400%)" }], {
      duration: 1100,
      iterations: Infinity,
      easing: "ease-in-out",
    });
    return () => run.cancel();
  }, [bar]);

  return (
    <>
      <span role="status" className="sr-only">
        {waiting ? NAV_WAIT_LABEL : ""}
      </span>
      {bar && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden print:hidden" data-nav-pending>
          <div ref={slider} className="h-full w-1/4 bg-accent" />
        </div>
      )}
    </>
  );
}
