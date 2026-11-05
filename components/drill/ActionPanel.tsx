"use client";

// 訓練の対応の欄（docs/tasks/T20.md・T91.md）: 対象の本人を選び、手の表の 18 の手から 1 つ、要れば相手（台帳の連絡先）を選んで実行。
// 手は区分（連絡・訪問・手配・報告・記録）の段で並べる（lib/drill/action-catalog.ts の並び）。10 分版も同じ部品で同じ段。
// 相手の連絡先の要る手で台帳に相手が無ければ押せない（灰）。固定の相手のある手（訪問依頼 → 事業所、移送・電源 → 市役所）は選ばなければ固定の相手。
// 実行は 1 要求で手 1 つ（POST /api/drill/<id>/action）。手の所要時間だけ時計が進み、次の刻みを越えたらその刻みも進む。
// 終わったら画面を読み直す（router.refresh）。結果と履歴はサーバーが描く（ActionLog）。断られたら理由を 1 行。
// 選んだ印は枠（ring）と太字。テーマ色の下地は敷かない。押したときは灰色だけ（data-press）。主の操作（実行）だけ操作の色。
// この画面で正解・不正解を出さない（採点は T22）。
// メモ（T59）: 100 字まで、任意。手と一緒に送り、履歴と訓練記録に出す（Claude には渡さない）。
// T110: 上に時間を使う手の 1 行（status。使用・職員の空き・外出・次空）。決まりを選んだ訓練は、手の所要を決まりの表の値で（夜・浸水などで
// 伸びた分は太字）、押せない手と相手は灰で理由の 2〜4 字（「通行止」「通話不可」。lib/drill/action-terms.ts）。
// 自由対応は 200 字。「読替」で監督役が読み替え（POST /api/drill/<id>/free、10〜13 秒）、読み替えた手（表の手か「自由」とやり方）・相手・所要・
// 押せない理由を見せ、確かめてから実行（同じ文と本人なら Claude をもう 1 回呼ばない）。文か対象を直したら読み替え直し。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { PlayIcon, ReadIcon } from "@/components/ui/Icon";
import { Loader72 } from "@/components/ui/Loader72";
import { LABEL } from "@/components/ui/Panel";
import type { DrillAction } from "@/lib/db/types";
import {
  ACTION_GROUP_LABELS,
  ACTION_GROUPS,
  actionRow,
  actionsOfGroup,
  FIXED_CALLEE_LABELS,
  FREE_LABELS,
  FREE_TEXT_MAX,
} from "@/lib/drill/action-catalog";
import type { ActionTerm, TermCallee } from "@/lib/drill/action-terms";
import { ACTION_MINUTES, needsPerson, needsTarget, picksTarget, targetKinds } from "@/lib/drill/action-table";
import type { FreePlanView } from "@/lib/drill/http";
import { ACTION_LABELS, ACTION_UI, CALL_STATUS_LABELS, DRILL_LABELS, T59_LABELS } from "@/lib/drill/labels";
import type { DrillContact } from "@/lib/drill/view";
import type { FictionKind } from "@/lib/drill/fiction";
import { useActPick } from "./act-pick";
import { FictionalMark } from "./Fictional";
import { ACTION_ICONS } from "./icons";

export type PanelPerson = {
  id: string;
  name: string;
  /** 左の表の色の印（サーバーで描いた StateTag） */
  tag: React.ReactNode;
};

/** 固定の相手（訪問依頼の「事業所の職員」、移送・電源の「市役所」。連絡先の行でない） */
const FIXED = "__fixed__";

/** 選ぶボタン（components/ui の plain を左寄せで欄いっぱいに）。選んでいない物は細字、選んだ物は太字と枠（ring）。下地は変えない */
const TOGGLE = "w-full min-w-0 justify-start! px-2! font-normal!";
const PICKED = "font-bold! ring-2 ring-inset ring-accent";
/** 選ぶボタンの並び（幅に合わせて段を折る。横に送らない） */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1";
/** 手の区分の段（左に区分の名前 2 字、右に手のボタン） */
const GROUP_ROW = "grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-1.5";
/** メモの欄（面の中の色、枠線なし。焦点は操作の色の枠） */
const MEMO_FIELD =
  "h-8 w-full min-w-0 rounded bg-panel2 px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
/** 自由対応の文の欄（メモの欄と同じ面の中の色。3 行） */
const FREE_FIELD =
  "block min-h-16 w-full min-w-0 resize-y rounded bg-panel2 px-2 py-1.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
/** メモの長さの上限（lib/drill/db.ts の MEMO_MAX と同じ） */
const MEMO_MAX = 100;

