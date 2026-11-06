"use client";

// 担当の割当の 1 行のフォーム（docs/tasks/T30.md）。担当を選んで「変更」。送るのは HTML のフォーム（/office/people、action=assign）で、
// サーバーが事業所の画面の担当の区分へ 303 で戻す。戻ったあと、変えた行に「変更済」を出す（送る前にこの端末の sessionStorage に印を置き、
// 読み直した画面で 1 回だけ読んで消す。名前や担当は置かない）。押してから戻るまで灰色を残す。
// T162: 「変更」は担当を今と違う人に選んでから押せる（選ぶ前に押して何も起きないと読まれた）。読み上げの名前は「〇〇 担当変更」

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { StateText } from "@/components/ui/Tag";
import { OFFICE_PEOPLE_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";
import { Select } from "@/components/ui/Select";

const KEY = "care72.assigned";

const SELECT =
  "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function AssignForm({
  personId,
  personName,
  careManagerId,
  careManagers,
}: {
  personId: string;
  personName: string;
  careManagerId: string | null;
  /** 割当の候補。disabled は選べない印（停止した今の担当、T61） */
  careManagers: readonly { id: string; name: string; disabled?: boolean }[];
}) {
  const [done, setDone] = useState(false);
  const [to, setTo] = useState(careManagerId ?? "");
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(KEY) === personId) {
        window.sessionStorage.removeItem(KEY);
        setDone(true);
      }
    } catch {
      // 保存できない端末では知らせを出さないだけ
    }
  }, [personId]);

  const known = careManagerId !== null && careManagers.some((c) => c.id === careManagerId);
  return (
    <form
      method="post"
      action={OFFICE_PEOPLE_PATH}
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={() => {
        try {
          window.sessionStorage.setItem(KEY, personId);
        } catch {
          // 同上
        }
      }}
    >
      <input type="hidden" name="action" value="assign" />
      <input type="hidden" name="person" value={personId} />
      <input type="hidden" name="from" value={careManagerId ?? ""} />
      <input type="hidden" name="back" value="office" />
      <Select name="to" defaultValue={careManagerId ?? ""} aria-label={`${personName} ${OFFICE_LABELS.careManager}`} className={SELECT} onChange={(e) => {
          setDone(false);
          setTo(e.target.value);
        }}>
        {!known && (
          <option value="" disabled>
            {OFFICE_LABELS.unassigned}
          </option>
        )}
        {careManagers.map((c) => (
          <option key={c.id} value={c.id} disabled={c.disabled}>
            {c.name}
          </option>
        ))}
      </Select>
      <SubmitButton icon="AssignIcon" disabled={to === "" || to === (careManagerId ?? "")} aria-label={`${personName} ${OFFICE_LABELS.assignChange}`}>
        {OFFICE_LABELS.assign}
      </SubmitButton>
      {done && (
        <span role="status" className="text-sm">
          <StateText tone="ok">変更済</StateText>
        </span>
      )}
    </form>
  );
}
