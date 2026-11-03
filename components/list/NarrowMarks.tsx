// 医療の印を時計のいちばん短い残りつきで（「酸素 4h」。本人のページの上〔PersonHead〕と同じ部品・色）。
// 表の狭い幅（768px 未満）で医療の列を省くとき、氏名の下に 1 行で出す。768px 以上は医療の列があるので出さない（T54）。
// 担当一覧（平時・発災時・訓練）と受け持ちの表で同じ物。横に送らないよう、収まらなければ折り返す
// （印の並びも、印の中の項目名と残りの間も。印が氏名の列を広げて表が幅を超えないように）。

import { Mark } from "@/components/ui/Tag";
import type { MarkItem } from "@/lib/person";

export function NarrowMarks({
  items,
  fallback = [],
}: {
  items: ReadonlyArray<MarkItem>;
  /** 時計の無い人（その場で登録した人）の代わりの印（台帳の機器）。受け持ちの表の医療の列と同じ */
  fallback?: ReadonlyArray<string>;
}) {
  if (items.length === 0 && fallback.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1 md:hidden" data-narrow-marks>
      {items.length > 0
        ? items.map((m) => (
            <Mark key={m.label} tone={m.tone ?? null} wrap>
              {m.remaining ? `${m.label} ${m.remaining}` : m.label}
            </Mark>
          ))
        : fallback.map((d) => (
            <Mark key={d} wrap>
              {d}
            </Mark>
          ))}
    </div>
  );
}
