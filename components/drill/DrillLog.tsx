// 訓練の経過（docs/tasks/T105.md）。前の「状況」と「対応の結果と履歴」を、時刻の順の 1 本の流れにして 3 つのタブで切り替える。
// - 発生: 世界で起きたこと（想定の表の出来事・監督の差し込み・本人に起きたこと・本人のする事）。訓練の途中は公表の物だけで、
//   本人に起きたこと（非公表）は終わってから出す。終わった訓練は、把握が遅れた物に「遅れ 2 時間 10 分」、届かなかった物に「未把握」
// - 把握: ケアマネに届いたこと（公表の出来事・安否と着信・通話で聞いたこと・訪問で見た様子・手の返事で分かった事実・着信の往復で
//   掛けてきた人の言った事）。行の頭にどの経路で届いたかの印（T127: 着信・不在・ボタン・発信・訪問・結果・公表。lib/drill/timeline.ts の knowRouteOf）
// - 対応: ケアマネの手と結果（前の履歴と同じ行。最後の手の取消・メモ・往復の畳み・訪問の様子）と、着信への応答・拒否と往復（T127）
// 行の分け方は lib/drill/timeline.ts の表 1 か所。発生と把握は同じ分の行を 1 つの見出し（経過と時刻、手の途中なら「対応中 訪問 伊藤 フミ」）に
// まとめ、新しい順。対応は手ごとに時刻を持つので見出しなし。色は安否の色だけ（遅れ・未把握は太字の文字で、状態の 4 色を使わない）。
// AI の言葉（監督・本人役・世界）は AI の印。サーバーで描く（状態を持たない）。切替だけ components/drill/LogTabs（ブラウザ）。

import { AiMark, StateTag } from "@/components/person/parts";
import type { ActionRecord, DrillTurn, Tick } from "@/lib/drill/engine";
import { ACTION_STATUS_LABELS } from "@/lib/drill/actions";
import { ACTION_LABELS, ACTION_UI, CALL_UI, calleeText, clockLabel, DRILL_LABELS, elapsedLabel, LOG_LABELS } from "@/lib/drill/labels";
import type { FictionKind } from "@/lib/drill/fiction";
import { buildDrillLog, CALL_LOG_LABELS, knowRouteOf, ROUTE_LABELS, type Awareness, type DrillLog as Log, type KnowRoute, type LogRow, type LogTab } from "@/lib/drill/timeline";
import type { CallRecord } from "@/lib/drill/responses";
import { TALK_UI } from "@/lib/drill/dialogue";
import { SOURCE_LABELS } from "@/lib/list/detail";
import { minuteText, simTimeText } from "@/lib/drill/time-text";
import { COLOR_LABELS, CONTACT_KIND_LABELS } from "@/lib/labels";
import type { StateTone } from "@/lib/person";
import { Mark, StateText } from "@/components/ui/Tag";
import { ActionItem, Bubble, CallInMark, TalkFold, toneOf, VisitLine, type Refused, type UndoSlot, type VoiceOf } from "./ActionLog";
import { FictionalMark } from "./Fictional";
import { ActionIcon, CallInIcon } from "./icons";
import { LogTabs } from "./LogTabs";
import { IncidentItem, TurnItem } from "./Situation";

type Names = Readonly<Record<string, string>>;

const TURN_TONES: Record<DrillTurn["color"], StateTone> = { red: "urgent", green: "ok", unknown: "unknown" };
const TURN_LABELS: Record<DrillTurn["color"], string> = { red: COLOR_LABELS.red, green: COLOR_LABELS.green, unknown: COLOR_LABELS.gray };

type Common = { names: Names; fiction?: FictionKind; refused?: Refused; voiceOf?: VoiceOf };

