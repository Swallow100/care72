"use client";

// 打てる手の候補（docs/tasks/T126.md）。対応の欄（ActionPanel）の手の段の上と、本人の詳細（DrillRowDetail）に同じ形で出す。
// 1 行 = 元（頼み事・公表の事実・時計。同じ手の並びの元はまとめた物）→ 手のボタン。電話の手が全部押せない時は「代替」の 1 行。
// 中身は lib/drill/action-hints.ts（表と可否。色と連絡順には使わない）。候補は短い印で、何をすべきとは書かない。
// 押せる候補を押すと、対応の欄でその本人とその手を選ぶ（対応の欄の中は onPick、本人の詳細からは対応の欄に渡す口 act-pick の pickAct。
// 詳細の連絡先の行 T132 と同じ口）。
// 押せない候補は薄く（地を外し字を弱く）、理由の 2〜4 字は読める濃さで残す。手配済は押せるまま印だけ。押したときは灰色だけ（Button）。

import { TONE_TEXT } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import type { DrillAction } from "@/lib/db/types";
import { ACTOR_LABELS, HINT_LABELS, timeParts, type ActionHints, type HintAct, type HintSource } from "@/lib/drill/action-hints";
import { ACTION_LABELS, ACTION_UI } from "@/lib/drill/labels";
import { pickAct } from "./act-pick";
import { ACTION_ICONS } from "./icons";

/** 押せない手の見た目（地を外し、字とアイコンを薄く。理由の字は別に text-muted で残す） */
export const FADED = "bg-transparent! text-muted/60! font-normal!";
/** 選んだ印（枠と太字。下地は変えない） */
export const PICKED = "font-bold! ring-2 ring-inset ring-accent";
/** 区分の段（左に見出し 2 字、右に中身）。対応の欄の手の段と同じ */
export const GROUP_ROW = "grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-1.5";

/** 手の時間（訪問「自分 40 分」、訪問依頼「自分 10 分 職員 40 分」、ほか「5 分」）。伸びた所要は太字 */
export function ActTime({ kind, minutes, longer = false }: { kind: DrillAction; minutes: number; longer?: boolean }) {
  if (minutes <= 0) return null;
  const parts = timeParts(kind, minutes);
  return (
    <span className="inline-flex gap-1 text-xs whitespace-nowrap tabular-nums" data-act-time={parts.map((p) => `${p.who ?? ""}${p.minutes}`).join(" ")}>
      {parts.map((p, i) => (
        <span key={i} className={i === 0 && longer ? "font-bold text-ink" : "font-normal text-muted"}>
          {p.who && <span className="mr-1">{ACTOR_LABELS[p.who]}</span>}
          {p.minutes} {ACTION_UI.minutes}
        </span>
      ))}
    </span>
  );
}

function SourceText({ s }: { s: HintSource }) {
  return (
    <span className="whitespace-nowrap" data-hint-source={s.from}>
      <span className="font-bold">{s.label}</span>
      {s.from === "clock" && s.remaining && (
        <span className={`ml-1 font-bold tabular-nums ${s.tone ? TONE_TEXT[s.tone] : "text-muted"}`}>{s.remaining}</span>
      )}
    </span>
  );
}

function HintButton({
  a,
  picked,
  onPick,
  disabled,
  inPanel,
}: {
  a: HintAct;
  picked: boolean;
  onPick: (k: DrillAction) => void;
  disabled: boolean;
  inPanel: boolean;
}) {
  const block = a.state === "block";
  return (
    <Button
      kind={inPanel ? "plain" : "plainIn"}
      size="sm"
      icon={ACTION_ICONS[a.kind]}
      aria-pressed={inPanel ? picked : undefined}
      disabled={block || disabled}
      onClick={() => onPick(a.kind)}
      className={`font-normal! ${block ? FADED : ""} ${picked ? PICKED : ""}`}
      data-hint-act={a.kind}
      data-hint-state={a.state}
    >
      <span>{ACTION_LABELS[a.kind]}</span>
      {a.why ? (
        <span className="text-xs font-normal text-muted" data-hint-why>
          {a.why}
        </span>
      ) : (
        <ActTime kind={a.kind} minutes={a.minutes} />
      )}
    </Button>
  );
}

/**
 * 候補の行の並び。onPick が無ければ（本人の詳細）、押すと対応の欄に渡す口（act-pick の pickAct）で本人と手を送る。inPanel は対応の欄の中（面の上の灰色のボタン）、
 * 本人の詳細は面の中の上なので白のボタン
 */
export function ActionHintRows({
  person,
  hints,
  picked = null,
  onPick,
  disabled = false,
  inPanel = false,
}: {
  person: string;
  hints: ActionHints;
  picked?: DrillAction | null;
  onPick?: (k: DrillAction) => void;
  disabled?: boolean;
  inPanel?: boolean;
}) {
  const pick =
    onPick ??
    ((kind: DrillAction) => {
      pickAct({ person, kind, target: null });
    });
  const row = (key: string, head: React.ReactNode, acts: ReadonlyArray<HintAct>, attr: Record<string, string>) => (
    <div key={key} className="flex flex-wrap items-center gap-x-1.5 gap-y-1" {...attr}>
      <span className="mr-0.5 inline-flex flex-wrap items-baseline gap-x-1 text-xs">{head}</span>
      {acts.map((a) => (
        <HintButton key={a.kind} a={a} picked={picked === a.kind} onPick={pick} disabled={disabled} inPanel={inPanel} />
      ))}
    </div>
  );
  return (
    <div className="space-y-1" data-hints={person}>
      {hints.groups.map((g, i) =>
        row(
          `g${i}`,
          g.sources.map((s, j) => (
            <span key={j} className="inline-flex items-baseline gap-x-1">
              {j > 0 && <span className="text-muted">・</span>}
              <SourceText s={s} />
            </span>
          )),
          g.actions,
          { "data-hint-row": g.sources.map((s) => s.from).join(" ") },
        ),
      )}
      {hints.alt &&
        row("alt", <span className="font-bold">{HINT_LABELS.alt}</span>, hints.alt, { "data-hint-row": "alt", "data-hint-alt": "" })}
    </div>
  );
}

/** 本人の詳細の候補（見出し「候補」と行の並び）。押すと対応の欄でその本人とその手を選ぶ */
export function DetailHints({ person, hints }: { person: string; hints: ActionHints }) {
  return (
    <div className="flex flex-wrap items-start gap-x-1.5" data-detail-hints>
      <span className="text-xs leading-7 text-muted">{HINT_LABELS.head}</span>
      <div className="min-w-0 flex-1">
        <ActionHintRows person={person} hints={hints} />
      </div>
    </div>
  );
}
