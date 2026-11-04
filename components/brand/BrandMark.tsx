// 作品の印（ロゴ）を読む 1 か所。ヘッダーの左上・ログイン・役選択はここから読む。
// ロゴが決まるまでは今の印（components/login/Mark72 の 72 時間の輪）。差し替えるときはこのファイルだけ直す。
// still: 最初から満ちた形で動かさない（ヘッダー）。無ければ開いたときに一度だけ満ちる（ログイン・役選択）。

import { Mark72 } from "@/components/login/Mark72";

export function BrandMark({ size, still = false, className = "" }: { size: number; still?: boolean; className?: string }) {
  return <Mark72 size={size} still={still} className={className} />;
}
