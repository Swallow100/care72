// 雨の凡例（T151）。平時の本物の雨雲（components/map/NowcastLayer.tsx）と訓練の筋書きの雨（CaseMap の Rain）で同じ 1 つの部品。
// 地図の右下の小さな帯: 上に見出し（本物は「02:20 時点」、訓練は「想定」）と単位、1 時間の降水量の 8 段の色の帯（左が弱い）、
// 帯の下に段の境の値（1・5・10・20・30・50・80）。出典はここに置かず、地図の下の出典の行（CaseMap の MapSource）に置く。
// 色は lib/map/rain-scale.ts（気象庁の降水ナウキャストの凡例と同じ 8 段と色）。見本は透かさない。いちばん弱い段は白に近いので、帯を細い線で囲む。
// 前は本物の雨雲の凡例が気象庁の凡例の画像・時刻・出典の長い 1 文の白い四角で、小さな地図の半分ほどを隠していた（T151）。

import { RAIN_STEPS } from "@/lib/map/rain-scale";

/** 色の見本 1 段の幅（px）。境の値の 2 桁が隣と重ならない幅 */
export const LEGEND_CHIP_W = 15;

export function RainScaleLegend({ head, label, kind }: { head: string; label: string; kind: "nowcast" | "drill" }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="pointer-events-none absolute right-1 bottom-1 z-30 rounded bg-panel px-1 pt-0.5 pb-0 text-[10px] leading-3 text-ink"
      data-rain-legend={kind}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-bold tabular-nums" data-rain-legend-head>
          {head}
        </span>
        <span className="text-muted">mm/h</span>
      </div>
      <div className="mt-0.5 flex overflow-hidden rounded-sm ring-1 ring-ink/25">
        {RAIN_STEPS.map((s) => (
          <span key={s.min} className="block h-1.5" title={s.label} data-rain-legend-step={s.min} style={{ background: s.color, width: LEGEND_CHIP_W }} />
        ))}
      </div>
      <div className="relative h-3 tabular-nums" style={{ width: LEGEND_CHIP_W * RAIN_STEPS.length }}>
        {RAIN_STEPS.slice(1).map((s, i) => (
          <span key={s.min} className="absolute top-0 -translate-x-1/2" style={{ left: LEGEND_CHIP_W * (i + 1) }} data-rain-legend-bound={s.min}>
            {s.min}
          </span>
        ))}
      </div>
    </div>
  );
}
