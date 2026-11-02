// 医療要約の「なぜこの行があるか」（画面の脇だけ。紙に出さない）。ケアマネ・主治医が見る物で、医療班の画面には出さない。
// 文は優先の骨格の段の根拠（lib/triage の TIERS の why）と、出典の登録簿（lib/sources）の題名だけ。新しい文は足さない。
// 出典は 作者が本文を確かめたら「確認済」、それまで「未確認」。

import { FORM_ORDER_BASIS, type BasisLine, type MedicalSummary } from "@/lib/forms/medical-summary";
import { TIER_LABELS } from "@/lib/labels";
import { checkMark, sourceById } from "@/lib/sources";
import { StateTag } from "@/components/person/parts";

function SourceItem({ id }: { id: string }) {
  const s = sourceById(id);
  const mark = checkMark(id);
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5" data-source={id}>
      <a href={s.url} target="_blank" rel="noreferrer" className="-mx-0.5 rounded px-0.5 text-accent underline underline-offset-2" data-press>
        {s.title}
      </a>
      <span className="text-muted">
        {s.publisher} {s.year}
      </span>
      <StateTag tone={mark === "確認済" ? "ok" : "check"}>{mark}</StateTag>
    </li>
  );
}

function Line({ line }: { line: Pick<BasisLine, "label" | "tier" | "why" | "sourceIds"> & { key?: string } }) {
  return (
    <li className="rounded bg-panel2 px-2 py-1.5" data-basis-line={line.key ?? "form"}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-bold">{line.label}</span>
        {line.tier != null && (
          <span className="text-xs text-muted">
            段 {line.tier} {TIER_LABELS[line.tier]}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-sm">{line.why}</p>
      <ul className="mt-0.5 space-y-0.5 text-xs">
        {line.sourceIds.map((id) => (
          <SourceItem key={id} id={id} />
        ))}
      </ul>
    </li>
  );
}

export function MedicalSummaryBasis({ sheet }: { sheet: MedicalSummary }) {
  return (
    <aside className="screen-only rounded-lg bg-panel px-3 py-2.5 text-sm" aria-labelledby="medical-basis-title" data-basis>
      <h2 id="medical-basis-title" className="font-bold">
        根拠
      </h2>
      <ul className="mt-1.5 space-y-1.5">
        <Line line={{ ...FORM_ORDER_BASIS, tier: null }} />
        {sheet.basis.map((b) => (
          <Line key={`${b.key}-${b.tier}`} line={b} />
        ))}
      </ul>
    </aside>
  );
}
