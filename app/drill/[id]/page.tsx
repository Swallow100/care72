import "@/components/drill/drill.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { countColors } from "@/components/disaster/ColorCounts";
import { LatestResult } from "@/components/drill/ActionLog";
import { ActionPanel, type PanelPerson } from "@/components/drill/ActionPanel";
import { DamagePanel } from "@/components/drill/DamagePanel";
import { DrillHeaderMark } from "@/components/drill/DrillHeaderMark";
import { drillHeaderMark } from "@/lib/drill/header-mark";
import { AiStopBand } from "@/components/drill/AiStopBand";
import { DrillBar } from "@/components/drill/DrillBar";
import { EndedNote } from "@/components/drill/Ended";
import { DrillControls } from "@/components/drill/DrillControls";
import { DrillRowDetail } from "@/components/drill/DrillRowDetail";
import { FictionalMark, FictionalNote } from "@/components/drill/Fictional";
import { IncomingCall, type IncomingCallItem } from "@/components/drill/IncomingCall";
import { MissedCalls, type MissedItem } from "@/components/drill/MissedCalls";
import { DrillLog } from "@/components/drill/DrillLog";
import { DrillPanes } from "@/components/drill/DrillPanes";
import { NewsBar } from "@/components/drill/NewsBar";
import { newsItemsOf, StripRows } from "@/components/drill/StripRows";
import { timeBaseOf } from "@/lib/drill/act-time";
import { areaTargetOf } from "@/lib/drill/area-targets";
import { buildStrip } from "@/lib/drill/strip";
import { buildDrillLog } from "@/lib/drill/timeline";
import { DisasterSummary } from "@/components/list/DisasterSummary";
import { DisasterTable, type TableSlots } from "@/components/list/DisasterTable";
import { CaseMap } from "@/components/map/CaseMap";
import { StateTag } from "@/components/ui/Tag";
import { requirePage } from "@/lib/auth/server";
import { sortCaseload, type SortKey } from "@/lib/caseload";
import { elapsedText, shortJst } from "@/lib/disaster/state";
import { callerContact, callerLabel, callsOf, openMissedCalls } from "@/lib/drill/calls";
import { drillScope, type DrillScope } from "@/lib/drill/db";
import { nowHour } from "@/lib/drill/engine";
import { isDrillId } from "@/lib/drill/http";
import { loadDrillRecord, type DrillRecord } from "@/lib/drill/record";
import { loadCallRecords, type CallRecord } from "@/lib/drill/responses";
import { SCORE_LABELS } from "@/lib/drill/score-labels";
import { scoreView } from "@/lib/drill/score-view";
import { aiStatusFor } from "@/lib/claude/cloudflare";
import type { AiStatus } from "@/lib/claude/status";
import { aiStopBand } from "@/lib/drill/ai-stop";
import { ScorePanel } from "@/components/drill/ScorePanel";
import { DownloadIcon, PaperIcon, PrintIcon } from "@/components/ui/Icon";
import { BusyLine } from "@/components/drill/BusyLine";
import { ACT_LOG_LABELS } from "@/lib/drill/act-log";
import { DRILL_LABELS, elapsedClockLabel, LOG_LABELS, SCENARIO_LABELS, STATUS_LABELS, VIRTUAL_LABELS } from "@/lib/drill/labels";
import { parseLogTab } from "@/lib/drill/timeline";
import { COLOR_LABELS } from "@/lib/labels";
import { COLOR_TONES } from "@/lib/person";
import { DRILL_PATH, drillHref, reportHref, parseSort, parseStep, parseView, type DrillView } from "@/lib/drill/paths";
import { drillKindOf, isVirtual } from "@/lib/drill/scenarios";
import { loadDrillScreen, screenTimeText, type DrillScreen } from "@/lib/drill/view";
import { simTimeText } from "@/lib/drill/time-text";
import { voiceEnabled, voiceHref } from "@/lib/drill/voice";
import { buildSidePane, sideDisasterOf } from "@/lib/map/side";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { LinkPending } from "@/components/ui/LinkPending";
import { BackLink, Panel as UiPanel, PanelHead } from "@/components/ui/Panel";

