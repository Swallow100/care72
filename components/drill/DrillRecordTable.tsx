// 訓練記録の表（/drill の下。app/drill/page.tsx から分けた。T80）。開始・想定・経過・状態・開始者と、再生（進行中は再開）・印刷。
// 375 で崩れていた（「印刷」が右で切れ、経過・想定・状態が 1〜2 字ずつ折れる。2 回目の点検）ので、640px 未満は
// 経過を想定の下、開始者を開始の下に畳み（列は省かず畳む。担当一覧の 375 と同じ考え）、操作のボタンを縦に積む。
// 想定・状態・数字は 1 字ずつ折らない塊にする。1280 の並びは前のまま（経過の列は見出しが「経過」なので値の頭の「経過」を重ねない）。

import { ButtonLink } from "@/components/ui/Button";
import { PlayIcon, PrintIcon } from "@/components/ui/Icon";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import { shortJst } from "@/lib/disaster/state";
import type { DrillListItem } from "@/lib/drill/db";
import { DRILL_LABELS, SCENARIO_LABELS, STATUS_LABELS, T70_LABELS } from "@/lib/drill/labels";
import { drillHref, reportHref } from "@/lib/drill/paths";
import { lastHour, scenarioOf } from "@/lib/drill/scenarios";
import { SCORE_LABELS } from "@/lib/drill/score-labels";

/** 640px 以上だけの列 */
const WIDE = "hidden sm:table-cell";

/** 「72 / 72」は折らず、「時間」の前でだけ折れる */
function Progress({ hour, last }: { hour: number; last: number }) {
  return (
    <>
      <span className="whitespace-nowrap">
        {hour} / {last}
      </span>{" "}
      {DRILL_LABELS.hours}
    </>
  );
}

export function DrillRecordTable({ items }: { items: ReadonlyArray<DrillListItem> }) {
  return (
    <div className={TABLE_BOX}>
      <table className={TABLE} data-table="drills">
        <thead>
          <tr>
            <th className={TH}>{DRILL_LABELS.startedAt}</th>
            <th className={TH}>{DRILL_LABELS.scenario}</th>
            <th className={`${TH} ${WIDE}`}>{DRILL_LABELS.elapsed}</th>
            <th className={TH}>{DRILL_LABELS.status}</th>
            <th className={`${TH} ${WIDE}`}>{DRILL_LABELS.startedBy}</th>
            <th className={TH}>
              <span className="sr-only">{DRILL_LABELS.replay}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className={`${TD} text-muted`}>
                {DRILL_LABELS.none}
              </td>
            </tr>
          )}
          {items.map((d) => {
            const last = lastHour(scenarioOf(d.scenario));
            const by = d.started_by_name ?? <span className="text-muted">—</span>;
            return (
              <tr key={d.id} data-drill={d.id} data-status={d.status}>
                <td className={`${TD} tabular-nums`}>
                  {shortJst(d.started_at)}
                  <span className="block text-xs text-muted sm:hidden" data-narrow="started-by">
                    <span className="sr-only">{DRILL_LABELS.startedBy} </span>
                    {by}
                  </span>
                </td>
                <td className={`${TD} font-bold`}>
                  <span className="whitespace-nowrap">{SCENARIO_LABELS[d.scenario]}</span>
                  <span className="block text-xs font-normal text-muted tabular-nums sm:hidden" data-narrow="elapsed">
                    {DRILL_LABELS.elapsed} <Progress hour={d.sim_hour} last={last} />
                  </span>
                </td>
                <td className={`${TD} ${WIDE} tabular-nums`}>
                  <Progress hour={d.sim_hour} last={last} />
                </td>
                <td className={`${TD} whitespace-nowrap ${d.status === "running" ? "font-bold" : d.status === "abandoned" ? "text-muted" : ""}`}>
                  {STATUS_LABELS[d.status]}
                  {d.abandon_reason === "24h" && (
                    <span className="block text-xs text-muted sm:ml-1.5 sm:inline" data-abandon-reason="24h">
                      {T70_LABELS.day}
                    </span>
                  )}
                </td>
                <td className={`${TD} ${WIDE}`}>{by}</td>
                <td className={`${TD} w-px py-1 text-right`}>
                  <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:justify-end sm:gap-1.5">
                    <ButtonLink href={drillHref(d.id)} kind="plain" size="sm" icon={PlayIcon}>
                      {d.status === "running" ? DRILL_LABELS.resume : DRILL_LABELS.replay}
                    </ButtonLink>
                    {/* 訓練記録の紙面（T22）。終わった・中断した訓練だけ。開いてすぐ印刷の画面（?print=1） */}
                    {d.status !== "running" && (
                      <ButtonLink href={reportHref(d.id, { print: true })} kind="plain" size="sm" icon={PrintIcon} data-print-link="drill">
                        {SCORE_LABELS.print}
                      </ButtonLink>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
