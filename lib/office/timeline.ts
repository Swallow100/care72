// 利用者追加・担当変更・一覧除外・一覧復帰の、本人の経過の 1 行（docs/tasks/T30.md）。
//
// 経過の kind は note にし、payload の source を office にする（入れる欄の source: intake、QR の source: qr_view と同じ作り。
// kind を足すと本人の経過を読む所に型の波及が出る）。画面では種類を「利用者追加」などと出す。
// body はケアマネの名前まで（「担当 山本 → 佐藤」）。本人の名前は書かない。
//
// ここは型と読み方だけ（lib/person.ts の経過からも読む）。書くのは lib/office/people.ts。

import type { TimelineEntryRow } from "../db/types.ts";
import type { TimelineItem } from "../person.ts";

export const OFFICE_SOURCE = "office";

/** taken は所属なしの人を事業所に引き受けた（T23、書くのは lib/custody/takeover.ts） */
export const OFFICE_ACTIONS = ["added", "assigned", "unlisted", "relisted", "taken"] as const;
export type OfficeAction = (typeof OFFICE_ACTIONS)[number];

export const OFFICE_ACTION_LABELS: Record<OfficeAction, string> = {
  added: "利用者追加",
  assigned: "担当変更",
  unlisted: "一覧除外",
  relisted: "一覧復帰",
  taken: "引受",
};

export type OfficePayload = {
  source: typeof OFFICE_SOURCE;
  action: OfficeAction;
  /** 前の担当（担当変更のとき）。未割当は null */
  from?: string | null;
  /** 今の担当（利用者追加・担当変更のとき） */
  to?: string | null;
};

export function officePayload(action: OfficeAction, ids: { from?: string | null; to?: string | null } = {}): string {
  const p: OfficePayload = { source: OFFICE_SOURCE, action, ...ids };
  return JSON.stringify(p);
}

/** 事業所の操作の行なら payload、違えば null */
export function officeEntryOf(t: Pick<TimelineEntryRow, "kind" | "payload">): OfficePayload | null {
  if (t.kind !== "note" || !t.payload) return null;
  try {
    const p = JSON.parse(t.payload) as Partial<OfficePayload>;
    return p.source === OFFICE_SOURCE && (OFFICE_ACTIONS as readonly string[]).includes(p.action ?? "")
      ? (p as OfficePayload)
      : null;
  } catch {
    return null;
  }
}

/** 経過の行の種類を「利用者追加」などにする */
export function withOfficeEntry(item: TimelineItem, row: Pick<TimelineEntryRow, "kind" | "payload"> | undefined): TimelineItem {
  if (!row) return item;
  const p = officeEntryOf(row);
  return p ? { ...item, kind: OFFICE_ACTION_LABELS[p.action], tone: null } : item;
}
