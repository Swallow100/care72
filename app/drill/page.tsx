import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { StartButtons } from "@/components/drill/StartButtons";
import { ButtonLink } from "@/components/ui/Button";
import { PlayIcon, PrintIcon } from "@/components/ui/Icon";
import { Panel, PageHead } from "@/components/ui/Panel";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { drillGate, type DailyUsage } from "@/lib/claude/gate";
import { usageToday } from "@/lib/claude/usage";
import { LIMIT_LABELS } from "@/lib/seed/labels";
import { shortJst } from "@/lib/disaster/state";
import { drillScope, listDrills, type DrillListItem } from "@/lib/drill/db";
import { DRILL_LABELS, progressLabel, SCENARIO_LABELS, STATUS_LABELS } from "@/lib/drill/labels";
import { drillHref, reportHref } from "@/lib/drill/paths";
import { SCORE_LABELS } from "@/lib/drill/score-labels";
import { lastHour, SCENARIO_ORDER, scenarioOf } from "@/lib/drill/scenarios";

export const metadata: Metadata = { title: "訓練記録 | ケア72" };

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 訓練記録の一覧（事業所ごと。審査員の回も残る）と開始（大雨の想定・地震の想定・10 分版）。docs/tasks/T17.md。
// 進行中の訓練は事業所に 1 つ。あれば開始を押せず、一覧の進行中から再開（途中から続ける）。終わった・中断した訓練は再生（Claude を呼ばない）。
// ケアマネの役だけ（審査員のケアマネの役も）。デモ事業所の終わった訓練の種は T26
export default async function DrillPage() {
  const principal = await requirePage("drill");
  const scope = drillScope(principal);
  let items: DrillListItem[] = [];
  let usage: DailyUsage | null = null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    items = scope ? await listDrills(env.DB, scope.officeId) : [];
    // AI の 1 日の上限（T26）。読めなければ開始のまま
    usage = scope ? await aiContextFor(scope.officeId).then(usageToday).catch(() => null) : null;
  } catch (e) {
    console.error("訓練記録を読めない", e);
    return (
      <main className="mx-auto max-w-6xl px-4 py-4">
        <PageHead title={DRILL_LABELS.records} />
        <p className="mt-2 text-sm font-bold text-danger">読込失敗</p>
      </main>
    );
  }
  const running = items.find((d) => d.status === "running") ?? null;
  const gate = drillGate(usage, items);

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <PageHead title={DRILL_LABELS.records} count={`${items.length} 件`} />

      <Panel aria-labelledby="drill-start" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="drill-start" className="text-[1rem] font-bold">
          {DRILL_LABELS.start}
        </h2>
        {gate.kind === "start" ? (
          <StartButtons scenarios={SCENARIO_ORDER} disabled={running !== null} />
        ) : (
          // 上限に達したら開始でなく、終わった訓練の再生（0 時間から刻みごとに）
          <div className="flex flex-wrap items-center gap-2" data-limit>
            <span className="text-sm font-bold">{LIMIT_LABELS.reached}</span>
            {gate.replay && (
              <ButtonLink href={drillHref(gate.replay, { step: 0 })} kind="main" icon={PlayIcon}>
                {DRILL_LABELS.replay}
              </ButtonLink>
            )}
          </div>
        )}
        {gate.limit !== null && (
          <span className="text-sm text-muted tabular-nums" data-ai-remaining={gate.remaining}>
            {LIMIT_LABELS.ai} {LIMIT_LABELS.remaining} {gate.remaining} / {gate.limit} {LIMIT_LABELS.unit}
          </span>
        )}
        {running && (
          <ButtonLink href={drillHref(running.id)} kind="main" icon={PlayIcon} className="ml-auto">
            {DRILL_LABELS.resume} {SCENARIO_LABELS[running.scenario]} {progressLabel(running.sim_hour, lastHour(scenarioOf(running.scenario)))}
          </ButtonLink>
        )}
      </Panel>

      <div className={`mt-3 ${TABLE_BOX}`}>
        <table className={TABLE} data-table="drills">
          <thead>
            <tr>
              <th className={TH}>{DRILL_LABELS.startedAt}</th>
              <th className={TH}>{DRILL_LABELS.scenario}</th>
              <th className={TH}>{DRILL_LABELS.elapsed}</th>
              <th className={TH}>{DRILL_LABELS.status}</th>
              <th className={TH}>{DRILL_LABELS.startedBy}</th>
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
            {items.map((d) => (
              <tr key={d.id} data-drill={d.id} data-status={d.status}>
                <td className={`${TD} tabular-nums`}>{shortJst(d.started_at)}</td>
                <td className={`${TD} font-bold`}>{SCENARIO_LABELS[d.scenario]}</td>
                <td className={`${TD} tabular-nums`}>{progressLabel(d.sim_hour, lastHour(scenarioOf(d.scenario)))}</td>
                <td className={`${TD} ${d.status === "running" ? "font-bold" : d.status === "abandoned" ? "text-muted" : ""}`}>
                  {STATUS_LABELS[d.status]}
                </td>
                <td className={TD}>{d.started_by_name ?? <span className="text-muted">—</span>}</td>
                <td className={`${TD} w-px py-1 text-right`}>
                  <div className="flex justify-end gap-1.5">
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
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
