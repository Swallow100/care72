// 本人のページの経過（時系列。誰が・いつ・何を）。書き足す欄は T24。

import type { TimelineItem } from "@/lib/person";
import { BLANK_LABELS } from "@/lib/labels";
import { StateTag } from "./parts";

export function Timeline({ items }: { items: readonly TimelineItem[] }) {
  if (items.length === 0) return <p className="text-muted">{BLANK_LABELS.none}</p>;
  return (
    <ol className="space-y-1">
      {items.map((t) => (
        <li
          key={t.id}
          className="grid grid-cols-[8.5rem_5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md bg-panel2 px-3 py-2 sm:grid-cols-[8.5rem_5rem_minmax(0,1fr)_auto]"
        >
          <time dateTime={t.at} className="text-sm text-muted tabular-nums">
            {t.when}
          </time>
          <span>{t.tone ? <StateTag tone={t.tone}>{t.kind}</StateTag> : <span className="font-bold">{t.kind}</span>}</span>
          <span className="min-w-0">{t.body}</span>
          <span className="col-start-3 text-sm text-muted sm:col-start-auto">{t.who}</span>
        </li>
      ))}
    </ol>
  );
}
