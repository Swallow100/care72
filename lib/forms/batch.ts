// 書類の一括印刷（/forms/batch、T87）の 1 人分の紙を決める（T106）。
// - 事業所が原本を取り込んでいれば（T101）、計画書（松山市の様式）と医療要約（災害診療記録2018）は 1 人ずつの紙と同じ原本の枠の紙
//   （lib/forms/frame-build.ts）。未記入の色付け（?fill=1）も同じ版で。取り込んでいなければ前からの紙面（T85）
// - 計画書は、どちらの紙でも台帳の経路地図（T102）を避難経路の欄に（経路地図か家の位置が無い人は空ける）
// - 未入力の数は 1 人ずつの紙の帯と同じ数え方（原本の枠の医療要約は紙が空ける欄、前からの紙面は台帳の pending）
// 純な計算（D1・R2 はページが読んで渡す）。Claude は呼ばない。

import type { BatchPaper } from "../../components/forms/PaperBatch.tsx";
import type { Ledger } from "../db/types.ts";
import { kirokuFrameSheet, matsuyamaFrameSheet, routeMapFor } from "./frame-build.ts";
import type { MatsuyamaSheet } from "./matsuyama.ts";
import type { MedicalSummary } from "./medical-summary.ts";
import type { OriginalManifest } from "./originals.ts";
import { medicalUnconfirmed } from "./unconfirmed.ts";

/** 計画書（松山市の様式）の 1 人分 */
export function matsuyamaBatchPaper(input: {
  personId: string;
  sheet: MatsuyamaSheet;
  ledger: Ledger;
  /** 事業所が取り込んだ松山市の原本（無ければ null） */
  manifest: OriginalManifest | null;
  fill: boolean;
}): BatchPaper {
  const routeMap = routeMapFor(input.ledger);
  if (input.manifest) {
    return {
      kind: "frame",
      personId: input.personId,
      sheet: matsuyamaFrameSheet(input.sheet, input.manifest, { routeMap }),
      original: "matsuyama",
      fill: input.fill,
    };
  }
  return { kind: "matsuyama", personId: input.personId, sheet: input.sheet, routeMap };
}

/** 医療要約の 1 人分と、帯に出す未入力の数（台帳で直せる欄） */
export function medicalBatchPaper(input: {
  personId: string;
  sheet: MedicalSummary;
  /** 事業所が取り込んだ災害診療記録2018 の原本（無ければ null） */
  manifest: OriginalManifest | null;
  fill: boolean;
}): { paper: BatchPaper; blank: number } {
  if (input.manifest) {
    return {
      paper: { kind: "frame", personId: input.personId, sheet: kirokuFrameSheet(input.sheet, input.manifest), original: "kiroku", fill: input.fill },
      blank: medicalUnconfirmed(input.sheet).fields.filter((f) => !f.noSource).length,
    };
  }
  return { paper: { kind: "medical", personId: input.personId, sheet: input.sheet }, blank: input.sheet.pending.length };
}

/** 紙に原本の枠の紙か添付の様式の上の紙（未記入の色付けの切替が効く紙）があるか */
export function hasFillablePaper(papers: ReadonlyArray<BatchPaper>): boolean {
  return papers.some((p) => p.kind === "frame" || p.kind === "overlay");
}
