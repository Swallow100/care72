// 本人のページの小さな部品。値の言葉・電話のリンク・状態の印・未確認の印。状態を持たない（Server Component のまま使える）。
// 色は意味にだけ使う（app/globals.css の --state-*）。色の印には必ず文字を添え、面全体は塗らない。

import type { Field, Line, Pending, Row, Seg, StateTone } from "@/lib/person";
import { BLANK_LABELS, CONSENT_STATUS_LABELS, PENDING_STATUS_LABELS } from "@/lib/labels";
import { StateTag, TONE_TEXT } from "@/components/ui/Tag";

/** 見出しの段。単独のページは 1、担当一覧の右の面は 2 */
export type Level = 1 | 2;

// 状態の印と色の文字は components/ui/Tag（全画面で同じ部品）。ここからも使えるように出し直す
export { StateTag, StateText, TONE_TEXT } from "@/components/ui/Tag";

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

/** 台帳の pending の印。黄の文字の「未確認」と理由（不明・未聴取・無回答）。数が多いので塗りの印にしない */
export function PendingMark({ pending }: { pending: readonly Pending[] }) {
  const reasons = [...new Set(pending.map((p) => PENDING_STATUS_LABELS[p.status]))];
  return (
    <span className="inline-flex items-baseline gap-2" data-pending={pending.length}>
      <span className={`text-xs font-bold ${TONE_TEXT.check}`} data-tone="check">
        {BLANK_LABELS.unconfirmed}
      </span>
      <span className="text-xs text-muted">{reasons.join("・")}</span>
    </span>
  );
}

/**
 * Claude の出力の印「AI」。人が確かめて直せる所に付ける（CLAUDE.md「守ること」）。
 * 状態の 4 色は使わず、地の灰色と太字だけ（色は意味にだけ使う）
 */
export function AiMark({ title = "AI の出力。人が確認", small = false }: { title?: string; small?: boolean }) {
  // small は項目の行の印（見出しの印に読み上げを任せ、行ごとには読み上げない）
  return (
    <span
      className={`rounded bg-base font-bold text-ink ${small ? "px-0.5 text-[10px] leading-tight" : "px-1 py-px text-xs"}`}
      data-ai={small ? "item" : ""}
      title={title}
      aria-hidden={small || undefined}
    >
      AI
    </span>
  );
}

/** 空の欄（pending に無い物）。数えないので「未入力」。同意・時計の値のように状態としての未確認は label で「未確認」を渡す */
export function Blank({ label = BLANK_LABELS.blank }: { label?: string }) {
  return <span className="text-muted">{label}</span>;
}

export function FieldValue({ field, pending, blank }: { field: Field; pending: readonly Pending[]; blank?: string }) {
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
      return mark ?? <Blank label={blank} />;
  }
}

/** 欄の 1 行（ラベルと値）。dl の中に置く。細かい欄（row.small）は小さな字 */
export function RowItem({ row }: { row: Row }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2" data-field={row.key}>
      <dt className="pt-px text-xs text-muted">{row.label}</dt>
      <dd className={`min-w-0 ${row.small ? "text-xs" : ""}`}>
        {/* 同意の行の空は状態の「未確認」（同意・不同意・未確認。lib/labels.ts の CONSENT_STATUS_LABELS）。ほかの空は「未入力」 */}
        <FieldValue field={row.field} pending={row.pending} blank={row.key.startsWith("consent.") ? CONSENT_STATUS_LABELS.unconfirmed : undefined} />
      </dd>
    </div>
  );
}
