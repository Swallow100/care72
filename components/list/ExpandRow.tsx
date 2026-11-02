"use client";

// 担当一覧の発災時の 1 行と、行の下に開く詳細（docs/tasks/T13.md「行の下に開く。別ページに飛ばない」）。
// 中身（行の欄と詳細）はサーバーで描いて受け取り、ここは開け閉めだけを持つ。1 分ごとの読み直し（router.refresh）でも
// 開いた行は開いたまま（id ごとの部品の状態が残る）。詳細は開いたときだけ描く（録音の音声を開くまで読まない）。
// 行のどこを押しても開け閉めする（名前のリンク・電話・ボタンの上は除く）。

import { useState } from "react";

export function ExpandRow({
  id,
  cols,
  head,
  cells,
  detail,
  label,
  cellClass,
}: {
  id: string;
  /** 列の数（詳細の行の幅） */
  cols: number;
  /** 先頭の欄の中身（状態の印）。開け閉めのボタンになる */
  head: React.ReactNode;
  /** 残りの欄（td の並び） */
  cells: React.ReactNode;
  detail: React.ReactNode;
  /** 読み上げの名前（氏名） */
  label: string;
  cellClass: string;
}) {
  const [open, setOpen] = useState(false);
  const detailId = `row-detail-${id}`;
  return (
    <>
      <tr
        data-row={id}
        data-open={open ? "" : undefined}
        className={open ? "[&>td]:rounded-b-none!" : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button,input,textarea,audio,label")) return;
          setOpen((v) => !v);
        }}
      >
        <td className={`${cellClass} text-center`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? detailId : undefined}
            aria-label={`${label} ${open ? "閉じる" : "詳細"}`}
            onClick={() => setOpen((v) => !v)}
            className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5"
            data-press
          >
            {head}
            <Chevron open={open} />
          </button>
        </td>
        {cells}
      </tr>
      {open && (
        <tr id={detailId} data-detail={id}>
          <td colSpan={cols} className="rounded-b-md bg-panel px-3 pb-3 pt-1">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}

/** 細い不等号の印（開くと上向き）。既定の▼は使わない */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className={`size-3 text-muted transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
