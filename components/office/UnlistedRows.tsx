// 一覧から外した人の行（docs/tasks/T30.md）。名前（本人のページへ）・カナ・外した日・「戻す」。畳み（UnlistedFold）の中に置く。
// 戻すはフォームの POST（/office/people、action=relist）で、もとの画面へ 303 で戻る。押してから戻るまで灰色を残す。

import Link from "next/link";
import { LinkPending } from "@/components/ui/LinkPending";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { OFFICE_PEOPLE_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";
import type { PeopleBack } from "@/lib/office/http";
import { shortJst } from "@/lib/disaster/state";

export type UnlistedItem = { id: string; name: string; kana: string; unlistedAt: string; href: string };

/** inPanel: 面（白）の中に置くときは行を面の中の灰色に、ボタンを白に */
export function UnlistedRows({ rows, back, inPanel = false }: { rows: readonly UnlistedItem[]; back: PeopleBack; inPanel?: boolean }) {
  return (
    <ul className="grid gap-px text-sm">
      {rows.map((r) => (
        <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded py-1 pr-1 pl-3 ${inPanel ? "bg-panel2" : "bg-panel"}`}>
          <Link href={r.href} className="relative -mx-1 rounded px-1 font-bold" data-press>
            {r.name}
            <LinkPending />
          </Link>
          <span className="text-muted">{r.kana}</span>
          <span className="text-xs text-muted">
            {OFFICE_LABELS.unlistedAt} {shortJst(r.unlistedAt)}
          </span>
          <form method="post" action={OFFICE_PEOPLE_PATH} className="ml-auto">
            <input type="hidden" name="action" value="relist" />
            <input type="hidden" name="person" value={r.id} />
            <input type="hidden" name="back" value={back} />
            <SubmitButton kind={inPanel ? "plainIn" : "plain"} size="sm">
              {OFFICE_LABELS.relist}
            </SubmitButton>
          </form>
        </li>
      ))}
    </ul>
  );
}
