// 本人のページの書類の段の畳み方（T150）。最初に出す書類と、開いたら見える書類に分ける。
// 最初に出すのは、その人の計画として作り、人に渡す紙: 計画書（市への届け・本人と支援者の控え）、本人の 1 枚（本人と家族の手元）、
// 医療要約（医療班へ）。どれも見る人の範囲（lib/consent/scope.ts の documents）にあるときだけ来る。
// ほかの書類（QR など）と、書類ごとの「何の書類か」の 1 行は「他 N 件」で開いたら見える。並びは来た順のまま変えない。

import type { DocumentView } from "./person.ts";

/** 最初に出す書類（lib/labels.ts の DOCUMENT_LABELS の鍵） */
export const FIRST_DOCUMENTS: ReadonlySet<DocumentView["key"]> = new Set(["matsuyama", "medical", "own"]);

/** 最初に出す書類と、開いたら見える書類。最初に出す物が 1 つも無ければ全部を開いたら見える方へ（空の段にしない） */
export function splitDocuments(docs: ReadonlyArray<DocumentView>): { first: DocumentView[]; rest: DocumentView[] } {
  const first = docs.filter((d) => FIRST_DOCUMENTS.has(d.key));
  if (first.length === 0) return { first: [...docs], rest: [] };
  return { first, rest: docs.filter((d) => !FIRST_DOCUMENTS.has(d.key)) };
}
