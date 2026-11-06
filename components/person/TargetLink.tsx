"use client";

// 飛んだ先の案内（T169）の動き。未確認の印を押すと URL の field を付け直し、サーバーが対象の欄に紫を付ける（lib/person.ts の toPersonView）。
// 送るのは画面全体の縦 1 本なので、最初の対象（data-target）を画面の真ん中へ。上の帯に隠れないよう真ん中にする。

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** root の中の最初の対象まで送る */
export function scrollToTarget(root: ParentNode = document): HTMLElement | null {
  const el = root.querySelector<HTMLElement>("[data-target]");
  el?.scrollIntoView({ block: "center" });
  return el;
}

/** 未確認の印のリンク。今の画面（担当一覧の右の面・単独の本人のページ）のまま field だけ変える */
export function TargetLink({ focus, className = "", children }: { focus: string; className?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const params = new URLSearchParams(search?.toString() ?? "");
  params.set("field", focus);
  return (
    <Link
      href={`${pathname ?? ""}?${params.toString()}`}
      replace
      scroll={false}
      className={`underline underline-offset-2 ${className}`.trim()}
      data-press
      data-jump={focus}
      // 同じ物をもう一度押したときは URL が変わらないので、ここで送る
      onClick={() => {
        if (search?.get("field") === focus) scrollToTarget();
      }}
    >
      {children}
    </Link>
  );
}

/** 開いたとき・飛ぶ先が変わったときに、最初の対象まで送る。保存で対象が減っても送り直さない（入れている所から動かさない） */
export function TargetScroll({ focus }: { focus: string }) {
  useEffect(() => {
    scrollToTarget();
  }, [focus]);
  return null;
}
