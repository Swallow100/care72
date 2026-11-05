"use client";

// 訓練の行の詳細の連絡先の 1 行（docs/tasks/T132.md）。押すと対応の欄でその本人・その手・その連絡先を選んだ形にする（act-pick の口）。
// 行の中身（名前・間柄・役割の印など）はサーバーで描いて受け取る。番号は受け取らない（訓練の画面から本物の番号にかけない）。
// 右に選ぶ手の言葉（「連絡先電話」）。押せない時は理由の 2〜4 字（「通話不可」）を出して押せない。押したときは灰色だけ。

import type { DrillAction } from "@/lib/db/types";
import { pickAct } from "./act-pick";
import { ACTION_ICONS } from "./icons";

export function ContactPick({
  person,
  kind,
  target,
  label,
  block,
  children,
}: {
  person: string;
  kind: DrillAction;
  target: string | null;
  label: string;
  block: string | null;
  children: React.ReactNode;
}) {
  const Icon = ACTION_ICONS[kind];
  return (
    <button
      type="button"
      disabled={block !== null}
      onClick={() => pickAct({ person, kind, target })}
      className="-mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-x-2 rounded px-1 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent disabled:cursor-default"
      data-press={block === null ? "" : undefined}
      data-contact-pick={kind}
      data-contact-target={target ?? ""}
      data-contact-block={block ?? undefined}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {block ? (
        <span className="shrink-0 text-xs text-muted">{block}</span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-accent">
          <Icon aria-hidden className="size-3.5" />
          {label}
        </span>
      )}
    </button>
  );
}
