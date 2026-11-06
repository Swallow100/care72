// 薬の 1 行ずつ（T150b）。本人のページの上の段の「医療」と、担当一覧・訓練の行の詳細の「薬」で同じ部品。中身は lib/person.ts の medLines。
// 1 行: 区分の印（医療の印の区分は担当一覧の列と同じ印と色、ほかは区分の言葉を小さく）・名前・量（台帳にあれば）・中断注意・残り（右寄せ、
// 平時は手元の量、災害モードは今の残り。時計の色）。多い時は 3 つまでと「他 N 件」。面の中（panel2）の上に置く。

import { Mark, StateTag } from "@/components/ui/Tag";
import { MED_LINE_LABELS, MEDICATION_FLAG_LABELS } from "@/lib/labels";
import type { MedLine } from "@/lib/person";
import { TONE_TEXT } from "./parts";

export function MedLines({ lines, more }: { lines: readonly MedLine[]; more: number }) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-0.5" data-med-lines>
      {lines.map((m) => (
        <li key={m.name} className="flex flex-wrap items-baseline gap-x-1.5" data-med-line={m.name}>
          {m.mark ? (
            <Mark inPanel2 tone={m.mark.tone}>
              {m.mark.label}
            </Mark>
          ) : (
            m.category && <span className="text-xs text-muted">{m.category}</span>
          )}
          <span className="text-sm font-bold">{m.name}</span>
          {m.amount && <span className="text-sm">{m.amount}</span>}
          {m.interruption && <StateTag tone="check">{MEDICATION_FLAG_LABELS.interruptionRisk}</StateTag>}
          {m.left && (
            <span className="ml-auto whitespace-nowrap">
              {m.left.label && <span className="mr-1.5 text-xs text-muted">{m.left.label}</span>}
              <span className={`font-bold tabular-nums ${m.left.tone ? TONE_TEXT[m.left.tone] : ""}`} data-tone={m.left.tone ?? undefined}>
                {m.left.text}
              </span>
            </span>
          )}
        </li>
      ))}
      {more > 0 && (
        <li className="text-xs text-muted" data-med-more={more}>
          {MED_LINE_LABELS.more} <span className="tabular-nums">{more}</span> {MED_LINE_LABELS.unit}
        </li>
      )}
    </ul>
  );
}