export function DrillLog({
  ticks,
  actions,
  names,
  startedAt,
  finished,
  initial,
  fiction,
  refused,
  voiceOf,
  undo,
  calls,
}: {
  ticks: ReadonlyArray<Tick>;
  actions: ReadonlyArray<ActionRecord>;
  /** 着信の記録（応答・拒否と往復、T127。lib/drill/responses.ts の loadCallRecords）。無ければ着信の行を出さない */
  calls?: ReadonlyArray<CallRecord>;
  names: Names;
  startedAt: string;
  /** 終わった・中断した訓練（発生に非公表の物も出し、遅れ・未把握の印を付ける） */
  finished: boolean;
  /** 最初に開くタブ（?log=） */
  initial: LogTab;
  /** 名前のそばの印（T70。デモ以外は本人役） */
  fiction?: FictionKind;
  /** 通話で聞いた安否を表に渡さなかった手（T84） */
  refused?: Refused;
  voiceOf?: VoiceOf;
  /** 進行中の最後の手の取消（T59）。再生では渡さない */
  undo?: UndoSlot;
}) {
  const log = buildDrillLog(ticks, actions, { finished, ...(calls ? { calls } : {}) });
  const c: Common = { names, fiction, refused, voiceOf };
  return (
    <LogTabs
      label={LOG_LABELS.tabs}
      initial={initial}
      items={[
        { tab: "occur", label: LOG_LABELS.occur, count: log.occur.length },
        { tab: "know", label: LOG_LABELS.know, count: log.know.length },
        { tab: "act", label: LOG_LABELS.act, count: log.act.length },
      ]}
      panels={{
        occur: (
          <>
            <Groups rows={log.occur} actions={actions} names={names} startedAt={startedAt} tab="occur">
              {(r) => <OccurItem key={r.key} r={r} aware={finished ? log.aware[r.key] : undefined} c={c} />}
            </Groups>
            {!finished && (
              <p className="mt-1.5 text-xs text-muted" data-log-hidden>
                {LOG_LABELS.hidden}
              </p>
            )}
          </>
        ),
        know: (
          <Groups rows={log.know} actions={actions} names={names} startedAt={startedAt} tab="know">
            {(r) => <KnowItem key={r.key} r={r} c={c} />}
          </Groups>
        ),
        // 取消は打った順の最後の手だけ（前の履歴と同じ）
        act: <ActList log={log} c={c} undo={undo} last={actions.at(-1)?.id ?? null} />,
      }}
    />
  );
}

