// 訓練の真ん中の「状況」（docs/tasks/T17.md）。刻みごとに新しい順: 世界の出来事（停電・道路・電話・避難所…）と、
// 本人ごとの安否（色の印・誰から・答え・言う事）。監督の差し込み（T19）とペルソナ（T18）の物には AI の印。
// 色は安否の色だけ（lib/triage の色ではなく、本人・家族が押した色）。氏名は台帳の id から引く（表の文には氏名が無い）。

import { AiMark, StateTag } from "@/components/person/parts";
import { shortJst } from "@/lib/disaster/state";
import type { DrillIncident, DrillTurn, Tick } from "@/lib/drill/engine";
import { simAt } from "@/lib/drill/engine";
import { DRILL_LABELS, elapsedLabel, EVENT_KIND_LABELS } from "@/lib/drill/labels";
import { COLOR_LABELS } from "@/lib/labels";
import { SOURCE_LABELS } from "@/lib/list/detail";
import type { StateTone } from "@/lib/person";
import { signalLogBody } from "@/lib/signals/labels";

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
}: {
  ticks: ReadonlyArray<Tick>;
  names: Readonly<Record<string, string>>;
  startedAt: string;
}) {
  const order = [...ticks].reverse();
  return (
    <ol className="space-y-2" data-situation>
      {order.map((t) => (
        <li key={t.step} className="rounded-md bg-panel2 px-2.5 py-2" data-situation-step={t.step}>
          <h3 className="flex items-baseline gap-2 text-sm">
            <span className="font-bold">{elapsedLabel(t.hour)}</span>
            <span className="text-xs text-muted tabular-nums">{shortJst(simAt(startedAt, t.hour))}</span>
          </h3>
          {t.incidents.length === 0 && t.turns.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{DRILL_LABELS.none}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {t.incidents.map((e, n) => (
                <IncidentItem key={`e${n}`} e={e} name={e.person ? names[e.person] : undefined} tickHour={t.hour} />
              ))}
              {t.turns.map((x, n) => (
                <TurnItem key={`t${n}`} t={x} name={names[x.person] ?? x.person} tickHour={t.hour} />
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
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-incident={e.change.kind} data-actor={e.actor}>
      <span className="rounded bg-panel px-1 py-px text-xs text-muted">{EVENT_KIND_LABELS[e.change.kind]}</span>
      {e.ai && <AiMark small />}
      <span>{e.text}</span>
      {name && <span className="text-xs text-muted">{name}</span>}
      <At at={e.at} tickHour={tickHour} />
    </li>
  );
}

function TurnItem({ t, name, tickHour }: { t: DrillTurn; name: string; tickHour: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-turn={t.person} data-color={t.color}>
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
