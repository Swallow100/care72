// 人が台帳で付ける 2 つの欄を変えたときの経過の行。
// - 時計の頼り先の確認（確認済・未確認）。透析先・冷蔵・配達のような外の物に頼る時計に付ける
// - 本人の報告を当てにしない印（認知症など）
// どちらも人だけが付ける（docs/DECISIONS.md 11/2）。Claude が自由文から推し量って付けることはしないので、
// 書き手は人の役（ケアマネ・医療班・行政）に限り、system や本人・家族の役では作れない。

import type { CheckStatus, ClockRow, TimelineEntryRow } from "./db/types.ts";
import { CHECK_STATUS_LABELS, DEPENDS_ON_LABELS } from "./labels.ts";

/** この 2 つの欄を変えてよい役 */
export const MARK_AUTHOR_ROLES = ["care_manager", "medical", "government"] as const;
export type MarkAuthorRole = (typeof MARK_AUTHOR_ROLES)[number];
export type MarkAuthor = { id: string; role: MarkAuthorRole };

export type NewTimelineEntry = Omit<TimelineEntryRow, "created_at">;

function assertHuman(by: MarkAuthor): void {
  if (!(MARK_AUTHOR_ROLES as readonly string[]).includes(by.role)) {
    throw new Error("この欄は人が付ける（ケアマネ・医療班・行政）");
  }
}

/** 時計の頼り先の確認を変えた行。clock は変える前の状態 */
export function clockCheckEntry(args: {
  id: string;
  clock: Pick<ClockRow, "id" | "person_id" | "label" | "depends_on" | "depends_check">;
  to: CheckStatus;
  by: MarkAuthor;
  /** 付けた・外した時刻（ISO 8601） */
  at: string;
}): NewTimelineEntry {
  assertHuman(args.by);
  const { clock } = args;
  if (clock.depends_on == null) throw new Error("頼り先の無い時計には確認を付けない");
  return {
    id: args.id,
    person_id: clock.person_id,
    author_id: args.by.id,
    author_role: args.by.role,
    kind: "clock_check",
    body: `${clock.label} ${DEPENDS_ON_LABELS[clock.depends_on]} ${CHECK_STATUS_LABELS[args.to]}`,
    payload: JSON.stringify({ clockId: clock.id, dependsOn: clock.depends_on, from: clock.depends_check, to: args.to }),
    signal_id: null,
    occurred_at: args.at,
  };
}

/** 本人の報告を当てにしない印を付けた・外した行 */
export function selfReportMarkEntry(args: {
  id: string;
  personId: string;
  from: boolean;
  to: boolean;
  by: MarkAuthor;
  at: string;
}): NewTimelineEntry {
  assertHuman(args.by);
  return {
    id: args.id,
    person_id: args.personId,
    author_id: args.by.id,
    author_role: args.by.role,
    kind: "self_report_mark",
    body: args.to ? "本人の報告を当てにしない印を付けた" : "本人の報告を当てにしない印を外した",
    payload: JSON.stringify({ from: args.from, to: args.to }),
    signal_id: null,
    occurred_at: args.at,
  };
}
