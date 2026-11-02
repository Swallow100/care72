// 医療班提供の同意が無い人の医療要約の画面。要約の中身は作らず、紙面も出さない（印刷もしない）。
// 不同意は「同意なし」、まだ聞いていない・分からないは「未確認」（台帳の pending の理由を添える）。

import type { MedicalConsent } from "@/lib/forms/medical-summary";
import { formatJst } from "@/lib/person";
import { CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS, PENDING_STATUS_LABELS } from "@/lib/labels";
import { StateTag } from "@/components/person/parts";

/** 画面の言葉: 不同意 → 同意なし、未確認 → 未確認 */
export const WITHHELD_LABELS = { refused: "同意なし", unconfirmed: "未確認" } as const;

export function MedicalWithheld({ kind, consent }: { kind: "refused" | "unconfirmed"; consent: MedicalConsent }) {
  const at = consent.recordedAt ? formatJst(consent.recordedAt).slice(0, 10) : null;
  return (
    <section className="mx-auto max-w-xl rounded-lg bg-panel px-4 py-3" data-withheld={kind}>
      <div className="flex flex-wrap items-baseline gap-2">
        <StateTag tone="check" size="md">
          {WITHHELD_LABELS[kind]}
        </StateTag>
        <span className="font-bold">
          {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS[consent.status]}
        </span>
        {consent.reason && <span className="text-sm">（{PENDING_STATUS_LABELS[consent.reason]}）</span>}
      </div>
      <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
        <dt className="text-xs text-muted">記録</dt>
        <dd className="tabular-nums">
          {at ?? CONSENT_STATUS_LABELS.unconfirmed}
          {consent.recordedBy && ` ${consent.recordedBy}`}
        </dd>
        {consent.note && (
          <>
            <dt className="text-xs text-muted">備考</dt>
            <dd>{consent.note}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
