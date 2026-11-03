"use client";

// 担当一覧の絞込の帯（docs/tasks/T58.md）。色（発災時だけ）・地区（台帳の町名）・医療の印・氏名とカナの検索、解除。
// 並び（sort）と同じく URL の query だけで持つ。form は GET で、sort・dir・open を hidden で持ち越す（無いと絞った瞬間に
// 右の本人のページが閉じ、並びが既定に戻る）。スクリプトが動けば選んだ瞬間に移り、URL は空の値を書かない形（lib/list/query）。
// 絞っても優先の番号は絞る前の番号のまま（ここでは何も数え直さない）。
// 見出し（状態・地区・医療。押せない言葉）と、押せる物（状態の切替のボタン、地区・医療の選ぶ欄の箱）の見た目を分ける（T66）。
// 状態は選ぶ欄でなく受入一覧と同じ切替（components/list/StateFilter）。人数は上の人数と同じく絞る前の数

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ButtonLink, Button } from "@/components/ui/Button";
import { CloseIcon, SearchIcon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { StateFilter } from "./StateFilter";
import type { ClockCategory } from "@/lib/db/types";
import { FILTER_LABELS } from "@/lib/list/labels";
import {
  caseloadHref,
  defaultDir,
  filterActive,
  MAX_FILTER_TEXT,
  parseFilter,
  type CaseloadFilter,
  type SortDir,
  type SortKey,
} from "@/lib/list/query";
import type { Color } from "@/lib/triage/index";

const FIELD =
  "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function FilterBar({
  filter,
  areas,
  marks,
  disaster,
  colorCounts,
  sort,
  dir,
  open,
  actions,
}: {
  filter: CaseloadFilter;
  /** 地区の候補（絞る前の行の町名） */
  areas: string[];
  /** 医療の印の候補（絞る前の行にある区分） */
  marks: Array<[ClockCategory, string]>;
  /** 発災時か（色で絞れるのは発災時だけ） */
  disaster: boolean;
  /** 状態ごとの人数（絞る前。発災時の切替に添える。無ければ 0） */
  colorCounts?: Record<Color, number>;
  sort: SortKey;
  dir: SortDir;
  /** 右に開いている本人 */
  open: string | null;
  /** 帯の右端の操作（担当一覧の書き出しの 2 つ、T62）。絞ったあとに押す流れ。375 は折り返して次の行の右に */
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filter.q);

  const go = (next: CaseloadFilter) => router.push(caseloadHref({ sort, dir, filter: next, open }));
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    go(parseFilter({ ...filter, q }));
  };

  return (
    <form action="/" method="get" role="search" aria-label={FILTER_LABELS.title} onSubmit={onSubmit} className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-filter-bar>
      {sort !== "tier" && <input type="hidden" name="sort" value={sort} />}
      {dir !== defaultDir(sort) && <input type="hidden" name="dir" value={dir} />}
      {open && <input type="hidden" name="open" value={open} />}
      <span className="text-sm font-bold">{FILTER_LABELS.title}</span>
      {disaster && (
        <StateFilter
          label={FILTER_LABELS.color}
          allLabel={FILTER_LABELS.all}
          current={filter.color}
          counts={colorCounts ?? { red: 0, yellow: 0, gray: 0, green: 0 }}
          onPick={(color) => go({ ...filter, q, color })}
          name="color"
          labelClass="text-xs"
        />
      )}
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-muted">{FILTER_LABELS.area}</span>
        <Select
          name="area"
          value={filter.area ?? ""}
          aria-label={FILTER_LABELS.area}
          className={`${FIELD} w-32`}
          onChange={(e) => go({ ...filter, q, area: parseFilter({ area: e.target.value }).area })}
          data-filter="area"
        >
          <option value="">{FILTER_LABELS.all}</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-muted">{FILTER_LABELS.mark}</span>
        <Select
          name="mark"
          value={filter.mark ?? ""}
          aria-label={FILTER_LABELS.mark}
          className={`${FIELD} w-28`}
          onChange={(e) => go({ ...filter, q, mark: parseFilter({ mark: e.target.value }).mark })}
          data-filter="mark"
        >
          <option value="">{FILTER_LABELS.all}</option>
          {marks.map(([c, label]) => (
            <option key={c} value={c}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={MAX_FILTER_TEXT}
          placeholder={FILTER_LABELS.search}
          aria-label={FILTER_LABELS.search}
          className={`${FIELD} w-40 max-w-full`}
          data-filter="q"
        />
        <Button type="submit" kind="plain" size="md" icon={SearchIcon} data-filter-search>
          {FILTER_LABELS.search}
        </Button>
      </div>
      {filterActive(filter) && (
        <ButtonLink href={caseloadHref({ sort, dir, open })} kind="quiet" size="md" icon={CloseIcon} data-filter-clear>
          {FILTER_LABELS.clear}
        </ButtonLink>
      )}
      {actions && (
        <div className="ml-auto flex flex-wrap items-center gap-2" data-filter-actions>
          {actions}
        </div>
      )}
    </form>
  );
}
