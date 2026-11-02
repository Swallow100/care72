// 一覧から外した人の行（docs/tasks/T30.md）。名前（本人のページへ）・カナ・外した日・「戻す」。畳み（UnlistedFold）の中に置く。
// 戻すはフォームの POST（/office/people、action=relist）で、もとの画面へ 303 で戻る。

import Link from "next/link";
import { OFFICE_PEOPLE_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";
import type { PeopleBack } from "@/lib/office/http";
import { shortJst } from "@/lib/disaster/state";

export type UnlistedItem = { id: string; name: string; kana: string; unlistedAt: string; href: string };

export function UnlistedRows({ rows, back }: { rows: readonly UnlistedItem[]; back: PeopleBack }) {
  return (
    <ul className="space-y-0.5 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-panel px-3 py-1.5">
          <Link href={r.href} className="-mx-1 rounded px-1 font-bold" data-press>
            {r.name}
          </Link>
          <span className="text-muted">{r.kana}</span>
          <span className="text-xs text-muted tabular-nums">
            {OFFICE_LABELS.unlistedAt} {shortJst(r.unlistedAt)}
          </span>
          <form method="post" action={OFFICE_PEOPLE_PATH} className="ml-auto">
            <input type="hidden" name="action" value="relist" />
            <input type="hidden" name="person" value={r.id} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="rounded-md bg-panel2 px-3 py-1 text-sm font-bold" data-press>
              {OFFICE_LABELS.relist}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
