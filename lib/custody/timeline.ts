// 受け入れ・搬送・退所の、本人の経過の 1 行（docs/tasks/T23.md）。
//
// 経過の kind は既にある received（受け入れ）・transported（搬送）・released（退所）を使い、payload の source を custody にする。
// body は受け入れなら避難所の名前（lib/forms/form9-db.ts の entryPlace は payload の shelter → body の順で読む）、
// 搬送なら行き先（無ければ空）。書き手は受け持つアカウントと役（医療班・行政）。
// 画面の種類の言葉は「受入」「搬送」「退所」（lib/labels.ts の TIMELINE_KIND_LABELS は received を「受入」、released を「受持解除」と
// 持つ。受け持ちの行の退所はここで「退所」に上書きする。経過の 1 行は「受入 かわなぎ小学校 医療班」）。
//
// ここは型と読み方だけ（lib/person.ts の経過からも読む）。書くのは lib/custody/store.ts。

import type { CustodyVia, ReleaseKind, TimelineEntryRow } from "../db/types.ts";
import type { TimelineItem } from "../person.ts";
import { CUSTODY_LABELS, RELEASE_LABELS } from "./labels.ts";

export const CUSTODY_SOURCE = "custody";

export type CustodyPayload = {
  source: typeof CUSTODY_SOURCE;
  custodyId: string;
  shelter: string;
  /** 受け入れの入口（受け入れの行だけ） */
  via?: CustodyVia;
  /** 搬送・退所（閉じた行だけ） */
  release?: ReleaseKind;
};

export function custodyPayload(p: Omit<CustodyPayload, "source">): string {
  return JSON.stringify({ source: CUSTODY_SOURCE, ...p } satisfies CustodyPayload);
}

/** 受け持ちの行なら payload、違えば null */
export function custodyEntryOf(t: Pick<TimelineEntryRow, "kind" | "payload">): CustodyPayload | null {
  if (!t.payload || (t.kind !== "received" && t.kind !== "transported" && t.kind !== "released")) return null;
  try {
    const p = JSON.parse(t.payload) as Partial<CustodyPayload>;
    return p.source === CUSTODY_SOURCE && typeof p.custodyId === "string" ? (p as CustodyPayload) : null;
  } catch {
    return null;
  }
}

/** 経過の行の種類を「受入」「搬送」「退所」にする */
export function withCustodyEntry(item: TimelineItem, row: Pick<TimelineEntryRow, "kind" | "payload"> | undefined): TimelineItem {
  if (!row) return item;
  const p = custodyEntryOf(row);
  if (!p) return item;
  const kind = p.release ? RELEASE_LABELS[p.release] : CUSTODY_LABELS.receive;
  return { ...item, kind };
}
