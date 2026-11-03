import "@/components/drill/drill.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { countColors } from "@/components/disaster/ColorCounts";
import { ActionLog, LatestResult } from "@/components/drill/ActionLog";
import { ActionPanel, type PanelPerson } from "@/components/drill/ActionPanel";
import { DamagePanel } from "@/components/drill/DamagePanel";
import { DrillBar } from "@/components/drill/DrillBar";
import { DrillControls } from "@/components/drill/DrillControls";
import { DrillRowDetail } from "@/components/drill/DrillRowDetail";
import { FictionalMark, FictionalNote } from "@/components/drill/Fictional";
import { IncomingCall, type IncomingCallItem } from "@/components/drill/IncomingCall";
import { Situation } from "@/components/drill/Situation";
import { DisasterSummary } from "@/components/list/DisasterSummary";
import { DisasterTable, type TableSlots } from "@/components/list/DisasterTable";
import { CaseMap } from "@/components/map/CaseMap";
import { StateTag } from "@/components/ui/Tag";
import { requirePage } from "@/lib/auth/server";
import { sortCaseload, type SortKey } from "@/lib/caseload";
import { elapsedText, shortJst } from "@/lib/disaster/state";
import { callerLabel, callsOf } from "@/lib/drill/calls";
import { drillScope, type DrillScope } from "@/lib/drill/db";
import { nowHour, type ActionRecord } from "@/lib/drill/engine";
import { isDrillId } from "@/lib/drill/http";
import { loadDrillRecord, type DrillRecord } from "@/lib/drill/record";
import { loadCallRecords } from "@/lib/drill/responses";
import { SCORE_LABELS } from "@/lib/drill/score-labels";
import { scoreView } from "@/lib/drill/score-view";
import { hasAnthropicKey } from "@/lib/claude/client";
import { ScorePanel } from "@/components/drill/ScorePanel";
import { PaperIcon, PrintIcon } from "@/components/ui/Icon";
import { ACTION_LABELS, DRILL_LABELS, elapsedClockLabel, SCENARIO_LABELS, STATUS_LABELS } from "@/lib/drill/labels";
import { COLOR_LABELS } from "@/lib/labels";
import { COLOR_TONES } from "@/lib/person";
import { DRILL_PATH, drillHref, reportHref, parseSort, parseStep, parseView, type DrillView } from "@/lib/drill/paths";
import { scenarioOf } from "@/lib/drill/scenarios";
import { loadDrillScreen, type DrillScreen } from "@/lib/drill/view";
import { voiceEnabled, voiceHref } from "@/lib/drill/voice";
import { buildSidePane, sideDisasterOf } from "@/lib/map/side";
import { ButtonLink } from "@/components/ui/Button";
import { LinkPending } from "@/components/ui/LinkPending";
import { BackLink, Panel as UiPanel, PanelHead } from "@/components/ui/Panel";

export const metadata: Metadata = { title: "訓練 | ケア72" };

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string | string[]; step?: string | string[]; view?: string | string[] }>;
};

