import { TONE_TEXT } from "@/components/person/parts";
import { COLOR_LABELS } from "@/lib/labels";
import { COLOR_TONES } from "@/lib/person";
import type { Color } from "@/lib/triage/index";

const ORDER: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

/** 色ごとの人数（至急・要確認・未知・無事）。数字に状態の色（0 は色なし）。担当一覧・事業所・様式 9 で同じ形 */
export function ColorCounts({ counts, className = "" }: { counts: Record<Color, number>; className?: string }) {
  return (
    <dl className={`flex flex-wrap gap-x-3 text-sm ${className}`}>
      {ORDER.map((c) => (
        <div key={c} className="flex items-baseline gap-1">
          <dt className="text-muted">{COLOR_LABELS[c]}</dt>
          <dd
            className={`font-bold tabular-nums ${counts[c] > 0 ? TONE_TEXT[COLOR_TONES[c]] : "text-muted"}`}
            data-tone={counts[c] > 0 ? COLOR_TONES[c] : undefined}
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
