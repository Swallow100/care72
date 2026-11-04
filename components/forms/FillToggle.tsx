// 紙面の帯（印刷で消える）の「色付け」（T101）。未記入の欄（帯の未確認と同じ欄）の矩形の内側を要確認の黄の薄い色で塗った版と、
// 色なしの版（既定。提出に使う紙）を ?fill=1 で切り替える。印刷はそのときの版で刷る。状態を持たない（リンクだけ）

import { ButtonLink } from "@/components/ui/Button";
import { FillIcon } from "@/components/ui/Icon";

export const FILL_LABELS = { on: "色付け", off: "色なし" } as const;

/** searchParams の fill が "1" か */
export function wantsFill(v: string | string[] | undefined): boolean {
  return v === "1";
}

/** here は紙面の頁の道（?なし）。ほかに残す問い（view など）は keep に */
export function FillToggle({ here, fill, keep = {} }: { here: string; fill: boolean; keep?: Record<string, string> }) {
  const q = new URLSearchParams(keep);
  if (!fill) q.set("fill", "1");
  const href = q.size > 0 ? `${here}?${q.toString()}` : here;
  return (
    <ButtonLink href={href} kind="plain" icon={FillIcon} aria-pressed={fill} data-fill-toggle={fill ? "on" : "off"}>
      {fill ? FILL_LABELS.off : FILL_LABELS.on}
    </ButtonLink>
  );
}