// 訓練の画面（docs/tasks/T17.md、docs/SPEC.md「画面 4 訓練」）。横画面の分割:
// 上に 72 時間の棒と今の時刻、左に担当一覧と同じ形の表（components/list/DisasterTable。訓練の安否で lib/triage の色が付く。圧縮できる）、
// 真ん中に対応（T20: 対象・7 つの手・相手を選んで実行、結果の吹き出しと着信、刻みごとの履歴）と状況、
// 右に被害状況と地図。終わった・中断した訓練は右の上に採点（T22: 数字 4 つ・前回・内訳・講評）と、上の帯に訓練記録の紙面と印刷。1536px は 3 列、1280px は 2 列（真ん中と右を重ねる）。
// 上の大きな経過はケアマネの時計（手に使った時間も進む。「経過 1 時間 25 分」）。
// 進行中は「進める」（既定）と早送り（切替）と中断。終わった・中断した訓練は再生（刻みの印か前・次で見る。Claude を呼ばない）。
// 着信（T21）: 進行中の今の刻みの安否のうち電話の形の物（1 刻みに 2 件まで）を、画面の上に重ねた着信の画面で鳴らす（IncomingCall）。
// 声は Gemini TTS（GET /api/drill/voice、R2 に訓練ごと）。鍵が無ければ文字だけ。本人の赤の言う事の声は行の詳細の「録音」。
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
  const voiceOn = await voiceReady();

  const running = s.drill.status === "running";
  // 採点（T22）: 終わった・中断した訓練だけ。再生で見ている刻みでなく、訓練の全部で数える（loadDrillRecord が最後の刻みを読む）
  const scored = running ? null : await loadScore(scope, id);
  const scenario = scenarioOf(s.drill.scenario);
  const replay = !running;
  const here = (over: { sort?: SortKey; step?: number | null; view?: DrillView } = {}) =>
    drillHref(id, { sort, step: replay ? s.shown : null, view, ...over });
  const grid = GRID[view];

  const rows = sortCaseload(s.rows, sort);
  const sit = s.situation;
  const outage = s.state.world.outage;
  const recordings = voiceOn ? recordingsOf(s) : {};
  const slots: TableSlots = {
    sortHref: (k) => here({ sort: k }),
    nameHref: () => null,
    nameMark: () => <FictionalMark />,
    detail: (r) =>
      r.detail ? (
        <DrillRowDetail detail={r.detail} startedAt={s.drill.started_at} aiSignals={s.aiSignals} heard={s.heard} recordings={recordings} />
      ) : null,
  };
  const voiceOf = (act: string) => (voiceOn ? voiceHref(id, { act }) : null);
  const side = buildSidePane(s.rows, {
    sort,
    disaster: sideDisasterOf(s.rows, { kind: scenario.kind, alertLevel: s.state.world.alertLevel }),
  });
  const pins = side.pins.map((p) => ({ ...p, href: here() }));

  // 対応の欄（T20）: 対象は左の表の優先の順、色の印はルールの表の色。手の途中で進んだ刻みは状況の欄で着信に
  const actions = s.state.actions;
  const people: PanelPerson[] = [...s.rows]
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.kana.localeCompare(b.kana))
    .map((r) => ({
      id: r.id,
      name: r.name,
      tag: r.triage ? <StateTag tone={COLOR_TONES[r.triage.color]}>{COLOR_LABELS[r.triage.color]}</StateTag> : null,
    }));
  const latest = [...actions].reverse().find((a) => a.result !== null) ?? null;
  const during = duringOf(actions, s.names);

  return (
    <main className="mx-auto max-w-[112rem] space-y-3 px-4 py-4" data-drill={id} data-step={s.shown} data-status={s.drill.status}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BackLink href={DRILL_PATH} />
        <h1 className="text-xl leading-8 font-bold">
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
            <>
              <ReplayNav shown={s.shown} reached={s.drill.step} hrefOf={(i) => here({ step: i })} />
              <ButtonLink href={reportHref(id)} kind="plain" icon={PaperIcon} data-report-link>
                {SCORE_LABELS.paper}
              </ButtonLink>
              <ButtonLink href={reportHref(id, { print: true })} kind="main" icon={PrintIcon} data-print-link="drill">
                {SCORE_LABELS.print}
              </ButtonLink>
            </>
          )}
        </div>
      </header>
      <FictionalNote />

      <section aria-label={DRILL_LABELS.elapsed} className="grid gap-x-6 gap-y-2 rounded-lg bg-panel px-3 py-3 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <div>
          <div className="text-2xl font-bold tabular-nums" data-now-hour={s.state.hour} data-now-minute={s.state.minute}>
            {elapsedClockLabel(s.state.minute)}
          </div>
          <div className="text-sm text-muted tabular-nums">
            {shortJst(sit.now)}
            {replay && <span className="ml-2">{DRILL_LABELS.replay}</span>}
          </div>
        </div>
        <DrillBar
          hours={s.hours}
          last={s.last}
          now={nowHour(s.state)}
          bands={s.bands}
          reached={s.drill.step}
          {...(replay ? { hrefOf: (i: number) => here({ step: i }) } : {})}
        />
      </section>

      <div className={`grid items-start gap-3 ${grid.outer}`}>
        <section aria-labelledby="drill-table" className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-panel px-3 py-2.5">
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
          {/* 表は内側で送らない。収まらない列は圧縮（drill.css）か、展開のときは右の組を下に回して幅を取る */}
          <div data-drill-table={view}>
            <DisasterTable rows={rows} sort={sort} slots={slots} />
          </div>
        </section>

        <div className={`grid min-w-0 items-start gap-3 ${grid.inner}`}>
          <div className="min-w-0 space-y-3">
            {/* ケアマネの手（T20）: 対象・手・相手を選んで実行、結果、刻みごとの履歴 */}
            <Panel title={DRILL_LABELS.actions} id="actions">
              <div className="space-y-2.5">
                {running && (
                  <ActionPanel drillId={id} step={s.drill.step} actions={actions.length} people={people} contacts={s.contacts} />
                )}
                {running && latest && <LatestResult action={latest} names={s.names} ticks={s.ticks} voiceOf={voiceOf} />}
                <ActionLog actions={actions} hours={s.hours} current={s.shown} names={s.names} voiceOf={voiceOf} />
              </div>
            </Panel>
            <Panel title={DRILL_LABELS.situation} id="situation">
              <Situation ticks={s.ticks} names={s.names} startedAt={s.drill.started_at} during={during} />
            </Panel>
          </div>
          <div className="min-w-0 space-y-3">
            {/* 採点（T22）: 終わった・中断した訓練の数字 4 つ・前回・内訳・講評。読めなければ出さない（訓練の再生はそのまま） */}
            {scored && (
              <UiPanel aria-label={SCORE_LABELS.score} data-panel="score">
                <ScorePanel
                  drillId={id}
                  view={scoreView(scored.record.score, scored.record.screen.names, scored.record.previous)}
                  review={scored.record.review}
                  canReview={scored.canReview}
                  names={scored.record.screen.names}
                />
              </UiPanel>
            )}
            <Panel title={DRILL_LABELS.damage} id="damage">
              <DamagePanel kind={scenario.kind} world={s.state.world} now={s.state.hour} names={s.names} />
            </Panel>
            <Panel title={DRILL_LABELS.map} id="map">
              <CaseMap pins={pins} layers={side.demo?.layers ?? []} demo={side.demo} unplaced={side.unplaced} />
            </Panel>
          </div>
        </div>
      </div>
      {running && <IncomingCall drillId={id} calls={incomingOf(s, voiceOn, await respondedOf(id))} />}
    </main>
  );
}

