"use client";

// 訓練の対応の欄（docs/tasks/T20.md・T91.md）: 対象の本人を選び、手の表の 18 の手から 1 つ、要れば相手（台帳の連絡先）を選んで実行。
// 手は区分（連絡・訪問・手配・報告・記録）の段で並べる（lib/drill/action-catalog.ts の並び）。10 分版も同じ部品で同じ段。
// 相手の連絡先の要る手で台帳に相手が無ければ押せない（灰）。固定の相手のある手（訪問依頼 → 事業所、移送・電源 → 市役所）は選ばなければ固定の相手。
// 自由対応は文の欄（120 字、残りの字数）。相手は任意。監督役（Opus）が表の手に読み替える（10〜13 秒）。文はサーバーの中だけ。
// 実行は 1 要求で手 1 つ（POST /api/drill/<id>/action）。手の所要時間だけ時計が進み、次の刻みを越えたらその刻みも進む。
// 終わったら画面を読み直す（router.refresh）。結果と履歴はサーバーが描く（ActionLog）。断られたら理由を 1 行。
// 選んだ印は枠（ring）と太字。テーマ色の下地は敷かない。押したときは灰色だけ（data-press）。主の操作（実行）だけ操作の色。
// この画面で正解・不正解を出さない（採点は T22）。
// メモ（T59）: 100 字まで、任意。手と一緒に送り、履歴と訓練記録に出す（Claude には渡さない）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PlayIcon } from "@/components/ui/Icon";
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
import { ACTION_MINUTES, needsPerson, needsTarget, picksTarget, targetKinds } from "@/lib/drill/action-table";
import { ACTION_LABELS, ACTION_UI, CALL_STATUS_LABELS, DRILL_LABELS, T59_LABELS } from "@/lib/drill/labels";
import type { DrillContact } from "@/lib/drill/view";
import type { FictionKind } from "@/lib/drill/fiction";
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
/** 自由対応の文の欄（メモの欄と同じ面の中の色。2 行） */
const FREE_FIELD =
  "block min-h-14 w-full min-w-0 resize-y rounded bg-panel2 px-2 py-1.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
/** メモの長さの上限（lib/drill/db.ts の MEMO_MAX と同じ） */
const MEMO_MAX = 100;

export function ActionPanel({
  drillId,
  step,
  actions,
  people,
  contacts,
  fiction,
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
}) {
  const router = useRouter();
  const [person, setPerson] = useState<string | null>(null);
  const [kind, setKind] = useState<DrillAction | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const own = person ? (contacts[person] ?? []) : [];
  const choices = (k: DrillAction) => own.filter((c) => targetKinds(k).includes(c.kind));
  const usable = (k: DrillAction) => {
    if (needsPerson(k) && !person) return false;
    if (needsTarget(k) && choices(k).length === 0) return false;
    return true;
  };
  const fixedOf = (k: DrillAction) => actionRow(k).fixed;
  const isFree = kind === "free";
  const freeLength = [...text.trim()].length;
  const ready =
    kind !== null &&
    usable(kind) &&
    (!needsTarget(kind) || (target !== null && target !== FIXED)) &&
    (!isFree || (freeLength > 0 && freeLength <= FREE_TEXT_MAX));
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
              {actionsOfGroup(g).map(({ id: k }) => (
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
                  {ACTION_MINUTES[k] > 0 && (
                    <span className="text-xs font-normal text-muted tabular-nums">
                      {ACTION_MINUTES[k]} {ACTION_UI.minutes}
                    </span>
                  )}
                </Button>
              ))}
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
                className={`${TOGGLE} ${target === FIXED ? PICKED : ""}`}
                data-act-target={fixedOf(kind)!}
              >
                {FIXED_CALLEE_LABELS[fixedOf(kind)!]}
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
            rows={2}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            className={FREE_FIELD}
            data-act-free-input
          />
        </label>
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
        <Button kind="main" icon={PlayIcon} onClick={() => void run()} disabled={!ready || busy} data-action="act">
          {ACTION_UI.execute}
        </Button>
        {busy && isFree && <Loader72 label={FREE_LABELS.reading} size={18} className="text-sm text-muted" />}
        {kind && !(busy && isFree) && (
          <span className="text-sm" data-act-summary>
            <span className="font-bold">{ACTION_LABELS[kind]}</span>
            {kind !== "evacuate_self" && name ? ` ${name}` : ""}
            {targetLabel ? ` ${targetLabel}` : ""}
            {ACTION_MINUTES[kind] > 0 && (
              <span className="ml-1.5 text-xs text-muted tabular-nums">
                {ACTION_MINUTES[kind]} {ACTION_UI.minutes}
              </span>
            )}
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
