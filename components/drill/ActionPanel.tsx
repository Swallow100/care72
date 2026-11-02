"use client";

// 訓練の対応の欄（docs/tasks/T20.md）: 対象の本人を選び、7 つの手から 1 つ、要れば相手（台帳の連絡先）を選んで実行。
// 実行は 1 要求で手 1 つ（POST /api/drill/<id>/action）。手の所要時間だけ時計が進み、次の刻みを越えたらその刻みも進む。
// 終わったら画面を読み直す（router.refresh）。結果と履歴はサーバーが描く（ActionLog）。断られたら理由を 1 行。
// 選んだ印は枠（ring）と太字。テーマ色の下地は敷かない。押したときは灰色だけ（data-press）。主の操作（実行）だけ操作の色。
// この画面で正解・不正解を出さない（採点は T22）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PlayIcon } from "@/components/ui/Icon";
import { LABEL } from "@/components/ui/Panel";
import type { DrillAction } from "@/lib/db/types";
import { DRILL_ACTIONS } from "@/lib/db/types";
import { ACTION_MINUTES, needsPerson, needsTarget, picksTarget, targetKinds } from "@/lib/drill/action-table";
import { ACTION_LABELS, ACTION_UI, CALL_STATUS_LABELS, DRILL_LABELS } from "@/lib/drill/labels";
import type { DrillContact } from "@/lib/drill/view";
import { ACTION_ICONS } from "./icons";

export type PanelPerson = {
  id: string;
  name: string;
  /** 左の表の色の印（サーバーで描いた StateTag） */
  tag: React.ReactNode;
};

/** 訪問依頼の「事業所の職員」（連絡先の行でない） */
const STAFF = "__staff__";

/** 選ぶボタン（components/ui の plain を左寄せで欄いっぱいに）。選んでいない物は細字、選んだ物は太字と枠（ring）。下地は変えない */
const TOGGLE = "w-full min-w-0 justify-start! px-2! font-normal!";
const PICKED = "font-bold! ring-2 ring-inset ring-accent";
/** 選ぶボタンの並び（幅に合わせて段を折る。横に送らない） */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1";

export function ActionPanel({
  drillId,
  step,
  actions,
  people,
  contacts,
}: {
  drillId: string;
  step: number;
  /** 読んだ手の数（二度押し・ほかの画面の手は競合） */
  actions: number;
  /** 対象の本人（左の表の優先の順） */
  people: ReadonlyArray<PanelPerson>;
  contacts: Readonly<Record<string, ReadonlyArray<DrillContact>>>;
}) {
  const router = useRouter();
  const [person, setPerson] = useState<string | null>(null);
  const [kind, setKind] = useState<DrillAction | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const own = person ? (contacts[person] ?? []) : [];
  const choices = (k: DrillAction) => own.filter((c) => targetKinds(k).includes(c.kind));
  const usable = (k: DrillAction) => {
    if (needsPerson(k) && !person) return false;
    if (needsTarget(k) && choices(k).length === 0) return false;
    return true;
  };
  const ready = kind !== null && usable(kind) && (!needsTarget(kind) || (target !== null && target !== STAFF));
  const name = people.find((p) => p.id === person)?.name ?? null;
  const targetLabel =
    kind && picksTarget(kind) ? (target === STAFF ? ACTION_UI.staff : (own.find((c) => c.id === target)?.label ?? null)) : null;

  const choosePerson = (id: string) => {
    setPerson((now) => (now === id ? null : id));
    setTarget(null);
    setError(null);
  };
  const chooseKind = (k: DrillAction) => {
    setKind((now) => (now === k ? null : k));
    setTarget(k === "dispatch" ? STAFF : null);
    setError(null);
  };

  const run = async () => {
    if (!ready || !kind) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(drillId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          actions,
          kind,
          person: kind === "evacuate_self" ? null : person,
          target: target === STAFF ? null : target,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.label ?? String(res.status));
      } else {
        setKind(null);
        setTarget(null);
      }
      router.refresh();
    } catch {
      setError(DRILL_LABELS.network);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5" data-action-panel>
      <section aria-labelledby="act-person">
        <h3 id="act-person" className={`mb-1 ${LABEL}`}>
          {ACTION_UI.person}
        </h3>
        <div className={GRID}>
          {people.map((p) => (
            <Button
              key={p.id}
              aria-pressed={person === p.id}
              onClick={() => choosePerson(p.id)}
              className={`${TOGGLE} ${person === p.id ? PICKED : ""}`}
              data-act-person={p.id}
            >
              {p.tag}
              <span className="min-w-0 truncate">{p.name}</span>
            </Button>
          ))}
        </div>
      </section>

      <section aria-labelledby="act-kind">
        <h3 id="act-kind" className={`mb-1 ${LABEL}`}>
          {DRILL_LABELS.actions}
        </h3>
        <div className={GRID}>
          {DRILL_ACTIONS.map((k) => (
            <Button
              key={k}
              icon={ACTION_ICONS[k]}
              aria-pressed={kind === k}
              disabled={!usable(k) || busy}
              onClick={() => chooseKind(k)}
              className={`${TOGGLE} ${kind === k ? PICKED : ""}`}
              data-act-kind={k}
            >
              <span className="min-w-0 flex-1 truncate text-left">{ACTION_LABELS[k]}</span>
              <span className="text-xs font-normal text-muted tabular-nums">
                {ACTION_MINUTES[k]} {ACTION_UI.minutes}
              </span>
            </Button>
          ))}
        </div>
      </section>

      {kind && picksTarget(kind) && person && (
        <section aria-labelledby="act-target">
          <h3 id="act-target" className={`mb-1 ${LABEL}`}>
            {ACTION_UI.target}
          </h3>
          <div className={GRID}>
            {kind === "dispatch" && (
              <Button
                aria-pressed={target === STAFF}
                onClick={() => setTarget(STAFF)}
                className={`${TOGGLE} ${target === STAFF ? PICKED : ""}`}
                data-act-target="staff"
              >
                {ACTION_UI.staff}
              </Button>
            )}
            {choices(kind).map((c) => (
              <Button
                key={c.id}
                aria-pressed={target === c.id}
                onClick={() => setTarget(c.id)}
                className={`${TOGGLE} ${target === c.id ? PICKED : ""}`}
                data-act-target={c.id}
              >
                <span className="min-w-0 flex-1 truncate text-left">{c.label}</span>
                {!c.hasPhone && <span className="text-xs font-normal text-muted">{CALL_STATUS_LABELS.noNumber}</span>}
              </Button>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button kind="main" icon={PlayIcon} onClick={() => void run()} disabled={!ready || busy} data-action="act">
          {ACTION_UI.execute}
        </Button>
        {kind && (
          <span className="text-sm" data-act-summary>
            <span className="font-bold">{ACTION_LABELS[kind]}</span>
            {kind !== "evacuate_self" && name ? ` ${name}` : ""}
            {targetLabel ? ` ${targetLabel}` : ""}
            <span className="ml-1.5 text-xs text-muted tabular-nums">
              {ACTION_MINUTES[kind]} {ACTION_UI.minutes}
            </span>
          </span>
        )}
        {error && (
          <span role="alert" className="text-sm font-bold text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
