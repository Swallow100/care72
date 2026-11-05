"use client";

// 上の帯の状態の印の置き場（T125）。訓練の画面（/drill/<id>）では事業所の今の状態の印を出さず、訓練の画面が置いた訓練の印
// （想定・規模・経過。lib/drill/header-mark.ts）を出す。ほかの画面は事業所の状態の印（children）のまま。
// 訓練の画面は components/drill/DrillHeaderMark で印を置き、離れると消す。印が置かれるまで（読み込みの間）は何も出さない（事業所の状態を一瞬も混ぜない）

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Mark } from "@/components/ui/Tag";
import { DRILL_HEADER_LABEL, type DrillHeaderMark } from "@/lib/drill/header-mark";

let current: DrillHeaderMark | null = null;
const listeners = new Set<() => void>();

/** 訓練の画面が印を置く・消す */
export function setDrillHeaderMark(m: DrillHeaderMark | null): void {
  current = m;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** 訓練の 1 回の画面か（一覧 /drill と記録の紙 /drill/<id>/report は事業所の印のまま） */
export const isDrillScreenPath = (path: string | null): boolean => !!path && /^\/drill\/[^/]+\/?$/.test(path);

export function HeaderMarkSlot({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const mark = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  if (!isDrillScreenPath(path)) return <>{children}</>;
  if (!mark) return null;
  return (
    <span aria-label="訓練の状態" className="inline-flex min-h-8 flex-wrap items-center gap-x-1.5 text-sm whitespace-nowrap" data-header-mark="drill">
      <Mark size="md">{DRILL_HEADER_LABEL}</Mark>
      <span className="font-bold">{mark.label}</span>
      {mark.details.map((d) => (
        <span key={d} className="font-bold tabular-nums">
          {d}
        </span>
      ))}
    </span>
  );
}
