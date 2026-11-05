"use client";

// 紙の上で入れている間に頁を離れるときの確かめ（T147。components/forms/PaperFill.tsx と Form9Fill.tsx）。
// - 閉じる・読み直す・外の頁へ: ブラウザの確かめ（beforeunload）
// - アプリの中の頁へ（リンク）: 送っている間は待ち（上限 5 秒）、未保存・保存失敗なら「破棄移動」の確かめ（appConfirm）
// root の中のリンク（行き先の横の本人のページなど）・別のタブ・落とす物は止めない

import { useRouter } from "next/navigation";
import { useEffect, type RefObject } from "react";
import { FILL_LABELS as L } from "@/lib/forms/paper-fill";
import { appConfirm } from "@/lib/ui/dialog";

export type LeaveState = { unsaved: boolean; pending: number };

export function useLeaveGuard(state: RefObject<LeaveState>, root: RefObject<HTMLElement | null>): void {
  const router = useRouter();
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!state.current.unsaved && state.current.pending === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || root.current?.contains(a)) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (!state.current.unsaved && state.current.pending === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        for (let i = 0; i < 50 && state.current.pending > 0; i++) await new Promise((r) => setTimeout(r, 100));
        if (state.current.unsaved || state.current.pending > 0) {
          const ok = await appConfirm(L.leave, { title: L.unsaved, ok: L.leaveOk, danger: true, icon: "CloseIcon" });
          if (!ok) return;
        }
        router.push(url.pathname + url.search + url.hash);
      })();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [router, state, root]);
}
