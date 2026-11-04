import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { DrillRecordTable } from "@/components/drill/DrillRecordTable";
import { StartButtons, type StartPerson } from "@/components/drill/StartButtons";
import { ButtonLink } from "@/components/ui/Button";
import { PlayIcon } from "@/components/ui/Icon";
import { Panel, PageHead } from "@/components/ui/Panel";
import { requirePage } from "@/lib/auth/server";
import { AiStatusMark } from "@/components/ui/AiStatus";
import { aiStatusFor } from "@/lib/claude/cloudflare";
import { drillGate, gateUsage } from "@/lib/claude/gate";
import type { AiStatus } from "@/lib/claude/status";
import { caseloadForDrill, drillScope, listDrills, runningDrillId, type DrillListItem } from "@/lib/drill/db";
import { DRILL_LABELS, progressLabel, SCENARIO_LABELS, VIRTUAL_LABELS } from "@/lib/drill/labels";
import { endingsAllowed } from "@/lib/drill/fiction";
import { drillHref } from "@/lib/drill/paths";
import { lastHour, SCENARIO_ORDER, scenarioOf } from "@/lib/drill/scenarios";

export const metadata: Metadata = { title: "訓練記録 | ケア72" };

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 訓練記録の一覧（事業所ごと。審査員の回も残る）と開始（大雨想定・地震想定・10 分版）。docs/tasks/T17.md。
// 進行中の訓練はケアマネごとに 1 つ（T70）。自分の進行中があれば開始を押せず、一覧の進行中から再開（途中から続ける）。24 時間たった進行中は読むときに中断。終わった・中断した訓練は再生（Claude を呼ばない）。
// ケアマネの役だけ（審査員のケアマネの役も）。デモ事業所の終わった訓練の種は T26
// AI の状態（T76）: 未設定（鍵なし）・上限到達・本日残りを lib/claude/status.ts の 1 か所で読み、開始の欄に見込みと並べる（StartButtons）。
// 鍵が無くても開始は止めない（固定の筋は想定の表で進み、仮想は世界が止まる。その言葉を想定ごとに出す）。上限到達は今までどおり再生（T26）
export default async function DrillPage() {
  const principal = await requirePage("drill");
  const scope = drillScope(principal);
  let items: DrillListItem[] = [];
  let ai: AiStatus | null = null;
  // 開始の前の設定の参加者（T59。担当一覧の人）
  let people: StartPerson[] = [];
  // 自分の進行中（T70。開始者か担当一覧の人で見る。ほかのケアマネの進行中では開始を止めない）
  let mine: string | null = null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    // 24 時間たった進行中は読む前に中断（T70）
    items = scope ? await listDrills(env.DB, scope.officeId, 50, new Date().toISOString()) : [];
    people = scope ? await caseloadForDrill(env.DB, scope) : [];
    mine = scope ? await runningDrillId(env.DB, scope.officeId, { scope }) : null;
    // AI の今の状態（T76。1 日の上限は T26）。読めなければ開始のまま
    ai = scope ? await aiStatusFor(scope.officeId).catch(() => null) : null;
  } catch (e) {
    console.error("訓練記録を読めない", e);
    return (
      <main className="mx-auto max-w-6xl px-4 py-4">
        <PageHead title={DRILL_LABELS.records} />
        <p className="mt-2 text-sm font-bold text-danger">読込失敗</p>
      </main>
    );
  }
  // 進行中はケアマネごとに 1 つ（T70。審査員は同じアカウントなので共有）。ほかのケアマネの進行中は一覧から再開できる
  const running = items.find((d) => d.id === mine) ?? null;
  const gate = drillGate(gateUsage(ai), items);

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <PageHead title={DRILL_LABELS.records} count={`${items.length} 件`} />

      <Panel aria-labelledby="drill-start" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="drill-start" className="text-[1rem] font-bold">
          {DRILL_LABELS.start}
        </h2>
        {gate.kind === "start" ? (
          <StartButtons scenarios={SCENARIO_ORDER} disabled={running !== null} people={people} ai={ai} />
        ) : (
          // 上限に達したら開始でなく、終わった訓練の再生（0 時間から刻みごとに）
          <div className="flex flex-wrap items-center gap-2" data-limit>
            {ai && <AiStatusMark status={ai} size="md" />}
            {gate.replay && (
              <ButtonLink href={drillHref(gate.replay, { step: 0 })} kind="main" icon={PlayIcon}>
                {DRILL_LABELS.replay}
              </ButtonLink>
            )}
          </div>
        )}
        {running && (
          <ButtonLink href={drillHref(running.id)} kind="main" icon={PlayIcon} className="ml-auto">
            {DRILL_LABELS.resume} {SCENARIO_LABELS[running.scenario]} {progressLabel(running.sim_hour, lastHour(scenarioOf(running.scenario)))}
          </ButtonLink>
        )}
        {gate.kind === "start" && (
          // 仮想モード（T50）の 1 行
          <p className="w-full text-sm text-muted" data-virtual-note>
            {scope && !endingsAllowed(scope.officeId) ? VIRTUAL_LABELS.noteRole : VIRTUAL_LABELS.note}
          </p>
        )}
      </Panel>

      <div className="mt-3">
        <DrillRecordTable items={items} />
      </div>
    </main>
  );
}
