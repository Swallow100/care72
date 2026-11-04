// 準備の欄（docs/tasks/T98.md）。事業所の画面（/office）の一番上に、管理者だけ。残っている準備を 1 行ずつ（地域 未設定・ケアマネ追加・
// 利用者追加・担当 未割当 N）、行を押すとその区分へ送る（同じ画面の id。保存のあとに戻る所と同じ）。全部済めば欄ごと出さない。
// 中身は lib/office/setup.ts の setupItems。言葉と数だけで、色の枠・黄の印は付けない（右の面の見直しの行と同じ灰色の地。T96）。
// 常設の説明文は置かない。印刷には出さない。

import { GoToIcon } from "@/components/ui/Icon";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { SETUP_LABELS, type SetupItem } from "@/lib/office/setup";
import { SetupLater } from "./SetupLater";

export function SetupPanel({ items, laterCookie, className = "" }: { items: SetupItem[]; laterCookie: string; className?: string }) {
  if (items.length === 0) return null;
  return (
    <Panel aria-labelledby="setup-title" className={`print:hidden ${className}`.trim()} data-setup>
      <PanelHead
        id="setup-title"
        title={SETUP_LABELS.title}
        count={
          <>
            {SETUP_LABELS.left} <span className="font-bold text-ink tabular-nums">{items.length}</span>
          </>
        }
      />
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.kind} className="flex items-center rounded-md bg-panel2" data-setup-item={item.kind}>
            <a href={item.href} className="flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-sm" data-press="overlay">
              <GoToIcon aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="font-bold">{item.label}</span>
              {item.status !== null && <span>{item.status}</span>}
              {item.count !== null && <span className="font-bold tabular-nums">{item.count}</span>}
            </a>
            {item.kind === "care_manager" && <SetupLater cookie={laterCookie}>{SETUP_LABELS.later}</SetupLater>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
