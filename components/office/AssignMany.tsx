"use client";

// 担当の一括変更（docs/tasks/T60.md）。事業所の担当の表を包み、行のチェック（PickBox）・見出しの全選択（PickAll）・
// 表の上の帯（選択 N 人・担当ごとの選択・移動先・一括変更）を持つ。表の行と欄はサーバーで描いて children で受け取る。
// 送るのは HTML のフォーム（/office/people、action=assign_many）で、選んだ人ごとに person と from.<person>（画面で読んだ担当）を隠しの欄で足す。
// サーバーは人ごとに 1 行ずつの変更と同じ検査をし、今の担当が読んだときと違う人は飛ばして、事業所の担当の区分へ 303 で戻す（変更と飛ばしの人数）。
// 一括変更はアプリ内の確認の窓で決めてから送る（名前は 6 行まで、超えたら「ほか N 件」）。
// 選んだ印はチェックの印だけで、行にテーマ色の下地を敷かない。担当ごとの選択は、その担当の人を全部選んでいるとき枠で示す。
// チェックの列は 375px でも省かない（押せる所はチェックの周りの 32px 四方）。1 行ずつの変更（AssignForm）はそのまま残す。

import { UsersIcon } from "@heroicons/react/20/solid";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { OFFICE_PEOPLE_PATH } from "@/lib/office/http-paths";
import { assignManyDetails, OFFICE_LABELS } from "@/lib/office/labels";

export type AssignManyRow = { id: string; name: string; careManagerId: string | null };

type Picks = {
  picked: ReadonlySet<string>;
  ids: readonly string[];
  toggle: (id: string, on: boolean) => void;
  setAll: (ids: readonly string[], on: boolean) => void;
};

const PicksContext = createContext<Picks | null>(null);

const usePicks = (): Picks => {
  const c = useContext(PicksContext);
  if (!c) throw new Error("AssignMany の中で使う");
  return c;
};

/** チェック（18px）。押せる所は周りの 36px 四方（label） */
const CHECK =
  "size-[1.125rem] shrink-0 accent-accent outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent";
const HIT = "-m-2 inline-flex size-9 cursor-pointer items-center justify-center rounded";

const SELECT =
  "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 担当ごとの選択の鍵（未割当は空の文字） */
const cmKey = (id: string | null) => id ?? "";

export function AssignMany({
  rows,
  careManagers,
  children,
}: {
  rows: readonly AssignManyRow[];
  careManagers: readonly { id: string; name: string }[];
  children: ReactNode;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [to, setTo] = useState("");
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);

  const picks = useMemo<Picks>(
    () => ({
      picked,
      ids,
      toggle: (id, on) =>
        setPicked((prev) => {
          const next = new Set(prev);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        }),
      setAll: (list, on) =>
        setPicked((prev) => {
          const next = new Set(prev);
          for (const id of list) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
    }),
    [picked, ids],
  );

  // 担当ごとの人（ケアマネの足した順、未割当は最後）。人のいない担当は出さない
  const groups = useMemo(() => {
    const names = new Map(careManagers.map((c) => [c.id, c.name]));
    const by = new Map<string, string[]>();
    for (const r of rows) {
      const k = cmKey(r.careManagerId !== null && names.has(r.careManagerId) ? r.careManagerId : null);
      by.set(k, [...(by.get(k) ?? []), r.id]);
    }
    const order = [...careManagers.map((c) => c.id), ""];
    return order
      .filter((k) => by.has(k))
      .map((k) => ({ key: k, name: k === "" ? OFFICE_LABELS.unassigned : names.get(k)!, ids: by.get(k)! }));
  }, [rows, careManagers]);

  const chosen = rows.filter((r) => picked.has(r.id));
  const toName = careManagers.find((c) => c.id === to)?.name ?? "";

  return (
    <PicksContext.Provider value={picks}>
      <div className="sticky top-0 z-10 -mx-1 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-panel px-1 py-1.5" data-assign-many>
        <span role="status" className="text-sm whitespace-nowrap">
          {OFFICE_LABELS.pick} <span className="font-bold tabular-nums">{chosen.length}</span> {OFFICE_LABELS.people}
        </span>
        <span role="group" aria-label={OFFICE_LABELS.pickCm} className="flex flex-wrap items-center gap-1">
          {groups.map((g) => {
            const all = g.ids.every((id) => picked.has(id));
            return (
              <button
                key={g.key}
                type="button"
                aria-pressed={all}
                aria-label={`${g.name} ${OFFICE_LABELS.pickCm} ${g.ids.length} ${OFFICE_LABELS.people}`}
                data-pick-cm={g.key}
                onClick={() => picks.setAll(g.ids, !all)}
                className={buttonClass("plain", "sm", all ? "outline-2 -outline-offset-2 outline-accent" : "")}
                data-press
              >
                <UsersIcon aria-hidden className="size-3.5 shrink-0" />
                {g.name}
                <span className="font-normal tabular-nums text-muted">{g.ids.length}</span>
              </button>
            );
          })}
        </span>
        <form method="post" action={OFFICE_PEOPLE_PATH} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="action" value="assign_many" />
          <input type="hidden" name="back" value="office" />
          {chosen.map((r) => (
            <span key={r.id} hidden>
              <input type="hidden" name="person" value={r.id} />
              <input type="hidden" name={`from.${r.id}`} value={r.careManagerId ?? ""} />
            </span>
          ))}
          <Select name="to" value={to} onChange={(e) => setTo(e.target.value)} aria-label={OFFICE_LABELS.moveTo} className={SELECT}>
            <option value="" disabled>
              {OFFICE_LABELS.moveTo}
            </option>
            {careManagers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <SubmitButton
            kind="main"
            icon="AssignIcon"
            disabled={chosen.length === 0 || to === ""}
            confirm={{
              title: OFFICE_LABELS.assignMany,
              message: `${OFFICE_LABELS.moveTo} ${toName}　${chosen.length} ${OFFICE_LABELS.people}`,
              ok: OFFICE_LABELS.assignManyOk,
              icon: "SaveIcon",
              details: assignManyDetails(chosen.map((r) => r.name)),
            }}
          >
            {OFFICE_LABELS.assignMany}
          </SubmitButton>
        </form>
      </div>
      {children}
    </PicksContext.Provider>
  );
}

/** 見出しの全選択。一部だけ選んでいるときは途中の印 */
export function PickAll() {
  const { picked, ids, setAll } = usePicks();
  const n = ids.filter((id) => picked.has(id)).length;
  const all = ids.length > 0 && n === ids.length;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = n > 0 && !all;
  }, [n, all]);
  return (
    <label className={HIT}>
      <input
        ref={box}
        type="checkbox"
        checked={all}
        onChange={(e) => setAll(ids, e.target.checked)}
        aria-label={all ? OFFICE_LABELS.clearAll : OFFICE_LABELS.selectAll}
        className={CHECK}
      />
    </label>
  );
}

/** 行のチェック */
export function PickBox({ id, label }: { id: string; label: string }) {
  const { picked, toggle } = usePicks();
  return (
    <label className={HIT}>
      <input
        type="checkbox"
        checked={picked.has(id)}
        onChange={(e) => toggle(id, e.target.checked)}
        aria-label={`${label} ${OFFICE_LABELS.pick}`}
        className={CHECK}
        data-pick={id}
      />
    </label>
  );
}