/**
 * 進行中の今の刻みの着信（電話の形の安否、鳴らす順。lib/drill/calls.ts）。名前はケアマネの画面なので出す（声の生成には渡さない）。
 * 応答・拒否が訓練の記録にある着信は鳴らさない（別の端末で押した物も）
 */
function incomingOf(s: DrillScreen, voiceOn: boolean, responded: ReadonlySet<string>): IncomingCallItem[] {
  const tick = s.ticks.find((t) => t.step === s.drill.step);
  if (!tick) return [];
  return callsOf(tick.turns).flatMap((t) =>
    t.signal && t.saying && !responded.has(t.signal)
      ? [
          {
            signal: t.signal,
            name: s.names[t.person] ?? t.person,
            caller: callerLabel(t.source, s.contacts[t.person] ?? []),
            color: t.color,
            saying: t.saying,
            ai: t.ai,
            minute: Math.round(t.at * 60),
            voice: voiceOn ? voiceHref(s.drill.id, { signal: t.signal }) : null,
          },
        ]
      : [],
  );
}

/** 本人役の赤（本人の言う事つき）の「録音」（言う事の声。安否の id → 声の行き先） */
function recordingsOf(s: DrillScreen): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of s.ticks.flatMap((x) => x.turns)) {
    if (t.signal && t.color === "red" && t.source === "agent" && t.saying) out[t.signal] = voiceHref(s.drill.id, { signal: t.signal });
  }
  return out;
}

/**
 * 採点と講評と前回（T22、lib/drill/record.ts）。採点がまだなら数えて drills.score に残す。canReview は Claude の鍵があるか
 * （無ければ講評を呼ばず「講評なし」）。読めなければ null（採点の欄を出さない）
 */
async function loadScore(scope: DrillScope, id: string): Promise<{ record: DrillRecord; canReview: boolean } | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const record = await loadDrillRecord(env.DB, scope, id, new Date().toISOString());
    if (!record || record === "running") return null;
    return { record, canReview: hasAnthropicKey(env) };
  } catch (e) {
    console.error("採点を読めない", e);
    return null;
  }
}

