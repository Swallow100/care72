// 訓練の対応の結果と履歴（docs/tasks/T20.md）。サーバーで描く（状態を持たない）。
// - 結果（LatestResult）: いちばん新しい手の世界の返事。電話に出た人の言う事は吹き出し（本人役 Haiku の言葉は AI の印）、
//   監督（Opus）の言い換えの文も AI の印。手の途中で刻みを越えたら、その間の着信（電話の形の安否）を並べる。
//   電話に出た人の言う事は声でも聞ける（T21、VoicePlay。声を作れなければ文字だけ）。着信の画面は components/drill/IncomingCall
// - 履歴（ActionLog）: 刻みごとに畳める（今の刻みだけ開く）。新しい順。誰に・何を・何時・返事
// 返事は色の文字（塗りの印は安否だけ）: 通話・到着・手配済・受入・報告済・避難済は緑、つながらない・着けない・断られたは黄（次の手が要る）。
// 正解・不正解は出さない（採点は T22）。名前は台帳の id から引く（記録には名前が無い）。
// T59: 手のメモを手の行の下に。進行中は最後の手に「取消」（刻みを越えなかった手だけ。越えた手は「取消不可」の印）。
// T84: 通話で聞いた安否を表に渡さなかった手（至急維持）は「通話」の横に本番の電話と同じ言葉「無事 不可（本人が「けが」）」を赤の太字で。
// T93: 最新の電話の手は最初の言葉の下に往復の欄（TalkBox。問い 7 つ・自由の 1 文・切る）、履歴は「通話 N 往復」に畳む（開くと全文）。
//   訪問で着いた手は様子の 1 行（AI の印）と頼み事の印（灰の文字）。

import { AiMark } from "@/components/person/parts";
import { OpenIcon } from "@/components/ui/Icon";
import { LABEL } from "@/components/ui/Panel";
import { Mark, StateTag, StateText } from "@/components/ui/Tag";
import { ACTION_STATUS_LABELS } from "@/lib/drill/actions";
import type { ActionRecord, ActionResult, DrillTurn, Tick } from "@/lib/drill/engine";
import { ACTION_LABELS, ACTION_UI, calleeText, clockLabel, DRILL_LABELS, elapsedLabel, T59_LABELS } from "@/lib/drill/labels";
import { COLOR_LABELS, CONTACT_KIND_LABELS } from "@/lib/labels";
import { SOURCE_LABELS } from "@/lib/list/detail";
import type { StateTone } from "@/lib/person";
import { callsOf } from "@/lib/drill/calls";
import { TALK_UI, talkRounds, type TalkLine, type VisitReport } from "@/lib/drill/dialogue";
import type { FictionKind } from "@/lib/drill/fiction";
import { FictionalMark } from "./Fictional";
import { ActionIcon, CallInIcon } from "./icons";
import { AskMarks, TalkBox, TalkLines } from "./TalkBox";
import { UndoButton } from "./UndoButton";
import { VoicePlay } from "./VoicePlay";

type Names = Readonly<Record<string, string>>;

/** 手の番号 → 電話に出た人の言う事の声の行き先（声を作れなければ null で文字だけ。T21） */
export type VoiceOf = (act: string) => string | null;

export function toneOf(r: ActionResult): StateTone {
  if (r.ok) return "ok";
  return r.status === "ringing" ? "unknown" : "check";
}

const TURN_TONES: Record<DrillTurn["color"], StateTone> = { red: "urgent", green: "ok", unknown: "unknown" };
const TURN_LABELS: Record<DrillTurn["color"], string> = { red: COLOR_LABELS.red, green: COLOR_LABELS.green, unknown: COLOR_LABELS.gray };

/** 通話で聞いた安否を表に渡さなかった手（T84、至急維持）。手の番号 → 本番の電話と同じ言葉（lib/drill/view.ts の refused） */
export type Refused = Readonly<Record<string, string>>;

/** 手の 1 行（時刻・手・誰に・相手・返事）。refused は「通話」の横に、本番の電話と同じ赤の太字で */
function Head({ a, names, fiction, refused }: { a: ActionRecord; names: Names; fiction?: FictionKind; refused?: Refused }) {
  const r = a.result;
  const who = a.person ? (names[a.person] ?? a.person) : a.kind === "report_city" ? ACTION_UI.whole : null;
  const callee = calleeText(a);
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="text-xs text-muted tabular-nums">{clockLabel(a.atMinute)}</span>
      <span className="flex items-center gap-1 self-center font-bold">
        <ActionIcon kind={a.kind} className="size-3.5" />
        {ACTION_LABELS[a.kind]}
      </span>
      {who && (
        <span>
          {who}
          {a.person && <FictionalMark kind={fiction} />}
        </span>
      )}
      {callee && callee !== CONTACT_KIND_LABELS.self && <span className="text-xs text-muted">{callee}</span>}
      {r ? (
        <>
          {/* 返事は 2 番目の状態なので色の文字（塗りの印は安否だけ。components/ui/Tag の決まり） */}
          <StateText tone={toneOf(r)}>{ACTION_STATUS_LABELS[r.status]}</StateText>
          {refused?.[a.id] && (
            <span className="font-bold text-danger" data-heard-refused>
              {refused[a.id]}
            </span>
          )}
          {r.ai && <AiMark small />}
          {r.speech === null && <span>{r.text}</span>}
          {r.because && <span className="text-xs text-muted">{r.because}</span>}
        </>
      ) : (
        <span className="text-xs text-muted">{ACTION_UI.during}</span>
      )}
    </div>
  );
}