/** 同じ分の行を 1 つの見出しにまとめる（新しい順。見出しの中は起きた順） */
function Groups({
  rows,
  actions,
  names,
  startedAt,
  tab,
  children,
}: {
  rows: ReadonlyArray<LogRow>;
  actions: ReadonlyArray<ActionRecord>;
  names: Names;
  startedAt: string;
  tab: LogTab;
  children: (r: LogRow) => React.ReactNode;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">{DRILL_LABELS.none}</p>;
  const groups: Array<{ minute: number; rows: LogRow[] }> = [];
  for (const r of rows) {
    const g = groups.at(-1);
    if (g && g.minute === r.minute) g.rows.push(r);
    else groups.push({ minute: r.minute, rows: [r] });
  }
  groups.reverse();
  return (
    <ol className="space-y-2" data-log-list={tab}>
      {groups.map((g) => {
        const during = duringAt(actions, g.minute, names);
        return (
          <li key={g.minute} className="rounded-md bg-panel2 px-2.5 py-2" data-log-minute={g.minute}>
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-bold">{elapsedLabel(g.minute / 60)}</span>
              <span className="text-xs text-muted tabular-nums">{simTimeText(startedAt, g.minute)}</span>
              {during && (
                <span className="text-xs text-muted" data-during>
                  {ACTION_UI.during} {during}
                </span>
              )}
            </h3>
            <ul className="mt-1 space-y-1 text-sm">{g.rows.map((r) => children(r))}</ul>
          </li>
        );
      })}
    </ol>
  );
}

/** その分にケアマネが手の途中だった手の言い方（「訪問 伊藤 フミ」）。無ければ null */
function duringAt(actions: ReadonlyArray<ActionRecord>, minute: number, names: Names): string | null {
  const on = actions.filter((a) => a.atMinute < minute && minute < (a.result?.atMinute ?? Number.POSITIVE_INFINITY));
  if (on.length === 0) return null;
  return on.map((a) => [ACTION_LABELS[a.kind], a.person ? names[a.person] : null].filter(Boolean).join(" ")).join("・");
}

/** 発生の 1 行（状況か本人のする事）と、終わった訓練の把握の印 */
function OccurItem({ r, aware, c }: { r: LogRow; aware: Awareness | undefined; c: Common }) {
  const mark = <AwareMark aware={aware} />;
  if (r.source === "incident") {
    return (
      <IncidentItem
        e={r.e}
        name={r.e.person ? c.names[r.e.person] : undefined}
        tickHour={r.minute / 60}
        fallback={r.fallback}
        fiction={c.fiction}
        extra={mark}
      />
    );
  }
  if (r.source === "doing") return <DoingItem t={r.t} name={c.names[r.t.person] ?? r.t.person} fiction={c.fiction} extra={mark} />;
  return null;
}

/** 本人のする事（本人に起きたこと。本人役の物は AI の印） */
function DoingItem({ t, name, fiction, extra }: { t: DrillTurn; name: string; fiction?: FictionKind; extra?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-doing={t.person}>
      <span className="rounded bg-panel px-1 py-px text-xs text-muted">{LOG_LABELS.doing}</span>
      {t.ai && <AiMark small />}
      <span>{t.doing}</span>
      <span className="text-xs text-muted">
        {name}
        <FictionalMark kind={fiction} />
      </span>
      {extra}
    </li>
  );
}

/** 遅れ・未把握の印（太字の文字。状態の色は使わない）。公表と、起きた時に把握した物は出さない */
function AwareMark({ aware }: { aware: Awareness | undefined }) {
  if (!aware || aware.mark === null) return null;
  if (aware.mark === "never") {
    return (
      <span className="text-xs font-bold" data-aware="never">
        {LOG_LABELS.never}
      </span>
    );
  }
  return (
    <span className="text-xs font-bold tabular-nums" data-aware="late">
      {LOG_LABELS.late} {minuteText(aware.lag ?? 0)}
    </span>
  );
}

/** 経路の印（T127）。着信は前からの着信の印（電話のアイコン）、不在は太字、ほかは地の印 */
function RouteMark({ route }: { route: KnowRoute | null }) {
  if (!route) return null;
  if (route === "call") {
    return (
      <span className="inline-flex self-center" data-route-mark={route}>
        <CallInMark />
      </span>
    );
  }
  return (
    <span className="inline-flex self-center" data-route-mark={route}>
      <Mark inPanel2>
        <span className={route === "missed" ? "font-bold" : undefined}>{ROUTE_LABELS[route]}</span>
      </Mark>
    </span>
  );
}

/** 把握の 1 行（公表の状況・安否・手の返事で届いた事・着信の往復）。頭に経路の印 */
function KnowItem({ r, c }: { r: LogRow; c: Common }) {
  const lead = <RouteMark route={knowRouteOf(r)} />;
  if (r.source === "incident") {
    return <IncidentItem e={r.e} name={r.e.person ? c.names[r.e.person] : undefined} tickHour={r.minute / 60} fallback={r.fallback} fiction={c.fiction} lead={lead} />;
  }
  if (r.source === "signal") {
    return <TurnItem t={r.t} name={c.names[r.t.person] ?? r.t.person} tickHour={r.minute / 60} callIn={r.callIn} fiction={c.fiction} doing={false} lead={lead} />;
  }
  if (r.source === "heard") return <HeardItem a={r.a} c={c} lead={lead} />;
  if (r.source === "reply") return <ReplyItem call={r.c} c={c} lead={lead} />;
  return null;
}

/** 着信の往復の話し手（往復の話し手の言い方、無ければ出どころの区分） */
const callSpeaker = (call: CallRecord) => call.callee?.label ?? SOURCE_LABELS[call.source];

/** 着信の往復で掛けてきた人の言った事（T127。往復の吹き出し、本人役の言葉に AI の印） */
function ReplyItem({ call, c, lead }: { call: CallRecord; c: Common; lead: React.ReactNode }) {
  const lines = call.talk ?? [];
  return (
    <li data-reply={call.signal}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {lead}
        <span className="font-bold">
          {c.names[call.person] ?? call.person}
          <FictionalMark kind={c.fiction} />
        </span>
        <span className="text-xs text-muted">{callSpeaker(call)}</span>
      </div>
      <TalkFold lines={lines} speaker={callSpeaker(call)} />
    </li>
  );
}

/** 対応: 着信への応答・拒否と往復（T127） */
function CallActItem({ call, c }: { call: CallRecord; c: Common }) {
  const at = call.respondedAt ?? call.minute;
  return (
    <li className="rounded-md bg-panel2 px-2 py-1.5 text-sm" data-call-act={call.signal} data-call-response={call.response ?? undefined}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-xs text-muted tabular-nums">{clockLabel(at)}</span>
        <span className="flex items-center gap-1 self-center font-bold">
          <CallInIcon aria-hidden className="size-3.5 shrink-0" />
          {ROUTE_LABELS.call}
        </span>
        <span>
          {c.names[call.person] ?? call.person}
          <FictionalMark kind={c.fiction} />
        </span>
        <span className="text-xs text-muted">{callSpeaker(call)}</span>
        <span className={call.response === "decline" ? "font-bold" : undefined}>
          {call.response === "decline" ? CALL_LOG_LABELS.decline : CALL_LOG_LABELS.answer}
        </span>
        {call.talkEnd != null && <span className="text-xs text-muted">{TALK_UI.ended}</span>}
      </div>
      <TalkFold lines={call.talk ?? []} speaker={callSpeaker(call)} />
    </li>
  );
}

/** 手の返事で届いた事: 電話に出た人の言う事・往復・訪問の様子・聞いた安否・分かった事実（「家の前の道 通行止」） */
function HeardItem({ a, c, lead }: { a: ActionRecord; c: Common; lead?: React.ReactNode }) {
  const r = a.result;
  if (!r) return null;
  const who = a.person ? (c.names[a.person] ?? a.person) : null;
  const callee = calleeText(a);
  return (
    <li data-heard={a.id} data-act-kind={a.kind}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {lead}
        <span className="flex items-center gap-1 self-center font-bold">
          <ActionIcon kind={a.kind} className="size-3.5" />
          {ACTION_LABELS[a.kind]}
        </span>
        {who && (
          <span>
            {who}
            {a.person && <FictionalMark kind={c.fiction} />}
          </span>
        )}
        {callee && callee !== CONTACT_KIND_LABELS.self && <span className="text-xs text-muted">{callee}</span>}
        <StateText tone={toneOf(r)}>{ACTION_STATUS_LABELS[r.status]}</StateText>
        {r.because && <span data-heard-fact>{r.because}</span>}
        {r.heard && (
          <span className="inline-flex items-baseline gap-1" data-heard-signal={r.heard.via}>
            <StateTag tone={TURN_TONES[r.heard.color]}>{TURN_LABELS[r.heard.color]}</StateTag>
            <span className="text-xs text-muted">{r.heard.via === "visit" ? CALL_UI.heardVisit : CALL_UI.heardCall}</span>
          </span>
        )}
        {c.refused?.[a.id] && (
          <span className="font-bold text-danger" data-heard-refused>
            {c.refused[a.id]}
          </span>
        )}
      </div>
      {r.speech && <Bubble speaker={callee ?? ""} text={r.speech} ai={r.speechAi} voice={c.voiceOf?.(a.id) ?? null} />}
      {r.talk && <TalkFold lines={r.talk} speaker={callee ?? ""} />}
      {r.visit && <VisitLine visit={r.visit} />}
    </li>
  );
}

/** 対応: 手と結果（新しい順。前の履歴の行と同じ） */
function ActList({ log, c, undo, last }: { log: Log; c: Common; undo?: UndoSlot; last: string | null }) {
  if (log.act.length === 0) return <p className="text-sm text-muted">{DRILL_LABELS.none}</p>;
  const rows = [...log.act].reverse();
  return (
    <ol className="space-y-1" data-action-log data-log-list="act">
      {rows.map((r) =>
        r.source === "action" ? (
          <ActionItem
            key={r.key}
            a={r.a}
            names={c.names}
            voiceOf={c.voiceOf}
            fiction={c.fiction}
            refused={c.refused}
            {...(undo && r.a.id === last ? { undo } : {})}
          />
        ) : r.source === "call" ? (
          <CallActItem key={r.key} call={r.c} c={c} />
        ) : null,
      )}
    </ol>
  );
}
