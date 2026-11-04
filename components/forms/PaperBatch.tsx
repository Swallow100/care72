// 書類の一括印刷の紙面（/forms/batch、T87）。1 人分の紙面の部品（計画書・差し込み・元の様式の上の紙・医療要約）を人数分、渡した順に並べる。
// 紙面の部品は変えない。人の間の頁の割り方は paper-batch.css（読み込むのはページの側。本人の 1 枚の一括 own-batch.css と同じ規則）。
// 原本を取り込んだ事業所の計画書・医療要約は、1 人ずつの紙と同じ原本の枠の紙（frame、T101・T106。1 人分は lib/forms/batch.ts が決める）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。

import type { RouteMapImage } from "@/lib/forms/frame-build";
import type { MappedSheet as Mapped } from "@/lib/forms/mapped-sheet";
import type { MatsuyamaSheet as Matsuyama } from "@/lib/forms/matsuyama";
import type { MedicalSummary } from "@/lib/forms/medical-summary";
import { originalPageHref, type OriginalId } from "@/lib/forms/originals";
import type { OverlaySheet as Overlay } from "@/lib/forms/overlay-sheet";
import { MappedSheet, type MappedSheetMeta } from "./MappedSheet";
import { MatsuyamaSheet } from "./MatsuyamaSheet";
import { MedicalSummarySheet } from "./MedicalSummarySheet";
import { OverlaySheet } from "./OverlaySheet";

export type BatchPaper =
  /** 前からの紙面（T85）の計画書。routeMap は避難経路の段の地図 */
  | { kind: "matsuyama"; personId: string; sheet: Matsuyama; routeMap?: RouteMapImage | null }
  | { kind: "mapped"; personId: string; sheet: Mapped; meta: MappedSheetMeta }
  /** 添付の様式の頁の上の紙（T86） */
  | { kind: "overlay"; personId: string; sheet: Overlay; mappingId: string; checked: string; imageSrc: (page: number) => string; fill: boolean }
  /** 事業所が取り込んだ原本の枠の紙（T101）。計画書は matsuyama、医療要約は kiroku */
  | { kind: "frame"; personId: string; sheet: Overlay; original: OriginalId; fill: boolean }
  | { kind: "medical"; personId: string; sheet: MedicalSummary };

function One({ p }: { p: BatchPaper }) {
  switch (p.kind) {
    case "matsuyama":
      return <MatsuyamaSheet sheet={p.sheet} routeMap={p.routeMap ?? null} />;
    case "mapped":
      return <MappedSheet sheet={p.sheet} meta={p.meta} />;
    case "overlay":
      return <OverlaySheet sheet={p.sheet} imageSrc={p.imageSrc} checked={p.checked} fill={p.fill} />;
    case "frame":
      return <OverlaySheet sheet={p.sheet} imageSrc={(page) => originalPageHref(p.original, page)} checked="" fill={p.fill} kind={p.original} />;
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
