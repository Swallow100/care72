import Link from "next/link";
import { StateTag, TONE_TEXT } from "@/components/ui/Tag";
import { LinkPending } from "@/components/ui/LinkPending";
import type { DisasterMark } from "@/lib/disaster/state";
import { OFFICE_PATH } from "@/lib/disaster/http";

// ヘッダーの事業所の状態。平時は薄い文字「平時」。災害モードは要確認の色の印「大雨」と「レベル 4」「停電 3 時間」。
// 至急の赤は使わず、帯で塗らない（本物の警報と見間違えさせない）。押すと事業所の画面（押せる高さ 32px）
export function DisasterBadge({ mark, link }: { mark: DisasterMark; link: boolean }) {
  const body =
    mark.kind === "normal" ? (
      <span className="text-muted">{mark.label}</span>
    ) : (
      <span className="flex flex-wrap items-center gap-x-1.5 whitespace-nowrap">
        <StateTag tone="check" size="md">
          {mark.label}
        </StateTag>
        {mark.details.map((d) => (
          <span key={d} className={`font-bold tabular-nums ${TONE_TEXT.check}`}>
            {d}
          </span>
        ))}
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
