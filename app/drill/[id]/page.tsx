import "@/components/drill/drill.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { countColors } from "@/components/disaster/ColorCounts";
import { DamagePanel } from "@/components/drill/DamagePanel";
import { DrillBar } from "@/components/drill/DrillBar";
import { DrillControls } from "@/components/drill/DrillControls";
import { DrillRowDetail } from "@/components/drill/DrillRowDetail";
import { Situation } from "@/components/drill/Situation";
import { DisasterSummary } from "@/components/list/DisasterSummary";
import { DisasterTable, type TableSlots } from "@/components/list/DisasterTable";
import { CaseMap } from "@/components/map/CaseMap";
import { requirePage } from "@/lib/auth/server";
import { sortCaseload, type SortKey } from "@/lib/caseload";
import { elapsedText, shortJst } from "@/lib/disaster/state";
import { drillScope, type DrillScope } from "@/lib/drill/db";
import { isDrillId } from "@/lib/drill/http";
import { DRILL_LABELS, elapsedLabel, SCENARIO_LABELS, STATUS_LABELS } from "@/lib/drill/labels";
import { DRILL_PATH, drillHref, parseSort, parseStep, parseView, type DrillView } from "@/lib/drill/paths";
import { scenarioOf } from "@/lib/drill/scenarios";
import { loadDrillScreen, type DrillScreen } from "@/lib/drill/view";
import { buildSidePane, sideDisasterOf } from "@/lib/map/side";

export const metadata: Metadata = { title: "訓練 | ケア72" };

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string | string[]; step?: string | string[]; view?: string | string[] }>;
};

