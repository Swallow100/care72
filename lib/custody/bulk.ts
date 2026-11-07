// 複数人をまとめて受け入れる（T172）。D1 に触らない（画面の部品が読む）。
//
// サーバーに一括の受け口を作らない: ブラウザが 1 人ずつ、今の受け口（/api/custody/receive・/api/custody/request/reply）を順に呼ぶ。
// だから 1 人ごとに今の受入と同じ処理（受け持ち・経過・第三者提供の記録・同意の範囲の確かめ・壁）を通り、途中で失敗しても
// 成功した人は戻らない。1 つの要求に長い処理を載せない決まり（CLAUDE.md）にも合う。
// 医療班に見せる人は増えない: まとめるのは既に出ている依頼の行と検索のヒットだけ（事業所の人を引く口は無い）。

import type { RequestHit } from "./requests.ts";

/** 1 回に受け入れる人の上限（選ぶ欄もここで止める）。1 人およそ 5 回の D1 で、送り終わりまで数秒で済む数 */
export const BULK_MAX = 20;

export type BulkTarget = { id: string; kana: string };
/** 1 人分の答え。label は画面に出す断りの言葉（CUSTODY_ERROR_LABELS） */
export type BulkSent = { ok: true; custodyId: string } | { ok: false; label: string };
export type BulkOutcome = BulkTarget & BulkSent;

/**
 * 1 人ずつ順に送る。失敗しても止めずに残りを送り、成功した人を戻さない。BULK_MAX を超えた分は送らない。
 * onStep は送り終わった人数（画面の「送信中 3/12」）
 */
export async function runBulk(
  targets: readonly BulkTarget[],
  send: (t: BulkTarget) => Promise<BulkSent>,
  onStep?: (done: number, total: number) => void,
): Promise<BulkOutcome[]> {
  const list = targets.slice(0, BULK_MAX);
  const out: BulkOutcome[] = [];
  for (const t of list) {
    let sent: BulkSent;
    try {
      sent = await send(t);
    } catch {
      sent = { ok: false, label: "送信失敗" };
    }
    out.push({ ...t, ...sent });
    onStep?.(out.length, list.length);
  }
  return out;
}

export type OfficeRequests = { officeId: string; office: string; requests: RequestHit[] };

/**
 * 受入依頼を事業所ごとにまとめる。事業所の順はいちばん古い依頼の順、中は来た順のまま（渡された行だけで、ほかの人を足さない）。
 * 鍵は事業所の id（T184。名前でまとめると、同じ名前の別の事業所の依頼が 1 つの「全選択」に入る）
 */
export function requestsByOffice(requests: readonly RequestHit[]): OfficeRequests[] {
  const groups = new Map<string, OfficeRequests>();
  for (const r of requests) {
    const g = groups.get(r.officeId);
    if (g) g.requests.push(r);
    else groups.set(r.officeId, { officeId: r.officeId, office: r.office, requests: [r] });
  }
  return [...groups.values()];
}

/** 1 人を選ぶ・外す。上限を超えては足さない */
export function togglePick(picked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else if (next.size < BULK_MAX) next.add(id);
  return next;
}

/** まとめて選ぶ・外す。全員選んであれば外し、そうでなければ上限まで足す */
export function togglePickAll(picked: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(picked);
  if (ids.length > 0 && ids.every((id) => next.has(id))) {
    for (const id of ids) next.delete(id);
    return next;
  }
  for (const id of ids) {
    if (next.size >= BULK_MAX) break;
    next.add(id);
  }
  return next;
}
