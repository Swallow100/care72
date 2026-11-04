// 書類の一括印刷の紙面（/forms/batch、T87）。1 人分の紙面の部品（計画書・差し込み・元の様式の上の紙・医療要約）を人数分、渡した順に並べる。
// 紙面の部品は変えない。人の間の頁の割り方は paper-batch.css（読み込むのはページの側。本人の 1 枚の一括 own-batch.css と同じ規則）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。

import type { MappedSheet as Mapped } from "@/lib/forms/mapped-sheet";
import type { MatsuyamaSheet as Matsuyama } from "@/lib/forms/matsuyama";
import type { MedicalSummary } from "@/lib/forms/medical-summary";
import type { OverlaySheet as Overlay } from "@/lib/forms/overlay-sheet";
import { MappedSheet, type MappedSheetMeta } from "./MappedSheet";
import { MatsuyamaSheet } from "./MatsuyamaSheet";
import { MedicalSummarySheet } from "./MedicalSummarySheet";
import { OverlaySheet } from "./OverlaySheet";

export type BatchPaper =
  | { kind: "matsuyama"; personId: string; sheet: Matsuyama }
  | { kind: "mapped"; personId: string; sheet: Mapped; meta: MappedSheetMeta }
  | { kind: "overlay"; personId: string; sheet: Overlay; mappingId: string; checked: string; imageSrc: (page: number) => string }
  | { kind: "medical"; personId: string; sheet: MedicalSummary };

function One({ p }: { p: BatchPaper }) {
  switch (p.kind) {
    case "matsuyama":
      return <MatsuyamaSheet sheet={p.sheet} />;
    case "mapped":
      return <MappedSheet sheet={p.sheet} meta={p.meta} />;
    case "overlay":
      return <OverlaySheet sheet={p.sheet} imageSrc={p.imageSrc} checked={p.checked} />;
    case "medical":
      return <MedicalSummarySheet sheet={p.sheet} />;
  }
}

export function PaperBatch({ papers }: { papers: ReadonlyArray<BatchPaper> }) {
  return (
    <div className="paper-batch" data-paper-batch={papers.length}>
      {papers.map((p) => (
        <One key={p.personId} p={p} />
      ))}
    </div>
  );
}