export function ActionPanel({
  drillId,
  step,
  actions,
  people,
  contacts,
  fiction,
  terms = null,
  status = null,
}: {
  drillId: string;
  step: number;
  /** 読んだ手の数（二度押し・ほかの画面の手は競合） */
  actions: number;
  /** 対象の本人（左の表の優先の順） */
  people: ReadonlyArray<PanelPerson>;
  contacts: Readonly<Record<string, ReadonlyArray<DrillContact>>>;
  /** 名前のそばの印（T70。デモ以外は本人役） */
  fiction?: FictionKind;
  /** 手の可否と所要（T110。本人の id、全体は "" → 手 → 所要・押せない理由）。決まりを選ばなかった訓練は null（表の分のまま） */
  terms?: Readonly<Record<string, Readonly<Record<DrillAction, ActionTerm>>>> | null;
  /** 時間を使う手の 1 行（T110、サーバーで描いた BusyLine） */
  status?: React.ReactNode;
}) {
  const router = useRouter();
  const [person, setPerson] = useState<string | null>(null);
  const [kind, setKind] = useState<DrillAction | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 自由対応の読み替え（T110）。読んだ文と本人。文か本人が変われば古い */
  const [plan, setPlan] = useState<{ text: string; person: string | null; view: FreePlanView } | null>(null);
  const [reading, setReading] = useState(false);
  // 行の詳細の連絡先の行から（T132、components/drill/act-pick.ts の口）: 本人・手・相手を選んだ形にする
  useActPick((p) => {
    setPerson(p.person);
    setKind(p.kind);
    setTarget(p.target);
    setError(null);
  });

  const own = person ? (contacts[person] ?? []) : [];
  const choices = (k: DrillAction) => own.filter((c) => targetKinds(k).includes(c.kind));
  const fixedOf = (k: DrillAction) => actionRow(k).fixed;
  // 決まりの表（T110）: 所要と押せない理由。無ければ表の分のまま
  const termOf = (k: DrillAction): ActionTerm | null => terms?.[person ?? ""]?.[k] ?? null;
  const minutesOf = (k: DrillAction) => termOf(k)?.minutes ?? ACTION_MINUTES[k];
  const targetBlock = (k: DrillAction, key: TermCallee): string | null => {
    const t = termOf(k);
    return t ? (t.block ?? t.targets[key] ?? null) : null;
  };
  /** 手全体が押せない理由（相手を選ぶ手は、選べる相手が全部押せないとき） */
  const blockOf = (k: DrillAction): string | null => {
    const t = termOf(k);
    if (!t) return null;
    if (t.block) return t.block;
    if (person && picksTarget(k)) {
      const keys: TermCallee[] = [...(fixedOf(k) ? (["fixed"] as TermCallee[]) : []), ...choices(k).map((c) => c.kind)];
      if (keys.length > 0 && keys.every((x) => t.targets[x])) return t.targets[keys[0]] ?? null;
    }
    return null;
  };
  const usable = (k: DrillAction) => {
    if (needsPerson(k) && !person) return false;
    if (needsTarget(k) && choices(k).length === 0) return false;
    return blockOf(k) === null;
  };
  /** 選んだ相手の決まりの区分（固定の相手は fixed、本人電話は本人） */
  const targetKey = (k: DrillAction): TermCallee | null => {
    if (k === "call_person") return "self";
    if (target === FIXED) return "fixed";
    if (target) return own.find((c) => c.id === target)?.kind ?? null;
    return fixedOf(k) && !needsTarget(k) ? "fixed" : null;
  };
  const isFree = kind === "free";
  const freeLength = [...text.trim()].length;
  const fresh = plan !== null && plan.text === text.trim() && plan.person === person;
  const chosenKey = kind && !isFree ? targetKey(kind) : null;
  const chosenBlock = kind && chosenKey ? targetBlock(kind, chosenKey) : null;
  const ready =
    kind !== null &&
    usable(kind) &&
    chosenBlock === null &&
    (!needsTarget(kind) || (target !== null && target !== FIXED)) &&
    (!isFree || (freeLength > 0 && freeLength <= FREE_TEXT_MAX && fresh && plan.view.block === null));
  const name = people.find((p) => p.id === person)?.name ?? null;
  const fixedLabel = kind ? fixedOf(kind) : null;
  const targetLabel =
    kind && picksTarget(kind)
      ? target === FIXED
        ? fixedLabel
          ? FIXED_CALLEE_LABELS[fixedLabel]
          : null
        : (own.find((c) => c.id === target)?.label ?? null)
      : kind && fixedLabel && kind !== "dispatch" && kind !== "report_city" && kind !== "request_welfare_shelter"
        ? FIXED_CALLEE_LABELS[fixedLabel]
        : null;

  const choosePerson = (id: string) => {
    setPerson((now) => (now === id ? null : id));
    setTarget(kind && picksTarget(kind) && fixedOf(kind) ? FIXED : null);
    setError(null);
  };
  const chooseKind = (k: DrillAction) => {
    setKind((now) => (now === k ? null : k));
    setTarget(picksTarget(k) && fixedOf(k) ? FIXED : null);
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
          target: target === FIXED ? null : target,
          ...(memo.trim() ? { memo: memo.trim() } : {}),
          ...(isFree ? { text: text.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.label ?? String(res.status));
      } else {
        setKind(null);
        setTarget(null);
        setMemo("");
        setText("");
        setPlan(null);
      }
      router.refresh();
    } catch {
      setError(DRILL_LABELS.network);
    } finally {
      setBusy(false);
    }
  };

  /** 自由対応の読み替え（T110）。打つ前に相手と所要を見せる */
  const read = async () => {
    const t = text.trim();
    if (!isFree || !t || [...t].length > FREE_TEXT_MAX) return;
    setReading(true);
    setError(null);
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(drillId)}/free`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, actions, person, text: t }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string; plan?: FreePlanView } | null;
      if (!res.ok || !body?.ok || !body.plan) {
        setPlan(null);
        setError(body?.label ?? String(res.status));
        if (res.status === 409) router.refresh();
      } else {
        setPlan({ text: t, person, view: body.plan });
      }
    } catch {
      setError(DRILL_LABELS.network);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-2.5" data-action-panel>
      {status}
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
              <span className="min-w-0 truncate">
                {p.name}
                <FictionalMark kind={fiction} />
              </span>
            </Button>
          ))}
        </div>
      </section>

      <section aria-label={DRILL_LABELS.actions} className="space-y-1" data-act-kinds>
        {ACTION_GROUPS.map((g) => (
          <div key={g} role="group" aria-labelledby={`act-group-${g}`} className={GROUP_ROW} data-act-group={g}>
            <h3 id={`act-group-${g}`} className={`${LABEL} leading-8`}>
              {ACTION_GROUP_LABELS[g]}
            </h3>
            <div className={GRID}>
              {actionsOfGroup(g).map(({ id: k }) => {
                const block = blockOf(k);
                const longer = (termOf(k)?.adds.length ?? 0) > 0;
                return (
                  <Button
                    key={k}
                    icon={ACTION_ICONS[k]}
                    aria-pressed={kind === k}
                    disabled={!usable(k) || busy}
                    onClick={() => chooseKind(k)}
                    className={`${TOGGLE} ${kind === k ? PICKED : ""}`}
                    data-act-kind={k}
                    data-act-block={block ?? undefined}
                    data-act-minutes={minutesOf(k)}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{ACTION_LABELS[k]}</span>
                    {block ? (
                      <span className="text-xs font-normal text-muted" data-act-why>
                        {block}
                      </span>
                    ) : (
                      minutesOf(k) > 0 && (
                        <span className={`text-xs tabular-nums ${longer ? "font-bold text-ink" : "font-normal text-muted"}`}>
                          {minutesOf(k)} {ACTION_UI.minutes}
                        </span>
                      )
                    )}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {kind && picksTarget(kind) && person && (
        <section aria-labelledby="act-target">
          <h3 id="act-target" className={`mb-1 ${LABEL}`}>
            {ACTION_UI.target}
          </h3>
          <div className={GRID}>
            {fixedOf(kind) && (
              <Button
                aria-pressed={target === FIXED}
                onClick={() => setTarget(FIXED)}
                disabled={targetBlock(kind, "fixed") !== null}
                className={`${TOGGLE} ${target === FIXED ? PICKED : ""}`}
                data-act-target={fixedOf(kind)!}
              >
                <span className="min-w-0 flex-1 truncate text-left">{FIXED_CALLEE_LABELS[fixedOf(kind)!]}</span>
                {targetBlock(kind, "fixed") && <span className="text-xs font-normal text-muted">{targetBlock(kind, "fixed")}</span>}
              </Button>
            )}
            {choices(kind).map((c) => {
              const why = targetBlock(kind, c.kind);
              return (
                <Button
                  key={c.id}
                  aria-pressed={target === c.id}
                  onClick={() => setTarget(c.id)}
                  disabled={why !== null}
                  className={`${TOGGLE} ${target === c.id ? PICKED : ""}`}
                  data-act-target={c.id}
                  data-act-target-block={why ?? undefined}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{c.label}</span>
                  {why ? (
                    <span className="text-xs font-normal text-muted">{why}</span>
                  ) : (
                    !c.hasPhone && <span className="text-xs font-normal text-muted">{CALL_STATUS_LABELS.noNumber}</span>
                  )}
                </Button>
              );
            })}
          </div>
        </section>
      )}

      {isFree && (
        <label className="block" data-act-free>
          <span className={`mb-1 flex items-baseline gap-2 ${LABEL}`}>
            {FREE_LABELS.text}
            <span className="tabular-nums" data-act-free-left={FREE_TEXT_MAX - freeLength}>
              {FREE_LABELS.left} {Math.max(0, FREE_TEXT_MAX - freeLength)}
            </span>
          </span>
          <textarea
            value={text}
            maxLength={FREE_TEXT_MAX}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            disabled={busy || reading}
            className={FREE_FIELD}
            data-act-free-input
          />
        </label>
      )}

      {isFree && (
        <div className="space-y-1" data-act-free-plan={fresh ? (plan.view.block ? "block" : "ok") : plan ? "stale" : "none"}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              icon={ReadIcon}
              onClick={() => void read()}
              disabled={busy || reading || freeLength === 0 || freeLength > FREE_TEXT_MAX}
              data-action="free-read"
            >
              {plan && !fresh ? FREE_LABELS.stale : FREE_LABELS.read}
            </Button>
            {reading && <Loader72 label={FREE_LABELS.reading} size={18} className="text-sm text-muted" />}
          </div>
          {fresh && <FreePlanLine view={plan.view} />}
        </div>
      )}

      <label className="block" data-act-memo>
        <span className={`mb-1 flex items-baseline gap-2 ${LABEL}`}>
          {T59_LABELS.memo}
          <span className="tabular-nums">
            {[...memo].length} / {MEMO_MAX}
          </span>
        </span>
        <input
          type="text"
          value={memo}
          maxLength={MEMO_MAX}
          onChange={(e) => setMemo(e.target.value)}
          disabled={busy}
          className={MEMO_FIELD}
          data-act-memo-input
        />
      </label>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button kind="main" icon={PlayIcon} onClick={() => void run()} disabled={!ready || busy || reading} data-action="act">
          {ACTION_UI.execute}
        </Button>
        {kind && !isFree && (
          <span className="text-sm" data-act-summary>
            <span className="font-bold">{ACTION_LABELS[kind]}</span>
            {kind !== "evacuate_self" && name ? ` ${name}` : ""}
            {targetLabel ? ` ${targetLabel}` : ""}
            {minutesOf(kind) > 0 && (
              <span className="ml-1.5 text-xs text-muted tabular-nums">
                {minutesOf(kind)} {ACTION_UI.minutes}
                {(termOf(kind)?.adds.length ?? 0) > 0 && ` ${termOf(kind)!.adds.join("・")}`}
              </span>
            )}
            {chosenBlock && <span className="ml-1.5 text-xs font-bold text-danger">{chosenBlock}</span>}
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

/** 自由対応の読み替え（T110）。読み替えた手（表の手か「自由」とやり方）・相手・所要（伸びた理由）・AI の 1 文と理由・押せない理由 */
export function FreePlanLine({ view }: { view: FreePlanView }) {
  return (
    <div className="rounded bg-panel2 px-2 py-1.5 text-sm" data-free-plan-line data-free-as={view.as ?? "own"}>
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 tabular-nums">
        <span>
          <span className="text-xs text-muted">{view.as ? FREE_LABELS.read : FREE_LABELS.own}</span>{" "}
          <span className="font-bold">{view.label}</span>
          {view.way && <span className="ml-1">{view.way}</span>}
        </span>
        <span>
          <span className="text-xs text-muted">{FREE_LABELS.callee}</span> {view.callee ?? ACTION_UI.whole}
        </span>
        <span data-free-minutes={view.minutes}>
          <span className="text-xs text-muted">{FREE_LABELS.minutes}</span> <span className="font-bold">{view.minutes}</span>{" "}
          {ACTION_UI.minutes}
          {view.adds.length > 0 && <span className="ml-1 text-xs text-muted">{view.adds.join("・")}</span>}
        </span>
        {view.ai && <AiMark small />}
        {view.block && (
          <span className="inline-flex items-center gap-1 font-bold text-danger" data-free-block={view.block}>
            {FREE_LABELS.block} {view.block}
            {view.blockAi && <AiMark small />}
          </span>
        )}
      </p>
      {view.words && <p className="mt-0.5">{view.words}</p>}
      {view.reason && <p className="mt-0.5 text-xs text-muted">{view.reason}</p>}
    </div>
  );
}
