import Link from "next/link";
import { StateTag } from "@/components/ui/Tag";
import { LinkPending } from "@/components/ui/LinkPending";
import type { DisasterMark } from "@/lib/disaster/state";
import { OFFICE_PATH } from "@/lib/disaster/http";
import { JMA_ANCHOR, JMA_LABELS } from "@/lib/jma/labels";

// ヘッダーの事業所の状態。平時は地も枠も無い「状態 平時」の文字で、押せない（T187。前の灰色の地の小さな枠は押せるボタンに見えた。
// T79 の前の薄い文字のリンクはメニューの項目に見えたので、小さな見出し「状態」を添えて値の表示と分かる形に）。
// 災害モードは要確認の黄の塗りの印「大雨」と、本文色の太字「レベル 4」「停電 3 時間」（黄は文字に使わない。印のすぐ横なので帯も付けない）。
// 至急の赤は使わず、帯で塗らない（本物の警報と見間違えさせない）。災害モードは押すと事業所の画面（押せる高さ 32px）
// 地域の警報（T148）: 事業所の地域の市と利用者の市に今出ている気象庁の警報の数を、本文色の太字「警報 2」で添える（種類の名前は title）。
// 気象庁の欄（事業所の画面）と同じ数え方（lib/jma/alerts.ts の loadRegionWarnings）。表示だけで、災害モードを切り替えない・色を付けない。
// 平時でも警報があれば、その「警報 2」だけ押せる（事業所の画面の気象庁の欄へ）。注意報は数えない
export type BadgeWarnings = { count: number; kinds: readonly string[] };

/** 平時の状態の表示の小さな見出し */
export const STATE_LABEL = "状態";

export function DisasterBadge({ mark, link, warnings = null }: { mark: DisasterMark; link: boolean; warnings?: BadgeWarnings | null }) {
  const warn = warnings && warnings.count > 0 ? warnings : null;
  if (mark.kind === "normal") {
    return (
      <span aria-label="事業所の状態" className="inline-flex items-center gap-x-1.5 text-sm" data-disaster-mark="normal">
        <span className="text-xs text-muted">{STATE_LABEL}</span>
        <span className="whitespace-nowrap">{mark.label}</span>
        {warn && (link ? <WarningLink warnings={warn} /> : <WarningText warnings={warn} />)}
      </span>
    );
  }
  const body = (
    <span className="flex flex-wrap items-center gap-x-1.5 whitespace-nowrap">
      <StateTag tone="check" size="md">
        {mark.label}
      </StateTag>
      {mark.details.map((d) => (
        <span key={d} className="font-bold tabular-nums">
          {d}
        </span>
      ))}
      {warn && <WarningText warnings={warn} />}
    </span>
  );
  if (!link) return <span aria-label="事業所の状態">{body}</span>;
  return (
    <Link
      href={OFFICE_PATH}
      aria-label="事業所の状態"
      className="relative -mx-1 inline-flex min-h-8 items-center rounded px-1 text-sm"
      data-press
    >
      {body}
      <LinkPending />
    </Link>
  );
}

/** 「警報 2」（本文色の太字。種類の名前は title と読み上げ） */
function WarningText({ warnings }: { warnings: BadgeWarnings }) {
  return (
    <span className="font-bold whitespace-nowrap text-ink tabular-nums" title={warnings.kinds.join("・")} data-region-warnings={warnings.count}>
      {JMA_LABELS.warning} {warnings.count}
      <span className="sr-only">（{warnings.kinds.join("・")}）</span>
    </span>
  );
}

/** 平時の「警報 2」は押すと事業所の画面の気象庁の欄へ（押せる高さ 32px） */
function WarningLink({ warnings }: { warnings: BadgeWarnings }) {
  return (
    <Link
      href={`${OFFICE_PATH}#${JMA_ANCHOR}`}
      className="relative -mx-1 inline-flex min-h-8 items-center rounded px-1 text-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
      data-press
    >
      <WarningText warnings={warnings} />
      <LinkPending />
    </Link>
  );
}
