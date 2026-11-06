// 本人のページの「スマホ」の面（docs/tasks/T149.md）。同意の面のすぐ後に置く（components/person/PersonView.tsx の phone）。
// スマホ入口は書類（紙）でなく本人と家族がスマホで使う入口なので、書類の行から移した。形は lib/phone/summary.ts、ここは描くだけ。
// - 1 行目: 入口の状態（未発行・有効・期限切れ、一覧外）と期限、詳しい画面（リンクと QR・発行）への「表示」
// - 同意の決まり（lib/phone/consent.ts）に合わない人は「同意なし」（発行へ進めない。押せる物を出さない）
// - 本人用・家族用の行ごとに ID の有無と通知の端末の数（本人・家族が自分で作る・許可する物。ケアマネは見るだけ）
// 区切りは地の色。色は状態の印だけ（有効は無事の色でなく本文色。期限切れ・同意なしは要確認の黄の塗り）。

import { ButtonLink } from "@/components/ui/Button";
import { SmartphoneIcon } from "@/components/ui/Icon";
import { Mark, StateTag } from "@/components/ui/Tag";
import { formatJst } from "@/lib/person";
import { PHONE_SECTION_LABELS as L } from "@/lib/phone/labels";
import type { PhoneSummary, PhoneSummaryRow } from "@/lib/phone/summary";
import { PHONE_LINK_LABELS, PHONE_LINK_STATUS_LABELS } from "@/lib/qr/phone-labels";

const LABEL_COL = "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2";

function TargetLine({ row }: { row: PhoneSummaryRow }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-phone-row={row.key}>
      {row.kind === "family" && (
        <span>
          {row.relation && <span className="mr-1 text-xs text-muted">{row.relation}</span>}
          {row.name}
        </span>
      )}
      <span className={row.account ? "font-bold" : "text-muted"} data-phone-account={row.account ? "1" : "0"}>
        {L.account} {row.account ? L.has : L.none}
      </span>
      <span className={row.notify > 0 ? "font-bold" : "text-muted"} data-phone-notify={row.notify}>
        {L.notify} {row.notify > 0 ? row.notify : L.none}
      </span>
    </span>
  );
}

export function PhoneSection({ summary, level }: { summary: PhoneSummary; level: 1 | 2 }) {
  const H = level === 1 ? "h2" : "h3";
  const titleId = `person-${summary.personId}-phone`;
  const family = summary.rows.filter((r) => r.kind === "family");
  const self = summary.rows.find((r) => r.kind === "self");
  const canOpen = summary.allowed || summary.status !== "none";
  return (
    <section
      aria-labelledby={titleId}
      className="mb-2 break-inside-avoid rounded-lg bg-panel px-3 py-2.5 text-sm"
      data-section="phone"
      data-phone-allowed={summary.allowed ? "1" : "0"}
    >
      <div className="flex items-baseline gap-2">
        <H id={titleId} className="text-[1rem] leading-6 font-bold">
          {L.title}
        </H>
      </div>
      <dl className="mt-1.5 space-y-1">
        <div className={`${LABEL_COL} items-center`}>
          <dt className="text-xs text-muted">{L.entry}</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {summary.allowed ? (
              <Mark tone={summary.status === "expired" ? "check" : null}>{PHONE_LINK_STATUS_LABELS[summary.status]}</Mark>
            ) : (
              <StateTag tone="check">{L.noConsent}</StateTag>
            )}
            {summary.unlisted && <StateTag tone="check">{PHONE_LINK_LABELS.unlisted}</StateTag>}
            {summary.expiresAt && (
              <span className="text-xs tabular-nums">
                {L.expires} {formatJst(summary.expiresAt).slice(0, 10)}
              </span>
            )}
            {/* 読み上げの名前は「スマホ入口 表示」（T162。書類の行の「表示」と同じ名前で、計画書のつもりで押された） */}
            {canOpen && (
              <ButtonLink href={summary.href} kind="plain" size="sm" icon={SmartphoneIcon} aria-label={`${L.title}${L.entry} ${L.open}`} data-phone-open>
                {L.open}
              </ButtonLink>
            )}
          </dd>
        </div>
        {self && (
          <div className={LABEL_COL}>
            <dt className="text-xs text-muted">{L.self}</dt>
            <dd>
              <TargetLine row={self} />
            </dd>
          </div>
        )}
        {family.length > 0 && (
          <div className={LABEL_COL}>
            <dt className="text-xs text-muted">{L.family}</dt>
            <dd>
              <ul className="space-y-0.5">
                {family.map((r) => (
                  <li key={r.key}>
                    <TargetLine row={r} />
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
