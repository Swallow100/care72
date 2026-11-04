"use client";

// 事業所の担当の表の 1 行と、行の下に開く詳細（行ごとの「外す」は開いた行の詳細の中へ。一覧に赤を並べない）。
// 中身（行の欄と詳細）はサーバーで描いて受け取り、ここは開け閉めだけを持つ。開け閉めのボタンは行の右端（アイコン＋文字）。
// 行のどこを押しても開け閉めする（名前のリンク・担当の選択・ボタンの上は除く）。担当一覧の行（components/list/ExpandRow）と同じ動き。

import { useState } from "react";
import { OpenIcon } from "@/components/ui/Icon";
import { buttonClass } from "@/components/ui/Button";
import { OFFICE_LABELS } from "@/lib/office/labels";

export function AssignRow({
  id,
  cols,
  cells,
  detail,
  label,
  cellClass,
}: {
  id: string;
  /** 列の数（詳細の行の幅） */
  cols: number;
  /** 開け閉めの欄より前の欄（td の並び） */
  cells: React.ReactNode;
  detail: React.ReactNode;
  /** 読み上げの名前（氏名） */
  label: string;
  cellClass: string;
}) {
  const [open, setOpen] = useState(false);
  const detailId = `assign-detail-${id}`;
  return (
    <>
      <tr
        data-row={id}
        data-open={open ? "" : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
          setOpen((v) => !v);
        }}
      >
        {cells}
        <td className={`${cellClass} text-right`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? detailId : undefined}
            aria-label={`${label} ${open ? OFFICE_LABELS.close : OFFICE_LABELS.detail}`}
            onClick={() => setOpen((v) => !v)}
            className={buttonClass("quiet", "sm")}
            data-press
          >
            <OpenIcon aria-hidden className={`size-3.5 shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
            {open ? OFFICE_LABELS.close : OFFICE_LABELS.detail}
          </button>
        </td>
      </tr>
      {open && (
        <tr id={detailId} data-detail={id}>
          <td colSpan={cols} className="bg-panel px-2 pt-0 pb-2">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}
