// 人数を押すとその色で絞る（href を渡したとき。T58）。もう一度押すと解除。人数は絞る前の数（絞っても別の色を押せる）。
// 担当一覧の発災時の上の数字（docs/tasks/T13.md「上の数字」）。至急・要確認・不明・無事の人数を大きく。
// 1 人以上は横の言葉を状態の塗りの印に、数は本文色。0 人は印も数も灰（components/ui/Tag の CountLabel、DECISIONS 11/4 00:5x、T66）。横に発災と停電からの経過、時点。市役所向けの集計はこの人数で足りる（docs/SPEC.md「画面 6」）。

import Link from "next/link";
import { CountLabel, countClass, StateTag } from "@/components/ui/Tag";
import { FILTER_LABELS } from "@/lib/list/labels";
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
  href,
  current = null,
}: {
  counts: Record<Color, number>;
  /** 発災からの経過「5 時間」 */
  disaster: string | null;
  /** 停電からの経過「3 時間」。停電なしは null。地区だけなら area */
  outage: { elapsed: string | null; area: boolean } | null;
  /** 時点「11/5 21:00」 */
  at: string;
  /** 人数を押したときの行き先（その色で絞る）。無ければ押せない */
  href?: (c: Color) => string;
  /** 今絞っている色 */
  current?: Color | null;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2" data-summary>
      {href ? (
        // 押せる人数（T58）。選んだ色は枠（下地を敷かない）。押したときは灰色だけ
        <div className="flex flex-wrap items-end gap-x-2">
          {ORDER.map((c) => (
            <Link
              key={c}
              href={href(c)}
              aria-label={`${COLOR_LABELS[c]} ${counts[c]} ${FILTER_LABELS.title}`}
              aria-current={current === c ? "true" : undefined}
              className={`flex items-baseline gap-1.5 rounded px-1.5 py-1 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${
                current === c ? "outline-2 -outline-offset-2 outline-solid outline-accent" : ""
              }`}
              data-press
              data-count={c}
              data-count-link={c}
            >
              <span className="text-sm text-muted">
                <CountLabel tone={COLOR_TONES[c]} count={counts[c]} size="md">
                  {COLOR_LABELS[c]}
                </CountLabel>
              </span>
              <span
                className={`text-3xl font-bold leading-none tabular-nums ${countClass(counts[c])}`}
              >
                {counts[c]}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <dl className="flex flex-wrap items-end gap-x-4">
          {ORDER.map((c) => (
            <div key={c} className="flex items-baseline gap-1.5" data-count={c}>
              <dt className="text-sm text-muted">
                <CountLabel tone={COLOR_TONES[c]} count={counts[c]} size="md">
                  {COLOR_LABELS[c]}
                </CountLabel>
              </dt>
              <dd
                className={`text-3xl font-bold leading-none tabular-nums ${countClass(counts[c])}`}
              >
                {counts[c]}
              </dd>
            </div>
          ))}
        </dl>
      )}
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
