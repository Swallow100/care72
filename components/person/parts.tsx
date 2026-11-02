// 本人のページの小さな部品。値の言葉・電話のリンク・状態の印・未確認の印。状態を持たない（Server Component のまま使える）。
// 色は意味にだけ使う（app/globals.css の --state-*）。色の印には必ず文字を添え、面全体は塗らない。

import type { Field, Line, Pending, Row, Seg, StateTone } from "@/lib/person";
import { BLANK_LABELS, PENDING_STATUS_LABELS } from "@/lib/labels";

/** 見出しの段。単独のページは 1、担当一覧の右の面は 2 */
export type Level = 1 | 2;

/** 状態の文字の色 */
export const TONE_TEXT: Record<StateTone, string> = {
  ok: "text-state-ok",
  urgent: "text-state-urgent",
  check: "text-state-check",
  unknown: "text-state-unknown",
};

/** 状態の印（薄い下地と文字の色） */
const TONE_TAG: Record<StateTone, string> = {
  ok: "bg-state-ok-soft text-state-ok",
  urgent: "bg-state-urgent-soft text-state-urgent",
  check: "bg-state-check-soft text-state-check",
  unknown: "bg-state-unknown-soft text-state-unknown",
};

/** 色の付いた印。文字（至急・未確認・同意など）を必ず持つ */
export function StateTag({ tone, size = "sm", children }: { tone: StateTone; size?: "sm" | "md"; children: React.ReactNode }) {
  const box = size === "md" ? "px-1.5 py-0.5 text-sm" : "px-1 py-px text-xs";
  return (
    <span className={`rounded font-bold ${box} ${TONE_TAG[tone]}`} data-tone={tone}>
      {children}
    </span>
  );
}

export function SegText({ seg }: { seg: Seg }) {
  if (seg.tel) {
    return (
      <a href={`tel:${seg.tel}`} className="-mx-0.5 rounded px-0.5 text-accent tabular-nums underline underline-offset-2" data-press>
        {seg.text}
      </a>
    );
  }
  if (seg.tone && seg.tone !== "muted") {
    return seg.tag ? (
      <StateTag tone={seg.tone}>{seg.text}</StateTag>
    ) : (
      <span className={`font-bold ${TONE_TEXT[seg.tone]}`} data-tone={seg.tone}>
        {seg.text}
      </span>
    );
  }
  return <span className={seg.tone === "muted" ? "text-muted" : undefined}>{seg.text}</span>;
}

export function LineText({ line }: { line: Line }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      {line.map((seg, i) => (
        <SegText key={i} seg={seg} />
      ))}
    </div>
  );
}

/** 台帳の pending の印。黄の「未確認」と理由（不明・未聴取・無回答） */
export function PendingMark({ pending }: { pending: readonly Pending[] }) {
  const reasons = [...new Set(pending.map((p) => PENDING_STATUS_LABELS[p.status]))];
  return (
    <span className="inline-flex items-baseline gap-2" data-pending={pending.length}>
      <StateTag tone="check">{BLANK_LABELS.unconfirmed}</StateTag>
      <span className="text-xs text-muted">{reasons.join("・")}</span>
    </span>
  );
}

/** 空の欄（pending に無い物）。数えない */
export function Blank() {
  return <span className="text-muted">{BLANK_LABELS.unconfirmed}</span>;
}

export function FieldValue({ field, pending }: { field: Field; pending: readonly Pending[] }) {
  const mark = pending.length > 0 ? <PendingMark pending={pending} /> : null;
  switch (field.kind) {
    case "lines":
      return (
        <div className="space-y-0.5">
          {field.lines.map((line, i) => (
            <LineText key={i} line={line} />
          ))}
          {mark}
        </div>
      );
    case "none":
      return (
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className={field.tone ? `font-bold ${TONE_TEXT[field.tone]}` : undefined}>{BLANK_LABELS.none}</span>
          {mark}
        </div>
      );
    case "unconfirmed":
      return mark ?? <Blank />;
  }
}

/** 欄の 1 行（ラベルと値）。dl の中に置く。細かい欄（row.small）は小さな字 */
export function RowItem({ row }: { row: Row }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2" data-field={row.key}>
      <dt className="pt-px text-xs text-muted">{row.label}</dt>
      <dd className={`min-w-0 ${row.small ? "text-xs" : ""}`}>
        <FieldValue field={row.field} pending={row.pending} />
      </dd>
    </div>
  );
}
