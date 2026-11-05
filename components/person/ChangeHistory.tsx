"use client";

// 本人のページの下の「変更履歴」（T143）。台帳を直した跡（入れる欄の保存・同意・台帳作成・事業所の操作・時計の確認など。
// lib/timeline/history.ts の isHistoryRow）を、経過（人が書き足す記録）から分けて畳んで置く。閉じた時は件数と最後の 1 行。
// 1 行は分かる文（「既往を手で入力」「AI が読んだアレルギー・時計を確かめて保存」「同意 5 つ（…）」）、誰が・いつは小さく右に。
// 前と後の値のある行（T143 から残した物）は行を押すと、欄ごとに「既往 高血圧 → 高血圧・心不全」。見る人の範囲の外の欄は
// サーバーが外してから渡す（lib/person.ts の diffVisible）。前と後の無い古い行は押せず、1 行の中の欄の名前だけ。
// 並びは新しい順（経過と同じ。lib/person.ts の timelineItems は古い順のまま）。

import { useState } from "react";
import type { TimelineItem } from "@/lib/person";
import { FOLD_LABELS } from "@/lib/timeline/labels";
import type { IntakeDiff } from "@/lib/db/types";
import { OpenIcon } from "@/components/ui/Icon";
import { Fold } from "./Fold";
import { AiMark } from "./parts";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 誰が・いつ（小さく右に） */
function WhoWhen({ item }: { item: TimelineItem }) {
  return (
    <span className="ml-auto shrink-0 text-xs text-muted">
      {item.who}{" "}
      <time dateTime={item.at} className="tabular-nums">
        {item.when}
      </time>
    </span>
  );
}

function Line({ item }: { item: TimelineItem }) {
  return (
    <>
      <span className="min-w-0">{item.history?.line ?? item.kind}</span>
      {item.ai && <AiMark />}
    </>
  );
}

/** 欄 1 つの前と後（「既往 高血圧 → 高血圧・心不全」）。前も後も無い欄（位置・経路地図）は「変更」 */
function DiffLine({ d }: { d: IntakeDiff }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-diff={d.key}>
      <span className="text-muted">{d.label}</span>
      {d.before === null && d.after === null ? (
        <span>{FOLD_LABELS.changed}</span>
      ) : (
        <>
          <span className="text-muted">{d.before ?? FOLD_LABELS.none}</span>
          <span aria-hidden className="text-muted">
            →
          </span>
          <span className="sr-only">から</span>
          <span className="font-bold">{d.after ?? FOLD_LABELS.none}</span>
        </>
      )}
    </li>
  );
}

function Row({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false);
  const diff = item.history?.diff ?? [];
  const id = `history-${item.id}`;
  if (diff.length === 0) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-2 rounded bg-panel2 px-2 py-1" data-history={item.id}>
        <Line item={item} />
        <WhoWhen item={item} />
      </li>
    );
  }
  return (
    <li className="rounded bg-panel2" data-history={item.id} data-diff-count={diff.length}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full flex-wrap items-baseline gap-x-2 rounded px-2 py-1 text-left ${FOCUS}`}
        data-press
      >
        <OpenIcon aria-hidden className={`size-3.5 shrink-0 self-center text-muted ${open ? "rotate-180" : ""}`} />
        <Line item={item} />
        <WhoWhen item={item} />
      </button>
      <ul id={id} hidden={!open} className="space-y-0.5 px-2 pb-1.5 pl-7 text-xs" data-diff-list>
        {diff.map((d) => (
          <DiffLine key={d.key} d={d} />
        ))}
      </ul>
    </li>
  );
}

export function ChangeHistory({ items, idBase, level }: { items: readonly TimelineItem[]; idBase: string; level: 1 | 2 }) {
  if (items.length === 0) return null;
  const newest = [...items].reverse();
  const H = level === 1 ? "h2" : "h3";
  const titleId = `${idBase}-history`;
  return (
    <section aria-labelledby={titleId} className="rounded-lg bg-panel px-3 py-2.5 text-sm" data-section="history">
      <Fold
        id={`${idBase}-history-list`}
        name="history"
        head={
          <H id={titleId} className="text-[1rem] leading-6 font-bold">
            {FOLD_LABELS.history}
          </H>
        }
        count={items.length}
        summary={
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-muted" data-fold-summary="history">
            <Line item={newest[0]} />
            <WhoWhen item={newest[0]} />
          </p>
        }
      >
        <ol className="space-y-1" data-order="newest">
          {newest.map((t) => (
            <Row key={t.id} item={t} />
          ))}
        </ol>
      </Fold>
    </section>
  );
}
