import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { StartButtons } from "@/components/drill/StartButtons";
import { requirePage } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { drillGate, type DailyUsage } from "@/lib/claude/gate";
import { usageToday } from "@/lib/claude/usage";
import { LIMIT_LABELS } from "@/lib/seed/labels";
import { shortJst } from "@/lib/disaster/state";
import { drillScope, listDrills, type DrillListItem } from "@/lib/drill/db";
import { DRILL_LABELS, progressLabel, SCENARIO_LABELS, STATUS_LABELS } from "@/lib/drill/labels";
import { drillHref } from "@/lib/drill/paths";
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
      <main className="mx-auto max-w-6xl px-4 py-6">
        <p className="rounded-lg bg-panel p-6 font-bold">読込失敗</p>
      </main>
    );
  }
  const running = items.find((d) => d.status === "running") ?? null;
  const gate = drillGate(usage, items);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold">{DRILL_LABELS.records}</h1>
        <span className="text-muted tabular-nums">{items.length} 件</span>
      </div>

      <section aria-labelledby="drill-start" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-panel px-4 py-3">
        <h2 id="drill-start" className="text-sm font-bold text-muted">
          {DRILL_LABELS.start}
        </h2>
        {gate.kind === "start" ? (
          <StartButtons scenarios={SCENARIO_ORDER} disabled={running !== null} />
        ) : (
          // 上限に達したら開始でなく、終わった訓練の再生（0 時間から刻みごとに）
          <div className="flex flex-wrap items-center gap-2" data-limit>
            <span className="text-sm font-bold">{LIMIT_LABELS.reached}</span>
            {gate.replay && (
              <Link href={drillHref(gate.replay, { step: 0 })} className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-on-accent" data-press="overlay">
                {DRILL_LABELS.replay}
              </Link>
            )}
          </div>
        )}
        {gate.limit !== null && (
          <span className="text-sm text-muted tabular-nums" data-ai-remaining={gate.remaining}>
            {LIMIT_LABELS.ai} {LIMIT_LABELS.remaining} {gate.remaining} / {gate.limit} {LIMIT_LABELS.unit}
          </span>
        )}
        {running && (
          <Link href={drillHref(running.id)} className="ml-auto rounded px-2 py-1 text-sm font-bold text-accent" data-press>
            {DRILL_LABELS.resume} {SCENARIO_LABELS[running.scenario]} {progressLabel(running.sim_hour, lastHour(scenarioOf(running.scenario)))}
          </Link>
        )}
      </section>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg bg-panel p-6 text-muted">{DRILL_LABELS.none}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-y-0.5 text-left text-sm" data-table="drills">
            <thead>
              <tr className="whitespace-nowrap text-muted">
                <th className="px-3 py-2 font-normal">{DRILL_LABELS.startedAt}</th>
                <th className="px-3 py-2 font-normal">{DRILL_LABELS.scenario}</th>
                <th className="px-3 py-2 font-normal">{DRILL_LABELS.elapsed}</th>
                <th className="px-3 py-2 font-normal">{DRILL_LABELS.status}</th>
                <th className="px-3 py-2 font-normal">{DRILL_LABELS.startedBy}</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} data-drill={d.id} data-status={d.status}>
                  <td className="rounded-l-md bg-panel px-3 py-2 tabular-nums">{shortJst(d.started_at)}</td>
                  <td className="bg-panel px-3 py-2 font-bold">{SCENARIO_LABELS[d.scenario]}</td>
                  <td className="bg-panel px-3 py-2 tabular-nums">{progressLabel(d.sim_hour, lastHour(scenarioOf(d.scenario)))}</td>
                  <td className={`bg-panel px-3 py-2 ${d.status === "running" ? "font-bold" : d.status === "abandoned" ? "text-muted" : ""}`}>
                    {STATUS_LABELS[d.status]}
                  </td>
                  <td className="bg-panel px-3 py-2">{d.started_by_name ?? <span className="text-muted">—</span>}</td>
                  <td className="rounded-r-md bg-panel px-3 py-2 text-right">
                    <Link href={drillHref(d.id)} className="rounded px-2 py-1 font-bold text-accent" data-press>
                      {d.status === "running" ? DRILL_LABELS.resume : DRILL_LABELS.replay}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