/** 応答・拒否を残した着信の安否の id（T22）。読めなければ空（端末の sessionStorage だけで鳴らし分ける） */
async function respondedOf(id: string): Promise<Set<string>> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return new Set((await loadCallRecords(env.DB, id)).flatMap((c) => (c.response ? [c.signal] : [])));
  } catch {
    return new Set();
  }
}

/** 声を作れるか（Gemini の鍵）。読めなければ文字だけ */
async function voiceReady(): Promise<boolean> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return voiceEnabled(env);
  } catch {
    return false;
  }
}

/**
 * 列の組み方。左は表、右は真ん中（状況・対応）と右（被害状況・地図）の組。
 * 圧縮（4 列の表 26rem）は 1280px で 3 列に並ぶ。全部の列（約 64rem）は 1536px から右の組を 28rem に重ね、
 * それ未満は右の組を表の下に回す（表を横に送らない）。auto は 1536px 未満で圧縮、以上で全部の列
 */
const GRID: Record<DrillView, { outer: string; inner: string }> = {
  compact: { outer: "xl:grid-cols-[26rem_minmax(0,1fr)]", inner: "lg:grid-cols-[minmax(0,1fr)_20rem]" },
  full: { outer: "2xl:grid-cols-[minmax(0,1fr)_28rem]", inner: "lg:grid-cols-2 2xl:grid-cols-1" },
  auto: {
    outer: "xl:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_28rem]",
    inner: "lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-1",
  },
};

/** 圧縮・展開。auto は幅で見えている方の逆を出す（1536px 未満は展開、以上は圧縮） */
function ViewToggle({ view, hrefOf }: { view: DrillView; hrefOf: (v: DrillView) => string }) {
  const cls = "relative ml-auto rounded px-2 py-1 text-sm text-muted";
  if (view === "compact") {
    return (
      <Link href={hrefOf("full")} className={cls} data-press data-view-toggle="full">
        {DRILL_LABELS.expand}
        <LinkPending />
      </Link>
    );
  }
  if (view === "full") {
    return (
      <Link href={hrefOf("compact")} className={cls} data-press data-view-toggle="compact">
        {DRILL_LABELS.compact}
        <LinkPending />
      </Link>
    );
  }
  return (
    <>
      <Link href={hrefOf("full")} className={`${cls} 2xl:hidden`} data-press data-view-toggle="full">
        {DRILL_LABELS.expand}
        <LinkPending />
      </Link>
      <Link href={hrefOf("compact")} className={`${cls} hidden 2xl:inline`} data-press data-view-toggle="compact">
        {DRILL_LABELS.compact}
        <LinkPending />
      </Link>
    </>
  );
}

/** 手の途中で進んだ刻み → その手の言い方（「訪問 伊藤 フミ」） */
function duringOf(actions: ReadonlyArray<ActionRecord>, names: Readonly<Record<string, string>>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const a of actions) {
    for (const st of a.result?.crossed ?? []) {
      out[st] = [ACTION_LABELS[a.kind], a.person ? names[a.person] : null].filter(Boolean).join(" ");
    }
  }
  return out;
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
    <UiPanel aria-labelledby={`drill-${id}`} data-panel={id}>
      <PanelHead id={`drill-${id}`} title={title} className="mb-1.5" />
      {children}
    </UiPanel>
  );
}

/** 再生の前・次 */
function ReplayNav({ shown, reached, hrefOf }: { shown: number; reached: number; hrefOf: (i: number) => string }) {
  const off = "inline-flex h-8 items-center rounded px-3 text-sm font-bold text-muted";
  return (
    <nav aria-label={DRILL_LABELS.replay} className="flex items-center gap-1.5" data-replay>
      {shown > 0 ? (
        <ButtonLink href={hrefOf(shown - 1)} kind="plain" data-replay-prev>
          {DRILL_LABELS.prev}
        </ButtonLink>
      ) : (
        <span className={off}>{DRILL_LABELS.prev}</span>
      )}
      {shown < reached ? (
        <ButtonLink href={hrefOf(shown + 1)} kind="main" data-replay-next>
          {DRILL_LABELS.next}
        </ButtonLink>
      ) : (
        <span className={off}>{DRILL_LABELS.next}</span>
      )}
    </nav>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3">
        <BackLink href={DRILL_PATH} />
        <h1 className="text-xl leading-8 font-bold">{title}</h1>
      </div>
    </main>
  );
}
