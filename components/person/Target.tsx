// 今入れる欄の印（T169）。見直し・未確認から飛んだ先の欄を紫（--mark-target）で示す。紫はこの意味にだけ使い、ほかの部品に使わない
// （使う所は lib/intake/t169.test.ts で確かめる）。色だけにせず「要入力」の印を添える。面は塗らず、枠と印だけ。
// 状態を持たない（Server Component のまま使える）。飛ぶリンクと送る動きは components/person/TargetLink.tsx。

import { TARGET_LABELS } from "@/lib/labels";

/** 欄の枠。外へ 2px 空けて、中の入力の枠と重ねない */
export const TARGET_EDGE = "rounded-sm outline-2 outline-offset-2 outline-solid outline-mark-target";

/** 欄の名前の字 */
export const TARGET_TEXT = "font-bold text-mark-target";

export function TargetTag() {
  return (
    <span className="inline-block rounded-sm bg-mark-target px-1 text-xs leading-[1.125rem] font-bold whitespace-nowrap text-on-mark-target" data-target-tag>
      {TARGET_LABELS.mark}
    </span>
  );
}

/** 面の編集の中の今入れる欄（枠と、上に印）。最初の 1 つまで送る（data-target） */
export function TargetBox({ children }: { children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${TARGET_EDGE}`} data-target="">
      <TargetTag />
      {children}
    </div>
  );
}