/** 電話に出た人の言う事（吹き出し）。声があれば再生 */
export function Bubble({
  speaker,
  text,
  ai,
  large = false,
  voice = null,
}: {
  speaker: string;
  text: string;
  ai: boolean;
  large?: boolean;
  voice?: string | null;
}) {
  return (
    <div className="relative ml-3 mt-1.5 max-w-prose rounded-lg bg-panel px-2.5 py-1.5" data-speech data-speech-ai={ai ? "" : undefined}>
      <span aria-hidden="true" className="absolute -left-1 top-2.5 size-2 rotate-45 bg-panel" />
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span>{speaker}</span>
        {ai && <AiMark small />}
        {voice && (
          <span className="ml-auto">
            <VoicePlay href={voice} />
          </span>
        )}
      </div>
      {/* text-base は使わない（地の色の名前と重なり、文字が地の色になる。app/globals.css） */}
      <p className={large ? "text-[1rem] leading-6" : "text-sm"}>「{text}」</p>
    </div>
  );
}

/** 往復を畳んだ物（T93。「通話 3 往復」。開くと全文）。名前付きの group で、外の刻みの畳みと開き方を分ける */
export function TalkFold({ lines, speaker }: { lines: ReadonlyArray<TalkLine>; speaker: string }) {
  if (lines.length === 0) return null;
  return (
    <details className="group/talk mt-1" data-talk-fold>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded px-1 py-0.5 text-xs [&::-webkit-details-marker]:hidden" data-press>
        <OpenIcon aria-hidden className="size-3.5 shrink-0 -rotate-90 text-muted transition-transform group-open/talk:rotate-0" />
        <span className="font-bold">{`${TALK_UI.talk} ${talkRounds({ talk: [...lines] })} ${TALK_UI.rounds}`}</span>
      </summary>
      <TalkLines lines={lines} speaker={speaker} />
    </details>
  );
}

/** 訪問で着いたときの様子（T93、本人役の AI の印）と頼み事の印。言う事は吹き出し */
export function VisitLine({ visit }: { visit: VisitReport }) {
  return (
    <div className="mt-1 space-y-0.5" data-visit-report>
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
        <span className="text-xs text-muted">{TALK_UI.condition}</span>
        {visit.ai && <AiMark small />}
        {visit.condition && <span>{visit.condition}</span>}
        <AskMarks asks={visit.asks} />
      </div>
      {visit.speech && <Bubble speaker={TALK_UI.visitee} text={visit.speech} ai={visit.ai} />}
    </div>
  );
}

/** 手のメモ（T59。ケアマネが書いた物なので AI の印なし） */
export function MemoLine({ memo }: { memo: string | undefined }) {
  if (!memo) return null;
  return (
    <p className="mt-0.5 flex gap-1.5 text-xs" data-act-memo-text>
      <span className="shrink-0 text-muted">{T59_LABELS.memo}</span>
      <span className="min-w-0 break-words">{memo}</span>
    </p>
  );
}

/** 最後の手の取消（T59）。進行中の画面だけ。act は取り消せる手の番号（無ければ取消不可） */
export type UndoSlot = { drillId: string; step: number; actions: number; act: string | null };

export function ActionItem({
  a,
  names,
  voiceOf,
  undo,
  fiction,
  refused,
}: {
  a: ActionRecord;
  names: Names;
  voiceOf?: VoiceOf;
  undo?: UndoSlot;
  fiction?: FictionKind;
  refused?: Refused;
}) {
  const r = a.result;
  return (
    <li className="rounded-md bg-panel2 px-2 py-1.5 text-sm" data-act={a.id} data-act-kind={a.kind} data-act-status={r?.status ?? "pending"}>
      {undo ? (
        <div className="flex flex-wrap items-start gap-x-2">
          <div className="min-w-0 flex-1">
            <Head a={a} names={names} fiction={fiction} refused={refused} />
          </div>
          {undo.act === a.id ? (
            <UndoButton drillId={undo.drillId} step={undo.step} actions={undo.actions} act={a.id} />
          ) : (
            <span className="ml-auto text-xs text-muted" data-undo-locked>
              {T59_LABELS.undoLocked}
            </span>
          )}
        </div>
      ) : (
        <Head a={a} names={names} fiction={fiction} refused={refused} />
      )}
      <MemoLine memo={a.memo} />
      {r?.speech && <Bubble speaker={calleeText(a) ?? ""} text={r.speech} ai={r.speechAi} voice={voiceOf?.(a.id) ?? null} />}
      {r?.talk && <TalkFold lines={r.talk} speaker={calleeText(a) ?? ""} />}
      {r?.visit && <VisitLine visit={r.visit} />}
    </li>
  );
}

