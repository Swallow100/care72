// 訓練の対応の結果と履歴（docs/tasks/T20.md）。サーバーで描く（状態を持たない）。
// - 結果（LatestResult）: いちばん新しい手の世界の返事。電話に出た人の言う事は吹き出し（本人役 Haiku の言葉は AI の印）、
//   監督（Opus）の言い換えの文も AI の印。手の途中で刻みを越えたら、その間の安否を「着信」で並べる（着信の画面と声は T21）
// - 履歴（ActionLog）: 刻みごとに畳める（今の刻みだけ開く）。新しい順。誰に・何を・何時・返事
// 返事の印の色: 通話・到着・手配済・受入・報告済・避難済は緑、つながらない・着けない・断られたは黄（次の手が要る）。
// 正解・不正解は出さない（採点は T22）。名前は台帳の id から引く（記録には名前が無い）。

import { AiMark, StateTag } from "@/components/person/parts";
import { ACTION_STATUS_LABELS } from "@/lib/drill/actions";
import type { ActionRecord, ActionResult, DrillTurn, Tick } from "@/lib/drill/engine";
import { ACTION_LABELS, ACTION_UI, clockLabel, DRILL_LABELS, elapsedLabel } from "@/lib/drill/labels";
import { COLOR_LABELS, CONTACT_KIND_LABELS } from "@/lib/labels";
import { SOURCE_LABELS } from "@/lib/list/detail";
import type { StateTone } from "@/lib/person";
import { ActionIcon, CallInIcon, ChevronIcon } from "./icons";

type Names = Readonly<Record<string, string>>;

function toneOf(r: ActionResult): StateTone {
  if (r.ok) return "ok";
  return r.status === "ringing" ? "unknown" : "check";
}

const TURN_TONES: Record<DrillTurn["color"], StateTone> = { red: "urgent", green: "ok", unknown: "unknown" };
const TURN_LABELS: Record<DrillTurn["color"], string> = { red: COLOR_LABELS.red, green: COLOR_LABELS.green, unknown: COLOR_LABELS.gray };

/** 手の相手の言い方（訪問依頼で相手なしは事業所の職員、行政報告で相手なしは市役所、受入依頼は福祉避難所） */
function calleeText(a: ActionRecord): string | null {
  if (a.calleeLabel) return a.calleeLabel;
  if (a.kind === "dispatch") return ACTION_UI.staff;
  if (a.kind === "report_city") return ACTION_UI.city;
  if (a.kind === "request_welfare_shelter") return ACTION_UI.shelter;
  return null;
}

/** 手の 1 行（時刻・手・誰に・相手・返事） */
function Head({ a, names }: { a: ActionRecord; names: Names }) {
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
      {who && <span>{who}</span>}
      {callee && callee !== CONTACT_KIND_LABELS.self && <span className="text-xs text-muted">{callee}</span>}
      {r ? (
        <>
          <StateTag tone={toneOf(r)}>{ACTION_STATUS_LABELS[r.status]}</StateTag>
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

/** 電話に出た人の言う事（吹き出し） */
function Bubble({ speaker, text, ai, large = false }: { speaker: string; text: string; ai: boolean; large?: boolean }) {
  return (
    <div className="relative ml-3 mt-1.5 max-w-prose rounded-lg bg-panel px-2.5 py-1.5" data-speech data-speech-ai={ai ? "" : undefined}>
      <span aria-hidden="true" className="absolute -left-1 top-2.5 size-2 rotate-45 bg-panel" />
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span>{speaker}</span>
        {ai && <AiMark small />}
      </div>
      <p className={large ? "text-base" : "text-sm"}>「{text}」</p>
    </div>
  );
}

function ActionItem({ a, names }: { a: ActionRecord; names: Names }) {
  const r = a.result;
  return (
    <li className="rounded-md bg-panel2 px-2 py-1.5 text-sm" data-act={a.id} data-act-kind={a.kind} data-act-status={r?.status ?? "pending"}>
      <Head a={a} names={names} />
      {r?.speech && <Bubble speaker={calleeText(a) ?? ""} text={r.speech} ai={r.speechAi} />}
    </li>
  );
}

/** いちばん新しい手の返事（実行のすぐ下）。刻みを越えた手は、その間の安否を着信で並べる */
export function LatestResult({ action, names, ticks }: { action: ActionRecord; names: Names; ticks: ReadonlyArray<Tick> }) {
  const r = action.result;
  const crossed = r ? ticks.filter((t) => r.crossed.includes(t.step)) : [];
  const calls = crossed.flatMap((t) => t.turns);
  return (
    <section aria-label={ACTION_UI.result} className="rounded-md bg-panel2 px-2.5 py-2" data-latest={action.id}>
      <div className="text-sm">
        <Head a={action} names={names} />
      </div>
      {r?.speech && <Bubble speaker={calleeText(action) ?? ""} text={r.speech} ai={r.speechAi} large />}
      {calls.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" data-call-ins>
          {calls.map((t, i) => (
            <CallInItem key={`${t.person}-${i}`} t={t} name={names[t.person] ?? t.person} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 着信の印 */
export function CallInMark() {
  return (
    <span className="inline-flex items-center gap-0.5 self-center rounded bg-panel px-1 py-px text-xs font-bold" data-call-in-mark>
      <CallInIcon className="size-3" />
      {ACTION_UI.callIn}
    </span>
  );
}

function CallInItem({ t, name }: { t: DrillTurn; name: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-call-in={t.person}>
      <CallInMark />
      <span className="font-bold">{name}</span>
      <StateTag tone={TURN_TONES[t.color]}>{TURN_LABELS[t.color]}</StateTag>
      <span className="text-xs text-muted">{SOURCE_LABELS[t.source]}</span>
      {t.ai && <AiMark small />}
      {t.saying && <span>「{t.saying}」</span>}
    </li>
  );
}

/** 手の履歴。刻みごとに畳める（今の刻みだけ開く）。新しい順 */
export function ActionLog({
  actions,
  hours,
  current,
  names,
}: {
  actions: ReadonlyArray<ActionRecord>;
  hours: readonly number[];
  /** 今（見ている）の刻み */
  current: number;
  names: Names;
}) {
  if (actions.length === 0) return <p className="text-sm text-muted">{DRILL_LABELS.none}</p>;
  const steps = [...new Set(actions.map((a) => a.step))].sort((a, b) => b - a);
  return (
    <div className="space-y-1.5" data-action-log>
      <h3 className="text-xs font-bold text-muted">{ACTION_UI.history}</h3>
      {steps.map((st) => {
        const own = actions.filter((a) => a.step === st).reverse();
        return (
          <details key={st} open={st === current} className="group" data-log-step={st}>
            <summary
              className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1 text-sm [&::-webkit-details-marker]:hidden"
              data-press
            >
              <ChevronIcon className="size-3.5 -rotate-90 transition-transform group-open:rotate-0" />
              <span className="font-bold">{elapsedLabel(hours[st] ?? 0)}</span>
              <span className="text-xs text-muted tabular-nums">
                {own.length} {ACTION_UI.count}
              </span>
            </summary>
            <ol className="mt-1 space-y-1">
              {own.map((a) => (
                <ActionItem key={a.id} a={a} names={names} />
              ))}
            </ol>
          </details>
        );
      })}
    </div>
  );
}