export const metadata: Metadata = { title: "訓練 | ケア72" };

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string | string[]; step?: string | string[]; view?: string | string[]; log?: string | string[] }>;
};

// 訓練の画面（docs/tasks/T17.md、docs/SPEC.md「画面 4 訓練」）。横画面の分割:
// 上に 72 時間の棒と今の時刻、左に担当一覧と同じ形の表（components/list/DisasterTable。訓練の安否で lib/triage の色が付く。圧縮できる）、
// 真ん中に対応（T20: 対象・7 つの手・相手を選んで実行、結果の吹き出しと着信）と経過（T105: 発生・把握・対応の 3 つのタブ、components/drill/DrillLog）、
// 右に被害状況と地図。終わった・中断した訓練は対応の代わりに採点（T22: 数字 4 つ・前回・内訳・講評）と、上の帯に訓練記録の紙面と印刷。
// T128: PC で送らずに分かる並び。1536px 以上は 表（圧縮）・対応・経過・被害状況と地図 の 4 列、1280px は 表・対応か経過（切替）・被害状況と地図 の 3 列
// （components/drill/DrillPanes）。上の 72 時間の棒は種類の段の出来事の一覧（components/drill/StripRows、lib/drill/strip.ts）と、その下に新着
// （components/drill/NewsBar）。区域の出来事の対象は被害状況と帯と地図に（lib/drill/area-targets.ts）。
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
  // AI の今の状態（T76。未設定・上限到達・本日残り。lib/claude/status.ts）。帯と講評の両方がこれを読む。読めなければ null
  const ai = await aiStatusFor(scope.officeId).catch(() => null);

  const running = s.drill.status === "running";
  // 採点（T22）: 終わった・中断した訓練だけ。再生で見ている刻みでなく、訓練の全部で数える（loadDrillRecord が最後の刻みを読む）
  const scored = running ? null : await loadScore(scope, id, ai);
  // AI 停止の帯 1 本（T76）。刻みの跡（見ている刻みまで）と、進行中なら今の状態から
  const stopBand = aiStopBand(s.ticks, { virtual: isVirtual(s.drill.scenario), running, now: running ? ai : null, clock: s.clock });
  const replay = !running;
  const here = (over: { sort?: SortKey; step?: number | null; view?: DrillView } = {}) =>
    drillHref(id, { sort, step: replay ? s.shown : null, view, ...over });
  const grid = GRID[view];
  // 対応・経過の欄の見出し（T128）。切替を出す幅では切替が見出しを兼ねるので、読み上げだけにする
  const paneHead = grid.wide ? "sr-only 2xl:not-sr-only 2xl:mb-1.5" : "sr-only";

  const rows = sortCaseload(s.rows, sort);
  const sit = s.situation;
  const outage = s.state.world.outage;
  const recordings = voiceOn ? recordingsOf(s) : {};
  // 訓練の人の印（T70。デモ事業所は架空、ほかは本人役）
  const fiction = s.fiction ?? "fictional";
  const slots: TableSlots = {
    sortHref: (k) => here({ sort: k }),
    nameHref: () => null,
    nameMark: () => <FictionalMark kind={fiction} />,
    detail: (r) =>
      r.detail ? (
        <DrillRowDetail
          detail={r.detail}
          startedAt={s.drill.started_at}
          aiSignals={s.aiSignals}
          heard={s.heard}
          recordings={recordings}
          ended={endedOf(s, r.id)}
          asks={s.state.world.asks?.[r.id] ?? []}
          hints={s.hints?.[r.id] ?? null}
          // 進行中は詳細の連絡先の行から対応の欄の手を選ぶ（T132）。可否は決まりの表の結果（terms）を読むだけ
          pick={running}
          terms={s.terms?.[r.id] ?? null}
        />
      ) : null,
    // 仮想モード（T50）: 結末の人の行に印と 1 文
    nameNote: (pid) => {
      const end = endedOf(s, pid);
      return end ? <EndedNote text={end.text} ai={end.ai} /> : null;
    },
  };
  const voiceOf = (act: string) => (voiceOn ? voiceHref(id, { act }) : null);
  const side = buildSidePane(s.rows, {
    sort,
    // 仮想モードは架空の街なので、本物の地図に雨雲・震度の絵を重ねない（T79）。大雨の想定は筋書きの雨を見ている時刻で（T103。
    // 雨の段は世界の警戒レベルまでなので、被害状況の欄と食い違わない。色と順には使わない）
    disaster: sideDisasterOf(
      s.rows,
      { kind: drillKindOf(s.drill.scenario, s.state.world), alertLevel: s.state.world.alertLevel },
      { scene: !isVirtual(s.drill.scenario), rain: { scenario: s.drill.scenario, hour: nowHour(s.state) } },
    ),
  });
  // 地図: 今の避難の出来事（津波の避難・警戒レベル 4 以上）の対象の人のピンに「避難」（T128）
  const evac = new Set([
    ...(s.state.world.tsunami === "evacuate" ? (areaTargetOf({ kind: "tsunami", state: "evacuate" }, s.area)?.persons ?? []) : []),
    ...(s.state.world.alertLevel !== null && s.state.world.alertLevel >= 4
      ? (areaTargetOf({ kind: "alert", level: s.state.world.alertLevel }, s.area)?.persons ?? [])
      : []),
  ]);
  const pins = side.pins.map((p) => ({ ...p, href: here(), note: evac.has(p.id) ? MAP_NOTE : null }));

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
  // 着信の記録（応答・拒否と往復、T127）。経過・着信の画面・不在着信の一覧が読む。読めなければ空
  const callRecords = await callRecordsOf(id);
  const missed = running ? missedOf(s, callRecords) : [];
  // 手の時刻の元（訓練の中の時刻。T128、lib/drill/act-time.ts）
  const base = timeBaseOf(s.drill.started_at, s.state.options?.night);
  // 上の帯の段と新着（T128）。経過と同じ行から（進行中は公表の物だけ）
  const log = buildDrillLog(s.ticks, actions, { finished: !running, calls: callRecords });
  const strip = buildStrip(log, [...new Set(s.bands.map((b) => b.kind))]);
  const news = running ? newsItemsOf(log, { names: s.names, people: s.area, base, office: s.state.officeZones ?? null }) : [];

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
        {isVirtual(s.drill.scenario) && (
          <span className="text-sm" data-virtual-note>
            {VIRTUAL_LABELS.note}
          </span>
        )}
        <span className="text-xs text-muted tabular-nums">
          {DRILL_LABELS.startedAt} {shortJst(s.drill.started_at)}
          {s.drill.startedByName ? ` ${s.drill.startedByName}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {running ? (
            <DrillControls id={id} step={s.drill.step} done={false} clock={s.clock} left={s.left} minute={s.state.minute} />
          ) : (
            <>
              <ReplayNav shown={s.shown} reached={s.drill.step} hrefOf={(i) => here({ step: i })} />
              <ButtonLink href={reportHref(id)} kind="plain" icon={PaperIcon} data-report-link>
                {SCORE_LABELS.paper}
              </ButtonLink>
              {/* 手と出来事のログの CSV（T110） */}
              <a href={`/api/drill/${encodeURIComponent(id)}/log`} download className={buttonClass("plain")} data-press data-log-csv>
                <DownloadIcon aria-hidden className="size-4 shrink-0" />
                {ACT_LOG_LABELS.csv}
              </a>
              <ButtonLink href={reportHref(id, { print: true })} kind="main" icon={PrintIcon} data-print-link="drill">
                {SCORE_LABELS.print}
              </ButtonLink>
            </>
          )}
        </div>
      </header>
      {/* 上の帯に訓練の想定・規模・経過（T125。事業所の今の状態と混ぜない） */}
      <DrillHeaderMark mark={drillHeaderMark({ scenario: s.drill.scenario, options: s.state.options ?? null, world: s.state.world, minute: s.state.minute })} />
      <FictionalNote kind={fiction} />
      <AiStopBand band={stopBand} />

      <section aria-label={DRILL_LABELS.elapsed} className="grid gap-x-6 gap-y-2 rounded-lg bg-panel px-3 py-3 lg:grid-cols-[10rem_minmax(0,1fr)]" data-strip-panel>
        <div>
          {/* 経過は読み上げにも（進めたら読む。T162） */}
          <div role="status" className="text-2xl font-bold tabular-nums" data-now-hour={s.state.hour} data-now-minute={s.state.minute}>
            {elapsedClockLabel(s.state.minute)}
          </div>
          <div className="text-sm text-muted tabular-nums" data-now-time={s.state.options?.night === true ? "night" : "real"}>
            {screenTimeText(s)}
            {replay && <span className="ml-2">{DRILL_LABELS.replay}</span>}
          </div>
        </div>
        <DrillBar
          hours={s.hours}
          last={s.last}
          now={nowHour(s.state)}
          bands={s.bands}
          reached={s.drill.step}
          night={s.state.options?.night === true}
          clock={s.clock}
          {...(replay ? { hrefOf: (i: number) => here({ step: i }) } : {})}
          strip={<StripRows lanes={strip} bands={s.bands} last={s.last} now={nowHour(s.state)} world={s.state.world} names={s.names} people={s.area} base={base} office={s.state.officeZones ?? null} />}
        />
        {running && <NewsBar drillId={id} items={news} className="lg:col-span-2" />}
      </section>

      <div className={`grid items-start gap-3 ${grid.outer}`}>
        <section aria-labelledby="drill-table" className={`min-w-0 space-y-2 ${grid.table}`}>
          <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-panel px-3 py-2.5">
            <h2 id="drill-table" className="sr-only">
              {DRILL_LABELS.page}
            </h2>
            <DisasterSummary
              counts={countColors(rows.flatMap((r) => (r.triage ? [r.triage.color] : [])))}
              disaster={elapsedText(sit.disasterAt, sit.now)}
              outage={outage && outage.restoredAt === null && sit.outageAt ? { elapsed: elapsedText(sit.outageAt, sit.now), area: sit.outageTowns !== null } : null}
              at={simTimeText(s.drill.started_at, nowHour(s.state) * 60)}
            />
            <ViewToggle view={view} hrefOf={(v) => here({ view: v })} />
          </div>
          {/* 表は内側で送らない。収まらない列は圧縮（drill.css）か、展開のときは右の組を下に回して幅を取る */}
          <div data-drill-table={view}>
            <DisasterTable rows={rows} sort={sort} slots={slots} />
          </div>
        </section>

        {/* 対応（終わった訓練は採点）と経過（T105）。1536px 以上は 2 列、それ未満は切替（T128、components/drill/DrillPanes） */}
        <DrillPanes
          wide={grid.wide}
          label={LOG_LABELS.panes}
          mainLabel={running ? DRILL_LABELS.actions : SCORE_LABELS.score}
          logLabel={LOG_LABELS.panel}
          logCount={log.occur.length + log.know.length + log.act.length}
          main={
            running ? (
              // ケアマネの手（T20）: 対象・手・相手を選んで実行、結果
              <Panel title={DRILL_LABELS.actions} id="actions" head={paneHead}>
                <div className="space-y-2.5">
                  {/* 鳴らさなかった電話の形の連絡（T127）。折返で連絡先電話・本人電話を打つ */}
                  {missed.length > 0 && <MissedCalls drillId={id} step={s.drill.step} actions={actions.length} items={missed} fiction={fiction} />}
                  <ActionPanel
                    drillId={id}
                    step={s.drill.step}
                    actions={actions.length}
                    people={people}
                    contacts={s.contacts}
                    fiction={fiction}
                    terms={s.terms}
                    hints={s.hints}
                    status={<BusyLine busy={s.busy} base={base} />}
                  />
                  {latest && (
                    <LatestResult
                      action={latest}
                      names={s.names}
                      ticks={s.ticks}
                      voiceOf={voiceOf}
                      fiction={fiction}
                      refused={s.refused}
                      talk={{ drillId: id, step: s.drill.step, actions: actions.length }}
                      base={base}
                    />
                  )}
                </div>
              </Panel>
            ) : scored ? (
              // 採点（T22）: 終わった・中断した訓練の数字 4 つ・前回・内訳・講評。読めなければ出さない（訓練の再生はそのまま）
              <UiPanel aria-label={SCORE_LABELS.score} data-panel="score">
                <ScorePanel
                  drillId={id}
                  view={scoreView(scored.record.score, scored.record.screen.names, scored.record.previous, base)}
                  review={scored.record.review}
                  canReview={scored.canReview}
                  names={scored.record.screen.names}
                />
              </UiPanel>
            ) : null
          }
          log={
            // 経過（T105）: 発生・把握・対応の 3 つのタブ。行の分け方は lib/drill/timeline.ts
            <Panel title={LOG_LABELS.panel} id="log" head={paneHead}>
              <DrillLog
                ticks={s.ticks}
                actions={actions}
                names={s.names}
                startedAt={s.drill.started_at}
                night={s.state.options?.night === true}
                finished={!running}
                initial={parseLogTab(Array.isArray(q.log) ? q.log[0] : q.log)}
                fiction={fiction}
                refused={s.refused}
                voiceOf={voiceOf}
                calls={callRecords}
                {...(running ? { undo: { drillId: id, step: s.drill.step, actions: actions.length, act: s.undoable } } : {})}
              />
            </Panel>
          }
        />

        <div className="min-w-0 space-y-3">
          <Panel title={DRILL_LABELS.damage} id="damage">
            <DamagePanel
              kind={drillKindOf(s.drill.scenario, s.state.world)}
              world={s.state.world}
              now={s.state.hour}
              names={s.names}
              hidePrivate={running}
              people={s.area}
              office={s.state.officeZones ?? null}
            />
          </Panel>
          <Panel title={DRILL_LABELS.map} id="map">
            {/* 「位置は架空」はデモ事業所（種の架空の位置）だけ。本物の事業所の訓練は台帳の位置なので出さない（T114） */}
            <CaseMap
              pins={pins}
              layers={side.demo?.layers ?? []}
              demo={side.demo}
              unplaced={side.unplaced}
              fictional={principal.office?.kind === "demo"}
            />
          </Panel>
        </div>
      </div>
      {running && (
        <IncomingCall drillId={id} calls={incomingOf(s, voiceOn, callRecords)} fiction={fiction} step={s.drill.step} actions={actions.length} />
      )}
    </main>
  );
}

/** 結末の人（見ている刻みまで）の 1 文と理由。結末の状況（世界が決めた、lib/drill/world-apply.ts の farewellIncidents）から */
function endedOf(s: DrillScreen, person: string): { text: string; reason: string | null; ai: boolean } | null {
  if (!s.state.world.ended?.[person]) return null;
  const e = s.ticks.flatMap((t) => t.incidents).find((x) => x.change.kind === "outcome" && x.person === person);
  if (!e || e.change.kind !== "outcome") return null;
  return { text: e.text, reason: e.change.reason ?? null, ai: e.ai };
}

/**
 * 進行中の今の刻みの着信（電話の形の安否、鳴らす順。lib/drill/calls.ts）。名前はケアマネの画面なので出す（声の生成には渡さない）。
 * 応答・拒否が訓練の記録にある着信は鳴らさない（別の端末で押した物も）。応答して切っていない着信（T127）は、通話中のまま往復と一緒に出す
 */
function incomingOf(s: DrillScreen, voiceOn: boolean, records: ReadonlyArray<CallRecord>): IncomingCallItem[] {
  const tick = s.ticks.find((t) => t.step === s.drill.step);
  if (!tick) return [];
  const bySignal = new Map(records.map((c) => [c.signal, c]));
  return callsOf(tick.turns).flatMap((t) => {
    const rec = t.signal ? bySignal.get(t.signal) : undefined;
    const talking = rec?.response === "answer" && (rec.talkEnd ?? null) === null;
    return t.signal && t.saying && (!rec?.response || talking)
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
            ...(talking ? { answered: true, lines: rec?.talk ?? [] } : {}),
          },
        ]
      : [];
  });
}

/**
 * まだ折返していない不在着信（T127、lib/drill/calls.ts の openMissedCalls、新しい順）。折返は掛けてきた人の連絡先へ連絡先電話
 * （lib/drill/calls.ts の callerContact。電話の無い人・連絡先の無い人は本人電話）
 */
function missedOf(s: DrillScreen, records: ReadonlyArray<CallRecord>): MissedItem[] {
  return openMissedCalls(s.ticks, s.state.actions, records).map(({ turn, step, minute }) => {
    const contacts = s.contacts[turn.person] ?? [];
    const target = callerContact(turn.source, contacts);
    return {
      key: turn.signal ?? `${step}-${turn.person}-${minute}`,
      person: turn.person,
      name: s.names[turn.person] ?? turn.person,
      caller: callerLabel(turn.source, contacts),
      minute,
      saying: turn.saying,
      ai: turn.ai,
      ...(target?.hasPhone ? { kind: "call_contact" as const, target: target.id } : { kind: "call_person" as const, target: null }),
    };
  });
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
 * 採点と講評と前回（T22、lib/drill/record.ts）。採点がまだなら数えて drills.score に残す。canReview は AI が未設定でないか
 * （未設定なら講評を呼ばず「AI 停止 未設定」で数字だけ。T76）。読めなければ null（採点の欄を出さない）
 */
async function loadScore(scope: DrillScope, id: string, ai: AiStatus | null): Promise<{ record: DrillRecord; canReview: boolean } | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const record = await loadDrillRecord(env.DB, scope, id, new Date().toISOString());
    if (!record || record === "running") return null;
    return { record, canReview: ai !== null && ai.kind !== "unset" };
  } catch (e) {
    console.error("採点を読めない", e);
    return null;
  }
}

/** 着信の記録（応答・拒否と往復、T22・T127）。読めなければ空（端末の sessionStorage だけで鳴らし分け、経過に着信の行を出さない） */
async function callRecordsOf(id: string): Promise<CallRecord[]> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return await loadCallRecords(env.DB, id);
  } catch {
    return [];
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
 * 列の組み方（T128）。子は 表・対応と経過（DrillPanes）・被害状況と地図 の 3 つ。
 * - 圧縮（auto も同じ）: 1536px 以上は 表 26rem・対応と経過の 2 列・被害状況と地図 22rem（4 列に見える）。1280px は 表・対応か経過の切替・
 *   被害状況と地図 20rem。1024px は表を上に全部の幅で、下に 対応か経過・被害状況と地図。それ未満は縦に積む
 * - 展開（全部の列の表、約 64rem）: 1536px 以上は 表・右の 28rem（対応か経過の切替の下に被害状況と地図）。それ未満は表を上に
 * wide は対応と経過を 1536px 以上で 2 列に並べるか（展開の右の列は狭いので切替のまま）
 */
const COMPACT = {
  outer: "lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[26rem_minmax(0,1fr)_20rem] 2xl:grid-cols-[26rem_minmax(0,1fr)_22rem]",
  table: "lg:col-span-2 xl:col-span-1",
  wide: true,
};
const GRID: Record<DrillView, { outer: string; table: string; wide: boolean }> = {
  compact: COMPACT,
  auto: COMPACT,
  full: {
    outer: "lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]",
    table: "lg:col-span-2 2xl:col-span-1 2xl:row-span-2",
    wide: false,
  },
};

/** 地図のピンの「避難」（T128。今の津波の避難・警戒レベル 4 以上の対象の人） */
const MAP_NOTE = "避難";

/** 圧縮・展開。auto は圧縮と同じ（T128）なので展開を出す */
function ViewToggle({ view, hrefOf }: { view: DrillView; hrefOf: (v: DrillView) => string }) {
  const cls = "relative ml-auto rounded px-2 py-1 text-sm text-muted";
  if (view === "full") {
    return (
      <Link href={hrefOf("compact")} className={cls} data-press data-view-toggle="compact">
        {DRILL_LABELS.compact}
        <LinkPending />
      </Link>
    );
  }
  return (
    <Link href={hrefOf("full")} className={cls} data-press data-view-toggle="full">
      {DRILL_LABELS.expand}
      <LinkPending />
    </Link>
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

function Panel({ title, id, children, head = "mb-1.5" }: { title: string; id: string; children: React.ReactNode; head?: string }) {
  return (
    <UiPanel aria-labelledby={`drill-${id}`} data-panel={id}>
      <PanelHead id={`drill-${id}`} title={title} className={head} />
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
