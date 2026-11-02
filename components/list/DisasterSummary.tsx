// 担当一覧の発災時の上の数字（docs/tasks/T13.md「上の数字」）。至急・要確認・未知・無事の人数を大きく、意味の色で
// （0 は色なし）。横に発災と停電からの経過、時点。市役所向けの集計はこの人数で足りる（docs/SPEC.md「画面 6」）。

import { TONE_TEXT } from "@/components/person/parts";
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
            <dt className="text-sm text-muted">{COLOR_LABELS[c]}</dt>
            <dd
              className={`text-3xl font-bold leading-none tabular-nums ${counts[c] > 0 ? TONE_TEXT[COLOR_TONES[c]] : "text-muted"}`}
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
            <dt className="text-muted">
              {DETAIL_LABELS.elapsedOutage}
              {outage.area ? "（地区）" : ""}
            </dt>
            <dd className="text-lg font-bold tabular-nums text-state-check">{outage.elapsed ?? "—"}</dd>
          </div>
        )}
        <div className="text-xs text-muted tabular-nums">
          {at} {DETAIL_LABELS.at}
        </div>
      </dl>
    </div>
  );
}
