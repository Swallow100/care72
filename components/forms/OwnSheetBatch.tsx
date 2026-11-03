// 本人の 1 枚の一括印刷の紙面（/caseload/own-sheets、T62）。1 人分の紙面（OwnSheetPaper、表と裏の 2 枚）を人数分、渡した順に並べる。
// 紙面の部品は変えない。人の間の頁の割り方は own-batch.css（読み込むのはページの側。テストは lib/forms/t62.test.ts）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。

import type { OwnSheetItem } from "@/lib/forms/own-sheets";
import { OwnSheetPaper } from "./OwnSheet";

export function OwnSheetBatch({ items }: { items: ReadonlyArray<OwnSheetItem> }) {
  return (
    <div className="own-batch" data-own-batch={items.length}>
      {items.map((x) => (
        <OwnSheetPaper key={x.personId} sheet={x.sheet} medical={x.medical} qr={x.qr} />
      ))}
    </div>
  );
}