// 訓練の画面（docs/tasks/T17.md、docs/SPEC.md「画面 4 訓練」）。横画面の分割:
// 上に 72 時間の棒と今の時刻、左に担当一覧と同じ形の表（components/list/DisasterTable。訓練の安否で lib/triage の色が付く。圧縮できる）、
// 真ん中に状況と対応（T20 の枠）、右に被害状況と地図（採点 T22 の枠）。1536px は 3 列、1280px は 2 列（真ん中と右を重ねる）。
// 進行中は「進める」（既定）と早送り（切替）と中断。終わった・中断した訓練は再生（刻みの印か前・次で見る。Claude を呼ばない）。
export default async function DrillScreenPage({ params, searchParams }: Props) {
  const principal = await requirePage("drill");
  const scope = drillScope(principal);
  const { id } = await params;
  const q = await searchParams;
  const sort = parseSort(q.sort);
  const view = parseView(q.view);
  if (!scope || !isDrillId(id)) return <Message title="該当なし" />;

  const s = await load(scope, id, parseStep(q.step));
  if (s === "failed") return <Message title="読込失敗" />;
  if (!s) return <Message title="該当なし" />;

  const running = s.drill.status === "running";
  const scenario = scenarioOf(s.drill.scenario);
  const replay = !running;
  const here = (over: { sort?: SortKey; step?: number | null; view?: DrillView } = {}) =>
    drillHref(id, { sort, step: replay ? s.shown : null, view, ...over });
  const grid = GRID[view];

  const rows = sortCaseload(s.rows, sort);
  const sit = s.situation;
  const outage = s.state.world.outage;
  const slots: TableSlots = {
    sortHref: (k) => here({ sort: k }),
    nameHref: () => null,
    detail: (r) =>
      r.detail ? <DrillRowDetail detail={r.detail} startedAt={s.drill.started_at} aiSignals={s.aiSignals} /> : null,
  };
  const side = buildSidePane(s.rows, {
    sort,
    disaster: sideDisasterOf(s.rows, { kind: scenario.kind, alertLevel: s.state.world.alertLevel }),
  });
  const pins = side.pins.map((p) => ({ ...p, href: here() }));

  return (
    <main className="mx-auto max-w-[112rem] space-y-3 px-4 py-4" data-drill={id} data-step={s.shown} data-status={s.drill.status}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={DRILL_PATH} className="rounded px-1 text-sm text-muted" data-press>
          {DRILL_LABELS.records}
        </Link>
        <h1 className="text-xl font-bold">
          {DRILL_LABELS.page} {SCENARIO_LABELS[s.drill.scenario]}
        </h1>
        <span className={`text-sm ${running ? "font-bold" : "text-muted"}`} data-drill-status>
          {STATUS_LABELS[s.drill.status]}
        </span>
        <span className="text-xs text-muted tabular-nums">
          {DRILL_LABELS.startedAt} {shortJst(s.drill.started_at)}
          {s.drill.startedByName ? ` ${s.drill.startedByName}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {running ? (
            <DrillControls id={id} step={s.drill.step} done={false} />
          ) : (
            <ReplayNav shown={s.shown} reached={s.drill.step} hrefOf={(i) => here({ step: i })} />
          )}
        </div>
      </header>

      <section aria-label={DRILL_LABELS.elapsed} className="grid gap-x-6 gap-y-2 rounded-lg bg-panel px-4 py-3 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <div>
          <div className="text-2xl font-bold tabular-nums" data-now-hour={s.state.hour}>
            {elapsedLabel(s.state.hour)}
          </div>
          <div className="text-sm text-muted tabular-nums">
            {shortJst(sit.now)}
            {replay && <span className="ml-2">{DRILL_LABELS.replay}</span>}
          </div>
        </div>
        <DrillBar
          hours={s.hours}
          last={s.last}
          now={s.state.hour}
          bands={s.bands}
          reached={s.drill.step}
          {...(replay ? { hrefOf: (i: number) => here({ step: i }) } : {})}
        />
      </section>

      <div className={`grid items-start gap-3 ${grid.outer}`}>
        <section aria-labelledby="drill-table" className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-panel px-4 py-2.5">
            <h2 id="drill-table" className="sr-only">
              {DRILL_LABELS.page}
            </h2>
            <DisasterSummary
              counts={countColors(rows.flatMap((r) => (r.triage ? [r.triage.color] : [])))}
              disaster={elapsedText(sit.disasterAt, sit.now)}
              outage={outage && outage.restoredAt === null && sit.outageAt ? { elapsed: elapsedText(sit.outageAt, sit.now), area: sit.outageTowns !== null } : null}
              at={shortJst(sit.now)}
            />
            <ViewToggle view={view} hrefOf={(v) => here({ view: v })} />
          </div>
          <div className="overflow-x-auto" data-drill-table={view}>
            <DisasterTable rows={rows} sort={sort} slots={slots} />
          </div>
        </section>

        <div className={`grid min-w-0 items-start gap-3 ${grid.inner}`}>
          <div className="min-w-0 space-y-3">
            <Panel title={DRILL_LABELS.situation} id="situation">
              <Situation ticks={s.ticks} names={s.names} startedAt={s.drill.started_at} />
            </Panel>
            {/* ケアマネの手（T20）。この作業では履歴を出すだけ */}
            <Panel title={DRILL_LABELS.actions} id="actions">
              {s.state.actions.length === 0 ? <p className="text-sm text-muted">{DRILL_LABELS.none}</p> : null}
            </Panel>
          </div>
          <div className="min-w-0 space-y-3">
            <Panel title={DRILL_LABELS.damage} id="damage">
              <DamagePanel kind={scenario.kind} world={s.state.world} now={s.state.hour} names={s.names} />
            </Panel>
            {/* 採点（T22）は終わった訓練でここに足す */}
            <Panel title={DRILL_LABELS.map} id="map">
              <CaseMap pins={pins} layers={side.demo?.layers ?? []} demo={side.demo} unplaced={side.unplaced} />
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * 列の組み方。左は表、右は真ん中（状況・対応）と右（被害状況・地図）の組。
 * 圧縮（4 列の表 26rem）は 1280px で 3 列に並ぶ。全部の列（約 64rem）は右の組を 28rem に重ねる。auto は 1536px 未満で圧縮、以上で全部の列
 */
const GRID: Record<DrillView, { outer: string; inner: string }> = {
  compact: { outer: "xl:grid-cols-[26rem_minmax(0,1fr)]", inner: "lg:grid-cols-[minmax(0,1fr)_20rem]" },
  full: { outer: "xl:grid-cols-[minmax(0,1fr)_28rem]", inner: "lg:grid-cols-2 xl:grid-cols-1" },
  auto: {
    outer: "xl:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_28rem]",
    inner: "lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-1",
  },
};

/** 圧縮・展開。auto は幅で見えている方の逆を出す（1536px 未満は展開、以上は圧縮） */
function ViewToggle({ view, hrefOf }: { view: DrillView; hrefOf: (v: DrillView) => string }) {
  const cls = "ml-auto rounded px-2 py-1 text-sm text-muted";
  if (view === "compact") {
    return (
      <Link href={hrefOf("full")} className={cls} data-press data-view-toggle="full">
        {DRILL_LABELS.expand}
      </Link>
    );
  }
  if (view === "full") {
    return (
      <Link href={hrefOf("compact")} className={cls} data-press data-view-toggle="compact">
        {DRILL_LABELS.compact}
      </Link>
    );
  }
  return (
    <>
      <Link href={hrefOf("full")} className={`${cls} 2xl:hidden`} data-press data-view-toggle="full">
        {DRILL_LABELS.expand}
      </Link>
      <Link href={hrefOf("compact")} className={`${cls} hidden 2xl:inline`} data-press data-view-toggle="compact">
        {DRILL_LABELS.compact}
      </Link>
    </>
  );
}

/** 見る刻みの中身。進行中は今の刻みだけ（先も前も見ない。前を見るのは終わってからの再生） */
async function load(scope: DrillScope, id: string, want: number | null): Promise<DrillScreen | null | "failed"> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const s = await loadDrillScreen(env.DB, scope, id, want);
    if (s && s.drill.status === "running" && s.shown !== s.drill.step) return loadDrillScreen(env.DB, scope, id, null);
    return s;
  } catch (e) {
    console.error("訓練を読めない", e);
    return "failed";
  }
}

function Panel({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`drill-${id}`} className="rounded-lg bg-panel p-2.5" data-panel={id}>
      <h2 id={`drill-${id}`} className="mb-1.5 px-0.5 text-sm font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 再生の前・次 */
function ReplayNav({ shown, reached, hrefOf }: { shown: number; reached: number; hrefOf: (i: number) => string }) {
  const btn = "rounded-md px-3 py-1.5 text-sm font-bold";
  return (
    <nav aria-label={DRILL_LABELS.replay} className="flex items-center gap-1" data-replay>
      {shown > 0 ? (
        <Link href={hrefOf(shown - 1)} className={`${btn} text-accent`} data-press data-replay-prev>
          {DRILL_LABELS.prev}
        </Link>
      ) : (
        <span className={`${btn} text-muted`}>{DRILL_LABELS.prev}</span>
      )}
      {shown < reached ? (
        <Link href={hrefOf(shown + 1)} className={`${btn} text-accent`} data-press data-replay-next>
          {DRILL_LABELS.next}
        </Link>
      ) : (
        <span className={`${btn} text-muted`}>{DRILL_LABELS.next}</span>
      )}
    </nav>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-lg bg-panel p-6">
        <h1 className="text-xl font-bold">{title}</h1>
        <Link href={DRILL_PATH} className="mt-2 inline-block rounded px-1 text-sm text-accent" data-press>
          {DRILL_LABELS.records}
        </Link>
      </section>
    </main>
  );
}
