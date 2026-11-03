// 仮想モード（docs/tasks/T50.md）の「結末」の印と 1 文。担当一覧と同じ表の氏名の下に出す。
// 結末はコード（lib/drill/outcome.ts）が時計の計算で決め、文は世界の部屋の 1 文（AI の印）か固定の文（印なし）。
// ルールの表の色・順位は変えない（印は色を使わず、面の地の色と文字だけ）。

import { AiMark } from "@/components/person/parts";
import { VIRTUAL_LABELS } from "@/lib/drill/labels";

export function EndedNote({ text, ai }: { text: string; ai: boolean }) {
  return (
    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-xs" data-ended>
      <span className="rounded bg-base px-1 font-bold text-ink">{VIRTUAL_LABELS.ended}</span>
      {ai && <AiMark small />}
      <span>{text}</span>
    </div>
  );
}
