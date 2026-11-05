// 紙面の帯（印刷で消える）の空欄の色付け（T101）。未記入の欄（帯の未確認と同じ欄）の矩形の内側を要確認の黄の薄い色で塗った版と、
// 色なしの版（既定。提出に使う紙）を ?fill=1 で切り替える。印刷はそのときの版で刷る。状態を持たない（リンクだけ）。
// T147: 押すと何が変わるか分かるよう、2 つの版を並べて今の版に印（太字と下線。下地は敷かない）。「色なし」が提出用の既定

import Link from "next/link";
import { FillIcon } from "@/components/ui/Icon";

export const FILL_LABELS = { on: "空欄着色", off: "色なし", group: "空欄の色" } as const;

/** searchParams の fill が "1" か */
export function wantsFill(v: string | string[] | undefined): boolean {
  return v === "1";
}

/** 版の道（fill が真なら ?fill=1、ほかに残す問いは keep に） */
export function fillHref(here: string, fill: boolean, keep: Record<string, string> = {}): string {
  const q = new URLSearchParams(keep);
  if (fill) q.set("fill", "1");
  return q.size > 0 ? `${here}?${q.toString()}` : here;
}

/** here は紙面の頁の道（?なし）。ほかに残す問い（view など）は keep に */
export function FillToggle({ here, fill, keep = {} }: { here: string; fill: boolean; keep?: Record<string, string> }) {
  const item = (on: boolean) => {
    const current = on === fill;
    return (
      <Link
        href={fillHref(here, on, keep)}
        aria-current={current ? "true" : undefined}
        className={`relative -mx-0.5 rounded px-1.5 py-1 text-sm ${current ? "font-bold text-ink underline decoration-2 underline-offset-[6px]" : "text-muted"}`}
        data-press
        data-fill-option={on ? "on" : "off"}
      >
        {on ? FILL_LABELS.on : FILL_LABELS.off}
      </Link>
    );
  };
  return (
    <span role="group" aria-label={FILL_LABELS.group} className="inline-flex items-center gap-1" data-fill-toggle={fill ? "on" : "off"}>
      <FillIcon aria-hidden className="size-4 shrink-0 text-muted" />
      {item(false)}
      {item(true)}
    </span>
  );
}
