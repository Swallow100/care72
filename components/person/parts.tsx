// 本人のページの小さな部品。値の言葉・電話のリンク・状態の印・未確認の印。状態を持たない（Server Component のまま使える）。
// 色は意味にだけ使う（app/globals.css の --state-*）。色の印には必ず文字を添え、面全体は塗らない。

import type { Field, Line, Pending, Row, Seg, StateTone } from "@/lib/person";
import { BLANK_LABELS, CONSENT_STATUS_LABELS, PENDING_STATUS_LABELS } from "@/lib/labels";
import { Mark, StateTag, TONE_TEXT } from "@/components/ui/Tag";
import { Hint } from "./Hint";
import { TARGET_EDGE, TARGET_TEXT, TargetTag } from "./Target";
import { TargetLink } from "./TargetLink";

/** 見出しの段。単独のページは 1、担当一覧の右の面は 2 */
export type Level = 1 | 2;

// 状態の印と色の文字は components/ui/Tag（全画面で同じ部品）。ここからも使えるように出し直す
export { REASON_TEXT, StateTag, StateText, TONE_TEXT } from "@/components/ui/Tag";

export function SegText({ seg }: { seg: Seg }) {
  // 触れた時だけ出す添え（T143。時計の出典・確認日・未確認）。中の文字は添えの無い形で描く
  if (seg.hint) return <Hint hint={seg.hint}>{<SegText seg={{ ...seg, hint: undefined }} />}</Hint>;
  if (seg.tel) {
    return (
      <a href={`tel:${seg.tel}`} className="-mx-0.5 rounded px-0.5 text-accent tabular-nums underline underline-offset-2" data-press>
        {seg.text}
      </a>
    );
  }
  // 色の無い地の印（関係者の役割「家族」「緊急 1」。状態の 4 色を使わない。T113）
  if (seg.mark) return <Mark>{seg.text}</Mark>;
  if (seg.tone && seg.tone !== "muted") {
    return seg.tag ? (
      <StateTag tone={seg.tone}>{seg.text}</StateTag>
    ) : (
      <span className={`font-bold ${TONE_TEXT[seg.tone]}`} data-tone={seg.tone}>
        {seg.text}
      </span>
    );
  }
  // small は小さな字（心身の未入力の 1 行）
  const cls = [seg.small ? "text-xs" : "", seg.tone === "muted" ? "text-muted" : ""].filter(Boolean).join(" ");
  return <span className={cls || undefined}>{seg.text}</span>;
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

/**
 * 台帳の pending の印。黄の文字の「未確認」と理由（不明・未聴取・無回答）。数が多いので塗りの印にしない。
 * jump があれば押して飛べる（T169。その欄が紫になる）。target は今入れる欄で、前に紫の「要入力」
 */
export function PendingMark({ pending, target = false, jump }: { pending: readonly Pending[]; target?: boolean; jump?: string }) {
  const reasons = [...new Set(pending.map((p) => PENDING_STATUS_LABELS[p.status]))];
  const word = (
    <span className={`text-xs font-bold ${TONE_TEXT.check}`} data-tone="check">
      {BLANK_LABELS.unconfirmed}
    </span>
  );
  return (
    <span className="inline-flex items-baseline gap-2" data-pending={pending.length}>
      {target && <TargetTag />}
      {jump ? <TargetLink focus={jump}>{word}</TargetLink> : word}
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

export function FieldValue({
  field,
  pending,
  blank,
  apart = false,
  target = false,
  jump,
}: {
  field: Field;
  pending: readonly Pending[];
  blank?: string;
  apart?: boolean;
  target?: boolean;
  jump?: string;
}) {
  const mark = pending.length > 0 ? <PendingMark pending={pending} target={target} jump={jump} /> : null;
  switch (field.kind) {
    case "lines":
      return (
        // apart は 1 行が 1 人の一覧（関係者の連絡先）。折り返した 1 人の行より、人と人の間を広く空ける
        <div className={apart ? "space-y-1.5" : "space-y-0.5"}>
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
    <div
      className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2${row.target ? ` ${TARGET_EDGE}` : ""}`}
      data-field={row.key}
      data-target={row.target ? "" : undefined}
    >
      <dt className={`pt-px text-xs ${row.target ? TARGET_TEXT : "text-muted"}`}>{row.label}</dt>
      <dd className={`min-w-0 ${row.small ? "text-xs" : ""}`}>
        {/* 同意の行の空は状態の「未確認」（同意・不同意・未確認。lib/labels.ts の CONSENT_STATUS_LABELS）。ほかの空は「未入力」 */}
        <FieldValue
          field={row.field}
          pending={row.pending}
          blank={row.key.startsWith("consent.") ? CONSENT_STATUS_LABELS.unconfirmed : undefined}
          apart={row.apart === true}
          target={row.target === true}
          jump={row.jump}
        />
      </dd>
    </div>
  );
}
