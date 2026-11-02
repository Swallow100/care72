// 本人のページの経過（時系列。誰が・いつ・何を）。全部出す。書き足す欄は T24。
// 1 行目に小さく 時刻・種類・誰が、2 行目に何を。区分が細い段に入っても読める形。

import type { TimelineItem } from "@/lib/person";
import { BLANK_LABELS } from "@/lib/labels";
import { AiMark, StateTag } from "./parts";

export function Timeline({ items }: { items: readonly TimelineItem[] }) {
  if (items.length === 0) return <p className="text-muted">{BLANK_LABELS.none}</p>;
  return (
    <ol className="space-y-1">
      {items.map((t) => (
        <li key={t.id} className="rounded bg-panel2 px-2 py-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <time dateTime={t.at} className="text-muted tabular-nums">
              {t.when}
            </time>
            {t.tone ? <StateTag tone={t.tone}>{t.kind}</StateTag> : <span className="font-bold">{t.kind}</span>}
            {t.ai && <AiMark />}
            <span className="ml-auto text-muted">{t.who}</span>
          </div>
          {t.body && <div className="mt-0.5">{t.body}</div>}
        </li>
      ))}
    </ol>
  );
}
