import { CountLabel, countClass } from "@/components/ui/Tag";
import { COLOR_LABELS } from "@/lib/labels";
import { COLOR_TONES } from "@/lib/person";
import type { Color } from "@/lib/triage/index";

const ORDER: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

/** 色ごとの人数（至急・要確認・不明・無事）。1 人以上は言葉を状態の塗りの印に、数は本文色。0 人は印も数も灰（components/ui/Tag の CountLabel）。担当一覧・事業所・様式 9 で同じ形 */
export function ColorCounts({ counts, className = "" }: { counts: Record<Color, number>; className?: string }) {
  return (
    <dl className={`flex flex-wrap gap-x-3 text-sm ${className}`}>
      {ORDER.map((c) => (
        <div key={c} className="flex items-baseline gap-1">
          <dt className="text-muted">
            <CountLabel tone={COLOR_TONES[c]} count={counts[c]}>
              {COLOR_LABELS[c]}
            </CountLabel>
          </dt>
          <dd
            className={`font-bold tabular-nums ${countClass(counts[c])}`}
          >
            {counts[c]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function countColors(colors: ReadonlyArray<Color>): Record<Color, number> {
  const out: Record<Color, number> = { red: 0, yellow: 0, gray: 0, green: 0 };
  for (const c of colors) out[c] += 1;
  return out;
}
