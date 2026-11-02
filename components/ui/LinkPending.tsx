"use client";

import { useLinkStatus } from "next/link";

/**
 * Link の中に置くと、押してから次の画面が出るまで、押したときと同じ灰色を残す（押したのに反応が無く見えるのを防ぐ）。
 * 親の Link に relative が要る。角は親に合わせる
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={pending ? "pointer-events-none absolute inset-0 rounded-[inherit] bg-press" : "hidden"} />;
}
