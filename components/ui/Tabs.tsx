// 画面の中の切替（書類・様式9・様式追加など）。Link の並び。今の物は文字の色（本文色）と太字と下線で示し、下地は敷かない。
// 押してから次の画面が出るまで灰色を残す（LinkPending）。
// 下線は文字の装飾でなく切替の下の 1 本の線（T128）。名前と数（「把握 14」）のように字の大きさの違う物を並べても 1 本につながる
// （文字の装飾の下線は、間の余白と小さな字で 2 本に割れた）。同じ形の切替（訓練の経過の切替 components/drill/LogTabs）もここを使う。

import Link from "next/link";
import { LinkPending } from "./LinkPending";

export type TabItem = { href: string; label: string; current: boolean; /** 名前の横の数（あれば） */ count?: number };

/** 切替 1 つの見た目（今の物は本文色の太字と下の 1 本の線、ほかは灰の文字。下地・ピル型なし）。LinkPending のため relative */
export function tabClass(on: boolean): string {
  return `relative rounded px-2 py-1 ${on ? "font-bold text-ink after:pointer-events-none after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-sm after:bg-current" : "text-muted"}`;
}

/** 切替の名前と数（数は小さな字。間は空白 1 つで、下の線は名前と数をまとめた 1 本） */
export function TabText({ label, count }: { label: string; count?: number }) {
  return (
    <>
      {label}
      {count !== undefined && (
        <>
          {" "}
          <span className="text-xs tabular-nums" data-tab-count>
            {count}
          </span>
        </>
      )}
    </>
  );
}

export function Tabs({ items, label }: { items: ReadonlyArray<TabItem>; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 text-sm">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.current ? "page" : undefined}
          className={tabClass(t.current)}
          data-press
        >
          <TabText label={t.label} count={t.count} />
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}

/**
 * 書類の切替（ヘッダーの「書類」の下の 3 つ。T87）。/forms（書類の一覧）・/office/form9・/forms/mapping（様式追加。前の「様式対応」、URL は同じ）
 * ・/forms/mapping/[id] の上に置く
 */
export function FormsTabs({ current }: { current: "list" | "form9" | "mapping" }) {
  return (
    <Tabs
      label="書類"
      items={[
        { href: "/forms", label: "書類", current: current === "list" },
        { href: "/office/form9", label: "様式9", current: current === "form9" },
        { href: "/forms/mapping", label: "様式追加", current: current === "mapping" },
      ]}
    />
  );
}
