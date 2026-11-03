// 訓練の「AI 停止」の帯 1 本（T76。lib/drill/ai-stop.ts）。刻みごとに積まず、訓練の画面の上に 1 行。
// 「AI 停止 上限到達 経過 6 時間〜 想定のみ 翌日再開」。固定の筋は想定の表だけで進み、仮想は世界が止まる（engine の今の動き）。
// 色は使わない（中立の地の印と本文色。状態の 4 色は人の安否だけ）。375px で折り返す。

import { Mark } from "@/components/ui/Tag";
import { aiStopParts, type AiStopBand as Band } from "@/lib/drill/ai-stop";

export function AiStopBand({ band }: { band: Band | null }) {
  if (!band) return null;
  const p = aiStopParts(band);
  return (
    <p
      role="status"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-panel px-3 py-2 text-sm"
      data-ai-stop={band.reason}
      data-ai-stop-from={band.from}
      data-ai-stop-resume={band.resume ?? undefined}
    >
      <span className="font-bold">{p.title}</span>
      <Mark>{p.reason}</Mark>
      {p.span && <span className="tabular-nums">{p.span}</span>}
      <span className="font-bold" title={p.effectTitle} data-ai-stop-effect={band.virtual ? "virtual" : "fixed"}>
        {p.effect}
      </span>
      {p.resume && <span className="text-muted">{p.resume}</span>}
    </p>
  );
}
