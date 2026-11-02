// 担当一覧の発災時の上の数字（docs/tasks/T13.md「上の数字」）。至急・要確認・未知・無事の人数を大きく、意味の色で
// （0 は色なし。要確認は数を本文色のまま、横の言葉を黄の塗りの印に。11/3 08:0x の確定 4）。横に発災と停電からの経過、時点。市役所向けの集計はこの人数で足りる（docs/SPEC.md「画面 6」）。

import { CountLabel, countClass, StateTag } from "@/components/ui/Tag";
import { COLOR_LABELS } from "@/lib/labels";
import { DETAIL_LABELS } from "@/lib/list/labels";
import { COLOR_TONES } from "@/lib/person";
import type { Color } from "@/lib/triage/index";

const ORDER: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

export function DisasterSummary({
  counts,
  disaster,
  outage,
  at,
}: {
  counts: Record<Color, number>;
  /** 発災からの経過「5 時間」 */
  disaster: string | null;
  /** 停電からの経過「3 時間」。停電なしは null。地区だけなら area */
  outage: { elapsed: string | null; area: boolean } | null;
  /** 時点「11/5 21:00」 */
  at: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2" data-summary>
      <dl className="flex flex-wrap items-end gap-x-4">
        {ORDER.map((c) => (
          <div key={c} className="flex items-baseline gap-1.5" data-count={c}>
            <dt className="text-sm text-muted">
              <CountLabel tone={COLOR_TONES[c]} count={counts[c]} size="md">
                {COLOR_LABELS[c]}
              </CountLabel>
            </dt>
            <dd
              className={`text-3xl font-bold leading-none tabular-nums ${countClass(COLOR_TONES[c], counts[c])}`}
              data-tone={counts[c] > 0 ? COLOR_TONES[c] : undefined}
            >
              {counts[c]}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="flex flex-wrap items-baseline gap-x-4 text-sm">
        {disaster && (
          <div className="flex items-baseline gap-1.5" data-elapsed="disaster">
            <dt className="text-muted">{DETAIL_LABELS.elapsedDisaster}</dt>
            <dd className="text-lg font-bold tabular-nums">{disaster}</dd>
          </div>
        )}
        {outage && (
          <div className="flex items-baseline gap-1.5" data-elapsed="outage">
            {/* 停電は要確認の黄。上の人数と同じく、大きな数は本文色のまま言葉を黄の塗りの印に */}
            <dt>
              <StateTag tone="check">
                {DETAIL_LABELS.elapsedOutage}
                {outage.area ? "（地区）" : ""}
              </StateTag>
            </dt>
            <dd className="text-lg font-bold tabular-nums">{outage.elapsed ?? "—"}</dd>
          </div>
        )}
        <div className="text-xs text-muted tabular-nums">
          {at} {DETAIL_LABELS.at}
        </div>
      </dl>
    </div>
  );
}
