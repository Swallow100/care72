// QR の頁の閲覧の記録（経過の 1 行）。第三者提供の記録の形: 相手・範囲・時刻（docs/SPEC.md「個人情報」）。
//
// 経過の kind は note にし、payload の source を qr_view にする。kind を足すと timeline_entries の CHECK を作り直す
// migration が要り、配信済みの D1 の表を建て直すことになるので避けた（入れる欄の保存の source: intake と同じ作り）。
// 画面では「QR 閲覧」と出し、ログインせずに開いた人は「未ログイン」と出す。
//
// ここは型と読み方だけ（lib/person.ts の経過からも読む）。書くのは lib/qr/view.ts の recordQrView。

import type { Role } from "../auth/roles.ts";
import type { ConsentStatus, TimelineEntryRow } from "../db/types.ts";
import type { TimelineItem } from "../person.ts";
import { QR_LABELS } from "./labels.ts";

export const QR_VIEW_SOURCE = "qr_view";

/** 出した範囲: 要約（氏名の全部と住所を除く）か、表示なし（医療班提供の同意なし・未確認） */
export type QrViewScope = "medical_summary" | "none";

export type QrViewPayload = {
  source: typeof QR_VIEW_SOURCE;
  /** 開いたトークンの版 */
  generation: number;
  /** 相手。ログインしていなければ null */
  recipient: { role: Role; accountId: string | null; name: string | null; judge: boolean } | null;
  scope: QrViewScope;
  /** 医療班提供の同意（開いたときの） */
  consent: ConsentStatus;
  /** 出した欄（lib/forms/medical-summary.ts の MEDICAL_FIELDS の key）。表示なしは空 */
  fields: string[];
};

/** QR の閲覧の行なら payload、違えば null */
export function qrViewOf(t: Pick<TimelineEntryRow, "kind" | "payload">): QrViewPayload | null {
  if (t.kind !== "note" || !t.payload) return null;
  try {
    const p = JSON.parse(t.payload) as Partial<QrViewPayload>;
    return p.source === QR_VIEW_SOURCE ? (p as QrViewPayload) : null;
  } catch {
    return null;
  }
}

/** 経過の行を「QR 閲覧」にする。ログインせずに開いた人は「未ログイン」 */
export function withQrView(item: TimelineItem, row: Pick<TimelineEntryRow, "kind" | "payload" | "author_id"> | undefined): TimelineItem {
  if (!row) return item;
  const p = qrViewOf(row);
  if (!p) return item;
  return { ...item, kind: QR_LABELS.view, tone: null, who: row.author_id || p.recipient ? item.who : QR_LABELS.anonymous };
}