/** いちばん新しい手の返事（実行のすぐ下）。刻みを越えた手は、その間の着信（電話の形の安否、lib/drill/calls.ts）を並べる */
export function LatestResult({
  action,
  names,
  ticks,
  voiceOf,
  fiction,
  refused,
  talk,
}: {
  action: ActionRecord;
  names: Names;
  ticks: ReadonlyArray<Tick>;
  voiceOf?: VoiceOf;
  fiction?: FictionKind;
  refused?: Refused;
  /** 往復の欄（T93）。進行中の画面だけ渡す（読んだ刻みと手の数）。無ければ往復は畳んで出す */
  talk?: { drillId: string; step: number; actions: number };
}) {
  const r = action.result;
  const crossed = r ? ticks.filter((t) => r.crossed.includes(t.step)) : [];
  const calls = crossed.flatMap((t) => callsOf(t.turns));
  return (
    <section aria-label={ACTION_UI.result} className="rounded-md bg-panel2 px-2.5 py-2" data-latest={action.id}>
      <div className="text-sm">
        <Head a={action} names={names} fiction={fiction} refused={refused} />
        <MemoLine memo={action.memo} />
      </div>
      {r?.speech && <Bubble speaker={calleeText(action) ?? ""} text={r.speech} ai={r.speechAi} large voice={voiceOf?.(action.id) ?? null} />}
      {r?.speech && talk ? (
        <TalkBox drillId={talk.drillId} step={talk.step} actions={talk.actions} action={action} speaker={calleeText(action) ?? ""} />
      ) : (
        r?.talk && <TalkFold lines={r.talk} speaker={calleeText(action) ?? ""} />
      )}
      {r?.visit && <VisitLine visit={r.visit} />}
      {calls.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" data-call-ins>
          {calls.map((t, i) => (
            <CallInItem key={`${t.person}-${i}`} t={t} name={names[t.person] ?? t.person} fiction={fiction} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 着信の印（色の無い地の印。面の中の行に置く） */
export function CallInMark() {
  return (
    <span className="inline-flex self-center" data-call-in-mark>
      <Mark inPanel2>
        <span className="inline-flex items-center gap-0.5 font-bold">
          <CallInIcon aria-hidden className="size-3 shrink-0" />
          {ACTION_UI.callIn}
        </span>
      </Mark>
    </span>
  );
}

function CallInItem({ t, name, fiction }: { t: DrillTurn; name: string; fiction?: FictionKind }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-call-in={t.person}>
      <CallInMark />
      <span className="font-bold">
        {name}
        <FictionalMark kind={fiction} />
      </span>
      <StateTag tone={TURN_TONES[t.color]}>{TURN_LABELS[t.color]}</StateTag>
      <span className="text-xs text-muted">{SOURCE_LABELS[t.source]}</span>
      {t.ai && <AiMark small />}
      {t.saying && <span>「{t.saying}」</span>}
    </li>
  );
}

/** 手の履歴。刻みごとに畳める（今の刻みと、いちばん新しい手の刻みだけ開く）。新しい順 */
export function ActionLog({
  actions,
  hours,
  current,
  names,
  voiceOf,
  undo,
  fiction,
  refused,
}: {
  actions: ReadonlyArray<ActionRecord>;
  hours: readonly number[];
  /** 今（見ている）の刻み */
  current: number;
  names: Names;
  voiceOf?: VoiceOf;
  /** 進行中の最後の手の取消（T59）。再生では渡さない */
  undo?: UndoSlot;
  /** 名前のそばの印（T70。デモ以外は本人役） */
  fiction?: FictionKind;
  /** 通話で聞いた安否を表に渡さなかった手（T84） */
  refused?: Refused;
}) {
  const lastId = actions.at(-1)?.id ?? null;
  if (actions.length === 0) return <p className="text-sm text-muted">{DRILL_LABELS.none}</p>;
  const steps = [...new Set(actions.map((a) => a.step))].sort((a, b) => b - a);
  return (
    <div className="space-y-1.5" data-action-log>
      <h3 className={LABEL}>{ACTION_UI.history}</h3>
      {steps.map((st) => {
        const own = actions.filter((a) => a.step === st).reverse();
        return (
          <details key={st} open={st === current || st === steps[0]} className="group" data-log-step={st}>
            <summary
              className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1 text-sm [&::-webkit-details-marker]:hidden"
              data-press
            >
              <OpenIcon aria-hidden className="size-4 shrink-0 -rotate-90 text-muted transition-transform group-open:rotate-0" />
              <span className="font-bold">{elapsedLabel(hours[st] ?? 0)}</span>
              <span className="text-xs text-muted tabular-nums">
                {own.length} {ACTION_UI.count}
              </span>
            </summary>
            <ol className="mt-1 space-y-1">
              {own.map((a) => (
                <ActionItem
                  key={a.id}
                  a={a}
                  names={names}
                  voiceOf={voiceOf}
                  fiction={fiction}
                  refused={refused}
                  {...(undo && a.id === lastId ? { undo } : {})}
                />
              ))}
            </ol>
          </details>
        );
      })}
    </div>
  );
}
