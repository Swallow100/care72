// 訓練の真ん中の「状況」（docs/tasks/T17.md）。刻みごとに新しい順: 世界の出来事（停電・道路・電話・避難所…）と、
// 本人ごとの安否（色の印・誰から・答え・言う事）。監督（Opus、T19）が差し込んだ状況とペルソナ（T18）の物には AI の印。
// 想定の表の固定の差し込みは AI の印なし。差し込みに根拠の出典があれば添える（監督の判断の理由は訓練記録にだけ残し、画面に出さない）。
// 色は安否の色だけ（lib/triage の色ではなく、本人・家族が押した色）。氏名は台帳の id から引く（表の文には氏名が無い）。
// ケアマネの手（T20）の途中で進んだ刻みは、見出しに「対応中 訪問 伊藤 フミ」、その刻みの安否に着信の印（着信の画面と声は T21）。

import { AiMark, StateTag } from "@/components/person/parts";
import { shortJst } from "@/lib/disaster/state";
import type { DrillIncident, DrillTurn, Tick } from "@/lib/drill/engine";
import { simAt } from "@/lib/drill/engine";
import { ACTION_UI, BASIS_LABEL, DRILL_LABELS, elapsedLabel, EVENT_KIND_LABELS } from "@/lib/drill/labels";
import { CallInMark } from "./ActionLog";
import { COLOR_LABELS } from "@/lib/labels";
import { SOURCE_LABELS } from "@/lib/list/detail";
import type { StateTone } from "@/lib/person";
import { signalLogBody } from "@/lib/signals/labels";
import { isSourceId, sourceById } from "@/lib/sources";

const TURN_TONES: Record<DrillTurn["color"], StateTone> = { red: "urgent", green: "ok", unknown: "unknown" };
const TURN_LABELS: Record<DrillTurn["color"], string> = { red: COLOR_LABELS.red, green: COLOR_LABELS.green, unknown: COLOR_LABELS.gray };

function turnBody(t: DrillTurn): string {
  if (t.color === "unknown") return COLOR_LABELS.gray;
  return signalLogBody({
    color: t.color,
    whereNow: t.whereNow,
    answers: { injured: t.injured, atHome: t.atHome, canMove: t.canMove, hasMedicine: t.hasMedicine },
  });
}

export function Situation({
  ticks,
  names,
  startedAt,
  during = {},
}: {
  ticks: ReadonlyArray<Tick>;
  names: Readonly<Record<string, string>>;
  startedAt: string;
  /** ケアマネの手の途中で進んだ刻み → その手の言い方（「訪問 伊藤 フミ」、T20）。その刻みの安否は着信の印 */
  during?: Readonly<Record<number, string>>;
}) {
  const order = [...ticks].reverse();
  return (
    <ol className="space-y-2" data-situation>
      {order.map((t) => (
        <li key={t.step} className="rounded-md bg-panel2 px-2.5 py-2" data-situation-step={t.step}>
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-bold">{elapsedLabel(t.hour)}</span>
            <span className="text-xs text-muted tabular-nums">{shortJst(simAt(startedAt, t.hour))}</span>
            {during[t.step] && (
              <span className="text-xs text-muted" data-during>
                {ACTION_UI.during} {during[t.step]}
              </span>
            )}
          </h3>
          {t.incidents.length === 0 && t.turns.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{DRILL_LABELS.none}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {t.incidents.map((e, n) => (
                <IncidentItem key={`e${n}`} e={e} name={e.person ? names[e.person] : undefined} tickHour={t.hour} />
              ))}
              {t.turns.map((x, n) => (
                <TurnItem key={`t${n}`} t={x} name={names[x.person] ?? x.person} tickHour={t.hour} callIn={Boolean(during[t.step])} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function At({ at, tickHour }: { at: number; tickHour: number }) {
  if (at === tickHour) return null;
  return <span className="text-xs text-muted tabular-nums">{at} {DRILL_LABELS.hours}</span>;
}

function IncidentItem({ e, name, tickHour }: { e: DrillIncident; name: string | undefined; tickHour: number }) {
  const basis = e.basis && isSourceId(e.basis) ? sourceById(e.basis) : null;
  return (
    <li
      className="flex flex-wrap items-baseline gap-x-1.5"
      data-incident={e.change.kind}
      data-actor={e.actor}
      {...(e.inject ? { "data-inject": e.inject } : {})}
    >
      <span className="rounded bg-panel px-1 py-px text-xs text-muted">{EVENT_KIND_LABELS[e.change.kind]}</span>
      {e.ai && <AiMark small />}
      <span>{e.text}</span>
      {name && <span className="text-xs text-muted">{name}</span>}
      <At at={e.at} tickHour={tickHour} />
      {basis && (
        <a
          href={basis.url}
          target="_blank"
          rel="noreferrer"
          title={basis.title}
          className="-mx-0.5 rounded px-0.5 text-xs text-accent underline underline-offset-2"
          data-press
          data-basis={basis.id}
        >
          {BASIS_LABEL} {basis.publisher} {basis.year}
        </a>
      )}
    </li>
  );
}

function TurnItem({ t, name, tickHour, callIn }: { t: DrillTurn; name: string; tickHour: number; callIn: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-turn={t.person} data-color={t.color} data-call-in={callIn ? "" : undefined}>
      {callIn && <CallInMark />}
      <span className="font-bold">{name}</span>
      <StateTag tone={TURN_TONES[t.color]}>{TURN_LABELS[t.color]}</StateTag>
      <span className="text-xs text-muted">{SOURCE_LABELS[t.source]}</span>
      {t.ai && <AiMark small />}
      <span>{turnBody(t)}</span>
      {t.saying && <span>「{t.saying}」</span>}
      {t.doing && <span className="text-xs text-muted">{t.doing}</span>}
      <At at={t.at} tickHour={tickHour} />
    </li>
  );
}
